/**
 * The look of the public page: one accent out of a closed list, a light or dark base and how wide the page is. The
 * theme's own colors have no free value: a hex typed by a person could be unreadable, so the page's base is always one
 * of the pairs below. (A block may still be given a color of its own by the style panel; those colors are the person's
 * choice, and the page does not check their contrast.) The colors live in the stylesheet, in rules keyed by
 * `data-site-accent` and `data-site-mode` (so the page needs no inline style, which a strict Content-Security-Policy
 * would block), and tests/meu-site-theme.test.ts reads those rules and checks every pair for WCAG AA (4.5:1).
 * The document holds only the three names below; the page receives nothing else from it.
 */
export const ACCENTS = ["blue", "green", "orange", "purple", "red", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];
export const MODES = ["light", "dark"] as const;
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
export const MODE_LABEL: Record<Mode, string> = { light: "Claro", dark: "Escuro" };
export const WIDTH_LABEL: Record<Width, string> = { narrow: "Estreita (leitura)", wide: "Larga", full: "Largura total" };

export interface Theme {
  accent: Accent;
  mode: Mode;
  width: Width;
}
export const DEFAULT_THEME: Theme = { accent: "blue", mode: "light", width: "narrow" };

/** The attributes that select the colors and the width in the stylesheet. */
export const themeAttributes = (theme: Theme) => ({ "data-site-accent": theme.accent, "data-site-mode": theme.mode, "data-site-width": theme.width }) as const;
