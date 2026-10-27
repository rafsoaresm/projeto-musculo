import type { D1Database } from "@cloudflare/workers-types";
import {
  publishIssues,
  siteContent,
  slugSchema,
  starterContent,
  titleSchema,
  type PublishIssue,
  type SiteContent,
} from "@/modules/meu-site/contracts";
import type { Delivery } from "@/modules/leads/contracts";
import { sha256Hex } from "./crypto";
import { activeUser, assertContext, type AuthenticatedContext } from "./students";

/**
 * "Meu Site": the page of a professional. A working draft (with a revision that goes up by one per save), an
 * immutable release per publication and a pointer to the release that is public. Publishing writes the
 * release and moves the pointer in one batch, and only if the draft is still the revision the person saw;
 * taking the page offline deletes the pointer. The owner and the managers edit and publish; the commercial
 * members read. The organization and the person come from the verified session and each statement repeats
 * the membership, the role and the active login. The public reading (`publishedSiteBySlug`) has no session
 * and returns only what a release says, never anything of the organization.
 */
export const SITE_CREATED = "SITE_CREATED";
export const SITE_PUBLISHED = "SITE_PUBLISHED";
export const SITE_UNPUBLISHED = "SITE_UNPUBLISHED";
export const SITE_ADDRESS_CHANGED = "SITE_ADDRESS_CHANGED";

export interface ServiceChoice {
  id: string;
  name: string;
  delivery: Delivery;
}
export interface ReleaseRow {
  id: string;
  number: number;
  createdAt: string;
  createdByName: string | null;
  draftRevision: number;
  live: boolean;
}
export interface SiteOverview {
  site: { id: string; slug: string };
  draft: { content: SiteContent; revision: number; updatedAt: string };
  live: { number: number; publishedAt: string; draftRevision: number } | null;
  releases: ReleaseRow[];
  services: ServiceChoice[];
}
export interface PublicSite {
  slug: string;
  number: number;
  publishedAt: string;
  content: SiteContent;
}

export type CreateSiteOutcome = { status: "created" } | { status: "exists" } | { status: "slug_taken" } | { status: "forbidden" };
export type SaveDraftOutcome = { status: "saved"; revision: number } | { status: "conflict" } | { status: "not_found" };
export type PublishOutcome =
  | { status: "published"; number: number }
  | { status: "invalid"; issues: PublishIssue[] }
  | { status: "conflict" }
  | { status: "not_found" };
export type AddressOutcome = { status: "changed" } | { status: "slug_taken" } | { status: "public" } | { status: "not_found" };
export type RestoreOutcome = { status: "restored"; revision: number } | { status: "conflict" } | { status: "not_found" };

/** The services chosen in each block, written as they are on offer now. A draft does not carry them. */
export function resolveServices(content: SiteContent, live: Map<string, { name: string; description: string | null; delivery: Delivery }>): SiteContent {
  return {
    ...content,
    blocks: content.blocks.map((block) =>
      block.type === "services"
        ? {
            ...block,
            items: block.serviceIds.flatMap((serviceId) => {
              const service = live.get(serviceId);
              return service
                ? [{ name: service.name, ...(service.description ? { description: service.description } : {}), delivery: service.delivery }]
                : [];
            }),
          }
        : block,
    ),
  };
}

/** What the draft keeps: a release brought back as a draft loses the resolved services, which are made again. */
function withoutResolvedServices(content: SiteContent): SiteContent {
  return {
    ...content,
    blocks: content.blocks.map((block) => {
      if (block.type !== "services") return block;
      const { items: _items, ...rest } = block;
      void _items;
      return rest;
    }),
  };
}

export function sitesFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting login.
  const reads = `EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
    AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER','COMMERCIAL')) AND ${activeUser("?2")}`;
  const writes = `EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
    AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER')) AND ${activeUser("?2")}`;
  const audit = (action: string, subject: string, stamp: string) =>
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
      )
      .bind(crypto.randomUUID(), organizationId, userId, action, subject, stamp);

  async function draftRow() {
    return db
      .prepare(
        `SELECT s.id AS siteId, s.slug, d.content, d.revision, d.updated_at AS updatedAt
         FROM sites s JOIN site_drafts d ON d.site_id = s.id
         WHERE s.organization_id = ?1 AND ${reads}`,
      )
      .bind(organizationId, userId)
      .first<{ siteId: string; slug: string; content: string; revision: number; updatedAt: string }>();
  }
  async function liveServices() {
    const result = await db
      .prepare(
        `SELECT id, name, description, delivery FROM service_offerings
         WHERE organization_id = ?1 AND active = 1 AND ${reads} ORDER BY lower(name), id`,
      )
      .bind(organizationId, userId)
      .all<{ id: string; name: string; description: string | null; delivery: Delivery }>();
    return result.results;
  }

  return {
    async overview(): Promise<SiteOverview | null> {
      const draft = await draftRow();
      if (!draft) return null;
      const [liveRow, releases, services] = await Promise.all([
        db
          .prepare(
            `SELECT r.number, p.published_at AS publishedAt, r.draft_revision AS draftRevision
             FROM site_published p JOIN site_releases r ON r.site_id = p.site_id AND r.id = p.release_id
             WHERE p.site_id = ?3`,
          )
          .bind(organizationId, userId, draft.siteId)
          .first<{ number: number; publishedAt: string; draftRevision: number }>(),
        db
          .prepare(
            `SELECT r.id, r.number, r.created_at AS createdAt, au.name AS createdByName, r.draft_revision AS draftRevision,
                    EXISTS (SELECT 1 FROM site_published p WHERE p.site_id = r.site_id AND p.release_id = r.id) AS live
             FROM site_releases r LEFT JOIN auth_user au ON au.id = r.created_by
             WHERE r.site_id = ?3 AND ${reads} ORDER BY r.number DESC LIMIT 50`,
          )
          .bind(organizationId, userId, draft.siteId)
          .all<Omit<ReleaseRow, "live"> & { live: number }>(),
        liveServices(),
      ]);
      return {
        site: { id: draft.siteId, slug: draft.slug },
        draft: { content: siteContent.parse(JSON.parse(draft.content)), revision: draft.revision, updatedAt: draft.updatedAt },
        live: liveRow ?? null,
        releases: releases.results.map((r) => ({ ...r, live: r.live === 1 })),
        services: services.map((s) => ({ id: s.id, name: s.name, delivery: s.delivery })),
      };
    },

    /** The draft as the public page would show it, with the services resolved now. For the preview. */
    async preview(): Promise<{ slug: string; content: SiteContent } | null> {
      const draft = await draftRow();
      if (!draft) return null;
      const services = await liveServices();
      const content = siteContent.parse(JSON.parse(draft.content));
      return { slug: draft.slug, content: resolveServices(content, new Map(services.map((s) => [s.id, s]))) };
    },

    async create(raw: { slug: unknown; title: unknown }, now = new Date()): Promise<CreateSiteOutcome> {
      const slug = slugSchema.parse(raw.slug);
      const title = titleSchema.parse(raw.title);
      const siteId = crypto.randomUUID();
      const stamp = now.toISOString();
      const existing = await db
        .prepare("SELECT 1 AS ok FROM sites WHERE organization_id = ?")
        .bind(organizationId)
        .first();
      if (existing) return { status: "exists" };
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO sites (id, organization_id, slug, created_by, created_at, updated_at)
               SELECT ?3, ?1, ?4, ?2, ?5, ?5 WHERE ${writes}
                 AND NOT EXISTS (SELECT 1 FROM sites o WHERE o.organization_id = ?1)`,
            )
            .bind(organizationId, userId, siteId, slug, stamp),
          db
            .prepare(
              `INSERT INTO site_drafts (site_id, content, revision, updated_by, updated_at)
               SELECT ?1, ?2, 1, ?3, ?4 WHERE (SELECT changes()) > 0`,
            )
            .bind(siteId, JSON.stringify(starterContent(title)), userId, stamp),
          audit(SITE_CREATED, siteId, stamp),
        ]);
        return results[0].meta.changes > 0 ? { status: "created" } : { status: "forbidden" };
      } catch (error) {
        if (/UNIQUE/i.test(String(error)) && /slug/i.test(String(error))) return { status: "slug_taken" };
        throw error;
      }
    },

    /** Saves the draft if it is still the revision the person was looking at. Incomplete drafts are fine. */
    async saveDraft(raw: unknown, expectedRevision: number, now = new Date()): Promise<SaveDraftOutcome> {
      const content = siteContent.parse(raw);
      const result = await db
        .prepare(
          `UPDATE site_drafts SET content = ?3, revision = revision + 1, updated_by = ?2, updated_at = ?5
           WHERE revision = ?4 AND ${writes}
             AND site_id = (SELECT s.id FROM sites s WHERE s.organization_id = ?1)`,
        )
        .bind(organizationId, userId, JSON.stringify(content), expectedRevision, now.toISOString())
        .run();
      if (result.meta.changes > 0) return { status: "saved", revision: expectedRevision + 1 };
      const draft = await draftRow();
      return draft ? { status: "conflict" } : { status: "not_found" };
    },

    /** Changes the address while the page is not public: links already shared would break otherwise. */
    async changeSlug(rawSlug: unknown, now = new Date()): Promise<AddressOutcome> {
      const slug = slugSchema.parse(rawSlug);
      const draft = await draftRow();
      if (!draft) return { status: "not_found" };
      const isPublic = await db.prepare("SELECT 1 AS ok FROM site_published WHERE site_id = ?").bind(draft.siteId).first();
      if (isPublic) return { status: "public" };
      try {
        const results = await db.batch([
          db
            .prepare(
              `UPDATE sites SET slug = ?3, updated_at = ?4
               WHERE organization_id = ?1 AND ${writes} AND slug <> ?3
                 AND NOT EXISTS (SELECT 1 FROM site_published p WHERE p.site_id = sites.id)`,
            )
            .bind(organizationId, userId, slug, now.toISOString()),
          audit(SITE_ADDRESS_CHANGED, draft.siteId, now.toISOString()),
        ]);
        return results[0].meta.changes > 0 ? { status: "changed" } : { status: "not_found" };
      } catch (error) {
        if (/UNIQUE/i.test(String(error))) return { status: "slug_taken" };
        throw error;
      }
    },

    /**
     * Makes a release of the saved draft public. The draft must still be the revision the person saw, every
     * required field filled in and every service chosen still on offer; the services are written into the
     * release as they are now. The release and the pointer are written together or not at all.
     */
    async publish(expectedRevision: number, now = new Date()): Promise<PublishOutcome> {
      const draft = await draftRow();
      if (!draft) return { status: "not_found" };
      if (draft.revision !== expectedRevision) return { status: "conflict" };
      const content = siteContent.parse(JSON.parse(draft.content));
      const services = await liveServices();
      const live = new Map(services.map((s) => [s.id, s]));
      const issues = publishIssues(content, new Set(live.keys()));
      if (issues.length > 0) return { status: "invalid", issues };
      const json = JSON.stringify(resolveServices(content, live));
      const hash = await sha256Hex(json);
      const releaseId = crypto.randomUUID();
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO site_releases (id, site_id, number, draft_revision, content, content_sha256, created_by, created_at)
             SELECT ?3, s.id, (SELECT COALESCE(MAX(r.number), 0) + 1 FROM site_releases r WHERE r.site_id = s.id),
                    d.revision, ?4, ?5, ?2, ?6
             FROM sites s JOIN site_drafts d ON d.site_id = s.id
             WHERE s.organization_id = ?1 AND d.revision = ?7 AND ${writes}`,
          )
          .bind(organizationId, userId, releaseId, json, hash, stamp, expectedRevision),
        db
          .prepare(
            `INSERT INTO site_published (site_id, release_id, published_by, published_at)
             SELECT r.site_id, r.id, ?2, ?3 FROM site_releases r WHERE r.id = ?1 AND (SELECT changes()) > 0
             ON CONFLICT(site_id) DO UPDATE SET release_id = excluded.release_id,
               published_by = excluded.published_by, published_at = excluded.published_at`,
          )
          .bind(releaseId, userId, stamp),
        audit(SITE_PUBLISHED, releaseId, stamp),
      ]);
      if (results[0].meta.changes > 0) {
        const number = await db.prepare("SELECT number FROM site_releases WHERE id = ?").bind(releaseId).first<{ number: number }>();
        return { status: "published", number: number?.number ?? 0 };
      }
      const now2 = await draftRow();
      return now2 ? { status: "conflict" } : { status: "not_found" };
    },

    /** Takes the page offline. The releases stay; publishing again makes a new one. */
    async unpublish(now = new Date()): Promise<boolean> {
      const draft = await draftRow();
      if (!draft) return false;
      const results = await db.batch([
        db
          .prepare(
            `DELETE FROM site_published WHERE site_id = ?3
               AND EXISTS (SELECT 1 FROM sites s WHERE s.id = ?3 AND s.organization_id = ?1) AND ${writes}`,
          )
          .bind(organizationId, userId, draft.siteId),
        audit(SITE_UNPUBLISHED, draft.siteId, now.toISOString()),
      ]);
      return results[0].meta.changes > 0;
    },

    /** Brings an earlier release back as the draft (a new revision). Nothing public changes until it is published. */
    async restore(releaseId: string, expectedRevision: number, now = new Date()): Promise<RestoreOutcome> {
      const draft = await draftRow();
      if (!draft) return { status: "not_found" };
      const release = await db
        .prepare(
          `SELECT r.content FROM site_releases r JOIN sites s ON s.id = r.site_id
           WHERE r.id = ?3 AND s.organization_id = ?1 AND ${reads}`,
        )
        .bind(organizationId, userId, releaseId)
        .first<{ content: string }>();
      if (!release) return { status: "not_found" };
      const content = withoutResolvedServices(siteContent.parse(JSON.parse(release.content)));
      const result = await db
        .prepare(
          `UPDATE site_drafts SET content = ?3, revision = revision + 1, updated_by = ?2, updated_at = ?5
           WHERE revision = ?4 AND ${writes}
             AND site_id = (SELECT s.id FROM sites s WHERE s.organization_id = ?1)`,
        )
        .bind(organizationId, userId, JSON.stringify(content), expectedRevision, now.toISOString())
        .run();
      return result.meta.changes > 0 ? { status: "restored", revision: expectedRevision + 1 } : { status: "conflict" };
    },
  };
}

/**
 * The public reading: no session, nothing but a published release. An unknown address, a page that was never
 * published and one taken offline all answer the same (null). Nothing of the organization is returned.
 */
export async function publishedSiteBySlug(db: D1Database, rawSlug: string): Promise<PublicSite | null> {
  const slug = slugSchema.safeParse(rawSlug);
  if (!slug.success) return null;
  const row = await db
    .prepare(
      `SELECT s.slug, r.number, r.content, p.published_at AS publishedAt
       FROM sites s
       JOIN site_published p ON p.site_id = s.id
       JOIN site_releases r ON r.site_id = p.site_id AND r.id = p.release_id
       WHERE s.slug = ?`,
    )
    .bind(slug.data)
    .first<{ slug: string; number: number; content: string; publishedAt: string }>();
  if (!row) return null;
  let parsed;
  try {
    parsed = siteContent.safeParse(JSON.parse(row.content));
  } catch {
    return null;
  }
  return parsed.success ? { slug: row.slug, number: row.number, publishedAt: row.publishedAt, content: parsed.data } : null;
}
