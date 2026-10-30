import type { D1Database } from "@cloudflare/workers-types";
import { slugSchema } from "@/modules/meu-site/contracts";
import type { Token } from "@/modules/frappe-site/document";
import { pickPage, routeOf } from "@/modules/frappe-site/routes";

/**
 * The public reading of the pages made in the embedded editor: no session, and nothing but what the editor's own "published" says. A site
 * is found by its address; its published pages are the documents of the editor with `published = 1` (never the draft: the draft column
 * is cut out of the statement, so it does not even leave the database). Nothing of the organization is returned: not its name, not
 * who edited, not the documents of other types than the ones the page needs (the page, its components, its variables, its settings,
 * its style sheets).
 */
export interface PublicPage {
  slug: string;
  /** The route this answer is for (the home page has the route of the page that stands for it). */
  route: string;
  /** The page document, without its draft. */
  page: Record<string, unknown>;
  /** The blocks of the page, parsed. */
  blocks: unknown;
  /** The block of each component the page uses, by id (and `id@version` for a pinned version). */
  components: Map<string, unknown>;
  tokens: Token[];
  settings: Record<string, unknown>;
  /** The text of the page's style sheets (the client scripts of type CSS). */
  styles: string[];
  /** The site's own switch for the messages of its forms (it is born off; the environment's switch is a different one). */
  inquiriesOpen: boolean;
}

const MAX_COMPONENT_ROUNDS = 6;
const MAX_REFERENCES = 60;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");

function parse(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try {
    const value = JSON.parse(data);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function parseBlocks(value: unknown): unknown {
  if (typeof value !== "string") return value ?? [];
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

/** The components a tree of blocks points to (`extendedFromComponent`), each with the version it is pinned to, if any. */
function referencesIn(tree: unknown, into: Map<string, Set<string>>): void {
  const stack: unknown[] = [tree];
  let visited = 0;
  while (stack.length && visited < 100_000) {
    const node = stack.pop();
    visited += 1;
    if (Array.isArray(node)) stack.push(...node);
    else if (isRecord(node)) {
      const id = text(node.extendedFromComponent);
      if (id) {
        const versions = into.get(id) ?? new Set<string>();
        const version = text(node.componentVersion);
        if (version) versions.add(version);
        into.set(id, versions);
      }
      if (Array.isArray(node.children)) stack.push(...node.children);
    }
  }
}

const chunks = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/**
 * The published page an address names. `exactName` (the editor's name of a page) reads that page itself instead of choosing by route: for the
 * panel that lists the forms of each page on the air, where the home page has to be told from the page the home address would show.
 */
export async function publicBuilderPage(db: D1Database, rawSlug: string, requestedRoute: string, exactName?: string): Promise<PublicPage | null> {
  const slug = slugSchema.safeParse(rawSlug);
  if (!slug.success) return null;
  const site = await db.prepare("SELECT organization_id AS organizationId, inquiries_open AS inquiriesOpen FROM sites WHERE slug = ?").bind(slug.data).first<{ organizationId: string; inquiriesOpen: number }>();
  if (!site) return null;
  const org = site.organizationId;

  const [pages, shared] = await db.batch<{ name: string; route: string | null; publishedAt: string | null; data?: string; doctype?: string }>([
    db
      .prepare(
        `SELECT name, json_extract(data, '$.route') AS route, json_extract(data, '$.published_at') AS publishedAt FROM builder_docs
         WHERE organization_id = ?1 AND doctype = 'Builder Page' AND json_extract(data, '$.published') = 1
           AND COALESCE(json_extract(data, '$.dynamic_route'), 0) = 0`,
      )
      .bind(org),
    db.prepare(`SELECT doctype, name, data FROM builder_docs WHERE organization_id = ?1 AND doctype IN ('Builder Settings', 'Builder Token')`).bind(org),
  ]);
  const settingsRow = shared!.results.find((row) => row.doctype === "Builder Settings");
  const settings = (settingsRow ? parse(settingsRow.data) : null) ?? {};
  const refs = pages!.results.map((row) => ({ name: row.name, route: row.route ?? "", publishedAt: row.publishedAt ?? "" }));
  const chosen = exactName !== undefined ? (refs.find((ref) => ref.name === exactName) ?? null) : pickPage(refs, requestedRoute, text(settings.home_page));
  if (!chosen) return null;

  const row = await db
    .prepare(`SELECT json_remove(data, '$.draft_blocks') AS data FROM builder_docs WHERE organization_id = ?1 AND doctype = 'Builder Page' AND name = ?2`)
    .bind(org, chosen.name)
    .first<{ data: string }>();
  const page = row ? parse(row.data) : null;
  if (!page || Number(page.published) !== 1) return null;
  const blocks = parseBlocks(page.blocks);

  const tokens: Token[] = [];
  for (const entry of shared!.results) {
    if (entry.doctype !== "Builder Token") continue;
    const doc = parse(entry.data);
    if (doc && text(doc.value)) tokens.push({ name: entry.name, value: text(doc.value), darkValue: text(doc.dark_value) || null });
  }

  // The components of the page, and the ones those are made of, a few rounds deep.
  const components = new Map<string, unknown>();
  const wanted = new Map<string, Set<string>>();
  referencesIn(blocks, wanted);
  const seen = new Set<string>();
  for (let round = 0; round < MAX_COMPONENT_ROUNDS && wanted.size; round += 1) {
    const ids = [...wanted.keys()].filter((id) => !seen.has(id)).slice(0, MAX_REFERENCES);
    const versions = [...wanted.values()].flatMap((set) => [...set]);
    wanted.clear();
    for (const id of ids) seen.add(id);
    const found: Array<{ name: string; data: string }> = [];
    for (const part of chunks(ids, 40)) {
      const { results } = await db
        .prepare(`SELECT name, data FROM builder_docs WHERE organization_id = ?1 AND doctype = 'Builder Component' AND name IN (${part.map((_, i) => `?${i + 2}`).join(",")})`)
        .bind(org, ...part)
        .all<{ name: string; data: string }>();
      found.push(...results);
    }
    if (versions.length) {
      for (const part of chunks(versions.slice(0, MAX_REFERENCES), 40)) {
        const { results } = await db
          .prepare(`SELECT name, data FROM builder_docs WHERE organization_id = ?1 AND doctype = 'Builder Snapshot' AND name IN (${part.map((_, i) => `?${i + 2}`).join(",")})`)
          .bind(org, ...part)
          .all<{ name: string; data: string }>();
        for (const snapshot of results) {
          const doc = parse(snapshot.data);
          const inner = doc && doc.reference_doctype === "Builder Component" ? parse(doc.data) : null;
          if (doc && inner) {
            const block = parseBlocks(inner.block);
            components.set(`${text(doc.reference_name)}@${snapshot.name}`, block);
            referencesIn(block, wanted);
          }
        }
      }
    }
    for (const entry of found) {
      const doc = parse(entry.data);
      if (!doc) continue;
      const block = parseBlocks(doc.block);
      components.set(entry.name, block);
      referencesIn(block, wanted);
    }
    for (const id of seen) wanted.delete(id);
  }

  const scripts = Array.isArray(page.client_scripts) ? page.client_scripts.filter(isRecord).map((entry) => text(entry.builder_script)).filter(Boolean).slice(0, 40) : [];
  const styles: string[] = [];
  if (scripts.length) {
    const { results } = await db
      .prepare(`SELECT data FROM builder_docs WHERE organization_id = ?1 AND doctype = 'Builder Client Script' AND name IN (${scripts.map((_, i) => `?${i + 2}`).join(",")})`)
      .bind(org, ...scripts)
      .all<{ data: string }>();
    for (const entry of results) {
      const doc = parse(entry.data);
      if (doc && doc.script_type === "CSS" && text(doc.script)) styles.push(text(doc.script));
    }
  }

  return { slug: slug.data, route: routeOf(text(page.route)), page, blocks, components, tokens, settings, styles, inquiriesOpen: site.inquiriesOpen === 1 };
}

/** Whether an address has at least one published page of the new editor (the same pages `publicBuilderPage` answers). */
export async function hasPublishedBuilderPage(db: D1Database, rawSlug: string): Promise<boolean> {
  const slug = slugSchema.safeParse(rawSlug);
  if (!slug.success) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM sites s WHERE s.slug = ?1 AND EXISTS (
         SELECT 1 FROM builder_docs b WHERE b.organization_id = s.organization_id AND b.doctype = 'Builder Page'
           AND json_extract(b.data, '$.published') = 1 AND COALESCE(json_extract(b.data, '$.dynamic_route'), 0) = 0)`,
    )
    .bind(slug.data)
    .first();
  return row !== null;
}
