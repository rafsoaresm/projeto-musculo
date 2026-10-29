/**
 * The look of the public page: one accent out of a closed list (or the color of the person's brand, made readable: see
 * brand-color.ts), a light, dark or automatic base (the visitor's device decides), a font out of a closed list and how wide
 * the page is. The theme's own colors have no free value: a hex typed by a person could be unreadable, so the page's base is
 * always one of the pairs below, and a brand color is only the starting point of a palette that is moved until it passes the
 * same checks. (A block may still be given a color of its own by the style panel; those colors are the person's choice, and
 * the page does not check their contrast.) The colors live in the stylesheet, in rules keyed by `data-site-accent` and
 * `data-site-mode` (so the page needs no inline style, which a strict Content-Security-Policy would block), and
 * tests/meu-site-theme.test.ts reads those rules and checks every pair for WCAG AA (4.5:1).
 */
import { FONT_FAMILIES } from "./style";

export const ACCENTS = ["blue", "green", "orange", "purple", "red", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];
/** "auto" is light, and dark for a visitor whose device asks for it (`prefers-color-scheme`). */
export const MODES = ["light", "dark", "auto"] as const;
export type Mode = (typeof MODES)[number];
/** How wide the content of the page is: a reading column, a wide page, or the whole width of the window. */
export const WIDTHS = ["narrow", "wide", "full"] as const;
export type Width = (typeof WIDTHS)[number];

export const ACCENT_LABEL: Record<Accent, string> = {
  blue: "Azul",
  green: "Verde",
  orange: "Laranja",
  purple: "Roxo",
  red: "Vermelho",
  graphite: "Grafite",
};
export const MODE_LABEL: Record<Mode, string> = { light: "Claro", dark: "Escuro", auto: "Automático (segue o aparelho)" };
/** The font of the whole page: the system's own fonts, nothing is downloaded. Without a choice the page keeps the tool's font. */
export { FONT_FAMILIES as FONTS } from "./style";
export type Font = (typeof FONT_FAMILIES)[number];
export const FONT_LABEL: Record<Font | "default", string> = { default: "Padrão da página", sans: "Sem serifa", serif: "Com serifa", mono: "Monoespaçada" };
export const WIDTH_LABEL: Record<Width, string> = { narrow: "Estreita (leitura)", wide: "Larga", full: "Largura total" };

export interface Theme {
  accent: Accent;
  mode: Mode;
  width: Width;
  /** Absent: the font the page has always had. */
  font?: Font;
  /** The color of the person's brand as `#rrggbb`; when there is one it takes the place of `accent`. */
  brand?: string;
}
export const DEFAULT_THEME: Theme = { accent: "blue", mode: "light", width: "narrow" };

/**
 * The attributes that select the colors, the font and the width in the stylesheet. A brand color is the accent named "custom", whose
 * colors the page's own style sheet carries (buildSiteCss), since they depend on the color the person chose.
 */
export const themeAttributes = (theme: Theme) =>
  ({
    "data-site-accent": theme.brand ? "custom" : theme.accent,
    "data-site-mode": theme.mode,
    "data-site-width": theme.width,
    ...(theme.font ? { "data-site-font": theme.font } : null),
  }) as { "data-site-accent": string; "data-site-mode": Mode; "data-site-width": Width; "data-site-font"?: Font };
