import { describe, expect, it } from "vitest";
import { emptyBlock, type BoxNode, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import type { LayoutNode } from "@/modules/meu-site/drop-geometry";
import { marqueeSelect, primaryOf, reconcile, rectBetween, selectRange, toggleId } from "@/modules/meu-site/selection";

const el = (id: string): SiteNode => ({ ...emptyBlock("paragraph", id), text: id }) as SiteNode;
const box = (id: string, children: SiteNode[]): BoxNode => ({ ...(emptyBlock("box", id) as BoxNode), children });
const page = (blocks: SiteNode[]): SiteContent => ({
  schemaVersion: 3,
  title: "Marina",
  description: "",
  contact: { whatsapp: "", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
});
/** a, row[left[l1, l2], right[r1]], b, c */
const doc = () => page([el("a"), box("row", [box("left", [el("l1"), el("l2")]), box("right", [el("r1")])]), el("b"), el("c")]);

describe("which blocks are selected", () => {
  it("keeps the ones that are in the document, each once, in the order they were chosen", () => {
    expect(reconcile(doc(), ["b", "a", "nope", "b", "l2"])).toEqual(["b", "a", "l2"]);
    expect(reconcile(doc(), [])).toEqual([]);
    expect(reconcile(doc(), ["gone"])).toEqual([]);
  });
  it("has the block chosen last as its primary", () => {
    expect(primaryOf(["a", "b", "c"])).toBe("c");
    expect(primaryOf(["a"])).toBe("a");
    expect(primaryOf([])).toBeNull();
  });
  it("adds a block (as the primary) or takes it away, when it was already there", () => {
    expect(toggleId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(toggleId([], "a")).toEqual(["a"]);
    expect(toggleId(["a"], "a")).toEqual([]);
  });
});

describe("a range chosen in the list of layers", () => {
  it("is every block between the first chosen and this one when they are in the same place, the clicked one as the primary", () => {
    expect(selectRange(doc(), "a", "c")).toEqual(["a", "row", "b", "c"]);
    expect(selectRange(doc(), "c", "a")).toEqual(["row", "b", "c", "a"]);
    expect(selectRange(doc(), "l1", "l2")).toEqual(["l1", "l2"]);
  });
  it("is this block alone when there was none before it, or the two are not in the same place", () => {
    expect(selectRange(doc(), null, "b")).toEqual(["b"]);
    expect(selectRange(doc(), "l1", "b")).toEqual(["b"]);
    expect(selectRange(doc(), "gone", "b")).toEqual(["b"]);
  });
});

/** The page as drawn: a (0-100), the row (100-300) with two columns side by side, b (300-340), c (340-380); all full width 400. */
const layout = (): LayoutNode => ({
  id: null,
  rect: { left: 0, top: 0, right: 400, bottom: 400 },
  holds: true,
  children: [
    { id: "a", rect: { left: 0, top: 0, right: 400, bottom: 100 }, holds: false, children: [] },
    {
      id: "row",
      rect: { left: 0, top: 100, right: 400, bottom: 300 },
      holds: true,
      children: [
        {
          id: "left",
          rect: { left: 0, top: 100, right: 200, bottom: 300 },
          holds: true,
          children: [
            { id: "l1", rect: { left: 0, top: 100, right: 200, bottom: 160 }, holds: false, children: [] },
            { id: "l2", rect: { left: 0, top: 160, right: 200, bottom: 220 }, holds: false, children: [] },
          ],
        },
        { id: "right", rect: { left: 200, top: 100, right: 400, bottom: 300 }, holds: true, children: [{ id: "r1", rect: { left: 200, top: 100, right: 400, bottom: 160 }, holds: false, children: [] }] },
      ],
    },
    { id: "b", rect: { left: 0, top: 300, right: 400, bottom: 340 }, holds: false, children: [] },
    { id: "c", rect: { left: 0, top: 340, right: 400, bottom: 380 }, holds: false, children: [] },
  ],
});

describe("a rectangle drawn on the page", () => {
  it("is made from two corners, whichever order they are dragged in", () => {
    expect(rectBetween({ x: 10, y: 50 }, { x: 30, y: 20 })).toEqual({ left: 10, top: 20, right: 30, bottom: 50 });
    expect(rectBetween({ x: 30, y: 20 }, { x: 10, y: 50 })).toEqual({ left: 10, top: 20, right: 30, bottom: 50 });
  });
  it("picks the blocks of the page that it touches, in the order of the document, when it is not inside one container", () => {
    expect(marqueeSelect(layout(), { left: 10, top: 80, right: 390, bottom: 320 })).toEqual(["a", "row", "b"]);
    expect(marqueeSelect(layout(), { left: 10, top: 330, right: 20, bottom: 360 })).toEqual(["b", "c"]);
    expect(marqueeSelect(layout(), { left: 10, top: 10, right: 20, bottom: 20 })).toEqual(["a"]);
  });
  it("goes into the container that holds the whole rectangle, as deep as there are, and picks what it touches there", () => {
    expect(marqueeSelect(layout(), { left: 150, top: 120, right: 250, bottom: 140 })).toEqual(["left", "right"]);
    expect(marqueeSelect(layout(), { left: 20, top: 110, right: 180, bottom: 200 })).toEqual(["l1", "l2"]);
    expect(marqueeSelect(layout(), { left: 20, top: 110, right: 180, bottom: 130 })).toEqual(["l1"]);
    // A rectangle that reaches exactly the edges of a container is still inside it.
    expect(marqueeSelect(layout(), { left: 0, top: 110, right: 400, bottom: 140 })).toEqual(["left", "right"]);
    expect(marqueeSelect(layout(), { left: 0, top: 100, right: 200, bottom: 300 })).toEqual(["l1", "l2"]);
  });
  it("picks nothing from empty space, and does not pick what only shares an edge", () => {
    expect(marqueeSelect(layout(), { left: 10, top: 385, right: 20, bottom: 395 })).toEqual([]);
    expect(marqueeSelect(layout(), { left: 10, top: 100, right: 390, bottom: 100 })).toEqual([]);
    expect(marqueeSelect(layout(), { left: 10, top: 300, right: 390, bottom: 320 })).toEqual(["b"]);
    // A thin rectangle inside the row is inside a container: it picks the row's columns, not the row.
    expect(marqueeSelect(layout(), { left: 10, top: 100.5, right: 390, bottom: 110 })).toEqual(["left", "right"]);
    // Across the row's own edge it is not inside the row, so it picks the row.
    expect(marqueeSelect(layout(), { left: 10, top: 90, right: 390, bottom: 110 })).toEqual(["a", "row"]);
  });
  it("never picks a block that takes no room, and does not go into one", () => {
    const hidden = layout();
    hidden.children[0].hidden = true;
    hidden.children[1].hidden = true;
    expect(marqueeSelect(hidden, { left: 10, top: 10, right: 390, bottom: 390 })).toEqual(["b", "c"]);
    expect(marqueeSelect(hidden, { left: 20, top: 110, right: 180, bottom: 130 })).toEqual([]);
  });
});
