import { describe, expect, it } from "vitest";
import { MAX_CHILDREN, MAX_DEPTH, MAX_NODES, allNodes, emptyBlock, siteContent, type BoxNode, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import {
  childrenOf,
  duplicateBlocks,
  inDocumentOrder,
  locate,
  navigate,
  rangeBetween,
  removeBlocks,
  topmost,
  updateBlocks,
  wrapBlocks,
} from "@/modules/meu-site/editor-model";

const el = (type: "heading" | "paragraph", id: string, text = ""): SiteNode => ({ ...emptyBlock(type, id), text }) as SiteNode;
const box = (id: string, children: SiteNode[]): BoxNode => ({ ...(emptyBlock("box", id) as BoxNode), children });
const page = (blocks: SiteNode[]): SiteContent => ({
  schemaVersion: 3,
  title: "Marina",
  description: "",
  contact: { whatsapp: "", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
});
const ids = (content: SiteContent, parent: string | null = null) => (childrenOf(content, parent) ?? []).map((entry) => entry.id);
/** hero, row[left[h1, p1], right[b1]], cta, more. */
const base = () =>
  page([
    emptyBlock("hero", "hero"),
    box("row", [box("left", [el("heading", "h1", "Título"), el("paragraph", "p1", "Texto")]), box("right", [el("paragraph", "b1", "Botão")])]),
    emptyBlock("cta", "cta"),
    el("paragraph", "more", "Mais"),
  ]);
const valid = (content: SiteContent) => expect(siteContent.safeParse(content).success).toBe(true);

describe("a selection of several nodes", () => {
  it("is put in the order of the document, each once, and only what is there", () => {
    expect(inDocumentOrder(base(), ["cta", "p1", "hero", "p1", "nope", "row"])).toEqual(["hero", "row", "p1", "cta"]);
    expect(inDocumentOrder(base(), [])).toEqual([]);
  });
  it("loses the nodes that are inside another one of it: the topmost of each is what an action takes", () => {
    expect(topmost(base(), ["p1", "left", "row", "cta"])).toEqual(["row", "cta"]);
    expect(topmost(base(), ["p1", "b1"])).toEqual(["p1", "b1"]);
    expect(topmost(base(), ["nope"])).toEqual([]);
  });
  it("is taken out as a whole, with what the containers hold, and leaves a valid document", () => {
    const next = removeBlocks(base(), ["row", "p1", "cta"]);
    expect(ids(next)).toEqual(["hero", "more"]);
    expect(allNodes(next.blocks).map((entry) => entry.id)).toEqual(["hero", "more"]);
    valid(next);
    expect(removeBlocks(base(), ["nope"]).blocks).toEqual(base().blocks);
    expect(ids(removeBlocks(base(), ["h1", "b1"]), "left")).toEqual(["p1"]);
  });
  it("is changed by one function, node by node, the rest as it was", () => {
    const before = base();
    const next = updateBlocks(before, ["hero", "p1"], (entry) => ({ ...entry, name: "Marcado" }));
    expect(locate(next, "hero")!.node.name).toBe("Marcado");
    expect(locate(next, "p1")!.node.name).toBe("Marcado");
    expect(locate(next, "cta")!.node.name).toBeUndefined();
    expect(locate(next, "cta")!.node).toBe(locate(before, "cta")!.node);
    expect(updateBlocks(before, [], (entry) => entry)).toBe(before);
  });
});

describe("duplicating several nodes", () => {
  it("puts a copy of each right after it, with new identifiers, for the topmost only", () => {
    const next = duplicateBlocks(base(), ["hero", "left", "p1"]);
    if (!next.ok) throw new Error("not duplicated");
    expect(next.ids).toHaveLength(2);
    expect(ids(next.content)).toHaveLength(5);
    expect(ids(next.content, "row")).toHaveLength(3);
    const everything = allNodes(next.content.blocks).map((entry) => entry.id);
    expect(new Set(everything).size).toBe(everything.length);
    expect(locate(next.content, next.ids[0])!.index).toBe(1);
    valid(next.content);
  });
  it("changes nothing when one of them does not fit, and says why", () => {
    const crowded = page(Array.from({ length: 39 }, (_, at) => el("paragraph", `n${at}`, "x")));
    const outcome = duplicateBlocks(crowded, ["n0", "n1"]);
    expect(outcome).toEqual({ ok: false, reason: "limit-blocks" });
    const manyNodes = page([box("a", Array.from({ length: MAX_CHILDREN }, (_, at) => el("paragraph", `c${at}`, "x"))), box("b", Array.from({ length: MAX_CHILDREN }, (_, at) => el("paragraph", `d${at}`, "x"))), box("c", Array.from({ length: MAX_CHILDREN }, (_, at) => el("paragraph", `e${at}`, "x"))), box("d", Array.from({ length: MAX_CHILDREN }, (_, at) => el("paragraph", `f${at}`, "x"))), box("e", Array.from({ length: 31 }, (_, at) => el("paragraph", `g${at}`, "x")))]);
    expect(allNodes(manyNodes.blocks).length).toBeLessThanOrEqual(MAX_NODES);
    expect(duplicateBlocks(manyNodes, ["a"]).ok).toBe(false);
    expect(duplicateBlocks(base(), ["nope"])).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("wrapping several nodes in a container", () => {
  it("puts them, in the order of the document, in a new container where the first one stood", () => {
    // Not next to each other: the container is where the first one stood, and takes them in the order of the document.
    const apart = wrapBlocks(base(), ["cta", "hero"]);
    if (!apart.ok) throw new Error("not wrapped");
    expect(ids(apart.content)).toEqual([apart.id, "row", "more"]);
    expect(ids(apart.content, apart.id)).toEqual(["hero", "cta"]);
    const siblings = wrapBlocks(base(), ["more", "cta"]);
    if (!siblings.ok) throw new Error("not wrapped");
    expect(ids(siblings.content)).toEqual(["hero", "row", siblings.id]);
    expect(ids(siblings.content, siblings.id)).toEqual(["cta", "more"]);
    valid(siblings.content);
  });
  it("wraps nodes of a container inside it, and one node by itself", () => {
    const inside = wrapBlocks(base(), ["p1", "h1"]);
    if (!inside.ok) throw new Error("not wrapped");
    expect(ids(inside.content, "left")).toEqual([inside.id]);
    expect(ids(inside.content, inside.id)).toEqual(["h1", "p1"]);
    const one = wrapBlocks(base(), ["hero"]);
    if (!one.ok) throw new Error("not wrapped");
    expect(ids(one.content, one.id)).toEqual(["hero"]);
    // A node and what it holds: the container takes only the topmost.
    const nestedPick = wrapBlocks(base(), ["row", "p1"]);
    if (!nestedPick.ok) throw new Error("not wrapped");
    expect(ids(nestedPick.content, nestedPick.id)).toEqual(["row"]);
  });
  it("refuses nodes that are not in the same place, and nothing there, and what goes past the limits", () => {
    expect(wrapBlocks(base(), ["hero", "p1"])).toEqual({ ok: false, reason: "not-siblings" });
    expect(wrapBlocks(base(), ["nope"])).toEqual({ ok: false, reason: "not-found" });
    expect(wrapBlocks(base(), [])).toEqual({ ok: false, reason: "not-found" });
    let deep: SiteNode = el("paragraph", "leaf", "x");
    for (let level = MAX_DEPTH; level >= 1; level--) deep = box(`box${level}`, [deep]);
    expect(wrapBlocks(page([deep, el("paragraph", "other", "y")]), ["box1", "other"])).toEqual({ ok: false, reason: "limit-depth" });
  });
});

describe("walking the tree with the arrow keys", () => {
  it("goes to the previous and the next node in reading order, a container before what it holds", () => {
    const order = ["hero", "row", "left", "h1", "p1", "right", "b1", "cta", "more"];
    for (let at = 0; at < order.length; at++) {
      expect(navigate(base(), order[at], "down"), `down from ${order[at]}`).toBe(order[at + 1] ?? null);
      expect(navigate(base(), order[at], "up"), `up from ${order[at]}`).toBe(order[at - 1] ?? null);
    }
  });
  it("goes left to the container that holds the node, and right to the first node a container holds", () => {
    expect(navigate(base(), "p1", "left")).toBe("left");
    expect(navigate(base(), "left", "left")).toBe("row");
    expect(navigate(base(), "row", "left")).toBeNull();
    expect(navigate(base(), "row", "right")).toBe("left");
    expect(navigate(base(), "left", "right")).toBe("h1");
    expect(navigate(base(), "h1", "right")).toBeNull();
    expect(navigate(page([box("empty", [])]), "empty", "right")).toBeNull();
    expect(navigate(base(), "nope", "down")).toBeNull();
  });
});

describe("selecting a range in the list of layers", () => {
  it("is every node between the two when they are in the same place, the other way round too", () => {
    expect(rangeBetween(base(), "hero", "cta")).toEqual(["hero", "row", "cta"]);
    expect(rangeBetween(base(), "cta", "hero")).toEqual(["hero", "row", "cta"]);
    expect(rangeBetween(base(), "h1", "p1")).toEqual(["h1", "p1"]);
    expect(rangeBetween(base(), "hero", "hero")).toEqual(["hero"]);
  });
  it("is the second node alone when they are not in the same place, and nothing when it is not there", () => {
    expect(rangeBetween(base(), "hero", "p1")).toEqual(["p1"]);
    expect(rangeBetween(base(), "hero", "nope")).toEqual([]);
    expect(rangeBetween(base(), "nope", "cta")).toEqual(["cta"]);
  });
});
