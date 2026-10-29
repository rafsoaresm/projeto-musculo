import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASES } from "@/modules/meu-site/brand-color";
import { FONT_CSS, FONT_FAMILIES } from "@/modules/meu-site/style";
import { ACCENTS, DEFAULT_THEME, MODES, themeAttributes } from "@/modules/meu-site/site-theme";

/**
 * The colors of the public page live in the stylesheet, keyed by data-site-accent and data-site-mode. This
 * reads those rules and checks every pair the page draws against WCAG AA, so a color cannot be changed (or a
 * new accent added) into something unreadable without this failing.
 */
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`rule not found: ${selector}`);
  return Object.fromEntries([...match[1].matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
}
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the colors of the public page", () => {
  it("has a rule for every mode and for every accent in every mode", () => {
    for (const mode of MODES) expect(Object.keys(declarations(`[data-site-mode="${mode}"]`)).sort()).toEqual(["--site-bg", "--site-ink", "--site-line", "--site-muted", "--site-text"]);
    for (const accent of ACCENTS)
      for (const mode of MODES)
        expect(Object.keys(declarations(`[data-site-accent="${accent}"][data-site-mode="${mode}"]`)).sort(), `${accent} ${mode}`).toEqual(["--site-accent", "--site-on", "--site-soft", "--site-soft-line", "--site-solid"]);
  });
  for (const mode of MODES) {
    const base = declarations(`[data-site-mode="${mode}"]`);
    it(`reads well on the ${mode} base: the text, the headings and the secondary text`, () => {
      expect(contrast(base["--site-text"], base["--site-bg"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(base["--site-ink"], base["--site-bg"])).toBeGreaterThanOrEqual(7);
      expect(contrast(base["--site-muted"], base["--site-bg"])).toBeGreaterThanOrEqual(4.5);
    });
    for (const accent of ACCENTS) {
      it(`reads well with the ${accent} accent on the ${mode} base`, () => {
        const a = declarations(`[data-site-accent="${accent}"][data-site-mode="${mode}"]`);
        expect(contrast(a["--site-on"], a["--site-solid"]), "label of a button").toBeGreaterThanOrEqual(4.5);
        expect(contrast(a["--site-accent"], base["--site-bg"]), "accent as text on the page").toBeGreaterThanOrEqual(4.5);
        expect(contrast(a["--site-accent"], a["--site-soft"]), "accent as text on a highlighted block").toBeGreaterThanOrEqual(4.5);
        expect(contrast(base["--site-ink"], a["--site-soft"]), "headings on a highlighted block").toBeGreaterThanOrEqual(7);
        expect(contrast(base["--site-text"], a["--site-soft"]), "text on a highlighted block").toBeGreaterThanOrEqual(4.5);
        expect(contrast(base["--site-muted"], a["--site-soft"]), "secondary text on a highlighted block").toBeGreaterThanOrEqual(4.5);
        expect(contrast(a["--site-solid"], base["--site-bg"]), "the button against the page").toBeGreaterThanOrEqual(3);
      });
    }
  }
  it("gives the page only the names of the look (accent, mode, width and, when chosen, font), which select the rules", () => {
    expect(themeAttributes(DEFAULT_THEME)).toEqual({ "data-site-accent": "blue", "data-site-mode": "light", "data-site-width": "narrow" });
    expect(themeAttributes({ accent: "red", mode: "dark", width: "full" })).toEqual({ "data-site-accent": "red", "data-site-mode": "dark", "data-site-width": "full" });
    expect(themeAttributes({ accent: "red", mode: "auto", width: "wide", font: "serif" })).toEqual({ "data-site-accent": "red", "data-site-mode": "auto", "data-site-width": "wide", "data-site-font": "serif" });
  });
  it("names the brand color's accent 'custom' (its colors come with the page's own style sheet), whatever accent the theme still says", () => {
    expect(themeAttributes({ accent: "green", mode: "light", width: "narrow", brand: "#aa3355" })["data-site-accent"]).toBe("custom");
    expect(themeAttributes({ accent: "green", mode: "light", width: "narrow" })["data-site-accent"]).toBe("green");
  });
  it("has a rule for each width of the page, keyed by the same attribute", () => {
    for (const width of ["wide", "full"]) expect(css, width).toContain(`[data-site-width="${width}"]`);
  });
});

/** The rules inside the `@media (prefers-color-scheme: dark)` block of the stylesheet, by selector. */
function darkMedia(): Record<string, Record<string, string>> {
  const start = css.indexOf("@media (prefers-color-scheme: dark) {");
  if (start < 0) throw new Error("no dark media block");
  let depth = 0;
  let end = start;
  for (let at = css.indexOf("{", start); at < css.length; at++) {
    if (css[at] === "{") depth++;
    else if (css[at] === "}" && --depth === 0) {
      end = at;
      break;
    }
  }
  const block = css.slice(css.indexOf("{", start) + 1, end);
  return Object.fromEntries(
    [...block.matchAll(/\n\s*(\[[^{]+?)\s*\{([^}]*)\}/g)].map((rule) => [
      rule[1],
      Object.fromEntries([...rule[2].matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()])),
    ]),
  );
}

describe("the automatic mode", () => {
  it("is the light colors, and the dark colors where the visitor's device asks for dark: the same values as the two modes, for the base and for every accent", () => {
    expect(declarations('[data-site-mode="auto"]')).toEqual(declarations('[data-site-mode="light"]'));
    const media = darkMedia();
    expect(media['[data-site-mode="auto"]']).toEqual(declarations('[data-site-mode="dark"]'));
    for (const accent of ACCENTS) {
      expect(declarations(`[data-site-accent="${accent}"][data-site-mode="auto"]`), `${accent} light`).toEqual(declarations(`[data-site-accent="${accent}"][data-site-mode="light"]`));
      expect(media[`[data-site-accent="${accent}"][data-site-mode="auto"]`], `${accent} dark`).toEqual(declarations(`[data-site-accent="${accent}"][data-site-mode="dark"]`));
    }
    expect(Object.keys(media)).toHaveLength(1 + ACCENTS.length);
  });
  it("comes after the light rule of the same selector, so the dark one wins where it applies", () => {
    expect(css.indexOf('[data-site-mode="auto"] {')).toBeLessThan(css.indexOf("@media (prefers-color-scheme: dark) {"));
  });
});

describe("the bases the brand colors are made against", () => {
  it("are the stylesheet's own: the page's background, headings, text and secondary text, light and dark", () => {
    for (const mode of ["light", "dark"] as const) {
      const rule = declarations(`[data-site-mode="${mode}"]`);
      expect({ bg: rule["--site-bg"], ink: rule["--site-ink"], text: rule["--site-text"], muted: rule["--site-muted"] }).toEqual(BASES[mode]);
    }
  });
});

describe("the font of the page", () => {
  it("has a rule for each font, with the same stack as the style model's (written once for the page and once for a block)", () => {
    const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();
    for (const font of FONT_FAMILIES) {
      const match = new RegExp(`\\n\\[data-site-font="${font}"\\]\\s*\\{\\s*font-family:\\s*([^;]+);`).exec(css);
      expect(match, font).not.toBeNull();
      expect(normalize(match![1]), font).toBe(normalize(FONT_CSS[font]));
    }
  });
});

