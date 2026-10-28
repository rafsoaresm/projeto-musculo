import { describe, expect, it } from "vitest";
import { flowOf, landingAt, type LayoutNode, type Rect } from "@/modules/meu-site/drop-geometry";

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });
const leaf = (id: string, r: Rect): LayoutNode => ({ id, rect: r, holds: false, children: [] });
const box = (id: string, r: Rect, children: LayoutNode[] = []): LayoutNode => ({ id, rect: r, holds: true, children });
const page = (children: LayoutNode[], r = rect(0, 0, 400, 1000)): LayoutNode => ({ id: null, rect: r, holds: true, children });
const where = (node: LayoutNode, x: number, y: number) => {
  const landing = landingAt(node, x, y);
  return `${landing.slot.parent ?? "page"}@${landing.slot.index}`;
};

describe("which way siblings are laid out", () => {
  it("says side by side when two share most of their height, in a row, in a wrapped row and in a grid, and one under the other otherwise", () => {
    expect(flowOf([leaf("a", rect(0, 0, 100, 50)), leaf("b", rect(110, 0, 200, 50))])).toBe("x");
    expect(flowOf([leaf("a", rect(0, 0, 100, 50)), leaf("b", rect(0, 60, 100, 110))])).toBe("y");
    expect(flowOf([leaf("a", rect(0, 0, 100, 50)), leaf("b", rect(110, 0, 200, 50)), leaf("c", rect(0, 60, 100, 110))])).toBe("x");
    expect(flowOf([leaf("a", rect(0, 0, 100, 100)), leaf("b", rect(110, 90, 200, 190))])).toBe("y");
    expect(flowOf([leaf("a", rect(0, 0, 100, 50))])).toBe("y");
    expect(flowOf([])).toBe("y");
  });
});

describe("where a dragged block lands", () => {
  const stack = () => page([leaf("a", rect(0, 0, 400, 100)), leaf("b", rect(0, 100, 400, 200)), leaf("c", rect(0, 200, 400, 300))]);
  it("goes before or after a block that is not a container, by the half of it the pointer is in", () => {
    expect(where(stack(), 200, 20)).toBe("page@0");
    expect(where(stack(), 200, 80)).toBe("page@1");
    expect(where(stack(), 200, 120)).toBe("page@1");
    expect(where(stack(), 200, 180)).toBe("page@2");
    expect(where(stack(), 200, 290)).toBe("page@3");
  });
  it("draws the line at the edge of the block it goes next to, across its width", () => {
    const before = landingAt(stack(), 200, 120);
    expect(before.line).toEqual(rect(0, 98, 400, 102));
    expect(before.box).toBeNull();
    const after = landingAt(stack(), 200, 180);
    expect(after.line).toEqual(rect(0, 198, 400, 202));
  });
  it("goes among the nearest blocks when the pointer is in a gap of the page, and into an empty page", () => {
    const gaps = page([leaf("a", rect(20, 20, 380, 100)), leaf("b", rect(20, 140, 380, 220))]);
    expect(where(gaps, 200, 120)).toBe("page@1");
    expect(where(gaps, 200, 125)).toBe("page@1");
    expect(where(gaps, 200, 5)).toBe("page@0");
    expect(where(gaps, 200, 900)).toBe("page@2");
    const empty = landingAt(page([]), 100, 100);
    expect(empty.slot).toEqual({ parent: null, index: 0 });
    expect(empty.box).toEqual(rect(0, 0, 400, 1000));
    expect(empty.line).toBeNull();
  });
  it("lands inside a container, among its children, and beside them in a row by the half of the child in the x direction", () => {
    const row = box("row", rect(0, 0, 400, 100), [leaf("a", rect(10, 10, 130, 90)), leaf("b", rect(140, 10, 260, 90)), leaf("c", rect(270, 10, 390, 90))]);
    const p = page([row]);
    expect(where(p, 150, 50)).toBe("row@1");
    expect(where(p, 250, 50)).toBe("row@2");
    expect(where(p, 20, 50)).toBe("row@0");
    expect(where(p, 380, 50)).toBe("row@3");
    const line = landingAt(p, 150, 50).line!;
    expect(line.left).toBeLessThan(140);
    expect(line.right).toBeGreaterThan(138);
    expect(line.top).toBe(10);
    expect(line.bottom).toBe(90);
    expect(line.right - line.left).toBe(4);
    // After a block of a row: the line is at its right edge.
    const after = landingAt(p, 250, 50).line!;
    expect(after).toEqual(rect(258, 10, 262, 90));
  });
  it("lands in a gap between two children of a container, next to the nearer one", () => {
    const row = box("row", rect(0, 0, 400, 100), [leaf("a", rect(20, 20, 150, 80)), leaf("b", rect(250, 20, 380, 80))]);
    expect(where(page([row]), 175, 50)).toBe("row@1");
    expect(where(page([row]), 230, 50)).toBe("row@1");
    expect(where(page([row]), 215, 50)).toBe("row@1");
  });
  it("lands inside an empty container, outlining it", () => {
    const p = page([box("c", rect(20, 20, 380, 120))]);
    const landing = landingAt(p, 200, 70);
    expect(landing.slot).toEqual({ parent: "c", index: 0 });
    expect(landing.box).toEqual(rect(20, 20, 380, 120));
    expect(landing.line).toBeNull();
  });
  it("lands beside a container, not inside it, when the pointer is near its border", () => {
    const c = box("c", rect(20, 100, 380, 300), [leaf("x", rect(30, 110, 370, 290))]);
    const p = page([leaf("a", rect(0, 0, 400, 100)), c, leaf("z", rect(0, 300, 400, 400))]);
    expect(where(p, 200, 104)).toBe("page@1");
    expect(where(p, 200, 296)).toBe("page@2");
    expect(where(p, 200, 200)).toBe("c@1");
    expect(where(p, 200, 150)).toBe("c@0");
  });
  it("goes down into containers inside containers, as deep as the pointer is", () => {
    const column = box("col", rect(20, 20, 190, 180), [leaf("p1", rect(30, 30, 180, 80)), leaf("p2", rect(30, 90, 180, 170))]);
    const other = box("col2", rect(210, 20, 380, 180));
    const row = box("row", rect(0, 0, 400, 200), [column, other]);
    const p = page([row]);
    expect(where(p, 100, 40)).toBe("col@0");
    expect(where(p, 100, 60)).toBe("col@1");
    expect(where(p, 100, 160)).toBe("col@2");
    expect(where(p, 300, 100)).toBe("col2@0");
    expect(where(p, 205, 100)).toBe("row@1");
    expect(where(p, 195, 100)).toBe("row@1");
  });
  it("puts the line between the columns of a row when the pointer is on the border of one, using the row's own direction", () => {
    const left = box("left", rect(10, 10, 190, 190), [leaf("x", rect(20, 20, 180, 180))]);
    const right = box("right", rect(210, 10, 390, 190), [leaf("y", rect(220, 20, 380, 180))]);
    const p = page([box("row", rect(0, 0, 400, 200), [left, right])]);
    expect(where(p, 14, 100)).toBe("row@0");
    expect(where(p, 386, 100)).toBe("row@2");
    expect(where(p, 186, 100)).toBe("row@1");
    expect(where(p, 214, 100)).toBe("row@1");
  });
  it("never answers with a position outside the list of the container", () => {
    const row = box("row", rect(0, 0, 400, 100), [leaf("a", rect(10, 10, 130, 90)), leaf("b", rect(140, 10, 260, 90))]);
    const p = page([row, leaf("z", rect(0, 100, 400, 200))]);
    const sizes: Record<string, number> = { page: 2, row: 2 };
    for (let x = -20; x <= 420; x += 7) {
      for (let y = -20; y <= 220; y += 5) {
        const landing = landingAt(p, x, y);
        const key = landing.slot.parent ?? "page";
        expect(landing.slot.index, `${x},${y}`).toBeGreaterThanOrEqual(0);
        expect(landing.slot.index, `${x},${y}`).toBeLessThanOrEqual(sizes[key] ?? 0);
      }
    }
  });
});

describe("blocks that take no room at the size being edited", () => {
  const gone = (id: string): LayoutNode => ({ ...leaf(id, rect(0, 0, 0, 0)), hidden: true });

  it("are not a place to drop next to, and the positions stay those of the document", () => {
    const withHidden = page([leaf("a", rect(0, 0, 400, 100)), gone("h"), leaf("c", rect(0, 100, 400, 200))]);
    // Next to c, in the upper half: before c, which is the third place of the document.
    expect(where(withHidden, 200, 120)).toBe("page@2");
    // Next to a, in the lower half: after a, in front of the hidden block.
    expect(where(withHidden, 200, 80)).toBe("page@1");
    // A pointer in a gap is never taken to the corner where a hidden block has no rectangle.
    expect(where(page([gone("h"), leaf("c", rect(0, 100, 400, 200))]), 5, 5)).toBe("page@1");
  });
  it("are skipped by what they say, not by how big they are: a hidden block that still has a rectangle is not a neighbour, a place to land, or something to land on", () => {
    const flagged = (id: string, r: Rect): LayoutNode => ({ ...leaf(id, r), hidden: true });
    // It would make the other one look like part of a row...
    expect(flowOf([leaf("a", rect(0, 0, 100, 50)), flagged("h", rect(110, 0, 200, 50))])).toBe("y");
    // ...and the pointer over it is not over a block: the landing is next to the one that is drawn, never on the hidden one.
    const withRect = page([flagged("h", rect(0, 0, 400, 100)), leaf("c", rect(0, 100, 400, 200))]);
    expect(where(withRect, 200, 30)).toBe("page@1");
    expect(landingAt(withRect, 200, 30).line).toEqual(rect(0, 98, 400, 102));
  });
  it("do not decide whether the others are in a row", () => {
    expect(flowOf([leaf("a", rect(0, 0, 100, 50)), gone("h"), leaf("b", rect(110, 0, 200, 50))])).toBe("x");
    expect(flowOf([gone("h"), leaf("a", rect(0, 0, 100, 50)), gone("i")])).toBe("y");
  });
  it("leave a container whose children are all hidden as an empty place to drop into, after them", () => {
    const empty = page([box("row", rect(0, 0, 400, 100), [gone("h"), gone("i")])]);
    const landing = landingAt(empty, 200, 50);
    expect(landing.slot).toEqual({ parent: "row", index: 2 });
    expect(landing.box).toEqual(rect(0, 0, 400, 100));
    expect(landing.line).toBeNull();
  });
});
