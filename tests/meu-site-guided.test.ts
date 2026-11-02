import { describe, expect, it } from "vitest";
import { siteContent, type SiteContent } from "@/modules/meu-site/contracts";
import { fieldsOf, pageFields, sectionsOf, withField } from "@/modules/meu-site/guided-model";
import { starterOf } from "@/modules/meu-site/page-model";

const content = siteContent.parse({
  ...starterOf("single", "Marina Personal"),
  description: "",
  blocks: [
    { id: "topo", type: "box", tag: "header", children: [{ id: "logo-t", type: "heading", level: 2, text: "Marina" }, { id: "menu-b", type: "button", label: "Falar comigo" }] },
    { id: "hero", type: "hero", eyebrow: "", heading: "Seu atendimento, seu jeito.", subheading: "", buttonLabel: "Entrar em contato" },
    {
      id: "faq",
      type: "faq",
      eyebrow: "",
      heading: "Perguntas",
      items: [
        { question: "Atende online?", answer: "Sim." },
        { question: "Quanto tempo?", answer: "Uma hora." },
      ],
    },
    { id: "foto", type: "box", tag: "section", name: "Sobre mim", children: [{ id: "img", type: "image", assetId: "", alt: "", caption: "", size: "full" }, { id: "p1", type: "paragraph", text: "Primeiro" }, { id: "p2", type: "paragraph", text: "Segundo" }] },
    { id: "rodape", type: "box", tag: "footer", children: [] },
  ],
}) as SiteContent;

describe("the Editor Guiado (Figma 10:162): sections and their fields", () => {
  it("lists the sections of the page in order, calling the header and the footer so and keeping a name the person gave", () => {
    expect(sectionsOf(content).map((section) => section.label)).toEqual(["Cabeçalho", "Destaque", "Perguntas frequentes", "Sobre mim", "Rodapé"]);
  });

  it("offers the texts, buttons and images of a section, numbered when there are more of a kind, and nothing of the layout", () => {
    expect(fieldsOf(content.blocks[1]!).map((field) => field.label)).toEqual(["Sobretítulo", "Título", "Descrição", "Botão principal"]);
    expect(fieldsOf(content.blocks[2]!).map((field) => field.label)).toEqual(["Sobretítulo", "Título", "Pergunta 1", "Resposta 1", "Pergunta 2", "Resposta 2"]);
    const about = fieldsOf(content.blocks[3]!);
    expect(about.map((field) => [field.label, field.kind])).toEqual([
      ["Imagem", "image"],
      ["Descrição da imagem", "text"],
      ["Texto", "multiline"],
      ["Texto 2", "multiline"],
    ]);
    expect(fieldsOf(content.blocks[4]!)).toEqual([]);
    expect(pageFields(content).map((field) => field.value)).toEqual(["Marina Personal", ""]);
  });

  it("changes one field and nothing else, cut to its size, inside containers and in the items of a list", () => {
    const next = withField(content, "hero.heading", "Treino sob medida");
    expect(next.blocks[1]).toMatchObject({ heading: "Treino sob medida", buttonLabel: "Entrar em contato" });
    expect(next.blocks[0]).toBe(content.blocks[0]);
    expect((withField(content, "p2.text", "Mudou").blocks[3] as { children: Array<{ text?: string }> }).children.map((child) => child.text)).toEqual([undefined, "Primeiro", "Mudou"]);
    expect((withField(content, "faq.items.1.answer", "Duas horas.").blocks[2] as { items: unknown[] }).items).toEqual([
      { question: "Atende online?", answer: "Sim." },
      { question: "Quanto tempo?", answer: "Duas horas." },
    ]);
    expect((withField(content, "menu-b.label", "x".repeat(100)).blocks[0] as { children: Array<{ label?: string }> }).children[1]!.label).toHaveLength(40);
    expect(withField(content, "page.title", "Novo título").title).toBe("Novo título");
    expect(siteContent.safeParse(withField(content, "img.alt", "Marina no estúdio")).success).toBe(true);
  });

  it("leaves the content as it was for a key that names nothing it offers (a style, an unknown block, the container itself)", () => {
    for (const key of ["hero.style", "nada.text", "foto.tag", "hero", "hero.items.0.question", ""]) expect(withField(content, key, "x"), key).toBe(content);
  });
});
