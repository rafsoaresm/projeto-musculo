import { describe, expect, it } from "vitest";
import { emailKey, leadInput, noteInput, phoneKey, serviceInput, stageMove } from "@/modules/leads/contracts";

describe("how the same person is recognized", () => {
  it("gives one key to a number typed in the different ways people type it", () => {
    const keys = ["(11) 91234-5678", "11912345678", "+55 11 91234-5678", "55 (11) 91234 5678", " 11 9 1234 5678 "].map(phoneKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("11912345678");
  });
  it("does not strip the digits 55 from a number that merely starts with them", () => {
    expect(phoneKey("55 1234 5678")).toBe("5512345678");
    expect(phoneKey("5511912345678")).toBe("11912345678");
  });
  it("keeps a foreign number whole and refuses what cannot be a number", () => {
    expect(phoneKey("+351 912 345 678")).toBe("351912345678");
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey("abc")).toBeNull();
    expect(phoneKey("1".repeat(16))).toBeNull();
  });
  it("lower-cases the address and ignores the spaces around it", () => {
    expect(emailKey("  Ana.Souza@Example.COM ")).toBe("ana.souza@example.com");
  });
});

const valid = { name: "Ana Souza", email: "ana@example.test", source: "INSTAGRAM" };

describe("what a lead may hold", () => {
  it("needs a name and some way to reach the person", () => {
    expect(leadInput.safeParse(valid).success).toBe(true);
    expect(leadInput.safeParse({ ...valid, email: "", phone: "11912345678" }).success).toBe(true);
    expect(leadInput.safeParse({ ...valid, email: "", phone: "" }).success).toBe(false);
    expect(leadInput.safeParse({ ...valid, name: "A" }).success).toBe(false);
    expect(leadInput.safeParse({ ...valid, email: "not-an-address" }).success).toBe(false);
    expect(leadInput.safeParse({ ...valid, email: undefined, phone: "123" }).success).toBe(false);
  });
  it("collapses the spaces of the name and refuses invisible and control characters", () => {
    expect(leadInput.parse({ ...valid, name: "  Ana    Souza " }).name).toBe("Ana Souza");
    expect(leadInput.safeParse({ ...valid, name: "Ana​Souza" }).success).toBe(false);
    expect(leadInput.safeParse({ ...valid, name: "Ana‮Souza" }).success).toBe(false);
  });
  it("does not let anyone choose the site as the origin by hand, nor invent a field", () => {
    expect(leadInput.safeParse({ ...valid, source: "SITE" }).success).toBe(false);
    expect(leadInput.safeParse({ ...valid, source: "TIKTOK" }).success).toBe(false);
    expect(leadInput.safeParse({ ...valid, stage: "WON" }).success).toBe(false);
    expect(leadInput.safeParse({ ...valid, organizationId: "org-b" }).success).toBe(false);
  });
  it("bounds the note and refuses control characters in it, but keeps line breaks", () => {
    expect(leadInput.safeParse({ ...valid, note: "a".repeat(1000) }).success).toBe(true);
    expect(leadInput.safeParse({ ...valid, note: "a".repeat(1001) }).success).toBe(false);
    expect(leadInput.safeParse({ ...valid, note: "linha 1\nlinha 2" }).success).toBe(true);
    expect(leadInput.safeParse({ ...valid, note: "x\u0000y" }).success).toBe(false);
    expect(noteInput.safeParse({ note: "   " }).success).toBe(false);
  });
});

describe("moving a lead along the funnel", () => {
  it("asks why only when the lead is lost, and only then", () => {
    expect(stageMove.safeParse({ to: "LOST" }).success).toBe(false);
    expect(stageMove.safeParse({ to: "LOST", lostReason: "PRICE" }).success).toBe(true);
    expect(stageMove.safeParse({ to: "PROPOSAL", lostReason: "PRICE" }).success).toBe(false);
    expect(stageMove.safeParse({ to: "PROPOSAL" }).success).toBe(true);
    expect(stageMove.safeParse({ to: "LOST", lostReason: "BORED" }).success).toBe(false);
    expect(stageMove.safeParse({ to: "ARCHIVED" }).success).toBe(false);
  });
});

describe("a service", () => {
  it("has a name and a way of being delivered", () => {
    expect(serviceInput.safeParse({ name: "Consultoria online", delivery: "ONLINE" }).success).toBe(true);
    expect(serviceInput.safeParse({ name: "Consultoria online", delivery: "BY_MAIL" }).success).toBe(false);
    expect(serviceInput.safeParse({ name: "C", delivery: "ONLINE" }).success).toBe(false);
    expect(serviceInput.safeParse({ name: "Pacote", delivery: "HYBRID", price: 100 }).success).toBe(false);
  });
});
