import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BASES, HEX_COLOR, LABELS, brandPalette, brandRules, contrast, luminance, parseHex, toHex } from "@/modules/meu-site/brand-color";
import { parseContent, siteContent, starterContent, type SiteContent } from "@/modules/meu-site/contracts";
import { SiteRenderer } from "@/modules/meu-site/renderer";
import { buildSiteCss } from "@/modules/meu-site/site-css";
import { DEFAULT_THEME } from "@/modules/meu-site/site-theme";

/** `hsl` as `#rrggbb` (h in degrees, s and l from 0 to 1). */
function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex([channel(0) * 255, channel(8) * 255, channel(4) * 255]);
}
/** A grid of colors that covers every hue, a few strengths and lightnesses, the grays and the extremes. */
const GRID: string[] = [];
for (let h = 0; h < 360; h += 15) for (const s of [0.15, 0.5, 1]) for (const l of [0.05, 0.25, 0.5, 0.75, 0.95]) GRID.push(hsl(h, s, l));
for (let value = 0; value <= 255; value += 15) GRID.push(toHex([value, value, value]));
GRID.push("#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#ffd700", "#f59e0b", "#0077b6", "#374151");

const rgb = (hex: string) => parseHex(hex);

describe("the arithmetic of colors", () => {
  it("reads and writes #rrggbb, and measures contrast as the WCAG does", () => {
    expect(parseHex("#0077b6")).toEqual([0, 119, 182]);
    expect(toHex([0, 119, 182])).toBe("#0077b6");
    expect(toHex([300, -5, 12.4])).toBe("#ff000c");
    expect(luminance(rgb("#ffffff"))).toBeCloseTo(1, 5);
    expect(luminance(rgb("#000000"))).toBe(0);
    expect(contrast(rgb("#ffffff"), rgb("#000000"))).toBeCloseTo(21, 5);
    expect(contrast(rgb("#767676"), rgb("#ffffff"))).toBeCloseTo(4.54, 1);
    expect(contrast(rgb("#ffffff"), rgb("#ffffff"))).toBe(1);
  });
  it("accepts only six lowercase hexadecimal digits", () => {
    for (const ok of ["#000000", "#abcdef", "#0077b6"]) expect(HEX_COLOR.test(ok), ok).toBe(true);
    for (const bad of ["#fff", "#ABCDEF", "0077b6", "#0077b6ff", "#00 77b6", "red", "", "#0077b6;}body{x:y", "url(#000000)"]) expect(HEX_COLOR.test(bad), bad).toBe(false);
  });
});

describe("the palette of a brand color", () => {
  for (const mode of ["light", "dark"] as const) {
    const base = BASES[mode];
    it(`passes every check the page's own palettes pass, on the ${mode} base, for ${GRID.length} colors (every hue, the grays and the extremes)`, () => {
      const failures: string[] = [];
      for (const color of GRID) {
        const p = brandPalette(color, mode);
        const checks: Array<[string, number, number]> = [
          ["label on the button", contrast(rgb(p.on), rgb(p.solid)), 4.5],
          ["button against the page", contrast(rgb(p.solid), rgb(base.bg)), 3],
          ["accent as text on the page", contrast(rgb(p.accent), rgb(base.bg)), 4.5],
          ["accent as text on a highlighted block", contrast(rgb(p.accent), rgb(p.soft)), 4.5],
          ["headings on a highlighted block", contrast(rgb(base.ink), rgb(p.soft)), 7],
          ["text on a highlighted block", contrast(rgb(base.text), rgb(p.soft)), 4.5],
          ["secondary text on a highlighted block", contrast(rgb(base.muted), rgb(p.soft)), 4.5],
        ];
        for (const [name, got, need] of checks) if (got < need) failures.push(`${color} ${mode}: ${name} ${got.toFixed(2)} < ${need}`);
        for (const key of ["solid", "on", "accent", "soft", "softLine"] as const) if (!HEX_COLOR.test(p[key])) failures.push(`${color} ${mode}: ${key} is ${p[key]}`);
      }
      expect(failures).toEqual([]);
    });
    it(`leaves a color that already passes as it is, on the ${mode} base, and moves the others only towards the way that stands out from the page`, () => {
      const away = mode === "light" ? 0 : 255;
      for (const color of GRID) {
        const p = brandPalette(color, mode);
        const white = contrast(rgb(color), rgb(LABELS.white));
        const dark = contrast(rgb(color), rgb(LABELS.dark));
        if (contrast(rgb(color), rgb(base.bg)) >= 3 && Math.max(white, dark) >= 4.5) expect(p.solid, `${color} ${mode}`).toBe(color);
        else {
          // Moved: every channel is closer to black (light page) or to white (dark page), never past it.
          const [from, to] = [rgb(color), rgb(p.solid)];
          for (let at = 0; at < 3; at++) expect(Math.abs(to[at] - away) <= Math.abs(from[at] - away), `${color} ${mode} channel ${at}`).toBe(true);
        }
      }
    });
  }
  it("is the same for the same color, and gives a label that is one of the two the page uses", () => {
    expect(brandPalette("#0077b6", "light")).toEqual(brandPalette("#0077b6", "light"));
    for (const color of GRID.slice(0, 80)) for (const mode of ["light", "dark"] as const) expect([LABELS.white, LABELS.dark]).toContain(brandPalette(color, mode).on);
  });
  it("keeps the page's own palette as the starting point: a color like the page's blue is not changed", () => {
    expect(brandPalette("#0077b6", "light").solid).toBe("#0077b6");
    expect(brandPalette("#0077b6", "light").on).toBe("#ffffff");
  });
  it("makes a pale yellow a button that can be read: a dark yellow with white, or the yellow itself with dark letters when the page is dark", () => {
    const light = brandPalette("#ffd700", "light");
    expect(contrast(rgb(light.solid), rgb(BASES.light.bg))).toBeGreaterThanOrEqual(3);
    const dark = brandPalette("#ffd700", "dark");
    expect(dark.solid).toBe("#ffd700");
    expect(dark.on).toBe(LABELS.dark);
  });
});

describe("the rules of the brand color", () => {
  it("are three, for the light base, the dark base and the automatic one, keyed by the 'custom' accent", () => {
    const [light, dark, media] = brandRules("#0077b6");
    expect(light.startsWith('[data-site-accent="custom"][data-site-mode="light"],[data-site-accent="custom"][data-site-mode="auto"]{')).toBe(true)
    expect(light).toContain("--site-solid:#0077b6");
    expect(dark).toMatch(/^\[data-site-accent="custom"\]\[data-site-mode="dark"\]\{--site-solid:#[0-9a-f]{6};/);
    expect(media).toMatch(/^@media \(prefers-color-scheme:dark\)\{\[data-site-accent="custom"\]\[data-site-mode="auto"\]\{--site-solid:#[0-9a-f]{6};/);
    // The automatic rule inside the media query is the dark rule's colors.
    expect(media).toContain(dark.slice(dark.indexOf("{") + 1, -1));
    expect(brandRules("#0077b6")).toHaveLength(3);
  });
  it("write nothing for what is not #rrggbb, so nothing but numbers made here reaches the sheet", () => {
    for (const bad of ["", "red", "#fff", "#0077B6", "#0077b6;}body{display:none", "}{", "#0077b6\\"]) expect(brandRules(bad), bad).toEqual([]);
  });
});

const page = (theme: SiteContent["theme"], over: Partial<SiteContent> = {}): SiteContent => ({ ...starterContent("Marina"), theme, ...over });

describe("the theme in the document", () => {
  it("accepts a font out of the list and a brand color as #rrggbb (normalized to lowercase), and the automatic mode", () => {
    const ok = (extra: object) => siteContent.safeParse(page({ ...DEFAULT_THEME, ...extra } as SiteContent["theme"])).success;
    for (const font of ["sans", "serif", "mono"]) expect(ok({ font }), font).toBe(true);
    expect(ok({ mode: "auto" })).toBe(true);
    expect(ok({ brand: "#aa3355" })).toBe(true);
    expect(siteContent.parse(page({ ...DEFAULT_THEME, brand: " #AA3355 " })).theme.brand).toBe("#aa3355");
  });
  it("refuses a font that is not in the list, and a color that is not #rrggbb", () => {
    const ok = (extra: object) => siteContent.safeParse(page({ ...DEFAULT_THEME, ...extra } as SiteContent["theme"])).success;
    for (const font of ["comic-sans", "Georgia", "", "serif;x"]) expect(ok({ font }), font).toBe(false);
    for (const brand of ["#fff", "red", "#gggggg", "#aa3355ff", "aa3355", "#aa3355;}body{x:y", "rgb(1,2,3)", ""]) expect(ok({ brand }), brand).toBe(false);
    expect(ok({ mode: "sepia" })).toBe(false);
    expect(ok({ extra: 1 })).toBe(false);
  });
  it("reads a document from before as it was, with no new key added, and the same after being written and read again", () => {
    const old = page({ accent: "blue", mode: "light", width: "narrow" });
    const parsed = parseContent(JSON.parse(JSON.stringify(old)));
    expect(parsed.theme).toEqual({ accent: "blue", mode: "light", width: "narrow" });
    expect("indexable" in parsed).toBe(false);
    expect(parseContent(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
  it("keeps whether search engines may list the page, as a yes or no (absent is yes)", () => {
    expect(siteContent.safeParse(page(DEFAULT_THEME, { indexable: false })).success).toBe(true);
    expect(siteContent.safeParse(page(DEFAULT_THEME, { indexable: true })).success).toBe(true);
    expect(siteContent.safeParse({ ...page(DEFAULT_THEME), indexable: "no" }).success).toBe(false);
    expect(siteContent.safeParse({ ...page(DEFAULT_THEME), indexable: 0 }).success).toBe(false);
  });
});

describe("the style sheet and the markup with a brand color or a font", () => {
  it("carry the brand's rules first, and only when there is a brand color", () => {
    const withBrand = buildSiteCss(page({ ...DEFAULT_THEME, brand: "#aa3355" }), { imageUrl: () => null });
    expect(withBrand.split("\n")).toHaveLength(3);
    expect(withBrand.startsWith('[data-site-accent="custom"][data-site-mode="light"]')).toBe(true);
    expect(withBrand).toContain("@media (prefers-color-scheme:dark)");
    expect(buildSiteCss(page(DEFAULT_THEME), { imageUrl: () => null })).toBe("");
    expect(buildSiteCss(page({ ...DEFAULT_THEME, accent: "red", mode: "auto", font: "serif" }), { imageUrl: () => null })).toBe("");
  });
  it("put the brand's rules before the blocks' own, so a block's color is never undone by them", () => {
    const content = page({ ...DEFAULT_THEME, brand: "#aa3355" }, { blocks: [{ id: "b1", type: "paragraph", text: "x", style: { color: "ink" } } as SiteContent["blocks"][number]] });
    const sheet = buildSiteCss(content, { imageUrl: () => null });
    expect(sheet.indexOf("data-site-accent")).toBeLessThan(sheet.indexOf(".s-b1"));
  });
  it("select the accent, the mode and the font by attributes on the page's root, and no inline style", () => {
    const html = (theme: SiteContent["theme"]) => renderToStaticMarkup(createElement(SiteRenderer, { content: page(theme) }));
    const custom = html({ ...DEFAULT_THEME, accent: "green", mode: "auto", font: "mono", brand: "#aa3355" });
    expect(custom).toContain('data-site-accent="custom"');
    expect(custom).toContain('data-site-mode="auto"');
    expect(custom).toContain('data-site-font="mono"');
    expect(custom).not.toContain("style=");
    expect(custom).not.toContain("#aa3355");
    const plain = html(DEFAULT_THEME);
    expect(plain).toContain('data-site-accent="blue"');
    expect(plain).not.toContain("data-site-font");
  });
});
