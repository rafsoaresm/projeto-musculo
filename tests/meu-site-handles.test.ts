import { describe, expect, it } from "vitest";
import {
  MIN_SIZE,
  SNAP_SCREEN_PX,
  alignmentTargets,
  clampTo,
  gapFrom,
  gapStrip,
  heightFrom,
  inward,
  paddingFrom,
  px,
  radiusFrom,
  sideMode,
  sidesFor,
  snapEdge,
  unscale,
  whole,
  widthFrom,
  type Edge,
} from "@/modules/meu-site/handles";
import { setSides, setStyleProps, isValidStyle } from "@/modules/meu-site/style-model";
import { SPECS, parseLength, styleSchema, type Style } from "@/modules/meu-site/style";
import { emptyBlock, siteContent, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";

describe("a pointer movement, at a zoom", () => {
  it("is brought back to the page's own pixels: at 50% a movement of 10 on the screen is 20 on the page", () => {
    expect(unscale(10, 0.5)).toBe(20);
    expect(unscale(10, 2)).toBe(5);
    expect(unscale(-30, 1)).toBe(-30);
    expect(unscale(10, 0)).toBe(0);
  });
});

describe("whole pixels inside a range", () => {
  it("rounds, clamps, and never gives a number that is not one", () => {
    expect(whole(10.4, [0, 20])).toBe(10);
    expect(whole(10.5, [0, 20])).toBe(11);
    expect(whole(-5, [0, 20])).toBe(0);
    expect(whole(25, [0, 20])).toBe(20);
    expect(whole(Number.NaN, [3, 20])).toBe(3);
    expect(whole(Number.POSITIVE_INFINITY, [3, 20])).toBe(3);
    expect(clampTo(7, [8, 9])).toBe(8);
    expect(px(12)).toBe("12px");
  });
});

describe("sizing by an edge", () => {
  it("follows the pointer from the size it started at, never below a size that can still be taken hold of", () => {
    expect(widthFrom(300, 25)).toBe(325);
    expect(widthFrom(300, -25.4)).toBe(275);
    expect(widthFrom(300, -1000)).toBe(MIN_SIZE);
    expect(heightFrom(100, 40)).toBe(140);
    expect(heightFrom(100, -1000)).toBe(MIN_SIZE);
  });
  it("stops at what the style accepts, which is also what the server accepts", () => {
    expect(widthFrom(3990, 500)).toBe(SPECS.width.px[1]);
    expect(heightFrom(3990, 500)).toBe(SPECS.height.px[1]);
    for (const width of [widthFrom(10, -50), widthFrom(10, 99999), widthFrom(0, 0)]) expect(isValidStyle({ width: px(width) }), String(width)).toBe(true);
    for (const height of [heightFrom(10, -50), heightFrom(10, 99999), heightFrom(0, 0)]) expect(isValidStyle({ height: px(height) }), String(height)).toBe(true);
  });
});

describe("padding by the inside of an edge", () => {
  it("grows when the handle goes into the block, from each side", () => {
    expect(inward("top", 5, 12)).toBe(12);
    expect(inward("bottom", 5, 12)).toBe(-12);
    expect(inward("left", 12, 5)).toBe(12);
    expect(inward("right", 12, 5)).toBe(-12);
    expect(paddingFrom(16, inward("bottom", 0, -10))).toBe(26);
    expect(paddingFrom(16, inward("right", -10, 0))).toBe(26);
  });
  it("is never negative and never more than the style accepts", () => {
    expect(paddingFrom(16, -100)).toBe(0);
    expect(paddingFrom(16, 10_000)).toBe(SPECS.space.px[1]);
    expect(isValidStyle({ padding: { top: px(paddingFrom(0, 10_000)) } })).toBe(true);
  });
  it("changes its own side, with Alt also the one across, with Shift all four", () => {
    expect(sidesFor("top", "one")).toEqual(["top"]);
    expect(sidesFor("top", "opposite").sort()).toEqual(["bottom", "top"]);
    expect(sidesFor("left", "opposite").sort()).toEqual(["left", "right"]);
    expect(sidesFor("right", "all").sort()).toEqual(["bottom", "left", "right", "top"]);
    expect(sideMode({ shift: false, alt: false })).toBe("one");
    expect(sideMode({ shift: false, alt: true })).toBe("opposite");
    expect(sideMode({ shift: true, alt: false })).toBe("all");
    expect(sideMode({ shift: true, alt: true })).toBe("all");
  });
});

describe("the gap between blocks", () => {
  it("follows the pointer and stays inside what the style accepts", () => {
    expect(gapFrom(16, 8)).toBe(24);
    expect(gapFrom(16, -100)).toBe(0);
    expect(gapFrom(16, 1000)).toBe(SPECS.gap.px[1]);
    expect(isValidStyle({ gap: px(gapFrom(0, 1000)) })).toBe(true);
  });
});

describe("the rounding of a corner", () => {
  const size = { width: 200, height: 100 };
  it("follows half the diagonal of the pointer, from the rounding it started at", () => {
    expect(radiusFrom(0, 10, 10, size)).toBe(10);
    expect(radiusFrom(4, 10, 0, size)).toBe(9);
    expect(radiusFrom(20, -10, -10, size)).toBe(10);
  });
  it("cannot pass half the shorter side (a pill), nor go below nothing, nor past the style's own limit", () => {
    expect(radiusFrom(0, 500, 500, size)).toBe(50);
    expect(radiusFrom(0, -500, -500, size)).toBe(0);
    expect(radiusFrom(0, 5000, 5000, { width: 5000, height: 5000 })).toBe(SPECS.radius.px[1]);
    expect(radiusFrom(0, 50, 50, { width: 0, height: 0 })).toBe(0);
    expect(isValidStyle({ radius: px(radiusFrom(0, 9999, 9999, { width: 9999, height: 9999 })) })).toBe(true);
  });
});

describe("snapping an edge", () => {
  it("goes to the nearest target within the distance, and says which", () => {
    expect(snapEdge(103, [100, 110, 300], 6)).toEqual({ edge: 100, target: 100 });
    expect(snapEdge(107, [100, 110], 6)).toEqual({ edge: 110, target: 110 });
    expect(snapEdge(105, [100, 110], 6)).toEqual({ edge: 100, target: 100 });
    // Two within the distance: the nearer one, whatever the order they come in.
    expect(snapEdge(103, [100, 108], 6)).toEqual({ edge: 100, target: 100 });
    expect(snapEdge(103, [108, 100], 6)).toEqual({ edge: 100, target: 100 });
    expect(snapEdge(106, [100, 108], 6)).toEqual({ edge: 108, target: 108 });
    expect(snapEdge(106, [108, 100], 6)).toEqual({ edge: 108, target: 108 });
  });
  it("moves free when nothing is near, or when there is nothing to snap to", () => {
    expect(snapEdge(150, [100, 300], 6)).toEqual({ edge: 150, target: null });
    expect(snapEdge(150, [], 6)).toEqual({ edge: 150, target: null });
    expect(snapEdge(106.01, [100], 6)).toEqual({ edge: 106.01, target: null });
    expect(snapEdge(106, [100], 6)).toEqual({ edge: 100, target: 100 });
  });
  it("is a few screen pixels", () => {
    expect(SNAP_SCREEN_PX).toBeGreaterThan(2);
    expect(SNAP_SCREEN_PX).toBeLessThan(12);
  });
});

describe("the lines an edge may snap to", () => {
  const container = { left: 0, top: 0, right: 400, bottom: 300 };
  it("are the container's sides and middle and the sides of the blocks before, each once", () => {
    expect(alignmentTargets("x", container, [{ left: 0, top: 0, right: 100, bottom: 50 }, { left: 120, top: 0, right: 400, bottom: 50 }]).sort((a, b) => a - b)).toEqual([0, 100, 120, 200, 400]);
    expect(alignmentTargets("y", container, [{ left: 0, top: 10, right: 100, bottom: 50 }]).sort((a, b) => a - b)).toEqual([0, 10, 50, 150, 300]);
    expect(alignmentTargets("x", container, []).sort((a, b) => a - b)).toEqual([0, 200, 400]);
  });
});

describe("where to take hold of the gap between two blocks", () => {
  it("is the space between two blocks side by side, over the height they share", () => {
    const strip = gapStrip({ left: 0, top: 0, right: 100, bottom: 80 }, { left: 120, top: 10, right: 220, bottom: 90 }, 10);
    expect(strip).toEqual({ axis: "x", box: { left: 100, right: 120, top: 10, bottom: 80 } });
  });
  it("is the space between two blocks one above the other, over the width they share", () => {
    const strip = gapStrip({ left: 0, top: 0, right: 100, bottom: 40 }, { left: 20, top: 70, right: 180, bottom: 110 }, 10);
    expect(strip).toEqual({ axis: "y", box: { top: 40, bottom: 70, left: 20, right: 100 } });
  });
  it("is still there when the gap is nothing (a strip of the grip's width centered on the seam), and when they overlap by a pixel", () => {
    expect(gapStrip({ left: 0, top: 0, right: 100, bottom: 80 }, { left: 100, top: 0, right: 200, bottom: 80 }, 10)).toEqual({ axis: "x", box: { left: 95, right: 105, top: 0, bottom: 80 } });
    expect(gapStrip({ left: 0, top: 0, right: 100, bottom: 80 }, { left: 99.5, top: 0, right: 200, bottom: 80 }, 10)?.axis).toBe("x");
    expect(gapStrip({ left: 0, top: 0, right: 100, bottom: 40 }, { left: 0, top: 40, right: 100, bottom: 80 }, 10)).toEqual({ axis: "y", box: { top: 35, bottom: 45, left: 0, right: 100 } });
  });
  it("is none when the second is not simply beside the first or below it: a wrapped row, an overlap, blocks that do not share an edge", () => {
    expect(gapStrip({ left: 0, top: 0, right: 100, bottom: 80 }, { left: 0, top: 0, right: 100, bottom: 80 })).toBeNull();
    expect(gapStrip({ left: 200, top: 0, right: 300, bottom: 40 }, { left: 0, top: 50, right: 100, bottom: 90 })).toBeNull();
    expect(gapStrip({ left: 0, top: 0, right: 100, bottom: 40 }, { left: 150, top: 100, right: 250, bottom: 140 })).toBeNull();
  });
});

describe("writing what a handle gave", () => {
  const edges: Edge[] = ["top", "right", "bottom", "left"];
  const node = (over: object = {}): SiteNode => ({ ...emptyBlock("box", "n"), ...over }) as SiteNode;
  const own = (entry: object, key: "style" | "styleTablet" | "styleMobile") => (entry as Record<string, Style | undefined>)[key];

  it("sets the size at the screen being edited and leaves the others alone", () => {
    const base = node({ style: { gap: "8px" } });
    const desktop = setStyleProps(base, "desktop", { width: "300px" });
    expect(own(desktop, "style")).toEqual({ gap: "8px", width: "300px" });
    const tablet = setStyleProps(base, "tablet", { width: "300px" });
    expect(own(tablet, "style")).toEqual({ gap: "8px" });
    expect(own(tablet, "styleTablet")).toEqual({ width: "300px" });
    const phone = setStyleProps(tablet, "mobile", { width: "200px", height: "90px" });
    expect(own(phone, "styleTablet")).toEqual({ width: "300px" });
    expect(own(phone, "styleMobile")).toEqual({ width: "200px", height: "90px" });
  });
  it("takes a property away when it is given nothing, and the style with it when nothing is left", () => {
    expect(setStyleProps(node({ style: { width: "300px" } }), "desktop", { width: undefined })).not.toHaveProperty("style");
    expect(own(setStyleProps(node({ style: { width: "300px", gap: "4px" } }), "desktop", { width: undefined }), "style")).toEqual({ gap: "4px" });
  });
  it("sets padding on the sides given, keeping the others, in the screen being edited", () => {
    const base = node({ style: { padding: { top: "4px", left: "6px" } } });
    expect(own(setSides(base, "desktop", "padding", ["top", "bottom"], "20px"), "style")).toEqual({ padding: { top: "20px", left: "6px", bottom: "20px" } });
    expect(own(setSides(base, "tablet", "padding", ["right"], "9px"), "styleTablet")).toEqual({ padding: { right: "9px" } });
    expect(own(setSides(base, "tablet", "padding", ["right"], "9px"), "style")).toEqual({ padding: { top: "4px", left: "6px" } });
    expect(own(setSides(base, "desktop", "padding", edges, "0px"), "style")).toEqual({ padding: { top: "0px", right: "0px", bottom: "0px", left: "0px" } });
  });
  it("clears sides, and the whole group when no side is left", () => {
    const base = node({ style: { padding: { top: "4px" } } });
    expect(setSides(base, "desktop", "padding", ["top"], undefined)).not.toHaveProperty("style");
  });
  it("never writes anything the server would refuse, whatever the pointer did", () => {
    for (const delta of [-99999, -500, -1, 0, 1, 7.4, 500, 99999, Number.NaN]) {
      const next = setStyleProps(setStyleProps(node(), "desktop", { width: px(widthFrom(300, delta)), height: px(heightFrom(120, delta)), gap: px(gapFrom(8, delta)), radius: px(radiusFrom(8, delta, delta, { width: 300, height: 120 })) }), "tablet", {
        width: px(widthFrom(300, delta)),
      });
      const done = setSides(next, "mobile", "padding", sidesFor("left", "all"), px(paddingFrom(10, delta)));
      const content: SiteContent = {
        schemaVersion: 3,
        title: "T",
        description: "",
        contact: { whatsapp: "", email: "", instagram: "" },
        theme: { accent: "blue", mode: "light", width: "narrow" },
        blocks: [done],
      };
      expect(siteContent.safeParse(content).success, String(delta)).toBe(true);
      for (const key of ["style", "styleTablet", "styleMobile"] as const) {
        const written = own(done, key);
        if (written) expect(styleSchema.safeParse(written).success, `${key} ${delta}`).toBe(true);
      }
    }
    expect(parseLength(px(widthFrom(1, 1)))).toEqual({ amount: MIN_SIZE, unit: "px" });
  });
});
