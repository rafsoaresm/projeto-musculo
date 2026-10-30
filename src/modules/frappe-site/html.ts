/**
 * The HTML of a public page made in the embedded editor. What a block holds as text ("innerHTML": bold, links, lists ...) and the
 * attributes of its element are rewritten from an allowed list of tags and attributes, never passed through: the output is built from
 * tokens, with every value escaped again, so what this module validated is exactly what the browser reads. Scripts, frames, objects,
 * event handlers, `javascript:` addresses and third-party addresses do not get through. The response also carries a strict
 * Content-Security-Policy (document.ts), a second wall for whatever this one misses.
 * tests/frappe-site-html.test.ts feeds it the usual ways around such a filter.
 */
import { cssValue } from "./css";

export interface UrlContext {
  /** The address, written from the page, of an image or a file of the site; null for anything else (a third party, a path of the tool). */
  asset(raw: string): string | null;
  /** The address, written from the page, of a page of the site, given by its route (`/sobre`, `sobre?x=1#y`). */
  page(route: string): string;
}

const MAX_HTML = 500_000;
const MAX_DEPTH = 100;

const TEXT_TAGS = "a abbr b bdi bdo br cite code del dfn em i ins kbd mark q s samp small span strong sub sup time u var wbr".split(" ");
const BLOCK_TAGS =
  "address article aside blockquote caption dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul".split(" ");
/** The tags of the text of a block. (The elements of the blocks themselves are chosen in render.ts.) */
const RICH_TAGS = new Set([...TEXT_TAGS, ...BLOCK_TAGS, "img"]);
const VOID = new Set(["br", "hr", "img", "wbr", "input", "source", "col"]);
/** Elements whose content is not markup (or changes how the rest is read): they go away with everything inside. Any other tag that is not allowed goes away alone and its text stays. */
const DROPPED_WITH_CONTENT = new Set([
  "script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext", "template", "svg", "math", "object", "applet", "head",
]);

const ENTITY = /^&(#[0-9]{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")" };

/** Text between tags: `<`, `>` and a lone `&` are written as entities; a well-formed entity stays. */
export function escapeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else if (char === "&") out += ENTITY.test(text.slice(i, i + 40)) ? "&" : "&amp;";
    else if (char === "\u0000") out += "�";
    else out += char;
  }
  return out;
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\u0000/g, "�");
}

/** The value of an attribute as the browser would read it (the common entities decoded), so that it is judged as it will be used. */
function decode(value: string): string {
  return value.replace(/&(#[0-9]{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (all, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�";
    }
    return NAMED[body.toLowerCase()] ?? all;
  });
}

// ---- addresses ----

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i;

/** What a browser removes or ignores around and inside an address, so that `java\nscript:` is read as it will be. */
function plain(raw: string): string {
  return raw.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
}

/** The address of a link: a place on the page, a page of the site, a web page, an e-mail address or a phone. Null for anything else. */
export function linkUrl(raw: string, ctx: UrlContext): string | null {
  const url = plain(decode(raw));
  if (!url || url.length > 2000 || /[\u0000-\u001f\u007f<>"]/.test(url)) return null;
  if (url.startsWith("#")) return url.replace(/ /g, "%20");
  const scheme = SCHEME.exec(url);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    if (name === "http" || name === "https") return /^https?:\/\/[^\s/?#]+/i.test(url) ? url.replace(/ /g, "%20") : null;
    if (name === "mailto" || name === "tel" || name === "sms") return url.replace(/ /g, "%20");
    return null;
  }
  if (url.startsWith("//") || url.startsWith("\\")) return null;
  return ctx.page(url);
}

/** The address of an image or a video: a file of the site, or a small image carried in the page. */
export function mediaUrl(raw: string, ctx: UrlContext): string | null {
  const url = plain(decode(raw));
  if (!url || /[\u0000-\u001f\u007f<>"]/.test(url)) return null;
  if (IMAGE_DATA.test(url) && url.length <= 400_000) return url;
  return ctx.asset(url);
}

// ---- attributes ----

type Rule = (value: string, ctx: UrlContext) => string | null;
const text = (max = 300): Rule => (value) => (value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : null);
const number: Rule = (value) => (/^-?\d{1,9}(\.\d{1,6})?$/.test(value.trim()) ? value.trim() : null);
const size: Rule = (value) => (/^\d{1,5}(\.\d{1,3})?(px|%|em|rem)?$/.test(value.trim()) ? value.trim() : null);
const bool: Rule = () => "";
const oneOf = (...values: string[]): Rule => (value) => (values.includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() : null);
const media: Rule = (value, ctx) => mediaUrl(value, ctx);
const identifier: Rule = (value) => (/^[A-Za-z][A-Za-z0-9_:.-]{0,99}$/.test(value) ? value : null);
const classes: Rule = (value) => {
  const names = value.split(/\s+/).filter((name) => /^[A-Za-z0-9_-]{1,80}$/.test(name));
  return names.length ? names.join(" ") : null;
};

const GLOBAL: Record<string, Rule> = {
  id: identifier,
  class: classes,
  title: text(),
  lang: (value) => (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(value) ? value : null),
  dir: oneOf("ltr", "rtl", "auto"),
  role: (value) => (/^[a-z-]{1,30}$/.test(value) ? value : null),
  tabindex: oneOf("0", "-1"),
};

const BY_TAG: Record<string, Record<string, Rule>> = {
  a: { href: (value, ctx) => linkUrl(value, ctx), target: oneOf("_blank", "_self"), download: bool },
  img: { src: media, alt: text(), width: size, height: size, loading: oneOf("lazy", "eager"), decoding: oneOf("async", "auto", "sync") },
  video: { src: media, poster: media, controls: bool, autoplay: bool, muted: bool, loop: bool, playsinline: bool, preload: oneOf("none", "metadata", "auto"), width: size, height: size },
  audio: { src: media, controls: bool, loop: bool, preload: oneOf("none", "metadata", "auto") },
  source: { src: media, type: text(60) },
  time: { datetime: text(40) },
  ol: { start: number, type: oneOf("1", "a", "A", "i", "I"), reversed: bool },
  li: { value: number },
  td: { colspan: number, rowspan: number },
  th: { colspan: number, rowspan: number, scope: oneOf("row", "col", "rowgroup", "colgroup") },
  details: { open: bool },
  blockquote: {},
  form: { method: oneOf("get", "post"), name: identifier },
  label: { for: identifier },
  input: {
    type: oneOf("text", "email", "tel", "number", "password", "checkbox", "radio", "submit", "hidden", "date", "time", "url", "search", "range"),
    name: identifier, value: text(), placeholder: text(), required: bool, checked: bool, disabled: bool, readonly: bool, min: text(30), max: text(30), step: text(30), minlength: number, maxlength: number, pattern: text(), autocomplete: text(30),
  },
  textarea: { name: identifier, placeholder: text(), required: bool, disabled: bool, readonly: bool, rows: number, cols: number, minlength: number, maxlength: number },
  select: { name: identifier, required: bool, disabled: bool, multiple: bool },
  option: { value: text(), selected: bool, disabled: bool },
  button: { type: oneOf("button", "submit", "reset"), name: identifier, value: text(), disabled: bool },
};

/** `a: b; c: d` of a style attribute, split at the `;` that are not inside parentheses or quotes. */
function splitDeclarations(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of source) {
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** The `style` attribute of a piece of text: the declarations that can be written safely, the others left out. */
export function inlineStyle(value: string, ctx: UrlContext): string {
  let out = "";
  for (const part of splitDeclarations(decode(value).slice(0, 5000))) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(name)) continue;
    const clean = cssValue(part.slice(at + 1).trim(), ctx.asset);
    if (clean !== null) out += `${name}: ${clean}; `;
  }
  return out.trim();
}

/**
 * The attributes of an element that may be written, as `name -> value` ("" for a flag): only the ones listed for that element, each
 * checked by its own rule. Handlers (`on...`), `srcdoc`, `action`, `formaction` and the rest are not on the list.
 */
export function cleanAttributes(tag: string, attrs: ReadonlyArray<readonly [string, string]>, ctx: UrlContext): Record<string, string> {
  const own = Object.hasOwn(BY_TAG, tag) ? BY_TAG[tag]! : {};
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of attrs) {
    const name = rawName.toLowerCase();
    if (name in out) continue;
    if (name === "style") {
      const style = inlineStyle(rawValue, ctx);
      if (style) out.style = style;
      continue;
    }
    if (/^aria-[a-z-]{1,40}$/.test(name)) {
      const value = text()(decode(rawValue), ctx);
      if (value !== null) out[name] = value;
      continue;
    }
    const rule = Object.hasOwn(own, name) ? own[name] : Object.hasOwn(GLOBAL, name) ? GLOBAL[name] : undefined;
    if (!rule) continue;
    const value = rule === bool ? "" : rule(decode(rawValue), ctx);
    if (value !== null) out[name] = value;
  }
  if (tag === "a" && out.href !== undefined && (out.target === "_blank" || /^https?:/i.test(out.href))) out.rel = "noopener noreferrer";
  return out;
}

export function serializeAttributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([name, value]) => (value === "" && !["alt", "value", "placeholder", "title"].includes(name) ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`))
    .join("");
}

// ---- the tokenizer ----

interface StartTag {
  name: string;
  attrs: Array<[string, string]>;
  /** Where the tag ends (after the `>`), or -1 when the text ends first. */
  end: number;
}

const NAME = /[A-Za-z][A-Za-z0-9-]*/y;
const ATTR_NAME = /[^\s"'<>/=]+/y;
const UNQUOTED = /[^\s>]*/y;

function readTag(html: string, nameStart: number): StartTag | null {
  NAME.lastIndex = nameStart;
  const found = NAME.exec(html);
  if (!found) return null;
  const name = found[0].toLowerCase();
  let pos = nameStart + found[0].length;
  const attrs: Array<[string, string]> = [];
  while (pos < html.length) {
    const char = html[pos]!;
    if (char === ">") return { name, attrs, end: pos + 1 };
    if (/\s|\//.test(char)) {
      pos += 1;
      continue;
    }
    ATTR_NAME.lastIndex = pos;
    const attr = ATTR_NAME.exec(html);
    if (!attr) {
      pos += 1; // a stray quote, `=` or `<`: skipped
      continue;
    }
    pos += attr[0].length;
    while (pos < html.length && /\s/.test(html[pos]!)) pos += 1;
    let value = "";
    if (html[pos] === "=") {
      pos += 1;
      while (pos < html.length && /\s/.test(html[pos]!)) pos += 1;
      const quote = html[pos];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, pos + 1);
        if (close === -1) return { name, attrs, end: -1 };
        value = html.slice(pos + 1, close);
        pos = close + 1;
      } else {
        UNQUOTED.lastIndex = pos;
        const bare = UNQUOTED.exec(html);
        value = bare ? bare[0] : "";
        pos += value.length;
      }
    }
    attrs.push([attr[0], value]);
  }
  return { name, attrs, end: -1 };
}

/** Skips an element whose content is not markup: the position after its closing tag (or the end of the text). */
function skipElement(html: string, from: number, name: string): number {
  const close = new RegExp(`</${name}(?=[\\s/>]|$)`, "ig");
  close.lastIndex = from;
  const found = close.exec(html);
  if (!found) return html.length;
  const end = html.indexOf(">", found.index);
  return end === -1 ? html.length : end + 1;
}

/**
 * The text of a block ("innerHTML") rewritten safely: allowed tags with allowed attributes, text escaped, everything else dropped.
 * Unclosed tags are closed, stray closing tags ignored, so the result is always well nested.
 */
export function sanitizeRichText(source: string, ctx: UrlContext): string {
  const html = source.length > MAX_HTML ? source.slice(0, MAX_HTML) : source;
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out.push(escapeText(html.slice(i)));
      break;
    }
    if (lt > i) out.push(escapeText(html.slice(i, lt)));
    i = lt;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const next = html[i + 1];
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", i);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const closing = next === "/";
    const tag = readTag(html, i + (closing ? 2 : 1));
    if (!tag) {
      out.push("&lt;");
      i += 1;
      continue;
    }
    if (tag.end === -1) break; // a tag that never ends: the rest is dropped
    i = tag.end;
    if (closing) {
      const at = stack.lastIndexOf(tag.name);
      if (at !== -1) while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (DROPPED_WITH_CONTENT.has(tag.name)) {
      i = skipElement(html, i, tag.name);
      continue;
    }
    if (!RICH_TAGS.has(tag.name)) continue;
    const attrs = cleanAttributes(tag.name, tag.attrs, ctx);
    if (tag.name === "img" && attrs.src === undefined) continue;
    out.push(`<${tag.name}${serializeAttributes(attrs)}>`);
    if (!VOID.has(tag.name)) {
      if (stack.length >= MAX_DEPTH) out.pop();
      else stack.push(tag.name);
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join("");
}
