import { describe, expect, it } from "vitest";
import { contrast, parseHex } from "@/modules/meu-site/brand-color";
import { PALETTE_KEYS, paletteAdjusted, paletteRules, paletteVars, type Palette } from "@/modules/meu-site/site-palette";
import { siteContent } from "@/modules/meu-site/contracts";
import { themeAttributes } from "@/modules/meu-site/site-theme";
import { buildSiteCss } from "@/modules/meu-site/site-css";
import { starterContent } from "@/modules/meu-site/contracts";

// The four models of the handoff "Templates de Sites — CMS V1" (Figma, collection "Website Builder / Theme Tokens").
const MODELS: Record<string, Palette> = {
  trainix: { primary: "#fb521b", background: "#f8f6f2", surface: "#ffffff", ink: "#1c1c1c", muted: "#68645f", dark: "#232526" },
  fitnova: { primary: "#f9743a", background: "#f5f5f3", surface: "#ffffff", ink: "#1d2225", muted: "#6f7778", dark: "#121c1e" },
  sisphus: { primary: "#fc5e21", background: "#f8f8f6", surface: "#ffffff", ink: "#171717", muted: "#626262", dark: "#121212" },
  race: { primary: "#1153d5", background: "#f5f6f9", surface: "#ffffff", ink: "#0d1320", muted: "#667085", dark: "#091720" },
};
const c = (a: string, b: string) => contrast(parseHex(a), parseHex(b));
const reads = (palette: Palette) => {
  const v = paletteVars(palette);
  for (const ground of [v.bg, v.surface, v.soft]) {
    expect(c(v.ink, ground), "title").toBeGreaterThanOrEqual(4.5);
    expect(c(v.text, ground), "text").toBeGreaterThanOrEqual(4.5);
    expect(c(v.accent, ground), "primary as text").toBeGreaterThanOrEqual(4.5);
  }
  expect(c(v.on, v.solid), "label on the filled block").toBeGreaterThanOrEqual(4.5);
  expect(c(v.onDark, v.dark), "text on the dark block").toBeGreaterThanOrEqual(4.5);
  expect(c(v.onDarkMuted, v.dark), "secondary text on the dark block").toBeGreaterThanOrEqual(4.5);
  expect(c(v.accentOnDark, v.dark), "primary as text on the dark block").toBeGreaterThanOrEqual(4.5);
};

describe("the six colors of a site model", () => {
  for (const [name, palette] of Object.entries(MODELS)) {
    it(`${name}: reads well, and keeps the model's colors that already did`, () => {
      reads(palette);
      const v = paletteVars(palette);
      expect([v.bg, v.surface, v.ink, v.dark]).toEqual([palette.background, palette.surface, palette.ink, palette.dark]);
    });
  }
  it("moves a color typed by a person only as far as it needs to read, and says which", () => {
    const pale = { ...MODELS.trainix!, primary: "#ffee88", muted: "#dddddd" };
    reads(pale);
    expect(paletteAdjusted(pale)).toEqual(["primary", "muted"]);
    // The models keep their titles and cards as they are (their grey text may take a darker tone to read on the tinted blocks).
    for (const model of Object.values(MODELS)) expect(paletteAdjusted(model)).not.toEqual(expect.arrayContaining(["ink"]));
    // A middle grey for the dark blocks, and a dark card on a light page: moved until the text reads, and said.
    const grey = { ...MODELS.trainix!, dark: "#7a7a7a", surface: "#333333" };
    reads(grey);
    expect(paletteAdjusted(grey)).toEqual(expect.arrayContaining(["surface", "dark"]));
    // A dark page with light text reads too.
    reads({ primary: "#fc5e21", background: "#111111", surface: "#1b1b1b", ink: "#fafafa", muted: "#bbbbbb", dark: "#000000" });
    for (let hue = 0; hue < 360; hue += 30) {
      const hex = `#${[0, 120, 240].map((shift) => Math.round(127 + 127 * Math.cos(((hue + shift) * Math.PI) / 180)).toString(16).padStart(2, "0")).join("")}`;
      reads({ ...MODELS.fitnova!, primary: hex, muted: hex });
    }
  });
  it("is in the document only as six validated colors, and in the style sheet only as a rule of variables for the page that has it", () => {
    const content = { ...starterContent("Marina"), theme: { accent: "blue" as const, mode: "light" as const, width: "wide" as const, palette: MODELS.sisphus! } };
    expect(siteContent.safeParse(content).success).toBe(true);
    expect(siteContent.safeParse({ ...content, theme: { ...content.theme, palette: { ...MODELS.sisphus!, primary: "red;}" } } }).success).toBe(false);
    expect(siteContent.safeParse({ ...content, theme: { ...content.theme, palette: { ...MODELS.sisphus!, extra: "#ffffff" } } }).success).toBe(false);
    expect(themeAttributes(content.theme)["data-site-accent"]).toBe("palette");
    const css = buildSiteCss(content, { imageUrl: () => null });
    expect(css).toContain('.site[data-site-accent="palette"][data-site-mode]{--site-bg:#f8f8f6;');
    expect(paletteRules({ ...MODELS.race!, ink: "url(x)" })).toEqual([]);
    expect(PALETTE_KEYS).toHaveLength(6);
  });
});
