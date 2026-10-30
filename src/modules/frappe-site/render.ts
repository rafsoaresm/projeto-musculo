/**
 * The blocks of a page made in the embedded editor, turned into the HTML and the CSS of the public page. It follows the editor's own
 * renderer (a block becomes an element with a class that carries its styles for the desktop, the tablet and the phone; components are
 * merged into their instances) with the parts that need a server of the editor's kind left out: the data of a page script, the props
 * and repeaters that read it, and the scripts of a block. Where the editor would show a block that depends on such data, the page shows
 * what the block holds (or nothing, for a condition and a repeater, as the editor's own renderer does without data). Every tag, attribute,
 * address and style goes through html.ts and css.ts. tests/frappe-site-render.test.ts holds the cases.
 */
import { blockRules, cssValue, freeCss, type StyleMap } from "./css";
import { cleanAttributes, escapeAttribute, escapeText, sanitizeRichText, serializeAttributes, type UrlContext } from "./html";

export type Block = Record<string, unknown>;

export interface RenderInput {
  /** The blocks of the page: JSON text, or already parsed. */
  blocks: unknown;
  /** The block of a component (parsed), by its id and the version a block is pinned to; null when there is none. */
  component(id: string, version: string | null): unknown;
  /** What a font token (`var(--id)`) stands for, to know which family a block asks for. */
  fontToken(name: string): string | null;
  url: UrlContext;
}

export interface FontUse {
  weights: Set<number>;
  italic: boolean;
}

export interface Rendered {
  /** The whole `<body>` element. */
  body: string;
  /** The rules of the blocks, ready for a <style> element (never contain `</style`). */
  rules: string[];
  /** The families that blocks ask for and are not the system's own, with the weights. */
  fonts: Map<string, FontUse>;
  /** The root block's background, for `html` and `body`, or null. */
  background: string | null;
  /** How many blocks were drawn, and whether the page was cut at the limit. */
  count: number;
  truncated: boolean;
}

const MAX_BLOCKS = 20_000;
const MAX_DEPTH = 60;
const MAX_COMPONENT_DEPTH = 12;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const records = (value: unknown): Block[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const styleMap = (value: unknown): StyleMap => (isRecord(value) ? value : {});

/** The elements a block may be: the ones a page is made of, with nothing that loads another document or runs code. */
const ELEMENTS = new Set([
  "a", "article", "aside", "audio", "b", "blockquote", "body", "button", "caption", "code", "details", "div", "em", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "input", "label", "legend", "li", "main", "mark", "nav", "ol", "option", "p", "pre", "section", "select", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "time", "tr", "u", "ul", "video",
]);
const VOID = new Set(["img", "input", "hr"]);
const TEXT_ELEMENTS = new Set(["span", "h1", "p", "b", "h2", "h3", "h4", "h5", "h6", "label", "a"]);
/** Raw text inside these is not markup: their text is written as plain text. */
const PLAIN_TEXT = new Set(["textarea", "option"]);

const WEIGHTS: Record<string, number> = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
/** Families every device has: nothing to carry for them. */
const SYSTEM_FAMILIES = new Set([
  "arial", "helvetica", "times new roman", "times", "courier new", "courier", "verdana", "georgia", "palatino", "garamond", "bookman", "comic sans ms", "comic sans", "trebuchet ms", "arial black", "impact", "tahoma", "arial narrow", "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "intervar", "inherit",
]);

// ---- the document of a block: components and old styles ----

const kebabToCamel = (name: string) => name.replace(/-([a-z])/g, (_all, letter: string) => letter.toUpperCase());

/** Blocks from before `rawStyles` was dropped in favor of `baseStyles`. */
function mergeRawStyles(block: Block): void {
  const raw = block.rawStyles;
  delete block.rawStyles;
  if (!isRecord(raw)) return;
  const base = isRecord(block.baseStyles) ? block.baseStyles : (block.baseStyles = {});
  for (const [style, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === "") continue;
    const at = style.indexOf(":");
    base[at === -1 ? kebabToCamel(style) : `${style.slice(0, at)}:${kebabToCamel(style.slice(at + 1))}`] = value;
  }
}

function classList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function legacyScript(block: Block): void {
  if (!isRecord(block.clientScript) && typeof block.blockClientScript === "string" && block.blockClientScript) block.clientScript = { js: block.blockClientScript };
}

/** A component's block with an instance's changes put over it (the same merge the editor's renderer does). */
function extendBlock(base: Block, over: Block): Block {
  mergeRawStyles(base);
  mergeRawStyles(over);
  legacyScript(base);
  legacyScript(over);
  base.baseStyles = { ...styleMap(base.baseStyles), ...styleMap(over.baseStyles) };
  base.mobileStyles = { ...styleMap(base.mobileStyles), ...styleMap(over.mobileStyles) };
  base.tabletStyles = { ...styleMap(base.tabletStyles), ...styleMap(over.tabletStyles) };
  base.attributes = { ...styleMap(base.attributes), ...styleMap(over.attributes) };
  if (text(over.element)) base.element = over.element;
  if (over.visibilityCondition) base.visibilityCondition = over.visibilityCondition;
  base.customAttributes = { ...styleMap(base.customAttributes), ...styleMap(over.customAttributes) };
  base.classes = [...classList(base.classes), ...classList(over.classes)];
  base.props = { ...styleMap(base.props), ...styleMap(over.props) };
  if (isRecord(base.clientScript) || isRecord(over.clientScript)) base.clientScript = { ...styleMap(base.clientScript), ...styleMap(over.clientScript) };
  if (text(over.innerHTML)) base.innerHTML = over.innerHTML;
  const own = records(base.children);
  base.children = records(over.children).map((child) => {
    const match = own.find((candidate) => candidate.blockId !== undefined && (candidate.blockId === child.blockId || candidate.blockId === child.referenceBlockId));
    return match ? extendBlock(structuredClone(match), child) : child;
  });
  return base;
}

// ---- the state of one rendering ----

interface State {
  input: RenderInput;
  rules: string[];
  fonts: Map<string, FontUse>;
  count: number;
  truncated: boolean;
  next: number;
  /** The styles of the root block (the page's body). */
  root: StyleMap;
}

function familyOf(font: string, state: State): string {
  const token = /^\s*var\(\s*(--[^),\s]+)/.exec(font);
  const resolved = token ? (state.input.fontToken(token[1]!) ?? "") : font;
  return (resolved.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
}

/** Records the family a style asks for, and the weight it asks it at. */
function useFont(state: State, styles: StyleMap, inherited: string | null, italic: boolean): void {
  let font = text(styles.fontFamily) || (styles.fontWeight ? (inherited ?? "") : "");
  if (!font) return;
  font = familyOf(font, state);
  if (!font || SYSTEM_FAMILIES.has(font.toLowerCase())) return;
  const raw = String(styles.fontWeight ?? "400").toLowerCase();
  const weight = WEIGHTS[raw] ?? (Number.parseInt(raw, 10) || 400);
  const entry = state.fonts.get(font) ?? { weights: new Set<number>(), italic: false };
  entry.weights.add(weight);
  if (italic) entry.italic = true;
  state.fonts.set(font, entry);
}

function resolveComponent(block: Block, state: State): Block {
  let current = block;
  for (let level = 0; level < MAX_COMPONENT_DEPTH; level += 1) {
    const id = text(current.extendedFromComponent);
    if (!id) return current;
    const found = state.input.component(id, text(current.componentVersion) || null);
    if (!isRecord(found) || Object.keys(found).length === 0) return current;
    const merged = extendBlock(structuredClone(found), current);
    // A component can itself be made of another: the merged block keeps its own pointer if the component carried one.
    if (text(merged.extendedFromComponent) === id) delete merged.extendedFromComponent;
    current = merged;
  }
  return current;
}

function hasCondition(block: Block): boolean {
  const condition = block.visibilityCondition;
  if (typeof condition === "string") return condition.trim() !== "";
  return isRecord(condition) && text(condition.key) !== "";
}

function renderBlock(source: Block, state: State, ancestorFont: string | null, ancestorItalic: boolean, depth: number, root: boolean): string {
  if (state.count >= MAX_BLOCKS || depth > MAX_DEPTH) {
    state.truncated = true;
    return "";
  }
  const block = resolveComponent(source, state);
  mergeRawStyles(block);
  state.count += 1;
  // A condition on data that a page script would give: without that data it is false, so the block is not on the page.
  if (hasCondition(block)) return "";

  const original = text(block.originalElement) || text(block.element) || "div";
  // The "HTML" block (free code) is not part of the page: it only runs in its own isolated frame (see isolated.ts).
  if (original === "__raw_html__") return "";
  let element = original === "p" ? "div" : original;
  if (element === "body" && !root) element = "div";
  if (!ELEMENTS.has(element)) element = "div";

  const base = styleMap(block.baseStyles);
  const tablet = styleMap(block.tabletStyles);
  const mobile = styleMap(block.mobileStyles);
  const styles = [base, mobile, tablet];
  const font = styles.map((entry) => text(entry.fontFamily).replace(/^['"]|['"]$/g, "")).find(Boolean) || ancestorFont;
  const italic = styles.map((entry) => entry.fontStyle).filter(Boolean).map((value) => /^(italic|oblique)$/i.test(String(value)))[0] ?? ancestorItalic;
  for (const entry of styles) useFont(state, entry, font, italic);

  const pairs = Object.entries({ ...styleMap(block.attributes), ...styleMap(block.customAttributes) }).filter((pair): pair is [string, string] => typeof pair[1] === "string");
  let attributes = cleanAttributes(element, pairs, state.input.url);
  let picture = "";
  let darkSource = "";
  if (element === "img") {
    // An image has its own file, or the dark one alone, or nothing: then its box stays, empty.
    const raw = styleMap(block.attributes);
    const dark = typeof raw.darkSrc === "string" ? cleanAttributes("img", [["src", raw.darkSrc]], state.input.url).src : undefined;
    if (attributes.src === undefined && dark !== undefined) attributes.src = dark;
    else if (attributes.src !== undefined && dark !== undefined) {
      picture = "picture";
      darkSource = `<source srcset="${escapeAttribute(dark)}" media="(prefers-color-scheme: dark)" style="display: none;">`;
    }
  }
  if ((element === "img" || element === "video") && attributes.src === undefined) {
    element = "div";
    attributes = cleanAttributes("div", pairs, state.input.url);
  }

  const classes = classList(block.classes).filter((name) => /^[A-Za-z0-9_-]{1,80}$/.test(name));
  if (TEXT_ELEMENTS.has(original)) classes.unshift("__text_block__");
  if (root) state.root = base;
  const candidate = `fb-${(state.next + 1).toString(36)}`;
  const rules = blockRules(candidate, { base, tablet, mobile }, state.input.url.asset);
  if (rules.length) {
    state.next += 1;
    classes.unshift(candidate);
    state.rules.push(...rules);
  }
  const script = isRecord(block.clientScript) ? block.clientScript : null;
  if (script && text(script.css)) {
    // The sheet of a block applies to that block only; its script (js) is not run on the page.
    let scope = classes.find((name) => name.startsWith("fb-"));
    if (!scope) {
      scope = `fb-${(state.next += 1).toString(36)}`;
      classes.unshift(scope);
    }
    const css = freeCss(script.css, state.input.url.asset);
    if (css) state.rules.push(`@scope (.${scope}) { ${css} }`);
  }
  if (classes.length) attributes.class = classes.join(" ");

  const open = `<${element}${serializeAttributes(attributes)}>`;
  let html: string;
  if (VOID.has(element)) html = open;
  else {
    let inner = "";
    const content = text(block.innerHTML);
    if (content) inner += PLAIN_TEXT.has(element) ? escapeText(content) : sanitizeRichText(content, state.input.url);
    const children = records(block.children);
    if (!(block.isRepeaterBlock && isRecord(block.dataKey) && text(block.dataKey.key))) {
      for (const child of children) inner += renderBlock(child, state, font, italic, depth + 1, false);
    }
    html = `${open}${inner}</${element}>`;
  }
  return picture ? `<${picture} style="display: contents;">${darkSource}${html}</${picture}>` : html;
}

/** What the root block paints, for `html` and `body` (so a full-width page leaves no white edge): the first of background, image and color that is set. */
function rootBackground(styles: StyleMap, asset: (raw: string) => string | null): string | null {
  for (const key of ["background", "backgroundImage", "backgroundColor"]) {
    const value = styles[key];
    if (typeof value === "string" && value.trim()) return cssValue(value, asset);
  }
  return null;
}

/** Draws the blocks of a page. A page that cannot be read draws as an empty body. */
export function renderBlocks(input: RenderInput): Rendered {
  let parsed: unknown = input.blocks;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed || "[]");
    } catch {
      parsed = [];
    }
  }
  const list = Array.isArray(parsed) ? records(parsed) : isRecord(parsed) ? [parsed] : [];
  const state: State = { input, rules: [], fonts: new Map(), count: 0, truncated: false, next: 0, root: {} };
  let body = "";
  let attributes = "";
  const first = list[0];
  const firstElement = first ? text(first.originalElement) || text(first.element) : "";
  if (first && firstElement === "body") {
    // The root block is the body: its element, class and attributes are the <body>'s own.
    const html = renderBlock(first, state, null, false, 0, true);
    const match = /^<body([^>]*)>([\s\S]*)<\/body>$/.exec(html);
    if (match) {
      attributes = match[1] ?? "";
      body = match[2] ?? "";
    } else body = html;
    for (const block of list.slice(1)) body += renderBlock(block, state, null, false, 1, false);
  } else for (const block of list) body += renderBlock(block, state, null, false, 0, false);
  return {
    body: `<body${attributes}>${body}</body>`,
    rules: state.rules,
    fonts: state.fonts,
    background: rootBackground(state.root, input.url.asset),
    count: state.count,
    truncated: state.truncated,
  };
}
