import { describe, expect, it } from "vitest";
import { cleanAttributes, escapeAttribute, escapeText, inlineStyle, linkUrl, mediaUrl, sanitizeRichText, serializeAttributes, type UrlContext } from "@/modules/frappe-site/html";

const ID = "0b9f2f7a-3c1e-4d55-9a7e-6f5d4c3b2a10";
const ctx: UrlContext = {
  asset: (raw) => (raw === `/s/studio/m/${ID}` ? `../s/studio/m/${ID}` : null),
  page: (raw) => `../studio/${raw.replace(/^\/+/, "")}`,
};
const clean = (html: string) => sanitizeRichText(html, ctx);

describe("the text of a block", () => {
  it("keeps what the editor writes: marks, links, lists, line breaks and styled spans", () => {
    for (const html of ["<strong>a</strong> <em>b</em> <u>c</u> <s>d</s>", "<ul><li>um</li><li>dois</li></ul>", "a<br>b", "<h2>Título</h2><p>Texto</p>", '<span style="color: #ff0000; font-size: 20px;">cor</span>'])
      expect(clean(html), html).toBe(html);
  });

  it("drops scripts, styles, frames, objects and math with everything inside", () => {
    expect(clean("a<script>alert(1)</script>b")).toBe("ab");
    expect(clean("a<SCRIPT src=//evil.test/x.js></SCRIPT>b")).toBe("ab");
    expect(clean("a<style>*{display:none}</style>b")).toBe("ab");
    expect(clean('a<iframe src="https://evil.test"></iframe>b')).toBe("ab");
    expect(clean("a<object data=x><param name=a value=b></object>b")).toBe("ab");
    expect(clean('a<svg onload="alert(1)"><script>alert(1)</script></svg>b')).toBe("a<svg></svg>b");
    expect(clean("a<math><mi>x</mi></math>b")).toBe("ab");
    expect(clean("a<textarea><b>x</b></textarea>b")).toBe("ab");
    expect(clean("a<template><img src=x></template>b")).toBe("ab");
    expect(clean("a<plaintext><b>b</b>")).toBe("a");
  });

  it("drops handlers and every attribute that is not on the list, whatever the way it is written", () => {
    expect(clean(`<img src="/s/studio/m/${ID}" onerror="alert(1)" onload=alert(2) ONCLICK='x' alt="foto">`)).toBe(`<img src="../s/studio/m/${ID}" alt="foto">`);
    expect(clean('<p onmouseover="alert(1)" srcdoc="x" formaction="y" data-x="z" style="">t</p>')).toBe("<p>t</p>");
    expect(clean('<div/onclick=alert(1)>x</div>')).toBe("<div>x</div>");
    expect(clean('<a href="/sobre" onclick=alert(1)>ir</a>')).toBe('<a href="../studio/sobre">ir</a>');
  });

  it("does not let an address run code or leave the site's own files, written in any of the ways a browser reads", () => {
    const ways = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "\tjavascript:alert(1)",
      "java\nscript:alert(1)",
      "java&#x09;script:alert(1)",
      "&#106;avascript:alert(1)",
      "&#x6A;avascript&colon;alert(1)",
      "javascript&colon;alert(1)",
      "&#0000106avascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.test/x",
      "\\\\evil.test\\x",
    ];
    for (const way of ways) {
      const out = clean(`<a href="${way}">x</a>`);
      expect(out, way).toBe("<a>x</a>");
      expect(clean(`<img src="${way}">`), way).toBe("");
    }
  });

  it("keeps a link to the web, an e-mail, a phone, a place on the page and a page of the site", () => {
    expect(clean('<a href="https://exemplo.com.br/a?b=1&amp;c=2">x</a>')).toBe('<a href="https://exemplo.com.br/a?b=1&amp;c=2" rel="noopener noreferrer">x</a>');
    expect(clean('<a href="mailto:oi@exemplo.com">x</a>')).toBe('<a href="mailto:oi@exemplo.com">x</a>');
    expect(clean('<a href="tel:+5511999999999">x</a>')).toBe('<a href="tel:+5511999999999">x</a>');
    expect(clean('<a href="#contato">x</a>')).toBe('<a href="#contato">x</a>');
    expect(clean('<a href="/servicos/personal#valores">x</a>')).toBe('<a href="../studio/servicos/personal#valores">x</a>');
    expect(clean('<a href="sobre" target="_blank">x</a>')).toBe('<a href="../studio/sobre" target="_blank" rel="noopener noreferrer">x</a>');
    expect(clean('<a href="sobre" target="_top">x</a>')).toBe('<a href="../studio/sobre">x</a>');
  });

  it("takes an image only from the site's own files or as a small image carried in the text", () => {
    expect(clean(`<img src="/app/s/studio/m/${ID}">`)).toBe("");
    expect(clean('<img src="https://evil.test/p.png">')).toBe("");
    expect(clean('<img src="data:image/png;base64,AAAA" alt="">')).toBe('<img src="data:image/png;base64,AAAA" alt="">');
    expect(clean('<img src="data:image/svg+xml;base64,AAAA">')).toBe("");
    expect(clean('<img src="data:text/html;base64,AAAA">')).toBe("");
  });

  it("writes the style attribute declaration by declaration", () => {
    expect(clean('<span style="color:#f00;background:url(javascript:alert(1));position:fixed;width:expression(1)">x</span>')).toBe('<span style="color: #f00; position: fixed;">x</span>');
    expect(clean('<span style="background-image: url(https://evil.test/p.png)">x</span>')).toBe("<span>x</span>");
    expect(clean('<span style="color: red; } body { display: none">x</span>')).toBe('<span style="color: red;">x</span>');
  });

  it("keeps the words of a tag it does not know and drops the tag", () => {
    expect(clean("<custom-tag>texto</custom-tag>")).toBe("texto");
    expect(clean("<form action=//evil.test><input name=a><button>enviar</button></form>")).toBe("enviar");
    expect(clean("<blink>a</blink><marquee>b</marquee>")).toBe("ab");
  });

  it("writes the text it reads: stray marks are text, an entity stays, a lone & is escaped", () => {
    expect(clean("1 < 2 && 3 > 2")).toBe("1 &lt; 2 &amp;&amp; 3 &gt; 2");
    expect(clean("a &amp; b &nbsp; c &#169; &bogus d &")).toBe("a &amp; b &nbsp; c &#169; &amp;bogus d &amp;");
    expect(clean("a < b")).toBe("a &lt; b");
    expect(clean("a<b")).toBe("a"); // a tag that never ends is dropped with the rest, as a browser does
    expect(escapeText("<>&\u0000")).toBe("&lt;&gt;&amp;�");
    expect(escapeAttribute('"<>&')).toBe("&quot;&lt;&gt;&amp;");
  });

  it("drops comments, declarations and processing instructions, and a tag that never ends", () => {
    expect(clean("a<!-- <script>alert(1)</script> -->b")).toBe("ab");
    expect(clean("a<!DOCTYPE html>b<?php echo 1 ?>c<![if IE]>d")).toBe("abcd");
    expect(clean('texto <a href="x')).toBe("texto ");
    expect(clean("a<!-- sem fim")).toBe("a");
  });

  it("does not take a trick of markup for markup: the output is what it was built from", () => {
    expect(clean("<div<script>alert(1)</script>>")).toBe("<div>alert(1)&gt;</div>");
    expect(clean('<noscript><p title="</noscript><img src=x onerror=alert(1)>">')).not.toMatch(/onerror|<img/);
    expect(clean("<scr\u0000ipt>alert(1)</scr\u0000ipt>")).not.toMatch(/<script/i);
    expect(clean('<a href="x" href="javascript:alert(1)">x</a>')).toBe('<a href="../studio/x">x</a>');
    expect(clean("<img src=x onerror=alert(1)//>")).toBe("");
    expect(clean('<p title=">"><b>x')).toBe('<p title="&gt;"><b>x</b></p>');
  });

  it("always writes balanced tags, and stops opening them at a depth", () => {
    expect(clean("<b>aberto")).toBe("<b>aberto</b>");
    expect(clean("</i>solto")).toBe("solto");
    expect(clean("<b><i>x</b>y")).toBe("<b><i>x</i></b>y");
    const deep = clean(`${"<div>".repeat(150)}x`);
    expect(deep.match(/<div>/g)).toHaveLength(100);
    expect(deep.match(/<\/div>/g)).toHaveLength(100);
    expect(clean("x".repeat(600_000)).length).toBe(500_000);
  });
});

describe("inline SVG: a logo or an icon", () => {
  const logo =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" class="icon"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="rgb(0, 0, 255)"/></linearGradient><clipPath id="c1"><rect x="0" y="0" width="24" height="24"/></clipPath></defs><g clip-path="url(#c1)"><path d="M12 2 L22 22 H2 Z" fill="url(#g1)" fill-rule="evenodd"/><circle cx="12" cy="12" r="4"/><use href="#g1"/></g><text x="2" y="20" font-size="4" text-anchor="middle">Marina</text></svg>';
  it("is kept as it was drawn: shapes, gradients, clips and text, with the self-closing ones complete (never holding what follows)", () => {
    const out = clean(logo);
    expect(out).toBe(
      '<svg viewbox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" class="icon"><defs><lineargradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="rgb(0, 0, 255)"/></lineargradient><clippath id="c1"><rect x="0" y="0" width="24" height="24"/></clippath></defs><g clip-path="url(#c1)"><path d="M12 2 L22 22 H2 Z" fill="url(#g1)" fill-rule="evenodd"/><circle cx="12" cy="12" r="4"/><use href="#g1"/></g><text x="2" y="20" font-size="4" text-anchor="middle">Marina</text></svg>',
    );
    expect(clean(`<p>antes</p>${logo}<p>depois</p>`)).toBe(`<p>antes</p>${out}<p>depois</p>`);
  });

  it("does not run, animate, restyle, embed or fetch: whatever the way it is written", () => {
    const hostile = [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><style>*{display:none}</style></svg>',
      '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
      '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
      '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
      '<svg><foreignObject><iframe src="https://evil.test"></iframe></foreignObject></svg>',
      '<svg><use href="https://evil.test/x.svg#a"/></svg>',
      '<svg><use xlink:href="data:image/svg+xml;base64,PHN2Zz4="/></svg>',
      '<svg><image href="https://evil.test/p.png"/></svg>',
      '<svg><image href="data:image/svg+xml;base64,PHN2Zz4="/></svg>',
      '<svg><path d="M0 0 url(https://evil.test)" fill="url(https://evil.test/a)" onclick="alert(1)"/></svg>',
      '<svg><rect width="10" height="10" fill="javascript:alert(1)" style="background:url(javascript:alert(1))"/></svg>',
      '<svg><circle r="expression(alert(1))"/></svg>',
      '<svg><title>x</title><desc>y</desc></svg>',
    ];
    for (const html of hostile) {
      const out = clean(html);
      expect(out, html).not.toMatch(/script|onload|onclick|onmouseover|javascript:|evil\.test|<style|<animate|<set|foreignobject|<iframe|<title|<desc|expression|data:image\/svg/i);
    }
    // what is valid in the same drawing stays
    expect(clean('<svg><rect width="10" height="10" fill="javascript:alert(1)" onclick="x"/></svg>')).toBe('<svg><rect width="10" height="10"/></svg>');
    expect(clean('<svg><use xlink:href="data:image/svg+xml;base64,PHN2Zz4="/><circle r="2"/></svg>')).toBe('<svg><circle r="2"/></svg>');
    expect(clean('<svg><image href="data:image/png;base64,AAAA" width="4" height="4"/></svg>')).toBe('<svg><image href="data:image/png;base64,AAAA" width="4" height="4"/></svg>');
  });

  it("has shapes only inside a drawing: outside one, they are not elements of the page", () => {
    expect(clean('<path d="M0 0"/><circle r="2"/><use href="#a"/><image href="data:image/png;base64,AAAA"/><text>no</text>')).toBe("no");
    expect(clean('<svg><path d="M0 0"></svg><path d="M1 1"/>')).toBe('<svg><path d="M0 0"></path></svg>');
  });
});

describe("the attributes of an element", () => {
  const pairs = (value: Record<string, string>) => Object.entries(value);
  it("are the ones listed for it, each checked by its own rule", () => {
    expect(cleanAttributes("a", pairs({ href: "/x", target: "_blank", onclick: "x", style: "color:red", class: "a b  c!", id: "topo", title: "t", "aria-label": "rotulo", "data-x": "1", lang: "pt-BR" }), ctx)).toEqual({
      href: "../studio/x",
      target: "_blank",
      style: "color: red;",
      class: "a b",
      id: "topo",
      title: "t",
      "aria-label": "rotulo",
      lang: "pt-BR",
      rel: "noopener noreferrer",
    });
    expect(cleanAttributes("div", pairs({ id: "1bad", role: "Not Valid", tabindex: "5", dir: "up" }), ctx)).toEqual({});
    expect(cleanAttributes("form", pairs({ action: "https://evil.test", method: "POST", enctype: "multipart/form-data" }), ctx)).toEqual({ method: "post" });
    expect(cleanAttributes("input", pairs({ type: "file", name: "a" }), ctx)).toEqual({ name: "a" });
    expect(cleanAttributes("input", pairs({ type: "email", required: "", placeholder: "voce@exemplo.com" }), ctx)).toEqual({ type: "email", required: "", placeholder: "voce@exemplo.com" });
    expect(cleanAttributes("video", pairs({ src: `/s/studio/m/${ID}`, autoplay: "", muted: "", poster: "https://evil.test/p.png" }), ctx)).toEqual({ src: `../s/studio/m/${ID}`, autoplay: "", muted: "" });
  });
  it("do not take what a name shares with the language's own objects", () => {
    expect(cleanAttributes("div", pairs({ constructor: "x", __proto__: "x", toString: "x", hasOwnProperty: "x" }), ctx)).toEqual({});
    expect(cleanAttributes("constructor", pairs({ href: "x" }), ctx)).toEqual({});
  });
  it("are written quoted and escaped, a flag without a value", () => {
    expect(serializeAttributes({ alt: "", title: 'a"b<c', required: "", src: "../x?a=1&b=2" })).toBe(' alt="" title="a&quot;b&lt;c" required src="../x?a=1&amp;b=2"');
  });
});

describe("addresses", () => {
  it("of a link: only a place, a page of the site, the web, an e-mail or a phone", () => {
    expect(linkUrl("https://exemplo.com.br", ctx)).toBe("https://exemplo.com.br");
    expect(linkUrl("http://", ctx)).toBeNull();
    expect(linkUrl("ftp://exemplo.com.br", ctx)).toBeNull();
    expect(linkUrl("", ctx)).toBeNull();
    expect(linkUrl("a".repeat(2001), ctx)).toBeNull();
    expect(linkUrl('x"onclick=1', ctx)).toBeNull();
    expect(linkUrl("a b", ctx)).toBe("../studio/a b");
  });
  it("of an image: the site's own, or a small image carried in the page", () => {
    expect(mediaUrl(`/s/studio/m/${ID}`, ctx)).toBe(`../s/studio/m/${ID}`);
    expect(mediaUrl("/s/other/m/x", ctx)).toBeNull();
    expect(mediaUrl("https://exemplo.com/a.png", ctx)).toBeNull();
  });
  it("of a style: the declarations that can be written, in the order they came", () => {
    expect(inlineStyle("color: red; ; :bad; font-size: 12px", ctx)).toBe("color: red; font-size: 12px;");
    expect(inlineStyle("COLOR: red", ctx)).toBe("color: red;");
  });
});
