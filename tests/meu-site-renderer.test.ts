import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { SiteRenderer, type EditHooks, type FieldSpec } from "@/modules/meu-site/renderer";
import { emptyBlock, starterContent, type Block, type SiteContent } from "@/modules/meu-site/contracts";

const render = (content: SiteContent, edit?: EditHooks) => renderToStaticMarkup(createElement(SiteRenderer, { content, edit }));

const page = (over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 2,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  theme: { accent: "blue", mode: "light" },
  blocks: [
    { id: "h", type: "hero", eyebrow: "", heading: "Treino sob medida", subheading: "Com acompanhamento", buttonLabel: "Falar comigo", buttonChannel: "whatsapp" },
    { id: "t", type: "text", eyebrow: "", heading: "Sobre", text: "Primeira linha\nSegunda linha" },
    { id: "s", type: "services", eyebrow: "", heading: "Serviços", intro: "", serviceIds: ["x"], items: [{ name: "Consultoria online", description: "Plano mensal", delivery: "ONLINE" }] },
    { id: "f", type: "faq", eyebrow: "", heading: "Dúvidas", items: [{ question: "Atende online?", answer: "Sim." }, { question: "", answer: "sem pergunta" }] },
    { id: "c", type: "cta", eyebrow: "", heading: "Vamos conversar", text: "", buttonLabel: "Escrever por e-mail", buttonChannel: "email" },
  ],
  ...over,
});
const of = <T extends Block["type"]>(type: T, id: string, over: Partial<Extract<Block, { type: T }>>) => ({ ...emptyBlock(type, id), ...over }) as Block;
const rich = (): SiteContent =>
  page({
    theme: { accent: "green", mode: "dark" },
    blocks: [
      of("hero", "h", { eyebrow: "Personal trainer", heading: "Treino com método" }),
      of("about", "a", { heading: "Sobre mim", text: "Texto", stat: "10 anos", statLabel: "de profissão" }),
      of("quote", "q", { eyebrow: "", quote: "Gostei muito", author: "Ana, aluna", authorized: true }),
      of("stats", "st", { heading: "Método", items: [{ value: "01", label: "Avaliação" }, { value: "02", label: "" }, { value: "", label: "sem número" }] }),
      of("columns", "cols", {
        ratio: "left",
        left: [{ id: "l1", type: "heading", text: "Esquerda" }, { id: "l2", type: "paragraph", text: "Texto da esquerda" }],
        right: [{ id: "r1", type: "button", label: "Falar", channel: "whatsapp" }],
      }),
      of("heading", "hh", { text: "Título solto" }),
      of("paragraph", "pp", { text: "Parágrafo solto" }),
      of("button", "bb", { label: "Escrever", channel: "email" }),
    ],
  });

describe("the public page", () => {
  it("shows the blocks as text, with one h1, the services written into the release and the questions that are complete", () => {
    const html = render(page());
    expect(html).toContain("<h1>Treino sob medida</h1>");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("<h3>Consultoria online</h3>");
    expect(html).toContain('<p class="site-delivery">Online</p>');
    expect(html).not.toContain("Presencial");
    expect(html).toContain("<summary>Atende online?</summary>");
    expect(html).not.toContain("sem pergunta");
  });
  it("makes the links only from the contact fields: wa.me, mailto and instagram, with no opener on the external ones", () => {
    for (const html of [render(page()), render(rich())]) {
      expect(html).toContain('href="https://wa.me/5511912345678"');
      expect(html).toContain('href="mailto:marina@example.test"');
      expect(html).toContain('href="https://www.instagram.com/marina.treinos/"');
      for (const tag of html.match(/<a [^>]*href="https:[^>]*>/g) ?? []) expect(tag).toContain('rel="noopener noreferrer"');
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
      expect(hrefs.every((h) => h.startsWith("https://wa.me/") || h.startsWith("https://www.instagram.com/") || h.startsWith("mailto:"))).toBe(true);
    }
  });
  it("prints markup, scripts and event handlers typed into any field of any block as plain, escaped text", () => {
    const evil = `<script>alert(1)</script><img src=x onerror="alert(2)">`;
    const html = render(
      page({
        title: evil,
        blocks: [
          of("hero", "h", { eyebrow: evil, heading: evil, subheading: evil, buttonLabel: evil, buttonChannel: "whatsapp" }),
          of("text", "t", { eyebrow: evil, heading: evil, text: evil }),
          of("services", "s", { eyebrow: evil, heading: evil, intro: evil, items: [{ name: evil, description: evil, delivery: "HYBRID" }] }),
          of("about", "a", { eyebrow: evil, heading: evil, text: evil, stat: evil, statLabel: evil }),
          of("quote", "q", { eyebrow: evil, quote: evil, author: evil }),
          of("stats", "st", { eyebrow: evil, heading: evil, items: [{ value: evil, label: evil }] }),
          of("faq", "f", { eyebrow: evil, heading: evil, items: [{ question: evil, answer: evil }] }),
          of("cta", "c", { eyebrow: evil, heading: evil, text: evil, buttonLabel: evil, buttonChannel: "email" }),
          of("columns", "cols", {
            left: [{ id: "l1", type: "heading", text: evil }, { id: "l2", type: "paragraph", text: evil }],
            right: [{ id: "r1", type: "button", label: evil, channel: "whatsapp" }],
          }),
          of("heading", "hh", { text: evil }),
          of("paragraph", "pp", { text: evil }),
          of("button", "bb", { label: evil, channel: "email" }),
        ],
      }),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/\sonerror\s*=\s*"/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.match(/&lt;script&gt;/g)!.length).toBeGreaterThanOrEqual(20);
  });
  it("makes no link out of a contact that is not a phone number, an address or a handle", () => {
    const html = render(page({ contact: { whatsapp: "javascript:alert(1)", email: "https://evil.test", instagram: "https://evil.test/x" } }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("<footer");
    expect(html).not.toContain("Falar comigo");
    expect(html).not.toContain("Escrever por e-mail");
  });
  it("has nothing that runs or loads from elsewhere: no script, no iframe, no form, no image, no style, no inline style", () => {
    for (const html of [render(page()), render(rich())]) {
      for (const forbidden of ["<script", "<iframe", "<form", "<img", "<style", "<link", "<video", "<audio", "<object", "<embed", " style="]) expect(html, forbidden).not.toContain(forbidden);
    }
  });
  it("falls back to the title as the h1 when there is no highlight, and shows a starter page without inventing anything", () => {
    const noHero = render(page({ blocks: [of("text", "t", { text: "Só um texto" })] }));
    expect(noHero).toContain('<h1 class="site-brand">Marina Treinos</h1>');
    const starter = render(starterContent("Marina"));
    expect(starter).toContain("<h1>Marina</h1>");
    expect(starter).not.toContain("<a ");
  });
});

describe("the blocks of the visual editor, on the public page", () => {
  it("selects the colors by the two names of the look, and draws nothing else from the document", () => {
    const html = render(rich());
    expect(html).toContain('data-site-accent="green"');
    expect(html).toContain('data-site-mode="dark"');
    expect(render(page())).toContain('data-site-accent="blue" data-site-mode="light"');
  });
  it("shows the eyebrow only when there is one, above the title", () => {
    const html = render(rich());
    expect(html).toContain('<p class="site-eyebrow">Personal trainer</p>');
    expect(html.match(/site-eyebrow/g)).toHaveLength(1);
  });
  it("shows \"about me\" with its number only when there is one, a testimony with its author, and only the indicators that are complete", () => {
    const html = render(rich());
    expect(html).toContain("<strong>10 anos</strong>");
    expect(html).toContain("<span>de profissão</span>");
    expect(html).toContain("<blockquote>“Gostei muito”</blockquote>");
    expect(html).toContain("<figcaption>Ana, aluna</figcaption>");
    expect(html).toContain("<strong>01</strong>");
    expect(html).toContain("<span>Avaliação</span>");
    expect(html).not.toContain("sem número");
    expect(html.match(/<li><strong>/g)).toHaveLength(1);
    expect(render(page({ blocks: [of("about", "a", { text: "Texto" })] }))).not.toContain("site-stat");
  });
  it("lays the columns out with the ratio, the elements of each in order, and the buttons as links to the contacts", () => {
    const html = render(rich());
    expect(html).toContain("site-columns site-columns-left");
    expect(html.indexOf("Esquerda")).toBeLessThan(html.indexOf("Texto da esquerda"));
    expect(html.indexOf("Texto da esquerda")).toBeLessThan(html.indexOf(">Falar<"));
    expect(html).toContain('<h2 class="site-heading">Esquerda</h2>');
    expect(html).toContain('<a class="button primary" href="https://wa.me/5511912345678"');
    expect(html).not.toContain("data-single");
  });
  it("gives a single column the whole width, and prints nothing for columns that are empty", () => {
    const one = render(page({ blocks: [of("columns", "c", { left: [{ id: "l", type: "paragraph", text: "Só à esquerda" }], right: [] })] }));
    expect(one).toContain("data-single");
    expect(one.match(/class="site-column"/g)).toHaveLength(1);
    expect(render(page({ blocks: [of("columns", "c", {})] }))).not.toContain("site-columns");
  });
  it("shows an element that stands by itself, and nothing for one that has nothing to show", () => {
    const html = render(rich());
    expect(html).toContain("Título solto");
    expect(html).toContain("Parágrafo solto");
    expect(html).toContain('href="mailto:marina@example.test"');
    const nothing = render(page({ blocks: [of("heading", "a", {}), of("paragraph", "b", {}), of("button", "c", {}), of("button", "d", { label: "Sem contato", channel: "whatsapp" })], contact: { whatsapp: "", email: "", instagram: "" } }));
    expect(nothing).not.toContain("site-basic");
    expect(nothing).not.toContain("Sem contato");
  });
  it("has no mark of the editor: no editable field, no frame, no block identifier", () => {
    const html = render(rich());
    for (const mark of ["contenteditable", "site-editable", "data-block-id", "ve-frame", "ve-tools", "site-button-stand-in", "data-placeholder", "site-hint"]) expect(html, mark).not.toContain(mark);
  });
});

/** Stand-ins for what the editor gives the renderer: they only mark what they receive. */
function hooks() {
  const fields: FieldSpec[] = [];
  const frames: string[] = [];
  const empties: string[] = [];
  const edit: EditHooks = {
    text: (field) => {
      fields.push(field);
      return createElement("input", { "data-field": `${field.blockId}:${field.path}`, defaultValue: field.value, placeholder: field.placeholder });
    },
    frame: (entry, view: ReactNode, place) => {
      frames.push(`${entry.id}@${place.container}#${place.index}/${place.count}`);
      return createElement("div", { "data-frame": entry.id }, view);
    },
    empty: (container) => {
      empties.push(container);
      return createElement("div", { "data-empty": container });
    },
    columnProps: (columnsId, side) => ({ "data-column": `${columnsId}:${side}` }) as never,
    columnTools: (columnsId, side, count) => createElement("div", { "data-tools": `${columnsId}:${side}:${count}` }),
  };
  return { edit, fields, frames, empties };
}

describe("the same page, as the canvas of the editor", () => {
  it("gives every text of every block to the editor as a field with its place in the block, its limit and a placeholder", () => {
    const { edit, fields } = hooks();
    const html = render(rich(), edit);
    const paths = fields.map((f) => `${f.blockId}:${f.path}`);
    for (const expected of ["h:eyebrow", "h:heading", "h:subheading", "h:buttonLabel", "a:stat", "a:statLabel", "q:quote", "q:author", "st:items.0.value", "st:items.2.label", "l1:text", "l2:text", "r1:label", "hh:text", "pp:text", "bb:label"])
      expect(paths, expected).toContain(expected);
    expect(html).toContain('data-field="h:heading"');
    for (const field of fields) {
      expect(field.max, field.path).toBeGreaterThan(0);
      expect(field.placeholder, field.path).not.toBe("");
    }
    expect(fields.find((f) => f.path === "text" && f.blockId === "l2")?.multiline).toBe(true);
    expect(fields.find((f) => f.path === "heading" && f.blockId === "h")?.multiline).toBeUndefined();
  });
  it("frames each block of the page and of the columns with its place, and calls the empty place for what has no block", () => {
    const { edit, frames, empties } = hooks();
    render(page({ blocks: [of("hero", "h", {}), of("columns", "cols", { left: [{ id: "l1", type: "heading", text: "A" }], right: [] })] }), edit);
    expect(frames).toEqual(["h@root#0/2", "cols@root#1/2", "l1@cols:left#0/1"]);
    expect(empties).toEqual(["cols:right"]);
    const none = hooks();
    render(page({ blocks: [] }), none.edit);
    expect(none.empties).toEqual(["root"]);
  });
  it("shows what the public page leaves out, so it can be typed into: empty fields, incomplete questions, buttons with no contact", () => {
    const { edit, fields } = hooks();
    const html = render(page({ blocks: [of("hero", "h", {}), of("faq", "f", { items: [{ question: "Q?", answer: "" }] }), of("stats", "st", {}), of("heading", "x", {})], contact: { whatsapp: "", email: "", instagram: "" } }), edit);
    expect(html).toContain('data-field="h:heading"');
    expect(html).toContain('data-field="f:items.0.answer"');
    expect(fields.filter((f) => f.blockId === "st" && f.path.endsWith(".value"))).toHaveLength(3);
    expect(html).toContain('data-field="x:text"');
    expect(html).toContain("site-button-stand-in");
  });
  it("does not make a link of any button or contact: clicking in the canvas must select, not leave", () => {
    const { edit } = hooks();
    const html = render(rich(), edit);
    expect(html).not.toMatch(/<a\s/);
    expect(html).toContain("site-footer-link");
  });
  it("hands the drag handlers of each column and what closes it, and the services chosen show or ask to be chosen", () => {
    const { edit } = hooks();
    const html = render(rich(), edit);
    expect(html).toContain('data-column="cols:left"');
    expect(html).toContain('data-tools="cols:right:1"');
    const asking = render(page({ blocks: [of("services", "s", {})] }), edit);
    expect(asking).toContain("site-hint");
    const chosen = render(page({ blocks: [of("services", "s", { items: [{ name: "Consultoria", delivery: "ONLINE" }] })] }), edit);
    expect(chosen).not.toContain("site-hint");
    expect(chosen).toContain("Consultoria");
  });
});
