import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOME, MAX_BLOCKS, allNodes, pageContent, pagesOf, publishIssues, siteContent, type SiteContent } from "@/modules/meu-site/contracts";
import { kitContent, GUIDED_SECTIONS } from "@/modules/meu-site/site-kits";
import { addSection, isHiddenSection, moveSection, removeSection, setSectionHidden } from "@/modules/meu-site/guided-sections";
import { buildSiteCss } from "@/modules/meu-site/site-css";
import { SiteRenderer } from "@/modules/meu-site/renderer";

const site = kitContent("personal", "Marina Costa");
const about = pagesOf(site)[0]!;
const ids = (content: SiteContent, pageId: string) => pageContent(content, pageId).blocks.map((entry) => entry.id);

describe("adding a section from the short list", () => {
  it("offers sections that are valid, written by nobody and with nothing that stops a publication", () => {
    for (const item of GUIDED_SECTIONS) {
      const outcome = addSection(site, HOME, item.key);
      if (!outcome.ok) throw new Error(item.key);
      expect(() => siteContent.parse(outcome.content), item.key).not.toThrow();
      const node = pageContent(outcome.content, HOME).blocks.at(-1)!;
      expect(node.id).toBe(outcome.id);
      // Nothing written for the person: the only words are the labels of buttons and of the form.
      for (const entry of allNodes([node])) {
        if (entry.type === "heading" || entry.type === "paragraph") expect(entry.text, item.key).toBe("");
        if (entry.type === "quote") expect([entry.quote, entry.author, entry.authorized]).toEqual(["", "", false]);
        if (entry.type === "faq") expect(entry.items.every((faq) => !faq.question && !faq.answer)).toBe(true);
      }
      expect(publishIssues(outcome.content, new Set(), new Set()).filter((issue) => issue.severity === "blocking"), item.key).toEqual([]);
    }
  });
  it("goes after the section chosen, on the page being edited, and leaves the other pages as they were", () => {
    const second = ids(site, about.id)[0]!;
    const outcome = addSection(site, about.id, "texto", second);
    if (!outcome.ok) throw new Error("not added");
    expect(ids(outcome.content, about.id)).toEqual([second, outcome.id, ...ids(site, about.id).slice(1)]);
    expect(outcome.content.blocks).toBe(site.blocks);
    // A section that is not on the page: at the end.
    const end = addSection(site, about.id, "texto", "nada");
    if (!end.ok) throw new Error("not added");
    expect(ids(end.content, about.id).at(-1)).toBe(end.id);
  });
  it("says no to what is not on the list and to a full page", () => {
    expect(addSection(site, HOME, "nada")).toEqual({ ok: false, reason: "unknown" });
    let content = site;
    while (pageContent(content, HOME).blocks.length < MAX_BLOCKS) {
      const outcome = addSection(content, HOME, "texto");
      if (!outcome.ok) break;
      content = outcome.content;
    }
    const full = addSection(content, HOME, "texto");
    expect(full.ok).toBe(false);
  });
});

describe("moving and deleting", () => {
  it("moves one place on its page and not past the ends", () => {
    const [a, b] = ids(site, HOME);
    expect(ids(moveSection(site, HOME, b!, -1), HOME).slice(0, 2)).toEqual([b, a]);
    expect(moveSection(site, HOME, a!, -1)).toBe(site);
    expect(moveSection(site, HOME, ids(site, HOME).at(-1)!, 1)).toBe(site);
    expect(moveSection(site, HOME, "nada", 1)).toBe(site);
    const moved = moveSection(site, about.id, ids(site, about.id)[1]!, -1);
    expect(moved.blocks).toBe(site.blocks);
    expect(ids(moved, about.id)[0]).toBe(ids(site, about.id)[1]);
  });
  it("deletes from its page only", () => {
    const first = ids(site, about.id)[0]!;
    const next = removeSection(site, about.id, first);
    expect(ids(next, about.id)).not.toContain(first);
    expect(next.blocks).toBe(site.blocks);
    expect(removeSection(site, about.id, "nada")).toBe(site);
  });
});

describe("hiding a section from the site", () => {
  const target = site.blocks[1]!;
  const hidden = setSectionHidden(site, HOME, target.id, true);
  it("hides it on every size and shows it again as it was", () => {
    expect(isHiddenSection(hidden.blocks[1]!)).toBe(true);
    expect(setSectionHidden(hidden, HOME, target.id, true)).toBe(hidden);
    const shown = setSectionHidden(hidden, HOME, target.id, false);
    expect(shown.blocks[1]).toEqual(target);
    expect(() => siteContent.parse(hidden)).not.toThrow();
  });
  it("overrides a size that showed it, so it is hidden everywhere", () => {
    const partly = { ...site, blocks: site.blocks.map((entry) => (entry.id === target.id ? { ...entry, style: { ...entry.style, hidden: true }, styleMobile: { ...entry.styleMobile, hidden: false } } : entry)) } as SiteContent;
    expect(isHiddenSection(partly.blocks[1]!)).toBe(false);
    const all = setSectionHidden(partly, HOME, target.id, true);
    expect(isHiddenSection(all.blocks[1]!)).toBe(true);
    expect(all.blocks[1]!.styleMobile?.hidden).toBeUndefined();
  });
  it("is left out of the published page's HTML, kept in the editor's preview (where the style sheet hides it), and asks for nothing", () => {
    const html = renderToStaticMarkup(createElement(SiteRenderer, { content: hidden, images: () => null }));
    expect(html).not.toContain(target.id);
    const located = renderToStaticMarkup(createElement(SiteRenderer, { content: hidden, images: () => null, locate: { selected: null } }));
    expect(located).toContain(target.id);
    expect(buildSiteCss(hidden, { imageUrl: () => null })).toMatch(/display:\s*none/);
    // A testimony with no author is a warning; hidden from the site, it is not mentioned at all.
    const quoteSection = { ...site.blocks[1]!, type: "quote", eyebrow: "", quote: "Ótimo", author: "", authorized: false } as unknown as SiteContent["blocks"][number];
    const withQuote = { ...site, blocks: [site.blocks[0]!, quoteSection, ...site.blocks.slice(2)] } as SiteContent;
    const about = (content: SiteContent) => publishIssues(content, new Set()).filter((issue) => issue.blockId === quoteSection.id);
    expect(about(withQuote).map((issue) => issue.severity)).toEqual(["warning"]);
    expect(about(setSectionHidden(withQuote, HOME, quoteSection.id, true))).toEqual([]);
  });
});

describe("what a hidden section takes with it on the published page", () => {
  const render = (content: SiteContent) => renderToStaticMarkup(createElement(SiteRenderer, { content, images: () => null }));
  const hero = (id: string, heading: string) => ({ id, type: "hero", eyebrow: "", heading, subheading: "", buttonLabel: "", buttonChannel: "" }) as unknown as SiteContent["blocks"][number];
  it("leaves the page's big title to the first section that is shown", () => {
    const content = { ...site, blocks: [hero("primeiro", "Escondido"), hero("segundo", "Visível")], pages: [] } as SiteContent;
    const hidden = setSectionHidden(content, HOME, "primeiro", true);
    expect(render(hidden)).toMatch(/<h1[^>]*>(?:(?!<\/h1>).)*Visível/s);
  });
  it("gives the page back the site's footer when its own footer is hidden", () => {
    const footer = { id: "rodape", type: "box", tag: "footer", name: "Rodapé", children: [{ id: "t", type: "paragraph", text: "Rodapé próprio" }] } as unknown as SiteContent["blocks"][number];
    const content = { ...site, blocks: [...site.blocks, footer], pages: [] } as SiteContent;
    expect(render(content)).not.toContain("site-footer");
    expect(render(setSectionHidden(content, HOME, "rodape", true))).toContain("site-footer");
  });
  it("is not a place a button leads to", () => {
    const button = { id: "b", type: "button", label: "Ver", channel: "", anchor: site.blocks[1]!.id } as unknown as SiteContent["blocks"][number];
    const content = { ...site, blocks: [button, ...site.blocks], pages: [] } as SiteContent;
    expect(render(content)).toContain(`href="#`);
    expect(render(setSectionHidden(content, HOME, site.blocks[1]!.id, true))).not.toContain(`href="#`);
  });
});
