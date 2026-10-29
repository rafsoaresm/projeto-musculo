import { pageModel, section, type PageModel, type SiteModel } from "./page-models";
import {
  DESCRIPTION_MAX,
  HOME,
  MAX_PAGES,
  MAX_SITE_NODES,
  PAGE_TITLE_MAX,
  allNodes,
  documentNodes,
  mapNodes,
  newBlockId,
  pageById,
  pageSlug,
  pagesOf,
  siteNodeCount,
  starterContent,
  withEachNode,
  type PageDef,
  type SiteContent,
  type SiteNode,
} from "./contracts";

/**
 * What the visual editor does with the pages of a site, as functions on the document (no screen here, like editor-model.ts): adding a page, giving
 * it a title, an address and a description, putting it in the menu or out of it, moving, copying and deleting it. Every function gives a document that
 * the server accepts, or the reason it does not.
 *
 * The blocks of a page are changed by the functions of editor-model.ts, on the document as `swapPage` shows it. Nothing here touches them, except what
 * has to follow a page: a copy has new identifiers, and a deleted page is no longer where a button or a link goes.
 */
export type PageRefusal = "not-found" | "limit-pages" | "limit-site-nodes" | "invalid-address" | "address-taken";
export type PageOutcome = { ok: true; content: SiteContent; id: string } | { ok: false; reason: PageRefusal };

export const PAGE_REFUSAL_MESSAGE: Record<PageRefusal, string> = {
  "not-found": "Essa página não existe mais.",
  "limit-pages": `O site aceita até ${MAX_PAGES} páginas além da inicial.`,
  "limit-site-nodes": `O site aceita até ${MAX_SITE_NODES} blocos somando todas as páginas.`,
  "invalid-address": "O endereço usa letras minúsculas sem acento, números e hífen, sem hífen no começo ou no fim. O endereço “m” é reservado.",
  "address-taken": "Já há uma página com esse endereço.",
};

/** The address a title makes ("Planos e valores" → "planos-e-valores"), or "pagina" when nothing usable is left (or the address is reserved). */
export function slugFromTitle(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return pageSlug.safeParse(base).success ? base : "pagina";
}

/** An address that is no other page's: the wanted one, or with "-2", "-3"... after it. */
export function freeSlug(content: SiteContent, wanted: string, exceptId?: string): string {
  const taken = new Set(pagesOf(content).filter((entry) => entry.id !== exceptId).map((entry) => entry.slug));
  const base = pageSlug.safeParse(wanted).success ? wanted.trim().toLowerCase() : "pagina";
  if (!taken.has(base)) return base;
  for (let count = 2; count < 1000; count++) {
    const suffix = `-${count}`;
    const candidate = `${base.slice(0, 40 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

function withPages(content: SiteContent, list: readonly PageDef[]): SiteContent {
  const { pages: _previous, ...rest } = content;
  void _previous;
  return list.length > 0 ? { ...rest, pages: [...list] } : rest;
}
const change = (content: SiteContent, pageId: string, apply: (page: PageDef) => PageDef): SiteContent =>
  withPages(content, pagesOf(content).map((entry) => (entry.id === pageId ? apply(entry) : entry)));

// ---- adding one ----

/**
 * A new page with no blocks, in the menu, at the end. It has no title yet (the person writes it: nothing is invented, and a page with no title
 * stays out of the menu and is flagged when publishing) and an address that no other page has.
 */
export function addPage(content: SiteContent): PageOutcome {
  if (pagesOf(content).length >= MAX_PAGES) return { ok: false, reason: "limit-pages" };
  const page: PageDef = { id: newBlockId(), slug: freeSlug(content, "pagina"), title: "", description: "", blocks: [] };
  return { ok: true, content: withPages(content, [...pagesOf(content), page]), id: page.id };
}

/**
 * A new page that starts from a model (page-models.ts): the title of the model, the address it makes, and the blocks the model has. Refused when the
 * site has no room for another page or for its blocks.
 */
export function addPageFrom(content: SiteContent, modelKey: string): PageOutcome {
  const model = pageModel(modelKey);
  if (!model) return { ok: false, reason: "not-found" };
  if (pagesOf(content).length >= MAX_PAGES) return { ok: false, reason: "limit-pages" };
  const page = pageFromModel(content, model, newBlockId());
  if (siteNodeCount(content) + allNodes(page.blocks).length > MAX_SITE_NODES) return { ok: false, reason: "limit-site-nodes" };
  return { ok: true, content: withPages(content, [...pagesOf(content), page]), id: page.id };
}

/** A page made from a model, with an address no other page of the site has. */
export function pageFromModel(content: Pick<SiteContent, "pages">, model: PageModel, newId: string): PageDef {
  return { id: newId, slug: freeSlug(content as SiteContent, slugFromTitle(model.title)), title: model.title, description: "", blocks: model.build() };
}

/** The starter of a site model: the single page, or the home page with four more (the menu is made from their titles, in this order). */
export function starterOf(model: SiteModel, title: string): SiteContent {
  const single = starterContent(title);
  if (model === "single") return single;
  const [hero, ...rest] = single.blocks;
  let pages: PageDef[] = [];
  for (const key of ["about", "services", "faq", "contact"]) pages = [...pages, pageFromModel({ pages }, pageModel(key)!, newBlockId())];
  return { ...single, blocks: [hero, section("template-highlights"), ...rest], pages };
}

/** The same blocks with new identifiers, and the links to a block of the page following the copy. Components stay the site's (an instance is still one). */
function renewed(blocks: readonly SiteNode[]): SiteNode[] {
  const renamed = new Map<string, string>();
  const fresh = (entry: SiteNode): SiteNode => {
    const id = newBlockId();
    renamed.set(entry.id, id);
    const copy = { ...structuredClone(entry), id } as SiteNode;
    return copy.type === "box" ? { ...copy, children: (entry as Extract<SiteNode, { type: "box" }>).children.map(fresh) } : copy;
  };
  const copies = blocks.map(fresh);
  return mapNodes(copies, (entry) => {
    if ((entry.type !== "button" && entry.type !== "link") || !entry.anchor) return entry;
    const target = renamed.get(entry.anchor);
    const { anchor: dropped, ...rest } = entry;
    void dropped;
    return (target ? { ...rest, anchor: target } : rest) as SiteNode;
  });
}

/** A copy of a page, right after it: its blocks with new identifiers, a title that says it is a copy, and an address of its own. */
export function duplicatePage(content: SiteContent, pageId: string): PageOutcome {
  const from = pageById(content, pageId);
  if (!from) return { ok: false, reason: "not-found" };
  if (pagesOf(content).length >= MAX_PAGES) return { ok: false, reason: "limit-pages" };
  if (siteNodeCount(content) + allNodes(from.blocks).length > MAX_SITE_NODES) return { ok: false, reason: "limit-site-nodes" };
  const suffix = " (cópia)";
  const copy: PageDef = {
    ...from,
    id: newBlockId(),
    title: from.title === "" ? "" : `${from.title.slice(0, PAGE_TITLE_MAX - suffix.length)}${suffix}`,
    slug: freeSlug(content, `${from.slug}-copia`),
    blocks: renewed(from.blocks),
  };
  const list = [...pagesOf(content)];
  list.splice(list.findIndex((entry) => entry.id === pageId) + 1, 0, copy);
  return { ok: true, content: withPages(content, list), id: copy.id };
}

// ---- what a page says about itself ----

/**
 * The title of a page. The first title a page gets (it had none) also makes its address, as long as the person has not changed that: a page that
 * is already known by its address keeps it when it is renamed, so a link someone has does not break.
 */
export function setTitle(content: SiteContent, pageId: string, wanted: string): SiteContent {
  const page = pageById(content, pageId);
  if (!page) return content;
  const title = wanted.slice(0, PAGE_TITLE_MAX);
  if (title === page.title) return content;
  const unnamed = page.title.trim() === "" && /^pagina(-\d+)?$/.test(page.slug);
  return change(content, pageId, (entry) => ({ ...entry, title, ...(unnamed ? { slug: freeSlug(content, slugFromTitle(title), pageId) } : null) }));
}

/** The address of a page, or the reason it is not accepted (the document is not changed). */
export function setSlug(content: SiteContent, pageId: string, wanted: string): PageOutcome {
  const page = pageById(content, pageId);
  if (!page) return { ok: false, reason: "not-found" };
  const parsed = pageSlug.safeParse(wanted);
  if (!parsed.success) return { ok: false, reason: "invalid-address" };
  if (pagesOf(content).some((entry) => entry.id !== pageId && entry.slug === parsed.data)) return { ok: false, reason: "address-taken" };
  return { ok: true, content: parsed.data === page.slug ? content : change(content, pageId, (entry) => ({ ...entry, slug: parsed.data })), id: pageId };
}

export const setDescription = (content: SiteContent, pageId: string, wanted: string): SiteContent =>
  pageById(content, pageId) ? change(content, pageId, (entry) => ({ ...entry, description: wanted.slice(0, DESCRIPTION_MAX) })) : content;

/** In the menu or out of it (a page out of it is still reached by its address and by the buttons that go to it). */
export function setInMenu(content: SiteContent, pageId: string, inMenu: boolean): SiteContent {
  if (!pageById(content, pageId)) return content;
  return change(content, pageId, (entry) => {
    const { inMenu: _previous, ...rest } = entry;
    void _previous;
    return inMenu ? rest : { ...rest, inMenu: false };
  });
}

// ---- order and removal ----

/** One place up or down the list (the order of the menu). The same document at the edge. */
export function movePage(content: SiteContent, pageId: string, by: -1 | 1): SiteContent {
  const list = [...pagesOf(content)];
  const at = list.findIndex((entry) => entry.id === pageId);
  const to = at + by;
  if (at < 0 || to < 0 || to >= list.length) return content;
  [list[at], list[to]] = [list[to], list[at]];
  return withPages(content, list);
}

/** How many buttons and links of the site go to the page (so deleting it can say what it leaves without a destination). */
export const linksTo = (content: SiteContent, pageId: string): number =>
  documentNodes(content).filter((entry) => (entry.type === "button" || entry.type === "link") && entry.page === pageId).length;

/** A page taken out of the site, with its blocks. The buttons and links that went to it are left with no destination (they are flagged when publishing). */
export function deletePage(content: SiteContent, pageId: string): PageOutcome {
  if (!pageById(content, pageId)) return { ok: false, reason: "not-found" };
  const without = withPages(content, pagesOf(content).filter((entry) => entry.id !== pageId));
  const cleaned = withEachNode(without, (entry) => {
    if ((entry.type !== "button" && entry.type !== "link") || entry.page !== pageId) return entry;
    const { page: dropped, ...rest } = entry;
    void dropped;
    return rest as SiteNode;
  });
  return { ok: true, content: cleaned, id: pageId };
}

/** The pages as a person picks one from a list: the home page first, then the others in the order of the menu. */
export const pageChoices = (content: SiteContent, homeLabel: string): Array<{ id: string; label: string }> => [
  { id: HOME, label: homeLabel },
  ...pagesOf(content).map((entry) => ({ id: entry.id, label: entry.title || `Página sem título (${entry.slug})` })),
];
