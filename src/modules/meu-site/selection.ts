import { allNodes, type SiteContent } from "./contracts";
import type { LayoutNode, Rect } from "./drop-geometry";
import { rangeBetween } from "./editor-model";

/**
 * Which blocks are selected. The selection is a list: the **last** one is the block the panel shows and the handles sit on (the primary), and what a
 * click with Ctrl/Cmd or Shift adds or takes away is the rest. Everything here is a function of the list and the document, so the screen only asks.
 */

/** The ones of the list that are in the document, each once, in the order they were chosen. */
export function reconcile(content: SiteContent, ids: readonly string[]): string[] {
  const there = new Set(allNodes(content.blocks).map((entry) => entry.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!there.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The primary: the block chosen last. */
export const primaryOf = (ids: readonly string[]): string | null => ids[ids.length - 1] ?? null;

/** A click with Ctrl or Cmd: the block is added (and becomes the primary), or, when it was already there, taken away. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

/** A click with Shift in a list: every block between the `anchor` (the primary, the one chosen last before this click) and this one when they are in the same place; otherwise this one alone. The clicked one is the primary. */
export function selectRange(content: SiteContent, anchor: string | null, to: string): string[] {
  const range = anchor ? rangeBetween(content, anchor, to) : [to];
  return [...range.filter((id) => id !== to), to];
}

// ---- a rectangle drawn on the page ----

export interface Point {
  x: number;
  y: number;
}
export const rectBetween = (a: Point, b: Point): Rect => ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) });
const touches = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const holds = (outer: Rect, inner: Rect) => outer.left <= inner.left && outer.right >= inner.right && outer.top <= inner.top && outer.bottom >= inner.bottom;

/**
 * What a rectangle drawn on the page picks: it goes into the container that holds the whole rectangle (as many levels down as there are), and picks
 * the blocks of that level that it touches, in the order of the document. Drawn on the page's own empty space it picks the blocks of the page it
 * touches; drawn inside a row it picks the columns it touches. A block that takes no room is never picked.
 */
export function marqueeSelect(page: LayoutNode, area: Rect): string[] {
  let level = page;
  for (;;) {
    const inside = level.children.find((child) => !child.hidden && child.holds && child.id !== null && holds(child.rect, area));
    if (!inside) break;
    level = inside;
  }
  return level.children.filter((child) => !child.hidden && child.id !== null && touches(child.rect, area)).map((child) => child.id as string);
}
