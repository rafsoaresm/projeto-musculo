import { describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE, actualSize, clampScale, fitView, moveBy, percent, reveal, steppedScale, wheelScale, zoomAt, type View } from "@/modules/meu-site/canvas-view";

const point = (view: View, wx: number, wy: number) => ({ x: view.x + wx * view.scale, y: view.y + wy * view.scale });

describe("the zoom of the canvas", () => {
  it("keeps the point under the pointer where it is", () => {
    const view: View = { scale: 0.5, x: 100, y: 40 };
    const [px, py] = [320, 210];
    const worldX = (px - view.x) / view.scale;
    const worldY = (py - view.y) / view.scale;
    for (const scale of [0.25, 0.8, 1, 2, 3.5]) {
      const next = zoomAt(view, scale, px, py);
      expect(next.scale).toBeCloseTo(scale, 10);
      const where = point(next, worldX, worldY);
      expect(where.x).toBeCloseTo(px, 8);
      expect(where.y).toBeCloseTo(py, 8);
    }
  });
  it("stays between the smallest and the largest scale, and still keeps the point there", () => {
    const view: View = { scale: 1, x: 0, y: 0 };
    expect(zoomAt(view, 100, 50, 50).scale).toBe(MAX_SCALE);
    expect(zoomAt(view, 0.0001, 50, 50).scale).toBe(MIN_SCALE);
    expect(clampScale(-3)).toBe(MIN_SCALE);
    const clamped = zoomAt({ scale: 1, x: 10, y: 20 }, 100, 60, 70);
    expect(point(clamped, (60 - 10) / 1, (70 - 20) / 1).x).toBeCloseTo(60, 8);
  });
  it("turns the wheel into a proportional change, gentler for the big steps of a mouse", () => {
    expect(wheelScale(1, 10)).toBeCloseTo(1 - 10 * 0.008, 10);
    expect(wheelScale(1, -10)).toBeCloseTo(1 + 10 * 0.008, 10);
    expect(wheelScale(1, 100)).toBeCloseTo(1 - 100 * 0.001, 10);
    expect(wheelScale(0.5, 10)).toBeCloseTo(0.5 - 10 * 0.008 * 0.5, 10);
    expect(wheelScale(MIN_SCALE, 1000)).toBe(MIN_SCALE);
    expect(wheelScale(MAX_SCALE, -1000)).toBe(MAX_SCALE);
    expect(wheelScale(1, 0)).toBe(1);
  });
  it("steps by a tenth, on round numbers, and stops at the limits", () => {
    expect(steppedScale(0.55, 1)).toBe(0.65);
    expect(steppedScale(0.55, -1)).toBe(0.45);
    expect(steppedScale(0.14, -1)).toBe(MIN_SCALE);
    expect(steppedScale(3.95, 1)).toBe(MAX_SCALE);
    expect(steppedScale(1, 1)).toBe(1.1);
  });
  it("says the scale as a whole percent", () => {
    expect(percent(0.554)).toBe(55);
    expect(percent(1)).toBe(100);
    expect(percent(0.1)).toBe(10);
  });
});

describe("moving and fitting the canvas", () => {
  it("moves the content by what the hand moved", () => {
    expect(moveBy({ scale: 0.5, x: 10, y: 20 }, -30, 5)).toEqual({ scale: 0.5, x: -20, y: 25 });
  });
  it("fits the width of the world in the canvas, centered, with room above for the names of the frames", () => {
    const view = fitView({ width: 1000, height: 700 }, { width: 2000, height: 3000 });
    expect(view.scale).toBeCloseTo((1000 - 64) / 2000, 10);
    expect(view.x).toBeCloseTo((1000 - 2000 * view.scale) / 2, 10);
    expect(view.y).toBe(72);
    // The world's two edges are at the same distance from the sides of the canvas.
    expect(view.x).toBeCloseTo(1000 - (view.x + 2000 * view.scale), 8);
  });
  it("never shows a page larger than life, and centers a narrow one", () => {
    const view = fitView({ width: 2000, height: 900 }, { width: 800, height: 1000 });
    expect(view.scale).toBe(1);
    expect(view.x).toBe(600);
  });
  it("does not break on a canvas or a world with no width yet", () => {
    expect(fitView({ width: 0, height: 0 }, { width: 800, height: 1000 })).toEqual({ scale: 1, x: 0, y: 72 });
    expect(fitView({ width: 800, height: 600 }, { width: 0, height: 0 })).toEqual({ scale: 1, x: 0, y: 72 });
    expect(fitView({ width: 20, height: 600 }, { width: 800, height: 1000 }).scale).toBe(MIN_SCALE);
  });
  it("shows the page at its real size, centered", () => {
    expect(actualSize({ width: 1000, height: 700 }, { width: 400, height: 900 })).toEqual({ scale: 1, x: 300, y: 72 });
  });
});

describe("bringing a block into view", () => {
  const view: View = { scale: 0.5, x: 0, y: 0 };
  const canvas = { width: 800, height: 600 };
  it("does nothing for a block that is inside, with room around it", () => {
    expect(reveal(view, { left: 100, top: 100, right: 300, bottom: 200 }, canvas)).toEqual(view);
  });
  it("moves the least that puts a block that sticks out inside, on each side", () => {
    expect(reveal(view, { left: 100, top: 560, right: 300, bottom: 700 }, canvas)).toEqual({ ...view, y: -(700 - (600 - 24)) });
    expect(reveal(view, { left: 100, top: -80, right: 300, bottom: 0 }, canvas)).toEqual({ ...view, y: 24 + 80 });
    expect(reveal(view, { left: 700, top: 100, right: 900, bottom: 200 }, canvas)).toEqual({ ...view, x: -(900 - (800 - 24)) });
    expect(reveal(view, { left: -50, top: 100, right: 100, bottom: 200 }, canvas)).toEqual({ ...view, x: 24 + 50 });
  });
  it("lines a block that is bigger than the canvas up by its top-left corner", () => {
    const moved = reveal(view, { left: -300, top: 900, right: 2000, bottom: 5000 }, canvas);
    expect(moved.x).toBe(24 + 300);
    expect(moved.y).toBe(24 - 900);
  });
});
