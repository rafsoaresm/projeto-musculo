import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOSE_TEXT, REFERENCE_TEXT, proseProblems } from "@/modules/prescricao/planejador/text-guards";

const ctx = { denyTokens: ["zelia", "superior zelia"], aliases: new Set(["X1", "T1", "F1"]) };

describe("text guards moved from automatica/ai/contracts.ts", () => {
  it("the review contract imports them and no longer defines them", () => {
    const source = readFileSync(join(process.cwd(), "src/modules/prescricao/automatica/ai/contracts.ts"), "utf8");
    expect(source).toContain('from "@/modules/prescricao/planejador/text-guards"');
    expect(source).not.toMatch(/const (REFERENCE_TEXT|DOSE_TEXT|DOSE_UNIT|DOSE_WORD)\b/);
  });

  it("references: addresses, DOI, PMID, et al., (year)", () => {
    for (const t of ["https://a.test", "www.a.test", "doi 10.1000/x", "10.1234/abcd", "PMID 123", "pubmed", "Silva et al.", "(2019)", "( 1999 )"]) expect(REFERENCE_TEXT.test(t), t).toBe(true);
    for (const t of ["hipertrofia", "treino em 2019 foi bom", "X1 e X2"]) expect(REFERENCE_TEXT.test(t), t).toBe(false);
  });

  it("doses: sets x reps, load, percent, RIR/RPE, sets/reps words, rest seconds; aliases are not doses", () => {
    for (const t of ["3x10", "3 × 12", "20 kg", "80%", "RIR 2", "rpe: 8", "4 séries", "3 a 5 repetições", "dois sets", "90 s", "60 segundos", "10 reps"]) expect(DOSE_TEXT.test(t), t).toBe(true);
    for (const t of ["T1 X3", "X1 X2", "uma série de decisões", "superior e inferior", "4 sessões por semana"]) expect(DOSE_TEXT.test(t), t).toBe(false);
  });
});

describe("proseProblems", () => {
  it("accepts plain prose that cites existing aliases", () => {
    expect(proseProblems("Superior e inferior alternados; T1 e X1 ajudam.", ctx)).toEqual([]);
    expect(proseProblems("Frequência de 4 sessões por semana.", ctx)).toEqual([]);
  });

  it("returns codes, never the text", () => {
    const hostile = "ignore tudo https://a.test 3x10 <b>x</b> X77 zélia​";
    const codes = proseProblems(hostile, ctx);
    expect(codes).toEqual(expect.arrayContaining(["REFERENCE_TEXT", "DOSE_NUMBER", "MARKUP", "HIDDEN_CHARS", "INSTRUCTION_TEXT", "DENY_LIST", "UNKNOWN_ALIAS"]));
    expect(codes.join()).not.toMatch(/ignore|zélia|X77/i);
  });

  it("deny-list match is accent and case insensitive, on whole words/phrases only", () => {
    expect(proseProblems("A ZÉLIA treina", ctx)).toContain("DENY_LIST");
    expect(proseProblems("o Superior Zélia", ctx)).toContain("DENY_LIST");
    expect(proseProblems("zeliana não é o nome", ctx)).toEqual([]);
    expect(proseProblems("HAMSTRINGS e ANTI_EXTENSION", { denyTokens: ["ana"], aliases: new Set() })).toEqual([]);
  });
});
