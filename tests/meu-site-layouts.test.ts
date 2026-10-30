import { describe, expect, it } from "vitest";
import { allNodes, siteContent, type BoxNode, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import { CATALOGUE, GROUP_LABEL, catalogueItem } from "@/modules/meu-site/presets";
import { SCREENS, ownStyle } from "@/modules/meu-site/screens";
import { buildSiteCss } from "@/modules/meu-site/site-css";
import { isHexColor, styleSchema, type Style } from "@/modules/meu-site/style";

const LAYOUTS = ["layout-split-hero", "layout-split-hero-reverse", "layout-numbers", "layout-link-band", "layout-cards", "layout-about-panels", "layout-final-band"];
const make = (key: string) => catalogueItem(key)!.create() as BoxNode;
const page = (blocks: SiteNode[]): SiteContent => ({
  schemaVersion: 3,
  title: "Marina",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "wide" },
  blocks,
});
const kinds = (node: SiteNode) => allNodes([node]).map((entry) => entry.type);
const styles = (node: SiteNode): Style[] => allNodes([node]).flatMap((entry) => SCREENS.map((screen) => ownStyle(entry, screen) ?? {}));
/** Every text a person reads in the node: what a layout may not fill in with words of its own. */
const texts = (node: SiteNode): string[] =>
  allNodes([node]).flatMap((entry) => {
    const record = entry as unknown as Record<string, unknown>;
    return ["text", "label", "heading", "alt", "caption"].flatMap((key) => (typeof record[key] === "string" && record[key] !== "" ? [record[key] as string] : []));
  });

describe("the layouts of the library", () => {
  it("are seven, in a group of their own, each one a named container that parses as a document the server accepts", () => {
    expect(CATALOGUE.filter((item) => item.group === "layout").map((item) => item.key)).toEqual(LAYOUTS);
    expect(GROUP_LABEL.layout).toBe("Layouts");
    for (const key of LAYOUTS) {
      const node = make(key);
      expect(node.type, key).toBe("box");
      expect(node.tag, key).toBe("section");
      expect(node.name, key).toBeTruthy();
      expect(siteContent.safeParse(page([node])).success, key).toBe(true);
    }
  });
  it("have a style at every size of the screen that the contract accepts, and the phone stacks what the computer puts side by side", () => {
    for (const key of LAYOUTS) {
      const node = make(key);
      for (const style of styles(node)) expect(styleSchema.safeParse(style).success, key).toBe(true);
      const columns = ownStyle(node, "desktop")?.columns;
      // Three panels (a picture, a card, a picture) still fit side by side on a tablet; everything else with more than two columns narrows.
      if (columns && columns > 2 && key !== "layout-about-panels") expect(ownStyle(node, "tablet")?.columns, `${key} on a tablet`).toBeLessThan(columns);
      if (columns) expect(ownStyle(node, "mobile")?.columns, `${key} on a phone`).toBeLessThanOrEqual(2);
    }
    // The two that put a title beside a picture, and the closing band, are one column on the phone.
    for (const key of ["layout-split-hero", "layout-split-hero-reverse", "layout-final-band", "layout-about-panels"]) expect(ownStyle(make(key), "mobile")?.columns, key).toBe(1);
    expect(ownStyle(make("layout-about-panels"), "tablet")?.columns).toBeUndefined();
  });
  it("make no side margin of their own (the page keeps one) and use the colors of the theme, so they follow the accent that is chosen", () => {
    for (const key of LAYOUTS) {
      const node = make(key);
      if (key !== "layout-link-band" && key !== "layout-numbers" && key !== "layout-final-band") expect(ownStyle(node, "desktop")?.padding?.left, key).toBe("0px");
      for (const style of styles(node)) {
        for (const value of [style.background, style.color, style.borderColor]) if (value) expect(isHexColor(value), `${key}: ${value}`).toBe(false);
      }
    }
  });
  it("keep a little air above and below the bands that have a color of their own, so two of them (or a band and a card) do not touch", () => {
    for (const key of ["layout-numbers", "layout-link-band", "layout-final-band"]) {
      expect(ownStyle(make(key), "desktop")?.margin, key).toEqual({ top: "24px", right: "0px", bottom: "24px", left: "0px" });
    }
  });
  it("invent no text: the only words in them are the text of the contact buttons and of the link that reads on", () => {
    const allowed = new Set(["Falar comigo", "Saiba mais", "Ler mais"]);
    for (const key of LAYOUTS) for (const text of texts(make(key))) expect(allowed.has(text), `${key}: ${text}`).toBe(true);
    // No numbers, no names, no promises: the headings are all empty.
    for (const key of LAYOUTS) for (const entry of allNodes([make(key)])) if (entry.type === "heading" || entry.type === "paragraph") expect(entry.text, key).toBe("");
  });
  it("leave the pictures as empty frames of a shape, never a picture of anyone's", () => {
    const frames = (key: string) => allNodes([make(key)]).flatMap((entry) => (entry.type === "image" ? [entry] : []));
    expect(frames("layout-split-hero").map((entry) => entry.ratio)).toEqual(["4:5"]);
    expect(frames("layout-split-hero-reverse").map((entry) => entry.ratio)).toEqual(["4:5"]);
    expect(frames("layout-about-panels").map((entry) => entry.ratio)).toEqual(["3:4", "3:4"]);
    for (const key of LAYOUTS) for (const entry of frames(key)) expect(entry.assetId, key).toBe("");
    for (const key of ["layout-numbers", "layout-link-band", "layout-cards", "layout-final-band"]) expect(frames(key), key).toEqual([]);
  });
  it("are made of what the document already has, in the order of the examples", () => {
    expect(kinds(make("layout-split-hero")).filter((kind) => kind !== "box")).toEqual(["paragraph", "heading", "paragraph", "button", "image"]);
    expect(kinds(make("layout-split-hero-reverse")).filter((kind) => kind !== "box")).toEqual(["image", "paragraph", "heading", "paragraph", "button"]);
    expect(make("layout-numbers").children).toHaveLength(4);
    expect(make("layout-link-band").children).toHaveLength(5);
    expect(make("layout-cards").children.map((card) => (card as BoxNode).tag)).toEqual(["article", "article", "article"]);
    expect(make("layout-about-panels").children.map((child) => child.type)).toEqual(["image", "box", "image"]);
    expect(make("layout-final-band").children.map((child) => child.type)).toEqual(["heading", "box"]);
  });
  it("write a stylesheet for each size, with the big titles in the condensed font and shrinking on the phone", () => {
    const css = buildSiteCss(page([make("layout-split-hero")]), { imageUrl: () => null });
    expect(css).toContain("font-family:Impact");
    expect(css).toContain("font-size:64px");
    expect(css).toContain("font-size:40px");
    expect(css).toMatch(/@media[^{]*max-width:576px/);
  });
  it("have three cards that are not alike: filled with the accent, dark and outlined", () => {
    const [full, dark, hollow] = make("layout-cards").children.map((card) => ownStyle(card, "desktop"));
    expect(full).toMatchObject({ background: "solid", color: "on" });
    expect(dark).toMatchObject({ background: "black", color: "white" });
    expect(hollow).toMatchObject({ borderWidth: "2px", borderColor: "ink" });
    expect(hollow?.background).toBeUndefined();
  });
});
