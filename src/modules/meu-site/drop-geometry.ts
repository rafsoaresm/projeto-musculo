import type { Slot } from "./editor-model";

/**
 * Where a dragged block lands, from the layout of the page as it is drawn. The canvas reads the rectangles of the nodes
 * from the page's own elements (so a row, a column, a grid or a stack are whatever the style made them) and this decides,
 * from the pointer alone, which container the block goes into and at which position: no knowledge of CSS here, only of
 * rectangles, which is what makes it testable. It does not look at what may be dropped where; the editor checks that with
 * the model and shows no line when the answer is no.
 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/**
 * A node as drawn: `id` is null for the page itself, `holds` says whether it may have children, `children` are in the order of the document.
 * A node that takes no room at this size of the screen (hidden) is still in the list, so the positions stay those of the document, but it is
 * never a place to drop next to, and it does not decide whether its siblings are in a row.
 */
export interface LayoutNode {
  id: string | null;
  rect: Rect;
  holds: boolean;
  hidden?: boolean;
  children: LayoutNode[];
}
export interface Landing {
  slot: Slot;
  /** A thin rectangle to draw where the block would land between two siblings, or null. */
  line: Rect | null;
  /** The container to outline when the block would land inside an empty one, or null. */
  box: Rect | null;
}

const THICKNESS = 4;
const contains = (rect: Rect, x: number, y: number) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
const width = (rect: Rect) => rect.right - rect.left;
const height = (rect: Rect) => rect.bottom - rect.top;
const centerX = (rect: Rect) => (rect.left + rect.right) / 2;
const centerY = (rect: Rect) => (rect.top + rect.bottom) / 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** How far the point is from the rectangle: 0 inside it. */
function distance(rect: Rect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

/**
 * Whether siblings are laid out side by side ("x": a row, a wrapped row, a grid) or one under the other ("y"): they are
 * side by side when two of them share most of their height.
 */
export function flowOf(all: readonly LayoutNode[]): "x" | "y" {
  const siblings = all.filter((entry) => !entry.hidden);
  for (let at = 0; at < siblings.length; at++) {
    for (let next = at + 1; next < siblings.length; next++) {
      const a = siblings[at].rect;
      const b = siblings[next].rect;
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap > Math.min(height(a), height(b)) / 2 && overlap > 0) return "x";
    }
  }
  return "y";
}

function lineFor(rect: Rect, before: boolean, flow: "x" | "y"): Rect {
  if (flow === "x") {
    const at = before ? rect.left : rect.right;
    return { left: at - THICKNESS / 2, right: at + THICKNESS / 2, top: rect.top, bottom: rect.bottom };
  }
  const at = before ? rect.top : rect.bottom;
  return { left: rect.left, right: rect.right, top: at - THICKNESS / 2, bottom: at + THICKNESS / 2 };
}

/** Before or after the sibling at `index`, by which half of it the pointer is in along the flow of the siblings. */
function around(siblings: readonly LayoutNode[], index: number, parent: string | null, x: number, y: number): Landing {
  const flow = flowOf(siblings);
  const target = siblings[index].rect;
  const before = flow === "x" ? x < centerX(target) : y < centerY(target);
  return { slot: { parent, index: before ? index : index + 1 }, line: lineFor(target, before, flow), box: null };
}

/** Among the children of a container, next to the one the pointer is nearest to. */
function amongChildren(children: readonly LayoutNode[], parent: string | null, pageRect: Rect, x: number, y: number): Landing {
  if (children.every((child) => child.hidden)) return { slot: { parent, index: children.length }, line: null, box: pageRect };
  let nearest = 0;
  let best = Infinity;
  children.forEach((child, at) => {
    if (child.hidden) return;
    const d = distance(child.rect, x, y);
    if (d < best) {
      best = d;
      nearest = at;
    }
  });
  return around(children, nearest, parent, x, y);
}

/** The node under the point, deepest first, from the page down. */
function pathAt(page: LayoutNode, x: number, y: number): LayoutNode[] {
  const path = [page];
  let current = page;
  for (;;) {
    const inside = current.children.find((child) => !child.hidden && contains(child.rect, x, y));
    if (!inside) return path;
    path.push(inside);
    current = inside;
  }
}

/**
 * The landing for a pointer at (x, y). Over a node that is not a container: before or after it. Over a container: inside
 * it, among its children (or in it, when it is empty), except near its own border, where it is before or after the
 * container itself, so there is always a way to drop beside a container as well as into it.
 */
export function landingAt(page: LayoutNode, x: number, y: number): Landing {
  const path = pathAt(page, x, y);
  const hit = path[path.length - 1];
  if (path.length === 1) return amongChildren(page.children, null, page.rect, x, y);
  const parent = path[path.length - 2];
  const index = parent.children.indexOf(hit);
  if (hit.holds) {
    const edge = clamp(Math.min(width(hit.rect), height(hit.rect)) * 0.18, 5, 14);
    const nearBorder = x < hit.rect.left + edge || x > hit.rect.right - edge || y < hit.rect.top + edge || y > hit.rect.bottom - edge;
    if (!nearBorder) return amongChildren(hit.children, hit.id, hit.rect, x, y);
  }
  return around(parent.children, index, parent.id, x, y);
}
