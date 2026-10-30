import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HOME, emptyBlock, resolveServices, type BoxNode, type ComponentDef, type ComponentNode, type PageDef, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import { MAX_CHANGES, NO_CHANGES, capped, diffContent, joined, type Change } from "@/modules/meu-site/release-diff";
import { previewPageUrl, previewUrl } from "@/modules/meu-site/image-urls";
import { ReleaseChanges, previewHref } from "@/modules/meu-site/release-changes";
import { SiteRenderer } from "@/modules/meu-site/renderer";

const node = <T extends Parameters<typeof emptyBlock>[0]>(type: T, id: string, over: object = {}) => ({ ...emptyBlock(type, id), ...over }) as SiteNode;
const box = (id: string, children: SiteNode[], over: object = {}) => node("box", id, { children, ...over }) as BoxNode;
const paragraph = (id: string, text = "Texto") => node("paragraph", id, { text });
const sub = (id: string, slug: string, blocks: SiteNode[] = [], over: Partial<PageDef> = {}): PageDef => ({ id, slug, title: slug[0].toUpperCase() + slug.slice(1), description: "", blocks, ...over });
const site = (blocks: SiteNode[], over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "Treino com acompanhamento",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
  ...over,
});
const card = (): ComponentDef => ({ id: "plano", name: "Plano", root: box("card", [node("heading", "card-t", { text: "Plano mensal", level: 3 })]) });
const instance = (id: string, componentId = "plano"): ComponentNode => ({ id, type: "component", componentId, overrides: {} }) as ComponentNode;
const texts = (changes: Change[]) => changes.map((change) => change.text);
const only = (before: SiteContent, after: SiteContent) => diffContent(before, after).changes;

describe("two versions that are the same", () => {
  it("have no changes and mark nothing", () => {
    const content = site([paragraph("a"), box("b", [paragraph("c")])], { pages: [sub("p1", "sobre", [paragraph("d")])], components: [card()] });
    const diff = diffContent(content, structuredClone(content));
    expect(diff.changes).toEqual([]);
    expect(diff.marks.size).toBe(0);
    expect(NO_CHANGES).toContain("Nada mudou");
  });
  it("do not differ for the services the release wrote into the page and the draft does not carry", () => {
    const draft = site([node("services", "s", { serviceIds: ["x"] })]);
    const released = resolveServices(draft, new Map([["x", { name: "Consultoria", description: null, delivery: "ONLINE" as const }]]));
    expect(diffContent(released, draft).changes).toEqual([]);
    expect(diffContent(draft, released).changes).toEqual([]);
    // What is compared is the choice of services.
    const other = site([node("services", "s", { serviceIds: ["x", "y"] })]);
    expect(texts(only(released, other))).toEqual(["Serviços “Serviços”: mudou os serviços escolhidos."]);
  });
});

describe("what changed in the site as a whole", () => {
  const change = (over: Partial<SiteContent>) => texts(only(site([]), site([], over)));
  it("says the title, the description and the contacts, without writing the contacts out", () => {
    expect(change({ title: "Marina Personal" })).toEqual(["O título do site mudou de “Marina Treinos” para “Marina Personal”."]);
    expect(change({ description: "" })).toEqual(["A descrição do site para buscadores mudou de “Treino com acompanhamento” para vazio."]);
    const changed = change({ contact: { whatsapp: "(21) 99999-0000", email: "", instagram: "@marina.treinos" } });
    expect(changed).toEqual(["O WhatsApp mudou.", "O e-mail de contato mudou."]);
    expect(changed.join(" ")).not.toMatch(/9999|marina@/);
  });
  it("says the look: accent, brand, mode, font, width, logo and the wish to be left out of search engines", () => {
    expect(change({ theme: { accent: "green", mode: "light", width: "narrow" } })).toEqual(["A cor de destaque mudou de Azul para Verde."]);
    expect(change({ theme: { accent: "blue", mode: "dark", width: "narrow" } })).toEqual(["A aparência mudou de Claro para Escuro."]);
    expect(change({ theme: { accent: "blue", mode: "light", width: "full" } })).toEqual(["A largura da página mudou de Estreita (leitura) para Largura total."]);
    expect(change({ theme: { accent: "blue", mode: "light", width: "narrow", font: "serif" } })).toEqual(["A fonte da página mudou de Padrão da página para Com serifa."]);
    expect(change({ theme: { accent: "blue", mode: "light", width: "narrow", brand: "#aa3355" } })).toEqual(["A cor da marca foi escolhida."]);
    expect(change({ logoAssetId: "logo" })).toEqual(["O logotipo foi acrescentado."]);
    expect(change({ indexable: false })).toEqual(["O site passou a pedir aos buscadores que não o listem."]);
    const withBrand = site([], { theme: { accent: "blue", mode: "light", width: "narrow", brand: "#aa3355" } });
    expect(texts(only(withBrand, site([], { theme: { accent: "blue", mode: "light", width: "narrow", brand: "#0077b6" } })))).toEqual(["A cor da marca mudou."]);
    expect(texts(only(withBrand, site([])))).toEqual(["A cor da marca foi tirada."]);
    expect(texts(only(site([], { logoAssetId: "a" }), site([], { logoAssetId: "b" })))).toEqual(["O logotipo mudou."]);
    expect(texts(only(site([], { logoAssetId: "a" }), site([])))).toEqual(["O logotipo foi tirado."]);
    expect(texts(only(site([], { indexable: false }), site([])))).toEqual(["O site passou a aparecer nos buscadores."]);
  });
  it("tells the site's changes with no page", () => {
    expect(only(site([]), site([], { title: "Outro" }))).toEqual([expect.objectContaining({ page: null, kind: "changed", blockId: null })]);
  });
});

describe("what changed in the pages", () => {
  it("tells a page that came, with its address, and one that went", () => {
    const home = [paragraph("a")];
    const added = only(site(home), site(home, { pages: [sub("p1", "sobre")] }));
    expect(added).toEqual([expect.objectContaining({ page: "p1", kind: "added", text: "A página “Sobre” foi acrescentada, com o endereço /sobre." })]);
    const removed = only(site(home, { pages: [sub("p1", "sobre")] }), site(home));
    expect(removed).toEqual([expect.objectContaining({ page: "p1", kind: "removed", text: "A página “Sobre” foi removida." })]);
  });
  it("tells the title, the address, the description and the menu of a page that stayed", () => {
    const before = site([], { pages: [sub("p1", "sobre", [], { title: "Sobre", description: "Quem sou" })] });
    const after = site([], { pages: [sub("p1", "equipe", [], { title: "Equipe", description: "Quem somos", inMenu: false })] });
    expect(texts(only(before, after))).toEqual([
      "O título da página mudou de “Sobre” para “Equipe”.",
      "O endereço da página mudou de /sobre para /equipe.",
      "A descrição da página para buscadores mudou.",
      "A página saiu do menu.",
    ]);
    expect(texts(only(after, before))).toContain("A página entrou no menu.");
  });
  it("tells the order of the pages in the menu, not for a page that is new", () => {
    const one = sub("p1", "um");
    const two = sub("p2", "dois");
    expect(texts(only(site([], { pages: [one, two] }), site([], { pages: [two, one] })))).toEqual(["A ordem das páginas no menu mudou."]);
    expect(texts(only(site([], { pages: [one] }), site([], { pages: [two, one] })))).toEqual(["A página “Dois” foi acrescentada, com o endereço /dois."]);
  });
});

describe("what changed in the blocks", () => {
  it("tells a block that came, once for a container and what is inside it, and marks it", () => {
    const before = site([paragraph("a")]);
    const after = site([paragraph("a"), box("b", [paragraph("c", "Dentro"), paragraph("d", "Também")], { name: "Planos" })]);
    const diff = diffContent(before, after);
    expect(diff.changes).toEqual([expect.objectContaining({ page: HOME, kind: "added", blockId: "b", text: "Acrescentado: Planos, com 2 blocos dentro." })]);
    expect([...diff.marks]).toEqual([["b", "added"]]);
  });
  it("tells a block that went, with a few words of what it said", () => {
    const before = site([paragraph("a", "Esta é uma frase muito mais longa do que o que cabe numa linha da lista"), paragraph("b")]);
    const after = site([paragraph("b")]);
    const diff = diffContent(before, after);
    expect(texts(diff.changes)).toEqual(["Removido: Parágrafo “Esta é uma frase muito mais…”."]);
    expect(diff.marks.size).toBe(0);
    expect(diffContent(site([box("x", [paragraph("y")])]), site([])).changes.map((change) => change.text)).toEqual(["Removido: Contêiner, com 1 bloco dentro."]);
  });
  it("says what changed in a block that stayed, with the name of each field, and marks it", () => {
    const before = site([node("hero", "h", { heading: "Antigo", subheading: "Igual", style: { gap: "8px" } })]);
    const after = site([node("hero", "h", { heading: "Novo", subheading: "Igual", style: { gap: "16px" }, styleMobile: { hidden: true } })]);
    const diff = diffContent(before, after);
    expect(texts(diff.changes)).toEqual(["Destaque “Novo”: mudou o título, o estilo do computador e o estilo do celular."]);
    expect(diff.marks.get("h")).toBe("changed");
    expect(diff.changes[0]).toMatchObject({ kind: "changed", blockId: "h", page: HOME });
    expect(texts(only(site([node("image", "i", { assetId: "a", alt: "x" })]), site([node("image", "i", { assetId: "b", alt: "x" })])))).toEqual(["Imagem “x”: mudou a imagem."]);
    expect(texts(only(site([node("button", "b", { label: "Ir", channel: "whatsapp" })]), site([node("button", "b", { label: "Ir", page: "p1" })])))).toEqual(["Botão “Ir”: mudou o contato e a página de destino."]);
  });
  it("tells that the shape of an image's frame changed", () => {
    const before = site([node("image", "i", { assetId: "a", alt: "x" })]);
    const after = site([node("image", "i", { assetId: "a", alt: "x", ratio: "4:5" })]);
    expect(texts(only(before, after))).toEqual(["Imagem “x”: mudou a proporção da imagem."]);
  });
  it("tells a block that is in another place, and one that moved to another page", () => {
    const a = paragraph("a", "Move");
    const before = site([box("c1", [a]), box("c2", [])], { pages: [sub("p1", "sobre", [paragraph("z")])] });
    const intoOther = site([box("c1", []), box("c2", [a])], { pages: [sub("p1", "sobre", [paragraph("z")])] });
    expect(texts(only(before, intoOther))).toEqual(["Parágrafo “Move”: foi para outro lugar da página."]);
    expect(only(before, intoOther)[0].kind).toBe("moved");
    const toPage = site([box("c1", []), box("c2", [])], { pages: [sub("p1", "sobre", [paragraph("z"), a])] });
    const moved = only(before, toPage);
    expect(texts(moved)).toEqual(["Parágrafo “Move”: foi para a página “Sobre”."]);
    expect(moved[0]).toMatchObject({ page: "p1", kind: "moved", blockId: "a" });
  });
  it("tells the order of blocks that stayed in the same place, for the place", () => {
    const [a, b, c] = [paragraph("a", "A"), paragraph("b", "B"), paragraph("c", "C")];
    expect(texts(only(site([a, b, c]), site([c, a, b])))).toEqual(["A ordem dos blocos da página mudou."]);
    expect(only(site([a, b, c]), site([c, a, b]))[0].blockId).toBeNull();
    const inside = diffContent(site([box("x", [a, b], { name: "Linha" })]), site([box("x", [b, a], { name: "Linha" })]));
    expect(texts(inside.changes)).toEqual(["A ordem dos blocos dentro de Linha mudou."]);
    expect(inside.marks.get("x")).toBe("changed");
  });
  it("does not tell an order that only follows the blocks around that came or went", () => {
    const [a, b, c] = [paragraph("a"), paragraph("b"), paragraph("c")];
    expect(texts(only(site([a, b, c]), site([b, c])))).toEqual(["Removido: Parágrafo “Texto”."]);
    expect(texts(only(site([a, b]), site([c, a, b])))).toEqual(["Acrescentado: Parágrafo “Texto”."]);
  });
  it("tells where a block is by its page", () => {
    const changes = only(site([paragraph("a")], { pages: [sub("p1", "sobre", [paragraph("b", "Antes")])] }), site([paragraph("a")], { pages: [sub("p1", "sobre", [paragraph("b", "Depois")])] }));
    expect(changes).toEqual([expect.objectContaining({ page: "p1", kind: "changed", blockId: "b" })]);
  });
});

describe("what changed in the components", () => {
  it("tells a component that came, went, was renamed or changed, and marks the blocks that use it", () => {
    const base = site([instance("i1"), instance("i2")], { components: [card()] });
    expect(texts(only(site([]), base))).toEqual(["Acrescentado: Componente.", "Acrescentado: Componente.", "O componente “Plano” foi acrescentado."]);
    expect(texts(only(base, site([instance("i1"), instance("i2")])))).toEqual(["O componente “Plano” foi removido."]);
    const renamed = site([instance("i1"), instance("i2")], { components: [{ ...card(), name: "Cartão" }] });
    expect(texts(only(base, renamed))).toEqual(["O componente “Plano” passou a se chamar “Cartão”."]);
    const root = box("card", [node("heading", "card-t", { text: "Plano trimestral", level: 3 })]);
    const changed = diffContent(base, site([instance("i1"), instance("i2")], { components: [{ ...card(), root }] }));
    expect(texts(changed.changes)).toEqual(["O componente “Plano” mudou: vale para todos os blocos que o usam."]);
    expect([...changed.marks].sort()).toEqual([["i1", "changed"], ["i2", "changed"]]);
  });
  it("marks a use that came with a component that changed as added, not as changed", () => {
    const root = box("card", [node("heading", "card-t", { text: "Outro", level: 3 })]);
    const diff = diffContent(site([], { components: [card()] }), site([instance("i1")], { components: [{ ...card(), root }] }));
    expect(diff.marks.get("i1")).toBe("added");
    expect(texts(diff.changes)).toContain("Acrescentado: Componente.");
  });
  it("tells what a use changes of its component as a change of that block", () => {
    const before = site([instance("i1")], { components: [card()] });
    const after = site([{ ...instance("i1"), overrides: { "card-t": { text: "Outro" } } } as ComponentNode], { components: [card()] });
    expect(texts(only(before, after))).toEqual(["Componente: mudou o que este uso muda do componente."]);
  });
});

describe("the list of changes", () => {
  it("is cut at the limit and says how many were left out", () => {
    const many = site(Array.from({ length: 5 }, (_, index) => paragraph(`p${index}`)));
    const after = site([]);
    const diff = diffContent(many, after);
    expect(capped(diff)).toEqual({ shown: diff.changes, left: 0 });
    const long = { changes: Array.from({ length: MAX_CHANGES + 7 }, (_, index) => ({ page: null, kind: "changed" as const, blockId: null, text: String(index) })), marks: new Map() };
    const cut = capped(long);
    expect(cut.shown).toHaveLength(MAX_CHANGES);
    expect(cut.left).toBe(7);
  });
  it("joins a few names the way a sentence does", () => {
    expect(joined([])).toBe("");
    expect(joined(["a"])).toBe("a");
    expect(joined(["a", "b"])).toBe("a e b");
    expect(joined(["a", "b", "c"])).toBe("a, b e c");
  });
});

describe("the blocks marked on the page of a version", () => {
  const draw = (content: SiteContent, marks?: Map<string, "added" | "changed">) => renderToStaticMarkup(createElement(SiteRenderer, { content, marks }));
  it("carry what the comparison found, and nothing is marked without one", () => {
    const before = site([paragraph("a", "Igual"), paragraph("b", "Antes")]);
    const after = site([paragraph("a", "Igual"), paragraph("b", "Depois"), node("heading", "c", { text: "Novo" })]);
    const { marks } = diffContent(before, after);
    const html = draw(after, marks);
    expect(html).toMatch(/<p class="site-text site-leaf" data-diff="changed">Depois<\/p>/);
    expect(html).toMatch(/<h2 class="site-heading site-leaf" data-diff="added">Novo<\/h2>/);
    expect(html).toMatch(/<p class="site-text site-leaf">Igual<\/p>/);
    expect(draw(after)).not.toContain("data-diff");
    expect(draw(after, new Map())).not.toContain("data-diff");
  });
  it("mark the use of a component that changed, and a container with a different order inside", () => {
    const before = site([instance("i1"), box("x", [paragraph("a"), paragraph("b")])], { components: [card()] });
    const root = box("card", [node("heading", "card-t", { text: "Outro", level: 3 })]);
    const after = site([instance("i1"), box("x", [paragraph("b"), paragraph("a")])], { components: [{ ...card(), root }] });
    const html = draw(after, diffContent(before, after).marks);
    expect(html).toContain('class="site-component" data-diff="changed"');
    expect(html).toMatch(/<div class="site-box" data-diff="changed">/);
  });
});

describe("where a version and its comparison are shown", () => {
  it("writes the version, what it is compared with and the page, in that order, and nothing that was not asked", () => {
    expect(previewUrl()).toBe("./previa");
    expect(previewUrl({ versao: "3" })).toBe("./previa?versao=3");
    expect(previewUrl({ versao: "3", desde: "rascunho", pagina: "abc" })).toBe("./previa?versao=3&desde=rascunho&pagina=abc");
    expect(previewUrl({ desde: "2" })).toBe("./previa?desde=2");
    expect(previewUrl({ pagina: null })).toBe("./previa");
    expect(previewPageUrl("p 1", { versao: "3", desde: "2" })).toBe("./previa?versao=3&desde=2&pagina=p%201");
    expect(previewPageUrl(null, { versao: "3" })).toBe("./previa?versao=3");
  });
  it("is the address of the app, for a link that has the mount put in front of it", () => {
    expect(previewHref({ versao: "3", desde: "2" })).toBe("/profissional/meu-site/previa?versao=3&desde=2");
    expect(previewHref()).toBe("/profissional/meu-site/previa");
  });
});

describe("the list of changes as the screen draws it", () => {
  const html = (before: SiteContent, after: SiteContent) => renderToStaticMarkup(createElement(ReleaseChanges, { diff: diffContent(before, after), shown: after, target: { versao: "2", desde: "1" } }));
  it("starts with the site, then the home page and the pages in the order of the menu, then the pages that went", () => {
    const before = site([paragraph("a", "Antes")], { pages: [sub("p9", "velha", [paragraph("v")])] });
    const after = site([paragraph("a", "Depois")], { title: "Outro", pages: [sub("p1", "um", [paragraph("x")]), sub("p2", "dois", [paragraph("y")])] });
    const text = html(before, after);
    const at = (needle: string) => text.indexOf(needle);
    expect([at('aria-label="O site"'), at('aria-label="Página inicial"'), at("aria-label=\"Página “Um”\""), at("aria-label=\"Página “Dois”\""), at('aria-label="Página removida"')].every((place) => place >= 0)).toBe(true);
    const places = [at('aria-label="O site"'), at('aria-label="Página inicial"'), at("aria-label=\"Página “Um”\""), at("aria-label=\"Página “Dois”\""), at('aria-label="Página removida"')];
    expect([...places].sort((a, b) => a - b)).toEqual(places);
  });
  it("links a page that is still there to the version with the comparison kept, and not a page that went", () => {
    const after = site([], { pages: [sub("p1", "um", [paragraph("x")])] });
    const text = html(site([]), after);
    expect(text).toContain('href="/profissional/meu-site/previa?versao=2&amp;desde=1&amp;pagina=p1"');
    const removed = html(site([], { pages: [sub("p9", "velha", [paragraph("v")])] }), site([]));
    expect(removed).toContain("Página removida");
    expect(removed).not.toContain("Ver esta página");
  });
  it("says so when nothing changed", () => {
    expect(html(site([paragraph("a")]), site([paragraph("a")]))).toContain(NO_CHANGES);
  });
});
