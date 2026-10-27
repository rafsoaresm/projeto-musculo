import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
  it("gives the page only the two names of the look, which select the rules", () => {
    expect(themeAttributes(DEFAULT_THEME)).toEqual({ "data-site-accent": "blue", "data-site-mode": "light" });
    expect(themeAttributes({ accent: "red", mode: "dark" })).toEqual({ "data-site-accent": "red", "data-site-mode": "dark" });
  });
});
