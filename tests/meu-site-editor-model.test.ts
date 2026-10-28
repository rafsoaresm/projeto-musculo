import { describe, expect, it } from "vitest";
import {
  MAX_BLOCKS,
  MAX_CHILDREN,
  MAX_DEPTH,
  MAX_NODES,
  allNodes,
  boxDepth,
  emptyBlock,
  siteContent,
  type BoxNode,
  type SiteContent,
  type SiteNode,
} from "@/modules/meu-site/contracts";
import {
  ancestorsOf,
  childrenOf,
  duplicateBlock,
  endOfPage,
  holds,
  insertBlock,
  insertNode,
  isInside,
  locate,
  moveBlock,
  moveIntoPrevious,
  moveOut,
  removeBlock,
  setIn,
  shiftBlock,
  unwrapBlock,
  updateBlock,
  wrapBlock,
  type Slot,
} from "@/modules/meu-site/editor-model";

const el = (type: "heading" | "paragraph" | "button" | "link" | "image", id: string, text = ""): SiteNode =>
  (type === "button" || type === "link" ? { ...emptyBlock(type, id), label: text } : { ...emptyBlock(type, id), text }) as SiteNode;
const page = (blocks: SiteNode[]): SiteContent => ({
  schemaVersion: 3,
  title: "Marina",
  description: "",
  contact: { whatsapp: "", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
});
const box = (id: string, children: SiteNode[]): BoxNode => ({ ...(emptyBlock("box", id) as BoxNode), children });
const ids = (content: SiteContent, parent: string | null = null) => (childrenOf(content, parent) ?? []).map((b) => b.id);
const everyId = (content: SiteContent) => allNodes(content.blocks).map((b) => b.id).sort();
const at = (parent: string | null, index: number): Slot => ({ parent, index });
/** A page with a highlight, a row of two columns and a call: hero, row[left[h1, p1], right[b1]], cta. */
const base = () =>
  page([emptyBlock("hero", "hero"), box("row", [box("left", [el("heading", "h1", "Título"), el("paragraph", "p1", "Texto")]), box("right", [el("button", "b1", "Falar")])]), emptyBlock("cta", "cta")]);
/** `levels` containers one inside the other (box1 holds box2...), the last one holding a paragraph "leaf". */
const nested = (levels: number): SiteNode => {
  let inner: SiteNode = el("paragraph", "leaf", "x");
  for (let level = levels; level >= 1; level--) inner = box(`box${level}`, [inner]);
  return inner;
};

/** Whatever was done, the document is still one the server accepts. */
const valid = (content: SiteContent) => expect(siteContent.safeParse(content).success).toBe(true);

describe("where a node may go", () => {
  it("lets only a container hold other nodes, and the page hold anything", () => {
    expect(holds("box")).toBe(true);
    for (const type of ["hero", "text", "services", "about", "quote", "stats", "faq", "cta", "heading", "paragraph", "button", "link", "image"] as const) expect(holds(type), type).toBe(false);
    for (const type of ["hero", "box", "heading", "services", "image", "link"] as const) expect(insertBlock(page([]), type, at(null, 0)).ok, type).toBe(true);
    for (const type of ["hero", "box", "heading", "services", "image", "link"] as const) expect(insertBlock(page([box("c", [])]), type, at("c", 0)).ok, `${type} in a container`).toBe(true);
  });
  it("finds a node anywhere, with its container, its place, how many share it and how many containers are above it", () => {
    const content = base();
    expect(locate(content, "hero")).toMatchObject({ parentId: null, index: 0, count: 3, depth: 0 });
    expect(locate(content, "row")).toMatchObject({ parentId: null, index: 1, count: 3, depth: 0 });
    expect(locate(content, "left")).toMatchObject({ parentId: "row", index: 0, count: 2, depth: 1 });
    expect(locate(content, "p1")).toMatchObject({ parentId: "left", index: 1, count: 2, depth: 2 });
    expect(locate(content, "b1")).toMatchObject({ parentId: "right", index: 0, count: 1, depth: 2 });
    expect(locate(content, "nope")).toBeNull();
  });
  it("tells the containers above a node, from the outermost, and whether a node is inside another", () => {
    const content = base();
    expect(ancestorsOf(content, "p1").map((b) => b.id)).toEqual(["row", "left"]);
    expect(ancestorsOf(content, "row")).toEqual([]);
    expect(ancestorsOf(content, "nope")).toEqual([]);
    expect(isInside(content, "p1", "row")).toBe(true);
    expect(isInside(content, "row", "row")).toBe(true);
    expect(isInside(content, "row", "p1")).toBe(false);
    expect(isInside(content, "hero", "row")).toBe(false);
    expect(childrenOf(content, null)).toBe(content.blocks);
    expect(ids(content, "left")).toEqual(["h1", "p1"]);
    expect(childrenOf(content, "hero")).toBeNull();
    expect(childrenOf(content, "nope")).toBeNull();
  });
});

describe("adding a node", () => {
  it("puts a new node of the type in the place, with its own identifier", () => {
    const result = insertBlock(base(), "faq", at(null, 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.content)).toEqual(["hero", result.id, "row", "cta"]);
    expect(result.content.blocks[1].type).toBe("faq");
    valid(result.content);
  });
  it("adds inside a container, at any depth, at the end however far the index is, and puts a ready node where it is told", () => {
    const content = base();
    const deep = insertBlock(content, "heading", at("left", 99));
    expect(deep.ok && ids(deep.content, "left")).toEqual(["h1", "p1", deep.ok ? deep.id : ""]);
    const first = insertBlock(content, "link", at("right", -5));
    expect(first.ok && ids(first.content, "right")[0]).toBe(first.ok ? first.id : "");
    // A negative index is the start of the list, not "counted from the end" as the array method would.
    const start = insertBlock(content, "link", at("left", -1));
    expect(start.ok && ids(start.content, "left")).toEqual([start.ok ? start.id : "", "h1", "p1"]);
    const ready = insertNode(content, box("mine", [el("paragraph", "inside", "x")]), at("left", 1));
    expect(ready.ok && ids(ready.content, "left")).toEqual(["h1", "mine", "p1"]);
    expect(ready.ok && ids(ready.content, "mine")).toEqual(["inside"]);
    if (ready.ok) valid(ready.content);
  });
  it("does not change the document it was given", () => {
    const content = base();
    const snapshot = JSON.stringify(content);
    insertBlock(content, "text", at("left", 0));
    moveBlock(content, "hero", at("right", 0));
    duplicateBlock(content, "row");
    wrapBlock(content, "hero");
    unwrapBlock(content, "left");
    expect(JSON.stringify(content)).toBe(snapshot);
  });
  it("refuses a container that does not exist, and one that is not a container", () => {
    expect(insertBlock(base(), "heading", at("gone", 0))).toEqual({ ok: false, reason: "not-found" });
    expect(insertBlock(base(), "heading", at("hero", 0))).toEqual({ ok: false, reason: "not-accepted" });
    expect(insertBlock(base(), "heading", at("h1", 0))).toEqual({ ok: false, reason: "not-accepted" });
  });
  it("stops at the limits of the page, of a container, of the whole document and of the depth", () => {
    const full = page(Array.from({ length: MAX_BLOCKS }, (_, i) => emptyBlock("text", `t${i}`)));
    expect(insertBlock(full, "text", endOfPage(full))).toEqual({ ok: false, reason: "limit-blocks" });
    const crowded = page([box("c", Array.from({ length: MAX_CHILDREN }, (_, i) => el("paragraph", `p${i}`))), box("d", [])]);
    expect(insertBlock(crowded, "heading", at("c", 0))).toEqual({ ok: false, reason: "limit-children" });
    expect(insertBlock(crowded, "heading", at("d", 0)).ok).toBe(true);
    // Four full containers (164 nodes) and an empty one: filling the empty one stops at the total, not at its own limit.
    const heavy = page([
      ...Array.from({ length: 4 }, (_, i) => box(`c${i}`, Array.from({ length: MAX_CHILDREN }, (_, j) => el("paragraph", `l${i}-${j}`)))),
      box("room", []),
    ]);
    expect(allNodes(heavy.blocks).length).toBe(165);
    let grown = heavy;
    for (let i = 0; i < MAX_CHILDREN; i++) {
      const next = insertBlock(grown, "text", at("room", 0));
      if (!next.ok) {
        expect(next.reason).toBe("limit-nodes");
        break;
      }
      grown = next.content;
    }
    expect(allNodes(grown.blocks).length).toBe(MAX_NODES);
    expect(ids(grown, "room").length).toBe(MAX_NODES - 165);
    valid(grown);
    // A ready node counts for all it holds.
    const near = page([
      ...Array.from({ length: 4 }, (_, i) => box(`n${i}`, Array.from({ length: MAX_CHILDREN }, (_, j) => el("paragraph", `n${i}-${j}`)))),
      box("g", Array.from({ length: 30 }, (_, j) => el("paragraph", `e${j}`))),
    ]);
    expect(allNodes(near.blocks).length).toBe(195);
    expect(insertNode(near, box("big", Array.from({ length: 5 }, (_, i) => el("paragraph", `i${i}`))), at(null, 0))).toEqual({ ok: false, reason: "limit-nodes" });
    expect(insertNode(near, box("ok", Array.from({ length: 4 }, (_, i) => el("paragraph", `i${i}`))), at(null, 0)).ok).toBe(true);
    // The depth: a container can go in until the line of containers reaches the limit.
    const deepest = page([nested(MAX_DEPTH)]);
    expect(boxDepth(deepest.blocks)).toBe(MAX_DEPTH);
    expect(insertBlock(deepest, "box", at(`box${MAX_DEPTH}`, 0))).toEqual({ ok: false, reason: "limit-depth" });
    expect(insertBlock(deepest, "heading", at(`box${MAX_DEPTH}`, 0)).ok).toBe(true);
    expect(insertNode(page([nested(MAX_DEPTH - 1)]), box("two", [box("three", [])]), at(`box${MAX_DEPTH - 1}`, 0))).toEqual({ ok: false, reason: "limit-depth" });
    expect(insertNode(page([nested(MAX_DEPTH - 2)]), box("two", [box("three", [])]), at(`box${MAX_DEPTH - 2}`, 0)).ok).toBe(true);
    expect(insertNode(page([]), nested(MAX_DEPTH + 1), at(null, 0))).toEqual({ ok: false, reason: "limit-depth" });
  });
});

describe("moving a node", () => {
  it("moves on the page keeping what the node holds, with the index counted before it leaves", () => {
    const content = base();
    const down = moveBlock(content, "hero", at(null, 2));
    expect(down.ok && ids(down.content)).toEqual(["row", "hero", "cta"]);
    const toEnd = moveBlock(content, "hero", at(null, 3));
    expect(toEnd.ok && ids(toEnd.content)).toEqual(["row", "cta", "hero"]);
    const up = moveBlock(content, "cta", at(null, 0));
    expect(up.ok && ids(up.content)).toEqual(["cta", "hero", "row"]);
    const moved = moveBlock(content, "row", at(null, 0));
    expect(moved.ok && ids(moved.content, "left")).toEqual(["h1", "p1"]);
  });
  it("is no change at all when the node is dropped where it already is", () => {
    const content = base();
    for (const index of [0, 1]) {
      const same = moveBlock(content, "hero", at(null, index));
      expect(same.ok && same.content).toBe(content);
    }
    const inside = moveBlock(content, "p1", at("left", 2));
    expect(inside.ok && inside.content).toBe(content);
  });
  it("takes a node into a container at any depth, out of it, and between containers, whatever the depth", () => {
    const content = page([...base().blocks, el("heading", "loose", "Solto")]);
    const into = moveBlock(content, "loose", at("right", 0));
    expect(into.ok && ids(into.content, "right")).toEqual(["loose", "b1"]);
    expect(into.ok && ids(into.content)).toEqual(["hero", "row", "cta"]);
    if (into.ok) valid(into.content);
    const out = moveBlock(content, "p1", at(null, 0));
    expect(out.ok && ids(out.content)).toEqual(["p1", "hero", "row", "cta", "loose"]);
    expect(out.ok && ids(out.content, "left")).toEqual(["h1"]);
    const across = moveBlock(content, "h1", at("right", 1));
    expect(across.ok && ids(across.content, "right")).toEqual(["b1", "h1"]);
    const sections = moveBlock(content, "hero", at("left", 1));
    expect(sections.ok && ids(sections.content, "left")).toEqual(["h1", "hero", "p1"]);
    const container = moveBlock(content, "left", at("right", 0));
    expect(container.ok && ids(container.content, "right")).toEqual(["left", "b1"]);
    expect(container.ok && ids(container.content, "left")).toEqual(["h1", "p1"]);
    if (container.ok) valid(container.content);
  });
  it("refuses to put a container inside itself or inside what it holds, leaving the document as it was", () => {
    const content = base();
    expect(moveBlock(content, "row", at("row", 0))).toEqual({ ok: false, reason: "cycle" });
    expect(moveBlock(content, "row", at("left", 0))).toEqual({ ok: false, reason: "cycle" });
    expect(moveBlock(content, "left", at("left", 0))).toEqual({ ok: false, reason: "cycle" });
    expect(moveBlock(content, "ghost", at(null, 0))).toEqual({ ok: false, reason: "not-found" });
    expect(moveBlock(content, "h1", at("ghost", 0))).toEqual({ ok: false, reason: "not-found" });
    expect(moveBlock(content, "h1", at("hero", 0))).toEqual({ ok: false, reason: "not-accepted" });
  });
  it("refuses to fill a container past its limit by moving, but lets a node move inside a full one", () => {
    const left = Array.from({ length: MAX_CHILDREN }, (_, i) => el("paragraph", `p${i}`));
    const content = page([box("c", left), box("d", [el("heading", "h")]), el("heading", "loose")]);
    expect(moveBlock(content, "loose", at("c", 0))).toEqual({ ok: false, reason: "limit-children" });
    expect(moveBlock(content, "h", at("c", 0))).toEqual({ ok: false, reason: "limit-children" });
    const inside = moveBlock(content, "p0", at("c", MAX_CHILDREN));
    expect(inside.ok && ids(inside.content, "c").slice(-2)).toEqual([`p${MAX_CHILDREN - 1}`, "p0"]);
    // The page's own limit holds for what leaves a container for the page.
    const withInner = page([...Array.from({ length: MAX_BLOCKS - 1 }, (_, i) => emptyBlock("text", `t${i}`)), box("c", [el("heading", "x")])]);
    expect(moveBlock(withInner, "x", at(null, 0))).toEqual({ ok: false, reason: "limit-blocks" });
  });
  it("refuses to push what is moved past the depth limit, and counts the boxes it carries", () => {
    const content = page([nested(MAX_DEPTH - 1), box("carried", [box("inner", [el("paragraph", "z")])])]);
    expect(moveBlock(content, "carried", at(`box${MAX_DEPTH - 1}`, 0))).toEqual({ ok: false, reason: "limit-depth" });
    expect(moveBlock(content, "z", at(`box${MAX_DEPTH - 1}`, 0)).ok).toBe(true);
    const shallow = page([nested(MAX_DEPTH - 2), box("carried", [box("inner", [])])]);
    expect(moveBlock(shallow, "carried", at(`box${MAX_DEPTH - 2}`, 0)).ok).toBe(true);
  });
  it("never loses or repeats a node: after any move the same nodes are there, once each, and the document is valid", () => {
    const content = base();
    const before = everyId(content);
    const moves: [string, Slot][] = [
      ["hero", at("left", 0)],
      ["h1", at(null, 3)],
      ["b1", at("left", 1)],
      ["cta", at(null, 0)],
      ["row", at(null, 99)],
      ["left", at("right", 0)],
      ["right", at("left", 0)],
      ["row", at("right", 0)],
      ["p1", at("row", 0)],
    ];
    let current = content;
    let refused = 0;
    for (const [id, slot] of moves) {
      const result = moveBlock(current, id, slot);
      if (result.ok) current = result.content;
      else refused++;
      expect(everyId(current)).toEqual(before);
      valid(current);
    }
    expect(refused).toBeGreaterThan(0);
  });
});

describe("duplicating, removing and ordering", () => {
  it("duplicates right after the node with new identifiers, also for what is inside a container, at any depth", () => {
    const content = base();
    const result = duplicateBlock(content, "row");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.content).length).toBe(4);
    expect(ids(result.content)[2]).toBe(result.id);
    const copy = locate(result.content, result.id)!.node as BoxNode;
    const originalIds = new Set(allNodes([locate(content, "row")!.node]).map((n) => n.id));
    const copyIds = allNodes([copy]).map((n) => n.id);
    expect(copyIds).toHaveLength(originalIds.size);
    for (const id of copyIds) expect(originalIds.has(id)).toBe(false);
    expect(new Set(everyId(result.content)).size).toBe(allNodes(result.content.blocks).length);
    expect(allNodes([copy]).map((n) => n.type)).toEqual(allNodes([locate(content, "row")!.node]).map((n) => n.type));
    valid(result.content);
    const inner = duplicateBlock(content, "p1");
    expect(inner.ok && ids(inner.content, "left")).toEqual(["h1", "p1", inner.ok ? inner.id : ""]);
  });
  it("keeps the style and the name of what it copies, and does not share them with the original", () => {
    const styled = { ...(emptyBlock("box", "c") as BoxNode), name: "Topo", style: { display: "flex" as const, gap: "8px" } };
    const content = page([styled]);
    const result = duplicateBlock(content, "c");
    if (!result.ok) throw new Error("refused");
    const copy = locate(result.content, result.id)!.node as BoxNode;
    expect(copy.name).toBe("Topo");
    expect(copy.style).toEqual({ display: "flex", gap: "8px" });
    expect(copy.style).not.toBe(styled.style);
  });
  it("refuses to duplicate when the container or the document is full, counting what the copy brings", () => {
    const crowded = page([box("c", Array.from({ length: MAX_CHILDREN }, (_, i) => el("paragraph", `p${i}`)))]);
    expect(duplicateBlock(crowded, "p0")).toEqual({ ok: false, reason: "limit-children" });
    const near = page([
      ...Array.from({ length: 4 }, (_, i) => box(`n${i}`, Array.from({ length: MAX_CHILDREN }, (_, j) => el("paragraph", `n${i}-${j}`)))),
      box("g", Array.from({ length: 30 }, (_, j) => el("paragraph", `e${j}`))),
    ]);
    expect(allNodes(near.blocks).length).toBe(195);
    expect(duplicateBlock(near, "g")).toEqual({ ok: false, reason: "limit-nodes" });
    expect(duplicateBlock(near, "e0").ok).toBe(true);
  });
  it("removes a node with what it holds, and leaves the document alone when it is not there", () => {
    const content = base();
    const gone = removeBlock(content, "left");
    expect(everyId(gone)).toEqual(["b1", "cta", "hero", "right", "row"]);
    expect(removeBlock(content, "p1")).not.toBe(content);
    expect(ids(removeBlock(content, "p1"), "left")).toEqual(["h1"]);
    expect(removeBlock(content, "ghost")).toBe(content);
    valid(gone);
  });
  it("moves one place up or down in its own container and does nothing at the edge", () => {
    const content = base();
    expect(ids(shiftBlock(content, "hero", 1))).toEqual(["row", "hero", "cta"]);
    expect(shiftBlock(content, "hero", -1)).toBe(content);
    expect(shiftBlock(content, "cta", 1)).toBe(content);
    expect(ids(shiftBlock(content, "p1", -1), "left")).toEqual(["p1", "h1"]);
    expect(shiftBlock(content, "ghost", 1)).toBe(content);
  });
  it("climbs a level (to just after its container) and goes down one (into the container before it)", () => {
    const content = base();
    const up = moveOut(content, "p1");
    expect(up.ok && ids(up.content, "row")).toEqual(["left", "p1", "right"]);
    expect(moveOut(content, "hero")).toEqual({ ok: false, reason: "not-found" });
    const outFromRow = moveOut(content, "left");
    expect(outFromRow.ok && ids(outFromRow.content)).toEqual(["hero", "row", "left", "cta"]);
    const down = moveIntoPrevious(content, "cta");
    expect(down.ok && ids(down.content, "row")).toEqual(["left", "right", "cta"]);
    expect(moveIntoPrevious(content, "row")).toEqual({ ok: false, reason: "not-accepted" });
    const onto = moveIntoPrevious(content, "right");
    expect(onto.ok && ids(onto.content, "left")).toEqual(["h1", "p1", "right"]);
    expect(moveIntoPrevious(content, "hero")).toEqual({ ok: false, reason: "not-found" });
    const nextToRow = page([box("c", []), el("paragraph", "p", "x")]);
    const intoBox = moveIntoPrevious(nextToRow, "p");
    expect(intoBox.ok && ids(intoBox.content, "c")).toEqual(["p"]);
  });
  it("puts a container around a node where it stands, and takes a container away leaving what it held", () => {
    const content = base();
    const wrapped = wrapBlock(content, "p1");
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    expect(ids(wrapped.content, "left")).toEqual(["h1", wrapped.id]);
    expect(ids(wrapped.content, wrapped.id)).toEqual(["p1"]);
    expect(locate(wrapped.content, wrapped.id)!.node.type).toBe("box");
    valid(wrapped.content);
    const back = unwrapBlock(wrapped.content, wrapped.id);
    expect(back.ok && ids(back.content, "left")).toEqual(["h1", "p1"]);
    expect(back.ok && back.id).toBe("p1");
    const onPage = wrapBlock(content, "hero");
    expect(onPage.ok && ids(onPage.content)).toEqual([onPage.ok ? onPage.id : "", "row", "cta"]);
    const flat = unwrapBlock(content, "row");
    expect(flat.ok && ids(flat.content)).toEqual(["hero", "left", "right", "cta"]);
    expect(unwrapBlock(content, "hero")).toEqual({ ok: false, reason: "not-found" });
    expect(wrapBlock(content, "ghost")).toEqual({ ok: false, reason: "not-found" });
    const empty = unwrapBlock(page([box("c", []), emptyBlock("hero", "h")]), "c");
    expect(empty.ok && ids(empty.content)).toEqual(["h"]);
  });
  it("does not wrap past the depth, the total or the page's limit, and does not unwrap past the container's limit", () => {
    expect(wrapBlock(page([nested(MAX_DEPTH)]), "box1")).toEqual({ ok: false, reason: "limit-depth" });
    expect(wrapBlock(page([nested(MAX_DEPTH)]), "leaf")).toEqual({ ok: false, reason: "limit-depth" });
    expect(wrapBlock(page([nested(MAX_DEPTH - 1)]), "leaf").ok).toBe(true);
    // Wrapping replaces the node in its place, so a page at its limit can still wrap one of its blocks.
    const tight = page(Array.from({ length: MAX_BLOCKS }, (_, i) => emptyBlock("text", `t${i}`)));
    expect(wrapBlock(tight, "t0").ok).toBe(true);
    const crowded = page([box("outer", [box("inner", Array.from({ length: 3 }, (_, i) => el("paragraph", `i${i}`))), ...Array.from({ length: MAX_CHILDREN - 1 }, (_, i) => el("paragraph", `o${i}`))])]);
    expect(unwrapBlock(crowded, "inner")).toEqual({ ok: false, reason: "limit-children" });
    const fullPage = page([box("inner", [el("paragraph", "a"), el("paragraph", "b")]), ...Array.from({ length: MAX_BLOCKS - 1 }, (_, i) => emptyBlock("text", `t${i}`))]);
    expect(unwrapBlock(fullPage, "inner")).toEqual({ ok: false, reason: "limit-blocks" });
  });
});

describe("changing a field", () => {
  it("replaces the text at a path in a copy, down into the rows of a list", () => {
    const faq = { ...emptyBlock("faq", "f"), items: [{ question: "a", answer: "b" }, { question: "c", answer: "d" }] } as SiteNode;
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
  it("updates one node, wherever it is in the tree, and keeps the rest as it was", () => {
    const content = base();
    const changed = updateBlock(content, "p1", (entry) => ({ ...entry, text: "Novo texto" }) as SiteNode);
    expect(locate(changed, "p1")?.node).toMatchObject({ text: "Novo texto" });
    expect(locate(changed, "h1")?.node).toBe(locate(content, "h1")?.node);
    expect(locate(changed, "right")?.node).toBe(locate(content, "right")?.node);
    expect(updateBlock(content, "ghost", (b) => b)).toBe(content);
    valid(changed);
    const renamed = updateBlock(content, "left", (entry) => ({ ...entry, name: "Coluna 1" }));
    expect(locate(renamed, "left")?.node).toMatchObject({ name: "Coluna 1" });
    expect(ids(renamed, "left")).toEqual(["h1", "p1"]);
  });
});
