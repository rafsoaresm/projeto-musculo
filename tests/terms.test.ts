import { describe, expect, it } from "vitest";
import { TERMS, TERMS_ARE_DRAFT, TERMS_VERSION, canonicalText, termsHash } from "@/modules/consentimento/terms";

describe("the terms a person accepts once", () => {
  it("hashes the exact words, the same way every time, and differently for each audience", async () => {
    const student = await termsHash("STUDENT");
    const professional = await termsHash("PROFESSIONAL");
    expect(student).toMatch(/^[0-9a-f]{64}$/);
    expect(professional).toMatch(/^[0-9a-f]{64}$/);
    expect(student).not.toBe(professional);
    expect(await termsHash("STUDENT")).toBe(student);
  });

  it("puts the version and every word the person sees into the text that is hashed", () => {
    for (const audience of ["STUDENT", "PROFESSIONAL"] as const) {
      const text = canonicalText(audience);
      const terms = TERMS[audience];
      expect(text.startsWith(`${TERMS_VERSION}\n${audience}\n`)).toBe(true);
      for (const part of [terms.title, terms.intro, terms.confirmation, ...terms.sections.flatMap((s) => [s.heading, s.text])])
        expect(text).toContain(part);
    }
    // The photos paragraph and its label are part of what the student accepted, even if they decline it.
    const photos = TERMS.STUDENT.photos!;
    for (const part of [photos.heading, photos.text, photos.label]) expect(canonicalText("STUDENT")).toContain(part);
  });

  it("offers the photos choice only to the student, and keeps it out of the required acknowledgement", () => {
    expect(TERMS.PROFESSIONAL.photos).toBeUndefined();
    expect(TERMS.STUDENT.photos?.label).toMatch(/fotos/i);
    // Declining the photos never blocks the acceptance: the required text does not mention them.
    expect(TERMS.STUDENT.confirmation).not.toMatch(/foto/i);
  });

  it("is plainly marked as a draft until a reviewed version replaces it", () => {
    expect(TERMS_ARE_DRAFT).toBe(true);
    expect(TERMS_VERSION).toContain("rascunho");
  });

  it("states the facts the product relies on, in the words the person reads", () => {
    const student = canonicalText("STUDENT");
    expect(student).toContain("18 anos");
    expect(student).toContain("15 dias");
    expect(student).toContain("5 anos");
    expect(student).toMatch(/não altera o seu treino sozinha/);
    expect(canonicalText("PROFESSIONAL")).toMatch(/não aprova nem libera treino/);
  });
});
