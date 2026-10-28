/**
 * Where the page is on the canvas of the editor: the frames of the sizes of the screen sit side by side in a "world" that
 * can be zoomed and moved, as in the builders people know. The world is drawn at `scale`, with its top-left corner at
 * (`x`, `y`) of the canvas, so a point of the world at (wx, wy) is at (x + wx * scale, y + wy * scale) on the screen.
 * Everything here is arithmetic on numbers; the screen only applies the result.
 */
export interface View {
  scale: number;
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
/** One step of the zoom buttons and keys. */
export const SCALE_STEP = 0.1;

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
const round2 = (value: number) => Math.round(value * 100) / 100;

/** The view zoomed to `scale` so that the point of the world that is under (px, py) stays under it. */
export function zoomAt(view: View, scale: number, px: number, py: number): View {
  const next = clampScale(scale);
  const worldX = (px - view.x) / view.scale;
  const worldY = (py - view.y) / view.scale;
  return { scale: next, x: px - worldX * next, y: py - worldY * next };
}

/** The scale after a turn of the wheel (with the control key, or a pinch): proportional, and gentler for the big steps of a mouse wheel. */
export function wheelScale(scale: number, deltaY: number): number {
  const sensitivity = Math.abs(deltaY) > 30 ? 0.001 : 0.008;
  return clampScale(scale - deltaY * sensitivity * scale);
}

/** The view after a button step: a tenth more or less, on a round number. */
export const steppedScale = (scale: number, direction: 1 | -1): number => clampScale(round2(scale + direction * SCALE_STEP));

/** The view moved so the content goes by (dx, dy) on the screen. */
export const moveBy = (view: View, dx: number, dy: number): View => ({ ...view, x: view.x + dx, y: view.y + dy });

/**
 * The view that shows the whole width of the world in the canvas, centered, with `margin` on the sides and `top` above (room for the names of
 * the frames). Never larger than life: a page narrower than the canvas is shown at its real size.
 */
export function fitView(canvas: Size, world: Size, margin = 32, top = 72): View {
  if (canvas.width <= 0 || world.width <= 0) return { scale: 1, x: 0, y: top };
  const scale = clampScale(Math.min(1, (canvas.width - margin * 2) / world.width));
  return { scale, x: (canvas.width - world.width * scale) / 2, y: top };
}

/** The same scale at 100%, with the world centered across the canvas. */
export function actualSize(canvas: Size, world: Size, top = 72): View {
  return { scale: 1, x: (canvas.width - world.width) / 2, y: top };
}

/**
 * The view moved as little as needed for `box` (a rectangle on the screen, in the canvas's coordinates) to be inside the canvas, with `margin` around it. A box too
 * big for the canvas is lined up with its top-left corner.
 */
export function reveal(view: View, box: Box, canvas: Size, margin = 24): View {
  const shift = (low: number, high: number, size: number): number => {
    if (high - low > size - margin * 2) return margin - low;
    if (low < margin) return margin - low;
    if (high > size - margin) return size - margin - high;
    return 0;
  };
  return moveBy(view, shift(box.left, box.right, canvas.width), shift(box.top, box.bottom, canvas.height));
}

export const percent = (scale: number): number => Math.round(scale * 100);
