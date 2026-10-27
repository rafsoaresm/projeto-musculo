/**
 * The look of the public page: one accent out of a closed list and a light or dark base. There is no free
 * color: a hex typed by a person could be unreadable. The colors live in the stylesheet, in rules keyed by
 * `data-site-accent` and `data-site-mode` (so the page needs no inline style, which a strict Content-Security-Policy
 * would block), and tests/meu-site-theme.test.ts reads those rules and checks every pair for WCAG AA (4.5:1).
 * The document holds only the two names below; the page receives nothing else from it.
 */
export const ACCENTS = ["blue", "green", "orange", "purple", "red", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];
export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

export const ACCENT_LABEL: Record<Accent, string> = {
  blue: "Azul",
  green: "Verde",
  orange: "Laranja",
  purple: "Roxo",
  red: "Vermelho",
  graphite: "Grafite",
};
export const MODE_LABEL: Record<Mode, string> = { light: "Claro", dark: "Escuro" };

export interface Theme {
  accent: Accent;
  mode: Mode;
}
export const DEFAULT_THEME: Theme = { accent: "blue", mode: "light" };

/** The attributes that select the colors of the stylesheet. */
export const themeAttributes = (theme: Theme) => ({ "data-site-accent": theme.accent, "data-site-mode": theme.mode }) as const;
