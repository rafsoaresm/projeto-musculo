import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  HOME,
  MAX_BLOCKS,
  MAX_DEPTH,
  MAX_NODES,
  MAX_PAGES,
  MAX_SITE_NODES,
  allNodes,
  applyOverrides,
  documentNodes,
  emptyBlock,
  expandedCount,
  pageById,
  pageContent,
  pagesOf,
  parseContent,
  publishIssues,
  referencedAssetIds,
  resolveServices,
  safeParseContent,
  siteContent,
  siteNodeCount,
  swapPage,
  withoutResolvedServices,
  type BoxNode,
  type ComponentDef,
  type ComponentNode,
  type PageDef,
  type SiteContent,
  type SiteNode,
} from "@/modules/meu-site/contracts";
import { blocksPayload, pasteBlocks } from "@/modules/meu-site/clipboard";
import { deleteComponent, renameComponent, setComponentRoot, usesOf } from "@/modules/meu-site/component-model";
import { duplicateBlock, insertNode, locate, REFUSAL_MESSAGE } from "@/modules/meu-site/editor-model";
import { publicHomeUrl, publicImageUrl, publicImages, publicPageUrl, publicSheetImageUrl, publicStyleUrl, previewPageUrl } from "@/modules/meu-site/image-urls";
import {
  PAGE_REFUSAL_MESSAGE,
  addPage,
  deletePage,
  duplicatePage,
  freeSlug,
  linksTo,
  movePage,
  pageChoices,
  setDescription,
  setInMenu,
  setSlug,
  setTitle,
  slugFromTitle,
} from "@/modules/meu-site/page-model";
import { publicMetadata } from "@/modules/meu-site/public-site";
import { SiteRenderer } from "@/modules/meu-site/renderer";
import { buildSiteCss } from "@/modules/meu-site/site-css";
import { HOME_LABEL, siteNav } from "@/modules/meu-site/site-nav";
import type { PublicSite } from "@/db/sites";

const node = <T extends Parameters<typeof emptyBlock>[0]>(type: T, id: string, over: object = {}) => ({ ...emptyBlock(type, id), ...over }) as SiteNode;
const box = (id: string, children: SiteNode[], over: object = {}) => node("box", id, { children, ...over }) as BoxNode;
const instance = (id: string, componentId: string, overrides: ComponentNode["overrides"] = {}): ComponentNode => ({ id, type: "component", componentId, overrides }) as ComponentNode;
const paragraph = (id: string, text = "Texto") => node("paragraph", id, { text });
const goTo = (id: string, page: string, label = "Ver") => node("button", id, { label, page });

const sub = (id: string, slug: string, blocks: SiteNode[] = [paragraph(`${id}-p`)], over: Partial<PageDef> = {}): PageDef => ({ id, slug, title: slug[0].toUpperCase() + slug.slice(1), description: "", blocks, ...over });
const site = (blocks: SiteNode[], pages?: PageDef[], over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "Treino com acompanhamento",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
  ...(pages ? { pages } : {}),
  ...over,
});
const card = (): ComponentDef => ({
  id: "plano",
  name: "Plano",
  root: box("card", [node("heading", "card-t", { text: "Plano mensal", level: 3 }), node("paragraph", "card-p", { text: "Texto do plano" }), node("button", "card-b", { label: "Quero", channel: "whatsapp" })]),
});
/** Boxes of paragraphs that add up to exactly `count` nodes (a box holds up to MAX_CHILDREN). */
function crowd(prefix: string, count: number): SiteNode[] {
  const out: SiteNode[] = [];
  let left = count;
  let at = 0;
  while (left > 0) {
    const inside = Math.min(left - 1, 39);
    out.push(box(`${prefix}-b${at}`, Array.from({ length: inside }, (_, index) => paragraph(`${prefix}-b${at}-p${index}`))));
    left -= inside + 1;
    at++;
  }
  return out;
}
const refused = (content: unknown) => expect(safeParseContent(content).success).toBe(false);

describe("the document with pages", () => {
  it("accepts pages beside the home page and reads back what it was given; a site without pages has no `pages`", () => {
    const content = site([node("hero", "h", { heading: "Início" })], [sub("p1", "sobre"), sub("p2", "planos", [paragraph("p2-a")], { description: "Os planos", inMenu: false })]);
    expect(siteContent.parse(content)).toEqual(content);
    expect(parseContent(JSON.parse(JSON.stringify(content)))).toEqual(content);
    expect(pagesOf(site([]))).toEqual([]);
    expect("pages" in siteContent.parse(site([]))).toBe(false);
  });
  it("normalizes the address of a page, and refuses what is not an address", () => {
    const parsed = siteContent.parse(site([], [sub("p1", "x", [], { slug: "  Sobre-Mim " })]));
    expect(parsed.pages![0].slug).toBe("sobre-mim");
    for (const slug of ["m", "M", "", "-a", "a-", "a--b", "Sobre nós", "sobre/x", "a".repeat(41), "sobre.html", "../x"]) refused(site([], [sub("p1", "x", [], { slug })]));
    // A short one is fine for a page (it is below the site's address), and so is a number.
    for (const slug of ["a", "ab", "2", "faq", "a".repeat(40)]) expect(safeParseContent(site([], [sub("p1", "x", [], { slug })])).success, slug).toBe(true);
  });
  it("refuses repeated addresses, repeated or reserved identifiers and more pages than the limit", () => {
    refused(site([], [sub("p1", "sobre"), sub("p2", "sobre")]));
    refused(site([], [sub("p1", "sobre"), sub("p1", "planos")]));
    refused(site([], [sub(HOME, "sobre")]));
    const many = (count: number) => Array.from({ length: count }, (_, index) => sub(`p${index}`, `pagina-${index}`, []));
    expect(safeParseContent(site([], many(MAX_PAGES))).success).toBe(true);
    refused(site([], many(MAX_PAGES + 1)));
  });
  it("refuses a node identifier that repeats across pages, or in a component", () => {
    refused(site([paragraph("a")], [sub("p1", "sobre", [paragraph("a")])]));
    refused(site([], [sub("p1", "sobre", [paragraph("a")]), sub("p2", "planos", [paragraph("a")])]));
    refused(site([], [sub("p1", "sobre", [paragraph("card-p")])], { components: [card()] }));
    expect(safeParseContent(site([paragraph("a")], [sub("p1", "sobre", [paragraph("b")])])).success).toBe(true);
  });
  it("applies the limits of a page to each page, and one more to the site as a whole", () => {
    expect(safeParseContent(site([], [sub("p1", "sobre", Array.from({ length: MAX_BLOCKS }, (_, index) => paragraph(`x${index}`)))])).success).toBe(true);
    refused(site([], [sub("p1", "sobre", Array.from({ length: MAX_BLOCKS + 1 }, (_, index) => paragraph(`x${index}`)))]));
    expect(allNodes(crowd("c", MAX_NODES))).toHaveLength(MAX_NODES);
    expect(safeParseContent(site([], [sub("p1", "sobre", crowd("a", MAX_NODES))])).success).toBe(true);
    refused(site([], [sub("p1", "sobre", crowd("a", MAX_NODES + 1))]));
    // Three full pages and a page of 199 nodes, with one in the home page, are the whole of what the site accepts.
    const full = [sub("p1", "um", crowd("a", MAX_NODES)), sub("p2", "dois", crowd("b", MAX_NODES)), sub("p3", "tres", crowd("c", MAX_NODES)), sub("p4", "quatro", crowd("d", MAX_NODES - 1))];
    expect(siteNodeCount(site([paragraph("h")], full))).toBe(MAX_SITE_NODES);
    expect(safeParseContent(site([paragraph("h")], full)).success).toBe(true);
    refused(site([paragraph("h"), paragraph("h2")], full));
    // The depth of containers is a limit of each page.
    let deep: SiteNode = paragraph("deep-p");
    for (let level = 0; level <= MAX_DEPTH; level++) deep = box(`deep-${level}`, [deep]);
    refused(site([], [sub("p1", "sobre", [deep])]));
  });
  it("counts what the server prints for a visit: the most crowded page with its components drawn, not all the pages together", () => {
    const content = site([instance("i1", "plano")], [sub("p1", "sobre", [instance("i2", "plano"), instance("i3", "plano")])], { components: [card()] });
    expect(expandedCount(content)).toBe(2 * (1 + 4));
    expect(expandedCount(site([paragraph("a")]))).toBe(1);
  });
  it("is a document that is written in the same version as before: nothing of pages is needed to read what exists", () => {
    const before = site([node("hero", "h", { heading: "Oi" })]);
    expect(parseContent(JSON.parse(JSON.stringify(before)))).toEqual(before);
    expect(before.schemaVersion).toBe(3);
  });
});

describe("a button or a link that goes to a page", () => {
  it("goes to a contact, a block or a page, only one of them", () => {
    expect(safeParseContent(site([goTo("b", "p1")], [sub("p1", "sobre")])).success).toBe(true);
    expect(safeParseContent(site([goTo("b", HOME)])).success).toBe(true);
    expect(safeParseContent(site([node("link", "l", { label: "Sobre", page: "p1" })], [sub("p1", "sobre")])).success).toBe(true);
    refused(site([node("button", "b", { label: "Ver", page: "p1", channel: "whatsapp" })], [sub("p1", "sobre")]));
    refused(site([node("button", "b", { label: "Ver", page: "p1", anchor: "x" })], [sub("p1", "sobre")]));
    refused(site([node("link", "l", { label: "Ver", page: "p1", channel: "email" })], [sub("p1", "sobre")]));
    refused(site([node("button", "b", { label: "Ver", page: "Not An Id" })]));
  });
  it("is replaced by a contact an instance chooses for the button of its component, as a block is", () => {
    const definition: ComponentDef = { id: "c", name: "C", root: box("cx", [node("button", "cx-b", { label: "Ir", page: HOME })]) };
    const drawn = applyOverrides(definition.root, { "cx-b": { channel: "whatsapp" } }) as BoxNode;
    expect(drawn.children[0]).toMatchObject({ channel: "whatsapp" });
    expect(drawn.children[0]).not.toHaveProperty("page");
    expect(safeParseContent(site([instance("i", "c", { "cx-b": { channel: "whatsapp" } })], [], { components: [definition] })).success).toBe(true);
  });
});

describe("what looks at every page", () => {
  it("counts the images, the styles and the nodes of the pages as the document's", () => {
    const withImage = node("image", "img", { assetId: "foto-1", alt: "Foto" });
    const styled = node("paragraph", "styled", { text: "x", style: { color: "accent" } });
    const background = box("bg", [], { style: { bgImage: "fundo-1" } });
    const content = site([paragraph("a")], [sub("p1", "sobre", [withImage, styled, background])], { logoAssetId: "logo-1" });
    expect(documentNodes(content).map((entry) => entry.id)).toEqual(expect.arrayContaining(["a", "img", "styled", "bg"]));
    expect(referencedAssetIds(content).sort()).toEqual(["foto-1", "fundo-1", "logo-1"]);
    const sheet = buildSiteCss(content, { imageUrl: (assetId) => `./m/${assetId}` });
    expect(sheet).toContain(".s-styled");
    expect(sheet).toContain("./m/fundo-1");
  });
  it("writes the services on offer into every page, and takes them out of a draft brought back", () => {
    const content = site([], [sub("p1", "sobre", [node("services", "s", { serviceIds: ["x"] })])]);
    const live = new Map([["x", { name: "Consultoria", description: null, delivery: "ONLINE" as const }]]);
    const resolved = resolveServices(content, live);
    expect(pagesOf(resolved)[0].blocks[0]).toMatchObject({ items: [{ name: "Consultoria", delivery: "ONLINE" }] });
    expect(pagesOf(withoutResolvedServices(resolved))[0].blocks[0]).not.toHaveProperty("items");
  });
  it("shows a page as the page of the document, and gives the document back when asked again", () => {
    const content = site([paragraph("home-a")], [sub("p1", "sobre", [paragraph("sobre-a")]), sub("p2", "planos", [paragraph("planos-a")])]);
    const view = swapPage(content, "p1");
    expect(view.blocks.map((entry) => entry.id)).toEqual(["sobre-a"]);
    expect(pagesOf(view).find((entry) => entry.id === "p1")!.blocks.map((entry) => entry.id)).toEqual(["home-a"]);
    expect(pagesOf(view).find((entry) => entry.id === "p2")!.blocks.map((entry) => entry.id)).toEqual(["planos-a"]);
    expect(swapPage(view, "p1")).toEqual(content);
    expect(documentNodes(view).map((entry) => entry.id).sort()).toEqual(documentNodes(content).map((entry) => entry.id).sort());
    expect(swapPage(content, HOME)).toBe(content);
    expect(swapPage(content, null)).toBe(content);
    expect(swapPage(content, "gone")).toBe(content);
    const drawn = pageContent(content, "p2");
    expect(drawn.blocks.map((entry) => entry.id)).toEqual(["planos-a"]);
    expect(pagesOf(drawn)).toEqual(pagesOf(content));
    expect(pageContent(content, HOME)).toBe(content);
  });
});

describe("what stops or warns when publishing, page by page", () => {
  const none = new Set<string>();
  it("says which page an issue is about, with the position of the block in that page", () => {
    const content = site(
      [node("hero", "h", { heading: "Oi" })],
      [sub("p1", "sobre", [paragraph("ok"), node("text", "t", { text: "" })], { title: "Sobre" })],
    );
    const issues = publishIssues(content, none);
    expect(issues).toEqual([
      expect.objectContaining({ page: "p1", block: 2, blockId: "t", severity: "warning", message: expect.stringMatching(/^Página “Sobre”: Bloco 2 \(Texto\): escreva o texto/) }),
    ]);
  });
  it("keeps the home page's issues as they were, with no page", () => {
    const issues = publishIssues(site([node("text", "t", { text: "" })], [sub("p1", "sobre", [paragraph("a")])]), none);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ page: null, block: 1, blockId: "t" });
    expect(issues[0].message).toMatch(/^Bloco 1 \(Texto\)/);
  });
  it("warns, and does not stop, for a page with no blocks or no title", () => {
    const issues = publishIssues(site([paragraph("a")], [sub("p1", "sobre", [], { title: "" })]), none);
    expect(issues.map((issue) => issue.severity)).toEqual(["warning", "warning"]);
    expect(issues.map((issue) => issue.page)).toEqual(["p1", "p1"]);
    expect(issues.map((issue) => issue.blockId)).toEqual([null, null]);
    expect(issues[0].message).toMatch(/^Página “sobre”: dê um título à página/);
    expect(issues[1].message).toMatch(/^Página “sobre”: a página está sem blocos/);
  });
  it("still stops for the home page with no block, and for a testimony of a page without its authorization", () => {
    expect(publishIssues(site([], [sub("p1", "sobre")]), none).filter((issue) => issue.severity === "blocking")).toEqual([expect.objectContaining({ page: null, message: "Acrescente pelo menos um bloco." })]);
    const quote = node("quote", "q", { quote: "Gostei", author: "Ana", authorized: false });
    expect(publishIssues(site([paragraph("a")], [sub("p1", "depoimentos", [quote])]), none)).toEqual([expect.objectContaining({ page: "p1", severity: "blocking", blockId: "q" })]);
  });
  it("knows where a button to a page goes: the home page, a page, and one that is not there any more", () => {
    const content = site([goTo("a", HOME), goTo("b", "p1"), goTo("c", "gone")], [sub("p1", "sobre")]);
    const issues = publishIssues(content, none);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ page: null, blockId: "c", message: expect.stringContaining("leva a uma página que não existe mais") });
  });
  it("reads an anchor on the page the button is, not on another", () => {
    const content = site([paragraph("here"), node("button", "b1", { label: "Ir", anchor: "there" })], [sub("p1", "sobre", [paragraph("there"), node("button", "b2", { label: "Ir", anchor: "here" })])]);
    const issues = publishIssues(content, none);
    expect(issues.map((issue) => [issue.page, issue.blockId])).toEqual([[null, "b1"], ["p1", "b2"]]);
    expect(issues.every((issue) => issue.message.includes("não existe mais"))).toBe(true);
  });
  it("names the places a button can go as the ones the site has", () => {
    const empty = node("button", "b", { label: "", channel: undefined });
    expect(publishIssues(site([empty]), none)[0].message).toContain("um contato ou um bloco da página");
    expect(publishIssues(site([empty], [sub("p1", "sobre")]), none)[0].message).toContain("um contato, um bloco desta página ou outra página");
  });
  it("looks inside the components of a page as it does on the home page", () => {
    const content = site([], [sub("p1", "sobre", [instance("i1", "plano", { "card-b": { channel: "email" } })], { title: "Sobre" })], { components: [card()], contact: { whatsapp: "", email: "", instagram: "" } });
    const issues = publishIssues(content, none);
    expect(issues.filter((issue) => issue.page === "p1").map((issue) => issue.blockId)).toEqual(["i1"]);
  });
});

describe("the pages as the editor changes them", () => {
  const base = () => site([paragraph("home-a")]);
  it("adds a page with no title, in the menu, at the end, with an address that no page has", () => {
    const first = addPage(base());
    if (!first.ok) throw new Error("add");
    expect(pagesOf(first.content)).toEqual([{ id: first.id, slug: "pagina", title: "", description: "", blocks: [] }]);
    const second = addPage(first.content);
    if (!second.ok) throw new Error("add");
    expect(pagesOf(second.content).map((entry) => entry.slug)).toEqual(["pagina", "pagina-2"]);
    expect(safeParseContent(second.content).success).toBe(true);
    let current = base();
    for (let count = 0; count < MAX_PAGES; count++) {
      const outcome = addPage(current);
      if (!outcome.ok) throw new Error("add");
      current = outcome.content;
    }
    expect(addPage(current)).toEqual({ ok: false, reason: "limit-pages" });
  });
  it("makes the address of a page from its first title, and keeps the address when it is renamed or when it was chosen", () => {
    const added = addPage(base());
    if (!added.ok) throw new Error("add");
    const named = setTitle(added.content, added.id, "Planos e valores");
    expect(pageById(named, added.id)).toMatchObject({ title: "Planos e valores", slug: "planos-e-valores" });
    const renamed = setTitle(named, added.id, "Nossos planos");
    expect(pageById(renamed, added.id)).toMatchObject({ title: "Nossos planos", slug: "planos-e-valores" });
    // An address the person wrote is not replaced by the first title.
    const chosen = setSlug(added.content, added.id, "contato");
    if (!chosen.ok) throw new Error("slug");
    expect(pageById(setTitle(chosen.content, added.id, "Fale conosco"), added.id)).toMatchObject({ title: "Fale conosco", slug: "contato" });
    // A title that is already the page's changes nothing, and a long one is cut.
    expect(setTitle(named, added.id, "Planos e valores")).toBe(named);
    expect(pageById(setTitle(named, added.id, "x".repeat(100)), added.id)!.title).toHaveLength(40);
    expect(setTitle(named, "gone", "x")).toBe(named);
  });
  it("gives each page its own address even when two titles say the same", () => {
    const one = addPage(base());
    if (!one.ok) throw new Error("add");
    const two = addPage(one.content);
    if (!two.ok) throw new Error("add");
    const a = setTitle(two.content, one.id, "Planos");
    const b = setTitle(a, two.id, "Planos");
    expect(pagesOf(b).map((entry) => entry.slug)).toEqual(["planos", "planos-2"]);
    expect(safeParseContent(b).success).toBe(true);
  });
  it("makes an address from a title: no accents, no symbols, never an empty or reserved one", () => {
    expect(slugFromTitle("Planos e valores")).toBe("planos-e-valores");
    expect(slugFromTitle("Avaliação física")).toBe("avaliacao-fisica");
    expect(slugFromTitle("  Sobre mim!  ")).toBe("sobre-mim");
    expect(slugFromTitle("Eu")).toBe("eu");
    for (const title of ["", "   ", "!!!", "M", "m"]) expect(slugFromTitle(title), title).toBe("pagina");
    expect(slugFromTitle("a".repeat(80)).length).toBeLessThanOrEqual(40);
    expect(freeSlug(site([], [sub("p1", "pagina"), sub("p2", "pagina-2")]), "pagina")).toBe("pagina-3");
    expect(freeSlug(site([], [sub("p1", "sobre")]), "sobre", "p1")).toBe("sobre");
    expect(freeSlug(site([], []), "Not Valid")).toBe("pagina");
  });
  it("takes an address only if it is one, and is not another page's; the same address is no change", () => {
    const content = site([], [sub("p1", "sobre"), sub("p2", "planos")]);
    const ok = setSlug(content, "p1", " Equipe ");
    expect(ok.ok && pageById(ok.content, "p1")!.slug).toBe("equipe");
    expect(setSlug(content, "p1", "planos")).toEqual({ ok: false, reason: "address-taken" });
    for (const wanted of ["", "a b", "m", "-x", "x--y", "á"]) expect(setSlug(content, "p1", wanted), wanted).toEqual({ ok: false, reason: "invalid-address" });
    expect(setSlug(content, "gone", "x")).toEqual({ ok: false, reason: "not-found" });
    const same = setSlug(content, "p1", "sobre");
    expect(same.ok && same.content).toBe(content);
    for (const reason of Object.keys(PAGE_REFUSAL_MESSAGE)) expect(PAGE_REFUSAL_MESSAGE[reason as keyof typeof PAGE_REFUSAL_MESSAGE]).not.toBe("");
  });
  it("puts a page in the menu or out of it, and writes the description", () => {
    const content = site([], [sub("p1", "sobre")]);
    const out = setInMenu(content, "p1", false);
    expect(pageById(out, "p1")).toHaveProperty("inMenu", false);
    expect(pageById(setInMenu(out, "p1", true), "p1")).not.toHaveProperty("inMenu");
    expect(safeParseContent(out).success).toBe(true);
    expect(pageById(setDescription(content, "p1", "x".repeat(500)), "p1")!.description).toHaveLength(200);
    expect(setInMenu(content, "gone", false)).toBe(content);
    expect(setDescription(content, "gone", "x")).toBe(content);
  });
  it("moves a page up or down the menu, and not past the ends", () => {
    const content = site([], [sub("p1", "um"), sub("p2", "dois"), sub("p3", "tres")]);
    expect(pagesOf(movePage(content, "p3", -1)).map((entry) => entry.id)).toEqual(["p1", "p3", "p2"]);
    expect(pagesOf(movePage(content, "p1", 1)).map((entry) => entry.id)).toEqual(["p2", "p1", "p3"]);
    expect(movePage(content, "p1", -1)).toBe(content);
    expect(movePage(content, "p3", 1)).toBe(content);
    expect(movePage(content, "gone", 1)).toBe(content);
  });
  it("takes a page out with its blocks, and leaves the buttons that went to it with no destination, wherever they are", () => {
    const definition: ComponentDef = { id: "c", name: "C", root: box("cx", [node("link", "cx-l", { label: "Sobre", page: "p1" })]) };
    const content = site([goTo("home-b", "p1"), goTo("home-c", HOME)], [sub("p1", "sobre", [goTo("self", "p1")]), sub("p2", "planos", [goTo("other", "p1", "Sobre")])], { components: [definition] });
    expect(linksTo(content, "p1")).toBe(4);
    const outcome = deletePage(content, "p1");
    if (!outcome.ok) throw new Error("delete");
    expect(pagesOf(outcome.content).map((entry) => entry.id)).toEqual(["p2"]);
    expect(linksTo(outcome.content, "p1")).toBe(0);
    expect(linksTo(outcome.content, HOME)).toBe(1);
    expect(outcome.content.blocks[0]).toMatchObject({ id: "home-b", label: "Ver" });
    expect(outcome.content.blocks[0]).not.toHaveProperty("page");
    expect(safeParseContent(outcome.content).success).toBe(true);
    expect(deletePage(content, "gone")).toEqual({ ok: false, reason: "not-found" });
    // With the last one gone the document has no `pages` at all.
    const last = deletePage(site([], [sub("p1", "sobre")]), "p1");
    expect(last.ok && "pages" in last.content).toBe(false);
  });
  it("copies a page right after it: new identifiers, links to its own blocks that follow the copy, a title that says it is a copy and an address of its own", () => {
    const from = sub("p1", "sobre", [paragraph("target"), node("button", "go", { label: "Ir", anchor: "target" }), box("wrap", [paragraph("inner")])], { title: "Sobre mim", description: "Quem sou" });
    const content = site([], [from, sub("p2", "planos")]);
    const outcome = duplicatePage(content, "p1");
    if (!outcome.ok) throw new Error("duplicate");
    expect(pagesOf(outcome.content).map((entry) => entry.slug)).toEqual(["sobre", "sobre-copia", "planos"]);
    const copy = pageById(outcome.content, outcome.id)!;
    expect(copy).toMatchObject({ title: "Sobre mim (cópia)", description: "Quem sou" });
    const ids = allNodes(copy.blocks).map((entry) => entry.id);
    expect(ids).toHaveLength(4);
    expect(ids.some((id) => ["target", "go", "wrap", "inner"].includes(id))).toBe(false);
    const button = copy.blocks[1] as Extract<SiteNode, { type: "button" }>;
    expect(button.anchor).toBe(copy.blocks[0].id);
    expect(pageById(outcome.content, "p1")).toEqual(from);
    expect(safeParseContent(outcome.content).success).toBe(true);
    // A copy of a copy takes the next free address; one of a page with no title has none either.
    const again = duplicatePage(outcome.content, "p1");
    expect(again.ok && pageById(again.content, again.id)!.slug).toBe("sobre-copia-2");
    expect(duplicatePage(site([], [sub("p1", "x", [], { title: "" })]), "p1")).toMatchObject({ ok: true });
    expect(duplicatePage(content, "gone")).toEqual({ ok: false, reason: "not-found" });
  });
  it("does not copy a page when the site has no room for another one or for its blocks", () => {
    const many = Array.from({ length: MAX_PAGES }, (_, index) => sub(`p${index}`, `pagina-${index}`, []));
    expect(duplicatePage(site([], many), "p0")).toEqual({ ok: false, reason: "limit-pages" });
    const heavy = site([], [sub("p1", "um", crowd("a", MAX_NODES)), sub("p2", "dois", crowd("b", MAX_NODES)), sub("p3", "tres", crowd("c", MAX_NODES)), sub("p4", "quatro", crowd("d", MAX_NODES - 1))]);
    expect(duplicatePage(heavy, "p1")).toEqual({ ok: false, reason: "limit-site-nodes" });
  });
  it("lists the pages as a choice: the home page, then the others in the order of the menu, and a page with no title by its address", () => {
    const content = site([], [sub("p1", "sobre"), sub("p2", "planos", [], { title: "" })]);
    expect(pageChoices(content, HOME_LABEL)).toEqual([
      { id: HOME, label: "Início" },
      { id: "p1", label: "Sobre" },
      { id: "p2", label: "Página sem título (planos)" },
    ]);
  });
});

describe("the editor's tools on the page that is being edited", () => {
  const heavy = () => site([paragraph("h")], [sub("p1", "um", crowd("a", MAX_NODES)), sub("p2", "dois", crowd("b", MAX_NODES)), sub("p3", "tres", crowd("c", MAX_NODES)), sub("p4", "quatro", crowd("d", MAX_NODES - 1))]);
  it("counts the nodes of every page against the site's limit, on the home page and on a page shown in its place", () => {
    const content = heavy();
    expect(siteNodeCount(content)).toBe(MAX_SITE_NODES);
    expect(insertNode(content, paragraph("new"), { parent: null, index: 0 })).toEqual({ ok: false, reason: "limit-site-nodes" });
    const view = swapPage(content, "p4");
    expect(allNodes(view.blocks)).toHaveLength(MAX_NODES - 1);
    expect(insertNode(view, paragraph("new"), { parent: null, index: 0 })).toEqual({ ok: false, reason: "limit-site-nodes" });
    expect(REFUSAL_MESSAGE["limit-site-nodes"]).toContain(String(MAX_SITE_NODES));
    // Room is room: one node less in the site, and the same insert is taken.
    const room = swapPage({ ...content, pages: content.pages!.map((entry) => (entry.id === "p1" ? { ...entry, blocks: entry.blocks.slice(0, -1) } : entry)) }, "p4");
    expect(insertNode(room, paragraph("new"), { parent: null, index: 0 }).ok).toBe(true);
    // A page of its own is full at the limit of a page.
    const page4 = swapPage(content, "p3");
    expect(insertNode(page4, paragraph("new2"), { parent: null, index: 0 })).toEqual({ ok: false, reason: "limit-nodes" });
  });
  it("copies a block of a page into the same page with the tools of the home page, and the document comes back whole", () => {
    const content = site([paragraph("h")], [sub("p1", "sobre", [paragraph("a")])]);
    const view = swapPage(content, "p1");
    const outcome = duplicateBlock(view, "a");
    if (!outcome.ok) throw new Error("duplicate");
    const back = swapPage(outcome.content, "p1");
    expect(back.blocks.map((entry) => entry.id)).toEqual(["h"]);
    expect(pageById(back, "p1")!.blocks).toHaveLength(2);
    expect(locate(view, "h")).toBeNull();
    expect(safeParseContent(back).success).toBe(true);
  });
});

describe("components, which are the site's, on every page", () => {
  const content = () =>
    site([instance("i1", "plano")], [sub("p1", "sobre", [instance("i2", "plano", { "card-t": { text: "Trimestral" } }), instance("i3", "plano", { "card-p": { text: "Outro" } })]), sub("p2", "planos", [instance("i4", "plano")])], {
      components: [card()],
    });
  it("counts the instances on all the pages, from the home page and from a page shown in its place", () => {
    expect(usesOf(content(), "plano")).toBe(4);
    expect(usesOf(swapPage(content(), "p1"), "plano")).toBe(4);
    expect(usesOf(content(), "none")).toBe(0);
  });
  it("turns every instance into plain blocks when the component is deleted, on every page, and keeps what each one said", () => {
    const outcome = deleteComponent(content(), "plano");
    if (!outcome.ok) throw new Error("delete");
    const after = outcome.content;
    expect(after.components).toBeUndefined();
    expect(documentNodes(after).filter((entry) => entry.type === "component")).toHaveLength(0);
    const texts = pagesOf(after)[0].blocks.map((entry) => (entry as BoxNode).children.map((child) => (child as { text?: string }).text ?? (child as { label?: string }).label));
    expect(texts).toEqual([["Trimestral", "Texto do plano", "Quero"], ["Plano mensal", "Outro", "Quero"]]);
    expect(siteContent.safeParse(after).success).toBe(true);
    // The same from a page shown in the place of the home page: nothing is missed.
    const view = deleteComponent(swapPage(content(), "p2"), "plano");
    expect(view.ok && documentNodes(view.content).filter((entry) => entry.type === "component")).toHaveLength(0);
  });
  it("changes nothing when a page has no room for what an instance turns into", () => {
    const definition = card();
    const crowded = site([], [sub("p1", "sobre", [...crowd("a", 197), instance("i1", "plano")])], { components: [definition] });
    expect(allNodes(pagesOf(crowded)[0].blocks)).toHaveLength(198);
    expect(deleteComponent(crowded, "plano")).toEqual({ ok: false, reason: "limit-nodes" });
  });
  it("prunes what an instance said of a node the component no longer has, on every page, when the component is changed", () => {
    const next: SiteNode[] = [box("card", [node("heading", "card-t", { text: "Plano mensal", level: 3 })])];
    const outcome = setComponentRoot(content(), "plano", next);
    if (!outcome.ok) throw new Error("set");
    const i3 = documentNodes(outcome.content).find((entry) => entry.id === "i3") as ComponentNode;
    const i2 = documentNodes(outcome.content).find((entry) => entry.id === "i2") as ComponentNode;
    expect(i3.overrides).toEqual({});
    expect(i2.overrides).toEqual({ "card-t": { text: "Trimestral" } });
    expect(siteContent.safeParse(outcome.content).success).toBe(true);
  });
  it("renames the component for the instances that showed its name, on every page", () => {
    const named = site([instance("i1", "plano", {}), instance("i0", "plano")], [sub("p1", "sobre", [instance("i2", "plano")])], { components: [card()] });
    const withNames = swapPage(named, null);
    const labelled = {
      ...withNames,
      blocks: withNames.blocks.map((entry) => ({ ...entry, name: "Plano" }) as SiteNode),
      pages: pagesOf(withNames).map((entry) => ({ ...entry, blocks: entry.blocks.map((inner) => ({ ...inner, name: "Plano" }) as SiteNode) })),
    };
    const renamed = renameComponent(labelled, "plano", "Pacote");
    const names = documentNodes(renamed).filter((entry) => entry.type === "component").map((entry) => entry.name);
    expect(names).toEqual(["Pacote", "Pacote", "Pacote"]);
    expect(renamed.components![0].name).toBe("Pacote");
  });
});

describe("pasting a button that goes to a page", () => {
  const pasteInto = (context: { assetIds: Set<string>; serviceIds: Set<string>; pageIds?: Set<string> }) => {
    const from = site([goTo("to-p1", "p1"), goTo("to-home", HOME), goTo("to-gone", "gone")], [sub("p1", "sobre")]);
    const payload = blocksPayload(from, ["to-p1", "to-home", "to-gone"])!;
    const outcome = pasteBlocks(site([], [sub("p1", "sobre")]), payload, { parent: null, index: 0 }, context);
    if (!outcome.ok) throw new Error("paste");
    return outcome.content.blocks.map((entry) => (entry as { page?: string }).page);
  };
  it("keeps a destination that is a page of this site and the home page, and drops one that is not", () => {
    expect(pasteInto({ assetIds: new Set(), serviceIds: new Set(), pageIds: new Set(["p1"]) })).toEqual(["p1", HOME, undefined]);
  });
  it("knows only the home page when it is not told the pages", () => {
    expect(pasteInto({ assetIds: new Set(), serviceIds: new Set() })).toEqual([undefined, HOME, undefined]);
  });
});

describe("the menu of the pages", () => {
  const hrefOf = (id: string, slug: string | null) => (id === HOME ? "/" : `/${slug}`);
  it("is the home page and the pages that are in the menu and have a title, in order", () => {
    const content = site([], [sub("p1", "sobre"), sub("p2", "planos", [], { inMenu: false }), sub("p3", "equipe", [], { title: "" }), sub("p4", "contato")]);
    const nav = siteNav(content, "p4", hrefOf);
    expect(nav.items).toEqual([
      { id: HOME, label: "Início", href: "/", current: false },
      { id: "p1", label: "Sobre", href: "/sobre", current: false },
      { id: "p4", label: "Contato", href: "/contato", current: true },
    ]);
  });
  it("finds where any page goes, the ones out of the menu included, and says when there is none", () => {
    const content = site([], [sub("p2", "planos", [], { inMenu: false })]);
    const nav = siteNav(content, HOME, hrefOf);
    expect(nav.href("p2")).toBe("/planos");
    expect(nav.href(HOME)).toBe("/");
    expect(nav.href("gone")).toBeNull();
    expect(nav.items).toHaveLength(1);
  });
});

describe("where a page of the published site is, from where it is drawn", () => {
  // What a browser does with a relative address: the one it is given, against the address of the page it is on.
  const from = (page: string, relative: string) => new URL(relative, `https://app.example${page}`).pathname + new URL(relative, `https://app.example${page}`).search;
  for (const mount of ["", "/app"]) {
    it(`reaches the other pages, the images and the sheet from the home page and from a page, under "${mount}"`, () => {
      const home = `${mount}/s/marina`;
      const sobre = `${mount}/s/marina/sobre`;
      expect(from(home, publicPageUrl("marina", "sobre", "home"))).toBe(`${mount}/s/marina/sobre`);
      expect(from(sobre, publicPageUrl("marina", "planos", "page"))).toBe(`${mount}/s/marina/planos`);
      expect(from(sobre, publicHomeUrl("marina", "page"))).toBe(`${mount}/s/marina`);
      expect(from(home, publicHomeUrl("marina", "home"))).toBe(`${mount}/s/marina`);
      expect(from(home, publicImageUrl("marina", "abc", "home"))).toBe(`${mount}/s/marina/m/abc`);
      expect(from(sobre, publicImageUrl("marina", "abc", "page"))).toBe(`${mount}/s/marina/m/abc`);
      expect(from(home, publicStyleUrl("marina", 3))).toBe(`${mount}/s/marina/estilo.css?v=3`);
      expect(from(sobre, publicStyleUrl("marina", 3, "page"))).toBe(`${mount}/s/marina/estilo.css?v=3`);
      // The stylesheet's own images are the ones of any page below the site.
      expect(from(`${mount}/s/marina/estilo.css`, publicSheetImageUrl("abc"))).toBe(`${mount}/s/marina/m/abc`);
    });
  }
  it("gives the images of a page the address of its level", () => {
    const resolver = publicImages("marina", { abc: { width: 4, height: 3 } }, "page");
    expect(resolver("abc")).toEqual({ src: "./m/abc", width: 4, height: 3 });
    expect(publicImages("marina", { abc: { width: 4, height: 3 } })("abc")!.src).toBe("./marina/m/abc");
    expect(resolver("gone")).toBeNull();
  });
  it("chooses the page of the preview by a query that cannot be read as anything else", () => {
    expect(previewPageUrl(null)).toBe("./previa");
    expect(previewPageUrl("abc123")).toBe("./previa?pagina=abc123");
    expect(previewPageUrl("a b&c")).toBe("./previa?pagina=a%20b%26c");
    expect(from("/profissional/meu-site/previa", previewPageUrl("abc"))).toBe("/profissional/meu-site/previa?pagina=abc");
    expect(from("/app/profissional/meu-site/previa", previewPageUrl(null))).toBe("/app/profissional/meu-site/previa");
  });
});

describe("drawing the pages of a site", () => {
  const draw = (content: SiteContent, current: string, edit = false) => {
    const nav = siteNav(content, current, (id, slug) => (id === HOME ? "./marina" : `./marina/${slug}`));
    return renderToStaticMarkup(createElement(SiteRenderer, { content: pageContent(content, current), nav, edit: edit ? { text: (field) => createElement("span", null, field.value) } : undefined }));
  };
  it("draws the menu in the header, with the current page marked, and nothing when the site has one page", () => {
    const content = site([node("hero", "h", { heading: "Oi" })], [sub("p1", "sobre", [paragraph("a")]), sub("p2", "planos", [], { inMenu: false })]);
    const html = draw(content, "p1");
    expect(html).toContain('<nav class="site-menu" aria-label="Páginas do site">');
    expect(html).toContain('<a class="site-menu-link" href="./marina">Início</a>');
    expect(html).toContain('<a class="site-menu-link" href="./marina/sobre" aria-current="page">Sobre</a>');
    expect(html).not.toContain("Planos");
    expect(draw(site([node("hero", "h", { heading: "Oi" })]), HOME)).not.toContain("site-menu");
    // Out of the menu, and the page is the only one in it: no menu.
    expect(draw(site([paragraph("a")], [sub("p2", "planos", [], { inMenu: false })]), HOME)).not.toContain("site-menu");
  });
  it("folds the menu into a Menu button that needs no script: a checkbox and its label, tied to the list, with each link once", () => {
    const content = site([node("hero", "h", { heading: "Oi" })], [sub("p1", "sobre", [paragraph("a")]), sub("p3", "contato", [paragraph("c")])]);
    const html = draw(content, "p1");
    expect(html).toContain('<input type="checkbox" id="site-menu-toggle" class="site-menu-state" aria-controls="site-menu-toggle-list"/>');
    expect(html).toContain('<label for="site-menu-toggle" class="site-menu-toggle"><span class="site-menu-icon" aria-hidden="true"></span>Menu</label>');
    expect(html).toContain('<ul id="site-menu-toggle-list">');
    expect(html.match(/class="site-menu-link"/g)).toHaveLength(3);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    // The button comes before the list, so the stylesheet can open the list with the state of the box (`:checked ~ ul`).
    expect(html.indexOf("site-menu-state")).toBeLessThan(html.indexOf("site-menu-toggle-list"));
    // A page drawn more than once in one window (the frames of the editor) does not repeat the identifier.
    const nav = siteNav(content, HOME, (id, slug) => (id === HOME ? "./marina" : `./marina/${slug}`));
    const frame = (scope: string) => renderToStaticMarkup(createElement(SiteRenderer, { content: pageContent(content, HOME), nav, scope }));
    expect(frame("tablet-")).toContain('id="tablet-site-menu-toggle"');
    expect(frame("tablet-")).toContain('for="tablet-site-menu-toggle"');
    expect(frame("tablet-")).toContain('aria-controls="tablet-site-menu-toggle-list"');
    expect(frame("mobile-")).not.toContain("tablet-");
  });
  it("draws the blocks of the page asked for, and not those of another", () => {
    const content = site([paragraph("a", "Texto da inicial")], [sub("p1", "sobre", [paragraph("b", "Texto de sobre")])]);
    expect(draw(content, "p1")).toContain("Texto de sobre");
    expect(draw(content, "p1")).not.toContain("Texto da inicial");
    expect(draw(content, HOME)).toContain("Texto da inicial");
    expect(draw(content, HOME)).not.toContain("Texto de sobre");
  });
  it("makes a link of a button that goes to a page, and leaves it out when the page is not there", () => {
    const content = site([goTo("b1", "p1", "Conheça"), goTo("b2", HOME, "Voltar"), goTo("b3", "gone", "Perdido"), node("button", "b4", { label: "Sem destino" })], [sub("p1", "sobre")]);
    const html = draw(content, HOME);
    expect(html).toMatch(/<a class="button primary site-leaf" href="\.\/marina\/sobre">Conheça<\/a>/);
    expect(html).toMatch(/<a class="button primary site-leaf" href="\.\/marina">Voltar<\/a>/);
    expect(html).not.toContain("Perdido");
    expect(html).not.toContain("Sem destino");
    // A link inside the site opens in the same window (the contacts of the footer are the ones that open another).
    expect(html.slice(html.indexOf("<main"), html.indexOf("</main>"))).not.toContain("target=");
  });
  it("leaves the button alone where there is no site around the page", () => {
    const content = site([goTo("b1", "p1", "Conheça")], [sub("p1", "sobre")]);
    expect(renderToStaticMarkup(createElement(SiteRenderer, { content }))).not.toContain("Conheça");
  });
  it("draws the menu and the buttons that go to a page as stand-ins in the editor: nothing to follow", () => {
    const content = site([goTo("b1", "p1", "Conheça")], [sub("p1", "sobre")]);
    const html = draw(content, HOME, true);
    expect(html).toContain('<span class="site-menu-link" aria-current="page">Início</span>');
    expect(html).toContain('<span class="site-menu-link">Sobre</span>');
    expect(html).not.toContain("href=");
    expect(html).toContain("Conheça");
  });
});

describe("what a page says to the browser and to search engines", () => {
  const published = (content: SiteContent): PublicSite => ({ slug: "marina", number: 1, publishedAt: "2026-10-29T12:00:00.000Z", content, images: {}, inquiriesOpen: false });
  const content = site([paragraph("a")], [sub("p1", "sobre", [paragraph("b")], { title: "Sobre mim", description: "Quem sou" }), sub("p2", "planos", [paragraph("c")], { title: "Planos" })]);
  it("titles the home page with the site's, and a page with its own then the site's", () => {
    expect(publicMetadata(published(content), HOME)).toMatchObject({ title: { absolute: "Marina Treinos" }, description: "Treino com acompanhamento" });
    expect(publicMetadata(published(content), "p1")).toMatchObject({ title: { absolute: "Sobre mim — Marina Treinos" }, description: "Quem sou" });
    // The site's description stands in for a page that has none, and the address for a page that has no title.
    expect(publicMetadata(published(content), "p2")).toMatchObject({ description: "Treino com acompanhamento" });
    expect(publicMetadata(published(site([], [sub("p9", "equipe", [], { title: "" })])), "p9")).toMatchObject({ title: { absolute: "equipe — Marina Treinos" } });
  });
  it("asks search engines for what the site asked, the same on every page", () => {
    expect(publicMetadata(published(content), "p1").robots).toEqual({ index: true, follow: true });
    expect(publicMetadata(published({ ...content, indexable: false }), "p1").robots).toEqual({ index: false, follow: false });
  });
  it("says nothing of a page that is not there, or of a site that is not public", () => {
    expect(publicMetadata(published(content), "gone")).toMatchObject({ title: "Página não encontrada", robots: { index: false, follow: false } });
    expect(publicMetadata(null, HOME)).toMatchObject({ title: "Página não encontrada" });
  });
});
