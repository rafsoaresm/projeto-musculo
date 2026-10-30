import { describe, expect, it } from "vitest";
import { renderBlocks, type Block } from "@/modules/frappe-site/render";
import { urlContext } from "@/modules/frappe-site/urls";

const ID = "0b9f2f7a-3c1e-4d55-9a7e-6f5d4c3b2a10";
const url = urlContext("studio", 0);
const draw = (blocks: unknown, components: Record<string, Block> = {}, tokens: Record<string, string> = {}) =>
  renderBlocks({ blocks, component: (id) => components[id] ?? null, fontToken: (name) => tokens[name.replace(/^--/, "")] ?? null, url });
const body = (children: Block[], root: Block = {}): Block[] => [{ blockId: "root", originalElement: "body", element: "div", baseStyles: { display: "flex" }, children, ...root }];

describe("blocks become elements with the classes of their styles", () => {
  it("draws the page as the editor drew it: body, container, text, in the order of the tree", () => {
    const out = draw(
      body(
        [
          {
            blockId: "c1",
            element: "div",
            baseStyles: { padding: "16px", backgroundColor: "#ededed" },
            tabletStyles: { padding: "8px" },
            mobileStyles: { padding: "4px" },
            children: [{ blockId: "t1", element: "p", innerHTML: "Olá <strong>mundo</strong>", baseStyles: { fontSize: "20px" } }],
          },
        ],
        { baseStyles: { display: "flex", background: "#101010" } },
      ),
    );
    expect(out.body).toBe('<body class="fb-1"><div class="fb-2"><div class="fb-3 __text_block__">Olá <strong>mundo</strong></div></div></body>');
    expect(out.rules).toEqual([
      ".fb-1 { display: flex;background: #101010; }",
      ".fb-2 { padding: 16px;background-color: #ededed; }",
      "@media only screen and (max-width: 1023px) { .fb-2 { padding: 8px; } }",
      "@media only screen and (max-width: 576px) { .fb-2 { padding: 4px; } }",
      ".fb-3 { font-size: 20px; }",
    ]);
    expect(out.background).toBe("#101010");
    expect(out.count).toBe(3);
  });

  it("reads the blocks from JSON text, and a page that cannot be read as an empty body", () => {
    expect(draw(JSON.stringify(body([{ element: "div", innerHTML: "x" }]))).body).toContain("x</div></body>");
    for (const broken of ["", "not json", "{", "null", 7, null, undefined]) expect(draw(broken).body, String(broken)).toBe("<body></body>");
  });

  it("takes the old `rawStyles` as base styles", () => {
    expect(draw([{ element: "div", rawStyles: { "background-color": "red", "hover:font-size": "2px" } }]).rules.join(" ")).toContain("background-color: red");
  });

  it("gives a text block the class of text and turns a paragraph into a div (a paragraph cannot hold one)", () => {
    expect(draw([{ element: "p", innerHTML: "a" }]).body).toBe('<body><div class="__text_block__">a</div></body>');
    expect(draw([{ element: "h1", innerHTML: "T" }]).body).toBe('<body><h1 class="__text_block__">T</h1></body>');
  });
});

describe("what a page may be made of", () => {
  it("turns an element that is not on the list into a div, and draws no script, frame or object", () => {
    for (const element of ["script", "iframe", "object", "embed", "style", "link", "meta", "svg", "dialog", "template", "x-custom"]) {
      const out = draw([{ element, innerHTML: "dentro", baseStyles: { color: "red" } }]).body;
      expect(out, element).toBe(`<body><div class="fb-1">dentro</div></body>`);
    }
    expect(draw([{ element: "div", children: [{ element: "body", innerHTML: "x" }] }]).body).toBe("<body><div><div>x</div></div></body>");
  });

  it("does not draw the HTML block (free code runs only in its own isolated frame), a block with a condition on data, or what a repeater would loop over", () => {
    const out = draw(
      body([
        { element: "div", originalElement: "__raw_html__", innerHTML: "<script>alert(1)</script>" },
        { element: "div", innerHTML: "condicional", visibilityCondition: "mostrar" },
        { element: "div", innerHTML: "condicional 2", visibilityCondition: { key: "mostrar", comesFrom: "props" } },
        { element: "div", isRepeaterBlock: true, dataKey: { key: "itens", comesFrom: "dataScript" }, children: [{ element: "div", innerHTML: "item" }] },
        { element: "div", innerHTML: "visível", visibilityCondition: "" },
      ]),
    ).body;
    expect(out).not.toMatch(/script|condicional|item/);
    expect(out).toContain("visível");
  });

  it("does not run a script of a block, but applies its style sheet to the block only", () => {
    const out = draw([{ element: "div", innerHTML: "x", clientScript: { js: "alert(1)", css: ".x{color:red}" }, blockClientScript: "alert(2)" }]);
    expect(out.body).toBe('<body><div class="fb-1">x</div></body>');
    expect(out.rules).toEqual(["@scope (.fb-1) { .x{color:red} }"]);
  });

  it("cannot be made to write a declaration, a rule or an element out of a value", () => {
    const out = draw([{ element: "div", baseStyles: { color: "red; } body { display: none", "background-image": "url(https://evil.test/a.png)", width: "10px" }, innerHTML: "x" }]);
    expect(out.rules.join("")).toBe(".fb-1 { width: 10px; }");
    expect(draw([{ element: "div", classes: ['"><script>alert(1)</script>', "ok", "also-ok_1"], innerHTML: "x" }]).body).toBe('<body><div class="ok also-ok_1">x</div></body>');
    expect(draw([{ element: "div", attributes: { onclick: "alert(1)", id: "a b", title: '"><script>' }, innerHTML: "x" }]).body).toBe('<body><div title="&quot;&gt;&lt;script&gt;">x</div></body>');
  });

  it("writes forms without an action: where they go is the site's to decide, never the page's", () => {
    const out = draw([{ element: "form", attributes: { action: "https://evil.test/steal", method: "post" }, children: [{ element: "input", attributes: { type: "text", name: "nome", formaction: "x" } }] }]).body;
    expect(out).toBe('<body><form method="post"><input type="text" name="nome"></form></body>');
  });
});

describe("links and images", () => {
  it("writes the address of a link from the page: a page of the site, a place, the web", () => {
    expect(draw([{ element: "a", attributes: { href: "/sobre" }, innerHTML: "x" }]).body).toBe('<body><a href="studio/sobre" class="__text_block__">x</a></body>');
    expect(draw([{ element: "a", attributes: { href: "javascript:alert(1)" }, innerHTML: "x" }]).body).toBe('<body><a class="__text_block__">x</a></body>');
    expect(draw([{ element: "a", attributes: { href: "https://exemplo.com.br" }, innerHTML: "x" }]).body).toContain('rel="noopener noreferrer"');
  });

  it("draws an image of the site, with the dark one in a picture; any other image leaves its box empty", () => {
    const own = `/app/s/studio/m/${ID}`;
    expect(draw([{ element: "img", attributes: { src: own, alt: "foto" } }]).body).toBe(`<body><img src="../s/studio/m/${ID}" alt="foto"></body>`);
    expect(draw([{ element: "img", attributes: { src: own, darkSrc: own } }]).body).toBe(
      `<body><picture style="display: contents;"><source srcset="../s/studio/m/${ID}" media="(prefers-color-scheme: dark)" style="display: none;"><img src="../s/studio/m/${ID}"></picture></body>`,
    );
    expect(draw([{ element: "img", attributes: { src: "https://evil.test/p.png" }, baseStyles: { width: "10px" } }]).body).toBe('<body><div class="fb-1"></div></body>');
    expect(draw([{ element: "img" }]).body).toBe("<body><div></div></body>");
    expect(draw([{ element: "video", attributes: { src: "https://evil.test/v.mp4", autoplay: "" } }]).body).toBe("<body><div></div></body>");
    expect(draw([{ element: "video", attributes: { src: own, autoplay: "", muted: "" } }]).body).toBe(`<body><video src="../s/studio/m/${ID}" autoplay muted></video></body>`);
  });

  it("writes the addresses of a page one level down, from where it is", () => {
    const deeper = renderBlocks({ blocks: [{ element: "a", attributes: { href: "/" }, innerHTML: "inicio" }, { element: "img", attributes: { src: `/s/studio/m/${ID}` } }], component: () => null, fontToken: () => null, url: urlContext("studio", 2) });
    expect(deeper.body).toBe(`<body><a href="../../studio" class="__text_block__">inicio</a><img src="../../../s/studio/m/${ID}"></body>`);
  });
});

describe("components", () => {
  const card: Block = { blockId: "card", element: "div", baseStyles: { color: "red" }, children: [{ blockId: "title", element: "p", innerHTML: "Padrão", baseStyles: { fontSize: "10px" } }] };

  it("are merged into their instances: the component's block, with the instance's text and styles over it", () => {
    const out = draw(
      body([{ blockId: "i1", extendedFromComponent: "card", baseStyles: { color: "blue" }, children: [{ blockId: "i2", referenceBlockId: "title", innerHTML: "Meu texto" }] }]),
      { card },
    );
    expect(out.body).toContain('<div class="fb-2"><div class="fb-3 __text_block__">Meu texto</div></div>');
    expect(out.rules).toContain(".fb-2 { color: blue; }");
    expect(out.rules).toContain(".fb-3 { font-size: 10px; }");
  });

  it("do not break the page when missing, or when they point to each other", () => {
    expect(draw([{ element: "div", extendedFromComponent: "gone", innerHTML: "fica" }]).body).toBe("<body><div>fica</div></body>");
    const a: Block = { blockId: "a", element: "div", extendedFromComponent: "b", innerHTML: "a" };
    const b: Block = { blockId: "b", element: "div", extendedFromComponent: "a", innerHTML: "b" };
    expect(draw([{ extendedFromComponent: "a" }], { a, b }).body).toMatch(/^<body><div>/);
  });
});

describe("fonts", () => {
  it("are the families a block asks for that are not the system's, with the weights", () => {
    const out = draw(
      body([
        { element: "div", innerHTML: "a", baseStyles: { fontFamily: "'Bebas Neue', Impact", fontWeight: "700" }, children: [{ element: "div", innerHTML: "b", baseStyles: { fontWeight: "400" } }] },
        { element: "div", innerHTML: "c", baseStyles: { fontFamily: "Arial" } },
        { element: "div", innerHTML: "d", baseStyles: { fontFamily: "var(--display)", fontWeight: "bold", fontStyle: "italic" } },
      ]),
      {},
      { display: "Oswald, sans-serif" },
    );
    expect([...out.fonts.keys()].sort()).toEqual(["Bebas Neue", "Oswald"]);
    expect([...out.fonts.get("Bebas Neue")!.weights].sort()).toEqual([400, 700]);
    expect(out.fonts.get("Oswald")).toEqual({ weights: new Set([700]), italic: true });
  });
});

describe("limits", () => {
  it("stops a tree that is too deep or too large, and says so", () => {
    let deep: Block = { element: "div", innerHTML: "fundo" };
    for (let level = 0; level < 200; level += 1) deep = { element: "div", children: [deep] };
    const out = draw([deep]);
    expect(out.truncated).toBe(true);
    expect(out.body).not.toContain("fundo");
    expect(out.body.match(/<div>/g)!.length).toBe(out.body.match(/<\/div>/g)!.length);
    const wide = draw([{ element: "div", children: Array.from({ length: 21_000 }, () => ({ element: "span" })) }]);
    expect(wide.truncated).toBe(true);
    expect(wide.count).toBe(20_000);
  });
});
