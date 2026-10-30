/**
 * The styles of a page made in the embedded editor, written as CSS for the public page. The person may use any property and any value
 * (colors, gradients, shadows, transforms ...), but a value never leaves its declaration, its rule or its <style> element, and nothing
 * is fetched from a third party: a `url()` names an image of the site itself, or a small image carried in the page (`data:`).
 * tests/frappe-site-css.test.ts feeds this module the ways a value can try to get out.
 */

/** The widths where the editor's "tablet" and "celular" frames start (the same as the editor, so what is seen there is what is published). */
export const MOBILE_BREAKPOINT = 576;
export const DESKTOP_BREAKPOINT = 1024;

export type StyleMap = Record<string, unknown>;
export type Device = "desktop" | "tablet" | "mobile";

/** The states a style can be given for (`hover:color`), by the name the editor uses. */
const STATES = new Set(["hover", "focus", "active", "focus-visible", "focus-within", "visited", "disabled", "checked", "first-child", "last-child", "placeholder-shown"]);

/** backgroundColor -> background-color; WebkitBackgroundClip -> -webkit-background-clip. */
export function kebab(name: string): string {
  const text = name.replace(/(?<!^)(?=[A-Z])/g, "-").toLowerCase();
  return /^(webkit|moz|ms|o)-/.test(text) ? `-${text}` : text;
}

const PROPERTY = /^-{0,2}[a-z][a-z0-9-]*$/;
const TOO_LONG = 4000;
/** What can end a declaration, a rule or the <style> element, or fetch something: none of it belongs in a value. */
const FORBIDDEN = /[{};<\u0000-\u001f\u007f]|\/\*|\*\/|@import|expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i;
const IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i;

/** The address a `url()` may name: a small image carried in the page, a fragment (`url(#gradient)`) or a path of the site itself. */
export function safeCssUrl(target: string, asset: (raw: string) => string | null): string | null {
  const url = target.trim();
  if (!url || url.length > TOO_LONG * 4) return null;
  if (/[\u0000-\u001f\u007f"'<>\\()]/.test(url)) return null;
  if (IMAGE_DATA.test(url)) return url;
  if (url.startsWith("#")) return url;
  return asset(url);
}

/** A value ready for a declaration, or null when it cannot be written safely (the declaration is then left out). */
export function cssValue(raw: unknown, asset: (raw: string) => string | null): string | null {
  let text = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "") : typeof raw === "string" ? raw.trim() : "";
  if (!text || text.length > TOO_LONG) return null;
  let ok = true;
  // The addresses are checked (and may be rewritten) one by one; what is left must have none, and none of the forbidden marks.
  text = text.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gis, (_all, _quote, target: string) => {
    const safe = safeCssUrl(target, asset);
    if (safe === null) {
      ok = false;
      return "";
    }
    return `url("${safe}")`;
  });
  if (!ok || /url\s*\(/i.test(text.replace(/url\("[^"]*"\)/g, ""))) return null;
  // The marks are searched outside the addresses, where `;` is part of a data: address.
  if (FORBIDDEN.test(text.replace(/url\("[^"]*"\)/g, "url()"))) return null;
  if (/\\$/.test(text)) return null;
  // An unbalanced parenthesis or quote would swallow what comes after the value: such a value is not written (it was not valid CSS anyway).
  const bare = text.replace(/url\("[^"]*"\)/g, "url()");
  if (bare.split("(").length !== bare.split(")").length) return null;
  if ((bare.match(/'/g) ?? []).length % 2 !== 0 || (bare.match(/"/g) ?? []).length % 2 !== 0) return null;
  return text;
}

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "inherit", "initial", "unset", "revert"]);

/**
 * A list of font families, written as CSS wants it: a family with a name is quoted, a generic one (`serif`) and a variable (`var(--font)`) are
 * not. The names are the ones people give fonts (letters, digits, spaces, dots, hyphens); another name is left out. Null when nothing is left.
 */
export function fontFamilyValue(raw: string): string | null {
  const parts: string[] = [];
  let current = "";
  let quote = "";
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ",") {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  const out: string[] = [];
  for (const part of parts) {
    const name = part.trim().replace(/\s+/g, " ");
    if (!name) continue;
    if (/^var\(--[A-Za-z0-9_-]+\)$/.test(name)) out.push(name);
    else if (GENERIC_FAMILIES.has(name.toLowerCase())) out.push(name.toLowerCase());
    else if (/^[\p{L}\p{N} _.-]{1,60}$/u.test(name)) out.push(`"${name}"`);
  }
  return out.length ? out.join(", ") : null;
}

/** `name: value` pairs of a style map, in the order of the map, with what cannot be written left out. */
export function declarations(styles: StyleMap | null | undefined, asset: (raw: string) => string | null): string {
  if (!styles) return "";
  let out = "";
  for (const [key, raw] of Object.entries(styles)) {
    if (key.startsWith("__") || key.includes(":")) continue;
    const property = kebab(key);
    if (!PROPERTY.test(property)) continue;
    const value = key === "fontFamily" && typeof raw === "string" ? fontFamilyValue(raw) : raw;
    const clean = cssValue(value, asset);
    if (clean !== null) out += `${property}: ${clean};`;
  }
  return out;
}

/** The rules for the states (`hover:color: red`) of a style map. */
function stateRules(styles: StyleMap | null | undefined, selector: string, asset: (raw: string) => string | null): string[] {
  if (!styles) return [];
  const rules: string[] = [];
  for (const [key, raw] of Object.entries(styles)) {
    const at = key.indexOf(":");
    if (at <= 0) continue;
    const state = key.slice(0, at);
    const property = kebab(key.slice(at + 1));
    if (!STATES.has(state) || !PROPERTY.test(property)) continue;
    const clean = cssValue(raw, asset);
    if (clean !== null) rules.push(`${selector}:${state} { ${property}: ${clean}; }`);
  }
  return rules;
}

export function inDevice(rule: string, device: Device): string {
  if (device === "mobile") return `@media only screen and (max-width: ${MOBILE_BREAKPOINT}px) { ${rule} }`;
  if (device === "tablet") return `@media only screen and (max-width: ${DESKTOP_BREAKPOINT - 1}px) { ${rule} }`;
  return rule;
}

/**
 * The rules of one block: its styles for the desktop, then for the tablet, then for the phone (the narrower one comes later and wins), each
 * with its states.
 */
export function blockRules(
  className: string,
  styles: { base?: StyleMap | null; tablet?: StyleMap | null; mobile?: StyleMap | null },
  asset: (raw: string) => string | null,
): string[] {
  const selector = `.${className}`;
  const rules: string[] = [];
  for (const [device, map] of [["desktop", styles.base], ["tablet", styles.tablet], ["mobile", styles.mobile]] as const) {
    const body = declarations(map, asset);
    if (body) rules.push(inDevice(`${selector} { ${body} }`, device));
    for (const rule of stateRules(map, selector, asset)) rules.push(inDevice(rule, device));
  }
  return rules;
}

/**
 * A stylesheet the person wrote (a "Builder Client Script" of CSS): free text, kept apart from the rest of the page. What it cannot do is
 * leave the <style> element, import another sheet or fetch from a third party.
 */
export function freeCss(text: unknown, asset: (raw: string) => string | null): string {
  if (typeof text !== "string" || !text.trim() || text.length > 200_000) return "";
  const withoutImports = text.replace(/@import\b[^;]*;?/gi, "");
  const withUrls = withoutImports.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gis, (_all, _quote, target: string) => {
    const safe = safeCssUrl(target, asset);
    return safe === null ? "url()" : `url("${safe}")`;
  });
  // No `<` is left: a style element ends only at `</style`, and a CSS escape reads as the same character where one is allowed.
  return withUrls.replace(/</g, "\\3c ").replace(/expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/gi, "");
}
