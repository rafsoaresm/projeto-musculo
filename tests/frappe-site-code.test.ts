import { describe, expect, it } from "vitest";
import { CODE_BLOCKS_MAX, CODE_LETTERS_MAX, codeDocument, codePolicy, freeCodeOf, isActive, reachesOutside } from "@/modules/frappe-site/code";
import { renderBlocks, type Block } from "@/modules/frappe-site/render";
import { urlContext } from "@/modules/frappe-site/urls";

const url = urlContext("studio", 0);
const src = (index: number) => `../site/studio/m/codigo/page-1/${index}`;
const draw = (blocks: unknown, components: Record<string, Block> = {}, code: { src(index: number): string } | null = { src }) =>
  renderBlocks({ blocks, component: (id) => components[id] ?? null, fontToken: () => null, url, code: code ?? undefined });
const raw = (innerHTML: string, more: Block = {}): Block => ({ element: "div", originalElement: "__raw_html__", innerHTML, ...more });

describe("which blocks are free code: the editor's own rule, and code that is active", () => {
  it("is the HTML block (what a person pastes markup, styles or a script into) when what is pasted is active", () => {
    expect(freeCodeOf(raw('<div id="calc"></div><script>run()</script>'))).toBe('<div id="calc"></div><script>run()</script>');
    expect(freeCodeOf(raw("<style>p{color:red}</style><p>x</p>"))).toBe("<style>p{color:red}</style><p>x</p>");
    expect(freeCodeOf({ element: "p", originalElement: "__raw_html__", innerHTML: "<b>x</b><script>y()</script>" })).toBeNull(); // the editor draws a p as text
  });

  it("is not text with marks: that is drawn in the page like any text (the line of a quote, a bold word, a link), and an empty box is just a box", () => {
    expect(freeCodeOf(raw("<p>—Aldous Huxley,"))).toBeNull(); // what the blockquote template holds
    expect(freeCodeOf(raw('<p>texto <b>livre</b> e <a href="/sobre">um link</a></p>'))).toBeNull();
    expect(freeCodeOf(raw('<div style="color:red"><h2>Título</h2></div>'))).toBeNull();
    expect(freeCodeOf(raw(""))).toBeNull();
    expect(freeCodeOf({ element: "div", innerHTML: "<b>x</b>" })).toBeNull();
    // words that look like code in a block that holds no markup are words
    expect(freeCodeOf({ element: "div", innerHTML: "um endereço javascript: no meio do texto" })).toBeNull();
    expect(freeCodeOf({ element: "div", innerHTML: 'um onclick= solto e um srcdoc=' })).toBeNull();
  });

  it("knows active code: what runs, styles, frames or sends (a tag, a handler in any spelling, a javascript: address), and nothing else", () => {
    for (const code of ["<script>x()</script>", "<SCRIPT src=x></SCRIPT>", "< script>x()</script>", "<style>p{}</style>", '<link rel="stylesheet" href="x">', '<meta http-equiv="refresh" content="0">', "<base href=x>", "<iframe src=x></iframe>", "<object data=x></object>", "<embed src=x>", "<form action=x></form>", "<input>", "<textarea></textarea>", "<button>x</button>", "<video src=x></video>", "<canvas></canvas>", "<template></template>", "<b onclick=x()>y</b>", "<img src=x onerror=y>", "<svg/onload=x>", '<b\nonmouseover="x">y</b>', '<a href="javascript:x()">y</a>', "<a href=JavaScript:x()>y</a>", '<div srcdoc="x"></div>']) {
      expect(isActive(code), code).toBe(true);
    }
    for (const code of ["<p>texto</p>", "<b>x</b> <i>y</i>", '<a href="/sobre">x</a>', '<img src="/a.png" alt="x">', '<div style="color:red">x</div>', "só texto", "1 < 2 e 3 > 2", "a conta: online = 3", '<svg viewBox="0 0 4 4"><path d="M0 0"/></svg>', "<p>—Aldous Huxley,"]) {
      expect(isActive(code), code).toBe(false);
    }
    for (const code of ['<img src="a>b" onerror=x>', '<b a="x"onclick=y>z</b>', "<b a='1' onmouseover=x>"]) expect(isActive(code), code).toBe(true); // a ">" or a quote inside a value does not hide it
  });

  it("reads a long hostile run once: broken tags and quotes without an end do not make the scan slow", () => {
    const started = Date.now();
    for (const piece of ["<a ", '<a "', "<a '", '<a x="', "<a on", "<"]) expect(isActive(piece.repeat(CODE_LETTERS_MAX / piece.length))).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("is any other block that is not text, a button, a link or a form control, when its HTML holds active markup", () => {
    expect(freeCodeOf({ element: "div", innerHTML: "<b>x</b><img src=x onerror=y>" })).toBe("<b>x</b><img src=x onerror=y>");
    expect(freeCodeOf({ element: "div", innerHTML: "<b>x</b><img src=x>" })).toBeNull(); // markup alone is not code
    expect(freeCodeOf({ element: "section", innerHTML: "<style>p{color:red}</style>" })).toBe("<style>p{color:red}</style>");
    expect(freeCodeOf({ element: "div", innerHTML: "só texto" })).toBeNull();
    expect(freeCodeOf({ element: "div", innerHTML: "1 < 2 e 3 > 2" })).toBeNull();
    for (const element of ["p", "span", "h1", "h3", "label", "a", "li", "strong", "em", "i", "blockquote", "summary", "cite", "b", "button", "input", "textarea", "select", "option", "form"]) {
      expect(freeCodeOf({ element, innerHTML: "<b>x</b><script>y()</script>" }), element).toBeNull();
    }
  });

  it("is not a drawing: an SVG (a logo, an icon) is drawn in the page, filtered, never framed; and not what a repeater would loop over", () => {
    expect(freeCodeOf(raw('<svg viewBox="0 0 4 4"><path d="M0 0"/></svg>'))).toBeNull();
    expect(freeCodeOf({ element: "svg", innerHTML: "<path/>" })).toBeNull();
    expect(freeCodeOf({ element: "div", innerHTML: '<svg onload="x"></svg>' })).toBeNull();
    expect(freeCodeOf(raw('\n  <svg viewBox="0 0 4 4"><path d="M0 0"/></svg>\n'))).toBeNull(); // the quote icon of a template starts with a new line
    // a drawing is not code even when something in it would be active: it is drawn in the page, where the filter takes that out (with or without a space before it)
    expect(freeCodeOf(raw('\n  <svg onload="x()"><script>y()</script><path/></svg>'))).toBeNull();
    expect(freeCodeOf({ element: "div", innerHTML: ' <svg onload="x()"></svg>' })).toBeNull();
    expect(freeCodeOf(raw("<svgfoo><script>x()</script></svgfoo>"))).toBe("<svgfoo><script>x()</script></svgfoo>"); // not an <svg>
    expect(freeCodeOf(raw('<div><svg viewBox="0 0 4 4"></svg><script>x()</script></div>'))).toBe('<div><svg viewBox="0 0 4 4"></svg><script>x()</script></div>');
    expect(freeCodeOf({ ...raw("<b>x</b><script>y()</script>"), isRepeaterBlock: true, dataKey: { key: "itens" } })).toBeNull();
  });

  it("is an iframe block (a video, a map): the frame the person asked for, with an https address and the few attributes that are safe to carry", () => {
    const frame = freeCodeOf({ element: "iframe", attributes: { src: "https://www.youtube.com/embed/abc?rel=0", allow: "accelerometer; autoplay; fullscreen", allowfullscreen: "", title: 'Vídeo "um"', onload: "x", srcdoc: "<script>x</script>" } });
    expect(frame).toBe(
      '<iframe src="https://www.youtube.com/embed/abc?rel=0" style="border:0;width:100%;height:100%" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; fullscreen" allowfullscreen title="Vídeo &quot;um&quot;"></iframe>',
    );
    for (const address of ["http://example.com/x", "javascript:alert(1)", "data:text/html,<b>x</b>", "//example.com/x", "https://a b", 'https://a"onload="x', "https://x\\y", "", "https://"]) {
      expect(freeCodeOf({ element: "iframe", attributes: { src: address } }), address).toBe("");
    }
    expect(freeCodeOf({ element: "iframe", attributes: { src: "https://example.com/x", allow: "camera *; microphone https://evil.test" } })).not.toContain("allow=");
    expect(freeCodeOf({ element: "iframe", customAttributes: { src: "https://example.com/x" } })).toContain('src="https://example.com/x"');
  });
});

describe("what code asks of the outside", () => {
  it("tells scripts, styles, images and frames of other sites (the names of the namespaces of a drawing are not that)", () => {
    for (const code of ['<script src="https://cdn.test/x.js"></script>', '<link rel=stylesheet href="//fonts.test/x.css">', "<img src='http://a.test/i.png'>", '<style>@import url("https://a.test/x.css")</style>', "see https://a.b/c"]) {
      expect(reachesOutside(code), code).toBe(true);
    }
    for (const code of ['<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>', '<a href="/sobre">x</a>', "fetch('/api/x')", "só texto", "<p>1/2 e 3//4</p>", 'a.href = "#top"']) {
      expect(reachesOutside(code), code).toBe(false);
    }
  });
});

describe("the document of a frame, and what it may do", () => {
  it("is the code as it was written, in a page of its own", () => {
    const html = codeDocument('<p id="a">x</p><script>go()</script>');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<body>\n<p id="a">x</p><script>go()</script>\n</body>');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("is walled in: a sandbox without the origin of the site, nothing fetched from anywhere, no form, no base address, only the site frames it", () => {
    const policy = codePolicy(false);
    const part = (name: string) => policy.split("; ").find((entry) => entry.startsWith(`${name} `) || entry === name);
    expect(part("sandbox")).toBe("sandbox allow-scripts");
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).not.toMatch(/allow-(top-navigation|popups|forms|modals|downloads)/);
    expect(part("default-src")).toBe("default-src 'none'");
    expect(part("connect-src")).toBeUndefined(); // so it falls to default-src: no request of any kind
    expect(part("frame-src")).toBeUndefined();
    expect(part("script-src")).toBe("script-src 'unsafe-inline' 'unsafe-eval'");
    expect(part("img-src")).toBe("img-src data: blob: 'self'");
    expect(part("form-action")).toBe("form-action 'none'");
    expect(part("base-uri")).toBe("base-uri 'none'");
    expect(part("frame-ancestors")).toBe("frame-ancestors 'self'");
    expect(policy).not.toMatch(/https?:|\*/);
  });

  it("with the network opened, it may load from https: and nothing else changes (never http:, never any address, never the origin of the site)", () => {
    const policy = codePolicy(true);
    const part = (name: string) => policy.split("; ").find((entry) => entry.startsWith(`${name} `));
    for (const name of ["script-src", "style-src", "img-src", "media-src", "font-src", "connect-src", "frame-src"]) expect(part(name), name).toMatch(/ https:$/);
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).not.toMatch(/http:|\*|\/\//);
    expect(part("default-src")).toBe("default-src 'none'");
    expect(part("form-action")).toBe("form-action 'none'");
    expect(codePolicy(false).split("; ").length).toBeLessThan(policy.split("; ").length);
  });
});

describe("free code on the page is a frame", () => {
  it("draws the block as a frame with the box of the block, that shows a document of its own, and the code is nowhere in the page", () => {
    const out = draw([raw("<script>steal()</script><b>x</b>", { baseStyles: { width: "400px", height: "300px" } })]);
    expect(out.body).toBe('<body><iframe src="../site/studio/m/codigo/page-1/0" title="Código" sandbox="allow-scripts" loading="lazy" referrerpolicy="no-referrer" class="fb-1"></iframe></body>');
    expect(out.rules).toEqual([".fb-1 { width: 400px;height: 300px; }"]);
    expect(out.codeBlocks).toEqual([{ index: 0, html: "<script>steal()</script><b>x</b>", external: false }]);
    expect(out.body).not.toMatch(/steal|<script|srcdoc/);
  });

  it("never lets the block name its own frame: its attributes, address, handlers and children do not reach it", () => {
    const out = draw([raw("<b>x</b><script>x()</script>", { attributes: { src: "https://evil.test", srcdoc: "<script>x()</script>", onload: "x()", sandbox: "allow-same-origin allow-scripts", allow: "camera" }, customAttributes: { onclick: "x()" }, children: [{ element: "p", innerHTML: "filho" }] })]).body;
    expect(out).toBe('<body><iframe src="../site/studio/m/codigo/page-1/0" title="Código" sandbox="allow-scripts" loading="lazy" referrerpolicy="no-referrer"></iframe></body>');
  });

  it("numbers the code in the order of the page, in components too, and says which asks for something outside", () => {
    const component: Block = { blockId: "c", element: "div", children: [raw('<script src="https://cdn.test/a.js"></script>', { blockId: "inner" })] };
    const out = draw([{ element: "div", children: [raw("<i>um</i><script>um()</script>"), { blockId: "i", extendedFromComponent: "box", element: "div", children: [{ blockId: "inner" }] }, raw("<i>três</i><script>tres()</script>")] }], { box: component });
    expect(out.codeBlocks.map((entry) => [entry.index, entry.external])).toEqual([[0, false], [1, true], [2, false]]);
    expect(out.body.match(/m\/codigo\/page-1\/(\d)/g)).toEqual(["m/codigo/page-1/0", "m/codigo/page-1/1", "m/codigo/page-1/2"]);
  });

  it("draws an iframe block as the frame that holds its frame, and a drawing in the page itself", () => {
    const out = draw([{ element: "iframe", attributes: { src: "https://www.youtube.com/embed/abc" }, baseStyles: { width: "560px", height: "315px" } }, { element: "div", originalElement: "__raw_html__", innerHTML: '<svg viewBox="0 0 4 4"><path d="M0 0"/></svg>' }]);
    expect(out.body).toMatch(/^<body><iframe src="\.\.\/site\/studio\/m\/codigo\/page-1\/0" [^>]*class="fb-1"><\/iframe><div><svg viewbox="0 0 4 4"><path d="M0 0"\/><\/svg><\/div><\/body>$/);
    expect(out.codeBlocks).toHaveLength(1);
    expect(out.codeBlocks[0]!.html).toContain('src="https://www.youtube.com/embed/abc"');
    expect(out.codeBlocks[0]!.external).toBe(true);
  });

  it("without a place to serve frames from the box stays and shows nothing; past the limits the rest is not drawn", () => {
    expect(draw([raw("<b>x</b><script>x()</script>")], {}, null)).toMatchObject({ body: "<body><div></div></body>", codeBlocks: [] });
    const many = draw(Array.from({ length: CODE_BLOCKS_MAX + 3 }, (_value, index) => raw(`<p>${index}</p><script></script>`)));
    expect(many.codeBlocks).toHaveLength(CODE_BLOCKS_MAX);
    expect(many.body.match(/<iframe /g)).toHaveLength(CODE_BLOCKS_MAX);
    expect(many.body.match(/<div><\/div>/g)).toHaveLength(3);
    const big = draw([raw(`<script>${"x".repeat(CODE_LETTERS_MAX)}</script>`), raw(`<script>${"x".repeat(CODE_LETTERS_MAX - 20)}</script>`)]);
    expect(big.codeBlocks.map((entry) => entry.index)).toEqual([0]);
    expect(big.body).toMatch(/^<body><div><\/div><iframe /);
  });

  it("does not frame a block with a condition on data, and counts the frames of a page only once", () => {
    const out = draw([raw("<b>x</b><script>x()</script>", { visibilityCondition: "mostrar" }), raw("<b>y</b><script>y()</script>")]);
    expect(out.codeBlocks).toEqual([{ index: 0, html: "<b>y</b><script>y()</script>", external: false }]);
  });

  it("draws markup that is not active in the page itself, filtered, and not as a frame: a line of text with a mark does not become a box", () => {
    const out = draw([raw('<p>—Aldous <b onclick="x()">Huxley</b>,</p><img src=x onerror=y><script>z()</script>'.replace("<script>z()</script>", ""), {})]);
    expect(out.codeBlocks).toEqual([{ index: 0, html: '<p>—Aldous <b onclick="x()">Huxley</b>,</p><img src=x onerror=y>', external: false }]);
    const plain = draw([raw("<p>—Aldous <b>Huxley</b>,</p>")]);
    expect(plain.codeBlocks).toEqual([]);
    expect(plain.body).not.toContain("<iframe");
    expect(plain.body).toContain("Aldous");
  });
});
