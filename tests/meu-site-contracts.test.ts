import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  MAX_BLOCKS,
  MAX_CHILDREN,
  MAX_DEPTH,
  MAX_NODES,
  allNodes,
  boxDepth,
  channelUrl,
  emailUrl,
  emptyBlock,
  instagramUrl,
  parseContent,
  publishIssues,
  referencedAssetIds,
  resolveServices,
  safeParseContent,
  siteContent,
  slugFromName,
  slugSchema,
  starterContent,
  whatsappUrl,
  withoutResolvedServices,
  type Block,
  type SiteContent,
} from "@/modules/meu-site/contracts";

const full = (over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "Treino com acompanhamento",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks: [
    { id: "a1", type: "hero", eyebrow: "", heading: "Treino sob medida", subheading: "", buttonLabel: "Falar comigo", buttonChannel: "whatsapp" },
    { id: "a2", type: "text", eyebrow: "", heading: "Sobre", text: "Texto" },
  ],
  ...over,
});
const withBlocks = (blocks: Block[]) => full({ blocks });
const block = <T extends Block["type"]>(type: T, id: string, over: Partial<Extract<Block, { type: T }>> = {}) =>
  ({ ...emptyBlock(type, id), ...over }) as Block;
/** A container holding what is given. */
const box = (id: string, children: Block[], over: object = {}) => ({ ...emptyBlock("box", id), children, ...over }) as Block;

describe("the address of the page", () => {
  it("accepts a short lower-case address with digits and single hyphens", () => {
    for (const ok of ["marina", "studio-forca", "a1b", "treino-2026", "  Marina-Treinos  "])
      expect(slugSchema.safeParse(ok).success, ok).toBe(true);
    expect(slugSchema.parse("  Marina-Treinos  ")).toBe("marina-treinos");
  });
  it("refuses what is too short, too long, badly shaped or reserved", () => {
    for (const bad of ["ab", "a".repeat(41), "-marina", "marina-", "mari--na", "mari na", "marína", "mari_na", "mari.na", "gestor", "api", "profissional", "ENTRAR"])
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
  });
  it("makes an address from a name, without accents or symbols", () => {
    expect(slugFromName("Studio Força & Saúde")).toBe("studio-forca-saude");
    expect(slugFromName("  --Marina!! ")).toBe("marina");
    expect(slugFromName("Ã")).toBe("meu-site");
    expect(slugFromName("Gestor")).toBe("meu-site");
    expect(slugFromName("x".repeat(100)).length).toBeLessThanOrEqual(40);
  });
});

describe("the only links the page has", () => {
  it("makes the WhatsApp link from a number typed any way, assuming Brazil for 10 or 11 digits", () => {
    expect(whatsappUrl("(11) 91234-5678")).toBe("https://wa.me/5511912345678");
    expect(whatsappUrl("+55 11 91234 5678")).toBe("https://wa.me/5511912345678");
    expect(whatsappUrl("+351 912 345 678")).toBe("https://wa.me/351912345678");
    expect(whatsappUrl("12345")).toBeNull();
    expect(whatsappUrl("")).toBeNull();
    expect(whatsappUrl("1".repeat(16))).toBeNull();
  });
  it("makes the e-mail and Instagram links only from what is plainly an address and a handle", () => {
    expect(emailUrl(" marina@example.test ")).toBe("mailto:marina@example.test");
    expect(emailUrl("not-an-address")).toBeNull();
    expect(emailUrl("a@b.test?subject=x&bcc=y@z.test")).toBeNull();
    expect(instagramUrl("@marina.treinos")).toBe("https://www.instagram.com/marina.treinos/");
    expect(instagramUrl("marina_t")).toBe("https://www.instagram.com/marina_t/");
    for (const bad of ["", "https://evil.test", "marina/../x", "javascript:alert(1)", "a b", "x".repeat(31)])
      expect(instagramUrl(bad), bad).toBeNull();
  });
  it("never produces a link from free text: no javascript:, data: or http(s) address is accepted anywhere", () => {
    const contact = { whatsapp: "javascript:alert(1)", email: "javascript:alert(1)", instagram: "javascript:alert(1)" };
    for (const channel of ["whatsapp", "email", "instagram"] as const) expect(channelUrl(contact, channel)).toBeNull();
    expect(channelUrl(full().contact, undefined)).toBeNull();
  });
});

describe("the document of the page", () => {
  it("accepts a complete page and an incomplete draft", () => {
    expect(siteContent.safeParse(full()).success).toBe(true);
    expect(siteContent.safeParse(full({ title: "", blocks: [emptyBlock("hero"), emptyBlock("services"), emptyBlock("faq")] })).success).toBe(true);
    expect(siteContent.safeParse(starterContent("Marina")).success).toBe(true);
  });
  it("accepts every kind of node, empty, on the page and inside a container: a container takes sections too", () => {
    expect([...BLOCK_TYPES]).toEqual(["hero", "text", "services", "about", "quote", "stats", "faq", "cta", "box", "heading", "paragraph", "button", "link", "image"]);
    for (const type of BLOCK_TYPES) {
      const made = emptyBlock(type, `b-${type}`);
      expect(siteContent.safeParse(withBlocks([made])).success, type).toBe(true);
      expect(siteContent.safeParse(withBlocks([box("c", [emptyBlock(type, `in-${type}`)])])).success, `${type} in a container`).toBe(true);
    }
  });
  it("accepts containers inside containers, as many as the limit, and refuses one more", () => {
    const nested = (levels: number): Block => {
      let inner: Block = emptyBlock("paragraph", "leaf");
      for (let level = levels; level >= 1; level--) inner = box(`box${level}`, [inner]);
      return inner;
    };
    expect(boxDepth([nested(MAX_DEPTH)])).toBe(MAX_DEPTH);
    expect(siteContent.safeParse(withBlocks([nested(MAX_DEPTH)])).success).toBe(true);
    expect(siteContent.safeParse(withBlocks([nested(MAX_DEPTH + 1)])).success).toBe(false);
    expect(boxDepth([emptyBlock("hero", "h")])).toBe(0);
  });
  it("refuses a field that is not part of it, another version, and a node of another kind", () => {
    expect(siteContent.safeParse({ ...full(), html: "<b>x</b>" }).success).toBe(false);
    expect(siteContent.safeParse({ ...full(), schemaVersion: 4 }).success).toBe(false);
    expect(siteContent.safeParse({ ...full(), schemaVersion: 2 }).success).toBe(false);
    expect(siteContent.safeParse({ ...full(), schemaVersion: 1 }).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "x", type: "script", src: "https://evil.test" } as never] })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "x", type: "columns", ratio: "equal", left: [], right: [] } as never] })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ ...(emptyBlock("text") as object), onClick: "x" } as never] })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [box("c", [], { html: "<b>" })] })).success).toBe(false);
  });
  it("takes the look from a closed list: an accent, a mode and a width, never a color typed by a person", () => {
    expect(siteContent.safeParse(full({ theme: { accent: "graphite", mode: "dark", width: "full" } })).success).toBe(true);
    for (const bad of [
      { accent: "#ff0000", mode: "light", width: "narrow" },
      { accent: "blue", mode: "sepia", width: "narrow" },
      { accent: "blue", mode: "light", width: "huge" },
      { accent: "blue", mode: "light" },
      { accent: "blue", width: "narrow" },
      { accent: "blue", mode: "light", width: "narrow", css: "x" },
    ])
      expect(siteContent.safeParse(full({ theme: bad as never })).success, JSON.stringify(bad)).toBe(false);
    expect(siteContent.safeParse({ ...full(), theme: undefined }).success).toBe(false);
  });
  it("bounds the number of blocks on the page, in a container, in all, the length of the texts and the repetition of identifiers", () => {
    const many = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({ ...(emptyBlock("text") as object), id: `b${i}` }));
    expect(siteContent.safeParse(full({ blocks: many as never })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: many.slice(0, MAX_BLOCKS) as never })).success).toBe(true);
    const items = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => emptyBlock("paragraph", `${prefix}${i}`));
    expect(siteContent.safeParse(withBlocks([box("c", items(MAX_CHILDREN, "l"))])).success).toBe(true);
    expect(siteContent.safeParse(withBlocks([box("c", items(MAX_CHILDREN + 1, "l"))])).success).toBe(false);
    // Six containers with 40 elements each are 246 nodes in all, over the total.
    const heavy = Array.from({ length: 6 }, (_, i) => box(`c${i}`, items(MAX_CHILDREN, `l${i}-`)));
    expect(allNodes(heavy).length).toBeGreaterThan(MAX_NODES);
    expect(siteContent.safeParse(withBlocks(heavy)).success).toBe(false);
    expect(siteContent.safeParse(withBlocks(heavy.slice(0, 4))).success).toBe(true);
    expect(siteContent.safeParse(full({ title: "x".repeat(81) })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "same", type: "text", eyebrow: "", heading: "", text: "a" }, { id: "same", type: "text", eyebrow: "", heading: "", text: "b" }] })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "BAD ID", type: "text", eyebrow: "", heading: "", text: "a" }] })).success).toBe(false);
  });
  it("does not let an identifier repeat anywhere in the tree: page and container, container and container, grandchild and page", () => {
    expect(siteContent.safeParse(withBlocks([box("c", [emptyBlock("heading", "dup")]), box("d", [emptyBlock("paragraph", "dup")])])).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [...full().blocks, box("c", [emptyBlock("heading", "a1")])] })).success).toBe(false);
    expect(siteContent.safeParse(withBlocks([box("c", [box("d", [emptyBlock("heading", "c")])])])).success).toBe(false);
  });
  it("keeps a heading's level between 2 and 6 (the first level is the page's own), and a button or a link to a contact or to a block, not both", () => {
    expect(emptyBlock("heading", "h")).toMatchObject({ level: 2 });
    for (const level of [2, 3, 4, 5, 6]) expect(siteContent.safeParse(withBlocks([block("heading", "h", { level } as never)])).success, String(level)).toBe(true);
    for (const level of [1, 7, 0, 2.5, "2"]) expect(siteContent.safeParse(withBlocks([block("heading", "h", { level } as never)])).success, String(level)).toBe(false);
    for (const type of ["button", "link"] as const) {
      expect(siteContent.safeParse(withBlocks([block(type, "x", { label: "Ir", channel: "whatsapp" } as never)])).success).toBe(true);
      expect(siteContent.safeParse(withBlocks([block(type, "x", { label: "Ir", anchor: "a1" } as never)])).success).toBe(true);
      expect(siteContent.safeParse(withBlocks([block(type, "x", { label: "Ir", channel: "whatsapp", anchor: "a1" } as never)])).success).toBe(false);
      expect(siteContent.safeParse(withBlocks([block(type, "x", { label: "Ir", anchor: "not an id!" } as never)])).success).toBe(false);
      expect(siteContent.safeParse(withBlocks([block(type, "x", { label: "Ir", url: "https://evil.test" } as never)])).success).toBe(false);
    }
  });
  it("gives a node a name for the layers (plain text, at most 40 characters) and a typed style, and nothing else", () => {
    expect(siteContent.safeParse(withBlocks([box("c", [], { name: "Barra de topo", style: { display: "flex", gap: "12px" } })])).success).toBe(true);
    expect(siteContent.safeParse(withBlocks([box("c", [], { name: "x".repeat(41) })])).success).toBe(false);
    expect(siteContent.safeParse(withBlocks([box("c", [], { style: { display: "flex", unknown: "x" } })])).success).toBe(false);
    expect(siteContent.safeParse(withBlocks([box("c", [], { style: { width: "50em" } })])).success).toBe(false);
    expect(siteContent.safeParse(withBlocks([block("hero", "h", { style: { color: "red" } } as never)])).success).toBe(false);
    expect(siteContent.safeParse(withBlocks([block("hero", "h", { style: { color: "#a1b2c3" } } as never)])).success).toBe(true);
  });
  it("refuses a document that nests far too deep without running out of stack, and a document that is too large", () => {
    let hostile: unknown = { id: "x", type: "paragraph", text: "" };
    for (let level = 0; level < 6000; level++) hostile = { id: `b${level}`, type: "box", tag: "div", children: [hostile] };
    const raw = { ...full(), blocks: [hostile] };
    // Refused by the guard before the checks run (and not by running out of stack in them).
    expect(() => parseContent(raw)).toThrow(/nested too deep/);
    expect(safeParseContent(raw).success).toBe(false);
    const sane = { ...full(), blocks: [box("a", [box("b", [box("c", [emptyBlock("paragraph", "p")])])])] };
    expect(() => parseContent(sane)).not.toThrow();
    const big = withBlocks([block("text", "t", { text: "x".repeat(2000) }), ...Array.from({ length: 39 }, (_, i) => block("text", `t${i}`, { text: "x".repeat(2000) }))]);
    expect(JSON.stringify(big).length).toBeGreaterThan(60_000);
    expect(siteContent.safeParse(big).success).toBe(true);
    const huge = withBlocks(Array.from({ length: 40 }, (_, i) => block("text", `h${i}`, { text: "x".repeat(2000), heading: "y".repeat(120), eyebrow: "z".repeat(60), style: { padding: { top: "1px", bottom: "1px", left: "1px", right: "1px" }, margin: { top: "1px", bottom: "1px", left: "1px", right: "1px" } } } as never)));
    expect(JSON.stringify(huge).length).toBeLessThanOrEqual(150_000);
  });
  it("keeps the line breaks of a text, refuses control and invisible characters, and keeps markup as plain text", () => {
    const withText = (value: string) => siteContent.safeParse(full({ blocks: [{ id: "t1", type: "text", eyebrow: "", heading: "", text: value }] }));
    expect(withText("linha 1\r\nlinha 2").success).toBe(true);
    expect(withText("a\u0000b").success).toBe(false);
    expect(withText("a‮b").success).toBe(false);
    const parsed = withText("<script>alert(1)</script>");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect((parsed.data.blocks[0] as { text: string }).text).toBe("<script>alert(1)</script>");
  });
  it("keeps a quote's authorization as a plain yes or no", () => {
    expect(siteContent.safeParse(withBlocks([block("quote", "q", { authorized: true })])).success).toBe(true);
    expect(siteContent.safeParse(withBlocks([{ ...emptyBlock("quote", "q"), authorized: "sim" } as never])).success).toBe(false);
  });
});

describe("the first version of the document, still read", () => {
  const v1 = {
    schemaVersion: 1,
    title: "Marina Treinos",
    description: "Treino",
    contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" },
    blocks: [
      { id: "h", type: "hero", heading: "Treino sob medida", subheading: "", buttonLabel: "Falar", buttonChannel: "whatsapp" },
      { id: "t", type: "text", heading: "Sobre", text: "Texto" },
      { id: "s", type: "services", heading: "Serviços", intro: "", serviceIds: ["x"], items: [{ name: "Consultoria", delivery: "ONLINE" }] },
      { id: "f", type: "faq", heading: "Dúvidas", items: [{ question: "Q?", answer: "A." }] },
      { id: "c", type: "cta", heading: "Vamos", text: "", buttonLabel: "Escrever", buttonChannel: "email" },
    ],
  };
  it("reads it as version 3: an empty eyebrow on each block, the default look, everything else as it was", () => {
    const upgraded = parseContent(v1);
    expect(upgraded.schemaVersion).toBe(3);
    expect(upgraded.theme).toEqual({ accent: "blue", mode: "light", width: "narrow" });
    expect(upgraded.title).toBe("Marina Treinos");
    expect(upgraded.blocks.map((b) => b.type)).toEqual(["hero", "text", "services", "faq", "cta"]);
    for (const b of upgraded.blocks) expect((b as { eyebrow: string }).eyebrow).toBe("");
    expect(upgraded.blocks[0]).toMatchObject({ heading: "Treino sob medida", buttonChannel: "whatsapp" });
    expect(upgraded.blocks[2]).toMatchObject({ serviceIds: ["x"], items: [{ name: "Consultoria", delivery: "ONLINE" }] });
    expect(siteContent.safeParse(upgraded).success).toBe(true);
  });
  it("does not read it if it was not valid then either, and reads version 3 as it is", () => {
    expect(safeParseContent({ ...v1, html: "x" }).success).toBe(false);
    expect(safeParseContent({ ...v1, blocks: [{ id: "q", type: "quote" }] }).success).toBe(false);
    expect(safeParseContent({ ...v1, schemaVersion: 4 }).success).toBe(false);
    expect(safeParseContent(null).success).toBe(false);
    expect(safeParseContent("x").success).toBe(false);
    expect(parseContent(full())).toEqual(full());
    expect(() => parseContent({ ...v1, title: "x".repeat(81) })).toThrow();
  });
});

describe("the second version of the document (sections and \"2 columns\"), still read", () => {
  const item = (type: string, id: string, extra: object = {}) => ({ id, type, ...extra });
  const v2 = (blocks: unknown[], extra: object = {}) => ({
    schemaVersion: 2,
    title: "Marina Treinos",
    description: "",
    contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" },
    theme: { accent: "green", mode: "dark" },
    blocks,
    ...extra,
  });
  const columns = (ratio: string, left: unknown[], right: unknown[]) => ({ id: "cols", type: "columns", ratio, left, right });

  it("keeps the sections as they were, gives the page the narrow width it had, and a heading level 2", () => {
    const upgraded = parseContent(
      v2([{ id: "h", type: "hero", eyebrow: "Olá", heading: "Treino", subheading: "", buttonLabel: "Falar", buttonChannel: "whatsapp" }, item("heading", "t", { text: "Título solto" })], { logoAssetId: "logo-1" }),
    );
    expect(upgraded.schemaVersion).toBe(3);
    expect(upgraded.theme).toEqual({ accent: "green", mode: "dark", width: "narrow" });
    expect(upgraded.logoAssetId).toBe("logo-1");
    expect(upgraded.blocks[0]).toMatchObject({ type: "hero", eyebrow: "Olá" });
    expect(upgraded.blocks[1]).toEqual({ id: "t", type: "heading", text: "Título solto", level: 2 });
  });
  it("makes a \"2 columns\" block a row container of two column containers, with the same elements in the same order", () => {
    const upgraded = parseContent(
      v2([columns("equal", [item("heading", "l1", { text: "A" }), item("paragraph", "l2", { text: "B" })], [item("button", "r1", { label: "Ir", channel: "whatsapp" })])]),
    );
    const row = upgraded.blocks[0];
    expect(row).toMatchObject({ id: "cols", type: "box", tag: "div", name: "2 colunas", style: { display: "flex", direction: "row", wrap: "wrap", gap: "24px" } });
    if (row.type !== "box") throw new Error("not a container");
    expect(row.children.map((c) => c.id)).toEqual(["cols-l", "cols-r"]);
    const [left, right] = row.children;
    if (left.type !== "box" || right.type !== "box") throw new Error("not containers");
    expect(left.children).toEqual([{ id: "l1", type: "heading", text: "A", level: 2 }, { id: "l2", type: "paragraph", text: "B" }]);
    expect(right.children).toEqual([{ id: "r1", type: "button", label: "Ir", channel: "whatsapp" }]);
    expect(left.style).toMatchObject({ display: "flex", direction: "column", grow: 1, basis: "240px" });
    expect(right.style).toMatchObject({ grow: 1 });
    expect(siteContent.safeParse(upgraded).success).toBe(true);
  });
  it("keeps the ratio as the weight of each column, and leaves out a side that had nothing, as the page of version 2 did", () => {
    const grows = (ratio: string, left: unknown[], right: unknown[]) => {
      const row = parseContent(v2([columns(ratio, left, right)])).blocks[0];
      if (row.type !== "box") throw new Error("not a container");
      return row.children.map((c) => (c.style as { grow: number }).grow);
    };
    const one = [item("paragraph", "p", { text: "x" })];
    expect(grows("equal", one, [item("paragraph", "q", { text: "y" })])).toEqual([1, 1]);
    expect(grows("left", one, [item("paragraph", "q", { text: "y" })])).toEqual([3, 2]);
    expect(grows("right", one, [item("paragraph", "q", { text: "y" })])).toEqual([2, 3]);
    expect(grows("left", one, [])).toEqual([3]);
    expect(grows("left", [], [])).toEqual([]);
  });
  it("does not read it if it was not valid then (a section inside a column, a repeated id), or too large", () => {
    expect(safeParseContent(v2([columns("equal", [{ id: "h", type: "hero", eyebrow: "", heading: "", subheading: "", buttonLabel: "" }], [])])).success).toBe(false);
    expect(safeParseContent(v2([item("heading", "a", { text: "x" }), columns("equal", [item("heading", "a", { text: "y" })], [])])).success).toBe(false);
    expect(safeParseContent(v2([], { html: "x" })).success).toBe(false);
    expect(safeParseContent(v2([], { theme: { accent: "green", mode: "dark", width: "full" } })).success).toBe(false);
  });
  it("keeps the images of a page of version 2, in a column too, on the list of what it uses", () => {
    const upgraded = parseContent(v2([columns("equal", [item("image", "i", { assetId: "asset-7", alt: "x", caption: "", size: "full" })], [])], { logoAssetId: "asset-8" }));
    expect(referencedAssetIds(upgraded).sort()).toEqual(["asset-7", "asset-8"]);
  });
});

describe("the services written into a block", () => {
  const live = new Map([["svc-1", { name: "Consultoria online", description: "Plano mensal", delivery: "ONLINE" as const }], ["svc-2", { name: "Avaliação", description: null, delivery: "IN_PERSON" as const }]]);
  it("writes the services chosen as they are on offer, in the order chosen, and leaves out one that is gone", () => {
    const content = withBlocks([block("services", "s", { serviceIds: ["svc-2", "svc-gone", "svc-1"] }), emptyBlock("text", "t")]);
    const out = resolveServices(content, live);
    expect((out.blocks[0] as { items: unknown }).items).toEqual([
      { name: "Avaliação", delivery: "IN_PERSON" },
      { name: "Consultoria online", description: "Plano mensal", delivery: "ONLINE" },
    ]);
    expect(out.blocks[1]).toEqual(content.blocks[1]);
    expect(withoutResolvedServices(out)).toEqual(content);
  });
  it("does the same for a block deep inside containers, and leaves what is around it untouched", () => {
    const content = withBlocks([box("c", [box("d", [block("services", "s", { serviceIds: ["svc-1"] }), emptyBlock("paragraph", "p")])])]);
    const out = resolveServices(content, live);
    const inner = allNodes(out.blocks).find((b) => b.id === "s");
    expect((inner as { items: unknown }).items).toEqual([{ name: "Consultoria online", description: "Plano mensal", delivery: "ONLINE" }]);
    expect(allNodes(out.blocks).map((b) => b.id)).toEqual(["c", "d", "s", "p"]);
    expect(withoutResolvedServices(out)).toEqual(content);
  });
});

describe("what stops a publication", () => {
  const live = new Set(["svc-1"]);
  const messages = (content: SiteContent) => publishIssues(content, live).map((i) => i.message);
  it("lets a complete page through", () => {
    expect(publishIssues(full(), live)).toEqual([]);
    expect(publishIssues(withBlocks([...full().blocks, block("services", "s1", { heading: "Serviços", serviceIds: ["svc-1"] })]), live)).toEqual([]);
  });
  it("asks for a title and for at least one block", () => {
    expect(messages(full({ title: "" }))).toContain("Dê um título ao site.");
    expect(messages(full({ blocks: [] }))).toContain("Acrescente pelo menos um bloco.");
  });
  it("names the block that is incomplete, and says which one (its position and its id)", () => {
    const issues = publishIssues(
      withBlocks([
        block("hero", "a"),
        block("text", "b"),
        block("services", "c", { heading: "S" }),
        block("faq", "d", { heading: "", items: [{ question: "Q?", answer: "" }] }),
        block("cta", "e"),
      ]),
      live,
    );
    const byBlock = (n: number) => issues.filter((i) => i.block === n).length;
    expect([1, 2, 3, 4, 5].map(byBlock)).toEqual([1, 1, 1, 2, 2]);
    expect(issues[0].message).toContain("Bloco 1 (Destaque)");
    expect(issues.map((i) => i.blockId)).toEqual(["a", "b", "c", "d", "d", "e", "e"]);
  });
  it("does not let a button lead to a contact that is not filled in or is invalid", () => {
    const blocks = [block("hero", "a", { heading: "H", buttonLabel: "Falar", buttonChannel: "whatsapp" })];
    expect(publishIssues(full({ blocks, contact: { whatsapp: "", email: "", instagram: "" } }), live)[0].message).toContain("WhatsApp");
    expect(publishIssues(full({ blocks, contact: { whatsapp: "123", email: "", instagram: "" } }), live)).toHaveLength(1);
    const half = [block("hero", "a", { heading: "H", buttonLabel: "Falar", buttonChannel: undefined })];
    expect(publishIssues(full({ blocks: half }), live)[0].message).toContain("para onde o botão leva");
  });
  it("does not publish services that left the offer", () => {
    expect(messages(withBlocks([block("services", "s", { heading: "S", serviceIds: ["svc-1", "svc-gone"] })]))).toEqual([expect.stringContaining("saiu da oferta")]);
  });
  it("asks for a text in \"about me\", and for a caption when there is a number", () => {
    expect(messages(withBlocks([block("about", "a")]))).toEqual([expect.stringContaining("escreva o texto")]);
    expect(messages(withBlocks([block("about", "a", { text: "Texto", stat: "10 anos" })]))).toEqual([expect.stringContaining("legenda")]);
    expect(messages(withBlocks([block("about", "a", { text: "Texto", stat: "10 anos", statLabel: "de profissão" })]))).toEqual([]);
    expect(messages(withBlocks([block("about", "a", { text: "Texto" })]))).toEqual([]);
  });
  it("does not publish a testimony without the text, the author and the person's authorization", () => {
    expect(messages(withBlocks([block("quote", "q")])).length).toBe(3);
    const ok = block("quote", "q", { quote: "Gostei", author: "Ana, aluna", authorized: true });
    expect(messages(withBlocks([ok]))).toEqual([]);
    expect(messages(withBlocks([{ ...ok, authorized: false } as Block]))).toEqual([expect.stringContaining("autorizou")]);
  });
  it("asks for every indicator to have its number and its caption", () => {
    expect(messages(withBlocks([block("stats", "s")])).length).toBe(2);
    expect(messages(withBlocks([block("stats", "s", { items: [{ value: "1", label: "Avaliação" }] })]))).toEqual([]);
    expect(messages(withBlocks([block("stats", "s", { items: [{ value: "1", label: "Avaliação" }, { value: "2", label: "" }] })]))).toEqual([expect.stringContaining("número e legenda")]);
  });
  it("looks inside the containers at any depth, saying where: the block, the path inside it and the id of the node", () => {
    const inner = box("c", [
      emptyBlock("heading", "h"),
      box("d", [{ ...emptyBlock("button", "b"), label: "Falar", channel: "whatsapp" } as Block, emptyBlock("link", "k")]),
    ]);
    const issues = publishIssues(full({ blocks: [inner], contact: { whatsapp: "", email: "", instagram: "" } }), live);
    expect(issues.map((i) => i.blockId)).toEqual(["h", "b", "k"]);
    expect(issues.every((i) => i.block === 1)).toBe(true);
    expect(issues[0].message).toContain("Bloco 1 (Contêiner), camada 1 (Título)");
    expect(issues[1].message).toContain("camada 2.1 (Botão)");
    expect(issues[1].message).toContain("WhatsApp");
    expect(issues[2].message).toContain("camada 2.2 (Link)");
    const ok = box("c", [{ ...emptyBlock("heading", "h"), text: "Oi" } as Block, { ...emptyBlock("button", "b"), label: "Falar", channel: "whatsapp" } as Block]);
    expect(messages(full({ blocks: [ok] }))).toEqual([]);
  });
  it("lets an empty container through (it is a space or a background), but not an empty page", () => {
    expect(messages(withBlocks([box("c", [])]))).toEqual([]);
    expect(messages(withBlocks([]))).toEqual(["Acrescente pelo menos um bloco."]);
  });
  it("checks the elements that stand on the page by themselves, as the ones in a container", () => {
    expect(messages(withBlocks([block("heading", "h"), block("paragraph", "p"), block("button", "b"), block("link", "l")])).length).toBe(4);
    expect(messages(withBlocks([block("heading", "h", { text: "Oi" }), block("paragraph", "p", { text: "Texto" }), block("button", "b", { label: "Falar", channel: "whatsapp" }), block("link", "l", { label: "Contato", channel: "email" })]))).toEqual([]);
  });
  it("checks where a button or a link goes: a text and a destination, a contact that exists, a block that is still there", () => {
    const target = (over: object) => messages(withBlocks([block("hero", "top", { heading: "H" }), block("link", "l", over as never)]));
    expect(target({ label: "Ver", anchor: "top" })).toEqual([]);
    expect(target({ label: "Ver", anchor: "gone" })).toEqual([expect.stringContaining("não existe mais")]);
    expect(target({ label: "", anchor: "top" })).toEqual([expect.stringContaining("escreva o texto do link")]);
    expect(target({ label: "Ver" })).toEqual([expect.stringContaining("para onde o link leva")]);
    expect(target({})).toEqual([expect.stringContaining("texto e de um destino")]);
    const noInstagram = full({ blocks: [block("link", "l", { label: "Ver", channel: "instagram" } as never)], contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" } });
    expect(messages(noInstagram)).toEqual([expect.stringContaining("Instagram")]);
    expect(target({ label: "Ver", channel: "instagram" })).toEqual([]);
    expect(messages(withBlocks([block("heading", "h", { text: "Oi" }), block("button", "b", { label: "Ver", anchor: "h" })]))).toEqual([]);
  });
  it("shows that a new site is not publishable until the contact it points to is filled in", () => {
    const issues = publishIssues(starterContent("Marina"), live);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => /WhatsApp/.test(i.message))).toBe(true);
  });
});

describe("images on the page", () => {
  const live = new Set<string>();
  const imageBlock = (id: string, over: object = {}) => ({ ...emptyBlock("image", id), assetId: "asset-1", alt: "Marina no estúdio", ...over }) as Block;
  it("holds the id of an image of the library, a description, a caption and a size from a closed list", () => {
    expect(emptyBlock("image", "i")).toEqual({ id: "i", type: "image", assetId: "", alt: "", caption: "", size: "full" });
    expect(siteContent.safeParse(withBlocks([imageBlock("a")])).success).toBe(true);
    for (const size of ["wide", "100%", "", 12]) expect(siteContent.safeParse(withBlocks([imageBlock("a", { size })])).success, String(size)).toBe(false);
    expect(siteContent.safeParse(withBlocks([imageBlock("a", { src: "https://evil.test/x.png" })])).success).toBe(false);
    expect(siteContent.safeParse(withBlocks([imageBlock("a", { assetId: "x".repeat(65) })])).success).toBe(false);
    expect(siteContent.safeParse(withBlocks([imageBlock("a", { alt: "x".repeat(201) })])).success).toBe(false);
    expect(siteContent.safeParse(withBlocks([imageBlock("a", { caption: "x".repeat(201) })])).success).toBe(false);
  });
  it("fits in a container, and the logo is an id too", () => {
    expect(siteContent.safeParse(withBlocks([box("c", [imageBlock("in")])])).success).toBe(true);
    expect(siteContent.safeParse(full({ logoAssetId: "asset-9" })).success).toBe(true);
    expect(siteContent.safeParse(full({ logoAssetId: "x".repeat(65) })).success).toBe(false);
    expect(siteContent.safeParse(full({ logoAssetId: 5 as never })).success).toBe(false);
  });
  it("lists the images the document uses, once each: in an image, deep in containers, in the style of any node (a background) and the logo", () => {
    const content = full({
      blocks: [
        imageBlock("a"),
        box("c", [imageBlock("in", { assetId: "asset-2" }), box("d", [imageBlock("in2", { assetId: "asset-1" })], { style: { bgImage: "asset-4" } })]),
        imageBlock("empty", { assetId: "" }),
        block("hero", "h", { style: { bgImage: "asset-5" } } as never),
      ],
      logoAssetId: "asset-3",
    });
    expect(referencedAssetIds(content).sort()).toEqual(["asset-1", "asset-2", "asset-3", "asset-4", "asset-5"]);
    expect(referencedAssetIds(full())).toEqual([]);
  });
  it("is not publishable without the image, without its description, or with an image that is not in the library", () => {
    const issues = (content: SiteContent, known: string[] | null = ["asset-1"]) => publishIssues(content, live, known ? new Set(known) : null).map((i) => i.message);
    expect(issues(withBlocks([imageBlock("a")]))).toEqual([]);
    expect(issues(withBlocks([imageBlock("a", { assetId: "" })]))).toEqual([expect.stringContaining("escolha a imagem")]);
    expect(issues(withBlocks([imageBlock("a", { alt: "" })]))).toEqual([expect.stringContaining("texto alternativo")]);
    expect(issues(withBlocks([imageBlock("a", { assetId: "gone" })]))).toEqual([expect.stringContaining("não está mais na biblioteca")]);
    expect(issues(withBlocks([imageBlock("a", { assetId: "gone" })]), null)).toEqual([]);
    expect(issues(full({ blocks: [imageBlock("a")], logoAssetId: "gone" }))).toEqual([expect.stringContaining("logotipo")]);
    expect(issues(full({ blocks: [imageBlock("a")], logoAssetId: "asset-1" }))).toEqual([]);
  });
  it("does not publish a background that is not in the library, wherever the node is", () => {
    const content = withBlocks([box("c", [block("paragraph", "p", { text: "x", style: { bgImage: "gone" } } as never)])]);
    const found = publishIssues(content, live, new Set(["asset-1"]));
    expect(found.map((i) => i.blockId)).toEqual(["p"]);
    expect(found[0].message).toContain("imagem de fundo");
    expect(publishIssues(content, live, null)).toEqual([]);
    expect(publishIssues(withBlocks([box("c", [block("paragraph", "p", { text: "x", style: { bgImage: "asset-1" } } as never)])]), live, new Set(["asset-1"]))).toEqual([]);
  });
  it("is checked inside a container too, with the element's id", () => {
    const found = publishIssues(withBlocks([box("c", [imageBlock("in", { alt: "" })])]), live, new Set(["asset-1"]));
    expect(found.map((i) => i.blockId)).toEqual(["in"]);
    expect(found[0].message).toContain("camada 1 (Imagem)");
  });
});

describe("what stops a publication and what only warns", () => {
  const live = new Set(["svc-1"]);
  const found = (content: SiteContent, assets: string[] | null = ["asset-1"]) => publishIssues(content, live, assets ? new Set(assets) : null);
  const stops = (content: SiteContent, assets?: string[] | null) => found(content, assets).filter((i) => i.severity === "blocking").map((i) => i.message);
  const warns = (content: SiteContent, assets?: string[] | null) => found(content, assets).filter((i) => i.severity === "warning").map((i) => i.message);

  it("stops for an empty page: no title, no block", () => {
    expect(stops(full({ title: "" }))).toEqual(["Dê um título ao site."]);
    expect(stops(full({ blocks: [] }))).toEqual(["Acrescente pelo menos um bloco."]);
    expect(stops(full({ title: "", blocks: [] }))).toEqual(["Dê um título ao site.", "Acrescente pelo menos um bloco."]);
    expect(warns(full({ title: "", blocks: [] }))).toEqual([]);
  });
  it("stops for a testimony that the person did not authorize, wherever it is, and only for that", () => {
    const quote = (id: string, over: object = {}) => block("quote", id, { quote: "Ótimo", author: "Ana", authorized: false, ...over } as never);
    expect(stops(withBlocks([quote("q")]))).toEqual([expect.stringContaining("confirme que a pessoa autorizou")]);
    expect(stops(withBlocks([box("c", [box("d", [quote("deep")])])]))).toEqual([expect.stringContaining("confirme que a pessoa autorizou")]);
    expect(found(withBlocks([box("c", [quote("deep")])]))[0].blockId).toBe("deep");
    expect(found(withBlocks([quote("q", { authorized: true })]))).toEqual([]);
    // Its other loose ends are warnings: an empty testimony or one with no author is not a safeguard.
    expect(stops(withBlocks([quote("q", { authorized: true, quote: "", author: "" })]))).toEqual([]);
    expect(warns(withBlocks([quote("q", { authorized: true, quote: "", author: "" })]))).toHaveLength(2);
  });
  it("only warns for every other loose end: the page is left without the part that is not ready, and the person decides", () => {
    const loose = withBlocks([
      block("hero", "h", { heading: "", buttonLabel: "Falar", buttonChannel: "whatsapp" }),
      block("text", "t"),
      block("services", "s", { serviceIds: ["gone"] }),
      block("about", "a"),
      block("stats", "st", { items: [{ value: "1", label: "" }] }),
      block("faq", "f", { items: [{ question: "Q?", answer: "" }] }),
      block("cta", "c"),
      box("b", [
        block("heading", "he"),
        block("paragraph", "pa"),
        block("button", "bu"),
        block("link", "li", { anchor: "nowhere" } as never),
        block("image", "im", { assetId: "gone", alt: "" } as never),
        block("image", "im2", { assetId: "", alt: "" } as never),
        block("paragraph", "bg", { text: "x", style: { bgImage: "gone" } } as never),
      ]),
    ]);
    const content = { ...loose, contact: { whatsapp: "", email: "", instagram: "" }, logoAssetId: "gone" };
    const all = found(content);
    expect(all.length).toBeGreaterThan(15);
    expect(all.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(new Set(all.map((i) => i.severity))).toEqual(new Set(["warning"]));
    // The ones that name no block (the logo) are warnings too.
    expect(all.some((i) => i.block === null && i.message.includes("logotipo"))).toBe(true);
  });
  it("always says which it is: nothing is left without a severity, and a page with both lists them in the order found", () => {
    const mixed = full({ title: "", blocks: [block("hero", "h", { heading: "" }), block("quote", "q", { quote: "x", author: "y" } as never)] });
    const all = found(mixed);
    expect(all.every((i) => i.severity === "blocking" || i.severity === "warning")).toBe(true);
    expect(all.map((i) => i.severity)).toEqual(["blocking", "warning", "blocking"]);
  });
});
