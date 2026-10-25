import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  BASELINE,
  BASELINE_VERSION,
  canonicalText,
  changedParts,
  parseTermsContent,
  sameContent,
  termsHash,
  type TermsContent,
} from "@/modules/consentimento/terms";

const student = BASELINE.STUDENT;
const professional = BASELINE.PROFESSIONAL;
const copy = (content: TermsContent): TermsContent => JSON.parse(JSON.stringify(content));

describe("the terms a person accepts once", () => {
  it("hashes the exact words and version, the same way every time, and differently for each audience", async () => {
    const a = await termsHash("STUDENT", BASELINE_VERSION, student);
    const b = await termsHash("PROFESSIONAL", BASELINE_VERSION, professional);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(await termsHash("STUDENT", BASELINE_VERSION, copy(student))).toBe(a);
    // The version name is part of what is proved: the same words under another version hash differently.
    expect(await termsHash("STUDENT", "2099-01-01-000000", student)).not.toBe(a);
  });

  it("puts every word the person sees into the text that is hashed", () => {
    for (const [audience, content] of [["STUDENT", student], ["PROFESSIONAL", professional]] as const) {
      const text = canonicalText(audience, BASELINE_VERSION, content);
      expect(text).toContain(BASELINE_VERSION);
      for (const part of [content.title, content.intro, content.confirmation, ...content.sections.flatMap((s) => [s.heading, s.text])])
        expect(text).toContain(JSON.stringify(part).slice(1, -1));
    }
    // The photos paragraph and its label are part of what the student accepted, even if they decline it.
    for (const part of [student.photos!.heading, student.photos!.text, student.photos!.label])
      expect(canonicalText("STUDENT", BASELINE_VERSION, student)).toContain(JSON.stringify(part).slice(1, -1));
  });

  it("cannot read two different texts as the same: moving words between parts changes the hash", async () => {
    const a = copy(student);
    const b = copy(student);
    a.sections[0] = { heading: "A", text: "B\nC" };
    b.sections[0] = { heading: "A\nB", text: "C" };
    expect(await termsHash("STUDENT", "v", a)).not.toBe(await termsHash("STUDENT", "v", b));
  });

  it("offers the photos choice only to the student, and keeps it out of the required acknowledgement", () => {
    expect(professional.photos).toBeUndefined();
    expect(student.photos?.label).toMatch(/fotos/i);
    // Declining the photos never blocks the acceptance: the required text does not mention them.
    expect(student.confirmation).not.toMatch(/foto/i);
  });

  it("is the text the lawyer approved: not a draft, and saying where the choice of photos can be changed", () => {
    expect(BASELINE_VERSION).not.toMatch(/rascunho/i);
    expect(student.photos!.text).toContain("Minha conta");
  });

  it("states the facts the product relies on, in the words the person reads", () => {
    const text = canonicalText("STUDENT", BASELINE_VERSION, student);
    expect(text).toContain("18 anos");
    expect(text).toContain("15 dias");
    expect(text).toContain("5 anos");
    expect(text).toMatch(/não altera o seu treino sozinha/);
    expect(canonicalText("PROFESSIONAL", BASELINE_VERSION, professional)).toMatch(/não aprova nem libera treino/);
  });
});

describe("words typed by the manager", () => {
  it("accepts the initial text as it is and returns it unchanged", () => {
    expect(parseTermsContent("STUDENT", student)).toEqual(student);
    expect(parseTermsContent("PROFESSIONAL", professional)).toEqual(professional);
  });

  it("trims the edges, keeps paragraphs and reads a line break the same in any browser", () => {
    const typed = copy(student);
    typed.title = "  Novo título  ";
    typed.sections[0].text = "Primeiro parágrafo.\r\n\r\nSegundo parágrafo.\r";
    const parsed = parseTermsContent("STUDENT", typed);
    expect(parsed.title).toBe("Novo título");
    expect(parsed.sections[0].text).toBe("Primeiro parágrafo.\n\nSegundo parágrafo.");
  });

  it("keeps the photos block for the student and refuses one for the professional", () => {
    const withoutPhotos = copy(student);
    delete withoutPhotos.photos;
    expect(() => parseTermsContent("STUDENT", withoutPhotos)).toThrow(ZodError);
    expect(() => parseTermsContent("PROFESSIONAL", { ...copy(professional), photos: student.photos })).toThrow(ZodError);
  });

  it("refuses empty parts, no sections, repeated headings, too many sections, giant text and unknown fields", () => {
    const bad = (change: (content: TermsContent) => void) => {
      const content = copy(student);
      change(content);
      expect(() => parseTermsContent("STUDENT", content)).toThrow(ZodError);
    };
    bad((c) => (c.title = "   "));
    bad((c) => (c.intro = ""));
    bad((c) => (c.confirmation = ""));
    bad((c) => (c.sections = []));
    bad((c) => (c.sections[0].heading = ""));
    bad((c) => (c.sections[0].text = "  "));
    bad((c) => (c.sections[1].heading = c.sections[0].heading));
    bad((c) => (c.sections = Array.from({ length: 21 }, (_, i) => ({ heading: `S${i}`, text: "t" }))));
    bad((c) => (c.sections[0].text = "x".repeat(4001)));
    bad((c) => (c.photos!.label = ""));
    bad((c) => Object.assign(c, { script: "<script>alert(1)</script>" }));
    bad((c) => Object.assign(c.sections[0], { html: "<b>x</b>" }));
  });

  it("recognizes the same words, and lists what changed in plain words", () => {
    expect(sameContent(student, copy(student))).toBe(true);
    const next = copy(student);
    next.title = "Outro título";
    next.sections[0].text = "Mudou.";
    next.sections.push({ heading: "Nova seção", text: "Texto novo." });
    const removed = next.sections.splice(2, 1)[0];
    next.confirmation = "Aceito.";
    next.photos!.text = "Outro texto das fotos.";
    expect(sameContent(student, next)).toBe(false);
    expect(changedParts(student, next)).toEqual([
      "Título alterado",
      `Seção «${student.sections[0].heading}» alterada`,
      "Seção «Nova seção» adicionada",
      `Seção «${removed.heading}» removida`,
      "Frase de confirmação alterada",
      "Bloco das fotos alterado",
    ]);
    expect(changedParts(student, copy(student))).toEqual([]);
    const reordered = copy(student);
    reordered.sections.reverse();
    expect(changedParts(student, reordered)).toEqual(["Ordem das seções alterada"]);
  });
});
