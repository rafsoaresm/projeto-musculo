/**
 * The six colors of a site model (handoff "Templates de Sites — CMS V1", tokens `--site-primary`, `--site-background`, `--site-surface`,
 * `--site-ink`, `--site-muted`, `--site-dark`): the person keeps them or changes any of them in the Editor Guiado. A color typed by a person
 * may not read, so the page's variables are made from them and moved only as far as needed to pass the same checks as every other palette of
 * the page (WCAG AA): the title and the text on the page and on a card (4.5:1), the primary as text (4.5:1), the label on a filled block (4.5:1)
 * and the light text on the dark blocks (4.5:1). A color that passes is used as it is. Pure arithmetic: it writes the page's style sheet on the
 * server and tells the editor what was adjusted.
 */
import { HEX_COLOR, contrast, luminance, parseHex, toHex, type Rgb } from "./brand-color";

export const PALETTE_KEYS = ["primary", "background", "surface", "ink", "muted", "dark"] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;

export const PALETTE_LABEL: Record<PaletteKey, string> = {
  primary: "Cor principal",
  background: "Fundo da página",
  surface: "Fundo dos cartões",
  ink: "Títulos",
  muted: "Textos",
  dark: "Blocos escuros",
};
export const PALETTE_HINT: Record<PaletteKey, string> = {
  primary: "Destaques, ícones, números e faixas de chamada.",
  background: "As faixas claras da página.",
  surface: "Cartões e as faixas brancas.",
  ink: "Títulos e textos fortes.",
  muted: "Parágrafos e descrições.",
  dark: "Rodapé, plano em destaque e faixas escuras.",
};

const WHITE: Rgb = [255, 255, 255];
const DARK_LABEL: Rgb = [16, 22, 28];
const BLACK: Rgb = [0, 0, 0];
const STEP = 0.025;
const mix = (from: Rgb, to: Rgb, amount: number): Rgb => [0, 1, 2].map((at) => Math.round(from[at]! + (to[at]! - from[at]!) * amount)) as unknown as Rgb;
/** `color` moved towards `away` until it reads at `ratio` on every one of `grounds` (the color itself when it already does). */
function readable(color: Rgb, grounds: Rgb[], ratio: number, away: Rgb): Rgb {
  for (let step = 0; step * STEP <= 1; step++) {
    const candidate = mix(color, away, step * STEP);
    if (grounds.every((ground) => contrast(candidate, ground) >= ratio)) return candidate;
  }
  return away;
}
/** Black or white, whichever is further from the ground. */
const awayFrom = (ground: Rgb): Rgb => (contrast(BLACK, ground) >= contrast(WHITE, ground) ? BLACK : WHITE);

export interface PaletteVars {
  bg: string;
  surface: string;
  ink: string;
  text: string;
  muted: string;
  line: string;
  /** The primary as it is: bands and filled blocks; `on` is the label that reads on it. */
  solid: string;
  on: string;
  /** The primary as text, on the page and on a card. */
  accent: string;
  soft: string;
  softLine: string;
  dark: string;
  onDark: string;
  onDarkMuted: string;
  /** The primary as text on a dark block. */
  accentOnDark: string;
}

/** The page's variables from a palette (every value `#rrggbb`). */
export function paletteVars(palette: Palette): PaletteVars {
  const bg = parseHex(palette.background);
  const primary = parseHex(palette.primary);
  const away = awayFrom(bg);
  // The cards are read with the same text as the page: a card color on the other side of the page's (a dark card on a light page) is moved
  // towards the page until the page's darkest or lightest text reads on both.
  let surface = parseHex(palette.surface);
  for (let step = 0; step * STEP <= 1 && contrast(away, surface) < 7; step++) surface = mix(parseHex(palette.surface), bg, step * STEP);
  const soft = mix(bg, primary, 0.1);
  const grounds = [bg, surface, soft];
  const ink = readable(parseHex(palette.ink), grounds, 4.5, away);
  const muted = readable(parseHex(palette.muted), grounds, 4.5, away);
  const accent = readable(primary, grounds, 4.5, away);
  // The filled block keeps the primary when white reads on it. A dark or middle primary is darkened only as far as white does (the models put
  // white on their filled bands); a light one (a yellow) keeps its color and takes the dark label.
  let solid = primary;
  let on: Rgb = WHITE;
  if (contrast(primary, WHITE) < 4.5) {
    if (luminance(primary) > 0.4 && contrast(primary, DARK_LABEL) >= 4.5) on = DARK_LABEL;
    else
      for (let step = 1; step * STEP <= 1; step++) {
        solid = mix(primary, BLACK, step * STEP);
        if (contrast(solid, WHITE) >= 4.5) break;
      }
  }
  // The dark blocks: the label that reads better (white or the dark one); a middle grey where neither reaches 4.5 is moved until one does.
  let dark = parseHex(palette.dark);
  const label = (ground: Rgb): Rgb => (contrast(WHITE, ground) >= contrast(DARK_LABEL, ground) ? WHITE : DARK_LABEL);
  for (let step = 0; step * STEP <= 1 && contrast(label(dark), dark) < 4.5; step++) dark = mix(parseHex(palette.dark), label(parseHex(palette.dark)) === WHITE ? BLACK : WHITE, step * STEP);
  const onDark = label(dark);
  const onDarkMuted = readable(mix(onDark, dark, 0.25), [dark], 4.5, onDark);
  // The primary as text on a dark block (a "most popular" label on a dark card).
  const accentOnDark = readable(primary, [dark], 4.5, onDark);
  return {
    bg: toHex(bg),
    surface: toHex(surface),
    ink: toHex(ink),
    text: toHex(muted),
    muted: toHex(muted),
    line: toHex(mix(bg, ink, 0.14)),
    solid: toHex(solid),
    on: toHex(on),
    accent: toHex(accent),
    soft: toHex(soft),
    softLine: toHex(mix(bg, primary, 0.3)),
    dark: toHex(dark),
    onDark: toHex(onDark),
    onDarkMuted: toHex(onDarkMuted),
    accentOnDark: toHex(accentOnDark),
  };
}

/** The rule of the page's style sheet for a palette: the same on the light and the dark look (the palette is the whole look). */
export function paletteRules(palette: Palette): string[] {
  if (!PALETTE_KEYS.every((key) => HEX_COLOR.test(palette[key]))) return [];
  const v = paletteVars(palette);
  const vars = [
    `--site-bg:${v.bg}`,
    `--site-surface:${v.surface}`,
    `--site-ink:${v.ink}`,
    `--site-text:${v.text}`,
    `--site-muted:${v.muted}`,
    `--site-line:${v.line}`,
    `--site-solid:${v.solid}`,
    `--site-on:${v.on}`,
    `--site-accent:${v.accent}`,
    `--site-soft:${v.soft}`,
    `--site-soft-line:${v.softLine}`,
    `--site-dark:${v.dark}`,
    `--site-on-dark:${v.onDark}`,
    `--site-on-dark-muted:${v.onDarkMuted}`,
    `--site-accent-on-dark:${v.accentOnDark}`,
  ].join(";");
  return [`.site[data-site-accent="palette"][data-site-mode]{${vars}}`];
}

/** What was moved to read: the keys whose color on the page is not the one chosen (the primary counts as text and as a filled block). */
export function paletteAdjusted(palette: Palette): PaletteKey[] {
  if (!PALETTE_KEYS.every((key) => HEX_COLOR.test(palette[key]))) return [];
  const v = paletteVars(palette);
  const out: PaletteKey[] = [];
  if (v.accent !== palette.primary || v.solid !== palette.primary) out.push("primary");
  if (v.ink !== palette.ink) out.push("ink");
  if (v.muted !== palette.muted) out.push("muted");
  if (v.surface !== palette.surface) out.push("surface");
  if (v.dark !== palette.dark) out.push("dark");
  return out;
}
