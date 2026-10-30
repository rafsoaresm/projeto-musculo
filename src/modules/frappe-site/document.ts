/**
 * The whole document of a public page made in the embedded editor: the head (title, description, language, icon, the colors of dark
 * mode), the base styles of the editor's pages, the variables ("tokens"), the fonts that ship with the tool, the styles of the blocks and
 * the body. It is a document of its own, answered by a route handler, so nothing of the tool's styles or scripts reaches it. The response
 * carries a strict Content-Security-Policy (PUBLIC_CSP): no script of any kind, images/fonts/media of the site itself only.
 */
import { cssValue } from "./css";
import { escapeAttribute, escapeText } from "./html";
import { RESET_CSS } from "./reset.generated";
import type { Rendered } from "./render";

/**
 * What a public page may load or do: nothing but its own styles, images, fonts and media. No script (so a tag that got through
 * the filters would still not run), no frame except the site's own (the isolated code block), forms go to the site only, no `<base>`.
 */
export const PUBLIC_CSP = [
  "default-src 'none'",
  "img-src 'self' data:",
  "media-src 'self'",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export interface Token {
  name: string;
  value: string;
  darkValue: string | null;
}

export interface PageMeta {
  title: string;
  description: string;
  /** The address of the sharing image, written from the page, or null. */
  image: string | null;
  /** The address of the icon, written from the page, or null. */
  favicon: string | null;
  language: string;
  noindex: boolean;
}

export interface DocumentInput {
  rendered: Rendered;
  meta: PageMeta;
  tokens: Token[];
  /** The page's free stylesheets (already filtered by freeCss). */
  freeStyles: string[];
  /** `@font-face` rules of the families the page uses that ship with the tool (fonts.ts). */
  fontFaces: string;
  /** The editor's setting: pages stay light whatever the visitor's device prefers. */
  keepLight: boolean;
  asset: (raw: string) => string | null;
}

/** The variables of the site as a `:root` rule; a token with a dark value uses `light-dark()`. */
export function tokensCss(tokens: Token[], asset: (raw: string) => string | null): string {
  const lines: string[] = [];
  for (const token of tokens) {
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(token.name)) continue;
    const value = cssValue(token.value, asset);
    if (value === null) continue;
    const dark = token.darkValue ? cssValue(token.darkValue, asset) : null;
    lines.push(dark !== null && dark !== value ? `--${token.name}: light-dark(${value}, ${dark});` : `--${token.name}: ${value};`);
  }
  return lines.length ? `:root {\n${lines.join("\n")}\n}` : "";
}

const BASE_CSS = `:root { color-scheme: light dark }
:root { background: transparent; color: CanvasText }
:root[data-prefers-color-scheme="light"] { color-scheme: light }
::selection { background: Highlight; color: HighlightText }
img { filter: var(--builder-image-dim, none) }
picture img { filter: none }
:root:has(a[href^="#"]:is(:hover, :focus-visible)), :root:has(a[href^="#"]:is(:hover, :focus-visible)) * { scroll-behavior: smooth }
@media (prefers-color-scheme: dark) { :root:not([data-prefers-color-scheme="light"]) { --builder-image-dim: brightness(0.85) contrast(1.05) } }`;

/** CSS for a <style> element: nothing in it can end the element. */
export const inStyle = (css: string) => css.replace(/</g, "\\3c ");

export function buildDocument(input: DocumentInput): string {
  const { rendered, meta } = input;
  const background = rendered.background;
  const head: string[] = [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta name="color-scheme" content="${input.keepLight ? "light" : "light dark"}">`,
  ];
  if (meta.noindex) head.push('<meta name="robots" content="noindex, nofollow">');
  head.push(`<title>${escapeText(meta.title)}</title>`);
  if (meta.description) head.push(`<meta name="description" content="${escapeAttribute(meta.description)}">`);
  head.push(`<meta property="og:title" content="${escapeAttribute(meta.title)}">`, '<meta property="og:type" content="website">');
  if (meta.description) head.push(`<meta property="og:description" content="${escapeAttribute(meta.description)}">`);
  if (meta.image) head.push(`<meta property="og:image" content="${escapeAttribute(meta.image)}">`);
  if (meta.favicon) head.push(`<link rel="icon" href="${escapeAttribute(meta.favicon)}">`);
  const styles = [
    RESET_CSS,
    BASE_CSS,
    input.fontFaces,
    tokensCss(input.tokens, input.asset),
    background ? `html, body { background: ${background}; }` : "",
    rendered.rules.join("\n"),
    ...input.freeStyles,
  ].filter(Boolean);
  head.push(`<style>\n${inStyle(styles.join("\n"))}\n</style>`);
  const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(meta.language) ? meta.language : "pt-BR";
  const light = input.keepLight ? ' data-prefers-color-scheme="light"' : "";
  return `<!DOCTYPE html>\n<html lang="${lang}"${light}>\n<head>\n${head.join("\n")}\n</head>\n${rendered.body}\n</html>\n`;
}
