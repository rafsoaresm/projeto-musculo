import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SiteRenderer, type EditHooks, type FieldSpec, type ImageResolver } from "@/modules/meu-site/renderer";
import { libraryImages, publicImages } from "@/modules/meu-site/image-urls";
import { emptyBlock, starterContent, type Block, type SiteContent } from "@/modules/meu-site/contracts";

const render = (content: SiteContent, edit?: EditHooks, images?: ImageResolver) => renderToStaticMarkup(createElement(SiteRenderer, { content, edit, images }));

const page = (over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
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
    theme: { accent: "green", mode: "dark", width: "wide" },
    blocks: [
      of("hero", "h", { eyebrow: "Personal trainer", heading: "Treino com método" }),
      of("about", "a", { heading: "Sobre mim", text: "Texto", stat: "10 anos", statLabel: "de profissão" }),
      of("quote", "q", { eyebrow: "", quote: "Gostei muito", author: "Ana, aluna", authorized: true }),
      of("stats", "st", { heading: "Método", items: [{ value: "01", label: "Avaliação" }, { value: "02", label: "" }, { value: "", label: "sem número" }] }),
      of("box", "row", {
        tag: "section",
        style: { display: "flex", direction: "row", gap: "24px" },
        children: [
          of("box", "left", { children: [{ id: "l1", type: "heading", level: 3, text: "Esquerda" }, { id: "l2", type: "paragraph", text: "Texto da esquerda" }] }),
          of("box", "right", { style: { grow: 1 }, children: [{ id: "r1", type: "button", label: "Falar", channel: "whatsapp" }] }),
        ],
      } as never),
      of("heading", "hh", { text: "Título solto", level: 2 } as never),
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
          of("box", "cols", {
            name: evil,
            children: [
              of("box", "inner", { children: [{ id: "l1", type: "heading", level: 4, text: evil }, { id: "l2", type: "paragraph", text: evil }] }),
              { id: "r1", type: "button", label: evil, channel: "whatsapp" },
              { id: "k1", type: "link", label: evil, channel: "email" },
            ],
          } as never),
          of("heading", "hh", { text: evil, level: 2 } as never),
          of("paragraph", "pp", { text: evil }),
          of("button", "bb", { label: evil, channel: "email" }),
        ],
      }),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/\sonerror\s*=\s*"/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.match(/&lt;script&gt;/g)!.length).toBeGreaterThanOrEqual(22);
    // The name of a layer is for the editor: it is never printed on the page.
    const named = render(page({ blocks: [of("box", "n", { name: evil, children: [] } as never)] }));
    expect(named).not.toContain("script");
    expect(named).not.toContain("alert");
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
    expect(html).toContain('data-site-width="wide"');
    expect(render(page())).toContain('data-site-accent="blue" data-site-mode="light" data-site-width="narrow"');
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
  it("lays containers out in the order of the tree, with the tag chosen, the headings at their level and the buttons as links to the contacts", () => {
    const html = render(rich());
    expect(html).toContain('<section class="site-box s-row">');
    expect(html.indexOf("Esquerda")).toBeLessThan(html.indexOf("Texto da esquerda"));
    expect(html.indexOf("Texto da esquerda")).toBeLessThan(html.indexOf(">Falar<"));
    expect(html).toContain('<h3 class="site-heading site-leaf">Esquerda</h3>');
    expect(html).toContain('<h2 class="site-heading site-leaf">Título solto</h2>');
    expect(html).toContain('<a class="button primary site-leaf" href="https://wa.me/5511912345678"');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
  it("gives a node the class of its own identifier only when it has a style, and the page has no style attribute", () => {
    const html = render(rich());
    expect(html).toContain("s-row");
    expect(html).toContain("s-right");
    expect(html).not.toContain("s-left");
    expect(html).not.toContain("s-hh");
    expect(html).not.toContain(" style=");
    expect(render(page())).not.toMatch(/\ss-[a-z0-9-]+/);
  });
  it("prints an empty container (it may be a space or a background), and every tag a container may have", () => {
    for (const tag of ["div", "section", "header", "footer", "nav", "article", "aside"] as const) {
      expect(render(page({ blocks: [of("box", "b", { tag, children: [] } as never)] })), tag).toContain(`<${tag} class="site-box"></${tag}>`);
    }
  });
  it("shows the first highlight wherever it is in the tree as the only h1, and the others as h2", () => {
    const html = render(page({ blocks: [of("box", "c", { children: [of("hero", "h1x", { heading: "Primeiro" }), of("hero", "h2x", { heading: "Segundo" })] } as never)] }));
    expect(html).toContain("<h1>Primeiro</h1>");
    expect(html).toContain("<h2>Segundo</h2>");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<p class="site-brand">');
  });
  it("sends a button or a link to a block of the page by an anchor, and gives an id only to the blocks that are pointed to", () => {
    const html = render(
      page({
        blocks: [
          of("hero", "top", { heading: "Início" }),
          of("box", "c", { children: [of("paragraph", "p", { text: "Destino" })] } as never),
          of("button", "b", { label: "Ir ao início", anchor: "top" } as never),
          of("link", "k", { label: "Ver o destino", anchor: "p" } as never),
          of("link", "gone", { label: "Sem destino", anchor: "nope" } as never),
        ],
      }),
    );
    expect(html).toContain('<section class="site-section site-hero" id="s-top"');
    expect(html).toContain('<p class="site-text site-leaf" id="s-p">');
    expect(html).toContain('<a class="button primary site-leaf" href="#s-top">Ir ao início</a>');
    expect(html).toContain('<a class="site-link site-leaf" href="#s-p">Ver o destino</a>');
    expect(html).not.toContain("Sem destino");
    expect(html).not.toContain('id="s-c"');
    expect(html).not.toContain('id="s-nope"');
    // An anchor never opens another page or window.
    for (const tag of html.match(/<a [^>]*href="#[^>]*>/g) ?? []) expect(tag).not.toContain("target=");
  });
  it("shows an element that stands by itself, and nothing for one that has nothing to show", () => {
    const html = render(rich());
    expect(html).toContain("Título solto");
    expect(html).toContain("Parágrafo solto");
    expect(html).toContain('href="mailto:marina@example.test"');
    const nothing = render(
      page({
        blocks: [of("heading", "a", {}), of("paragraph", "b", {}), of("button", "c", {}), of("button", "d", { label: "Sem contato", channel: "whatsapp" }), of("link", "e", { label: "Sem destino" } as never)],
        contact: { whatsapp: "", email: "", instagram: "" },
      }),
    );
    expect(nothing).not.toContain("site-leaf");
    expect(nothing).not.toContain("Sem contato");
    expect(nothing).not.toContain("Sem destino");
  });
  it("has no mark of the editor: no editable field, no frame, no block identifier", () => {
    const html = render(rich());
    for (const mark of ["contenteditable", "site-editable", "data-block-id", "data-type", "data-empty", "data-page-root", "ve-frame", "ve-tools", "site-button-stand-in", "data-placeholder", "site-hint"]) expect(html, mark).not.toContain(mark);
  });
});

/** A stand-in for what the editor gives the renderer: it only marks what it receives. */
function hooks() {
  const fields: FieldSpec[] = [];
  const edit: EditHooks = {
    text: (field) => {
      fields.push(field);
      return createElement("input", { "data-field": `${field.blockId}:${field.path}`, defaultValue: field.value, placeholder: field.placeholder });
    },
  };
  return { edit, fields };
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
    expect(fields.find((f) => f.blockId === "k1")).toBeUndefined();
    const withLink = render(page({ blocks: [of("link", "k1", { label: "Ver" } as never)] }), hooks().edit);
    expect(withLink).toContain('data-field="k1:label"');
    expect(withLink).toContain("site-link");
  });
  it("marks each node with its identifier and its type, and a container with nothing in it as empty, with no frame around anything", () => {
    const { edit } = hooks();
    const html = render(
      page({ blocks: [of("hero", "h", {}), of("box", "row", { children: [of("box", "col", { children: [{ id: "l1", type: "heading", level: 2, text: "A" }] }), of("box", "empty", { children: [] })] } as never)] }),
      edit,
    );
    expect(html).toContain('data-block-id="h" data-type="hero"');
    expect(html).toContain('<div class="site-box" data-block-id="row" data-type="box">');
    expect(html).toContain('<div class="site-box" data-block-id="empty" data-type="box" data-empty="">');
    expect(html).not.toContain('data-block-id="col" data-type="box" data-empty');
    expect(html).toContain('<h2 class="site-heading site-leaf" data-block-id="l1" data-type="heading">');
    expect(html).toContain("data-page-root");
    expect(html).not.toContain("ve-frame");
    // The structure is the one of the public page: the container holds its children directly.
    expect(html.indexOf('data-block-id="row"')).toBeLessThan(html.indexOf('data-block-id="col"'));
    expect(html).toMatch(/data-block-id="row" data-type="box"><div class="site-box" data-block-id="col"/);
  });
  it("says so when the page has no block at all", () => {
    expect(render(page({ blocks: [] }), hooks().edit)).toContain("A página está sem blocos");
    expect(render(page({ blocks: [] }))).not.toContain("A página está sem blocos");
  });
  it("carries the class of the node's style in the editor too, so the canvas is drawn by the same sheet", () => {
    const html = render(rich(), hooks().edit);
    expect(html).toContain('class="site-box s-row"');
    expect(html).toContain('class="site-box s-right"');
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
  it("does not make a link of any button, link or contact: clicking in the canvas must select, not leave", () => {
    const { edit } = hooks();
    const html = render(rich(), edit);
    expect(html).not.toMatch(/<a\s/);
    expect(html).toContain("site-footer-link");
    const anchors = render(page({ blocks: [of("hero", "top", {}), of("link", "k", { label: "Ver", anchor: "top" } as never)] }), edit);
    expect(anchors).not.toMatch(/<a\s/);
  });
  it("shows the services chosen, or asks for them to be chosen", () => {
    const { edit } = hooks();
    const asking = render(page({ blocks: [of("services", "s", {})] }), edit);
    expect(asking).toContain("site-hint");
    const chosen = render(page({ blocks: [of("services", "s", { items: [{ name: "Consultoria", delivery: "ONLINE" }] })] }), edit);
    expect(chosen).not.toContain("site-hint");
    expect(chosen).toContain("Consultoria");
  });
});

describe("images on the public page", () => {
  const pub = publicImages("/treinador", "marina", { "a-1": { width: 800, height: 600 }, "a-2": { width: 100, height: 100 } });
  const image = (id: string, over: object = {}) => of("image", id, { assetId: "a-1", alt: "Marina no estúdio", caption: "No estúdio", size: "medium", ...over } as never);
  it("draws an image of the release from the address of the page, with its size, its description, and lazily", () => {
    const html = render(page({ blocks: [image("i")] }), undefined, pub);
    expect(html).toContain('<img src="/treinador/s/marina/m/a-1" width="800" height="600" alt="Marina no estúdio" loading="lazy" decoding="async"/>');
    expect(html).toContain('<figure class="site-image site-leaf" data-size="medium">');
    expect(html).toContain("<figcaption>No estúdio</figcaption>");
  });
  it("loads from nowhere but the page's own address: every src, even with a hostile id or title", () => {
    const hostile = { "a\"onerror=\"x": { width: 1, height: 1 } };
    const html = render(page({ blocks: [image("i"), image("j", { assetId: "a\"onerror=\"x", alt: '"><script>alert(1)</script>' })], logoAssetId: "a-2", title: "<b>x</b>" }), undefined, (id) => publicImages("", "marina", { ...hostile, "a-1": { width: 1, height: 1 }, "a-2": { width: 1, height: 1 } })(id));
    const sources = [...html.matchAll(/ src="([^"]*)"/g)].map((m) => m[1]);
    expect(sources.length).toBe(3);
    for (const source of sources) expect(source).toMatch(/^\/s\/marina\/m\//);
    expect(html).not.toMatch(/\sonerror\s*=/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("shows nothing for an image that is not in the release, or for a block with no image chosen", () => {
    const html = render(page({ blocks: [image("i", { assetId: "gone" }), image("j", { assetId: "" })] }), undefined, pub);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("site-image");
    expect(html).not.toContain("site-leaf");
  });
  it("draws the logo before the name, with no description of its own (the name is right there), in the h1 too", () => {
    const withLogo = render(page({ logoAssetId: "a-2" }), undefined, pub);
    expect(withLogo).toContain('<p class="site-brand"><img class="site-logo" src="/treinador/s/marina/m/a-2" width="100" height="100" alt="" decoding="async"/>Marina Treinos</p>');
    const noHero = render(page({ logoAssetId: "a-2", blocks: [of("text", "t", { text: "Só um texto" })] }), undefined, pub);
    expect(noHero).toContain('<h1 class="site-brand"><img class="site-logo"');
    expect(render(page({ logoAssetId: "a-9" }), undefined, pub)).not.toContain("site-logo");
    expect(render(page({ logoAssetId: "a-2" }))).not.toContain("<img");
  });
  it("draws an image inside a container", () => {
    const html = render(page({ blocks: [of("box", "c", { children: [{ id: "in", type: "image", assetId: "a-1", alt: "No contêiner", caption: "", size: "full" }] } as never)] }), undefined, pub);
    expect(html).toContain('alt="No contêiner"');
    expect(html).toContain("site-box");
  });
  it("shows no image at all when the page is drawn without a way to find them (no storage)", () => {
    const html = render(page({ blocks: [image("i")], logoAssetId: "a-1" }));
    expect(html).not.toContain("<img");
  });
  it("in the editor, uses the editor's address with the session, and asks for the image where none is chosen", () => {
    const lib = libraryImages("", [{ id: "a-1", width: 800, height: 600 }]);
    const { edit, fields } = hooks();
    const html = render(page({ blocks: [image("i", { caption: "Legenda" }), image("j", { assetId: "" })] }), edit, lib);
    expect(html).toContain('src="/profissional/meu-site/imagens/a-1"');
    expect(html).toContain("Escolha a imagem no painel à direita.");
    expect(fields.filter((f) => f.path === "caption").map((f) => f.blockId)).toEqual(["i", "j"]);
  });
});
