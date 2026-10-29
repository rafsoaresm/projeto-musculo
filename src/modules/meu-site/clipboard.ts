import {
  HOME,
  MAX_BLOCKS,
  MAX_COMPONENTS,
  MAX_DEPTH,
  MAX_NODES,
  allNodes,
  boxDepth,
  componentById,
  newBlockId,
  parseComponentDef,
  parseNode,
  type ComponentDef,
  type ComponentNode,
  type SiteContent,
  type SiteNode,
} from "./contracts";
import { expandInstance } from "./component-model";
import { insertNode, locate, topmost, type ManyOutcome, type Slot } from "./editor-model";
import { SCREEN_KEY, SCREENS, type Styled } from "./screens";
import { styleSchema, type Style } from "./style";

/**
 * What goes to the clipboard when blocks, or the style of a block, are copied: a short text that is JSON with a name of its own, so a paste of
 * anything else is recognized and ignored. What comes back is **not trusted**: it may have been copied from another site, or written by hand. It is
 * read as strictly as a document is (`parseNode`), has new identifiers, and loses what only made sense where it came from: the images of
 * another site's library, services that are not on offer here, a testimony's "authorized" (the person has to confirm again), links to blocks
 * that are not on this page. An instance of a component that is on this site stays an instance (it follows the component); one of a component this
 * site does not have comes back as plain blocks, from the definition the copy carries.
 */
export const BLOCKS_FORMAT = "meu-site/blocos";
export const STYLE_FORMAT = "meu-site/estilo";
export const MAX_CLIPBOARD_CHARS = 120_000;

export interface BlocksPayload {
  format: typeof BLOCKS_FORMAT;
  version: 1;
  nodes: SiteNode[];
  /** The components that the instances among the nodes point to, so a paste in another site can draw them. */
  components?: ComponentDef[];
}
export interface StylePayload extends Styled {
  format: typeof STYLE_FORMAT;
  version: 1;
}

/** The topmost of the nodes, in the order of the document, ready to be written; null when none of them is there. */
export function blocksPayload(content: SiteContent, ids: readonly string[]): BlocksPayload | null {
  const nodes = topmost(content, ids).map((id) => locate(content, id)!.node);
  if (nodes.length === 0) return null;
  const used = new Set(allNodes(nodes).flatMap((entry) => (entry.type === "component" ? [entry.componentId] : [])));
  const components = [...used].flatMap((componentId) => componentById(content, componentId) ?? []);
  return { format: BLOCKS_FORMAT, version: 1, nodes, ...(components.length > 0 ? { components } : null) };
}

function readJson(text: string, format: string): Record<string, unknown> | null {
  if (text.length === 0 || text.length > MAX_CLIPBOARD_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return record.format === format && record.version === 1 ? record : null;
}

/** The blocks in a text, or null when it is not a copy of blocks or is not valid: every node passes the contract, within the limits of a document. */
export function parseBlocks(text: string): BlocksPayload | null {
  const record = readJson(text, BLOCKS_FORMAT);
  if (!record || !Array.isArray(record.nodes) || record.nodes.length === 0 || record.nodes.length > MAX_BLOCKS) return null;
  const nodes: SiteNode[] = [];
  for (const raw of record.nodes) {
    const node = parseNode(raw);
    if (!node) return null;
    nodes.push(node);
  }
  if (allNodes(nodes).length > MAX_NODES || boxDepth(nodes) > MAX_DEPTH) return null;
  let components: ComponentDef[] | undefined;
  if (record.components !== undefined) {
    if (!Array.isArray(record.components) || record.components.length > MAX_COMPONENTS) return null;
    components = [];
    for (const raw of record.components) {
      const definition = parseComponentDef(raw);
      if (!definition) return null;
      components.push(definition);
    }
  }
  return { format: BLOCKS_FORMAT, version: 1, nodes, ...(components && components.length > 0 ? { components } : null) };
}

/** What a paste may keep of where it came from: the images of this site's library, and the services on offer here. */
export interface PasteContext {
  assetIds: ReadonlySet<string>;
  serviceIds: ReadonlySet<string>;
  /** The pages of this site, for the buttons and links that go to a page (the home page is always there). Absent: only the home page. */
  pageIds?: ReadonlySet<string>;
}

function withoutForeignImages<T extends Styled>(entry: T, assetIds: ReadonlySet<string>): T {
  let out = entry;
  for (const screen of SCREENS) {
    const key = SCREEN_KEY[screen];
    const style = out[key];
    if (style?.bgImage && !assetIds.has(style.bgImage)) {
      const { bgImage: dropped, ...rest } = style;
      void dropped;
      out = { ...out, [key]: Object.keys(rest).length > 0 ? rest : undefined };
      if (out[key] === undefined) delete out[key];
    }
  }
  return out;
}

/** The copy with new identifiers, and which identifier each old one became (so a link to a block of the copy can follow it). */
function freshIds(nodes: readonly SiteNode[]): { nodes: SiteNode[]; renamed: Map<string, string> } {
  const renamed = new Map<string, string>();
  const fresh = (entry: SiteNode): SiteNode => {
    const id = newBlockId();
    renamed.set(entry.id, id);
    return { ...entry, id, ...(entry.type === "box" ? { children: entry.children.map(fresh) } : null) } as SiteNode;
  };
  return { nodes: nodes.map(fresh), renamed };
}

/** What a paste is made into: the document it goes to, and the components the copy carries. */
interface PasteInto {
  content: SiteContent;
  carried: readonly ComponentDef[];
}
/** An instance in the copy points to a component that neither this site has nor the copy carries. */
class ForeignComponent extends Error {}

/** The overrides of an instance without the images that are not of this site's library. */
function overridesHere(entry: ComponentNode, assetIds: ReadonlySet<string>): ComponentNode["overrides"] {
  const out: ComponentNode["overrides"] = {};
  for (const [nodeId, fields] of Object.entries(entry.overrides)) {
    const { assetId, ...rest } = fields;
    const kept = assetId !== undefined && assetIds.has(assetId) ? { ...rest, assetId } : rest;
    if (Object.keys(kept).length > 0) out[nodeId] = kept;
  }
  return out;
}

/** A node as it may be pasted here: what is not of this site is dropped, and links that go to a block of the copy follow the copy. */
function clean(entry: SiteNode, context: PasteContext, renamed: ReadonlyMap<string, string>, existing: ReadonlySet<string>, into: PasteInto): SiteNode {
  if (entry.type === "component") {
    // A component of this site is kept (the instance follows it); one of another site comes as plain blocks, drawn from the definition the copy carries.
    if (componentById(into.content, entry.componentId)) {
      return withoutForeignImages({ ...entry, overrides: overridesHere(entry, context.assetIds) }, context.assetIds);
    }
    const carried = into.carried.find((definition) => definition.id === entry.componentId);
    if (!carried) throw new ForeignComponent();
    const { nodes: [copy], renamed: more } = freshIds([expandInstance(entry, carried)]);
    return clean(copy, context, new Map([...renamed, ...more]), existing, into);
  }
  let out: SiteNode = withoutForeignImages(entry, context.assetIds);
  if (out.type === "box") out = { ...out, children: out.children.map((child) => clean(child, context, renamed, existing, into)) };
  else if (out.type === "image") out = { ...out, assetId: context.assetIds.has(out.assetId) ? out.assetId : "" };
  else if (out.type === "services") {
    const { items: dropped, ...rest } = out;
    void dropped;
    out = { ...rest, serviceIds: out.serviceIds.filter((serviceId) => context.serviceIds.has(serviceId)) };
  } else if (out.type === "quote") out = { ...out, authorized: false };
  else if ((out.type === "button" || out.type === "link") && out.anchor) {
    const target = renamed.get(out.anchor) ?? (existing.has(out.anchor) ? out.anchor : undefined);
    const { anchor: dropped, ...rest } = out;
    void dropped;
    out = (target ? { ...rest, anchor: target } : rest) as SiteNode;
  } else if ((out.type === "button" || out.type === "link") && out.page && out.page !== HOME && !context.pageIds?.has(out.page)) {
    // A link to a page of another site goes nowhere here.
    const { page: dropped, ...rest } = out;
    void dropped;
    out = rest as SiteNode;
  }
  return out;
}

/**
 * The nodes of a copy put into the slot, one after the other. Everything or nothing: when one does not fit (a full container, too deep, too many
 * nodes in the site) the document is not changed and the reason says why.
 */
export function pasteBlocks(content: SiteContent, payload: BlocksPayload, slot: Slot, context: PasteContext): ManyOutcome {
  const existing = new Set(allNodes(content.blocks).map((entry) => entry.id));
  const { nodes, renamed } = freshIds(payload.nodes);
  const into: PasteInto = { content, carried: payload.components ?? [] };
  let current = content;
  const made: string[] = [];
  let index = slot.index;
  for (const node of nodes) {
    let ready: SiteNode;
    try {
      ready = clean(node, context, renamed, existing, into);
    } catch (error) {
      if (error instanceof ForeignComponent) return { ok: false, reason: "foreign-component" };
      throw error;
    }
    const outcome = insertNode(current, ready, { parent: slot.parent, index });
    if (!outcome.ok) return outcome;
    current = outcome.content;
    made.push(outcome.id);
    index = index >= Number.MAX_SAFE_INTEGER ? index : index + 1;
  }
  return { ok: true, content: current, ids: made };
}

// ---- the style of a block ----

/** The style of a node at every size, as a payload (nothing is written for a node with no style). */
export function stylePayload(node: Styled): StylePayload {
  const payload: StylePayload = { format: STYLE_FORMAT, version: 1 };
  for (const screen of SCREENS) {
    const style = node[SCREEN_KEY[screen]];
    if (style) payload[SCREEN_KEY[screen]] = structuredClone(style);
  }
  return payload;
}

/** The style in a text, or null when it is not a copy of a style or any of its sizes is not a valid style. */
export function parseStyle(text: string): StylePayload | null {
  const record = readJson(text, STYLE_FORMAT);
  if (!record) return null;
  const payload: StylePayload = { format: STYLE_FORMAT, version: 1 };
  for (const screen of SCREENS) {
    const key = SCREEN_KEY[screen];
    if (record[key] === undefined) continue;
    const parsed = styleSchema.safeParse(record[key]);
    if (!parsed.success) return null;
    payload[key] = parsed.data as Style;
  }
  return payload;
}

/** The node with the styles of the payload in place of its own, at every size (a background image that is not in this site's library is left out). */
export function applyStyle<T extends Styled>(node: T, payload: StylePayload, assetIds: ReadonlySet<string>): T {
  const { style: _a, styleTablet: _b, styleMobile: _c, ...rest } = node;
  void _a;
  void _b;
  void _c;
  const incoming = withoutForeignImages({ style: payload.style, styleTablet: payload.styleTablet, styleMobile: payload.styleMobile } as Styled, assetIds);
  const out: Record<string, unknown> = { ...rest };
  for (const screen of SCREENS) {
    const style = incoming[SCREEN_KEY[screen]];
    if (style && Object.keys(style).length > 0) out[SCREEN_KEY[screen]] = style;
  }
  return out as T;
}
