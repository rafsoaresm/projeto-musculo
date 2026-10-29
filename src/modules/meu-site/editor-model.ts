import {
  MAX_BLOCKS,
  MAX_CHILDREN,
  MAX_COMPONENTS,
  MAX_COMPONENT_NODES,
  MAX_DEPTH,
  MAX_EXPANDED_NODES,
  MAX_NODES,
  allNodes,
  boxDepth,
  emptyBlock,
  expandedCount,
  newBlockId,
  type BlockType,
  type PlainBlockType,
  type BoxNode,
  type SiteContent,
  type SiteNode,
} from "./contracts";

/**
 * What the visual editor does to the document, as functions that take a document and give back another one
 * (or say why not). No React here: the rules of where each node may go, how many fit and what a duplicate is live in
 * one place and are tested without a screen. The screen only asks.
 *
 * The document is a tree. A place in it is a `Slot`: the container (`null` for the page itself) and the position
 * among what the container holds. Only a container holds other nodes; every limit of the contract is checked here
 * before the change, so a document that comes out of these functions is one the server accepts.
 */
export interface Slot {
  /** The id of the container, or null for the page itself. */
  parent: string | null;
  /** Position among the nodes of the container, counted before anything is taken out of it. */
  index: number;
}
export const PAGE: Slot["parent"] = null;

export type Refusal =
  | "not-found"
  | "not-accepted"
  | "cycle"
  | "limit-blocks"
  | "limit-children"
  | "limit-nodes"
  | "limit-depth"
  | "not-siblings"
  | "nested-component"
  | "limit-components"
  | "limit-component-nodes"
  | "limit-expanded"
  | "empty-component"
  | "no-component"
  | "foreign-component";
export type Outcome = { ok: true; content: SiteContent; id: string } | { ok: false; reason: Refusal };
/** What a change to several nodes gives: the document, and the identifiers of the nodes it made or kept. */
export type ManyOutcome = { ok: true; content: SiteContent; ids: string[] } | { ok: false; reason: Refusal };

export const REFUSAL_MESSAGE: Record<Refusal, string> = {
  "not-found": "Esse bloco não existe mais.",
  "not-accepted": "Só um contêiner recebe outros blocos dentro. Solte dentro de um contêiner ou entre dois blocos.",
  cycle: "Um contêiner não pode ser colocado dentro dele mesmo.",
  "limit-blocks": `A página aceita até ${MAX_BLOCKS} blocos.`,
  "limit-children": `Cada contêiner aceita até ${MAX_CHILDREN} blocos dentro.`,
  "limit-nodes": `O site aceita até ${MAX_NODES} blocos no total, contando os que estão dentro de contêineres.`,
  "limit-depth": `Os contêineres aceitam até ${MAX_DEPTH} níveis, um dentro do outro.`,
  "not-siblings": "Só dá para agrupar blocos que estão no mesmo lugar (na página ou no mesmo contêiner).",
  "nested-component": "Um componente não pode ter outro componente dentro. Desvincule o bloco antes.",
  "limit-components": `O site aceita até ${MAX_COMPONENTS} componentes.`,
  "limit-component-nodes": `Um componente aceita até ${MAX_COMPONENT_NODES} blocos, contando os que estão dentro de contêineres.`,
  "limit-expanded": `Com os componentes desenhados, a página passaria de ${MAX_EXPANDED_NODES} blocos.`,
  "empty-component": "O componente precisa de pelo menos um bloco.",
  "no-component": "Esse componente não existe mais.",
  "foreign-component": "O bloco copiado usa um componente que não está neste site e não veio junto.",
};

/** Whether a node of this type holds other nodes. */
export const holds = (type: BlockType): boolean => type === "box";

export interface Located {
  node: SiteNode;
  /** The id of the container that holds it, or null when it is on the page. */
  parentId: string | null;
  /** Position among the nodes of its container. */
  index: number;
  /** How many nodes its container holds. */
  count: number;
  /** How many containers are above it: 0 on the page. */
  depth: number;
}

function find(blocks: readonly SiteNode[], id: string, parentId: string | null, depth: number): Located | null {
  for (const [index, entry] of blocks.entries()) {
    if (entry.id === id) return { node: entry, parentId, index, count: blocks.length, depth };
    if (entry.type === "box") {
      const inner = find(entry.children, id, entry.id, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}
export const locate = (content: SiteContent, id: string): Located | null => find(content.blocks, id, null, 0);

/** What a container holds (the page when `parentId` is null), or null when there is no such container. */
export function childrenOf(content: SiteContent, parentId: string | null): readonly SiteNode[] | null {
  if (parentId === null) return content.blocks;
  const found = locate(content, parentId);
  return found && found.node.type === "box" ? found.node.children : null;
}

/** The containers above a node, from the outermost to the one that holds it. */
export function ancestorsOf(content: SiteContent, id: string): BoxNode[] {
  const chain: BoxNode[] = [];
  let current = locate(content, id);
  while (current && current.parentId !== null) {
    const parent = locate(content, current.parentId);
    if (!parent || parent.node.type !== "box") break;
    chain.unshift(parent.node);
    current = parent;
  }
  return chain;
}

/** Whether `id` is `ancestorId` or inside it. */
export const isInside = (content: SiteContent, id: string, ancestorId: string): boolean =>
  id === ancestorId || ancestorsOf(content, id).some((entry) => entry.id === ancestorId);

/**
 * A copy of the tree where `change` has been applied to the node `id`, rebuilding only the line of containers that leads to
 * it: everything else is the very same object, so what did not change is not drawn again.
 */
function rebuild(nodes: readonly SiteNode[], id: string, change: (entry: SiteNode) => SiteNode): readonly SiteNode[] {
  let changed = false;
  const out = nodes.map((entry) => {
    if (entry.id === id) {
      changed = true;
      return change(entry);
    }
    if (entry.type !== "box") return entry;
    const inner = rebuild(entry.children, id, change);
    if (inner === entry.children) return entry;
    changed = true;
    return { ...entry, children: inner as SiteNode[] };
  });
  return changed ? out : nodes;
}

export function withChildren(content: SiteContent, parentId: string | null, list: SiteNode[]): SiteContent {
  if (parentId === null) return { ...content, blocks: list };
  return { ...content, blocks: rebuild(content.blocks, parentId, (entry) => (entry.type === "box" ? { ...entry, children: list } : entry)) as SiteNode[] };
}

const capacityOf = (parentId: string | null) => (parentId === null ? MAX_BLOCKS : MAX_CHILDREN);
const fullFor = (parentId: string | null): Refusal => (parentId === null ? "limit-blocks" : "limit-children");
const clamp = (index: number, length: number) => Math.max(0, Math.min(index, length));
const countOf = (entry: SiteNode) => allNodes([entry]).length;

/** The refusal for putting `entry` (with what it holds) in the slot of `content`, ignoring the limit of the container's own count. */
function placement(content: SiteContent, entry: SiteNode, parentId: string | null): Refusal | null {
  if (parentId === null) return boxDepth([entry]) > MAX_DEPTH ? "limit-depth" : null;
  const parent = locate(content, parentId);
  if (!parent || parent.node.type !== "box") return parent ? "not-accepted" : "not-found";
  // The containers above the node (the parent and the ones above it) and the deepest line of containers inside it.
  return parent.depth + 1 + boxDepth([entry]) > MAX_DEPTH ? "limit-depth" : null;
}

/** A ready node (with what it holds) in the slot. */
export function insertNode(content: SiteContent, entry: SiteNode, slot: Slot): Outcome {
  const list = childrenOf(content, slot.parent);
  if (!list) return { ok: false, reason: slot.parent !== null && locate(content, slot.parent) ? "not-accepted" : "not-found" };
  if (list.length >= capacityOf(slot.parent)) return { ok: false, reason: fullFor(slot.parent) };
  if (allNodes(content.blocks).length + countOf(entry) > MAX_NODES) return { ok: false, reason: "limit-nodes" };
  const refusal = placement(content, entry, slot.parent);
  if (refusal) return { ok: false, reason: refusal };
  const next = [...list];
  next.splice(clamp(slot.index, list.length), 0, entry);
  const changed = withChildren(content, slot.parent, next);
  if (expandedCount(changed) > MAX_EXPANDED_NODES) return { ok: false, reason: "limit-expanded" };
  return { ok: true, content: changed, id: entry.id };
}

/** A new empty node of the type in the slot. */
export const insertBlock = (content: SiteContent, type: PlainBlockType, slot: Slot): Outcome => insertNode(content, emptyBlock(type), slot);

/** Takes a node where it is and puts it in the slot, keeping everything it holds. Where it stood is not counted twice. */
export function moveBlock(content: SiteContent, id: string, slot: Slot): Outcome {
  const from = locate(content, id);
  if (!from) return { ok: false, reason: "not-found" };
  const target = childrenOf(content, slot.parent);
  if (!target) return { ok: false, reason: slot.parent !== null && locate(content, slot.parent) ? "not-accepted" : "not-found" };
  if (slot.parent !== null && isInside(content, slot.parent, id)) return { ok: false, reason: "cycle" };
  const index = clamp(slot.index, target.length);

  if (from.parentId === slot.parent) {
    const destination = from.index < index ? index - 1 : index;
    if (destination === from.index) return { ok: true, content, id };
    const next = [...target];
    next.splice(from.index, 1);
    next.splice(destination, 0, from.node);
    return { ok: true, content: withChildren(content, slot.parent, next), id };
  }

  if (target.length >= capacityOf(slot.parent)) return { ok: false, reason: fullFor(slot.parent) };
  const without = withChildren(content, from.parentId, childrenOf(content, from.parentId)!.filter((_, position) => position !== from.index));
  const refusal = placement(without, from.node, slot.parent);
  if (refusal) return { ok: false, reason: refusal };
  const into = [...childrenOf(without, slot.parent)!];
  into.splice(index, 0, from.node);
  return { ok: true, content: withChildren(without, slot.parent, into), id };
}

/** The same node with new identifiers, and so for everything inside it. */
export function cloneWithNewIds(entry: SiteNode): SiteNode {
  const copy = { ...structuredClone(entry), id: newBlockId() } as SiteNode;
  return copy.type === "box" ? { ...copy, children: (entry as BoxNode).children.map(cloneWithNewIds) } : copy;
}

/** A copy right after the node, with everything it holds. */
export function duplicateBlock(content: SiteContent, id: string): Outcome {
  const from = locate(content, id);
  if (!from) return { ok: false, reason: "not-found" };
  const copy = cloneWithNewIds(from.node);
  return insertNode(content, copy, { parent: from.parentId, index: from.index + 1 });
}

/** Takes a node out, with what it holds. The same document when the node is not there. */
export function removeBlock(content: SiteContent, id: string): SiteContent {
  const from = locate(content, id);
  if (!from) return content;
  return withChildren(content, from.parentId, childrenOf(content, from.parentId)!.filter((_, position) => position !== from.index));
}

/** One place up or down inside the container. The same document at the edge. */
export function shiftBlock(content: SiteContent, id: string, by: -1 | 1): SiteContent {
  const from = locate(content, id);
  if (!from) return content;
  const to = from.index + by;
  if (to < 0 || to >= from.count) return content;
  const next = [...childrenOf(content, from.parentId)!];
  [next[from.index], next[to]] = [next[to], next[from.index]];
  return withChildren(content, from.parentId, next);
}

/** Out of its container: right after it, in the container that holds that one. The way, without dragging, to climb a level. */
export function moveOut(content: SiteContent, id: string): Outcome {
  const from = locate(content, id);
  if (!from || from.parentId === null) return { ok: false, reason: "not-found" };
  const parent = locate(content, from.parentId)!;
  return moveBlock(content, id, { parent: parent.parentId, index: parent.index + 1 });
}

/** Into the container that comes right before it among its siblings, at the end. The way, without dragging, to go down a level. */
export function moveIntoPrevious(content: SiteContent, id: string): Outcome {
  const from = locate(content, id);
  if (!from || from.index === 0) return { ok: false, reason: "not-found" };
  const before = childrenOf(content, from.parentId)![from.index - 1];
  if (before.type !== "box") return { ok: false, reason: "not-accepted" };
  return moveBlock(content, id, { parent: before.id, index: Number.MAX_SAFE_INTEGER });
}

/** Puts a new container around the node, where it stands. */
export function wrapBlock(content: SiteContent, id: string): Outcome {
  const from = locate(content, id);
  if (!from) return { ok: false, reason: "not-found" };
  const wrapper = { ...(emptyBlock("box") as BoxNode), children: [from.node] };
  if (allNodes(content.blocks).length + 1 > MAX_NODES) return { ok: false, reason: "limit-nodes" };
  const refusal = placement(removeBlock(content, id), wrapper, from.parentId);
  if (refusal) return { ok: false, reason: refusal };
  const next = [...childrenOf(content, from.parentId)!];
  next[from.index] = wrapper;
  const changed = withChildren(content, from.parentId, next);
  if (expandedCount(changed) > MAX_EXPANDED_NODES) return { ok: false, reason: "limit-expanded" };
  return { ok: true, content: changed, id: wrapper.id };
}

/** Takes a container away and leaves what it held, in its place. */
export function unwrapBlock(content: SiteContent, id: string): Outcome {
  const from = locate(content, id);
  if (!from || from.node.type !== "box") return { ok: false, reason: "not-found" };
  const inner = from.node.children;
  if (from.count - 1 + inner.length > capacityOf(from.parentId)) return { ok: false, reason: fullFor(from.parentId) };
  const next = [...childrenOf(content, from.parentId)!];
  next.splice(from.index, 1, ...inner);
  return { ok: true, content: withChildren(content, from.parentId, next), id: inner[0]?.id ?? id };
}

/** Changes one node with a function that gives the new one. The same document when the node is not there. */
export function updateBlock(content: SiteContent, id: string, change: (entry: SiteNode) => SiteNode): SiteContent {
  const blocks = rebuild(content.blocks, id, change);
  return blocks === content.blocks ? content : { ...content, blocks: blocks as SiteNode[] };
}

/** Where a node goes when it is added without being dragged: the end of the page. */
export const endOfPage = (content: SiteContent): Slot => ({ parent: PAGE, index: content.blocks.length });

/**
 * A copy of a node (or any object) with the text at `path` replaced: "heading", "items.2.question".
 * A path that is not there changes nothing: a field of a row that was just removed cannot come back.
 */
export function setIn<T>(target: T, path: string, value: string): T {
  const keys = path.split(".");
  const walk = (node: unknown, depth: number): unknown => {
    if (node === null || typeof node !== "object") return node;
    const key = keys[depth];
    if (Array.isArray(node)) {
      const copy = [...node];
      const at = Number(key);
      if (!Number.isInteger(at) || at < 0 || at >= copy.length) return node;
      copy[at] = depth === keys.length - 1 ? value : walk(copy[at], depth + 1);
      return copy;
    }
    const record = node as Record<string, unknown>;
    if (!(key in record) && depth !== keys.length - 1) return node;
    return { ...record, [key]: depth === keys.length - 1 ? value : walk(record[key], depth + 1) };
  };
  return walk(target, 0) as T;
}

// ---- several nodes at once ----

/** The identifiers in the order of the document (a node before what it holds), each once, only the ones that are there. */
export function inDocumentOrder(content: SiteContent, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  return allNodes(content.blocks).filter((entry) => wanted.has(entry.id)).map((entry) => entry.id);
}

/** Without the ones that are inside another of the list: what a removal, a copy or a duplicate of the lot takes is the topmost of each. */
export function topmost(content: SiteContent, ids: readonly string[]): string[] {
  const ordered = inDocumentOrder(content, ids);
  const chosen = new Set(ordered);
  return ordered.filter((id) => !ancestorsOf(content, id).some((above) => chosen.has(above.id)));
}

/** Takes the nodes out (the topmost of them, with what they hold). The same document when none is there. */
export const removeBlocks = (content: SiteContent, ids: readonly string[]): SiteContent => topmost(content, ids).reduce((current, id) => removeBlock(current, id), content);

/** A copy of each right after it. Nothing is changed when one of them cannot be copied (the page or a container is full). */
export function duplicateBlocks(content: SiteContent, ids: readonly string[]): ManyOutcome {
  const tops = topmost(content, ids);
  if (tops.length === 0) return { ok: false, reason: "not-found" };
  let current = content;
  const made: string[] = [];
  for (const id of tops) {
    const outcome = duplicateBlock(current, id);
    if (!outcome.ok) return outcome;
    current = outcome.content;
    made.push(outcome.id);
  }
  return { ok: true, content: current, ids: made };
}

/**
 * A new container around the nodes, where the first of them stands, holding them in the order of the document. Only for nodes that are in the same
 * place (the page, or the same container); one node is wrapped where it is.
 */
export function wrapBlocks(content: SiteContent, ids: readonly string[]): Outcome {
  const tops = topmost(content, ids);
  if (tops.length === 0) return { ok: false, reason: "not-found" };
  if (tops.length === 1) return wrapBlock(content, tops[0]);
  const found = tops.map((id) => locate(content, id)!);
  const parentId = found[0].parentId;
  if (found.some((entry) => entry.parentId !== parentId)) return { ok: false, reason: "not-siblings" };
  const wrapper = { ...(emptyBlock("box") as BoxNode), children: found.map((entry) => entry.node) };
  if (allNodes(content.blocks).length + 1 > MAX_NODES) return { ok: false, reason: "limit-nodes" };
  const without = removeBlocks(content, tops);
  const refusal = placement(without, wrapper, parentId);
  if (refusal) return { ok: false, reason: refusal };
  const next = [...childrenOf(without, parentId)!];
  next.splice(found[0].index, 0, wrapper);
  const changed = withChildren(without, parentId, next);
  if (expandedCount(changed) > MAX_EXPANDED_NODES) return { ok: false, reason: "limit-expanded" };
  return { ok: true, content: changed, id: wrapper.id };
}

/** Changes each of the nodes with a function that gives the new one. */
export const updateBlocks = (content: SiteContent, ids: readonly string[], change: (entry: SiteNode) => SiteNode): SiteContent => ids.reduce((current, id) => updateBlock(current, id, change), content);

export type Direction = "up" | "down" | "left" | "right";
/**
 * The node the arrow keys go to from a node: up and down are the previous and the next in reading order (what a container holds comes
 * right after it), left is the container that holds it, right is its first child. Null when there is nowhere to go.
 */
export function navigate(content: SiteContent, id: string, direction: Direction): string | null {
  const order = allNodes(content.blocks);
  const at = order.findIndex((entry) => entry.id === id);
  if (at < 0) return null;
  if (direction === "up") return order[at - 1]?.id ?? null;
  if (direction === "down") return order[at + 1]?.id ?? null;
  if (direction === "left") return locate(content, id)?.parentId ?? null;
  const entry = order[at];
  return entry.type === "box" ? entry.children[0]?.id ?? null : null;
}

/** The nodes from `from` to `to` when they are in the same place (a shift-click on a list); otherwise only `to`. */
export function rangeBetween(content: SiteContent, from: string, to: string): string[] {
  const a = locate(content, from);
  const b = locate(content, to);
  if (!a || !b || a.parentId !== b.parentId) return b ? [to] : [];
  const list = childrenOf(content, a.parentId)!;
  const [low, high] = a.index <= b.index ? [a.index, b.index] : [b.index, a.index];
  return list.slice(low, high + 1).map((entry) => entry.id);
}
