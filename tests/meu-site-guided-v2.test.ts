import { describe, expect, it } from "vitest";
import { HOME, pageById, pagesOf, siteContent, type SiteContent } from "@/modules/meu-site/contracts";
import { sectionFields, sectionsOf, withPageField } from "@/modules/meu-site/guided-model";
import { FOOTER, HEADER, guidedReducer, guidedSections, guidedTrail, normalizeGuided, sectionOfNode, startGuided } from "@/modules/meu-site/guided-state";
import { brandNote, withAccent, withBrand, withFontChoice, withLogo, withMode, withSiteName } from "@/modules/meu-site/guided-brand";
import { pageMetaDescription, pageMetaTitle, seoPreview } from "@/modules/meu-site/guided-seo";
import { deletePage, starterOf } from "@/modules/meu-site/page-model";
import { publicMetadata } from "@/modules/meu-site/public-site";

const complete = siteContent.parse(starterOf("complete", "Marina Personal")) as SiteContent;
const about = pagesOf(complete).find((page) => page.title === "Sobre mim")!;

describe("the Editor Guiado edits every page of the site", () => {
  it("lists the sections of any page, and the site's header and footer around them", () => {
    expect(sectionsOf(complete, about.id).length).toBe(about.blocks.length);
    const listed = guidedSections(complete, about.id);
    expect(listed[0]).toEqual({ ref: HEADER, label: "Cabeçalho do site" });
    expect(listed.at(-1)).toEqual({ ref: FOOTER, label: "Rodapé do site" });
    expect(listed.length).toBe(about.blocks.length + 2);
  });
  it("changes a field of another page and nothing on the home page", () => {
    const section = about.blocks.find((entry) => sectionFields(complete, about.id, entry.id).some((field) => field.label === "Título"))!;
    const key = sectionFields(complete, about.id, section.id).find((field) => field.label === "Título")!.key;
    const next = withPageField(complete, about.id, key, "Quem eu sou");
    expect(sectionFields(next, about.id, section.id).find((field) => field.key === key)?.value).toBe("Quem eu sou");
    expect(next.blocks).toBe(complete.blocks);
    expect(() => siteContent.parse(next)).not.toThrow();
    // A key that names nothing on that page leaves the document as it was.
    expect(withPageField(complete, about.id, "nada.heading", "x")).toBe(complete);
    expect(withPageField(complete, "pagina-que-nao-existe", key, "x")).toBe(complete);
  });
  it("points an issue found inside a section at the section", () => {
    const section = about.blocks.find((entry) => entry.type === "box" && entry.children.length > 0);
    if (section && section.type === "box") expect(sectionOfNode(complete, about.id, section.children[0]!.id)).toBe(section.id);
    expect(sectionOfNode(complete, about.id, "nada")).toBeNull();
  });
});

describe("where the person is", () => {
  it("starts on Conteúdo, the home page and the header, and moves by tab, page, section and back", () => {
    let state = startGuided();
    expect(state).toMatchObject({ tab: "conteudo", pageId: HOME, section: HEADER, step: "lista", preview: false });
    state = guidedReducer(state, { type: "page", pageId: about.id });
    expect(state).toMatchObject({ pageId: about.id, section: HEADER, step: "lista" });
    state = guidedReducer(state, { type: "section", section: FOOTER });
    expect(state.step).toBe("campos");
    expect(guidedReducer(state, { type: "back" }).step).toBe("lista");
    const open = guidedReducer(state, { type: "preview", open: true });
    // A section chosen on the preview closes it and opens its fields.
    expect(guidedReducer({ ...open, tab: "seo" }, { type: "pick", section: HEADER })).toMatchObject({ tab: "conteudo", section: HEADER, step: "campos", preview: false });
  });
  it("says the page and the section, and falls back to what exists after a page is deleted", () => {
    const state = { ...startGuided(), pageId: about.id, section: FOOTER };
    expect(guidedTrail(complete, state)).toEqual({ page: "Sobre mim", section: "Rodapé do site" });
    expect(normalizeGuided(complete, state)).toBe(state);
    const removed = deletePage(complete, about.id);
    if (!removed.ok) throw new Error("not removed");
    expect(normalizeGuided(removed.content, state)).toMatchObject({ pageId: HOME, section: FOOTER });
    expect(normalizeGuided(complete, { ...state, section: "sumiu" }).section).toBe(HEADER);
  });
});

describe("the brand", () => {
  it("changes the name, the logo, the colour, the look and the font, and nothing when the value is the same or invalid", () => {
    expect(withSiteName(complete, complete.title)).toBe(complete);
    expect(withSiteName(complete, "x".repeat(200)).title.length).toBe(80);
    const logo = withLogo(complete, "a1");
    expect(logo.logoAssetId).toBe("a1");
    expect("logoAssetId" in withLogo(logo, null)).toBe(false);
    const brand = withBrand(complete, "#FFAA00");
    expect(brand.theme.brand).toBe("#ffaa00");
    expect(withBrand(complete, "amarelo")).toBe(complete);
    expect(withAccent(brand, "green").theme).toMatchObject({ accent: "green" });
    expect(withAccent(brand, "green").theme.brand).toBeUndefined();
    expect(withMode(complete, "dark").theme.mode).toBe("dark");
    expect(withFontChoice(complete, "serif").theme.font).toBe("serif");
    expect(withFontChoice(withFontChoice(complete, "serif"), undefined).theme.font).toBeUndefined();
  });
  it("says when a colour had to change to stay readable, from the palette itself", () => {
    expect(brandNote("#ffff00", "light")).toMatchObject({ adjusted: true });
    const dark = brandNote("#1d3557", "light");
    expect(dark?.light).toBe("#1d3557");
    expect(dark?.adjusted).toBe(false);
    expect(brandNote("nada", "light")).toBeNull();
  });
});

describe("SEO by page", () => {
  it("uses the same title and description as the published page", () => {
    const withDescription = { ...complete, description: "Treino individual", pages: pagesOf(complete).map((page) => (page.id === about.id ? { ...page, description: "Quem sou" } : page)) };
    const site = { content: withDescription } as Parameters<typeof publicMetadata>[0];
    expect(publicMetadata(site, about.id)).toMatchObject({ title: { absolute: pageMetaTitle(withDescription, about.id) }, description: "Quem sou" });
    expect(pageMetaTitle(withDescription, about.id)).toBe("Sobre mim — Marina Personal");
    expect(pageMetaTitle(withDescription, HOME)).toBe("Marina Personal");
    const other = pagesOf(withDescription).find((page) => page.id !== about.id)!;
    expect(pageMetaDescription(withDescription, other.id)).toBe("Treino individual");
  });
  it("previews a search result and says what is worth knowing", () => {
    const preview = seoPreview(complete, about.id, "…/s/marina/sobre-mim");
    expect(preview.title).toBe("Sobre mim — Marina Personal");
    expect(preview.url).toBe("…/s/marina/sobre-mim");
    expect(preview.notes.join(" ")).toMatch(/Sem descrição/);
    const hidden = seoPreview({ ...complete, indexable: false, description: "d".repeat(300) }, HOME, null);
    expect(hidden.description.length).toBeLessThanOrEqual(160);
    expect(hidden.notes.join(" ")).toMatch(/não o listem/);
    expect(pageById(complete, about.id)).toBeDefined();
  });
});
