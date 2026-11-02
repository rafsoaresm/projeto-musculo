/**
 * The sections of a page in the Editor Guiado (0.64, the user's request of 02/11/2026): add one from a short list, move it up or down, hide it from
 * the site and show it again, and delete it. Pure; the header and the footer of the site are not sections of the page and are not touched here.
 * Hiding is the style's own `hidden` (the same the visual editor writes), on every size, so the visitor's page leaves it out and it can come back.
 */
import { MAX_BLOCKS, MAX_SITE_NODES, allNodes, hiddenEverywhere, pageContent, siteNodeCount, swapPage, type SiteContent, type SiteNode } from "./contracts";
import { GUIDED_SECTIONS } from "./site-kits";
import { pruneMenu } from "./guided-menu";

export type SectionRefusal = "unknown" | "page-full" | "site-full";
export const SECTION_REFUSAL_MESSAGE: Record<SectionRefusal, string> = {
  unknown: "Essa seção não está na lista.",
  "page-full": `A página já tem ${MAX_BLOCKS} seções, o máximo. Tire uma antes de acrescentar outra.`,
  "site-full": `O site chegou ao limite de ${MAX_SITE_NODES} partes. Tire uma seção ou uma página antes de acrescentar outra.`,
};
export type SectionOutcome = { ok: true; content: SiteContent; id: string } | { ok: false; reason: SectionRefusal };

/** The page's blocks changed by `change`, written back into the document (the home page or another page). */
function onPage(content: SiteContent, pageId: string, change: (blocks: SiteNode[]) => SiteNode[] | null): SiteContent {
  const swapped = swapPage(content, pageId);
  const next = change(swapped.blocks);
  return next === null ? content : swapPage({ ...swapped, blocks: next }, pageId);
}

/** A new section of the list, after the one given (at the end of the page when none, or when that one is not on the page). */
export function addSection(content: SiteContent, pageId: string, key: string, after: string | null = null): SectionOutcome {
  const item = GUIDED_SECTIONS.find((entry) => entry.key === key);
  if (!item) return { ok: false, reason: "unknown" };
  const blocks = pageContent(content, pageId).blocks;
  if (blocks.length >= MAX_BLOCKS) return { ok: false, reason: "page-full" };
  const section = item.create();
  if (siteNodeCount(content) + allNodes([section]).length > MAX_SITE_NODES) return { ok: false, reason: "site-full" };
  const at = after === null ? -1 : blocks.findIndex((entry) => entry.id === after);
  const index = at < 0 ? blocks.length : at + 1;
  return { ok: true, id: section.id, content: onPage(content, pageId, (list) => [...list.slice(0, index), section, ...list.slice(index)]) };
}

/** One place up (-1) or down (1); the same document when it cannot move. */
export function moveSection(content: SiteContent, pageId: string, id: string, by: -1 | 1): SiteContent {
  return onPage(content, pageId, (list) => {
    const from = list.findIndex((entry) => entry.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= list.length) return null;
    const next = [...list];
    [next[from], next[to]] = [next[to]!, next[from]!];
    return next;
  });
}

/** Out of the page (undo brings it back); the same document when it is not there. */
export function removeSection(content: SiteContent, pageId: string, id: string): SiteContent {
  const next = onPage(content, pageId, (list) => (list.some((entry) => entry.id === id) ? list.filter((entry) => entry.id !== id) : null));
  // A link of the header's menu to it goes with it.
  return next === content ? content : pruneMenu(next);
}

/** Whether a section is hidden from the site: hidden on the computer and not shown again on a smaller size. */
export const isHiddenSection = (node: SiteNode): boolean => hiddenEverywhere(node);

const without = <T extends object>(style: T | undefined, key: keyof T): T | undefined => {
  if (!style || !(key in style)) return style;
  const rest = { ...style };
  delete rest[key];
  return rest;
};

/** Hidden from the site on every size, or shown on every size again. */
export function setSectionHidden(content: SiteContent, pageId: string, id: string, hidden: boolean): SiteContent {
  return onPage(content, pageId, (list) => {
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0 || isHiddenSection(list[index]!) === hidden) return null;
    const node = list[index]!;
    const style = hidden ? { ...(node.style ?? {}), hidden: true } : without(node.style, "hidden");
    const changed = { ...node, style, styleTablet: without(node.styleTablet, "hidden"), styleMobile: without(node.styleMobile, "hidden") } as SiteNode;
    // A style left empty is taken out, so a section hidden and shown again is the section it was.
    for (const key of ["style", "styleTablet", "styleMobile"] as const) {
      const value = changed[key];
      if (value === undefined || Object.keys(value).length === 0) delete changed[key];
    }
    const next = [...list];
    next[index] = changed;
    return next;
  });
}
