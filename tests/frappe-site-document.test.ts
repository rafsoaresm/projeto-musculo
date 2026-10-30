import { describe, expect, it } from "vitest";
import type { PublicPage } from "@/db/builder-public";
import { PUBLIC_CSP, publicDocument, notFoundDocument } from "@/modules/frappe-site/public-page";
import { pickPage, requestedRoute, routeOf } from "@/modules/frappe-site/routes";
import { toMountRoot, urlContext } from "@/modules/frappe-site/urls";
import { inStyle, tokensCss } from "@/modules/frappe-site/document";

const ID = "0b9f2f7a-3c1e-4d55-9a7e-6f5d4c3b2a10";
const found = (over: Partial<PublicPage> = {}, page: Record<string, unknown> = {}): PublicPage => ({
  slug: "studio",
  route: "",
  page: { page_title: "Estúdio Marina", meta_description: 'Treino "de verdade"', ...page },
  blocks: [{ blockId: "r", originalElement: "body", element: "div", baseStyles: { background: "#101010" }, children: [{ element: "h1", innerHTML: "Olá", baseStyles: { color: "#fff" } }] }],
  components: new Map(),
  tokens: [],
  settings: {},
  styles: [],
  inquiriesOpen: false,
  codeExternalOpen: false,
  ...over,
});

describe("the document of a public page", () => {
  it("is a whole document with the head of a page: language, title, description, sharing and the base styles of the editor", () => {
    const html = publicDocument(found(), 0);
    expect(html.startsWith("<!DOCTYPE html>\n<html lang=\"pt-BR\">")).toBe(true);
    expect(html).toContain("<title>Estúdio Marina</title>");
    expect(html).toContain('<meta name="description" content="Treino &quot;de verdade&quot;">');
    expect(html).toContain('<meta property="og:title" content="Estúdio Marina">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    expect(html).toContain("html, body { background: #101010; }");
    expect(html).toContain('<body class="fb-1"><h1 class="fb-2 __text_block__">Olá</h1></body>');
    expect(html).toContain("box-sizing:border-box"); // the editor's reset
    expect(html).not.toContain("<script");
    expect(html).not.toContain('name="robots"');
  });

  it("asks nothing of another site: no font, script, frame or sheet by an address", () => {
    const html = publicDocument(found({ tokens: [{ name: "brand", value: "#0a5", darkValue: null }] }), 0);
    // (The reset carries a few small images as data: addresses, whose svg names its own namespace.)
    expect(html.replace(/data:[^"]+/g, "")).not.toMatch(/<link[^>]+(stylesheet|preload|preconnect)|<script|<iframe|@import|fonts\.(googleapis|gstatic)|https?:\/\//i);
  });

  it("is not listed by search engines when the page asks, or when it is only a test version", () => {
    expect(publicDocument(found({}, { disable_indexing: 1 }), 0)).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(publicDocument(found({}, { staging: 1 }), 0)).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("keeps the head from being written out of: title, description, language and styles", () => {
    const html = publicDocument(found({ styles: ["a{color:red}</style><script>alert(1)</script>"] }, { page_title: "</title><script>alert(1)</script>", meta_description: '"><script>alert(1)</script>', language: 'pt"><script>' }), 0);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>");
    expect(html).toContain('lang="pt-BR"');
    expect(html.match(/<\/style>/g)).toHaveLength(1);
  });

  it("writes the variables of the site, with light-dark() for a token that has a dark value", () => {
    expect(tokensCss([{ name: "brand", value: "#0a5", darkValue: "#3c8" }, { name: "plain", value: "4px", darkValue: null }, { name: "bad name", value: "x", darkValue: null }, { name: "evil", value: "red; } body{display:none", darkValue: null }], () => null)).toBe(
      ":root {\n--brand: light-dark(#0a5, #3c8);\n--plain: 4px;\n}",
    );
    expect(tokensCss([], () => null)).toBe("");
  });

  it("has a last wall for the style element: no `<` reaches it, whatever the css was", () => {
    expect(inStyle("a { content: '</style><script>alert(1)</script>' }")).toBe("a { content: '\\3c /style>\\3c script>alert(1)\\3c /script>' }");
    expect(inStyle("a { color: red }")).toBe("a { color: red }");
  });

  it("keeps the page light when the settings of the editor say so", () => {
    expect(publicDocument(found({ settings: { disable_auto_dark_mode: 1 } }), 0)).toContain('<html lang="pt-BR" data-prefers-color-scheme="light">');
    expect(publicDocument(found(), 0)).toContain('content="light dark"');
  });

  it("is the same document for the same page", () => {
    expect(publicDocument(found(), 0)).toBe(publicDocument(found(), 0));
  });

  it("has a policy that lets nothing run and nothing come from another site", () => {
    expect(PUBLIC_CSP).toContain("default-src 'none'");
    expect(PUBLIC_CSP).not.toMatch(/script-src|unsafe-eval|https?:|\*/);
    expect(PUBLIC_CSP).toContain("form-action 'self'");
    expect(PUBLIC_CSP).toContain("base-uri 'none'");
    expect(PUBLIC_CSP).toContain("frame-ancestors 'none'");
  });

  it("has an answer for what does not exist that says nothing of why", () => {
    const html = notFoundDocument();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain("<script");
  });
});

describe("which page answers an address", () => {
  const page = (name: string, route: string, publishedAt = "2026-10-01") => ({ name, route, publishedAt });
  it("is the page of that route, however it was written", () => {
    const pages = [page("a", "/sobre"), page("b", "servicos/personal/"), page("c", "home")];
    expect(pickPage(pages, "sobre", "")?.name).toBe("a");
    expect(pickPage(pages, "servicos/personal", "")?.name).toBe("b");
    expect(pickPage(pages, "nao-existe", "")).toBeNull();
    expect(pickPage(pages, "Sobre", "")).toBeNull();
  });
  it("is, for the home address, the page the settings name, then one with an empty route, home or index, then the first published", () => {
    expect(pickPage([page("a", "sobre"), page("b", "inicio")], "", "/inicio")?.name).toBe("b");
    expect(pickPage([page("a", "sobre"), page("b", "index"), page("c", "")], "", "")?.name).toBe("c");
    expect(pickPage([page("a", "sobre"), page("b", "home")], "", "")?.name).toBe("b");
    expect(pickPage([page("late", "x", "2026-10-02"), page("early", "y", "2026-10-01")], "", "")?.name).toBe("early");
    expect(pickPage([], "", "")).toBeNull();
  });
  it("names no page for a path that cannot be a route", () => {
    expect(requestedRoute(undefined)).toBe("");
    expect(requestedRoute(["servicos", "personal"])).toBe("servicos/personal");
    expect(requestedRoute(["caf%C3%A9"])).toBe("café");
    for (const bad of [[""], ["."], [".."], ["a%2Fb"], ["a%5Cb"], ["%00"], ["%E0%A4%A"], ["x".repeat(201)]]) expect(requestedRoute(bad), bad.join("/")).toBeNull();
    expect(routeOf(" /a/b/ ")).toBe("a/b");
  });
});

describe("addresses written from the page", () => {
  it("go up to the mount path by how deep the page is, so no mount path is written", () => {
    expect(toMountRoot(0)).toBe("../");
    expect(toMountRoot(2)).toBe("../../../");
    expect(urlContext("studio", 0).page("/")).toBe("studio");
    expect(urlContext("studio", 0).page("/sobre")).toBe("studio/sobre");
    expect(urlContext("studio", 1).page("sobre?x=1#y")).toBe("../studio/sobre?x=1#y");
    expect(urlContext("studio", 2).page("/a/b")).toBe("../../studio/a/b");
    expect(urlContext("studio", 0).page("/../../admin")).toBe("studio/admin");
    expect(urlContext("studio", 0).page("/a b/ç")).toBe("studio/a%20b/%C3%A7");
    expect(urlContext("studio", 1).asset(`/treinador/s/studio/m/${ID}`)).toBe(`../../s/studio/m/${ID}`);
    expect(urlContext("studio", 0).asset(`https://outro.test/s/studio/m/${ID.toUpperCase()}`)).toBe(`../s/studio/m/${ID}`);
  });
  it("name no file of another site, of the tool or outside the pattern", () => {
    const url = urlContext("studio", 0);
    for (const raw of [`/s/other/m/${ID}`, "/s/studio/m/not-an-id", "/api/auth/session", "/profissional/meu-site/imagens/x", `/s/studio/m/${ID}/x`, "", "../x"]) expect(url.asset(raw), raw).toBeNull();
  });
});

describe("fonts", () => {
  const withFonts = (family: string, depth = 0) =>
    publicDocument(found({ blocks: [{ originalElement: "body", element: "div", children: [{ element: "h1", innerHTML: "x", baseStyles: { fontFamily: `'${family}', Impact`, fontWeight: "700" } }] }] }), depth);
  it("a family that ships with the tool is written from the site's own files, relative to the page", () => {
    const html = withFonts("Oswald");
    expect(html).toContain('@font-face { font-family: "Oswald"; font-style: normal; font-weight: 200 700; font-display: swap; src: url("../frappe-editor/fonts/oswald/oswald-latin-wght-normal.woff2") format("woff2"); }');
    expect(withFonts("Oswald", 2)).toContain('url("../../../frappe-editor/fonts/oswald/oswald-latin-wght-normal.woff2")');
    expect(withFonts("bebas neue")).toContain('font-family: "Bebas Neue"');
  });
  it("any other family is not fetched from anywhere: the block's own list falls back", () => {
    const html = withFonts("Comic Neue");
    expect(html).not.toContain("@font-face");
    expect(html).toContain('font-family: "Comic Neue", "Impact"');
  });
});
