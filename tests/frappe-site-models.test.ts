import { describe, expect, it } from "vitest";
import { siteModelPage, type FrappeBlock } from "@/modules/frappe-editor/site-model-blocks";
import { SITE_MODELS_V1 } from "@/modules/meu-site/models";
import { whatsappUrl, type SiteNode } from "@/modules/meu-site/contracts";
import { renderBlocks } from "@/modules/frappe-site/render";
import { urlContext } from "@/modules/frappe-site/urls";

const TITLE = "Studio Exemplo";
const NUMBER = "(31) 98888-7777";

function* blocksOf(block: FrappeBlock): Generator<FrappeBlock> {
  yield block;
  for (const child of block.children) yield* blocksOf(child);
}

/** The texts only "Ver o modelo" has: empty on a created site (`say` in models/bricks.ts), paired node by node (the ids differ between builds). */
function previewOnly(preview: readonly SiteNode[], site: readonly SiteNode[], out: string[] = []): string[] {
  preview.forEach((node, at) => {
    const twin = site[at] as SiteNode;
    expect(twin.type).toBe(node.type);
    const pairs: Array<[string, string]> = [];
    if ((node.type === "heading" || node.type === "paragraph") && twin.type === node.type) pairs.push([node.text, twin.text]);
    if ((node.type === "button" || node.type === "link") && twin.type === node.type) pairs.push([node.label, twin.label]);
    if (node.type === "quote" && twin.type === "quote") pairs.push([node.eyebrow, twin.eyebrow], [node.quote, twin.quote], [node.author, twin.author]);
    for (const [shown, created] of pairs) if (created === "" && shown !== "") out.push(shown);
    if (node.type === "box" && twin.type === "box") previewOnly(node.children, twin.children, out);
  });
  return out;
}

/** Every text of a document that the converter writes as a text of its own. */
function textsOf(nodes: readonly SiteNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "heading" || node.type === "paragraph") out.push(node.text);
    if (node.type === "button" || node.type === "link") out.push(node.label);
    if (node.type === "box") textsOf(node.children, out);
  }
  return out;
}

const unescape = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const draw = (root: FrappeBlock, forms = true) =>
  renderBlocks({
    blocks: [root],
    component: () => null,
    fontToken: () => null,
    url: urlContext("studio", 0),
    ...(forms ? { forms: { route: "", send: { action: "m/contato", noticeUrl: "../privacidade" } } } : null),
  });

describe.each(SITE_MODELS_V1.map((model) => [model.key, model] as const))("the site model %s as a page of the Editor Avançado", (_key, model) => {
  const root = siteModelPage(model, TITLE, { whatsapp: null });
  const all = [...blocksOf(root)];
  const json = JSON.stringify(root);

  it("is a tree the editor reads: a body at the root, one id per block, every link to a part of the page has its target", () => {
    expect(root).toMatchObject({ element: "div", originalElement: "body", blockId: "root" });
    expect(root.baseStyles).toMatchObject({ display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "Inter" });
    const ids = all.map((block) => block.blockId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(1).every((id) => id.startsWith(`${model.key}-`))).toBe(true);
    const targets = new Set(all.flatMap((block) => (block.attributes.id ? [block.attributes.id] : [])));
    const anchors = all.flatMap((block) => (block.attributes.href?.startsWith("#") && block.attributes.href.length > 1 ? [block.attributes.href.slice(1)] : []));
    expect(anchors.length).toBeGreaterThan(4);
    for (const anchor of anchors) expect(targets, anchor).toContain(anchor);
    // The header's menu and the contact part.
    expect(targets).toContain("contato");
    expect(all[1]).toMatchObject({ element: "header" });
    expect(all.filter((block) => block.element === "h1")).toHaveLength(1);
  });

  it("is deterministic and small enough for a page", () => {
    expect(JSON.stringify(siteModelPage(model, TITLE, { whatsapp: null }))).toBe(json);
    expect(json.length).toBeLessThan(1_400_000);
  });

  it("points to no file of the app and leaves no variable of the guided page's sheet", () => {
    expect(json).not.toContain("/site-models/");
    expect(json).not.toContain("modelo:");
    expect(json).not.toContain("var(--site-");
    for (const block of all.filter((entry) => entry.element === "img")) {
      expect(block.attributes.src).toBeUndefined();
      expect(block.attributes.alt).toBe("Troque pela sua foto");
      expect(block.baseStyles.aspectRatio).toMatch(/^\d+ \/ \d+$/);
    }
  });

  it("publishes no sample of the model: what a created site leaves empty is a marker in brackets", () => {
    const site = model.build(TITLE, "site");
    // A sample that is also a text of the model elsewhere (a coach's "Força e potência" is also a program's title) is not a sample there.
    const modelTexts = new Set(textsOf(site.blocks));
    const samples = previewOnly(model.build(TITLE, "preview").blocks, site.blocks).filter((sample) => !modelTexts.has(sample));
    expect(samples.length).toBeGreaterThan(5);
    const texts = all.flatMap((block) => (block.innerHTML ? [unescape(block.innerHTML).trim()] : []));
    for (const sample of samples) {
      expect(texts, sample).not.toContain(sample.trim());
      if (sample.trim().length >= 12) expect(json, sample).not.toContain(sample.trim());
    }
    // (A layer may be named for what goes in it, "Valor (R$)": what the page shows is checked.)
    const page = texts.join("\n");
    for (const invented of ["R$", "+500", "98%", "SEU NOME AQUI", "MAIS POPULAR", "Depoimento de demonstração", "★"]) expect(page).not.toContain(invented);
    // The person's own name (Performance has a team of coaches in place of one professional).
    expect(texts.some((text) => text === "[Seu nome]" || text === "[Nome do profissional]")).toBe(true);
    expect(texts).toContain("[Preço do plano]");
    expect(texts).toContain("[Número]");
    expect(texts).toContain("[Depoimento de um aluno]");
  });

  it("sends the contact buttons to the organization's contacts, and without one says what is missing and goes nowhere (never a made-up number)", () => {
    expect(json).not.toContain("wa.me");
    expect(json).not.toContain("mailto:");
    expect(json).not.toContain("instagram.com");
    const whatsappLinks = (page: FrappeBlock) => [...blocksOf(page)].filter((block) => block.innerHTML?.includes("<svg") && block.element === "a");
    expect(whatsappLinks(root).length).toBeGreaterThan(2);
    for (const link of whatsappLinks(root)) {
      expect(link.attributes.href).toBeUndefined();
      expect(link.innerHTML).toContain("[Seu WhatsApp]");
    }
    expect(JSON.stringify(siteModelPage(model, TITLE, { whatsapp: "123" }))).not.toContain("wa.me");

    const withContacts = siteModelPage(model, TITLE, { whatsapp: NUMBER, email: "marina@example.test", instagram: "@marina.treinos" });
    const expected = whatsappUrl(NUMBER, "Olá! Gostaria de conhecer seus treinos.");
    expect(expected).toMatch(/^https:\/\/wa\.me\/5531988887777\?text=/);
    for (const link of whatsappLinks(withContacts)) {
      expect(link.attributes).toMatchObject({ href: expected, target: "_blank" });
      expect(link.innerHTML).not.toContain("[Seu WhatsApp]");
    }
    const written = JSON.stringify(withContacts);
    // The footer's e-mail and Instagram, where the model has them, go to the organization's.
    if (json.includes("[Seu e-mail]")) expect(written).toContain("mailto:marina@example.test");
    if (json.includes("[Seu Instagram]")) expect(written).toContain("https://www.instagram.com/marina.treinos/");
    expect(written).not.toMatch(/\[Seu (WhatsApp|e-mail|Instagram)\]/);
  });

  it("is drawn by the public page's renderer with its anchors, questions, WhatsApp mark and form", () => {
    const out = draw(root);
    expect(out.truncated).toBe(false);
    expect(out.body.startsWith("<body")).toBe(true);
    for (const id of all.flatMap((block) => (block.attributes.id ? [block.attributes.id] : []))) expect(out.body).toContain(` id="${id}"`);
    for (const href of new Set(all.flatMap((block) => (block.attributes.href ? [block.attributes.href] : [])))) expect(out.body).toContain(`href="${href}"`);
    expect(out.body).toContain("<details");
    expect(out.body).toContain("<summary");
    // (The sanitizer writes attribute names in lower case; the HTML parser gives an SVG its `viewBox` back.)
    expect(out.body).toContain('<svg width="20" height="20" viewbox="0 0 20 20"');
    expect(out.body).toContain("<path d=\"M14.56");
    expect(out.body).not.toContain("<iframe");
    expect(out.fonts.has("Inter")).toBe(true);
    // The form receives messages where the forms are open: a name and a way back, with no consent box (the notice is only linked).
    expect(out.forms).toHaveLength(1);
    expect(out.forms[0]!.problems).toEqual([]);
    expect(out.forms[0]!.fields.map((field) => field.kind)).toEqual(["name", "email", "phone", "message"]);
    expect(out.body).toMatch(/<form [^>]*method="post"[^>]*action="m\/contato"/);
    expect(out.body).not.toContain('name="aceite"');
    expect(out.body).toContain('href="../privacidade"');
    // Closed, the form is read but not drawn.
    expect(draw(root, false).body).not.toContain("<form");
    expect(out.rules.join("\n")).not.toContain("var(--site-");
  });
});
