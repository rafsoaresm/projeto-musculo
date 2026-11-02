import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOME, allNodes, publishIssues, siteContent, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import { SITE_MODELS_V1 } from "@/modules/meu-site/models";
import { DEMO_PHOTOS, DEMO_PREFIX } from "@/modules/meu-site/models/demo-photos";
import { SiteRenderer } from "@/modules/meu-site/renderer";
import { buildSiteCss } from "@/modules/meu-site/site-css";
import { publicCssImages } from "@/modules/meu-site/image-urls";
import { siteNav } from "@/modules/meu-site/site-nav";
import { sectionFields, withPageField } from "@/modules/meu-site/guided-model";
import { existsSync } from "node:fs";

const texts = (content: SiteContent) =>
  allNodes(content.blocks).flatMap((node: SiteNode) => {
    const record = node as unknown as Record<string, unknown>;
    return ["text", "label", "quote", "author", "eyebrow", "heading"].flatMap((key) => (typeof record[key] === "string" && record[key] ? [record[key] as string] : []));
  });
const render = (content: SiteContent, demoFolder?: string) =>
  renderToStaticMarkup(createElement(SiteRenderer, { content, images: () => null, nav: siteNav(content, HOME, () => "/s/x"), ...(demoFolder ? { demoFolder } : null) }));

describe("the site models of the handoff V1", () => {
  it("are four, with distinct keys and labels that are not the handoff's preset names", () => {
    expect(SITE_MODELS_V1.map((model) => model.key)).toEqual(["trainix", "fitnova", "sisphus", "race"]);
    for (const model of SITE_MODELS_V1) expect(model.label).not.toMatch(/trainix|fitnova|sisphus|race/i);
  });
  for (const model of SITE_MODELS_V1) {
    describe(model.key, () => {
      const site = model.build("Marina Costa", "site");
      const preview = model.build("Marina Costa", "preview");
      it("is a valid one-page document in both modes, with the menu's links to sections of the page and the WhatsApp button", () => {
        for (const content of [site, preview]) {
          expect(() => siteContent.parse(content)).not.toThrow();
          expect(content.pages ?? []).toEqual([]);
          const ids = new Set(content.blocks.map((block) => block.id));
          expect(content.menu?.length).toBeGreaterThan(0);
          for (const link of content.menu ?? []) expect(ids.has(link.anchor)).toBe(true);
          expect(content.headerCta?.label).toBeTruthy();
          expect(content.theme.palette).toEqual(model.palette);
          expect(content.theme.font).toBe("inter");
        }
        // Every call has identifiers of its own.
        expect(model.build("x", "site").blocks[0]!.id).not.toBe(site.blocks[0]!.id);
      });
      it("starts a site with no number, price, testimony or photo of a person, and nothing that stops the publication", () => {
        const written = texts(site).join(" | ");
        // No amount, percentage, rating or count ("+500", "8+", "98"); step numbers ("01") are not facts.
        expect(written).not.toMatch(/R\$|%|★|\+\s?\d|\d\s?\+|\b[1-9]\d+\b/);
        for (const node of allNodes(site.blocks)) {
          if (node.type === "quote") expect([node.quote, node.author, node.authorized]).toEqual(["", "", false]);
          if (node.type === "image" && node.demo) expect(node.demo).not.toMatch(/coach/);
        }
        expect(publishIssues(site, new Set(), new Set()).filter((issue) => issue.severity === "blocking")).toEqual([]);
      });
      it("shows the model's samples only in the preview, and its photos only while the site is being made", () => {
        expect(texts(preview).join(" ").length).toBeGreaterThan(texts(site).join(" ").length);
        const published = render(site);
        expect(published).not.toContain("site-models/");
        expect(published).not.toContain(DEMO_PREFIX);
        expect(buildSiteCss(site, publicCssImages({}))).not.toMatch(/modelo:|site-models/);
        expect(render(preview, "/t/site-models/")).toContain("/t/site-models/");
        for (const node of allNodes(preview.blocks))
          if (node.type === "image" && node.demo) expect(existsSync(`public/site-models/${DEMO_PHOTOS[node.demo].file}`), node.demo).toBe(true);
      });
      it("lets the banner of the highlight be swapped in the Editor Guiado; cleared, a photo of the person leaves no background", () => {
        const withBg = site.blocks.find((block) => sectionFields(site, HOME, block.id).some((field) => field.label.startsWith("Imagem de fundo")));
        if (!withBg) return;
        const field = sectionFields(site, HOME, withBg.id).find((entry) => entry.label.startsWith("Imagem de fundo"))!;
        const swapped = withPageField(site, HOME, field.key, "a1b2c3");
        expect(sectionFields(swapped, HOME, withBg.id).find((entry) => entry.key === field.key)?.value).toBe("a1b2c3");
        // Cleared while it is the sample, the sample stays (it is what "none" means for a model's banner).
        expect(withPageField(site, HOME, field.key, "")).toBe(site);
        const cleared = withPageField(swapped, HOME, field.key, "");
        const box = cleared.blocks.find((block) => block.id === withBg.id)!;
        expect(box.style?.bgImage).toBeUndefined();
      });
    });
  }
});
