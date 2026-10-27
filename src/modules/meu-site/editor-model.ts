import {
  COLUMN_TYPES,
  MAX_BLOCKS,
  MAX_COLUMN_ITEMS,
  MAX_NODES,
  allBlocks,
  emptyBlock,
  newBlockId,
  type Block,
  type BlockType,
  type ColumnItem,
  type SiteContent,
} from "./contracts";

/**
 * What the visual editor does to the document, as functions that take a document and give back another one
 * (or say why not). No React here: the rules of where each block may go, how many fit and what a duplicate
 * is live in one place and are tested without a screen. The screen only asks.
 */
export type Side = "left" | "right";
/** The page itself ("root") or one column of a "2 columns" block ("<id of the block>:left"). */
export type ContainerKey = "root" | `${string}:${Side}`;
export interface Slot {
  container: ContainerKey;
  /** Position among the elements of the container, counted before anything is taken out of it. */
  index: number;
}

export type Refusal = "not-found" | "not-accepted" | "limit-blocks" | "limit-column" | "limit-nodes";
export type Outcome = { ok: true; content: SiteContent; id: string } | { ok: false; reason: Refusal };

export const REFUSAL_MESSAGE: Record<Refusal, string> = {
  "not-found": "Esse bloco não existe mais.",
  "not-accepted": "Esse tipo de bloco só pode ficar na página. Dentro de uma coluna cabem título, parágrafo e botão.",
  "limit-blocks": `A página aceita até ${MAX_BLOCKS} blocos.`,
  "limit-column": `Cada coluna aceita até ${MAX_COLUMN_ITEMS} elementos.`,
  "limit-nodes": `O site aceita até ${MAX_NODES} blocos no total, contando os que estão dentro de colunas.`,
};

export const columnKey = (columnsId: string, side: Side): ContainerKey => `${columnsId}:${side}`;
export function parseKey(key: ContainerKey): { columnsId: string; side: Side } | null {
  if (key === "root") return null;
  const cut = key.lastIndexOf(":");
  const side = key.slice(cut + 1);
  return side === "left" || side === "right" ? { columnsId: key.slice(0, cut), side } : null;
}

/** Whether a block of this type may stand in the container. A section or a "2 columns" never goes inside a column. */
export function accepts(container: ContainerKey, type: BlockType): boolean {
  return container === "root" || (COLUMN_TYPES as readonly string[]).includes(type);
}

type Entry = Block | ColumnItem;

function listOf(content: SiteContent, key: ContainerKey): Entry[] | null {
  if (key === "root") return content.blocks;
  const parsed = parseKey(key);
  if (!parsed) return null;
  const owner = content.blocks.find((b) => b.id === parsed.columnsId);
  return owner?.type === "columns" ? owner[parsed.side] : null;
}

function withList(content: SiteContent, key: ContainerKey, list: Entry[]): SiteContent {
  if (key === "root") return { ...content, blocks: list as Block[] };
  const parsed = parseKey(key)!;
  return {
    ...content,
    blocks: content.blocks.map((b) => (b.id === parsed.columnsId && b.type === "columns" ? { ...b, [parsed.side]: list as ColumnItem[] } : b)),
  };
}

export interface Located {
  block: Entry;
  container: ContainerKey;
  index: number;
  /** How many elements the container has. */
  count: number;
}

export function locate(content: SiteContent, id: string): Located | null {
  for (const [index, b] of content.blocks.entries()) {
    if (b.id === id) return { block: b, container: "root", index, count: content.blocks.length };
    if (b.type === "columns") {
      for (const side of ["left", "right"] as const) {
        const at = b[side].findIndex((item) => item.id === id);
        if (at !== -1) return { block: b[side][at], container: columnKey(b.id, side), index: at, count: b[side].length };
      }
    }
  }
  return null;
}

const nodeCount = (content: SiteContent) => allBlocks(content.blocks).length;

/** Whether one more block fits in the container, by the limit of the container. (The total is checked apart.) */
function containerFull(key: ContainerKey, length: number): Refusal | null {
  if (key === "root") return length >= MAX_BLOCKS ? "limit-blocks" : null;
  return length >= MAX_COLUMN_ITEMS ? "limit-column" : null;
}

const clamp = (index: number, length: number) => Math.max(0, Math.min(index, length));

/** A new block of the type in the slot. */
export function insertBlock(content: SiteContent, type: BlockType, slot: Slot): Outcome {
  if (!accepts(slot.container, type)) return { ok: false, reason: "not-accepted" };
  const list = listOf(content, slot.container);
  if (!list) return { ok: false, reason: "not-found" };
  const full = containerFull(slot.container, list.length);
  if (full) return { ok: false, reason: full };
  if (nodeCount(content) + 1 > MAX_NODES) return { ok: false, reason: "limit-nodes" };
  const created = emptyBlock(type);
  const next = [...list];
  next.splice(clamp(slot.index, list.length), 0, created);
  return { ok: true, content: withList(content, slot.container, next), id: created.id };
}

/** Takes a block where it is and puts it in the slot, keeping everything it holds. Where it stood is not counted twice. */
export function moveBlock(content: SiteContent, id: string, slot: Slot): Outcome {
  const from = locate(content, id);
  if (!from) return { ok: false, reason: "not-found" };
  if (!accepts(slot.container, from.block.type)) return { ok: false, reason: "not-accepted" };
  const target = listOf(content, slot.container);
  if (!target) return { ok: false, reason: "not-found" };
  const index = clamp(slot.index, target.length);

  if (from.container === slot.container) {
    const destination = from.index < index ? index - 1 : index;
    if (destination === from.index) return { ok: true, content, id };
    const next = [...target];
    next.splice(from.index, 1);
    next.splice(destination, 0, from.block);
    return { ok: true, content: withList(content, slot.container, next), id };
  }

  const full = containerFull(slot.container, target.length);
  if (full) return { ok: false, reason: full };
  const origin = listOf(content, from.container)!;
  const without = withList(content, from.container, origin.filter((_, position) => position !== from.index));
  const into = [...listOf(without, slot.container)!];
  into.splice(index, 0, from.block);
  return { ok: true, content: withList(without, slot.container, into), id };
}

/** The same block with new identifiers (and so for the elements inside a "2 columns"). */
function cloneWithNewIds(entry: Entry): Entry {
  if (entry.type === "columns") {
    return { ...structuredClone(entry), id: newBlockId(), left: entry.left.map((item) => cloneWithNewIds(item) as ColumnItem), right: entry.right.map((item) => cloneWithNewIds(item) as ColumnItem) };
  }
  return { ...structuredClone(entry), id: newBlockId() };
}

/** A copy right after the block, with everything it holds. */
export function duplicateBlock(content: SiteContent, id: string): Outcome {
  const from = locate(content, id);
  if (!from) return { ok: false, reason: "not-found" };
  const list = listOf(content, from.container)!;
  const full = containerFull(from.container, list.length);
  if (full) return { ok: false, reason: full };
  const copy = cloneWithNewIds(from.block);
  const size = copy.type === "columns" ? 1 + copy.left.length + copy.right.length : 1;
  if (nodeCount(content) + size > MAX_NODES) return { ok: false, reason: "limit-nodes" };
  const next = [...list];
  next.splice(from.index + 1, 0, copy);
  return { ok: true, content: withList(content, from.container, next), id: copy.id };
}

/** Takes a block out, with what it holds. The same document when the block is not there. */
export function removeBlock(content: SiteContent, id: string): SiteContent {
  const from = locate(content, id);
  if (!from) return content;
  return withList(content, from.container, listOf(content, from.container)!.filter((_, position) => position !== from.index));
}

/** One place up or down inside the container. The same document at the edge. */
export function shiftBlock(content: SiteContent, id: string, by: -1 | 1): SiteContent {
  const from = locate(content, id);
  if (!from) return content;
  const to = from.index + by;
  if (to < 0 || to >= from.count) return content;
  const next = [...listOf(content, from.container)!];
  [next[from.index], next[to]] = [next[to], next[from.index]];
  return withList(content, from.container, next);
}

/** From one column to the other, at the end. The only way, without dragging, to cross from one column to the other. */
export function sendToOtherColumn(content: SiteContent, id: string): Outcome {
  const from = locate(content, id);
  const parsed = from ? parseKey(from.container) : null;
  if (!from || !parsed) return { ok: false, reason: "not-found" };
  const other = columnKey(parsed.columnsId, parsed.side === "left" ? "right" : "left");
  return moveBlock(content, id, { container: other, index: Number.MAX_SAFE_INTEGER });
}

/** Changes one block with a function that gives the new one. The same document when the block is not there. */
export function updateBlock(content: SiteContent, id: string, change: (block: Entry) => Entry): SiteContent {
  const from = locate(content, id);
  if (!from) return content;
  const list = listOf(content, from.container)!;
  return withList(content, from.container, list.map((entry, position) => (position === from.index ? change(entry) : entry)));
}

/** The container where a block of the type goes when it is added without being dragged: the end of the page. */
export const endOfPage = (content: SiteContent): Slot => ({ container: "root", index: content.blocks.length });

/**
 * A copy of a block (or any object) with the text at `path` replaced: "heading", "items.2.question".
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
