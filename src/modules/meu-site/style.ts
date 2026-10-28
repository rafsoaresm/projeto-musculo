import { z } from "zod";

/**
 * The style of a block, as typed values. This is what the visual editor's style panel writes and what the page's
 * stylesheet is made from: there is no free CSS, no free class name and no `style` attribute anywhere. A property
 * takes a value from a closed list, a number inside a range, a length in one of a few units (a string such as
 * "16px" or "50%", checked by `length` below), or a color (a name of the theme or `#rrggbb`/`#rrggbbaa`). The
 * server checks all of it again when a draft is saved, and `cssDeclarations` writes only what passed.
 *
 * Every property is optional: a block with no style takes the page's own rules, and clearing a property in the
 * panel removes the key, so the document stays as small as what was really changed.
 */

// ---- colors: the theme's own names (they follow light and dark) and `#rrggbb` ----

export const COLOR_TOKENS = ["ink", "text", "muted", "line", "bg", "accent", "solid", "on", "soft", "softLine", "white", "black", "transparent"] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export const COLOR_TOKEN_LABEL: Record<ColorToken, string> = {
  ink: "Título",
  text: "Texto",
  muted: "Texto suave",
  line: "Linha",
  bg: "Fundo da página",
  accent: "Destaque (texto)",
  solid: "Destaque (cheio)",
  on: "Sobre o destaque",
  soft: "Destaque suave",
  softLine: "Linha do destaque",
  white: "Branco",
  black: "Preto",
  transparent: "Transparente",
};
const COLOR_TOKEN_CSS: Record<ColorToken, string> = {
  ink: "var(--site-ink)",
  text: "var(--site-text)",
  muted: "var(--site-muted)",
  line: "var(--site-line)",
  bg: "var(--site-bg)",
  accent: "var(--site-accent)",
  solid: "var(--site-solid)",
  on: "var(--site-on)",
  soft: "var(--site-soft)",
  softLine: "var(--site-soft-line)",
  white: "#ffffff",
  black: "#000000",
  transparent: "transparent",
};
const HEX = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const color = z.union([z.enum(COLOR_TOKENS), z.string().regex(HEX)]);
export type Color = z.infer<typeof color>;
export const isHexColor = (value: string) => HEX.test(value);
const colorCss = (value: Color): string => ((COLOR_TOKENS as readonly string[]).includes(value) ? COLOR_TOKEN_CSS[value as ColorToken] : value.toLowerCase());

// ---- lengths: "16px", "50%", "2.5rem", "100vh" ----

export const UNITS = ["px", "%", "rem", "vw", "vh"] as const;
export type Unit = (typeof UNITS)[number];
type Range = readonly [number, number];
/** What a property accepts: for each unit the range of the number; `auto` when "auto" is also a value. */
export interface LengthSpec {
  px?: Range;
  "%"?: Range;
  rem?: Range;
  vw?: Range;
  vh?: Range;
  auto?: boolean;
}
const LENGTH = /^(-?\d{1,4}(?:\.\d{1,2})?)(px|%|rem|vw|vh)$/;

export function parseLength(value: string): { amount: number; unit: Unit } | null {
  const match = LENGTH.exec(value);
  return match ? { amount: Number(match[1]), unit: match[2] as Unit } : null;
}
export function lengthFits(value: string, spec: LengthSpec): boolean {
  if (value === "auto") return spec.auto === true;
  const parsed = parseLength(value);
  const range = parsed ? spec[parsed.unit] : undefined;
  return Boolean(parsed && range && Number.isFinite(parsed.amount) && parsed.amount >= range[0] && parsed.amount <= range[1]);
}
const length = (spec: LengthSpec) => z.string().max(10).refine((value) => lengthFits(value, spec), { message: "length out of range" });

export const SPECS = {
  space: { px: [0, 400], rem: [0, 25], "%": [0, 50] },
  margin: { px: [-200, 400], rem: [-12.5, 25], "%": [-50, 100], auto: true },
  gap: { px: [0, 200], rem: [0, 12.5] },
  width: { px: [0, 4000], "%": [0, 100], rem: [0, 250], vw: [0, 100], auto: true },
  widthLimit: { px: [0, 4000], "%": [0, 100], rem: [0, 250], vw: [0, 100] },
  height: { px: [0, 4000], "%": [0, 100], rem: [0, 250], vh: [0, 100], auto: true },
  heightLimit: { px: [0, 4000], "%": [0, 100], rem: [0, 250], vh: [0, 100] },
  fontSize: { px: [8, 160], rem: [0.5, 10] },
  radius: { px: [0, 999], "%": [0, 50], rem: [0, 62] },
  border: { px: [0, 16] },
  letter: { px: [-5, 20] },
} satisfies Record<string, LengthSpec>;

// ---- the closed lists ----

export const DISPLAYS = ["block", "flex", "grid"] as const;
export const DIRECTIONS = ["row", "column"] as const;
export const WRAPS = ["nowrap", "wrap"] as const;
export const ALIGNS = ["start", "center", "end", "stretch", "baseline"] as const;
export const SELF_ALIGNS = ["auto", "start", "center", "end", "stretch"] as const;
export const JUSTIFIES = ["start", "center", "end", "between", "around", "evenly"] as const;
export const FONT_FAMILIES = ["sans", "serif", "mono"] as const;
export const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
export const TEXT_TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"] as const;
export const TEXT_DECORATIONS = ["none", "underline", "line-through"] as const;
export const BORDER_STYLES = ["solid", "dashed", "dotted"] as const;
export const SHADOWS = ["none", "sm", "md", "lg", "xl"] as const;
export const OVERFLOWS = ["visible", "hidden", "auto"] as const;
export const BG_SIZES = ["cover", "contain", "auto"] as const;
export const BG_POSITIONS = ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"] as const;

const ALIGN_CSS: Record<(typeof ALIGNS)[number], string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };
const SELF_ALIGN_CSS: Record<(typeof SELF_ALIGNS)[number], string> = { auto: "auto", start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const JUSTIFY_CSS: Record<(typeof JUSTIFIES)[number], string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};
// System fonts only: the page loads nothing from anyone else.
const FONT_CSS: Record<(typeof FONT_FAMILIES)[number], string> = {
  sans: "system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif",
  serif: "Georgia,Cambria,Times New Roman,Times,serif",
  mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,Liberation Mono,monospace",
};
const SHADOW_CSS: Record<(typeof SHADOWS)[number], string> = {
  none: "none",
  sm: "0 1px 2px rgba(0,0,0,.12)",
  md: "0 4px 12px rgba(0,0,0,.14)",
  lg: "0 12px 28px rgba(0,0,0,.18)",
  xl: "0 24px 56px rgba(0,0,0,.24)",
};
const BG_POSITION_CSS: Record<(typeof BG_POSITIONS)[number], string> = {
  center: "center",
  top: "top",
  bottom: "bottom",
  left: "left",
  right: "right",
  "top-left": "left top",
  "top-right": "right top",
  "bottom-left": "left bottom",
  "bottom-right": "right bottom",
};

// ---- the schema ----

const sides = <S extends LengthSpec>(spec: S) =>
  z.object({ top: length(spec).optional(), right: length(spec).optional(), bottom: length(spec).optional(), left: length(spec).optional() }).strict();
const whole = (min: number, max: number) => z.number().int().min(min).max(max);

export const styleSchema = z
  .object({
    // layout of what is inside
    display: z.enum(DISPLAYS).optional(),
    direction: z.enum(DIRECTIONS).optional(),
    wrap: z.enum(WRAPS).optional(),
    gap: length(SPECS.gap).optional(),
    align: z.enum(ALIGNS).optional(),
    justify: z.enum(JUSTIFIES).optional(),
    columns: whole(1, 12).optional(),
    // how this block behaves inside a flex row or column
    grow: whole(0, 10).optional(),
    shrink: whole(0, 10).optional(),
    basis: length(SPECS.width).optional(),
    selfAlign: z.enum(SELF_ALIGNS).optional(),
    // spacing and size
    padding: sides(SPECS.space).optional(),
    margin: sides(SPECS.margin).optional(),
    width: length(SPECS.width).optional(),
    minWidth: length(SPECS.widthLimit).optional(),
    maxWidth: length(SPECS.widthLimit).optional(),
    height: length(SPECS.height).optional(),
    minHeight: length(SPECS.heightLimit).optional(),
    maxHeight: length(SPECS.heightLimit).optional(),
    // type
    fontFamily: z.enum(FONT_FAMILIES).optional(),
    fontSize: length(SPECS.fontSize).optional(),
    fontWeight: z
      .number()
      .int()
      .min(100)
      .max(900)
      .refine((value) => value % 100 === 0)
      .optional(),
    lineHeight: z
      .number()
      .min(0.8)
      .max(3)
      .refine((value) => Math.abs(value * 20 - Math.round(value * 20)) < 1e-9, { message: "steps of 0.05" })
      .optional(),
    letterSpacing: length(SPECS.letter).optional(),
    textAlign: z.enum(TEXT_ALIGNS).optional(),
    textTransform: z.enum(TEXT_TRANSFORMS).optional(),
    textDecoration: z.enum(TEXT_DECORATIONS).optional(),
    color: color.optional(),
    // background
    background: color.optional(),
    /** An image of the site's library. */
    bgImage: z.string().max(64).optional(),
    bgSize: z.enum(BG_SIZES).optional(),
    bgPosition: z.enum(BG_POSITIONS).optional(),
    bgRepeat: z.boolean().optional(),
    // border, shadow and the rest
    borderWidth: length(SPECS.border).optional(),
    borderStyle: z.enum(BORDER_STYLES).optional(),
    borderColor: color.optional(),
    radius: length(SPECS.radius).optional(),
    shadow: z.enum(SHADOWS).optional(),
    opacity: whole(0, 100).optional(),
    overflow: z.enum(OVERFLOWS).optional(),
    // seen or not: the block takes no room at the sizes where it is hidden (see screens.ts for how it carries down)
    hidden: z.boolean().optional(),
  })
  .strict();
export type Style = z.infer<typeof styleSchema>;
export type StyleKey = keyof Style;

export const isEmptyStyle = (style: Style | undefined): boolean => !style || Object.keys(style).length === 0;

/** The images of the library that a style uses. */
export const styleAssetIds = (style: Style | undefined): string[] => (style?.bgImage ? [style.bgImage] : []);

// ---- the declarations ----

export interface CssContext {
  /** Where an image of the library is served from, or null when it must not be drawn. */
  imageUrl: (assetId: string) => string | null;
  /**
   * The sheet is for the frames of the editor, where the width that matters is the frame's and not the window's: the
   * sizes of the screen are then container queries, and `vw` is the frame's width (`cqw`). The published page uses the window.
   */
  container?: boolean;
}

/**
 * An address that can go inside `url("...")` without being able to leave it, or to leave the site: a path of plain
 * characters that starts with one slash (two would be another site's address with the protocol left out).
 */
const SAFE_URL = /^\/(?!\/)[A-Za-z0-9/_.-]{1,300}$/;

/**
 * The CSS declarations of a style, in a fixed order, without braces. Only a style that passed the schema is written
 * (a style that did not gives nothing), and each value is either from a table above or checked by a pattern above.
 */
export function cssDeclarations(input: unknown, context: CssContext): string[] {
  const parsed = styleSchema.safeParse(input);
  if (!parsed.success) return [];
  const s = parsed.data;
  const out: string[] = [];
  // A length in `vw` is a share of the frame in the editor (`cqw`); the values are checked above, so the unit is the end of the text.
  const add = (property: string, value: string | number) =>
    void out.push(`${property}:${context.container && typeof value === "string" ? value.replace(/(\d)vw$/, "$1cqw") : value}`);

  if (s.display) add("display", s.display);
  if (s.direction) add("flex-direction", s.direction);
  if (s.wrap) add("flex-wrap", s.wrap);
  if (s.gap) add("gap", s.gap);
  if (s.align) add("align-items", ALIGN_CSS[s.align]);
  if (s.justify) add("justify-content", JUSTIFY_CSS[s.justify]);
  if (s.columns) add("grid-template-columns", `repeat(${s.columns},minmax(0,1fr))`);
  if (s.grow !== undefined) add("flex-grow", s.grow);
  if (s.shrink !== undefined) add("flex-shrink", s.shrink);
  if (s.basis) add("flex-basis", s.basis);
  if (s.selfAlign) add("align-self", SELF_ALIGN_CSS[s.selfAlign]);
  for (const [name, value] of [["padding", s.padding], ["margin", s.margin]] as const) {
    if (!value) continue;
    for (const side of ["top", "right", "bottom", "left"] as const) if (value[side]) add(`${name}-${side}`, value[side]!);
  }
  if (s.width) add("width", s.width);
  if (s.minWidth) add("min-width", s.minWidth);
  if (s.maxWidth) add("max-width", s.maxWidth);
  if (s.height) add("height", s.height);
  if (s.minHeight) add("min-height", s.minHeight);
  if (s.maxHeight) add("max-height", s.maxHeight);
  if (s.fontFamily) add("font-family", FONT_CSS[s.fontFamily]);
  if (s.fontSize) add("font-size", s.fontSize);
  if (s.fontWeight) add("font-weight", s.fontWeight);
  if (s.lineHeight !== undefined) add("line-height", s.lineHeight);
  if (s.letterSpacing) add("letter-spacing", s.letterSpacing);
  if (s.textAlign) add("text-align", s.textAlign);
  if (s.textTransform) add("text-transform", s.textTransform);
  if (s.textDecoration) add("text-decoration", s.textDecoration);
  if (s.color) {
    // The text, and the theme's names for text, so what is inside follows (a heading reads --site-ink, not `color`).
    const value = colorCss(s.color);
    add("color", value);
    add("--site-ink", value);
    add("--site-text", value);
  }
  if (s.background) add("background-color", colorCss(s.background));
  if (s.bgImage) {
    const url = context.imageUrl(s.bgImage);
    if (url && SAFE_URL.test(url)) {
      add("background-image", `url("${url}")`);
      add("background-size", s.bgSize ?? "cover");
      add("background-position", BG_POSITION_CSS[s.bgPosition ?? "center"]);
      add("background-repeat", s.bgRepeat ? "repeat" : "no-repeat");
    }
  }
  if (s.borderWidth) {
    add("border-width", s.borderWidth);
    add("border-style", s.borderStyle ?? "solid");
    add("border-color", s.borderColor ? colorCss(s.borderColor) : "var(--site-line)");
  } else if (s.borderStyle || s.borderColor) {
    // A style or a color without a width draws nothing: they wait for the width.
  }
  if (s.radius) add("border-radius", s.radius);
  if (s.shadow) add("box-shadow", SHADOW_CSS[s.shadow]);
  if (s.opacity !== undefined) add("opacity", s.opacity / 100);
  if (s.overflow) add("overflow", s.overflow);
  return out;
}
