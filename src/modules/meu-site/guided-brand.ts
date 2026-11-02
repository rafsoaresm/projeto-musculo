/**
 * The "Marca" of the Editor Guiado: the site's name, logo, colour, font and light or dark look. Pure: each function gives the document with one
 * thing changed (the same object when nothing changes), and the colour note says only what `brandPalette` computes: nothing is guessed.
 */
import { TITLE_MAX, type SiteContent } from "./contracts";
import { HEX_COLOR, brandPalette } from "./brand-color";
import { withFont, withoutBrand, type Accent, type Font, type Mode, type Width } from "./site-theme";

export function withSiteName(content: SiteContent, raw: string): SiteContent {
  const title = raw.slice(0, TITLE_MAX);
  return title === content.title ? content : { ...content, title };
}

/** The logo is an image of the site's library; `null` or "" takes it away. */
export function withLogo(content: SiteContent, assetId: string | null): SiteContent {
  const next = assetId || undefined;
  if (next === content.logoAssetId) return content;
  if (next) return { ...content, logoAssetId: next };
  const { logoAssetId: _dropped, ...rest } = content;
  void _dropped;
  return rest;
}

export function withAccent(content: SiteContent, accent: Accent): SiteContent {
  if (!content.theme.brand && content.theme.accent === accent) return content;
  return { ...content, theme: withoutBrand(content.theme, accent) };
}

/** A colour of the brand (`#rrggbb`); anything else changes nothing. */
export function withBrand(content: SiteContent, raw: string): SiteContent {
  const hex = raw.trim().toLowerCase();
  if (!HEX_COLOR.test(hex) || content.theme.brand === hex) return content;
  return { ...content, theme: { ...content.theme, brand: hex } };
}

export const withMode = (content: SiteContent, mode: Mode): SiteContent => (content.theme.mode === mode ? content : { ...content, theme: { ...content.theme, mode } });
export const withWidth = (content: SiteContent, width: Width): SiteContent => (content.theme.width === width ? content : { ...content, theme: { ...content.theme, width } });
export const withFontChoice = (content: SiteContent, font: Font | undefined): SiteContent =>
  content.theme.font === font ? content : { ...content, theme: withFont(content.theme, font) };

export interface BrandNote {
  /** The button colour actually used on the light and the dark page. */
  light: string;
  dark: string;
  /** The chosen colour had to be darkened or lightened for the text to read, on the look(s) the site uses. */
  adjusted: boolean;
}

/** What the page does with a brand colour: the button colours it ends with, and whether they differ from the one chosen. */
export function brandNote(hex: string, mode: Mode): BrandNote | null {
  if (!HEX_COLOR.test(hex)) return null;
  const light = brandPalette(hex, "light").solid;
  const dark = brandPalette(hex, "dark").solid;
  const used = mode === "light" ? [light] : mode === "dark" ? [dark] : [light, dark];
  return { light, dark, adjusted: used.some((solid) => solid !== hex) };
}
