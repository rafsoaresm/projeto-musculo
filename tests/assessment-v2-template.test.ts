import { describe, expect, it } from "vitest";
import {
  ORDERABLE_STEPS,
  TEMPLATE_PARTS,
  excludedWithData,
  isStepEnabled,
  maskComposition,
  normalizeParts,
  readEnabledParts,
  stepOrderOf,
  templateInputSchema,
  templateRecord,
  visibleSteps,
  type TemplatePart,
} from "@/modules/avaliacoes/v2/template";
import { readComposition } from "@/modules/avaliacoes/v2/composition";
import { readPosture } from "@/modules/avaliacoes/v2/posture";
import { readMovement } from "@/modules/avaliacoes/v2/flexitest";
import { readTests } from "@/modules/avaliacoes/v2/physical-tests";
import { readScreening } from "@/modules/avaliacoes/v2/screening";
import { reviewDraft } from "@/modules/avaliacoes/v2/review";
import { assessmentReport, reportFingerprint, type ReportInput } from "@/modules/avaliacoes/v2/report";

// Slice 0.85: the models of the Avaliação Física (handoff V2 section 2: "desativar módulos opcionais por template"; section 6: enabledModules).
// The pure rule: which parts are on, the order of the steps, what a part that is off may hold (nothing), and how the review and the report say
// "Não incluído neste modelo" (never "Não realizado", never a 0), without ever blocking the finalize.

const PARQ_CODES = ["heart_condition", "chest_pain_activity", "chest_pain_month", "dizziness", "bone_joint", "blood_pressure_medication", "other_reason"] as const;
const screening = readScreening({ parq: { answers: Object.fromEntries(PARQ_CODES.map((code) => [code, "no"])) } });
const without = (...off: TemplatePart[]) => TEMPLATE_PARTS.filter((part) => !off.includes(part));

describe("the list of parts of a model", () => {
  it("is stored in the order of the steps, without repeats; the order of the list is the order of the steps", () => {
    expect(normalizeParts(["cooper", "basics", "cooper", "conclusion", "flexitest"], ["testes", "medidas", "movimento"])).toEqual([
      "cooper",
      "basics",
      "flexitest",
      "conclusion",
    ]);
    expect(stepOrderOf(normalizeParts(TEMPLATE_PARTS, ["movimento", "testes", "medidas"]))).toEqual(["movimento", "testes", "medidas"]);
    // A step with nothing on keeps the default place after the others (it is not shown anyway).
    expect(stepOrderOf(["cooper"])).toEqual(["testes", "medidas", "movimento"]);
    expect(stepOrderOf(null)).toEqual([...ORDERABLE_STEPS]);
  });

  it("shows Triagem first and Revisão last always, and a middle step only with a part on", () => {
    expect(visibleSteps(null)).toEqual(["triagem", "medidas", "movimento", "testes", "revisao"]);
    expect(visibleSteps(normalizeParts(["cooper", "basics"], ["testes", "medidas", "movimento"]))).toEqual(["triagem", "testes", "medidas", "revisao"]);
    expect(visibleSteps([])).toEqual(["triagem", "revisao"]);
    expect(isStepEnabled([], "triagem")).toBe(true);
    expect(isStepEnabled([], "revisao")).toBe(true);
  });

  it("reads a stored list back: absent is every part; an unknown code is dropped (never guessed on)", () => {
    expect(readEnabledParts(null)).toBeNull();
    expect(readEnabledParts('["basics","x","basics"]')).toEqual(["basics"]);
    expect(readEnabledParts("not json")).toEqual([]);
  });

  it("checks what the editor sends: a name, known parts, the three middle steps once each", () => {
    expect(templateInputSchema.safeParse({ name: "  Corrida ", parts: ["cooper"], stepOrder: ["testes", "medidas", "movimento"] }).success).toBe(true);
    expect(templateRecord(templateInputSchema.parse({ name: "  Corrida ", parts: ["cooper"], stepOrder: ["testes", "medidas", "movimento"] }))).toEqual({
      name: "Corrida",
      enabled: ["cooper"],
    });
    expect(templateInputSchema.safeParse({ name: " ", parts: [], stepOrder: [...ORDERABLE_STEPS] }).success).toBe(false);
    expect(templateInputSchema.safeParse({ name: "A", parts: ["screening"], stepOrder: [...ORDERABLE_STEPS] }).success).toBe(false);
    expect(templateInputSchema.safeParse({ name: "A", parts: [], stepOrder: ["medidas", "medidas", "testes"] }).success).toBe(false);
    expect(templateInputSchema.safeParse({ name: "A".repeat(81), parts: [], stepOrder: [...ORDERABLE_STEPS] }).success).toBe(false);
  });
});

describe("a part that is off", () => {
  const composition = readComposition({ weightKg: 70, heightCm: 170, perimetersCm: { waist: 80, hip: 100 }, boneBreadthsCm: { humerus: 6.5 } });

  it("may hold nothing: a payload with something in it is named; the settings of the protocol are not data", () => {
    expect(excludedWithData("composition", composition, without("breadths", "skinfolds"))).toEqual(["breadths"]);
    expect(excludedWithData("composition", composition, null)).toEqual([]);
    expect(excludedWithData("composition", readComposition({ equation: "male", aggregation: "median" }), without("skinfolds"))).toEqual([]);
    const posture = readPosture({ somatotype: { labels: ["mesomorph"] } });
    expect(excludedWithData("posture", posture, without("somatotype"))).toEqual(["somatotype"]);
    expect(excludedWithData("posture", posture, without("posture"))).toEqual([]);
    expect(excludedWithData("tests", readTests({ cooper: { distanceM: 2200 } }), without("cooper"))).toEqual(["cooper"]);
    expect(excludedWithData("tests", readTests({ cooper: { distanceM: 2200 } }), without("abdominal", "upper_limb"))).toEqual([]);
    expect(excludedWithData("movement", readMovement({ flexitest: { levels: { ankle_dorsiflexion: 2 } } }), without("flexitest"))).toEqual(["flexitest"]);
    expect(excludedWithData("conclusion", { considerations: "x", recommendations: "", limitations: "", referrals: "" }, without("conclusion"))).toEqual([
      "conclusion",
    ]);
  });

  it("is emptied when read (never a 0: absent)", () => {
    const masked = maskComposition(composition, without("basics", "perimeters"));
    expect(masked.weightKg).toBeNull();
    expect(masked.perimetersCm).toEqual({});
    expect(masked.boneBreadthsCm).toEqual({ humerus: 6.5 });
  });
});

describe("the review of a draft made with a model", () => {
  const input = {
    profile: null,
    screening,
    composition: readComposition({ weightKg: 70, heightCm: 170, perimetersCm: { waist: 80, hip: 100 } }),
    tests: readTests({ cooper: { distanceM: 2200 } }),
    assessedOn: "2026-11-03",
    birthDate: "1999-03-04",
  };

  it("says “Não incluído neste modelo” for a step left out (not “Não realizado”), and never blocks the finalize", () => {
    const review = reviewDraft({ ...input, enabled: normalizeParts(["basics"]) });
    expect(review.pending).toEqual([]);
    const byKey = Object.fromEntries(review.modules.map((module) => [module.key, module]));
    expect(byKey.movimento).toMatchObject({ state: "not_included", lines: ["Não incluído neste modelo"] });
    expect(byKey.testes).toMatchObject({ state: "not_included", lines: ["Não incluído neste modelo"] });
    // One form for every part left out: "Part: Não incluído neste modelo", never declined.
    expect(byKey.medidas.lines).toContain("Perímetros corporais: Não incluído neste modelo");
    expect(byKey.medidas.lines).toContain("Dobras cutâneas: Não incluído neste modelo");
    // Only the parts that are on give results: BMI from the basic measures; no waist-hip ratio and no Cooper (left out).
    expect(review.results.map((result) => result.code)).toEqual(["bmi"]);
  });

  it("names each test left out, and a step that is on but empty stays “Não realizado”", () => {
    const review = reviewDraft({ ...input, tests: null, enabled: without("cooper") });
    const testes = review.modules.find((module) => module.key === "testes")!;
    expect(testes.state).toBe("not_done");
    expect(testes.lines).toEqual(["Não realizado", "Teste de Cooper · 12 minutos: Não incluído neste modelo"]);
  });

  it("with nothing measured, still names the Medidas parts left out", () => {
    const medidas = reviewDraft({ ...input, composition: null, enabled: normalizeParts(["basics", "cooper"]) }).modules.find((module) => module.key === "medidas")!;
    expect(medidas).toMatchObject({
      state: "not_done",
      lines: ["Não realizado", "Dobras cutâneas: Não incluído neste modelo", "Perímetros corporais: Não incluído neste modelo", "Diâmetros ósseos: Não incluído neste modelo"],
    });
  });

  it("lists the steps in the model's order, as the step chips do", () => {
    const review = reviewDraft({ ...input, enabled: normalizeParts(["basics", "cooper"], ["testes", "medidas", "movimento"]) });
    expect(review.modules.map((module) => module.key)).toEqual(["triagem", "testes", "medidas", "movimento"]);
  });

  it("without a model is exactly as before", () => {
    expect(reviewDraft({ ...input, enabled: null })).toEqual(reviewDraft(input));
  });
});

describe("the report of an assessment made with a model", () => {
  const base: ReportInput = {
    assessment: {
      id: "as-1",
      assessedOn: "2026-11-03",
      kind: "INITIAL",
      recordedAt: "2026-11-03T15:00:00.000Z",
      recordedByName: "Pro A",
      riskStatus: "CLEAR",
      reviewed: false,
      amendsAssessmentId: null,
      amendReason: null,
      amendedById: null,
    },
    amendsAssessedOn: null,
    amendedAt: null,
    studentName: "Aluno Exemplo",
    organizationName: "Studio A",
    results: [],
    profile: null,
    screening,
    composition: null,
    posture: null,
    movement: null,
    tests: null,
    conclusion: null,
    decidedBy: null,
  };
  const texts = (report: ReturnType<typeof assessmentReport>, title: string) =>
    report.sections.find((section) => section.title === title)!.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : []));

  it("names the model in the header and prints “Não incluído neste modelo” for what it left out", () => {
    const report = assessmentReport({ ...base, template: { name: "Corrida", version: 2 }, enabled: ["cooper"] });
    expect(report.facts).toContainEqual({ label: "Modelo", value: "Corrida (versão 2)" });
    expect(texts(report, "Medidas")).toEqual(["Não incluído neste modelo."]);
    expect(texts(report, "Postura e movimento")).toEqual(["Não incluído neste modelo."]);
    expect(texts(report, "Considerações finais")).toEqual(["Não incluído neste modelo."]);
    const tests = texts(report, "Testes físicos");
    expect(tests.filter((line) => line === "Não incluído neste modelo.")).toHaveLength(2);
    expect(tests).toContain("Não realizado.");
  });

  it("with nothing measured, still prints the Medidas parts left out", () => {
    const report = assessmentReport({ ...base, template: { name: "Corrida", version: 2 }, enabled: ["basics", "cooper"] });
    expect(texts(report, "Medidas")).toEqual([
      "Não realizado.",
      "Dobras cutâneas: Não incluído neste modelo.",
      "Perímetros corporais: Não incluído neste modelo.",
      "Diâmetros ósseos: Não incluído neste modelo.",
    ]);
  });

  it("without a model is as before, with the same fingerprint", async () => {
    const before = assessmentReport(base);
    expect(assessmentReport({ ...base, template: null, enabled: null })).toEqual(before);
    expect(before.facts.some((fact) => fact.label === "Modelo")).toBe(false);
    expect(await reportFingerprint({ ...base, template: null, enabled: null })).toBe(await reportFingerprint(base));
    expect(await reportFingerprint({ ...base, template: { name: "Corrida", version: 1 }, enabled: ["cooper"] })).not.toBe(await reportFingerprint(base));
  });
});
