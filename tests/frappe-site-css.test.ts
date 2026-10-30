import { describe, expect, it } from "vitest";
import { blockRules, cssValue, declarations, fontFamilyValue, freeCss, kebab, safeCssUrl } from "@/modules/frappe-site/css";

const none = () => null;
/** The files of the site: only `/files/<name>` is one, written from the page as `../files/<name>`. */
const site = (raw: string) => (/^\/files\/[a-z0-9-]+$/.test(raw) ? `../files${raw.slice(6)}` : null);

describe("names of properties", () => {
  it("are written the CSS way", () => {
    expect(kebab("backgroundColor")).toBe("background-color");
    expect(kebab("WebkitBackgroundClip")).toBe("-webkit-background-clip");
    expect(kebab("--brand")).toBe("--brand");
    expect(kebab("color")).toBe("color");
  });
});

describe("values of declarations", () => {
  it("keep what a design uses: colors, gradients, shadows, transforms, math, fonts and numbers", () => {
    for (const value of ["#ededed", "rgba(0, 0, 0, 0.5)", "linear-gradient(90deg, #fff 0%, #000 100%)", "0 8px 24px rgba(0,0,0,.2)", "translate(-50%, 10px) rotate(3deg)", "calc(100% - 20px)", "Inter, sans-serif", "var(--brand)", "'Bebas Neue', Impact", "light-dark(#fff, #000)"])
      expect(cssValue(value, none), value).toBe(value);
    expect(cssValue(16, none)).toBe("16");
    expect(cssValue(0, none)).toBe("0");
  });

  it("refuse whatever can end the declaration, the rule or the style element, or fetch from another site", () => {
    const attacks = [
      "red; } body { display: none",
      "red; color: blue",
      "red;background:url(/files/x)",
      "a;b",
      "red}",
      "red{",
      "</style><script>alert(1)</script>",
      "red</style",
      "url(https://evil.test/x.png)",
      'url("https://evil.test/x.png")',
      "url(//evil.test/x.png)",
      "url(javascript:alert(1))",
      "url(data:text/html;base64,PHNjcmlwdD4=)",
      "url(data:image/svg+xml;utf8,<svg onload=alert(1)>)",
      "expression(alert(1))",
      "javascript:alert(1)",
      "@import 'https://evil.test/x.css'",
      "red /* hidden */",
      "calc((1 + 2)",
      "'unterminated",
      'say "unterminated',
      "red\\",
      "red\nblue",
      "-moz-binding: url(x)",
      "",
      "   ",
    ];
    for (const value of attacks) expect(cssValue(value, none), value).toBeNull();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}, [], true, "x".repeat(5000)]) expect(cssValue(value as unknown, none)).toBeNull();
  });

  it("let a small image in the page and a file of the site be an address, nothing else", () => {
    expect(cssValue("url(data:image/png;base64,AAAA)", none)).toBe('url("data:image/png;base64,AAAA")');
    expect(cssValue("url(#gradient)", none)).toBe('url("#gradient")');
    expect(cssValue("url(/files/abc-1)", none)).toBeNull();
    expect(cssValue("url(/files/abc-1)", site)).toBe('url("../files/abc-1")');
    expect(cssValue("linear-gradient(#000, #fff), url('/files/abc-1')", site)).toBe('linear-gradient(#000, #fff), url("../files/abc-1")');
    expect(cssValue("url(/files/../secret)", site)).toBeNull();
    expect(safeCssUrl("a(b)", site)).toBeNull();
    expect(safeCssUrl('a"b', site)).toBeNull();
  });
});

describe("the declarations of a block", () => {
  it("come out in the order of the map, with the invalid left out and the internal ones (__) skipped", () => {
    expect(declarations({ display: "flex", backgroundColor: "#fff", __internal: "x", "hover:color": "red", "bad name": "x", color: "red; }" }, none)).toBe("display: flex;background-color: #fff;");
    expect(declarations({ fontFamily: "'Open Sans'" }, none)).toBe('font-family: "Open Sans";');
    expect(declarations(null, none)).toBe("");
  });
});

describe("the rules of a block", () => {
  it("go desktop, then tablet, then phone, each with its states, in the media queries of the editor", () => {
    const rules = blockRules("fb-1", { base: { color: "red", "hover:color": "blue" }, tablet: { fontSize: "14px" }, mobile: { fontSize: "12px", "focus:outline": "none" } }, none);
    expect(rules).toEqual([
      ".fb-1 { color: red; }",
      ".fb-1:hover { color: blue; }",
      "@media only screen and (max-width: 1023px) { .fb-1 { font-size: 14px; } }",
      "@media only screen and (max-width: 576px) { .fb-1 { font-size: 12px; } }",
      "@media only screen and (max-width: 576px) { .fb-1:focus { outline: none; } }",
    ]);
  });
  it("leave out a state it does not know and a block with nothing to say", () => {
    expect(blockRules("fb-1", { base: { "x:color": "red" } }, none)).toEqual([]);
    expect(blockRules("fb-1", {}, none)).toEqual([]);
  });
});

describe("a style sheet the person wrote", () => {
  it("is free, but cannot import, fetch from another site or end its element", () => {
    const css = `@import url("https://evil.test/a.css");\n.a { color: red; background: url(https://evil.test/p.png) }\n.b { background: url(/files/x1); width: expression(alert(1)) }\n</style><script>alert(1)</script><style>`;
    const out = freeCss(css, site);
    expect(out).toContain(".a { color: red;");
    expect(out).toContain('url("../files/x1")');
    expect(out).not.toMatch(/@import|evil\.test|expression\s*\(|</i);
  });
  it("is nothing when empty, not text or too large", () => {
    expect(freeCss("  ", none)).toBe("");
    expect(freeCss(5, none)).toBe("");
    expect(freeCss("a".repeat(200_001), none)).toBe("");
  });
});

describe("font families", () => {
  it("are quoted by name, and a generic family or a variable is not", () => {
    expect(fontFamilyValue("Inter")).toBe('"Inter"');
    expect(fontFamilyValue("'Open Sans', sans-serif")).toBe('"Open Sans", sans-serif');
    expect(fontFamilyValue('"Bebas Neue",Impact , SERIF')).toBe('"Bebas Neue", "Impact", serif');
    expect(fontFamilyValue("var(--display), system-ui")).toBe("var(--display), system-ui");
    expect(fontFamilyValue("Playfair  Display")).toBe('"Playfair Display"');
    expect(fontFamilyValue("Ação Rápida")).toBe('"Ação Rápida"');
  });
  it("leave out a name that cannot be one, and are nothing when nothing is left", () => {
    expect(fontFamilyValue('x"; } body { display: none; a{')).toBeNull();
    expect(fontFamilyValue("Inter, url(https://evil.test/f.woff)")).toBe('"Inter"');
    expect(fontFamilyValue("")).toBeNull();
    expect(fontFamilyValue(" , ,")).toBeNull();
    expect(declarations({ fontFamily: "'Open Sans', sans-serif" }, none)).toBe('font-family: "Open Sans", sans-serif;');
  });
});
