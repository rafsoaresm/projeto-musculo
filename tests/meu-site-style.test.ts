import { describe, expect, it } from "vitest";
import { emptyBlock, siteContent, type Block, type SiteContent } from "@/modules/meu-site/contracts";
import { buildSiteCss, nodeClass } from "@/modules/meu-site/site-css";
import { COLOR_TOKENS, FONT_CSS, STYLE_FONTS, SPECS, cssDeclarations, isEmptyStyle, lengthFits, parseLength, styleAssetIds, styleSchema, type CssContext } from "@/modules/meu-site/style";

const images: CssContext = { imageUrl: (assetId) => (assetId === "asset-1" ? "/app/s/marina/m/asset-1" : null) };
const css = (style: unknown) => cssDeclarations(style, images);
const valid = (style: unknown) => styleSchema.safeParse(style).success;

describe("a length is a number in a range with a unit, and nothing else", () => {
  it("reads \"16px\", \"50%\", \"2.5rem\", \"-12px\" and refuses what is not exactly that", () => {
    expect(parseLength("16px")).toEqual({ amount: 16, unit: "px" });
    expect(parseLength("2.5rem")).toEqual({ amount: 2.5, unit: "rem" });
    expect(parseLength("-12px")).toEqual({ amount: -12, unit: "px" });
    for (const bad of ["", "px", "16", "16 px", "16PX", "16em", "1e3px", "0x10px", ".5px", "5.px", "5.123px", "+5px", "--5px", "5px;", "calc(1px)", "var(--x)", "16px ", "99999px", "auto"])
      expect(parseLength(bad), bad).toBeNull();
  });
  it("applies the range of the property to each unit, and \"auto\" only where the property takes it", () => {
    expect(lengthFits("400px", SPECS.space)).toBe(true);
    expect(lengthFits("401px", SPECS.space)).toBe(false);
    expect(lengthFits("-1px", SPECS.space)).toBe(false);
    expect(lengthFits("50%", SPECS.space)).toBe(true);
    expect(lengthFits("51%", SPECS.space)).toBe(false);
    expect(lengthFits("10vw", SPECS.space)).toBe(false);
    expect(lengthFits("auto", SPECS.margin)).toBe(true);
    expect(lengthFits("auto", SPECS.space)).toBe(false);
    expect(lengthFits("-200px", SPECS.margin)).toBe(true);
    expect(lengthFits("-201px", SPECS.margin)).toBe(false);
    expect(lengthFits("100vh", SPECS.height)).toBe(true);
    expect(lengthFits("100vw", SPECS.height)).toBe(false);
    expect(lengthFits("7px", SPECS.fontSize)).toBe(false);
    expect(lengthFits("8px", SPECS.fontSize)).toBe(true);
    expect(lengthFits("17px", SPECS.border)).toBe(false);
  });
});

describe("the style schema", () => {
  it("takes a style made of values from the lists, in ranges, and nothing else", () => {
    expect(valid({})).toBe(true);
    expect(
      valid({
        display: "flex",
        direction: "column",
        wrap: "wrap",
        gap: "16px",
        align: "center",
        justify: "between",
        grow: 1,
        shrink: 0,
        basis: "240px",
        selfAlign: "end",
        padding: { top: "24px", left: "5%" },
        margin: { left: "auto", right: "auto", top: "-8px" },
        width: "100%",
        maxWidth: "1100px",
        minHeight: "50vh",
        fontFamily: "serif",
        fontSize: "2rem",
        fontWeight: 700,
        lineHeight: 1.15,
        letterSpacing: "-1px",
        textAlign: "center",
        textTransform: "uppercase",
        textDecoration: "underline",
        color: "#112233",
        background: "soft",
        bgImage: "asset-1",
        bgSize: "contain",
        bgPosition: "top-left",
        bgRepeat: true,
        borderWidth: "2px",
        borderStyle: "dashed",
        borderColor: "accent",
        radius: "12px",
        shadow: "lg",
        opacity: 80,
        overflow: "hidden",
      }),
    ).toBe(true);
  });
  it("has a condensed font for big titles beside the page's three, made only of fonts the device already has", () => {
    expect([...STYLE_FONTS]).toEqual(["sans", "serif", "mono", "display"]);
    expect(styleSchema.safeParse({ fontFamily: "display" }).success).toBe(true);
    expect(css({ fontFamily: "display" })).toEqual([`font-family:${FONT_CSS.display}`]);
    // It falls back to a plain sans when the device has none of the condensed ones, and loads nothing from anyone else.
    expect(FONT_CSS.display).toMatch(/^Impact,/);
    expect(FONT_CSS.display).toMatch(/,sans-serif$/);
    expect(FONT_CSS.display).not.toMatch(/url|http|@import/i);
  });
  it("refuses a property that does not exist, and a value out of its list or range", () => {
    for (const bad of [
      { position: "absolute" },
      { zIndex: 10 },
      { "background-image": "url(x)" },
      { display: "none" },
      { display: "inline-grid" },
      { direction: "rtl" },
      { gap: "1em" },
      { gap: "201px" },
      { columns: 0 },
      { columns: 13 },
      { columns: 2.5 },
      { grow: -1 },
      { grow: 11 },
      { shrink: "1" },
      { padding: { top: "-1px" } },
      { padding: { middle: "1px" } },
      { margin: { top: "auto2" } },
      { width: "100" },
      { width: "calc(100% - 1px)" },
      { fontFamily: "Comic Sans MS" },
      { fontFamily: "sans; color: red" },
      { fontWeight: 450 },
      { fontWeight: 1000 },
      { lineHeight: 0.5 },
      { lineHeight: 1.234 },
      { color: "red" },
      { color: "#fff" },
      { color: "#ggg000" },
      { color: "#12345" },
      { color: "rgb(0,0,0)" },
      { color: "var(--x)" },
      { background: "url(javascript:alert(1))" },
      { borderStyle: "double" },
      { shadow: "0 0 99px red" },
      { opacity: 101 },
      { opacity: -1 },
      { overflow: "scroll" },
      { bgPosition: "left top" },
      { bgRepeat: "yes" },
    ])
      expect(valid(bad), JSON.stringify(bad)).toBe(false);
  });
  it("knows when a style says nothing, and which images of the library it uses", () => {
    expect(isEmptyStyle(undefined)).toBe(true);
    expect(isEmptyStyle({})).toBe(true);
    expect(isEmptyStyle({ gap: "8px" })).toBe(false);
    expect(styleAssetIds({ bgImage: "asset-1" })).toEqual(["asset-1"]);
    expect(styleAssetIds({ gap: "8px" })).toEqual([]);
    expect(styleAssetIds(undefined)).toEqual([]);
  });
});

describe("the declarations of a style", () => {
  it("writes each property in the same order, in the names of CSS", () => {
    expect(
      css({
        display: "flex",
        direction: "row",
        wrap: "wrap",
        gap: "16px",
        align: "start",
        justify: "between",
        grow: 2,
        shrink: 1,
        basis: "240px",
        selfAlign: "center",
        padding: { top: "8px", right: "16px", bottom: "8px", left: "16px" },
        margin: { left: "auto", right: "auto" },
        width: "50%",
        minWidth: "0px",
        maxWidth: "1100px",
        height: "auto",
        minHeight: "50vh",
        maxHeight: "90vh",
        fontFamily: "mono",
        fontSize: "18px",
        fontWeight: 600,
        lineHeight: 1.5,
        letterSpacing: "1px",
        textAlign: "right",
        textTransform: "capitalize",
        textDecoration: "line-through",
        background: "#A1B2C3",
        radius: "8px",
        shadow: "md",
        opacity: 35,
        overflow: "auto",
      }),
    ).toEqual([
      "display:flex",
      "flex-direction:row",
      "flex-wrap:wrap",
      "gap:16px",
      "align-items:flex-start",
      "justify-content:space-between",
      "flex-grow:2",
      "flex-shrink:1",
      "flex-basis:240px",
      "align-self:center",
      "padding-top:8px",
      "padding-right:16px",
      "padding-bottom:8px",
      "padding-left:16px",
      "margin-right:auto",
      "margin-left:auto",
      "width:50%",
      "min-width:0px",
      "max-width:1100px",
      "height:auto",
      "min-height:50vh",
      "max-height:90vh",
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,Liberation Mono,monospace",
      "font-size:18px",
      "font-weight:600",
      "line-height:1.5",
      "letter-spacing:1px",
      "text-align:right",
      "text-transform:capitalize",
      "text-decoration:line-through",
      "background-color:#a1b2c3",
      "border-radius:8px",
      "box-shadow:0 4px 12px rgba(0,0,0,.14)",
      "opacity:0.35",
      "overflow:auto",
    ]);
  });
  it("writes a grid's columns as equal shares that cannot overflow, and the five shadows", () => {
    expect(css({ display: "grid", columns: 3 })).toEqual(["display:grid", "grid-template-columns:repeat(3,minmax(0,1fr))"]);
    expect(css({ shadow: "none" })).toEqual(["box-shadow:none"]);
    expect(css({ shadow: "xl" })).toEqual(["box-shadow:0 24px 56px rgba(0,0,0,.24)"]);
  });
  it("gives the theme's own colors as its variables (so they follow light and dark), and a free color as a lower-case hex", () => {
    for (const token of COLOR_TOKENS) {
      const [declaration] = css({ background: token });
      expect(declaration, token).toMatch(/^background-color:(var\(--site-[a-z-]+\)|#[0-9a-f]{6}|transparent)$/);
    }
    expect(css({ background: "accent" })).toEqual(["background-color:var(--site-accent)"]);
    expect(css({ background: "#ABCDEF80" })).toEqual(["background-color:#abcdef80"]);
  });
  it("makes the text color reach what is inside: the theme's names for text follow it, as a heading reads --site-ink", () => {
    expect(css({ color: "#ffffff" })).toEqual(["color:#ffffff", "--site-ink:#ffffff", "--site-text:#ffffff"]);
    expect(css({ color: "muted" })).toEqual(["color:var(--site-muted)", "--site-ink:var(--site-muted)", "--site-text:var(--site-muted)"]);
  });
  it("draws a border only with a width, with the line color of the theme when none is chosen", () => {
    expect(css({ borderWidth: "1px" })).toEqual(["border-width:1px", "border-style:solid", "border-color:var(--site-line)"]);
    expect(css({ borderWidth: "3px", borderStyle: "dotted", borderColor: "#ff0000" })).toEqual(["border-width:3px", "border-style:dotted", "border-color:#ff0000"]);
    expect(css({ borderStyle: "dashed", borderColor: "accent" })).toEqual([]);
  });
  it("draws a background image only from an address the page itself gave for an image of the library", () => {
    expect(css({ bgImage: "asset-1" })).toEqual([
      'background-image:url("/app/s/marina/m/asset-1")',
      "background-size:cover",
      "background-position:center",
      "background-repeat:no-repeat",
    ]);
    expect(css({ bgImage: "asset-1", bgSize: "contain", bgPosition: "bottom-right", bgRepeat: true })).toContain("background-position:right bottom");
    expect(css({ bgImage: "asset-2" })).toEqual([]);
    // The published sheet uses addresses relative to itself (the mount path is not known to the server).
    expect(cssDeclarations({ bgImage: "asset-1" }, { imageUrl: () => "./m/asset-1" })[0]).toBe('background-image:url("./m/asset-1")');
    for (const hostile of ['/x"); background:url(//evil.test/x', "https://evil.test/x.png", "//evil.test/x", "/a b", "/a)b", "/a\nb", "/a;b", "javascript:alert(1)", "", "/".padEnd(400, "a"), ".//evil.test/x", "./a b", "./", "x/y", "./x\ny"]) {
      expect(cssDeclarations({ bgImage: "asset-1" }, { imageUrl: () => hostile }), hostile).toEqual([]);
    }
  });
  it("writes nothing for a style that does not pass the schema, not even the part that does", () => {
    expect(css({ gap: "8px", color: "red" })).toEqual([]);
    expect(css({ gap: "8px", position: "fixed" })).toEqual([]);
    expect(css("display:flex")).toEqual([]);
    expect(css(null)).toEqual([]);
    expect(css(undefined)).toEqual([]);
  });
  it("never writes a character outside a small set, whatever is thrown at it: no quote but the one of url, no brace, no angle bracket, no backslash", () => {
    const allowed = /^[A-Za-z0-9 #%.,:()_/@\-"]+$/;
    const hostile = ["}", "{", ";", "</style>", "<script>", "\\", "/*", "*/", "@import url(//evil.test)", "expression(alert(1))", "\u0000", "\n", "'", "`", "var(--site-ink)", "inherit !important"];
    const keys = Object.keys(styleSchema.shape);
    let written = 0;
    for (const key of keys) {
      for (const value of hostile) {
        for (const shape of [value, { top: value }, [value], { nested: value }]) {
          const declarations = css({ [key]: shape });
          written += declarations.length;
          for (const declaration of declarations) expect(declaration).toMatch(allowed);
        }
      }
    }
    expect(written).toBe(0);
    // And everything a valid style can write stays inside the set too.
    const everything = css({ display: "grid", gap: "1.5rem", columns: 12, padding: { top: "5%" }, margin: { top: "auto" }, color: "#ABCDEF", background: "softLine", borderWidth: "16px", radius: "50%", shadow: "sm", opacity: 5, lineHeight: 2.05, fontFamily: "serif", bgImage: "asset-1" });
    expect(everything.length).toBeGreaterThan(10);
    for (const declaration of everything) expect(declaration).toMatch(allowed);
  });
});

describe("the stylesheet of a page", () => {
  const withBlocks = (blocks: Block[]): SiteContent => ({
    schemaVersion: 3,
    title: "Marina",
    description: "",
    contact: { whatsapp: "", email: "", instagram: "" },
    theme: { accent: "blue", mode: "light", width: "narrow" },
    blocks,
  });
  const box = (id: string, children: Block[], style?: object) => ({ ...emptyBlock("box", id), children, ...(style ? { style } : {}) }) as Block;
  const para = (id: string, style?: object) => ({ ...emptyBlock("paragraph", id), text: "x", ...(style ? { style } : {}) }) as Block;

  it("has one rule per node that has a style, in reading order, keyed by the node's own class repeated to outweigh the page's rules", () => {
    const content = withBlocks([para("a"), box("row", [para("b", { color: "#112233" }), box("col", [para("c", { fontSize: "20px" })], { display: "flex", direction: "column" })], { display: "flex", gap: "8px" })]);
    expect(buildSiteCss(content, images).split("\n")).toEqual([
      ".site .s-row.s-row.s-row{display:flex;gap:8px}",
      ".site .s-b.s-b.s-b{color:#112233;--site-ink:#112233;--site-text:#112233}",
      ".site .s-col.s-col.s-col{display:flex;flex-direction:column}",
      ".site .s-c.s-c.s-c{font-size:20px}",
    ]);
    expect(nodeClass("row")).toBe("s-row");
  });
  it("is empty for a page with no styles, and leaves out a node whose style says nothing", () => {
    expect(buildSiteCss(withBlocks([para("a"), box("b", [], {})]), images)).toBe("");
  });
  it("draws a background with the address the caller gives for the image, and skips it when there is none", () => {
    const content = withBlocks([box("hero", [], { bgImage: "asset-1", background: "soft" }), box("other", [], { bgImage: "asset-9" })]);
    const sheet = buildSiteCss(content, images);
    expect(sheet).toContain('background-image:url("/app/s/marina/m/asset-1")');
    expect(sheet).not.toContain("asset-9");
    expect(sheet).toContain("background-color:var(--site-soft)");
  });
  it("does not write a rule for an identifier that is not what the schema allows", () => {
    const content = withBlocks([para("ok-1", { gap: "4px" }), { ...para("bad id{}", { gap: "4px" }) } as Block, para("UPPER", { gap: "4px" })]);
    expect(buildSiteCss(content, images)).toBe(".site .s-ok-1.s-ok-1.s-ok-1{gap:4px}");
  });
  it("only writes what passes, so a document that is a valid site makes a sheet with a closed alphabet", () => {
    const content = withBlocks([
      box("a", [para("b", { color: "#abcdef", margin: { left: "auto" }, radius: "8px", shadow: "md" })], { display: "grid", columns: 2, gap: "1rem", background: "accent", bgImage: "asset-1" }),
    ]);
    expect(siteContent.safeParse(content).success).toBe(true);
    const sheet = buildSiteCss(content, images);
    expect(sheet).toMatch(/^[A-Za-z0-9 #%.,:;(){}\n_/@"\-]+$/);
    // One rule per line, each opening and closing once.
    for (const line of sheet.split("\n")) expect(line).toMatch(/^\.site \.s-[a-z0-9-]+(\.s-[a-z0-9-]+){2}\{[^{}]*\}$/);
  });
});
