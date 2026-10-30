/**
 * The free code of a page made in the embedded editor: what a person writes into the "HTML" block (markup, style sheets, scripts) or into an
 * `iframe` block (a video, a map). It is the one place where free code is allowed, and it is allowed because it is walled in: on the public page it is
 * not part of the page but a frame (`sandbox="allow-scripts"`, never `allow-same-origin`) that shows a document of its own, served by
 * `/site/<address>/m/codigo/…` with a policy that gives it no way back to the site (no cookie, no storage, no reach into the page, no network
 * unless the site opened it). Pure: no database, no request.
 *
 * Which blocks are free code follows the editor's own rule (BlockHTML in the editor: what it draws as free HTML) and then asks one more thing, so
 * that what the person sees in the editor is what the page isolates: an `iframe` block, or an "HTML" block (or any other block that is not text, a
 * button, a link or a form control and whose HTML holds markup) whose code is ACTIVE: a script, a style sheet, a frame, a form, a handler. Markup with
 * none of that (a line of text with a mark or two, as the editor's own templates have) is drawn in the page, filtered, like any other text. A
 * drawing (an `<svg>`, a logo, an icon) is not code either: it is drawn in the page itself, filtered. The test for "active" only decides where the
 * code is shown; what is drawn in the page always goes through the filter, so a miss at worst means code that does not run, never code that does.
 */
import { escapeAttribute } from "./html";

export type Block = Record<string, unknown>;

export interface CodeBlock {
  /** The position among the free code of the page, in the order of the page (what the address of its frame names). */
  index: number;
  /** What the frame shows: the markup the person wrote. */
  html: string;
  /** Whether it asks for something from outside (a script, a style sheet, an image, a frame of another site): it works only if the site opened the network. */
  external: boolean;
}

/** Where the frame of a block is served from, below the address of the site. */
export const CODE_PATH = "m/codigo";

/** What one page may hold, and how much one block may be: past these the rest is not drawn. */
export const CODE_BLOCKS_MAX = 20;
export const CODE_LETTERS_MAX = 300_000;

const isRecord = (value: unknown): value is Block => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * What makes HTML code rather than text: a tag that runs, styles, frames or sends something, an event handler inside a tag (in any spelling of the
 * space before it, after a quoted value too), a `javascript:` address. The scan of a tag stops at the next `<`, so a long run of broken tags is read once.
 */
const ACTIVE = /<\s*(?:script|style|link|meta|base|iframe|frame|frameset|object|embed|applet|form|input|textarea|select|button|video|audio|canvas|dialog|template|noscript)\b|<[a-z](?:[^<>"']|"[^"]*"|'[^']*')*?(?<=[\s/"'])on[a-z]+\s*=|javascript:|srcdoc\s*=/i;
export const isActive = (html: string): boolean => ACTIVE.test(html);

/** The editor's own set of text elements (`TEXT_ELEMENTS` in block.ts): a block of one of these is text, not free HTML. */
const EDITOR_TEXT = new Set(["span", "h1", "p", "b", "h2", "h3", "h4", "h5", "h6", "label", "a", "cite", "li", "strong", "em", "i", "blockquote", "summary"]);
/** Blocks whose HTML is not markup of the person's: a button, a form control. */
const NOT_CODE = new Set(["button", "input", "textarea", "select", "option", "form"]);

/** What the permissions of a frame may name (`allow="fullscreen; autoplay"`): words, never a list of origins. */
const ALLOW = /^[a-z-]+(?:\s*;\s*[a-z-]+)*;?$/;

/** An `iframe` block as the code it stands for: the frame the person asked for, with the few attributes that are safe to carry. Null without an `https` address. */
function iframeCode(block: Block): string | null {
  const attributes: Record<string, unknown> = { ...(isRecord(block.attributes) ? block.attributes : {}), ...(isRecord(block.customAttributes) ? block.customAttributes : {}) };
  const src = text(attributes.src).trim();
  if (!/^https:\/\/[^\s"'<>\\]{3,1000}$/i.test(src)) return null;
  const parts = [`src="${escapeAttribute(src)}"`, 'style="border:0;width:100%;height:100%"', 'loading="lazy"', 'referrerpolicy="strict-origin-when-cross-origin"'];
  const allow = text(attributes.allow).trim();
  if (allow && ALLOW.test(allow)) parts.push(`allow="${escapeAttribute(allow)}"`);
  if (Object.hasOwn(attributes, "allowfullscreen") || Object.hasOwn(attributes, "allowFullscreen")) parts.push("allowfullscreen");
  const title = text(attributes.title).trim().slice(0, 120);
  if (title) parts.push(`title="${escapeAttribute(title)}"`);
  return `<iframe ${parts.join(" ")}></iframe>`;
}

/**
 * The code a block holds if it is free code, otherwise null. An `iframe` block with no `https` address answers an empty string: it is still a box
 * on the page, with nothing to show.
 */
export function freeCodeOf(block: Block): string | null {
  const element = text(block.element);
  if (block.isRepeaterBlock && isRecord(block.dataKey) && text(block.dataKey.key)) return null;
  if (element === "iframe") return iframeCode(block) ?? "";
  const html = text(block.innerHTML);
  // A drawing starts with its `<svg>` (a space or a new line before it, as templates have, does not make it code).
  if ((element === "svg" || /^\s*<svg[\s>/]/i.test(html)) && html.trim() !== "") return null;
  if (EDITOR_TEXT.has(element) || NOT_CODE.has(element)) return null;
  if (text(block.originalElement) !== "__raw_html__" && !/<[a-z][\s\S]*>/i.test(html)) return null;
  return isActive(html) ? html : null;
}

/** Whether code reaches for something outside the site (advisory: it tells the person that the code needs the network opened). */
export function reachesOutside(html: string): boolean {
  // The names of the namespaces of a drawing are not addresses anyone fetches.
  const cleaned = html.replace(/https?:\/\/www\.w3\.org\/[\w/.#-]*/gi, "");
  return /(?:https?:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/i.test(cleaned);
}

/**
 * The document a frame shows: the code as the person wrote it, in a page with nothing of its own but a reset of the margin. What it can do is the
 * policy of the response (`codePolicy`), not anything in here.
 */
export function codeDocument(html: string): string {
  return `<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<meta name="robots" content="noindex">\n<style>html, body { margin: 0; }</style>\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
}

/**
 * What the document of a frame may do. `sandbox` without `allow-same-origin` is what walls it in: the document has an origin of its own, so it cannot
 * read a cookie or a storage of the site, nor reach into the page that holds it. Inline scripts and styles run (it is free code), and nothing can be
 * fetched from anywhere (images only from the site itself or embedded) unless the site opened the network, which lets it use `https`.
 */
export function codePolicy(networkOpen: boolean): string {
  const web = networkOpen ? " https:" : "";
  return [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval'${web}`,
    `style-src 'unsafe-inline'${web}`,
    `img-src data: blob: 'self'${web}`,
    `media-src data: blob: 'self'${web}`,
    `font-src data: 'self'${web}`,
    ...(networkOpen ? ["connect-src https:", "frame-src https:"] : []),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}
