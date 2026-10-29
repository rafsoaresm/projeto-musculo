import { describe, expect, it } from "vitest";
import { MAX_BLOCKS, MAX_DEPTH, MAX_NODES, allNodes, emptyBlock, siteContent, type BoxNode, type SiteContent, type SiteNode } from "@/modules/meu-site/contracts";
import {
  BLOCKS_FORMAT,
  MAX_CLIPBOARD_CHARS,
  STYLE_FORMAT,
  applyStyle,
  blocksPayload,
  parseBlocks,
  parseStyle,
  pasteBlocks,
  stylePayload,
  type PasteContext,
} from "@/modules/meu-site/clipboard";
import { childrenOf, locate } from "@/modules/meu-site/editor-model";
import type { Styled } from "@/modules/meu-site/screens";

const box = (id: string, children: SiteNode[], extra: Record<string, unknown> = {}): BoxNode => ({ ...(emptyBlock("box", id) as BoxNode), children, ...extra });
const para = (id: string, extra: Record<string, unknown> = {}): SiteNode => ({ ...emptyBlock("paragraph", id), text: "x", ...extra }) as SiteNode;
const page = (blocks: SiteNode[]): SiteContent => ({
  schemaVersion: 3,
  title: "Marina",
  description: "",
  contact: { whatsapp: "", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks,
});
const nobody: PasteContext = { assetIds: new Set(), serviceIds: new Set() };
const ids = (content: SiteContent, parent: string | null = null) => (childrenOf(content, parent) ?? []).map((entry) => entry.id);
const valid = (content: SiteContent) => expect(siteContent.safeParse(content).success).toBe(true);
const copy = (content: SiteContent, selection: string[]) => {
  const payload = blocksPayload(content, selection);
  if (!payload) throw new Error("nothing to copy");
  return parseBlocks(JSON.stringify(payload))!;
};

describe("copying blocks", () => {
  it("writes the topmost of the selection, in the order of the document, with the format that says what it is", () => {
    const content = page([para("a"), box("row", [para("b"), para("c")]), para("d")]);
    const payload = blocksPayload(content, ["d", "c", "row", "a"])!;
    expect(payload.format).toBe(BLOCKS_FORMAT);
    expect(payload.version).toBe(1);
    expect(payload.nodes.map((entry) => entry.id)).toEqual(["a", "row", "d"]);
    expect(blocksPayload(content, ["nope"])).toBeNull();
    expect(blocksPayload(content, [])).toBeNull();
  });
  it("is read back the same, and only when it is what it says it is", () => {
    const content = page([para("a", { style: { gap: "8px" }, styleTablet: { hidden: true } }), box("row", [para("b")])]);
    const back = copy(content, ["a", "row"]);
    expect(back.nodes).toEqual(content.blocks);
  });
});

describe("reading what comes from the clipboard", () => {
  const text = (nodes: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ format: BLOCKS_FORMAT, version: 1, nodes, ...extra });
  it("ignores a text that is not a copy of blocks: plain words, other JSON, another version, another format, a style", () => {
    for (const other of ["", "hello", "{", "[]", "null", "42", JSON.stringify({ hello: 1 }), text([para("a")], { version: 2 }), text([para("a")], { format: "outro" }), JSON.stringify({ format: STYLE_FORMAT, version: 1 })])
      expect(parseBlocks(other), other.slice(0, 30)).toBeNull();
  });
  it("refuses a copy with no nodes, with too many, with one that is not a node of the contract, or with a script in it", () => {
    expect(parseBlocks(text([]))).toBeNull();
    expect(parseBlocks(text(Array.from({ length: MAX_BLOCKS + 1 }, (_, at) => para(`n${at}`))))).toBeNull();
    expect(parseBlocks(text([{ id: "a", type: "script", src: "x" }]))).toBeNull();
    expect(parseBlocks(text([{ ...para("a"), onclick: "x" }]))).toBeNull();
    expect(parseBlocks(text([{ ...para("a"), style: { color: "red" } }]))).toBeNull();
    expect(parseBlocks(text([para("a"), { id: "b", type: "box", tag: "script", children: [] }]))).toBeNull();
    expect(parseBlocks(text([para("a"), "texto"]))).toBeNull();
  });
  it("refuses what is bigger than the limits of a document: too long a text, too many nodes in all, too deep a nesting, a nesting that would sink the reader", () => {
    expect(parseBlocks("x".repeat(MAX_CLIPBOARD_CHARS + 1))).toBeNull();
    const group = (count: number, tag: string) => box(tag, Array.from({ length: count }, (_, at) => para(`${tag}${at}`)));
    const crowded = Array.from({ length: 6 }, (_, at) => group(40, `g${at}`));
    expect(allNodes(crowded).length).toBeGreaterThan(MAX_NODES);
    expect(parseBlocks(text(crowded))).toBeNull();
    let deep: SiteNode = para("leaf");
    for (let level = MAX_DEPTH + 1; level >= 1; level--) deep = box(`b${level}`, [deep]);
    expect(parseBlocks(text([deep]))).toBeNull();
    // Written as text, so the test itself does not sink: two thousand containers, each in the one above.
    const levels = 2000;
    const sunk = `{"format":"${BLOCKS_FORMAT}","version":1,"nodes":[${'{"id":"b","type":"box","tag":"div","children":['.repeat(levels)}{"id":"x","type":"paragraph","text":"x"}${"]}".repeat(levels)}]}`;
    expect(sunk.length).toBeLessThan(MAX_CLIPBOARD_CHARS);
    expect(parseBlocks(sunk)).toBeNull();
  });
});

describe("pasting blocks", () => {
  it("puts them in the slot, in order, with new identifiers that nothing else has, and the document stays valid", () => {
    const content = page([para("a"), para("z")]);
    const payload = copy(page([para("a"), box("row", [para("b")])]), ["a", "row"]);
    const outcome = pasteBlocks(content, payload, { parent: null, index: 1 }, nobody);
    if (!outcome.ok) throw new Error("not pasted");
    expect(outcome.ids).toHaveLength(2);
    expect(ids(outcome.content)).toEqual(["a", outcome.ids[0], outcome.ids[1], "z"]);
    const everything = allNodes(outcome.content.blocks).map((entry) => entry.id);
    expect(new Set(everything).size).toBe(everything.length);
    expect(everything).not.toContain("row");
    valid(outcome.content);
    // The same copy pasted twice does not repeat an identifier.
    const again = pasteBlocks(outcome.content, payload, { parent: null, index: 99 }, nobody);
    if (!again.ok) throw new Error("not pasted");
    const all = allNodes(again.content.blocks).map((entry) => entry.id);
    expect(new Set(all).size).toBe(all.length);
  });
  it("goes into a container, at the end when the slot says so, keeping what the nodes hold", () => {
    const content = page([box("c", [para("x")])]);
    const payload = copy(page([box("row", [para("b"), para("c")])]), ["row"]);
    const outcome = pasteBlocks(content, payload, { parent: "c", index: Number.MAX_SAFE_INTEGER }, nobody);
    if (!outcome.ok) throw new Error("not pasted");
    expect(ids(outcome.content, "c")).toHaveLength(2);
    expect(ids(outcome.content, outcome.ids[0])).toHaveLength(2);
  });
  it("drops what only made sense where it came from: another site's images, services that are not on offer here, an authorization", () => {
    const source = page([
      { ...emptyBlock("image", "i1"), assetId: "mine", alt: "Estúdio" } as SiteNode,
      { ...emptyBlock("image", "i2"), assetId: "theirs", alt: "De outro" } as SiteNode,
      box("bg", [], { style: { bgImage: "theirs", background: "soft" }, styleTablet: { bgImage: "theirs" }, styleMobile: { bgImage: "mine", gap: "4px" } }),
      { ...emptyBlock("services", "s"), serviceIds: ["here", "gone"], items: [{ name: "Consultoria", delivery: "ONLINE" }] } as SiteNode,
      { ...emptyBlock("quote", "q"), quote: "Gostei", author: "Ana", authorized: true } as SiteNode,
    ]);
    const payload = copy(source, ["i1", "i2", "bg", "s", "q"]);
    const context: PasteContext = { assetIds: new Set(["mine"]), serviceIds: new Set(["here"]) };
    const outcome = pasteBlocks(page([]), payload, { parent: null, index: 0 }, context);
    if (!outcome.ok) throw new Error("not pasted");
    const [one, two, background, services, quote] = outcome.ids.map((id) => locate(outcome.content, id)!.node);
    expect(one).toMatchObject({ type: "image", assetId: "mine", alt: "Estúdio" });
    expect(two).toMatchObject({ type: "image", assetId: "", alt: "De outro" });
    expect(background).toMatchObject({ style: { background: "soft" }, styleMobile: { bgImage: "mine", gap: "4px" } });
    expect((background as BoxNode).style).not.toHaveProperty("bgImage");
    expect(background).not.toHaveProperty("styleTablet");
    expect(services).toMatchObject({ serviceIds: ["here"] });
    expect(services).not.toHaveProperty("items");
    expect(quote).toMatchObject({ authorized: false, quote: "Gostei" });
    valid(outcome.content);
  });
  it("makes a link to a block of the copy follow the copy, keeps one that goes to a block that is here, and drops one that goes nowhere here", () => {
    const source = page([box("target", [para("t")]), { ...emptyBlock("link", "k1"), label: "Ver", anchor: "t" } as SiteNode, { ...emptyBlock("button", "k2"), label: "Ir", anchor: "elsewhere" } as SiteNode, { ...emptyBlock("link", "k3"), label: "Fora", anchor: "here" } as SiteNode]);
    const payload = copy(source, ["target", "k1", "k2", "k3"]);
    const target = page([para("here")]);
    const outcome = pasteBlocks(target, payload, { parent: null, index: 1 }, nobody);
    if (!outcome.ok) throw new Error("not pasted");
    const [copiedTarget, k1, k2, k3] = outcome.ids.map((id) => locate(outcome.content, id)!.node);
    const innerId = (copiedTarget as BoxNode).children[0].id;
    expect(k1).toMatchObject({ anchor: innerId });
    expect(k2).not.toHaveProperty("anchor");
    expect(k3).toMatchObject({ anchor: "here" });
    expect(innerId).not.toBe("t");
    valid(outcome.content);
  });
  it("changes nothing when it does not fit, and says why: a full page, a full container, too many nodes, too deep", () => {
    const payload = copy(page([para("a"), para("b")]), ["a", "b"]);
    const full = page(Array.from({ length: MAX_BLOCKS - 1 }, (_, at) => para(`n${at}`)));
    expect(pasteBlocks(full, payload, { parent: null, index: 0 }, nobody)).toEqual({ ok: false, reason: "limit-blocks" });
    expect(pasteBlocks(page([box("c", Array.from({ length: 39 }, (_, at) => para(`m${at}`)))]), payload, { parent: "c", index: 0 }, nobody)).toEqual({ ok: false, reason: "limit-children" });
    let deep: SiteNode = para("leaf");
    for (let level = MAX_DEPTH; level >= 1; level--) deep = box(`b${level}`, [deep]);
    expect(pasteBlocks(page([deep]), copy(page([box("x", [])]), ["x"]), { parent: `b${MAX_DEPTH}`, index: 0 }, nobody)).toEqual({ ok: false, reason: "limit-depth" });
    expect(pasteBlocks(page([]), payload, { parent: "nowhere", index: 0 }, nobody).ok).toBe(false);
  });
});

describe("copying and pasting a style", () => {
  const styled = { id: "n", style: { gap: "8px", padding: { top: "4px" }, bgImage: "mine" }, styleTablet: { gap: "4px" }, styleMobile: { hidden: true } };
  it("writes the three sizes the block has, nothing for the ones it has not", () => {
    const payload = stylePayload(styled);
    expect(payload).toEqual({ format: STYLE_FORMAT, version: 1, style: styled.style, styleTablet: styled.styleTablet, styleMobile: styled.styleMobile });
    expect(stylePayload({ style: { gap: "8px" } })).toEqual({ format: STYLE_FORMAT, version: 1, style: { gap: "8px" } });
    expect(stylePayload({})).toEqual({ format: STYLE_FORMAT, version: 1 });
  });
  it("is read back, and refused when it is not a style: another text, a size that is not valid", () => {
    const text = JSON.stringify(stylePayload(styled));
    expect(parseStyle(text)).toEqual(JSON.parse(text));
    for (const other of ["", "x", "{}", JSON.stringify({ format: BLOCKS_FORMAT, version: 1 }), JSON.stringify({ format: STYLE_FORMAT, version: 2 }), JSON.stringify({ format: STYLE_FORMAT, version: 1, style: { gap: "9999px" } }), JSON.stringify({ format: STYLE_FORMAT, version: 1, styleTablet: { color: "red" } }), JSON.stringify({ format: STYLE_FORMAT, version: 1, styleMobile: { display: "none" } })])
      expect(parseStyle(other), other.slice(0, 40)).toBeNull();
  });
  it("replaces the styles of a block at every size, and drops a background image that is not in this site's library", () => {
    const payload = stylePayload(styled);
    const target = { id: "t", name: "Meu", style: { color: "#112233" }, styleTablet: { gap: "99px" } } as { id: string; name: string } & Styled;
    const withImage = applyStyle(target, payload, new Set(["mine"]));
    expect(withImage).toEqual({ id: "t", name: "Meu", style: styled.style, styleTablet: styled.styleTablet, styleMobile: styled.styleMobile });
    const without = applyStyle(target, payload, new Set());
    expect(without).toEqual({ id: "t", name: "Meu", style: { gap: "8px", padding: { top: "4px" } }, styleTablet: { gap: "4px" }, styleMobile: { hidden: true } });
    // A copy of a block with no style takes the style away.
    expect(applyStyle(target, stylePayload({}), new Set())).toEqual({ id: "t", name: "Meu" });
  });
});
