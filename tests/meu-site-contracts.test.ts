import { describe, expect, it } from "vitest";
import {
  MAX_BLOCKS,
  channelUrl,
  emailUrl,
  emptyBlock,
  instagramUrl,
  publishIssues,
  siteContent,
  slugFromName,
  slugSchema,
  starterContent,
  whatsappUrl,
  type SiteContent,
} from "@/modules/meu-site/contracts";

const full = (over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 1,
  title: "Marina Treinos",
  description: "Treino com acompanhamento",
  contact: { whatsapp: "(11) 91234-5678", email: "marina@example.test", instagram: "@marina.treinos" },
  blocks: [
    { id: "a1", type: "hero", heading: "Treino sob medida", subheading: "", buttonLabel: "Falar comigo", buttonChannel: "whatsapp" },
    { id: "a2", type: "text", heading: "Sobre", text: "Texto" },
  ],
  ...over,
});

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
  it("refuses a field that is not part of it, another version, and a block of another kind", () => {
    expect(siteContent.safeParse({ ...full(), html: "<b>x</b>" }).success).toBe(false);
    expect(siteContent.safeParse({ ...full(), schemaVersion: 2 }).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "x", type: "script", src: "https://evil.test" } as never] })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ ...(emptyBlock("text") as object), onClick: "x" } as never] })).success).toBe(false);
  });
  it("bounds the number of blocks, the length of the texts and the repetition of identifiers", () => {
    const many = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({ ...(emptyBlock("text") as object), id: `b${i}` }));
    expect(siteContent.safeParse(full({ blocks: many as never })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: many.slice(0, MAX_BLOCKS) as never })).success).toBe(true);
    expect(siteContent.safeParse(full({ title: "x".repeat(81) })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "same", type: "text", heading: "", text: "a" }, { id: "same", type: "text", heading: "", text: "b" }] })).success).toBe(false);
    expect(siteContent.safeParse(full({ blocks: [{ id: "BAD ID", type: "text", heading: "", text: "a" }] })).success).toBe(false);
  });
  it("keeps the line breaks of a text, refuses control and invisible characters, and keeps markup as plain text", () => {
    const withText = (value: string) => siteContent.safeParse(full({ blocks: [{ id: "t1", type: "text", heading: "", text: value }] }));
    expect(withText("linha 1\r\nlinha 2").success).toBe(true);
    expect(withText("a\u0000b").success).toBe(false);
    expect(withText("a‮b").success).toBe(false);
    const parsed = withText("<script>alert(1)</script>");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect((parsed.data.blocks[0] as { text: string }).text).toBe("<script>alert(1)</script>");
  });
});

describe("what stops a publication", () => {
  const live = new Set(["svc-1"]);
  it("lets a complete page through", () => {
    expect(publishIssues(full(), live)).toEqual([]);
    expect(publishIssues(full({ blocks: [...full().blocks, { id: "s1", type: "services", heading: "Serviços", intro: "", serviceIds: ["svc-1"] }] }), live)).toEqual([]);
  });
  it("asks for a title and for at least one block", () => {
    expect(publishIssues(full({ title: "" }), live).map((i) => i.message)).toContain("Dê um título ao site.");
    expect(publishIssues(full({ blocks: [] }), live).map((i) => i.message)).toContain("Acrescente pelo menos um bloco.");
  });
  it("names the block that is incomplete", () => {
    const issues = publishIssues(
      full({
        blocks: [
          { id: "a", type: "hero", heading: "", subheading: "", buttonLabel: "", buttonChannel: undefined },
          { id: "b", type: "text", heading: "", text: "" },
          { id: "c", type: "services", heading: "S", intro: "", serviceIds: [] },
          { id: "d", type: "faq", heading: "", items: [{ question: "Q?", answer: "" }] },
          { id: "e", type: "cta", heading: "", text: "", buttonLabel: "", buttonChannel: undefined },
        ],
      }),
      live,
    );
    const byBlock = (n: number) => issues.filter((i) => i.block === n).length;
    expect([1, 2, 3, 4, 5].map(byBlock)).toEqual([1, 1, 1, 2, 2]);
    expect(issues[0].message).toContain("Bloco 1 (Destaque)");
  });
  it("does not let a button lead to a contact that is not filled in or is invalid", () => {
    const blocks = [{ id: "a", type: "hero" as const, heading: "H", subheading: "", buttonLabel: "Falar", buttonChannel: "whatsapp" as const }];
    expect(publishIssues(full({ blocks, contact: { whatsapp: "", email: "", instagram: "" } }), live)[0].message).toContain("WhatsApp");
    expect(publishIssues(full({ blocks, contact: { whatsapp: "123", email: "", instagram: "" } }), live)).toHaveLength(1);
    const half = [{ id: "a", type: "hero" as const, heading: "H", subheading: "", buttonLabel: "Falar", buttonChannel: undefined }];
    expect(publishIssues(full({ blocks: half }), live)[0].message).toContain("para onde o botão leva");
  });
  it("does not publish services that left the offer", () => {
    const blocks = [{ id: "s", type: "services" as const, heading: "S", intro: "", serviceIds: ["svc-1", "svc-gone"] }];
    expect(publishIssues(full({ blocks }), live).map((i) => i.message)).toEqual([expect.stringContaining("saiu da oferta")]);
  });
  it("shows that a new site is not publishable until the contact it points to is filled in", () => {
    const issues = publishIssues(starterContent("Marina"), live);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => /WhatsApp/.test(i.message))).toBe(true);
  });
});
