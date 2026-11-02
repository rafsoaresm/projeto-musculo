import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { allNodes, pagesOf, publishIssues, siteContent, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import { SITE_KITS, kitContent } from "@/modules/meu-site/site-kits";
import { SiteRenderer } from "@/modules/meu-site/renderer";

const every = (content: SiteContent): SiteNode[] => [...allNodes(content.blocks), ...pagesOf(content).flatMap((page) => allNodes(page.blocks))];
/** Every text a visitor could read, from the document (the names of nodes are hints for the editor, not page text). */
function texts(content: SiteContent): string[] {
  const out: string[] = [];
  for (const node of every(content)) {
    for (const [key, value] of Object.entries(node)) {
      if (["id", "name", "type", "tag", "size", "ratio", "illustration", "assetId", "channel", "page", "anchor", "level", "componentId"].includes(key)) continue;
      if (typeof value === "string" && value) out.push(value);
    }
    if (node.type === "faq") for (const item of node.items) out.push(item.question, item.answer);
  }
  return out.filter(Boolean);
}

describe("the three complete sites (0.63)", () => {
  for (const kit of SITE_KITS) {
    describe(kit, () => {
      const content = kitContent(kit, "Marina Costa");
      it("is a valid document with the home page and four pages in the menu", () => {
        expect(() => siteContent.parse(content)).not.toThrow();
        expect(pagesOf(content).map((page) => [page.title, page.slug])).toEqual([
          ["Sobre", "sobre"],
          ["Serviços e planos", "servicos-e-planos"],
          ["Depoimentos", "depoimentos"],
          ["Contato", "contato"],
        ]);
        expect(pagesOf(content).every((page) => page.inMenu !== false)).toBe(true);
        expect(every(content).length).toBeLessThan(400);
        // An 80-character name still fits.
        expect(() => siteContent.parse(kitContent(kit, "M".repeat(80)))).not.toThrow();
      });
      it("has the name of the site as its first title, and identifiers of its own every time", () => {
        const first = allNodes(content.blocks).find((node) => node.type === "heading");
        expect(first && first.type === "heading" ? first.text : "").toBe("Marina Costa");
        const ids = every(content).map((node) => node.id);
        expect(new Set(ids).size).toBe(ids.length);
        const other = new Set(every(kitContent(kit, "x")).map((node) => node.id));
        expect(ids.some((id) => other.has(id))).toBe(false);
      });
      it("invents no number, credential, result or testimony", () => {
        const written = texts(content).join(" | ");
        expect(written).not.toMatch(/\d/);
        expect(written).not.toMatch(/CREF|garant|resultado|melhor|R\$|%|anos de/i);
        for (const node of every(content)) if (node.type === "quote") expect([node.quote, node.author, node.authorized]).toEqual(["", "", false]);
      });
      it("draws its pictures until a photo is chosen, and publishes with nothing that stops it", () => {
        const images = every(content).filter((node) => node.type === "image");
        expect(images.length).toBeGreaterThan(0);
        for (const image of images) if (image.type === "image") expect([image.assetId, image.alt, Boolean(image.illustration)]).toEqual(["", "", true]);
        // As on a real publication, with the images of the library: a drawing is not "an image no longer in the library".
        const issues = publishIssues(content, new Set(), new Set(["outra-imagem"]));
        expect(issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
        expect(issues.map((issue) => issue.message).join(" ")).not.toMatch(/escolha a imagem|não está mais na biblioteca/);
      });
      it("on the public page shows the drawings and no empty band, empty testimony or unanswered question", () => {
        for (const page of [content, ...pagesOf(content).map((entry) => ({ ...content, blocks: entry.blocks }))]) {
          const html = renderToStaticMarkup(createElement(SiteRenderer, { content: page, images: () => null }));
          expect(html).not.toContain("site-image-empty");
          expect(html).not.toContain("site-quote");
          expect(html).not.toContain("<img");
        }
        const home = renderToStaticMarkup(createElement(SiteRenderer, { content, images: () => null }));
        expect(home).toContain('data-illustration="');
        expect(home).toContain('aria-hidden="true"');
        expect(home).not.toContain("url(");
      });
      it("keeps the empty sections in the Editor Guiado's preview, where they are outlined and chosen before they are written", () => {
        const testimonies = pagesOf(content).find((entry) => entry.slug === "depoimentos")!;
        const page = { ...content, blocks: testimonies.blocks };
        const located = renderToStaticMarkup(createElement(SiteRenderer, { content: page, images: () => null, locate: { selected: null } }));
        for (const block of testimonies.blocks) expect(located).toContain(`data-guided-section="${block.id}"`);
        expect(located).toContain("site-quote");
      });
    });
  }
});

describe("what an empty container keeps on the public page", () => {
  const base = kitContent("personal", "Marina Costa");
  const box = (over: object): SiteNode => ({ id: "caixa", type: "box", tag: "section", children: [{ id: "t", type: "heading", level: 2, text: "" }], ...over }) as unknown as SiteNode;
  const html = (blocks: SiteNode[]) => renderToStaticMarkup(createElement(SiteRenderer, { content: { ...base, blocks, pages: [] }, images: () => null }));
  it("leaves out a band whose texts are all empty", () => {
    expect(html([box({})])).not.toContain('class="site-box');
  });
  it("keeps one with a background picture; one a button points to is left out with the button's link", () => {
    expect(html([box({ style: { bgImage: "a1" } })])).toContain("site-box");
    expect(html([box({ styleMobile: { bgImage: "a1" } })])).toContain("site-box");
    const button = { id: "b", type: "button", label: "Ver", channel: "anchor", anchor: "caixa" } as unknown as SiteNode;
    const out = html([button, box({})]);
    expect(out).not.toContain("site-box");
    expect(out).not.toContain('href="#');
  });
  it("leaves out one holding only an unanswered question list", () => {
    const faq = { id: "f", type: "faq", eyebrow: "", heading: "Perguntas", items: [{ question: "Como?", answer: "" }] } as unknown as SiteNode;
    expect(html([box({ children: [faq] })])).not.toContain("site-box");
  });
});
