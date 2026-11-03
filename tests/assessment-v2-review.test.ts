import { describe, expect, it } from "vitest";
import { compositionSchema } from "@/modules/avaliacoes/v2/composition";
import { EMPTY_PROFILE, draftScreening, screeningSchema, type ScreeningPayload } from "@/modules/avaliacoes/v2/screening";
import { FLAG_LABEL, formatResult, methodLabel, newYesAnswers, recordedScreening, reviewDraft } from "@/modules/avaliacoes/v2/review";

// The pure rule of the "Revisão" step and of the finalize (slice 0.77): what blocks, what is recorded, and why the rest is not.
const PARQ_CODES = ["heart_condition", "chest_pain_activity", "chest_pain_month", "dizziness", "bone_joint", "blood_pressure_medication", "other_reason"];
const screening = (yes: string[] = [], review: { decision: "cleared" | "medical_clearance" | "other" | null; notes: string } = { decision: null, notes: "" }): ScreeningPayload =>
  screeningSchema.parse({ parq: { answers: Object.fromEntries(PARQ_CODES.map((code) => [code, yes.includes(code) ? "yes" : "no"])), professionalReview: review } });
const JP7 = compositionSchema.parse({
  weightKg: 69.1,
  heightCm: 171,
  protocol: "jackson_pollock_7",
  equation: "male",
  skinfolds: { chest: [12], midaxillary: [9], triceps: [24], subscapular: [11], abdominal: [16], suprailiac: [15], thigh: [35], calf_medial: [17] },
});
const base = { profile: EMPTY_PROFILE, assessedOn: "2026-11-10", birthDate: "1999-03-04" };

describe("reviewDraft", () => {
  it("blocks the finalize until every PAR-Q question is answered, and asks for the decision with a note on a “Sim”", () => {
    expect(reviewDraft({ ...base, screening: null, composition: null }).pending).toEqual(["PAR-Q: 7 de 7 perguntas sem resposta"]);
    expect(reviewDraft({ ...base, screening: screening(["dizziness"]), composition: null }).pending).toEqual([
      "PAR-Q com “Sim”: registre a decisão profissional",
      "PAR-Q com “Sim”: escreva a nota da decisão",
    ]);
    const decided = reviewDraft({ ...base, screening: screening(["dizziness"], { decision: "cleared", notes: "Sem restrição." }), composition: null });
    expect(decided.pending).toEqual([]);
    expect(decided.riskFlag).toBe(true);
    // Medidas not done do not block: they are said as not done, never as a 0.
    expect(decided.results).toEqual([]);
    expect(decided.modules.find((module) => module.key === "medidas")).toMatchObject({ state: "not_done", lines: ["Não realizado"] });
  });

  it("computes the handoff example with the versioned formulas: 122 mm, ~17,27%, ~11,94 kg, IMC ~23,63, and only the protocol's sites", () => {
    const review = reviewDraft({ ...base, screening: screening(), composition: JP7 });
    const value = (code: string) => review.results.find((row) => row.code === code)?.value;
    expect(value("sum_skinfolds")).toBe(122);
    expect(value("body_fat_percent")).toBeCloseTo(17.27, 2);
    expect(value("fat_mass_kg")).toBeCloseTo(11.94, 2);
    expect(value("bmi")).toBeCloseTo(23.63, 2);
    const fat = review.results.find((row) => row.code === "body_fat_percent")!;
    expect(fat).toMatchObject({ method: "jackson_pollock_7_1978_male", unit: "%", flags: [] });
    expect(Object.keys(fat.inputs.sitesMm as object)).not.toContain("calf_medial");
    expect(review.notComputed).toEqual([]);
    expect(review.modules.find((module) => module.key === "medidas")?.lines).toContain("Outras dobras guardadas: Panturrilha medial");
  });

  it("records nothing it cannot compute and says why (no protocol, no equation, a missing site, no birth date, no weight)", () => {
    const why = (composition: object, birthDate: string | null = base.birthDate) =>
      reviewDraft({ ...base, birthDate, screening: screening(), composition: compositionSchema.parse(composition) });
    expect(why({ skinfolds: { thigh: [35] } }).notComputed).toEqual(["Gordura estimada: escolha o protocolo de dobras"]);
    expect(why({ ...JP7, equation: "not_selected" }).notComputed).toEqual(["Gordura estimada: escolha a referência da equação"]);
    expect(why({ ...JP7, skinfolds: Object.fromEntries(Object.entries(JP7.skinfolds).filter(([site]) => site !== "thigh")) }).notComputed).toEqual(["Gordura estimada: aguardando medidas de Coxa"]);
    expect(why(JP7, null).notComputed).toEqual(["Gordura estimada: sem idade, falta a data de nascimento no cadastro"]);
    const noWeight = why({ ...JP7, weightKg: null });
    expect(noWeight.results.map((row) => row.code)).toEqual(["sum_skinfolds", "body_density", "body_fat_percent"]);
    expect(noWeight.notComputed).toEqual(["IMC: falta o peso", "Massa gorda e massa livre de gordura: falta o peso"]);
    expect(why({ ...JP7, aggregation: "single", skinfolds: { ...JP7.skinfolds, chest: [12, 13] } }).notComputed[0]).toContain("Leitura única");
  });

  it("marks a result outside the original validation population (a flag, never a classification)", () => {
    const review = reviewDraft({ ...base, birthDate: "1950-01-01", screening: screening(), composition: JP7 });
    expect(review.results.find((row) => row.code === "body_fat_percent")?.flags).toEqual(["outside_validation_population"]);
    expect(FLAG_LABEL.outside_validation_population).toBe("Fora da faixa original de validação");
  });

  it("asks an amendment with a new “Sim” for the decision to be looked at again", () => {
    const original = screening(["dizziness"], { decision: "cleared", notes: "Ok." });
    expect(newYesAnswers(screening(["dizziness", "bone_joint"]), original)).toEqual(["bone_joint"]);
    const same = reviewDraft({ ...base, composition: null, screening: screening(["dizziness", "bone_joint"], { decision: "cleared", notes: "Ok." }), original: { screening: original } });
    expect(same.pending).toEqual(["Retificação com nova resposta “Sim” no PAR-Q: revise a decisão profissional e a nota"]);
    const looked = reviewDraft({ ...base, composition: null, screening: screening(["dizziness", "bone_joint"], { decision: "cleared", notes: "Ok, joelho avaliado." }), original: { screening: original } });
    expect(looked.pending).toEqual([]);
    // Without a new "Sim", the amendment keeps the decision as it was.
    expect(reviewDraft({ ...base, composition: null, screening: screening(["dizziness"], { decision: "cleared", notes: "Ok." }), original: { screening: original } }).pending).toEqual([]);
  });
});

describe("what the server writes and what it never takes from a save", () => {
  it("records the derived flag and who decided and when, only with a decision", () => {
    const recorded = recordedScreening(screening(["dizziness"], { decision: "other", notes: "Treino leve." }), "u-1", "2026-11-10T15:00:00.000Z");
    expect(recorded.parq.riskFlag).toBe(true);
    expect(recorded.parq.professionalReview).toEqual({ decision: "other", notes: "Treino leve.", reviewedAt: "2026-11-10T15:00:00.000Z", reviewerUserId: "u-1" });
    expect(recordedScreening(screening(), "u-1", "x").parq).toMatchObject({ riskFlag: false, professionalReview: { decision: null, notes: "" } });
  });
  it("drops a decision stamp or a flag sent with a save", () => {
    const forged = screeningSchema.parse({ parq: { riskFlag: false, professionalReview: { decision: "cleared", notes: "x", reviewedAt: "2020-01-01", reviewerUserId: "someone" } } });
    const kept = draftScreening(forged);
    expect(kept.parq.riskFlag).toBeUndefined();
    expect(kept.parq.professionalReview).toEqual({ decision: "cleared", notes: "x" });
  });
});

describe("how a result reads", () => {
  it("names the method (the earlier format's body fat: método desconhecido) and rounds only for the screen", () => {
    expect(methodLabel("legacy_formula_unknown")).toBe("método desconhecido");
    expect(methodLabel("jackson_pollock_7_1978_male")).toBe("Jackson & Pollock · 7, equação masculina");
    expect(methodLabel("faulkner_4_1968")).toBe("Faulkner");
    expect(formatResult("body_fat_percent", 17.2744, "%")).toBe("17,3%");
    expect(formatResult("bmi", 23.6312, "kg/m²")).toBe("23,63 kg/m²");
  });
});
