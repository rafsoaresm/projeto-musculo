import { describe, expect, it } from "vitest";
import {
  MAX_PAGES,
  MAX_SITE_NODES,
  allNodes,
  documentNodes,
  pageById,
  pagesOf,
  publishIssues,
  safeParseContent,
  siteContent,
  siteNodeCount,
  starterContent,
  type PageDef,
  type SiteContent,
  type SiteNode,
} from "@/modules/meu-site/contracts";
import { addPage, addPageFrom, pageFromModel, starterOf } from "@/modules/meu-site/page-model";
import { PAGE_MODELS, SITE_MODELS, SITE_MODEL_LABEL, pageModel } from "@/modules/meu-site/page-models";

const base = (over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks: [{ id: "h", type: "paragraph", text: "Início" }],
  ...over,
});

/** Every text a person reads or writes in a node: what a model may not fill in with words of its own. */
function texts(nodes: readonly SiteNode[]): string[] {
  const out: string[] = [];
  for (const entry of allNodes(nodes)) {
    const record = entry as unknown as Record<string, unknown>;
    for (const key of ["eyebrow", "heading", "subheading", "text", "intro", "stat", "statLabel", "quote", "author", "label", "buttonLabel", "alt", "caption"]) {
      if (typeof record[key] === "string" && record[key] !== "") out.push(record[key] as string);
    }
    if (Array.isArray(record.items)) {
      for (const item of record.items) for (const value of Object.values(item as Record<string, unknown>)) if (typeof value === "string" && value !== "") out.push(value);
    }
  }
  return out;
}
/** The words a model has: names of places, and the text of buttons and links that go to the person's own contacts. */
const ALLOWED = new Set([
  "Sobre mim",
  "Serviços",
  "Perguntas frequentes",
  "Depoimento",
  "Fale comigo",
  "Falar comigo",
  "Chamar no WhatsApp",
  "Enviar e-mail",
  "Abrir o Instagram",
  "Contato",
  "Quero este plano",
]);

describe("the models of a page", () => {
  it("are five, each with a name, a hint, a title and blocks", () => {
    expect(PAGE_MODELS.map((entry) => entry.key)).toEqual(["about", "services", "faq", "testimonials", "contact"]);
    for (const entry of PAGE_MODELS) {
      expect(entry.label.length).toBeGreaterThan(1);
      expect(entry.hint.length).toBeGreaterThan(10);
      expect(entry.title.length).toBeGreaterThan(1);
      expect(entry.build().length).toBeGreaterThan(0);
      expect(pageModel(entry.key)).toBe(entry);
    }
    expect(pageModel("none")).toBeUndefined();
  });
  it("make blocks that go in a document as they are, with identifiers that are new every time", () => {
    for (const entry of PAGE_MODELS) {
      const first = entry.build();
      const second = entry.build();
      const ids = (blocks: SiteNode[]) => allNodes(blocks).map((node) => node.id);
      expect(new Set(ids(first)).size).toBe(ids(first).length);
      expect(ids(first).some((id) => ids(second).includes(id)), entry.key).toBe(false);
      const page: PageDef = { id: "p1", slug: "x", title: entry.title, description: "", blocks: first };
      expect(safeParseContent(base({ pages: [page] })).success, entry.key).toBe(true);
    }
  });
  it("invent no text: only the names of places and the text of the contact buttons are filled in", () => {
    for (const entry of PAGE_MODELS) for (const text of texts(entry.build())) expect(ALLOWED.has(text), `${entry.key}: ${text}`).toBe(true);
  });
  it("go to the contacts the person has, and are the sections the library offers", () => {
    const contact = allNodes(pageModel("contact")!.build()).filter((node) => node.type === "button");
    expect(contact.map((node) => (node as { channel?: string }).channel)).toEqual(["whatsapp", "email", "instagram"]);
    const [title, group] = pageModel("contact")!.build();
    expect(title).toMatchObject({ type: "text", heading: "Contato" });
    expect(group).toMatchObject({ type: "box", name: "Contatos" });
    expect((group as { children: SiteNode[] }).children.map((node) => (node as { label: string }).label)).toEqual(["Chamar no WhatsApp", "Enviar e-mail", "Abrir o Instagram"]);
    expect(pageModel("about")!.build().map((node) => node.type)).toEqual(["about", "box", "cta"]);
    expect(pageModel("faq")!.build().map((node) => node.type)).toEqual(["faq", "cta"]);
  });
  it("bring the authorization of a testimony unticked, so nothing is published before it is confirmed", () => {
    const quotes = allNodes(pageModel("testimonials")!.build()).filter((node) => node.type === "quote");
    expect(quotes).toHaveLength(3);
    for (const quote of quotes) expect((quote as { authorized: boolean }).authorized).toBe(false);
    const content = base({ pages: [{ id: "p1", slug: "depoimentos", title: "Depoimentos", description: "", blocks: pageModel("testimonials")!.build() }] });
    const blocking = publishIssues(content, new Set()).filter((issue) => issue.severity === "blocking");
    expect(blocking.map((issue) => issue.page)).toEqual(["p1", "p1", "p1"]);
  });
  it("do not stop a publication for being empty: everything they leave to write is a warning", () => {
    for (const entry of PAGE_MODELS.filter((model) => model.key !== "testimonials")) {
      const content = base({ pages: [{ id: "p1", slug: "x", title: entry.title, description: "", blocks: entry.build() }] });
      const issues = publishIssues(content, new Set());
      expect(issues.filter((issue) => issue.severity === "blocking"), entry.key).toEqual([]);
      expect(issues.length, entry.key).toBeGreaterThan(0);
    }
  });
});

describe("a page that starts from a model", () => {
  it("has the title of the model and the address it makes, in the menu, at the end", () => {
    const added = addPageFrom(base(), "about");
    if (!added.ok) throw new Error("add");
    expect(pagesOf(added.content)).toEqual([expect.objectContaining({ id: added.id, slug: "sobre-mim", title: "Sobre mim", description: "" })]);
    expect(pagesOf(added.content)[0]).not.toHaveProperty("inMenu");
    expect(pagesOf(added.content)[0].blocks.map((node) => node.type)).toEqual(["about", "box", "cta"]);
    expect(siteContent.safeParse(added.content).success).toBe(true);
  });
  it("is the same model twice with an address of its own, and new identifiers in each", () => {
    const one = addPageFrom(base(), "services");
    if (!one.ok) throw new Error("add");
    const two = addPageFrom(one.content, "services");
    if (!two.ok) throw new Error("add");
    expect(pagesOf(two.content).map((entry) => entry.slug)).toEqual(["servicos", "servicos-2"]);
    expect(new Set(documentNodes(two.content).map((node) => node.id)).size).toBe(documentNodes(two.content).length);
    expect(safeParseContent(two.content).success).toBe(true);
  });
  it("is refused for a model that is not there, a site with all its pages and a site with no room for its blocks", () => {
    expect(addPageFrom(base(), "inventado")).toEqual({ ok: false, reason: "not-found" });
    let full = base();
    for (let count = 0; count < MAX_PAGES; count++) {
      const outcome = addPage(full);
      if (!outcome.ok) throw new Error("add");
      full = outcome.content;
    }
    expect(addPageFrom(full, "about")).toEqual({ ok: false, reason: "limit-pages" });
    const crowd = (prefix: string, count: number): SiteNode[] =>
      Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, type: "paragraph", text: "x" }) as SiteNode);
    const heavy = base({
      blocks: crowd("h", 40),
      pages: Array.from({ length: 4 }, (_, at) => ({
        id: `q${at}`,
        slug: `p${at}`,
        title: `P${at}`,
        description: "",
        blocks: Array.from({ length: 5 }, (_, box) => ({ id: `q${at}b${box}`, type: "box", tag: "div", children: crowd(`q${at}b${box}c`, 39) }) as unknown as SiteNode),
      })),
    });
    expect(siteNodeCount(heavy)).toBeGreaterThan(MAX_SITE_NODES - 20);
    expect(addPageFrom(heavy, "about")).toEqual({ ok: false, reason: "limit-site-nodes" });
  });
  it("makes the page itself without touching the document", () => {
    const content = base();
    const model = pageModel("faq")!;
    const page = pageFromModel(content, model, "new-id");
    expect(page).toMatchObject({ id: "new-id", slug: "perguntas-frequentes", title: "Perguntas frequentes" });
    expect(content.pages).toBeUndefined();
  });
});

describe("a site that starts from a model", () => {
  it("is one page, as it always was, or the complete site", () => {
    expect(SITE_MODELS).toEqual(["single", "complete"]);
    for (const model of SITE_MODELS) expect(SITE_MODEL_LABEL[model].label.length).toBeGreaterThan(3);
    const single = starterOf("single", "Marina Treinos");
    expect(single.blocks.map((node) => node.type)).toEqual(starterContent("Marina Treinos").blocks.map((node) => node.type));
    expect(single.pages).toBeUndefined();
  });
  it("has the home page and four more, with the title as the highlight and the menu made from the titles, in order", () => {
    const complete = starterOf("complete", "Marina Treinos");
    expect(siteContent.safeParse(complete).success).toBe(true);
    expect(complete.blocks.map((node) => node.type)).toEqual(["hero", "box", "cta"]);
    expect((complete.blocks[0] as { heading: string }).heading).toBe("Marina Treinos");
    expect(pagesOf(complete).map((entry) => [entry.slug, entry.title])).toEqual([
      ["sobre-mim", "Sobre mim"],
      ["servicos", "Serviços"],
      ["perguntas-frequentes", "Perguntas frequentes"],
      ["contato", "Contato"],
    ]);
    expect(pagesOf(complete).every((entry) => entry.inMenu === undefined)).toBe(true);
    expect(new Set(documentNodes(complete).map((node) => node.id)).size).toBe(documentNodes(complete).length);
    expect(siteNodeCount(complete)).toBeLessThan(MAX_SITE_NODES / 2);
    expect(pageById(complete, pagesOf(complete)[3].id)).toBeDefined();
  });
  it("invents no text either, and is not stopped when it is published empty", () => {
    const complete = starterOf("complete", "Marina Treinos");
    const allowed = new Set([...ALLOWED, "Marina Treinos"]);
    for (const text of texts(documentNodes(complete))) expect(allowed.has(text), text).toBe(true);
    const issues = publishIssues(complete, new Set());
    expect(issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
    expect(new Set(issues.map((issue) => issue.page)).size).toBeGreaterThan(2);
  });
  it("is made anew each time: two sites share no identifier", () => {
    const ids = (content: SiteContent) => documentNodes(content).map((node) => node.id);
    const one = ids(starterOf("complete", "A"));
    const two = ids(starterOf("complete", "B"));
    expect(one.some((id) => two.includes(id))).toBe(false);
  });
});
