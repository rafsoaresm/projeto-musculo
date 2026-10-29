import type { Box } from "./canvas-view";
import { SPECS } from "./style";

/**
 * The arithmetic of the handles over the selected block: dragging an edge to size it, the inside of an edge to change its padding, the
 * space between two blocks to change the gap, the corner to change the rounding. A pointer moves by screen pixels; the page is drawn at a
 * zoom, so a movement is first brought back to the page's own pixels (`unscale`). What comes out is always a whole number of pixels inside
 * the range the style accepts (SPECS), so what a handle writes is never refused by the server. Nothing here knows about the screen.
 */

export type Edge = "top" | "right" | "bottom" | "left";
export type Range = readonly [number, number];

/** A movement of the pointer, in the page's own pixels. */
export const unscale = (screenDelta: number, scale: number): number => (scale > 0 ? screenDelta / scale : 0);

export const clampTo = (value: number, [low, high]: Range): number => Math.min(high, Math.max(low, value));
/** A whole number of pixels inside the range (a non-number, such as NaN, is the low end). */
export const whole = (value: number, range: Range): number => clampTo(Number.isFinite(value) ? Math.round(value) : range[0], range);

/** The least a handle takes a size to: a block dragged to nothing could not be taken hold of again. */
export const MIN_SIZE = 8;
const WIDTH: Range = [MIN_SIZE, SPECS.width.px[1]];
const HEIGHT: Range = [MIN_SIZE, SPECS.height.px[1]];

export const px = (amount: number): string => `${amount}px`;

// ---- size ----

/** A width or a height after the pointer moved by `delta` from the size it started at. */
export const widthFrom = (start: number, delta: number): number => whole(start + delta, WIDTH);
export const heightFrom = (start: number, delta: number): number => whole(start + delta, HEIGHT);

// ---- padding ----

/** How far the pointer went *into* the block when it was dragged from the given edge: the padding grows as the edge handle goes inward. */
export function inward(edge: Edge, dx: number, dy: number): number {
  switch (edge) {
    case "top":
      return dy;
    case "bottom":
      return -dy;
    case "left":
      return dx;
    case "right":
      return -dx;
  }
}
export const paddingFrom = (start: number, delta: number): number => whole(start + delta, SPECS.space.px);

export type SideMode = "one" | "opposite" | "all";
const OPPOSITE: Record<Edge, Edge> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];
/** The sides a padding handle changes: its own, with Alt also the one across, with Shift all four (as the builders people know do). */
export function sidesFor(edge: Edge, mode: SideMode): Edge[] {
  if (mode === "all") return [...EDGES];
  if (mode === "opposite") return EDGES.filter((side) => side === edge || side === OPPOSITE[edge]);
  return [edge];
}
export const sideMode = (modifiers: { shift: boolean; alt: boolean }): SideMode => (modifiers.shift ? "all" : modifiers.alt ? "opposite" : "one");

// ---- gap ----

export const gapFrom = (start: number, delta: number): number => whole(start + delta, SPECS.gap.px);

// ---- rounding ----

/**
 * The rounding after the corner handle moved by (dx, dy) from where it started: half the distance along the diagonal, so a block's corner follows
 * the handle. It cannot be more than half the shorter side (a pill), and never past the style's own limit.
 */
export function radiusFrom(start: number, dx: number, dy: number, size: { width: number; height: number }): number {
  const most = Math.min(SPECS.radius.px[1], Math.floor(Math.min(size.width, size.height) / 2));
  return whole(start + (dx + dy) / 2, [0, Math.max(0, most)]);
}

// ---- snapping ----

export interface Snap {
  /** The edge, moved onto the target when one is near enough. */
  edge: number;
  /** The target it was moved onto, to draw the guide; null when it moved free. */
  target: number | null;
}
/** Snaps `edge` to the nearest of the targets within `threshold`. */
export function snapEdge(edge: number, targets: readonly number[], threshold: number): Snap {
  let best: number | null = null;
  for (const target of targets) {
    if (Math.abs(target - edge) > threshold) continue;
    if (best === null || Math.abs(target - edge) < Math.abs(best - edge)) best = target;
  }
  return best === null ? { edge, target: null } : { edge: best, target: best };
}

/** The distance, in screen pixels, within which an edge snaps. */
export const SNAP_SCREEN_PX = 6;

/**
 * The lines an edge may snap to on one axis: the container's two sides and its middle, and the sides of the blocks that come before the one being
 * sized (the ones after it move when it grows, so their lines are not a place to stop). All in the same coordinates as the boxes given.
 */
export function alignmentTargets(axis: "x" | "y", container: Box, before: readonly Box[]): number[] {
  const low = axis === "x" ? container.left : container.top;
  const high = axis === "x" ? container.right : container.bottom;
  const lines = [low, (low + high) / 2, high];
  for (const box of before) lines.push(axis === "x" ? box.left : box.top, axis === "x" ? box.right : box.bottom);
  return [...new Set(lines.map((line) => Math.round(line * 100) / 100))];
}

// ---- the gap between two blocks ----

export interface Strip {
  /** "x": the blocks are side by side, and the gap is a vertical strip; "y": one above the other, and the strip is horizontal. */
  axis: "x" | "y";
  box: Box;
}
/**
 * Where to take hold of the gap between two neighbours: the space between them, at least `grip` wide so a gap of nothing can still be grabbed
 * (it is centered on the seam). Null when the second is not simply to the right of the first, or below it (a wrapped row has no single gap).
 */
export function gapStrip(a: Box, b: Box, grip = 10): Strip | null {
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  if (b.left >= a.right - 1 && overlapY > 0) {
    const middle = (a.right + b.left) / 2;
    const half = Math.max((b.left - a.right) / 2, grip / 2);
    return { axis: "x", box: { left: middle - half, right: middle + half, top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) } };
  }
  if (b.top >= a.bottom - 1 && overlapX > 0) {
    const middle = (a.bottom + b.top) / 2;
    const half = Math.max((b.top - a.bottom) / 2, grip / 2);
    return { axis: "y", box: { top: middle - half, bottom: middle + half, left: Math.max(a.left, b.left), right: Math.min(a.right, b.right) } };
  }
  return null;
}
