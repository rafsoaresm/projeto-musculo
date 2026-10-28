import { describe, expect, it } from "vitest";
import {
  MAX_BLOCKS,
  MAX_COLUMN_ITEMS,
  MAX_NODES,
  allBlocks,
  emptyBlock,
  siteContent,
  type Block,
  type ColumnItem,
  type SiteContent,
} from "@/modules/meu-site/contracts";
import {
  accepts,
  columnKey,
  duplicateBlock,
  endOfPage,
  insertBlock,
  locate,
  moveBlock,
  parseKey,
  removeBlock,
  sendToOtherColumn,
  setIn,
  shiftBlock,
  updateBlock,
} from "@/modules/meu-site/editor-model";

const el = (type: ColumnItem["type"], id: string, text = ""): ColumnItem =>
  (type === "button" ? { ...emptyBlock("button", id), label: text } : { ...emptyBlock(type, id), text }) as ColumnItem;
const page = (blocks: Block[]): SiteContent => ({
  schemaVersion: 2,
  title: "Marina",
  description: "",
  contact: { whatsapp: "", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light" },
  blocks,
});
const ids = (content: SiteContent) => content.blocks.map((b) => b.id);
const columns = (id: string, left: ColumnItem[], right: ColumnItem[]): Block => ({ ...emptyBlock("columns", id), left, right }) as Block;
const base = () =>
  page([emptyBlock("hero", "hero"), columns("cols", [el("heading", "h1", "Título"), el("paragraph", "p1", "Texto")], [el("button", "b1", "Falar")]), emptyBlock("cta", "cta")]);

/** Whatever was done, the document is still one the server accepts. */
const valid = (content: SiteContent) => expect(siteContent.safeParse(content).success).toBe(true);

describe("where a block may go", () => {
  it("accepts anything on the page, and only title, paragraph and button in a column", () => {
    for (const type of ["hero", "text", "services", "about", "quote", "stats", "faq", "cta", "columns", "heading", "paragraph", "button", "image"] as const)
      expect(accepts("root", type), type).toBe(true);
    for (const type of ["heading", "paragraph", "button", "image"] as const) expect(accepts(columnKey("x", "left"), type), type).toBe(true);
    for (const type of ["hero", "text", "services", "about", "quote", "stats", "faq", "cta", "columns"] as const)
      expect(accepts(columnKey("x", "right"), type), type).toBe(false);
  });
  it("names a column by its block and its side, and reads the name back", () => {
    expect(parseKey(columnKey("abc-1", "right"))).toEqual({ columnsId: "abc-1", side: "right" });
    expect(parseKey("root")).toBeNull();
    expect(parseKey("abc:middle" as never)).toBeNull();
  });
  it("finds a block anywhere, with its container, its place and how many share it", () => {
    const content = base();
    expect(locate(content, "hero")).toMatchObject({ container: "root", index: 0, count: 3 });
    expect(locate(content, "p1")).toMatchObject({ container: "cols:left", index: 1, count: 2 });
    expect(locate(content, "b1")).toMatchObject({ container: "cols:right", index: 0, count: 1 });
    expect(locate(content, "nope")).toBeNull();
  });
});

describe("adding a block", () => {
  it("puts a new block of the type in the place, with its own identifier", () => {
    const result = insertBlock(base(), "faq", { container: "root", index: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.content).slice(0, 1)).toEqual(["hero"]);
    expect(result.content.blocks[1].type).toBe("faq");
    expect(result.content.blocks[1].id).toBe(result.id);
    expect(result.content.blocks).toHaveLength(4);
    valid(result.content);
  });
  it("adds at the end of the page, or at the end of a column, however far the index is", () => {
    const content = base();
    const end = insertBlock(content, "text", endOfPage(content));
    expect(end.ok && end.content.blocks.at(-1)?.type).toBe("text");
    const inColumn = insertBlock(content, "paragraph", { container: columnKey("cols", "right"), index: Number.MAX_SAFE_INTEGER });
    expect(inColumn.ok && (inColumn.content.blocks[1] as { right: ColumnItem[] }).right.map((i) => i.type)).toEqual(["button", "paragraph"]);
    const before = insertBlock(content, "text", { container: "root", index: -1 });
    expect(before.ok && before.content.blocks[0].type).toBe("text");
  });
  it("does not change the document it was given", () => {
    const content = base();
    const snapshot = JSON.stringify(content);
    insertBlock(content, "faq", { container: "root", index: 0 });
    moveBlock(content, "p1", { container: "root", index: 0 });
    duplicateBlock(content, "cols");
    removeBlock(content, "h1");
    shiftBlock(content, "hero", 1);
    updateBlock(content, "hero", (b) => ({ ...b }));
    expect(JSON.stringify(content)).toBe(snapshot);
  });
  it("refuses a section or a \"2 columns\" in a column, and a column that does not exist", () => {
    expect(insertBlock(base(), "hero", { container: columnKey("cols", "left"), index: 0 })).toEqual({ ok: false, reason: "not-accepted" });
    expect(insertBlock(base(), "columns", { container: columnKey("cols", "left"), index: 0 })).toEqual({ ok: false, reason: "not-accepted" });
    expect(insertBlock(base(), "heading", { container: columnKey("gone", "left"), index: 0 })).toEqual({ ok: false, reason: "not-found" });
    expect(insertBlock(base(), "heading", { container: columnKey("hero", "left"), index: 0 })).toEqual({ ok: false, reason: "not-found" });
  });
  it("stops at the limits of the page, of a column and of the whole document", () => {
    const full = page(Array.from({ length: MAX_BLOCKS }, (_, i) => emptyBlock("text", `t${i}`)));
    expect(insertBlock(full, "text", endOfPage(full))).toEqual({ ok: false, reason: "limit-blocks" });
    const crowded = page([columns("c", Array.from({ length: MAX_COLUMN_ITEMS }, (_, i) => el("paragraph", `p${i}`)), [])]);
    expect(insertBlock(crowded, "heading", { container: columnKey("c", "left"), index: 0 })).toEqual({ ok: false, reason: "limit-column" });
    expect(insertBlock(crowded, "heading", { container: columnKey("c", "right"), index: 0 }).ok).toBe(true);
    // 4 blocks with 6 + 6 elements are 52 in all; one more block fits, and then the total stops the next ones.
    const heavy = page(Array.from({ length: 4 }, (_, i) => columns(`c${i}`, Array.from({ length: 6 }, (_, j) => el("paragraph", `l${i}-${j}`)), Array.from({ length: 6 }, (_, j) => el("paragraph", `r${i}-${j}`)))));
    expect(allBlocks(heavy.blocks).length).toBeLessThan(MAX_NODES);
    let grown = heavy;
    for (let i = 0; i < MAX_NODES; i++) {
      const next = insertBlock(grown, "text", endOfPage(grown));
      if (!next.ok) {
        expect(next.reason).toBe("limit-nodes");
        break;
      }
      grown = next.content;
    }
    expect(allBlocks(grown.blocks).length).toBe(MAX_NODES);
    valid(grown);
  });
});

describe("moving a block", () => {
  it("moves on the page keeping what the block holds, with the index counted before it leaves", () => {
    const content = base();
    const down = moveBlock(content, "hero", { container: "root", index: 2 });
    expect(down.ok && ids(down.content)).toEqual(["cols", "hero", "cta"]);
    const toEnd = moveBlock(content, "hero", { container: "root", index: 3 });
    expect(toEnd.ok && ids(toEnd.content)).toEqual(["cols", "cta", "hero"]);
    const up = moveBlock(content, "cta", { container: "root", index: 0 });
    expect(up.ok && ids(up.content)).toEqual(["cta", "hero", "cols"]);
    const columnsMoved = moveBlock(content, "cols", { container: "root", index: 0 });
    expect(columnsMoved.ok && (columnsMoved.content.blocks[0] as { left: ColumnItem[] }).left.map((i) => i.id)).toEqual(["h1", "p1"]);
  });
  it("is no change at all when the block is dropped where it already is", () => {
    const content = base();
    for (const index of [0, 1]) {
      const same = moveBlock(content, "hero", { container: "root", index });
      expect(same.ok && same.content).toBe(content);
    }
  });
  it("takes an element from the page into a column, from a column to the page, and between columns", () => {
    const content = page([...base().blocks, el("heading", "loose", "Solto")]);
    const into = moveBlock(content, "loose", { container: columnKey("cols", "right"), index: 0 });
    expect(into.ok && (into.content.blocks[1] as { right: ColumnItem[] }).right.map((i) => i.id)).toEqual(["loose", "b1"]);
    expect(into.ok && ids(into.content)).toEqual(["hero", "cols", "cta"]);
    if (into.ok) valid(into.content);
    const out = moveBlock(content, "p1", { container: "root", index: 0 });
    expect(out.ok && ids(out.content)).toEqual(["p1", "hero", "cols", "cta", "loose"]);
    expect(out.ok && (out.content.blocks[1 + 1] as { left: ColumnItem[] }).left.map((i) => i.id)).toEqual(["h1"]);
    const across = moveBlock(content, "h1", { container: columnKey("cols", "right"), index: 1 });
    expect(across.ok && (across.content.blocks[1] as { left: ColumnItem[]; right: ColumnItem[] }).right.map((i) => i.id)).toEqual(["b1", "h1"]);
  });
  it("refuses a section in a column and a \"2 columns\" in itself or in the other one, leaving the document as it was", () => {
    const content = base();
    expect(moveBlock(content, "hero", { container: columnKey("cols", "left"), index: 0 })).toEqual({ ok: false, reason: "not-accepted" });
    expect(moveBlock(content, "cols", { container: columnKey("cols", "left"), index: 0 })).toEqual({ ok: false, reason: "not-accepted" });
    const two = page([columns("a", [el("heading", "x")], []), columns("b", [], [])]);
    expect(moveBlock(two, "a", { container: columnKey("b", "left"), index: 0 })).toEqual({ ok: false, reason: "not-accepted" });
    expect(moveBlock(content, "ghost", { container: "root", index: 0 })).toEqual({ ok: false, reason: "not-found" });
    expect(moveBlock(content, "h1", { container: columnKey("ghost", "left"), index: 0 })).toEqual({ ok: false, reason: "not-found" });
  });
  it("refuses to fill a column past its limit by moving, but lets a block move inside a full column", () => {
    const left = Array.from({ length: MAX_COLUMN_ITEMS }, (_, i) => el("paragraph", `p${i}`));
    const content = page([columns("c", left, [el("heading", "h")]), el("heading", "loose")]);
    expect(moveBlock(content, "loose", { container: columnKey("c", "left"), index: 0 })).toEqual({ ok: false, reason: "limit-column" });
    expect(moveBlock(content, "h", { container: columnKey("c", "left"), index: 0 })).toEqual({ ok: false, reason: "limit-column" });
    const inside = moveBlock(content, "p0", { container: columnKey("c", "left"), index: MAX_COLUMN_ITEMS });
    expect(inside.ok && (inside.content.blocks[0] as { left: ColumnItem[] }).left.map((i) => i.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p0"]);
  });
  it("never loses or repeats a block: after any move the same blocks are there, once each, and the document is valid", () => {
    const content = base();
    const before = allBlocks(content.blocks).map((b) => b.id).sort();
    const moves: [string, Parameters<typeof moveBlock>[2]][] = [
      ["hero", { container: columnKey("cols", "left"), index: 0 }],
      ["h1", { container: "root", index: 3 }],
      ["b1", { container: columnKey("cols", "left"), index: 1 }],
      ["cta", { container: "root", index: 0 }],
      ["cols", { container: "root", index: 99 }],
    ];
    let current = content;
    for (const [id, slot] of moves) {
      const result = moveBlock(current, id, slot);
      if (result.ok) current = result.content;
      expect(allBlocks(current.blocks).map((b) => b.id).sort()).toEqual(before);
      valid(current);
    }
  });
});

describe("duplicating, removing and ordering", () => {
  it("duplicates right after the block with new identifiers, also for what is inside a \"2 columns\"", () => {
    const content = base();
    const result = duplicateBlock(content, "cols");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.blocks).toHaveLength(4);
    const copy = result.content.blocks[2] as Extract<Block, { type: "columns" }>;
    expect(copy.id).toBe(result.id);
    expect(copy.id).not.toBe("cols");
    expect(copy.left.map((i) => i.type)).toEqual(["heading", "paragraph"]);
    expect(copy.left.map((i) => i.id)).not.toContain("h1");
    expect(new Set(allBlocks(result.content.blocks).map((b) => b.id)).size).toBe(allBlocks(result.content.blocks).length);
    expect((copy.left[0] as { text: string }).text).toBe("Título");
    valid(result.content);
  });
  it("duplicates an element inside its column, and refuses when the column or the document is full", () => {
    const result = duplicateBlock(base(), "h1");
    expect(result.ok && (result.content.blocks[1] as { left: ColumnItem[] }).left.map((i) => i.type)).toEqual(["heading", "heading", "paragraph"]);
    const crowded = page([columns("c", Array.from({ length: MAX_COLUMN_ITEMS }, (_, i) => el("paragraph", `p${i}`)), [])]);
    expect(duplicateBlock(crowded, "p0")).toEqual({ ok: false, reason: "limit-column" });
    const full = page(Array.from({ length: MAX_BLOCKS }, (_, i) => emptyBlock("text", `t${i}`)));
    expect(duplicateBlock(full, "t0")).toEqual({ ok: false, reason: "limit-blocks" });
    expect(duplicateBlock(base(), "ghost")).toEqual({ ok: false, reason: "not-found" });
  });
  it("counts what a duplicated \"2 columns\" brings against the total", () => {
    const six = (prefix: string) => Array.from({ length: 6 }, (_, i) => el("paragraph", `${prefix}${i}`));
    const content = page([columns("a", six("a"), six("b")), columns("b", six("c"), six("d")), columns("c", six("e"), six("f")), columns("d", six("g"), six("h"))]);
    expect(allBlocks(content.blocks).length).toBe(52);
    expect(duplicateBlock(content, "a")).toEqual({ ok: false, reason: "limit-nodes" });
  });
  it("removes a block with what it holds, and leaves the document alone when it is not there", () => {
    const content = base();
    const without = removeBlock(content, "cols");
    expect(ids(without)).toEqual(["hero", "cta"]);
    expect(allBlocks(without.blocks).map((b) => b.id)).not.toContain("h1");
    expect(ids(removeBlock(content, "h1"))).toEqual(["hero", "cols", "cta"]);
    expect((removeBlock(content, "h1").blocks[1] as { left: ColumnItem[] }).left.map((i) => i.id)).toEqual(["p1"]);
    expect(removeBlock(content, "ghost")).toBe(content);
  });
  it("moves one place up or down in its own container and does nothing at the edge", () => {
    const content = base();
    expect(ids(shiftBlock(content, "hero", 1))).toEqual(["cols", "hero", "cta"]);
    expect(ids(shiftBlock(content, "cta", -1))).toEqual(["hero", "cta", "cols"]);
    expect(shiftBlock(content, "hero", -1)).toBe(content);
    expect(shiftBlock(content, "cta", 1)).toBe(content);
    expect((shiftBlock(content, "p1", -1).blocks[1] as { left: ColumnItem[] }).left.map((i) => i.id)).toEqual(["p1", "h1"]);
    expect(shiftBlock(content, "b1", 1)).toBe(content);
    expect(shiftBlock(content, "ghost", 1)).toBe(content);
  });
  it("sends an element to the end of the other column, and only an element of a column", () => {
    const content = base();
    const sent = sendToOtherColumn(content, "h1");
    const cols = sent.ok && (sent.content.blocks[1] as { left: ColumnItem[]; right: ColumnItem[] });
    expect(cols && cols.left.map((i) => i.id)).toEqual(["p1"]);
    expect(cols && cols.right.map((i) => i.id)).toEqual(["b1", "h1"]);
    const back = sent.ok ? sendToOtherColumn(sent.content, "h1") : sent;
    expect(back.ok && (back.content.blocks[1] as { left: ColumnItem[] }).left.map((i) => i.id)).toEqual(["p1", "h1"]);
    expect(sendToOtherColumn(content, "hero")).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("changing a field", () => {
  it("replaces the text at a path in a copy, down into the rows of a list", () => {
    const faq = { ...emptyBlock("faq", "f"), items: [{ question: "a", answer: "b" }, { question: "c", answer: "d" }] } as Block;
    const changed = setIn(faq, "items.1.answer", "novo");
    expect((changed as { items: { answer: string }[] }).items[1].answer).toBe("novo");
    expect((faq as { items: { answer: string }[] }).items[1].answer).toBe("d");
    expect((setIn(faq, "heading", "Título") as { heading: string }).heading).toBe("Título");
  });
  it("changes nothing for a path that is not there, such as a row that was just removed", () => {
    const faq = emptyBlock("faq", "f");
    expect(setIn(faq, "items.7.answer", "x")).toEqual(faq);
    expect(setIn(faq, "nothing.here", "x")).toEqual(faq);
    expect(setIn(faq, "items.-1.answer", "x")).toEqual(faq);
  });
  it("updates one block, wherever it is, and keeps the rest", () => {
    const content = base();
    const changed = updateBlock(content, "p1", (entry) => ({ ...entry, text: "Novo texto" }) as ColumnItem);
    expect(locate(changed, "p1")?.block).toMatchObject({ text: "Novo texto" });
    expect(locate(changed, "h1")?.block).toBe(locate(content, "h1")?.block);
    expect(updateBlock(content, "ghost", (b) => b)).toBe(content);
    valid(changed);
  });
});
