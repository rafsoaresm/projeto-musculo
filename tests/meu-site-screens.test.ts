import { describe, expect, it } from "vitest";
import { emptyBlock, publishIssues, referencedAssetIds, siteContent, type Block, type SiteContent } from "@/modules/meu-site/contracts";
import { MOBILE_MAX, SCREENS, SCREEN_WIDTH, TABLET_MAX, hasAnyStyle, hasOverrides, isHiddenAt, layer, nodeAssetIds, ownStyle, resolveStyle } from "@/modules/meu-site/screens";
import { FRAME_CONTAINER, buildSiteCss } from "@/modules/meu-site/site-css";
import type { CssContext, Style } from "@/modules/meu-site/style";
import { clearStyles, patchStyle, resetScreen, setHidden, toggleHidden, withScreenStyle } from "@/modules/meu-site/style-model";

const images: CssContext = { imageUrl: (assetId) => (assetId === "asset-1" ? "/app/s/marina/m/asset-1" : null) };
const frames: CssContext = { ...images, container: true };
type node0 = { id: string; style?: Style; styleTablet?: Style; styleMobile?: Style };

const content = (blocks: Block[]): SiteContent => ({
  schemaVersion: 3,
  title: "Marina",
  description: "",
  contact: { whatsapp: "", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
});
const para = (id: string, extra: Record<string, unknown> = {}) => ({ ...emptyBlock("paragraph", id), text: "x", ...extra }) as Block;
const box = (id: string, children: Block[], extra: Record<string, unknown> = {}) => ({ ...emptyBlock("box", id), children, ...extra }) as Block;
const sheet = (blocks: Block[], context: CssContext = images) => buildSiteCss(content(blocks), context).split("\n").filter(Boolean);

describe("the sizes of the screen", () => {
  it("are the computer, the tablet and the phone, with the widths of the editor's frames and the limits of the page", () => {
    expect(SCREENS).toEqual(["desktop", "tablet", "mobile"]);
    expect(SCREEN_WIDTH).toEqual({ desktop: 1400, tablet: 800, mobile: 420 });
    expect(TABLET_MAX).toBe(1023);
    expect(MOBILE_MAX).toBe(576);
    // A frame is the size it is called: the tablet's is in the tablet's range, the phone's in the phone's, the computer's above both.
    expect(SCREEN_WIDTH.tablet).toBeLessThanOrEqual(TABLET_MAX);
    expect(SCREEN_WIDTH.tablet).toBeGreaterThan(MOBILE_MAX);
    expect(SCREEN_WIDTH.mobile).toBeLessThanOrEqual(MOBILE_MAX);
    expect(SCREEN_WIDTH.desktop).toBeGreaterThan(TABLET_MAX);
  });
});

describe("the style a node has at a size", () => {
  const node = {
    style: { gap: "24px", color: "#111111", padding: { top: "10px", left: "10px" } },
    styleTablet: { gap: "16px", padding: { left: "6px", bottom: "4px" } },
    styleMobile: { gap: "8px", hidden: true },
  } satisfies { style: Style; styleTablet: Style; styleMobile: Style };

  it("is the computer's own on the computer, and the changes of each size laid over the size below it", () => {
    expect(resolveStyle(node, "desktop")).toEqual(node.style);
    expect(resolveStyle(node, "tablet")).toEqual({ gap: "16px", color: "#111111", padding: { top: "10px", left: "6px", bottom: "4px" } });
    expect(resolveStyle(node, "mobile")).toEqual({ gap: "8px", color: "#111111", padding: { top: "10px", left: "6px", bottom: "4px" }, hidden: true });
  });
  it("is nothing for a node with no style, and a size with no changes of its own is the size below", () => {
    expect(resolveStyle({}, "mobile")).toEqual({});
    expect(resolveStyle({ style: { gap: "4px" } }, "mobile")).toEqual({ gap: "4px" });
    expect(resolveStyle({ styleMobile: { gap: "4px" } }, "desktop")).toEqual({});
    expect(resolveStyle({ styleMobile: { gap: "4px" } }, "tablet")).toEqual({});
  });
  it("does not change what it was given", () => {
    const before = JSON.stringify(node);
    resolveStyle(node, "mobile");
    layer(node.style, node.styleTablet);
    expect(JSON.stringify(node)).toBe(before);
  });
  it("lays padding and margin over each other side by side, not as a whole", () => {
    expect(layer({ margin: { top: "1px", right: "2px" } }, { margin: { right: "9px", bottom: "3px" } })).toEqual({ margin: { top: "1px", right: "9px", bottom: "3px" } });
    expect(layer(undefined, { padding: { top: "1px" } })).toEqual({ padding: { top: "1px" } });
    expect(layer({ padding: { top: "1px" } }, undefined)).toEqual({ padding: { top: "1px" } });
  });
  it("knows what a size keeps of its own, and when the node has any style at all", () => {
    expect(ownStyle(node, "tablet")).toBe(node.styleTablet);
    expect(hasOverrides(node, "tablet")).toBe(true);
    expect(hasOverrides({ style: { gap: "4px" } }, "mobile")).toBe(false);
    expect(hasOverrides(node, "desktop")).toBe(false);
    expect(hasAnyStyle({})).toBe(false);
    expect(hasAnyStyle({ style: {}, styleTablet: {} })).toBe(false);
    expect(hasAnyStyle({ styleMobile: { gap: "4px" } })).toBe(true);
  });
  it("is hidden at a size when it is hidden there or below, until a size says it is shown", () => {
    expect(isHiddenAt({ style: { hidden: true } }, "desktop")).toBe(true);
    expect(isHiddenAt({ style: { hidden: true } }, "tablet")).toBe(true);
    expect(isHiddenAt({ style: { hidden: true } }, "mobile")).toBe(true);
    expect(isHiddenAt({ style: { hidden: true }, styleTablet: { hidden: false } }, "tablet")).toBe(false);
    expect(isHiddenAt({ style: { hidden: true }, styleTablet: { hidden: false } }, "mobile")).toBe(false);
    expect(isHiddenAt({ style: { hidden: true }, styleMobile: { hidden: false } }, "tablet")).toBe(true);
    expect(isHiddenAt({ styleTablet: { hidden: true } }, "desktop")).toBe(false);
    expect(isHiddenAt({ styleTablet: { hidden: true } }, "mobile")).toBe(true);
    expect(isHiddenAt({ style: { hidden: false } }, "desktop")).toBe(false);
  });
  it("uses the images of the library at any size, each once", () => {
    expect(nodeAssetIds({ style: { bgImage: "a" }, styleTablet: { bgImage: "b" }, styleMobile: { bgImage: "a" } })).toEqual(["a", "b"]);
    expect(nodeAssetIds({ styleMobile: { bgImage: "z" } })).toEqual(["z"]);
    expect(nodeAssetIds({ style: { gap: "4px" } })).toEqual([]);
  });
});

describe("a document with styles for the tablet and the phone", () => {
  const withSizes = [box("row", [para("a")], { style: { display: "flex", gap: "24px" }, styleTablet: { gap: "16px" }, styleMobile: { direction: "column", hidden: false } })];

  it("is accepted, in a container and in an element, and the server reads the sizes as strictly as the computer's style", () => {
    expect(siteContent.safeParse(content([...withSizes, para("b", { styleTablet: { fontSize: "18px" }, styleMobile: { textAlign: "center" } })])).success).toBe(true);
    for (const bad of [{ gap: "99999px" }, { unknown: 1 }, { display: "none" }, { hidden: "yes" }, { padding: { top: "1px", middle: "2px" } }]) {
      expect(siteContent.safeParse(content([para("b", { styleTablet: bad })])).success, JSON.stringify(bad)).toBe(false);
      expect(siteContent.safeParse(content([para("b", { styleMobile: bad })])).success, JSON.stringify(bad)).toBe(false);
      expect(siteContent.safeParse(content([box("c", [], { styleTablet: bad })])).success, JSON.stringify(bad)).toBe(false);
    }
    // There is no fourth size.
    expect(siteContent.safeParse(content([para("b", { styleWatch: { gap: "4px" } })])).success).toBe(false);
  });
  it("counts the images of the sizes among the ones the page uses, and asks for them to be in the library when publishing", () => {
    const page = content([box("hero", [], { styleTablet: { bgImage: "asset-t" }, style: { bgImage: "asset-d" } }), para("p", { styleMobile: { bgImage: "asset-m" } })]);
    expect(referencedAssetIds(page).sort()).toEqual(["asset-d", "asset-m", "asset-t"]);
    const issues = publishIssues(page, new Set(), new Set(["asset-d"]));
    const background = issues.filter((issue) => issue.message.includes("imagem de fundo"));
    expect(background.map((issue) => issue.blockId).sort()).toEqual(["hero", "p"]);
    expect(publishIssues(page, new Set(), new Set(["asset-d", "asset-t", "asset-m"])).filter((issue) => issue.message.includes("imagem de fundo"))).toEqual([]);
  });
});

describe("the stylesheet of a page with sizes", () => {
  it("is what it was for a page that has only the computer's styles", () => {
    expect(sheet([box("row", [para("a", { style: { color: "#112233" } })], { style: { display: "flex", gap: "8px" } })])).toEqual([
      ".site .s-row.s-row.s-row{display:flex;gap:8px}",
      ".site .s-a.s-a.s-a{color:#112233;--site-ink:#112233;--site-text:#112233}",
    ]);
  });
  it("writes for the tablet only what differs from the computer, in a query that holds up to the tablet's width", () => {
    expect(sheet([box("row", [], { style: { display: "flex", gap: "24px", direction: "row" }, styleTablet: { gap: "16px" } })])).toEqual([
      ".site .s-row.s-row.s-row{display:flex;flex-direction:row;gap:24px}",
      "@media (max-width:1023px){.site .s-row.s-row.s-row{gap:16px}}",
    ]);
  });
  it("writes for the phone what differs from the tablet, after the tablet's rules, even when it goes back to what the computer had", () => {
    const rows = sheet([
      box("a", [], { style: { gap: "24px" }, styleTablet: { gap: "16px" }, styleMobile: { gap: "24px" } }),
      box("b", [], { style: { gap: "4px" }, styleMobile: { gap: "2px" } }),
    ]);
    expect(rows).toEqual([
      ".site .s-a.s-a.s-a{gap:24px}",
      ".site .s-b.s-b.s-b{gap:4px}",
      "@media (max-width:1023px){.site .s-a.s-a.s-a{gap:16px}}",
      "@media (max-width:576px){.site .s-a.s-a.s-a{gap:24px}.site .s-b.s-b.s-b{gap:2px}}",
    ]);
  });
  it("puts all the computer's rules first, then all the tablet's, then all the phone's, whatever the order of the nodes", () => {
    const rows = sheet([
      para("first", { styleMobile: { fontSize: "12px" } }),
      para("second", { style: { fontSize: "20px" }, styleTablet: { fontSize: "16px" } }),
      para("third", { style: { fontSize: "30px" } }),
    ]);
    expect(rows).toEqual([
      ".site .s-second.s-second.s-second{font-size:20px}",
      ".site .s-third.s-third.s-third{font-size:30px}",
      "@media (max-width:1023px){.site .s-second.s-second.s-second{font-size:16px}}",
      "@media (max-width:576px){.site .s-first.s-first.s-first{font-size:12px}}",
    ]);
  });
  it("writes a node that has styles only for the tablet or the phone, with nothing for the computer", () => {
    expect(sheet([para("p", { styleTablet: { textAlign: "center" } })])).toEqual(["@media (max-width:1023px){.site .s-p.s-p.s-p{text-align:center}}"]);
  });
  it("lets a property that depends on another follow it: a size of the image, a color of the border", () => {
    const rows = sheet([
      box("bg", [], { style: { bgImage: "asset-1" }, styleTablet: { bgSize: "contain", bgPosition: "top" } }),
      box("line", [], { style: { borderWidth: "2px" }, styleMobile: { borderColor: "accent", borderStyle: "dashed" } }),
    ]);
    expect(rows[0]).toBe('.site .s-bg.s-bg.s-bg{background-image:url("/app/s/marina/m/asset-1");background-size:cover;background-position:center;background-repeat:no-repeat}');
    expect(rows[1]).toBe(".site .s-line.s-line.s-line{border-width:2px;border-style:solid;border-color:var(--site-line)}");
    expect(rows[2]).toBe("@media (max-width:1023px){.site .s-bg.s-bg.s-bg{background-size:contain;background-position:top}}");
    expect(rows[3]).toBe("@media (max-width:576px){.site .s-line.s-line.s-line{border-style:dashed;border-color:var(--site-accent)}}");
  });
  it("changes one side of the padding without touching the others", () => {
    const rows = sheet([box("a", [], { style: { padding: { top: "10px", left: "10px" } }, styleTablet: { padding: { left: "4px" } } })]);
    expect(rows).toEqual([".site .s-a.s-a.s-a{padding-top:10px;padding-left:10px}", "@media (max-width:1023px){.site .s-a.s-a.s-a{padding-left:4px}}"]);
  });
  it("writes nothing for a size that says what the size below already says", () => {
    expect(sheet([box("a", [], { style: { gap: "8px" }, styleTablet: { gap: "8px" }, styleMobile: { gap: "8px" } })])).toEqual([".site .s-a.s-a.s-a{gap:8px}"]);
    expect(sheet([para("a", { styleTablet: { hidden: false } })])).toEqual([]);
  });
  it("uses the frame instead of the window in the editor, and the frame's width for vw", () => {
    const blocks = [box("a", [], { style: { width: "50vw" }, styleTablet: { width: "80vw", gap: "8px" }, styleMobile: { hidden: true } })];
    expect(sheet(blocks, frames)).toEqual([
      ".site .s-a.s-a.s-a{width:50cqw}",
      `@container ${FRAME_CONTAINER} (max-width:1023px){.site .s-a.s-a.s-a{gap:8px;width:80cqw}}`,
      `@container ${FRAME_CONTAINER} (max-width:576px){.site .s-a.s-a.s-a{display:none}}`,
    ]);
    expect(sheet(blocks, images).join("\n")).toContain("width:50vw");
    expect(sheet(blocks, images).join("\n")).not.toContain("cqw");
    expect(sheet(blocks, images).join("\n")).not.toContain("@container");
    expect(sheet(blocks, frames).join("\n")).not.toContain("@media");
    expect(sheet(blocks, frames).join("\n")).not.toContain("vw");
  });
});

describe("hiding a block at a size", () => {
  const hideRules = (extra: Record<string, unknown>, context: CssContext = images) => sheet([para("p", extra)], context);
  const media = (condition: string) => `@media ${condition}{.site .s-p.s-p.s-p{display:none}}`;

  it("hides at the computer only above the tablet's limit, at the tablet only between the two limits, and at the phone only up to its limit", () => {
    expect(hideRules({ style: { hidden: true }, styleTablet: { hidden: false } })).toEqual([media("(min-width:1023.02px)")]);
    expect(hideRules({ styleTablet: { hidden: true }, styleMobile: { hidden: false } })).toEqual([media("(min-width:576.02px) and (max-width:1023px)")]);
    expect(hideRules({ styleMobile: { hidden: true } })).toEqual([media("(max-width:576px)")]);
  });
  it("joins the sizes that are next to each other, and writes two rules for the two that are not", () => {
    expect(hideRules({ style: { hidden: true }, styleMobile: { hidden: false } })).toEqual([media("(min-width:576.02px)")]);
    expect(hideRules({ styleTablet: { hidden: true } })).toEqual([media("(max-width:1023px)")]);
    expect(hideRules({ style: { hidden: true }, styleTablet: { hidden: false }, styleMobile: { hidden: true } })).toEqual([media("(min-width:1023.02px)"), media("(max-width:576px)")]);
  });
  it("hides everywhere without a query when it is hidden at all three", () => {
    expect(hideRules({ style: { hidden: true } })).toEqual([".site .s-p.s-p.s-p{display:none}"]);
  });
  it("is written after every other rule, so it wins over a display set above it", () => {
    const rows = sheet([
      box("a", [], { style: { display: "flex", hidden: true }, styleTablet: { display: "grid", hidden: false } }),
      box("b", [], { style: { gap: "8px" }, styleMobile: { gap: "4px" } }),
    ]);
    expect(rows).toEqual([
      ".site .s-a.s-a.s-a{display:flex}",
      ".site .s-b.s-b.s-b{gap:8px}",
      "@media (max-width:1023px){.site .s-a.s-a.s-a{display:grid}}",
      "@media (max-width:576px){.site .s-b.s-b.s-b{gap:4px}}",
      "@media (min-width:1023.02px){.site .s-a.s-a.s-a{display:none}}",
    ]);
  });
  it("groups the blocks hidden under the same condition into one rule", () => {
    const rows = sheet([para("x", { styleMobile: { hidden: true } }), para("y", { styleMobile: { hidden: true } })]);
    expect(rows).toEqual(["@media (max-width:576px){.site .s-x.s-x.s-x,.site .s-y.s-y.s-y{display:none}}"]);
  });
  it("uses the container of the frame in the editor", () => {
    expect(hideRules({ styleMobile: { hidden: true } }, frames)).toEqual([`@container ${FRAME_CONTAINER} (max-width:576px){.site .s-p.s-p.s-p{display:none}}`]);
  });
});

describe("what the sheet of a page with sizes is made of", () => {
  it("is a closed alphabet, at every size, and has no rule that opens inside another but the query's", () => {
    const page = content([
      box("a", [para("b", { style: { color: "#abcdef", hidden: true }, styleTablet: { margin: { left: "auto" }, hidden: false }, styleMobile: { fontSize: "2rem" } })], {
        style: { display: "grid", columns: 2, gap: "1rem", bgImage: "asset-1", width: "40vw" },
        styleTablet: { columns: 1, bgSize: "contain" },
        styleMobile: { shadow: "md", hidden: true },
      }),
    ]);
    expect(siteContent.safeParse(page).success).toBe(true);
    for (const context of [images, frames]) {
      const text = buildSiteCss(page, context);
      expect(text).toMatch(/^[A-Za-z0-9 #%.,:;(){}\n_/@"\-]+$/);
      for (const line of text.split("\n")) {
        const body = line.replace(/^@(media|container)[^{]*\{/, "").replace(/\}$/, "");
        const atRule = line.startsWith("@");
        expect(atRule ? body : line).toMatch(/^(\.site [.A-Za-z0-9,\- ]+\{[^{}]*\})+$/);
      }
    }
  });
});

describe("changing the style of one size", () => {
  const node = { id: "n", style: { gap: "8px" }, styleTablet: { gap: "4px" } } as { id: string } & { style?: Style; styleTablet?: Style; styleMobile?: Style };

  it("replaces the style of a size and takes the key away when there is nothing left", () => {
    expect(withScreenStyle(node, "mobile", { gap: "2px" })).toEqual({ ...node, styleMobile: { gap: "2px" } });
    expect(withScreenStyle(node, "tablet", undefined)).toEqual({ id: "n", style: { gap: "8px" } });
    expect("styleTablet" in withScreenStyle(node, "tablet", undefined)).toBe(false);
    expect(withScreenStyle(node, "desktop", { gap: "9px" }).style).toEqual({ gap: "9px" });
    expect(node.styleTablet).toEqual({ gap: "4px" });
  });
  it("undoes a size's own changes, and the computer has none to undo", () => {
    expect(resetScreen(node, "tablet")).toEqual({ id: "n", style: { gap: "8px" } });
    expect(resetScreen(node, "desktop")).toBe(node);
    expect(resetScreen({ id: "n" } as typeof node, "mobile")).toEqual({ id: "n" });
  });
  it("takes all the styles away", () => {
    expect(clearStyles({ id: "n", style: { gap: "8px" }, styleTablet: { gap: "4px" }, styleMobile: { gap: "2px" } })).toEqual({ id: "n" });
  });
  it("hides and shows at a size, and writes nothing where the size already inherits that", () => {
    const shown = { id: "n" } as typeof node;
    // Hide at the computer: it carries down.
    const hiddenAtComputer = toggleHidden(shown, "desktop");
    expect(hiddenAtComputer.style).toEqual({ hidden: true });
    expect(isHiddenAt(hiddenAtComputer, "mobile")).toBe(true);
    // Show again at the tablet: the tablet says so, and the phone inherits that.
    const shownAtTablet = toggleHidden(hiddenAtComputer, "tablet");
    expect(shownAtTablet.styleTablet).toEqual({ hidden: false });
    expect(isHiddenAt(shownAtTablet, "desktop")).toBe(true);
    expect(isHiddenAt(shownAtTablet, "tablet")).toBe(false);
    expect(isHiddenAt(shownAtTablet, "mobile")).toBe(false);
    // Hide it at the tablet again: the tablet inherits "hidden" from the computer, so nothing is kept for the tablet.
    const hiddenAgain = toggleHidden(shownAtTablet, "tablet");
    expect("styleTablet" in hiddenAgain).toBe(false);
    expect(isHiddenAt(hiddenAgain, "tablet")).toBe(true);
    // Show at the computer: nothing is kept either.
    const shownAtComputer = toggleHidden(hiddenAgain, "desktop");
    expect(shownAtComputer.style).toBeUndefined();
    expect(isHiddenAt(shownAtComputer, "tablet")).toBe(false);
    // The other things in a size's style are kept.
    expect(setHidden({ id: "n", styleMobile: { gap: "2px" } } as typeof node, "mobile", true).styleMobile).toEqual({ gap: "2px", hidden: true });
    expect(setHidden({ id: "n", styleMobile: { gap: "2px", hidden: true } } as typeof node, "mobile", false).styleMobile).toEqual({ gap: "2px" });
  });
  it("shows at the phone what the tablet hides, by saying so for the phone alone", () => {
    // The phone follows the tablet: hidden there, so toggling the phone says "shown" for the phone, and the computer is not the one it is compared to.
    const node = { id: "n", styleTablet: { hidden: true } } as node0;
    expect(isHiddenAt(node, "desktop")).toBe(false);
    expect(isHiddenAt(node, "mobile")).toBe(true);
    const shownAtPhone = toggleHidden(node, "mobile");
    expect(shownAtPhone.styleMobile).toEqual({ hidden: false });
    expect(isHiddenAt(shownAtPhone, "mobile")).toBe(false);
    expect(isHiddenAt(shownAtPhone, "tablet")).toBe(true);
    // And the other way: shown at the tablet explicitly, hidden at the phone is kept for the phone.
    const hiddenAtPhone = toggleHidden({ id: "n", styleTablet: { hidden: false }, style: { hidden: true } } as node0, "mobile");
    expect(hiddenAtPhone.styleMobile).toEqual({ hidden: true });
  });
  it("patches one size without touching the others", () => {
    const patched = withScreenStyle(node, "tablet", patchStyle(node.styleTablet, { gap: "6px", color: "#112233" }));
    expect(patched.styleTablet).toEqual({ gap: "6px", color: "#112233" });
    expect(patched.style).toEqual({ gap: "8px" });
  });
});

describe("a size that does not want the background image of the size below", () => {
  it("says \"no image\" with an empty image, and the sheet ends the image there only", () => {
    const rows = sheet([box("hero", [], { style: { bgImage: "asset-1", background: "soft" }, styleMobile: { bgImage: "" } })]);
    expect(rows).toEqual([
      '.site .s-hero.s-hero.s-hero{background-color:var(--site-soft);background-image:url("/app/s/marina/m/asset-1");background-size:cover;background-position:center;background-repeat:no-repeat}',
      "@media (max-width:576px){.site .s-hero.s-hero.s-hero{background-image:none}}",
    ]);
  });
  it("lets a smaller size bring the image back after a size between took it off, and says nothing where the size below has none", () => {
    const rows = sheet([box("hero", [], { style: { bgImage: "asset-1" }, styleTablet: { bgImage: "" }, styleMobile: { bgImage: "asset-1" } })]);
    expect(rows[1]).toBe("@media (max-width:1023px){.site .s-hero.s-hero.s-hero{background-image:none}}");
    // The tablet had no image, so the phone brings the whole background back: the image and what goes with it.
    expect(rows[2]).toBe(
      '@media (max-width:576px){.site .s-hero.s-hero.s-hero{background-image:url("/app/s/marina/m/asset-1");background-size:cover;background-position:center;background-repeat:no-repeat}}',
    );
    // Taken off at the tablet, the phone is inside that range: nothing more to say there.
    expect(sheet([box("hero", [], { style: { bgImage: "asset-1" }, styleTablet: { bgImage: "" } })])).toHaveLength(2);
    // An empty image at the computer is no image, and no key of the sheet.
    expect(sheet([box("hero", [], { style: { bgImage: "" } })])).toEqual([]);
  });
  it("does not count an empty image as a use of the library", () => {
    expect(nodeAssetIds({ style: { bgImage: "a" }, styleMobile: { bgImage: "" } })).toEqual(["a"]);
    expect(referencedAssetIds(content([box("x", [], { styleMobile: { bgImage: "" } })]))).toEqual([]);
  });
});
