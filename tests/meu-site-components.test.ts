import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MAX_COMPONENTS,
  MAX_COMPONENT_NODES,
  MAX_EXPANDED_NODES,
  allNodes,
  applyOverrides,
  componentById,
  componentsOf,
  documentNodes,
  emptyBlock,
  expandedCount,
  parseContent,
  publishIssues,
  referencedAssetIds,
  resolveServices,
  safeParseContent,
  siteContent,
  withoutResolvedServices,
  type BoxNode,
  type ComponentDef,
  type ComponentNode,
  type SiteContent,
  type SiteNode,
} from "@/modules/meu-site/contracts";
import { SiteRenderer, type EditHooks, type FieldSpec } from "@/modules/meu-site/renderer";
import { buildSiteCss } from "@/modules/meu-site/site-css";

const node = <T extends Parameters<typeof emptyBlock>[0]>(type: T, id: string, over: object = {}) => ({ ...emptyBlock(type, id), ...over }) as SiteNode;
const box = (id: string, children: SiteNode[], over: object = {}) => node("box", id, { children, ...over }) as BoxNode;
const instance = (id: string, componentId: string, overrides: ComponentNode["overrides"] = {}, over: object = {}): ComponentNode => ({ id, type: "component", componentId, overrides, ...over }) as ComponentNode;

/** A card: a box with a title, a text and a button. */
const card = (): ComponentDef => ({
  id: "plano",
  name: "Plano",
  root: box("card", [node("heading", "card-t", { text: "Plano mensal", level: 3 }), node("paragraph", "card-p", { text: "Texto do plano" }), node("button", "card-b", { label: "Quero", channel: "whatsapp" })], {
    style: { radius: "16px" },
  }),
});
const page = (blocks: SiteNode[], components: ComponentDef[] | null = [card()], over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
  ...(components ? { components } : {}),
  ...over,
});

describe("the document with components", () => {
  it("accepts a component and its instances, and reads back what it was given", () => {
    const content = page([instance("i1", "plano"), instance("i2", "plano", { "card-t": { text: "Plano trimestral" } })]);
    const parsed = siteContent.parse(content);
    expect(parsed.components).toHaveLength(1);
    expect(parsed).toEqual(content);
    expect(parseContent(JSON.parse(JSON.stringify(content)))).toEqual(content);
  });
  it("does not need the list: a document without components is read as it always was, and no list appears", () => {
    const content = page([node("text", "t", { text: "Oi" })], null);
    const parsed = siteContent.parse(content);
    expect("components" in parsed).toBe(false);
    expect(componentsOf(parsed)).toEqual([]);
    expect(JSON.stringify(parsed)).not.toContain("components");
  });
  it("refuses what is not a component: no name, an identifier that is not one, an unknown field", () => {
    const bad = (over: object) => siteContent.safeParse(page([], [{ ...card(), ...over } as ComponentDef])).success;
    expect(bad({})).toBe(true);
    expect(bad({ name: "" })).toBe(false);
    expect(bad({ name: "x".repeat(41) })).toBe(false);
    expect(bad({ id: "Plano Mensal" })).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
    expect(siteContent.safeParse(page([instance("i", "Plano Mensal")])).success).toBe(false);
    expect(siteContent.safeParse(page([{ ...instance("i", "plano"), extra: 1 } as SiteNode])).success).toBe(false);
  });
  it("keeps a component out of another one: there is no cycle to follow", () => {
    const inner = { ...card(), id: "outro", root: box("o", [instance("o-i", "plano")]) };
    expect(siteContent.safeParse(page([], [card(), inner])).success).toBe(false);
    const deep = { ...card(), root: box("r", [box("r2", [instance("r3", "plano")])]) };
    expect(siteContent.safeParse(page([], [deep])).success).toBe(false);
  });
  it("limits the components of a site and the nodes of one", () => {
    const many = (count: number) => Array.from({ length: count }, (_, at): ComponentDef => ({ id: `c${at}`, name: `Componente ${at}`, root: node("paragraph", `p${at}`) }));
    expect(siteContent.safeParse(page([], many(MAX_COMPONENTS))).success).toBe(true);
    expect(siteContent.safeParse(page([], many(MAX_COMPONENTS + 1))).success).toBe(false);
    const sized = (count: number): ComponentDef => ({ id: "grande", name: "Grande", root: box("g", Array.from({ length: count - 1 }, (_, at) => node("paragraph", `g${at}`))) });
    expect(allNodes([sized(MAX_COMPONENT_NODES).root])).toHaveLength(MAX_COMPONENT_NODES);
    expect(siteContent.safeParse(page([], [sized(MAX_COMPONENT_NODES)])).success).toBe(true);
    expect(siteContent.safeParse(page([], [sized(MAX_COMPONENT_NODES + 1)])).success).toBe(false);
  });
  it("needs distinct identifiers for the components, and for every node of the page and of the definitions", () => {
    expect(siteContent.safeParse(page([], [card(), card()])).success).toBe(false);
    expect(siteContent.safeParse(page([node("paragraph", "card-p")])).success).toBe(false);
    expect(siteContent.safeParse(page([node("paragraph", "card")])).success).toBe(false);
    const second: ComponentDef = { id: "outro", name: "Outro", root: node("paragraph", "card-t") };
    expect(siteContent.safeParse(page([], [card(), second])).success).toBe(false);
    expect(siteContent.safeParse(page([node("paragraph", "livre")])).success).toBe(true);
  });
  it("counts what is drawn: the page and every use of a component, and refuses a page that would print too much", () => {
    const big: ComponentDef = { id: "grande", name: "Grande", root: box("g", Array.from({ length: MAX_COMPONENT_NODES - 1 }, (_, at) => node("paragraph", `g${at}`))) };
    const uses = (count: number) => page(Array.from({ length: count }, (_, at) => instance(`u${at}`, "grande")), [big]);
    expect(expandedCount(uses(1))).toBe(1 + MAX_COMPONENT_NODES);
    const fits = Math.floor(MAX_EXPANDED_NODES / (1 + MAX_COMPONENT_NODES));
    expect(siteContent.safeParse(uses(fits)).success).toBe(true);
    expect(siteContent.safeParse(uses(fits + 1)).success).toBe(false);
    // The nodes of the page are counted for what they are, apart from the instances.
    expect(expandedCount(page([node("paragraph", "a"), node("paragraph", "b")], null))).toBe(2);
    // An instance of a component that is not there takes its own place only.
    expect(expandedCount(page([instance("i", "faltando")]))).toBe(1);
  });
  it("accepts an instance of a component that no longer exists (it is a warning when publishing, not an invalid document)", () => {
    expect(siteContent.safeParse(page([instance("i", "faltando", { x: { text: "oi" } })])).success).toBe(true);
    expect(componentById(page([]), "faltando")).toBeUndefined();
  });
  it("lists every node it keeps: the page's, and the ones in the definitions", () => {
    const content = page([instance("i", "plano"), node("paragraph", "solto")]);
    expect(documentNodes(content).map((entry) => entry.id)).toEqual(["i", "solto", "card", "card-t", "card-p", "card-b"]);
    expect(allNodes(content.blocks).map((entry) => entry.id)).toEqual(["i", "solto"]);
  });
  it("reads a document from the server in any version: the older ones come up without components", () => {
    const old = { schemaVersion: 2, title: "Marina", description: "", contact: { whatsapp: "", email: "", instagram: "" }, theme: { accent: "blue", mode: "light" }, blocks: [{ id: "h", type: "heading", text: "Oi" }] };
    const parsed = parseContent(old);
    expect(parsed.schemaVersion).toBe(3);
    expect("components" in parsed).toBe(false);
    expect(safeParseContent({ ...page([instance("i", "plano")]), components: "no" }).success).toBe(false);
  });
});

describe("what an instance changes", () => {
  it("accepts an override of the texts, labels, contacts and images that the definition has", () => {
    const image: ComponentDef = { id: "foto", name: "Foto", root: box("f", [node("image", "f-i")]) };
    const content = page(
      [instance("i", "plano", { "card-t": { text: "Outro" }, "card-p": { text: "Outro texto" }, "card-b": { label: "Escolher", channel: "email" } }), instance("j", "foto", { "f-i": { assetId: "abc", alt: "Foto", caption: "Legenda" } })],
      [card(), image],
    );
    expect(siteContent.safeParse(content).success).toBe(true);
  });
  it("refuses an override that is not one: a field that is not open, a wrong contact, a text too long for what it replaces", () => {
    const ok = (overrides: object) => siteContent.safeParse(page([instance("i", "plano", overrides as ComponentNode["overrides"])])).success;
    expect(ok({ "card-t": { text: "x".repeat(120) } })).toBe(true);
    expect(ok({ "card-t": { text: "x".repeat(121) } })).toBe(false);
    expect(ok({ "card-p": { text: "x".repeat(2000) } })).toBe(true);
    expect(ok({ "card-p": { text: "x".repeat(2001) } })).toBe(false);
    expect(ok({ "card-b": { label: "x".repeat(41) } })).toBe(false);
    expect(ok({ "card-b": { channel: "telefone" } })).toBe(false);
    expect(ok({ "card-b": { style: { color: "red" } } })).toBe(false);
    expect(ok({ "Card T": { text: "oi" } })).toBe(false);
    expect(ok({ "card-t": { text: 3 } })).toBe(false);
  });
  it("normalizes an override as it does any text: no control characters, surrounding space trimmed", () => {
    expect(siteContent.safeParse(page([instance("i", "plano", { "card-t": { text: "a\u0007b" } })])).success).toBe(false);
    const parsed = siteContent.parse(page([instance("i", "plano", { "card-t": { text: "  Oi  " } })]));
    expect((parsed.blocks[0] as ComponentNode).overrides["card-t"].text).toBe("Oi");
  });
  it("does not make an override of a node that is no longer there, or of a field that does not belong to it, an invalid document", () => {
    expect(siteContent.safeParse(page([instance("i", "plano", { "sumiu": { text: "oi" }, "card-t": { label: "nao" } })])).success).toBe(true);
  });
  it("limits how many nodes an instance changes", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_COMPONENT_NODES + 1 }, (_, at) => [`n${at}`, { text: "x" }]));
    expect(siteContent.safeParse(page([instance("i", "plano", many)])).success).toBe(false);
  });

  const root = card().root;
  it("lays the overrides over the nodes of the definition, and only over the ones that are open", () => {
    const drawn = applyOverrides(root, { "card-t": { text: "Novo" }, "card-b": { label: "Escolher", channel: "email" }, card: { text: "não é um campo aberto" } } as ComponentNode["overrides"]) as BoxNode;
    expect(drawn.children[0]).toMatchObject({ type: "heading", text: "Novo", level: 3 });
    expect(drawn.children[1]).toMatchObject({ text: "Texto do plano" });
    expect(drawn.children[2]).toMatchObject({ label: "Escolher", channel: "email" });
    expect(drawn).not.toHaveProperty("text");
    expect(drawn.style).toEqual({ radius: "16px" });
  });
  it("leaves the definition as it was: nothing is changed in place, and no override gives back the very same root", () => {
    const before = JSON.stringify(root);
    applyOverrides(root, { "card-t": { text: "Novo" } });
    expect(JSON.stringify(root)).toBe(before);
    expect(applyOverrides(root, {})).toBe(root);
  });
  it("ignores an override of a field the node does not have open, and of a node that is not there", () => {
    const drawn = applyOverrides(root, { "card-t": { label: "x", assetId: "y" }, "card-p": { alt: "z" }, sumiu: { text: "w" } } as ComponentNode["overrides"]) as BoxNode;
    expect(drawn.children[0]).toEqual(root.type === "box" ? root.children[0] : null);
    expect(drawn.children[1]).toEqual(root.type === "box" ? root.children[1] : null);
  });
  it("a new contact for a button takes away its link to a block (it goes to one or the other)", () => {
    const linked: ComponentDef = { id: "l", name: "L", root: box("l-b", [node("button", "l-x", { label: "Ver", anchor: "algum" })]) };
    const drawn = applyOverrides(linked.root, { "l-x": { channel: "whatsapp" } }) as BoxNode;
    expect(drawn.children[0]).toMatchObject({ channel: "whatsapp" });
    expect(drawn.children[0]).not.toHaveProperty("anchor");
    const kept = applyOverrides(linked.root, { "l-x": { label: "Outro" } }) as BoxNode;
    expect(kept.children[0]).toMatchObject({ label: "Outro", anchor: "algum" });
  });
});

describe("the images of a document with components", () => {
  it("are the ones of the page, of the definitions, of the styles of both and the ones an instance chooses", () => {
    const withImages: ComponentDef = {
      id: "foto",
      name: "Foto",
      root: box("f", [node("image", "f-i", { assetId: "da-definicao" })], { style: { bgImage: "fundo-da-definicao" } }),
    };
    const content = page(
      [node("image", "p-i", { assetId: "da-pagina" }), instance("i", "foto", { "f-i": { assetId: "da-instancia" } }, { style: { bgImage: "fundo-da-instancia" } })],
      [withImages],
      { logoAssetId: "logo" },
    );
    expect(referencedAssetIds(content).sort()).toEqual(["da-definicao", "da-instancia", "da-pagina", "fundo-da-definicao", "fundo-da-instancia", "logo"]);
  });
});

describe("publishing a page with components", () => {
  const issues = (content: SiteContent) => publishIssues(content, new Set(), null);
  const filled = card();
  it("has nothing to say about an instance of a complete component", () => {
    expect(issues(page([instance("i", "plano")]))).toEqual([]);
  });
  it("writes what is missing in a component as a warning about the block that stands on the page, with the name of the component", () => {
    const empty: ComponentDef = { ...filled, root: box("card", [node("heading", "card-t"), node("paragraph", "card-p"), node("button", "card-b", { label: "Quero", channel: "whatsapp" })]) };
    const found = issues(page([node("text", "t", { text: "x" }), instance("i", "plano")], [empty]));
    expect(found.map((issue) => issue.message)).toEqual(["Bloco 2 (Componente “Plano”), camada 1 (Título): escreva o título.", "Bloco 2 (Componente “Plano”), camada 2 (Parágrafo): escreva o texto."]);
    expect(found.every((issue) => issue.blockId === "i" && issue.block === 2 && issue.severity === "warning")).toBe(true);
  });
  it("is satisfied when the instance fills in what the definition left empty, and only for that instance", () => {
    const empty: ComponentDef = { ...filled, root: box("card", [node("heading", "card-t"), node("paragraph", "card-p", { text: "ok" })]) };
    const content = page([instance("a", "plano", { "card-t": { text: "Título" } }), instance("b", "plano")], [empty]);
    expect(issues(content).map((issue) => [issue.blockId, issue.message])).toEqual([["b", "Bloco 2 (Componente “Plano”), camada 1 (Título): escreva o título."]]);
  });
  it("says it about a component's own root, with no layer", () => {
    const lone: ComponentDef = { id: "u", name: "Só o título", root: node("heading", "u-h") };
    expect(issues(page([instance("i", "u")], [lone])).map((issue) => issue.message)).toEqual(["Bloco 1 (Componente “Só o título”): escreva o título."]);
  });
  it("sees the contact a button of an instance goes to: a contact that is not filled in is a warning", () => {
    const content = page([instance("i", "plano", { "card-b": { channel: "instagram" } })], [card()], { contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" } });
    expect(issues(content).map((issue) => issue.message)).toEqual(["Bloco 1 (Componente “Plano”), camada 3 (Botão): o botão leva ao Instagram, mas esse contato não está preenchido ou é inválido."]);
  });
  it("keeps what protects a person blocking: a testimony in a component asks for the authorization", () => {
    const testimony: ComponentDef = { id: "dep", name: "Depoimento", root: node("quote", "d-q", { quote: "Gostei", author: "Ana", authorized: false }) };
    const found = issues(page([instance("i", "dep")], [testimony]));
    expect(found.map((issue) => [issue.severity, issue.blockId])).toEqual([["blocking", "i"]]);
    expect(found[0].message).toContain("autorizou");
    const authorized: ComponentDef = { ...testimony, root: node("quote", "d-q", { quote: "Gostei", author: "Ana", authorized: true }) };
    expect(issues(page([instance("i", "dep")], [authorized]))).toEqual([]);
  });
  it("warns about an instance of a component that is not there", () => {
    const found = issues(page([instance("i", "faltando")]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ block: 1, blockId: "i", severity: "warning" });
    expect(found[0].message).toContain("não existe mais");
  });
  it("sees an image of the library that is not there any more, in a component and in what an instance chooses", () => {
    const photo: ComponentDef = { id: "foto", name: "Foto", root: node("image", "f-i", { assetId: "presente", alt: "Uma foto" }) };
    const content = page([instance("a", "foto"), instance("b", "foto", { "f-i": { assetId: "sumiu", alt: "Outra" } })], [photo]);
    const found = publishIssues(content, new Set(), new Set(["presente"]));
    expect(found.map((issue) => [issue.blockId, issue.message])).toEqual([["b", "Bloco 2 (Componente “Foto”): a imagem escolhida não está mais na biblioteca. Escolha outra."]]);
  });
});

describe("the services chosen in a component", () => {
  const services: ComponentDef = { id: "serv", name: "Serviços", root: box("s", [node("services", "s-s", { serviceIds: ["a"] })]) };
  const live = new Map([["a", { name: "Treino", description: null, delivery: "ONLINE" as const }]]);
  const itemsIn = (content: SiteContent) => ((componentsOf(content)[0].root as BoxNode).children[0] as { items?: unknown[] }).items;
  it("are written when publishing and taken away from the draft, in the definition as on the page", () => {
    const content = page([instance("i", "serv")], [services]);
    const resolved = resolveServices(content, live);
    expect(itemsIn(resolved)).toEqual([{ name: "Treino", delivery: "ONLINE" }]);
    expect(itemsIn(withoutResolvedServices(resolved))).toBeUndefined();
    expect(itemsIn(content)).toBeUndefined();
  });
  it("leave a document without components as it was", () => {
    const content = page([node("services", "s", { serviceIds: ["a"] })], null);
    expect("components" in resolveServices(content, live)).toBe(false);
    expect("components" in withoutResolvedServices(content)).toBe(false);
  });
});

describe("the style sheet of a page with components", () => {
  const sheet = (content: SiteContent) => buildSiteCss(content, { imageUrl: () => null });
  it("writes the style of a component once, however many times it is used, and the style of each instance", () => {
    const content = page([instance("a", "plano"), instance("b", "plano", {}, { style: { gap: "8px" } }), instance("c", "plano")]);
    const css = sheet(content);
    expect(css.split(".s-card.s-card.s-card{").length - 1).toBe(1);
    expect(css).toContain("border-radius:16px");
    expect(css.split(".s-b.s-b.s-b{").length - 1).toBe(1);
    expect(css).not.toContain(".s-a.");
  });
  it("is empty when nothing has a style, as before", () => {
    expect(sheet(page([instance("a", "plano")], [{ ...card(), root: node("paragraph", "p") }]))).toBe("");
  });
});

describe("the page drawn with components", () => {
  const html = (content: SiteContent, edit?: EditHooks, bare = false) => renderToStaticMarkup(createElement(SiteRenderer, { content, edit, bare }));
  /** The editor's text hook, as a plain marker that says which field of which block it was asked for. */
  const fields: FieldSpec[] = [];
  const hooks: EditHooks = {
    text: (field) => {
      fields.push(field);
      return createElement("i", { "data-field": `${field.blockId}|${field.path}` }, field.value);
    },
  };

  it("draws every instance with the nodes of the component inside a box of its own, and the instance's texts laid over", () => {
    const out = html(page([instance("a", "plano"), instance("b", "plano", { "card-t": { text: "Plano trimestral" }, "card-b": { label: "Escolher", channel: "email" } })]));
    expect(out.match(/class="site-component/g)).toHaveLength(2);
    expect(out.match(/<h3[^>]*>Plano mensal<\/h3>/g)).toHaveLength(1);
    expect(out).toContain(">Plano trimestral</h3>");
    expect(out.match(/Texto do plano/g)).toHaveLength(2);
    expect(out).toContain('href="https://wa.me/5511912345678"');
    expect(out).toContain('href="mailto:marina@example.test"');
    expect(out).toContain(">Escolher</a>");
  });
  it("gives the nodes of the component the classes of the component, and the instance the class of its own style only when it has one", () => {
    const out = html(page([instance("a", "plano"), instance("b", "plano", {}, { style: { gap: "8px" } })]));
    expect(out.match(/class="site-box s-card"/g)).toHaveLength(2);
    expect(out).toContain('class="site-component s-b"');
    expect(out).toContain('class="site-component"');
    // Nothing the stylesheet is keyed by is repeated as an id on the page.
    expect(out).not.toContain(' id="');
  });
  it("leaves out of the public page what is empty in the component, as it does for any block", () => {
    const empty: ComponentDef = { ...card(), root: box("card", [node("heading", "card-t"), node("paragraph", "card-p", { text: "ok" })]) };
    const out = html(page([instance("a", "plano"), instance("b", "plano", { "card-t": { text: "Com título" } })], [empty]));
    expect(out.match(/<h2/g)).toHaveLength(1);
    expect(out).toContain(">Com título</h2>");
  });
  it("draws nothing for a component that is not there on the public page, and a stand-in in the editor", () => {
    expect(html(page([instance("a", "faltando")]))).not.toContain("site-component");
    const editor = html(page([instance("a", "faltando")]), hooks);
    expect(editor).toContain("site-component-missing");
    expect(editor).toContain('data-block-id="a"');
  });
  it("in the editor, the instance is the block (the canvas finds it), and what is inside it is not", () => {
    const out = html(page([instance("a", "plano")]), hooks);
    expect(out).toContain('data-block-id="a" data-type="component"');
    expect(out).not.toContain('data-block-id="card');
    expect(out.match(/data-block-id=/g)).toHaveLength(1);
  });
  it("in the editor, a text the instance can change is a field of the instance, under the identifier of the node of the component", () => {
    fields.length = 0;
    const out = html(page([instance("a", "plano", { "card-t": { text: "Outro" } })]), hooks);
    expect(out).toContain('data-field="a|overrides.card-t.text"');
    expect(out).toContain('data-field="a|overrides.card-p.text"');
    expect(out).toContain('data-field="a|overrides.card-b.label"');
    expect(fields.map((field) => [field.blockId, field.path, field.value])).toEqual([
      ["a", "overrides.card-t.text", "Outro"],
      ["a", "overrides.card-p.text", "Texto do plano"],
      ["a", "overrides.card-b.label", "Quero"],
    ]);
  });
  it("in the editor, the texts of a section inside a component are the component's: they show, and cannot be typed over from the instance", () => {
    fields.length = 0;
    const withHero: ComponentDef = {
      id: "d",
      name: "Destaque",
      root: box("d-box", [node("hero", "d-h", { heading: "Título do destaque", buttonLabel: "Falar", buttonChannel: "whatsapp" }), node("text", "d-t", { heading: "Sobre", text: "Corpo do texto" }), node("cta", "d-c", { heading: "Vamos", text: "Chamada" })]),
    };
    const out = html(page([instance("a", "d")], [withHero]), hooks);
    expect(out).toContain("Título do destaque");
    expect(out).toContain("Corpo do texto");
    expect(out).toContain("site-inert");
    // The sections have a `text` of their own too: it is not one of the nodes that an instance can change.
    expect(fields).toEqual([]);
  });
  it("draws a component alone, without the header and the footer of the page", () => {
    const whole = html(page([instance("a", "plano")]));
    expect(whole).toContain("site-header");
    expect(whole).toContain("site-footer");
    const bare = html(page([instance("a", "plano")]), undefined, true);
    expect(bare).not.toContain("site-header");
    expect(bare).not.toContain("site-footer");
    expect(bare).toContain("site-component");
  });
});
