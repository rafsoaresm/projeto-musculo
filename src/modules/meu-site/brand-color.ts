/**
 * The color of a person's brand, made into the colors the page needs. The person picks one color; a page cannot use any color as it is
 * (a pale yellow button with white letters cannot be read), so the palette is made from it and moved, only as far as needed, until it
 * passes the checks that the page's own palettes pass (tests/meu-site-theme.test.ts): the label of a button on the button (4.5:1), the
 * button against the page (3:1), the accent as text on the page and on a highlighted block (4.5:1), and the page's own text on a
 * highlighted block (ink 7:1, text and secondary text 4.5:1). A color that already passes is not changed. Pure arithmetic, nothing of
 * the browser: it runs on the server to write the stylesheet and in the editor to show the result.
 */
export type Rgb = readonly [number, number, number];
export const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** The page's bases (the same values as the stylesheet's `[data-site-mode]` rules; a test holds them together). */
export const BASES = {
  light: { bg: "#ffffff", ink: "#1f2933", text: "#4a5560", muted: "#5a6470" },
  dark: { bg: "#0f1720", ink: "#f1f5f9", text: "#cbd5df", muted: "#a3b0bd" },
} as const;
/** The two colors a button's label may have. */
export const LABELS = { white: "#ffffff", dark: "#10161c" } as const;

export const parseHex = (hex: string): Rgb => {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
export const toHex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`;

export function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}
export function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
/** `from` moved towards `to` by `amount` (0 to 1), in whole channel values (what is checked is what is written). */
const mix = (from: Rgb, to: Rgb, amount: number): Rgb => [0, 1, 2].map((at) => Math.round(from[at] + (to[at] - from[at]) * amount)) as unknown as Rgb;

const STEP = 0.025;
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

export interface BrandPalette {
  /** The button, and what is drawn solid with the brand. */
  solid: string;
  /** The label on the button. */
  on: string;
  /** The brand as text (links, small headings). */
  accent: string;
  /** The background of a highlighted block. */
  soft: string;
  /** Its border. */
  softLine: string;
}

/** The palette of a brand color on the light or the dark base. `hex` must be `#rrggbb`. */
export function brandPalette(hex: string, mode: "light" | "dark"): BrandPalette {
  const brand = parseHex(hex);
  const base = BASES[mode];
  const bg = parseHex(base.bg);
  const labels = [parseHex(LABELS.white), parseHex(LABELS.dark)];
  // The way that makes a color stand out from the page: darker on a light page, lighter on a dark one.
  const away = mode === "light" ? BLACK : WHITE;
  const betterLabel = (color: Rgb) => (contrast(color, labels[0]) >= contrast(color, labels[1]) ? labels[0] : labels[1]);

  let solid = away;
  let on = betterLabel(away);
  for (let step = 0; step * STEP <= 1; step++) {
    const candidate = mix(brand, away, step * STEP);
    const label = betterLabel(candidate);
    if (contrast(candidate, bg) >= 3 && contrast(candidate, label) >= 4.5) {
      solid = candidate;
      on = label;
      break;
    }
  }

  // The tint of a highlighted block: a small share of the brand in the page's background. It is small enough that the page's own text reads on it
  // for any brand (tests/meu-site-brand.test.ts checks it over every hue, so a change of the bases that breaks it is seen).
  const soft = mix(bg, brand, mode === "light" ? 0.1 : 0.16);
  const line = mix(bg, brand, mode === "light" ? 0.3 : 0.35);

  // The brand as text: moved away from the page until it reads on the page and on the tint.
  let accent = away;
  for (let step = 0; step * STEP <= 1; step++) {
    const candidate = mix(brand, away, step * STEP);
    if (contrast(candidate, bg) >= 4.5 && contrast(candidate, soft) >= 4.5) {
      accent = candidate;
      break;
    }
  }
  return { solid: toHex(solid), on: toHex(on), accent: toHex(accent), soft: toHex(soft), softLine: toHex(line) };
}

/** The CSS variables of a palette, as the page's rules write them. */
export const paletteVars = (palette: BrandPalette): string => `--site-solid:${palette.solid};--site-on:${palette.on};--site-accent:${palette.accent};--site-soft:${palette.soft};--site-soft-line:${palette.softLine}`;

/**
 * The rules of the "custom" accent, for a brand color: on the light base, on the dark base, and on the automatic one (light, and dark for a
 * device that asks for it). Written into the page's style sheet, since they depend on the color the person chose. Nothing but a validated
 * `#rrggbb` and the numbers derived from it ever reaches the sheet.
 */
export function brandRules(hex: string): string[] {
  if (!HEX_COLOR.test(hex)) return [];
  const light = paletteVars(brandPalette(hex, "light"));
  const dark = paletteVars(brandPalette(hex, "dark"));
  const custom = '[data-site-accent="custom"]';
  return [
    `${custom}[data-site-mode="light"],${custom}[data-site-mode="auto"]{${light}}`,
    `${custom}[data-site-mode="dark"]{${dark}}`,
    `@media (prefers-color-scheme:dark){${custom}[data-site-mode="auto"]{${dark}}}`,
  ];
}
