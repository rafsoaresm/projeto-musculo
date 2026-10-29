import { describe, expect, it } from "vitest";
import { MAX_NODES, NAME_MAX, allNodes, publishIssues, siteContent, type BoxNode, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import { buildSiteCss } from "@/modules/meu-site/site-css";
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
  it("has every kind of block once, in four groups, each with a label and a hint", () => {
    const keys = CATALOGUE.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of CATALOGUE) {
      expect(GROUP_LABEL[item.group], item.key).toBeTruthy();
      expect(item.label, item.key).not.toBe("");
      expect(item.hint, item.key).not.toBe("");
      expect(catalogueItem(item.key)).toBe(item);
    }
    expect(catalogueItem("nope")).toBeUndefined();
    expect(new Set(CATALOGUE.map((item) => item.group))).toEqual(new Set(["structure", "element", "section", "template"]));
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

describe("the templates", () => {
  const TEMPLATES = ["template-navigation", "template-highlights", "template-image-text", "template-plans", "template-testimonials", "template-footer"];
  const make = (key: string) => catalogueItem(key)!.create() as BoxNode;
  const kinds = (node: SiteNode) => allNodes([node]).map((entry) => entry.type);

  it("are in the library, in a group of their own, and every one is a container with a name", () => {
    expect(CATALOGUE.filter((item) => item.group === "template").map((item) => item.key)).toEqual(TEMPLATES);
    for (const key of TEMPLATES) {
      const node = make(key);
      expect(node.type, key).toBe("box");
      expect(node.name, key).toBeTruthy();
      expect(node.children.length, key).toBeGreaterThan(0);
    }
  });
  it("are built of the nodes the document already has, with the tags of their purpose", () => {
    expect(make("template-navigation")).toMatchObject({ tag: "header" });
    expect(kinds(make("template-navigation"))).toEqual(["box", "paragraph", "box", "link", "link", "link"]);
    expect((make("template-navigation").children[1] as BoxNode).tag).toBe("nav");
    expect(make("template-footer")).toMatchObject({ tag: "footer" });
    expect(kinds(make("template-footer"))).toEqual(["box", "paragraph", "box", "link", "link", "link"]);
    expect(kinds(make("template-highlights"))).toEqual(["box", ...Array(3).fill(["box", "heading", "paragraph"]).flat()]);
    expect(kinds(make("template-testimonials"))).toEqual(["box", "quote", "quote", "quote"]);
    const plans = make("template-plans");
    expect(plans.children.map((card) => (card as BoxNode).tag)).toEqual(["article", "article", "article"]);
    for (const card of plans.children as BoxNode[]) {
      expect(card.children.map((child) => child.type)).toEqual(["heading", "paragraph", "button"]);
      expect(card.children[2]).toMatchObject({ label: "Quero este plano", channel: "whatsapp" });
      expect(card.style).toMatchObject({ radius: "16px", borderWidth: "1px", shadow: "sm" });
    }
    expect(kinds(make("template-image-text"))).toEqual(["box", "image", "box", "heading", "paragraph", "button"]);
  });
  it("invent nothing: every text the person has to write is empty, and the only words filled in are labels of structure", () => {
    const labels = new Set(["Serviços", "Sobre mim", "Contato", "Instagram", "WhatsApp", "E-mail", "Quero este plano", "Falar comigo"]);
    for (const key of TEMPLATES) {
      for (const entry of allNodes([make(key)])) {
        if (entry.type === "heading" || entry.type === "paragraph") expect(entry.text, `${key} ${entry.type}`).toBe("");
        if (entry.type === "quote") expect([entry.quote, entry.author], key).toEqual(["", ""]);
        if (entry.type === "quote") expect(entry.authorized, key).toBe(false);
        if (entry.type === "image") expect([entry.assetId, entry.alt, entry.caption], key).toEqual(["", "", ""]);
        if (entry.type === "button" || entry.type === "link") expect(labels.has(entry.label), `${key}: "${entry.label}"`).toBe(true);
      }
    }
  });
  it("send the contact buttons to the contacts and leave the other links without a destination (the person chooses it)", () => {
    const links = (key: string) => allNodes([make(key)]).filter((entry) => entry.type === "link");
    expect(links("template-navigation").map((entry) => [entry.type === "link" && entry.label, entry.type === "link" && entry.channel])).toEqual([
      ["Serviços", undefined],
      ["Sobre mim", undefined],
      ["Contato", "whatsapp"],
    ]);
    expect(links("template-footer").map((entry) => entry.type === "link" && entry.channel)).toEqual(["instagram", "whatsapp", "email"]);
  });
  it("lay out three columns on the computer, two on the tablet and one on the phone, in the node itself", () => {
    for (const key of ["template-highlights", "template-plans", "template-testimonials"]) {
      const node = make(key);
      expect(node.style, key).toMatchObject({ display: "grid", columns: 3 });
      expect(node.styleTablet, key).toEqual({ columns: 2 });
      expect(node.styleMobile, key).toEqual({ columns: 1 });
      const sheet = buildSiteCss(page([node]), { imageUrl: () => null });
      expect(sheet, key).toContain("repeat(3,");
      expect(sheet, key).toMatch(/@media \(max-width:1023px\)\{[^@]*repeat\(2,/);
      expect(sheet, key).toMatch(/@media \(max-width:576px\)\{[^@]*repeat\(1,/);
    }
    // The image and the text share a row and wrap by themselves when it is narrow.
    const row = make("template-image-text");
    expect(row.style).toMatchObject({ display: "flex", direction: "row", wrap: "wrap" });
    for (const child of row.children as SiteNode[]) expect(child.style).toMatchObject({ grow: 1, basis: "280px", minWidth: "0px" });
  });
  it("fit in one page together, with new identifiers each time", () => {
    const all = TEMPLATES.map(make);
    const nodes = allNodes(all);
    expect(new Set(nodes.map((entry) => entry.id)).size).toBe(nodes.length);
    expect(nodes.length).toBeLessThan(MAX_NODES / 2);
    expect(siteContent.safeParse(page(all)).success).toBe(true);
    expect(allNodes([make("template-plans")]).map((entry) => entry.id)).not.toEqual(allNodes([make("template-plans")]).map((entry) => entry.id));
  });
  it("leave only warnings when published as they are, except the testimony, which asks for the person's authorization", () => {
    for (const key of TEMPLATES) {
      const issues = publishIssues(page([make(key)]), new Set());
      const blocking = issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.message);
      expect(blocking.length, key).toBe(key === "template-testimonials" ? 3 : 0);
      for (const message of blocking) expect(message, key).toContain("autorizou");
    }
  });
});
