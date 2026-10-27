import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  COLUMN_TYPES,
  MAX_BLOCKS,
  MAX_COLUMN_ITEMS,
  MAX_NODES,
  channelUrl,
  emailUrl,
  emptyBlock,
  instagramUrl,
  parseContent,
  publishIssues,
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
  schemaVersion: 2,
  title: "Marina Treinos",
  description: "Treino com acompanhamento",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  theme: { accent: "blue", mode: "light" },
  blocks: [
    { id: "a1", type: "hero", eyebrow: "", heading: "Treino sob medida", subheading: "", buttonLabel: "Falar comigo", buttonChannel: "whatsapp" },
    { id: "a2", type: "text", eyebrow: "", heading: "Sobre", text: "Texto" },
  ],
  ...over,
});
const withBlocks = (blocks: Block[]) => full({ blocks });
const block = <T extends Block["type"]>(type: T, id: string, over: Partial<Extract<Block, { type: T }>> = {}) =>
  ({ ...emptyBlock(type, id), ...over }) as Block;

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
  it("accepts every kind of block, empty, on the page; the elements also inside a column", () => {
    for (const type of BLOCK_TYPES) {
      const made = emptyBlock(type, `b-${type}`);
      expect(siteContent.safeParse(withBlocks([made])).success, type).toBe(true);
    }
    const columns = block("columns", "c", {
      left: [emptyBlock("heading", "l1"), emptyBlock("paragraph", "l2")] as never,
      right: [emptyBlock("button", "r1")] as never,
    });
    expect(siteContent.safeParse(withBlocks([columns])).success).toBe(true);
  });
  it("refuses a field that is not part of it, another version, and a block of another kind", () => {
    expect(siteContent.safeParse({ ...full(), html: "<b>x</b>" }).success).toBe(false);
    expect(siteContent.safeParse({ ...full(), schemaVersion: 3 }).success).toBe(false);
    expect(siteContent.safeParse({ ...full(), schemaVersion: 1 }).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "x", type: "script", src: "https://evil.test" } as never] })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ ...(emptyBlock("text") as object), onClick: "x" } as never] })).success).toBe(false);
  });
  it("refuses, inside a column, a section and another \"2 columns\": only title, paragraph and button fit", () => {
    expect([...COLUMN_TYPES]).toEqual(["heading", "paragraph", "button"]);
    for (const type of ["hero", "text", "services", "about", "quote", "stats", "faq", "cta", "columns"] as const) {
      const inside = block("columns", "c", { left: [emptyBlock(type, "in")] as never });
      expect(siteContent.safeParse(withBlocks([inside])).success, type).toBe(false);
    }
  });
  it("takes the look from a closed list: an accent and a mode, never a color typed by a person", () => {
    expect(siteContent.safeParse(full({ theme: { accent: "graphite", mode: "dark" } })).success).toBe(true);
    for (const bad of [{ accent: "#ff0000", mode: "light" }, { accent: "blue", mode: "sepia" }, { accent: "blue" }, { accent: "blue", mode: "light", css: "x" }])
      expect(siteContent.safeParse(full({ theme: bad as never })).success, JSON.stringify(bad)).toBe(false);
    expect(siteContent.safeParse({ ...full(), theme: undefined }).success).toBe(false);
  });
  it("bounds the number of blocks, the elements in a column, the total, the length of the texts and the repetition of identifiers", () => {
    const many = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({ ...(emptyBlock("text") as object), id: `b${i}` }));
    expect(siteContent.safeParse(full({ blocks: many as never })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: many.slice(0, MAX_BLOCKS) as never })).success).toBe(true);
    const items = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => emptyBlock("paragraph", `${prefix}${i}`));
    expect(siteContent.safeParse(withBlocks([block("columns", "c", { left: items(MAX_COLUMN_ITEMS, "l") as never })])).success).toBe(true);
    expect(siteContent.safeParse(withBlocks([block("columns", "c", { left: items(MAX_COLUMN_ITEMS + 1, "l") as never })])).success).toBe(false);
    // 5 columns blocks with 6 + 6 elements are 65 blocks in all, over the total.
    const heavy = Array.from({ length: 5 }, (_, i) => block("columns", `c${i}`, { left: items(6, `l${i}-`) as never, right: items(6, `r${i}-`) as never }));
    expect(heavy.length + heavy.length * 12).toBeGreaterThan(MAX_NODES);
    expect(siteContent.safeParse(withBlocks(heavy)).success).toBe(false);
    expect(siteContent.safeParse(full({ title: "x".repeat(81) })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "same", type: "text", eyebrow: "", heading: "", text: "a" }, { id: "same", type: "text", eyebrow: "", heading: "", text: "b" }] })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "BAD ID", type: "text", eyebrow: "", heading: "", text: "a" }] })).success).toBe(false);
  });
  it("does not let an identifier repeat between the page and a column, or between two columns", () => {
    const inside = block("columns", "c", { left: [emptyBlock("heading", "dup")] as never, right: [emptyBlock("paragraph", "dup")] as never });
    expect(siteContent.safeParse(withBlocks([inside])).success).toBe(false);
    const clash = block("columns", "c", { left: [emptyBlock("heading", "a1")] as never });
    expect(siteContent.safeParse(full({ blocks: [...full().blocks, clash] })).success).toBe(false);
  });
  it("keeps the line breaks of a text, refuses control and invisible characters, and keeps markup as plain text", () => {
    const withText = (value: string) => siteContent.safeParse(full({ blocks: [{ id: "t1", type: "text", eyebrow: "", heading: "", text: value }] }));
    expect(withText("linha 1\r\nlinha 2").success).toBe(true);
    expect(withText("a\u0000b").success).toBe(false);
    expect(withText("a\u202eb").success).toBe(false);
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
  it("reads it as version 2: an empty eyebrow on each block, the default look, everything else as it was", () => {
    const upgraded = parseContent(v1);
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.theme).toEqual({ accent: "blue", mode: "light" });
    expect(upgraded.title).toBe("Marina Treinos");
    expect(upgraded.blocks.map((b) => b.type)).toEqual(["hero", "text", "services", "faq", "cta"]);
    for (const b of upgraded.blocks) expect((b as { eyebrow: string }).eyebrow).toBe("");
    expect(upgraded.blocks[0]).toMatchObject({ heading: "Treino sob medida", buttonChannel: "whatsapp" });
    expect(upgraded.blocks[2]).toMatchObject({ serviceIds: ["x"], items: [{ name: "Consultoria", delivery: "ONLINE" }] });
    expect(siteContent.safeParse(upgraded).success).toBe(true);
  });
  it("does not read it if it was not valid then either, and reads version 2 as it is", () => {
    expect(safeParseContent({ ...v1, html: "x" }).success).toBe(false);
    expect(safeParseContent({ ...v1, blocks: [{ id: "q", type: "quote" }] }).success).toBe(false);
    expect(safeParseContent({ ...v1, schemaVersion: 3 }).success).toBe(false);
    expect(safeParseContent(null).success).toBe(false);
    expect(safeParseContent("x").success).toBe(false);
    expect(parseContent(full())).toEqual(full());
    expect(() => parseContent({ ...v1, title: "x".repeat(81) })).toThrow();
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
  it("looks inside the columns: empty ones, empty elements and a button that leads nowhere, each with the element's id", () => {
    expect(messages(withBlocks([block("columns", "c")]))).toEqual([expect.stringContaining("colunas estão vazias")]);
    const columns = block("columns", "c", {
      left: [emptyBlock("heading", "h"), { ...emptyBlock("paragraph", "p"), text: "ok" }] as never,
      right: [{ ...emptyBlock("button", "b"), label: "Falar", channel: "whatsapp" }, emptyBlock("button", "b2")] as never,
    });
    const issues = publishIssues(full({ blocks: [columns], contact: { whatsapp: "", email: "", instagram: "" } }), live);
    expect(issues.map((i) => i.blockId)).toEqual(["h", "b", "b2"]);
    expect(issues[0].message).toContain("coluna da esquerda, elemento 1 (Título)");
    expect(issues[1].message).toContain("coluna da direita");
    expect(issues[1].message).toContain("WhatsApp");
    expect(messages(full({ blocks: [{ ...columns, left: [{ ...emptyBlock("heading", "h"), text: "Oi" }] as never, right: [{ ...emptyBlock("button", "b"), label: "Falar", channel: "whatsapp" }] as never } as Block] }))).toEqual([]);
  });
  it("checks the elements that stand on the page by themselves, as the ones in a column", () => {
    expect(messages(withBlocks([block("heading", "h"), block("paragraph", "p"), block("button", "b")])).length).toBe(3);
    expect(messages(withBlocks([block("heading", "h", { text: "Oi" }), block("paragraph", "p", { text: "Texto" }), block("button", "b", { label: "Falar", channel: "whatsapp" })]))).toEqual([]);
  });
  it("shows that a new site is not publishable until the contact it points to is filled in", () => {
    const issues = publishIssues(starterContent("Marina"), live);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => /WhatsApp/.test(i.message))).toBe(true);
  });
});
