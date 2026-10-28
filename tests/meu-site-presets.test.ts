import { describe, expect, it } from "vitest";
import { NAME_MAX, allNodes, siteContent, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import { CATALOGUE, GROUP_LABEL, catalogueItem } from "@/modules/meu-site/presets";
import { patchSide, patchStyle } from "@/modules/meu-site/style-model";
import { isEmptyStyle, styleSchema } from "@/modules/meu-site/style";

const page = (blocks: SiteNode[]): SiteContent => ({
  schemaVersion: 3,
  title: "Marina",
  description: "",
  contact: { whatsapp: "", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
});

describe("what the library offers", () => {
  it("has every kind of block once, in three groups, each with a label and a hint", () => {
    const keys = CATALOGUE.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of CATALOGUE) {
      expect(GROUP_LABEL[item.group], item.key).toBeTruthy();
      expect(item.label, item.key).not.toBe("");
      expect(item.hint, item.key).not.toBe("");
      expect(catalogueItem(item.key)).toBe(item);
    }
    expect(catalogueItem("nope")).toBeUndefined();
    expect(new Set(CATALOGUE.map((item) => item.group))).toEqual(new Set(["structure", "element", "section"]));
  });
  it("makes nodes the server accepts, each time with new identifiers, whose styles and names are in the contract", () => {
    for (const item of CATALOGUE) {
      const first = item.create();
      const second = item.create();
      expect(siteContent.safeParse(page([first])).success, item.key).toBe(true);
      const ids = [...allNodes([first]), ...allNodes([second])].map((n) => n.id);
      expect(new Set(ids).size, item.key).toBe(ids.length);
      for (const entry of allNodes([first])) {
        if (entry.style) expect(styleSchema.safeParse(entry.style).success, `${item.key} ${entry.id}`).toBe(true);
        if (entry.name) expect(entry.name.length).toBeLessThanOrEqual(NAME_MAX);
      }
    }
  });
  it("starts a container with a visible, plain style, and \"2 colunas\" as a row of two columns", () => {
    for (const key of ["section", "container", "row", "column", "grid", "stack"]) {
      const node = catalogueItem(key)!.create();
      expect(node.type, key).toBe("box");
      expect(isEmptyStyle(node.style), key).toBe(false);
      expect(node.style?.display, key).toMatch(/^(flex|grid)$/);
    }
    expect(catalogueItem("section")!.create()).toMatchObject({ tag: "section" });
    expect(catalogueItem("grid")!.create().style).toMatchObject({ display: "grid", columns: 3 });
    // A column shares the row and wraps when narrow, as the columns of the old "2 columns" did.
    expect(catalogueItem("column")!.create().style).toMatchObject({ grow: 1, shrink: 1, basis: "240px", minWidth: "0px" });
    const two = catalogueItem("columns2")!.create();
    expect(allNodes([two]).map((n) => n.type)).toEqual(["box", "box", "box"]);
    expect(two.type === "box" && two.children).toHaveLength(2);
    expect(two.style).toMatchObject({ display: "flex", direction: "row" });
  });
  it("makes a block with no style at all for what is not a container", () => {
    for (const key of ["heading", "paragraph", "button", "link", "image", "hero", "services", "faq"]) expect(catalogueItem(key)!.create().style, key).toBeUndefined();
  });
});

describe("changing a style", () => {
  it("sets a property and removes it again, leaving no style at all when nothing is left", () => {
    const one = patchStyle(undefined, { gap: "8px" });
    expect(one).toEqual({ gap: "8px" });
    expect(patchStyle(one, { color: "accent" })).toEqual({ gap: "8px", color: "accent" });
    expect(patchStyle(one, { gap: undefined })).toBeUndefined();
    expect(patchStyle({}, {})).toBeUndefined();
  });
  it("does not change the style it was given", () => {
    const style = { gap: "8px" } as const;
    patchStyle(style, { gap: "9px", color: "accent" });
    expect(style).toEqual({ gap: "8px" });
  });
  it("sets one side of padding at a time, and drops the group when its last side goes", () => {
    const top = patchSide(undefined, "padding", "top", "8px");
    expect(top).toEqual({ padding: { top: "8px" } });
    const both = patchSide(top, "padding", "left", "4px");
    expect(both).toEqual({ padding: { top: "8px", left: "4px" } });
    const noTop = patchSide(both, "padding", "top", undefined);
    expect(noTop).toEqual({ padding: { left: "4px" } });
    expect(patchSide(noTop, "padding", "left", undefined)).toBeUndefined();
    expect(patchSide({ gap: "1px", margin: { left: "auto" } }, "margin", "left", undefined)).toEqual({ gap: "1px" });
  });
});
