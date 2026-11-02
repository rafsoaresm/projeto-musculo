import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { allNodes, type SiteNode } from "@/modules/meu-site/contracts";
import { SITE_MODELS_V1 } from "@/modules/meu-site/models";
import { CONTAINER, GUTTER } from "@/modules/meu-site/models/layout";
import { MOBILE_MAX, SCREENS, TABLET_MAX, resolveStyle, type Screen } from "@/modules/meu-site/screens";
import { FRAME_CONTAINER } from "@/modules/meu-site/site-css";
import { PREVIEW_PX, previewScale } from "@/modules/meu-site/preview-scale";

/** 0.70: one content column for every section of every model, the preview at the width of a real screen, words that break only when they must. */
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const px = (value: string | undefined) => (value ? Number.parseFloat(value) : 0);
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

/** The way from a section down to its column (the box as wide as the container): the sections' side paddings add up to the gutter. */
function pathToColumn(node: SiteNode): SiteNode[] | null {
  if (node.style?.maxWidth === CONTAINER) return [node];
  for (const child of "children" in node && Array.isArray(node.children) ? (node.children as SiteNode[]) : []) {
    const below = pathToColumn(child);
    if (below) return [node, ...below];
  }
  return null;
}

describe("the content column of the site models", () => {
  for (const model of SITE_MODELS_V1) {
    for (const mode of ["site", "preview"] as const) {
      const content = model.build("Marina Costa", mode);
      it(`${model.key} (${mode}): every section puts its content in a column of ${CONTAINER}, the gutter away from the edge at every size`, () => {
        for (const block of content.blocks) {
          const path = pathToColumn(block);
          expect(path, block.name).not.toBeNull();
          const column = path!.at(-1)!;
          // Centred, and as wide as it may be (an item of a flex column would otherwise shrink to its content).
          expect(column.style?.margin?.left, block.name).toBe("auto");
          expect(column.style?.margin?.right, block.name).toBe("auto");
          for (const screen of SCREENS) {
            const around = path!.slice(0, -1).map((node) => resolveStyle(node, screen));
            const left = around.reduce((sum, style) => sum + px(style.padding?.left), 0);
            const right = around.reduce((sum, style) => sum + px(style.padding?.right), 0);
            const gutter = px(GUTTER[screen as Screen]);
            expect([block.name, screen, left, right]).toEqual([block.name, screen, gutter, gutter]);
          }
        }
      });
    }
  }

  it("the contact form's card fills its column: text on the left and the card on the right on a computer, one under the other below", () => {
    for (const model of SITE_MODELS_V1) {
      const content = model.build("Marina Costa", "site");
      const form = allNodes(content.blocks).find((node) => node.type === "contactForm")!;
      expect(form.style?.maxWidth, model.key).toBeUndefined();
      const pair = allNodes(content.blocks).find((node) => node.type === "box" && node.children.some((child) => child.id === form.id))!;
      expect([pair.style?.display, pair.style?.columns, resolveStyle(pair, "tablet").columns, resolveStyle(pair, "mobile").columns]).toEqual(["grid", 2, 1, 1]);
    }
  });

  it("the race model's text next to the photo keeps 320 px on a computer, and gives it up where the photo goes above it", () => {
    const race = SITE_MODELS_V1.find((model) => model.key === "race")!.build("Marina Costa", "site");
    const editorial = race.blocks.find((block) => block.name === "Apresentação com imagem")!;
    const text = allNodes([editorial]).find((node) => node.type === "box" && node.name === "Texto")!;
    expect(SCREENS.map((screen) => resolveStyle(text, screen).minWidth)).toEqual(["320px", "0px", "0px"]);
  });

  it("puts a photo beside a text only on a computer: on a tablet and a phone the parts of every side-by-side box go one under the other", () => {
    for (const model of SITE_MODELS_V1) {
      for (const node of allNodes(model.build("Marina Costa", "preview").blocks)) {
        if (node.type !== "box" || !node.children.some((child) => child.type === "image")) continue;
        const side = (screen: Screen) => {
          const style = resolveStyle(node, screen);
          return (style.display === "grid" && (style.columns ?? 1) > 1) || (style.display === "flex" && style.direction === "row");
        };
        if (!side("desktop")) continue;
        expect([model.key, node.name, side("tablet"), side("mobile")]).toEqual([model.key, node.name, false, false]);
      }
    }
  });

  it("lays the cards out one a row on a tablet (two of a 577 px tablet would be under 260 px), and keeps the stats in a row", () => {
    for (const model of SITE_MODELS_V1) {
      for (const node of allNodes(model.build("Marina Costa", "preview").blocks)) {
        if (node.type !== "box" || node.style?.display !== "grid" || node.style.columns !== 3) continue;
        expect([model.key, node.name, resolveStyle(node, "tablet").columns]).toEqual([model.key, node.name, node.name === "Métricas" ? 3 : 1]);
      }
    }
  });

  it("the samples of the preview read as a page would, and a created site still starts without them", () => {
    for (const model of SITE_MODELS_V1) {
      const said = (mode: "site" | "preview") => JSON.stringify(model.build("Marina Costa", mode).blocks);
      expect(said("preview"), model.key).not.toMatch(/ilustrativ|demonstração|não publicar/i);
      expect(said("site"), model.key).not.toMatch(/nível de satisfação|98%|\+500/);
    }
  });
});

describe("the page's stylesheet", () => {
  it("has the container and the gutters the models use, switched at the sizes of screens.ts, on the window and on an editor's frame", () => {
    expect(rule(".site")).toContain(`--site-container: ${CONTAINER};`);
    expect(rule(".site")).toContain(`--site-gutter: ${GUTTER.desktop};`);
    for (const where of ["@media", `@container ${FRAME_CONTAINER}`]) {
      expect(css).toContain(`${where} (max-width: ${TABLET_MAX}px) {\n  .site {\n    --site-gutter: ${GUTTER.tablet};`);
      expect(css).toContain(`${where} (max-width: ${MOBILE_MAX}px) {\n  .site {\n    --site-gutter: ${GUTTER.mobile};`);
    }
    // The header of a model follows the same column (not the window's width).
    expect(rule('.site[data-site-accent="palette"] .site-header')).toContain("padding: 24px max(var(--site-gutter), calc((100% - var(--site-container)) / 2));");
    expect(css).not.toMatch(/clamp\(20px, 5\.6vw, 80px\)/);
    // One set of sizes: the header and the blocks of the page change where the sections do.
    expect(css).not.toContain("@container site (max-width: 640px)");
    expect(css).toContain(`@container site (max-width: ${MOBILE_MAX}px)`);
  });

  it("breaks a word of the page only when it does not fit a line by itself", () => {
    for (const selector of [".site-brand", ".site-heading", ".site-lead", ".site-text", ".site-hero h1,\n.site-hero h2"]) expect(rule(selector), selector).toContain("overflow-wrap: break-word;");
    const site = css.slice(css.indexOf("\n.site {"), css.indexOf("/* The header of a site model"));
    expect(site).not.toContain("overflow-wrap: anywhere");
  });

  it("makes a phone's links, questions and consent box 44 px targets", () => {
    expect(css).toContain("@container site (max-width: 576px) {\n  .site a.site-link {\n    display: inline-flex;\n    align-items: center;\n    min-height: 44px;\n    min-width: 44px;");
    expect(rule(".site-faq summary")).toContain("min-height: 44px;");
    expect(rule(".site-form .site-form-consent")).toContain("min-height: 44px;");
  });

  it("lets the contact form fill its card", () => {
    expect(rule(".site-contact-form .site-form")).toContain("max-width: none;");
  });

  it("names the preview's frame as the container the editor's rules of size read", () => {
    expect(rule(".guided-frame")).toContain(`container: ${FRAME_CONTAINER} / inline-size;`);
    expect(rule('.guided-frame[data-width="computador"]')).toContain(`width: ${PREVIEW_PX.computador}px;`);
    expect(rule('.guided-frame[data-width="celular"]')).toContain(`width: ${PREVIEW_PX.celular}px;`);
  });

  it("gives the Editor Guiado's editing column softer corners, and only it", () => {
    expect(rule(".guided-panel")).toContain("--guided-radius: 10px;");
    expect(css).toContain(".guided-panel textarea,\n.guided-panel .button,");
    expect(rule(".guided-section-list button")).toContain("border-radius: var(--guided-radius);");
    // The app keeps its pills.
    expect(rule(".button")).toContain("border-radius: var(--radius-button);");
  });
});

describe("the width of the preview", () => {
  it("is the computer's 1280 scaled to the panel, never above its size", () => {
    expect(previewScale(640, "computador")).toBe(0.5);
    expect(previewScale(1600, "computador")).toBe(1);
    expect(previewScale(780, "celular")).toBe(1);
    expect(previewScale(312, "celular")).toBe(0.8);
    expect(previewScale(0, "computador")).toBe(1);
    expect(previewScale(Number.NaN, "celular")).toBe(1);
  });
  it("never swaps the chosen width: a narrow panel shows the computer's 1280 page scaled down, and the phone's 390 only shrinks below 390", () => {
    // A 1280x800 laptop gives the stage about 540 px: still the computer's page.
    expect(previewScale(540, "computador")).toBeCloseTo(540 / 1280);
    expect(previewScale(300, "computador")).toBeCloseTo(300 / 1280);
    expect(previewScale(540, "celular")).toBe(1);
    expect(previewScale(351, "celular")).toBe(0.9);
  });
});
