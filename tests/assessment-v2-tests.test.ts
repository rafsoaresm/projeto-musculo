import { describe, expect, it } from "vitest";
import { FORMULA_VERSION } from "@/modules/avaliacoes/formulas";
import {
  EMPTY_MOVEMENT,
  FLEXITEST_CODES,
  FLEXITEST_LABEL,
  filledText,
  movementEmpty,
  movementFormFrom,
  movementFromForm,
  movementIssueNames,
  movementSchema,
  readMovement,
  totalText,
} from "@/modules/avaliacoes/v2/flexitest";
import {
  EMPTY_TESTS,
  parseDistance,
  readTests,
  testsEmpty,
  testsFormFrom,
  testsFromForm,
  testsIssueNames,
  testsSchema,
  type TestsForm,
} from "@/modules/avaliacoes/v2/physical-tests";
import { EMPTY_CONCLUSION, conclusionEmpty, conclusionFromForm, conclusionSchema, readConclusion } from "@/modules/avaliacoes/v2/conclusion";
import { COOPER_VO2_METHOD, EXACT_METHODS, formatResult, isEstimate, methodLabel, reviewDraft } from "@/modules/avaliacoes/v2/review";
import { EMPTY_PROFILE, screeningSchema } from "@/modules/avaliacoes/v2/screening";

// Slice 0.80: the Flexiteste, the physical tests and the final considerations (handoff 3.4, 3.5 and 5; Figma AV-05 and AV-06).
const PARQ_CODES = ["heart_condition", "chest_pain_activity", "chest_pain_month", "dizziness", "bone_joint", "blood_pressure_medication", "other_reason"];
const screening = screeningSchema.parse({ parq: { answers: Object.fromEntries(PARQ_CODES.map((code) => [code, "no"])) } });
const base = { profile: EMPTY_PROFILE, screening, composition: null, assessedOn: "2026-11-10", birthDate: "1999-03-04" };
/** The handoff's example (section 8): 32 points. */
const PDF_LEVELS = [2, 3, 2, 2, 1, 1, 2, 3, 3, 2, 2, 3, 2, 2, 2] as const;
const fullLevels = Object.fromEntries(FLEXITEST_CODES.map((code, index) => [code, PDF_LEVELS[index]]));
const testsForm = (patch: Partial<TestsForm> = {}): TestsForm => ({ ...testsFormFrom(EMPTY_TESTS), ...patch });

describe("the Flexiteste (module “movement”)", () => {
  it("has the 15 movements of the PDF in order, and starts empty: no level is a 0", () => {
    expect(FLEXITEST_CODES).toHaveLength(15);
    expect(FLEXITEST_LABEL.shoulder_horizontal_abduction).toBe("Abdução horizontal dos ombros");
    expect(FLEXITEST_LABEL.ankle_plantar_flexion).toBe("Flexão plantar");
    expect(EMPTY_MOVEMENT).toEqual({ flexitest: { variant: "pdf_15_movements_1_to_4", levels: {}, classificationManual: "", notes: "" } });
    expect(movementEmpty(EMPTY_MOVEMENT)).toBe(true);
    expect(readMovement(undefined)).toEqual(EMPTY_MOVEMENT);
    expect(readMovement({ flexitest: { levels: { knee_flexion: 0 } } })).toEqual(EMPTY_MOVEMENT);
  });
  it("takes only whole levels 1 to 4 of a known movement, of this variant: 0, 5, 2.5, an unknown movement or another variant are refused", () => {
    expect(movementSchema.safeParse({ flexitest: { levels: { knee_flexion: 4, wrist_flexion: 1 } } }).success).toBe(true);
    for (const level of [0, 5, 2.5, -1, "2", null]) expect(movementSchema.safeParse({ flexitest: { levels: { knee_flexion: level } } }).success).toBe(false);
    expect(movementSchema.safeParse({ flexitest: { levels: { neck_flexion: 2 } } }).success).toBe(false);
    expect(movementSchema.safeParse({ flexitest: { levels: { constructor: 2 } } }).success).toBe(false);
    expect(movementSchema.safeParse({ flexitest: { variant: "flexitest_20_movements_0_to_4" } }).success).toBe(false);
    expect(movementSchema.safeParse({ flexitest: { classificationManual: "x".repeat(1001) } }).success).toBe(false);
    expect(movementSchema.safeParse({ flexitest: {}, extra: 1 }).success).toBe(false);
    const refused = movementSchema.safeParse({ flexitest: { levels: { knee_flexion: 0 }, notes: "x".repeat(1001) } });
    expect(movementIssueNames(refused.error!.issues)).toEqual(["Flexão do joelho", "Observações do Flexiteste"]);
  });
  it("reads the screen and comes back unchanged; a text above the ceiling is named, never cut", () => {
    const read = movementFromForm({ levels: { knee_flexion: 3, shoulder_abduction: 2 }, classificationManual: "Médio (-)", notes: "Sem dor" });
    expect(read.payload).toEqual({ flexitest: { variant: "pdf_15_movements_1_to_4", levels: { shoulder_abduction: 2, knee_flexion: 3 }, classificationManual: "Médio (-)", notes: "Sem dor" } });
    expect(movementFormFrom(read.payload!)).toEqual({ levels: { shoulder_abduction: 2, knee_flexion: 3 }, classificationManual: "Médio (-)", notes: "Sem dor" });
    expect(movementFromForm({ levels: {}, classificationManual: "x".repeat(1001), notes: "" }).problems).toEqual(["Classificação do Flexiteste"]);
  });
  it("records the handoff example as 32 points, only when all 15 are filled; a partial sum is never a total", () => {
    const complete = reviewDraft({ ...base, movement: movementSchema.parse({ flexitest: { levels: fullLevels } }) });
    expect(complete.results).toEqual([
      {
        code: "flexitest_total",
        value: 32,
        unit: "pontos",
        method: EXACT_METHODS.flexitest,
        formulaVersion: FORMULA_VERSION,
        inputs: { variant: "pdf_15_movements_1_to_4", levels: fullLevels },
        flags: [],
      },
    ]);
    expect(complete.modules.find((module) => module.key === "movimento")?.lines).toContain("Flexiteste: 15 de 15 preenchidos; total 32 pontos");
    const partialLevels = { ...fullLevels };
    delete (partialLevels as Record<string, number>).knee_flexion;
    const partial = reviewDraft({ ...base, movement: movementSchema.parse({ flexitest: { levels: partialLevels } }) });
    expect(partial.results).toEqual([]);
    expect(partial.notComputed).toEqual(["Flexiteste: o total só existe com os 15 movimentos (14 de 15 preenchidos)"]);
    expect(partial.modules.find((module) => module.key === "movimento")).toMatchObject({ state: "observed", lines: ["Postura e somatotipo: não realizados", "Flexiteste: 14 de 15 preenchidos"] });
    expect(filledText(1)).toBe("1 de 15 preenchido");
    expect(totalText(null)).toBe("Só com os 15 movimentos");
    expect(totalText(32)).toBe("32 pontos");
    expect(formatResult("flexitest_total", 32, "pontos")).toBe("32 pontos");
    // Arithmetic on the levels, not an estimate, and no classification in the result.
    expect(isEstimate(EXACT_METHODS.flexitest)).toBe(false);
  });
  it("says the professional's classification is theirs, and the step is “Não realizado” when nothing was filled", () => {
    const written = reviewDraft({ ...base, movement: movementSchema.parse({ flexitest: { classificationManual: "Médio (-)" } }) });
    expect(written.results).toEqual([]);
    expect(written.modules.find((module) => module.key === "movimento")?.lines).toEqual([
      "Postura e somatotipo: não realizados",
      "Flexiteste: 0 de 15 preenchidos",
      "Classificação do Flexiteste escrita pelo profissional: Médio (-)",
    ]);
    expect(reviewDraft({ ...base, movement: EMPTY_MOVEMENT }).modules.find((module) => module.key === "movimento")).toMatchObject({ state: "not_done", lines: ["Não realizado"] });
  });
});

describe("the physical tests (module “tests”)", () => {
  it("starts empty: no count, no distance, never 0", () => {
    expect(EMPTY_TESTS.abdominal.repetitions).toBeNull();
    expect(EMPTY_TESTS.cooper.distanceM).toBeNull();
    expect(testsEmpty(EMPTY_TESTS)).toBe(true);
    expect(readTests({ cooper: { distanceM: 0 } })).toEqual(EMPTY_TESTS);
    expect(reviewDraft({ ...base, tests: EMPTY_TESTS }).modules.find((module) => module.key === "testes")).toMatchObject({ state: "not_done", lines: ["Não realizado"] });
  });
  it("takes 0 repetitions as a result (a count), but not a negative, a fraction or a 0 distance; a date must be a real day", () => {
    expect(testsSchema.safeParse({ abdominal: { repetitions: 0 } }).success).toBe(true);
    expect(testsSchema.safeParse({ abdominal: { repetitions: -1 } }).success).toBe(false);
    expect(testsSchema.safeParse({ upperLimb: { repetitions: 2.5 } }).success).toBe(false);
    expect(testsSchema.safeParse({ upperLimb: { durationSeconds: 0 } }).success).toBe(false);
    expect(testsSchema.safeParse({ cooper: { distanceM: 0 } }).success).toBe(false);
    expect(testsSchema.safeParse({ cooper: { distanceM: -2200 } }).success).toBe(false);
    expect(testsSchema.safeParse({ cooper: { testedOn: "2026-02-30" } }).success).toBe(false);
    expect(testsSchema.safeParse({ cooper: { testedOn: "2026-11-03" } }).success).toBe(true);
    expect(testsSchema.safeParse({ cooper: { vo2: 40 } }).success).toBe(false);
    const refused = testsSchema.safeParse({ abdominal: { repetitions: -1 }, cooper: { distanceM: 0 } });
    expect(testsIssueNames(refused.error!.issues)).toEqual(["Repetições completas (resistência abdominal)", "Distância percorrida (Cooper)"]);
  });
  it("reads Brazilian numbers: “2.200” is 2200 m (as the PDF writes it), “2200,5” too; a letter or a fraction of a repetition is named", () => {
    expect(parseDistance("2.200")).toBe(2200);
    expect(parseDistance("12.000,5")).toBe(12000.5);
    expect(parseDistance("2200,5")).toBe(2200.5);
    expect(parseDistance("2,2")).toBe(2.2);
    expect(parseDistance("2.2")).toBe(2.2);
    expect(parseDistance("dois mil")).toBeNull();
    const read = testsFromForm(
      testsForm({
        abdominal: { exercise: "Abdominal 1 min", repetitions: "35", durationSeconds: "60", conditions: "", notes: "", classificationManual: "" },
        cooper: { distanceM: "2.200", testedOn: "2026-11-02", location: "Pista", conditions: "Seco, 24 °C", contraindications: "", notes: "", classificationManual: "" },
      }),
    );
    expect(read.payload?.abdominal).toMatchObject({ exercise: "Abdominal 1 min", repetitions: 35, durationSeconds: 60 });
    expect(read.payload?.upperLimb.repetitions).toBeNull();
    expect(read.payload?.cooper).toMatchObject({ distanceM: 2200, testedOn: "2026-11-02", location: "Pista" });
    expect(testsFormFrom(read.payload!).cooper.distanceM).toBe("2200");
    const bad = testsFromForm(
      testsForm({
        upperLimb: { exercise: "", repetitions: "22,5", durationSeconds: "", conditions: "", notes: "", classificationManual: "" },
        cooper: { ...testsForm().cooper, distanceM: "abc", testedOn: "31/02/2026" },
      }),
    );
    expect(bad.problems).toEqual(["Repetições completas (resistência de membros superiores)", "Distância percorrida (Cooper)", "Data do teste (Cooper)"]);
  });
  it("records the Cooper example of the handoff: 2200 m gives 11,0 km/h and VO₂ ~37,90 (estimated), never forced to the PDF's 37,69", () => {
    const tests = testsSchema.parse({ cooper: { distanceM: 2200 } });
    const review = reviewDraft({ ...base, tests });
    const speed = review.results.find((row) => row.code === "cooper_speed_kmh")!;
    const vo2 = review.results.find((row) => row.code === "cooper_vo2_estimate")!;
    expect(speed).toMatchObject({ value: 11, unit: "km/h", method: EXACT_METHODS.cooperSpeed, formulaVersion: FORMULA_VERSION, flags: [] });
    expect(vo2.value).toBeCloseTo(37.9, 2);
    expect(vo2.value).not.toBeCloseTo(37.69, 2);
    expect(vo2).toMatchObject({ unit: "ml/kg/min", method: COOPER_VO2_METHOD, inputs: { distanceM: 2200, durationMin: 12, testedOn: null } });
    expect(formatResult("cooper_speed_kmh", 11, "km/h")).toBe("11,0 km/h");
    expect(formatResult("cooper_vo2_estimate", vo2.value, "ml/kg/min")).toBe("37,90 ml/kg/min");
    expect(isEstimate(COOPER_VO2_METHOD)).toBe(true);
    expect(isEstimate(EXACT_METHODS.cooperSpeed)).toBe(false);
    expect(methodLabel(COOPER_VO2_METHOD)).toBe("Cooper 12 min, (distância − 504,9) ÷ 44,73");
    expect(review.modules.find((module) => module.key === "testes")?.lines).toEqual([
      "Resistência abdominal: não realizado",
      "Resistência de membros superiores: não realizado",
      "Cooper: 2.200 m em 12 min",
    ]);
  });
  it("records no VO₂ where the equation gives no positive value, and says why; the speed stays", () => {
    const review = reviewDraft({ ...base, tests: testsSchema.parse({ cooper: { distanceM: 400 } }) });
    expect(review.results.map((row) => row.code)).toEqual(["cooper_speed_kmh"]);
    expect(review.notComputed).toEqual(["Cooper, VO₂máx estimado: com esta distância a equação não dá um valor positivo"]);
  });
  it("summarises the repetitions as typed (0 included) and says a classification is the professional's", () => {
    const tests = testsSchema.parse({ abdominal: { repetitions: 0, classificationManual: "Fraco" }, upperLimb: { exercise: "Flexão de braço", repetitions: 22 } });
    const review = reviewDraft({ ...base, tests });
    expect(review.results).toEqual([]);
    expect(review.modules.find((module) => module.key === "testes")).toMatchObject({
      state: "filled",
      lines: [
        "Resistência abdominal: 0 repetições completas",
        "Resistência de membros superiores: 22 repetições completas · Flexão de braço",
        "Cooper: não realizado",
        "Classificação: escrita pelo profissional (nenhuma tabela homologada)",
      ],
    });
  });
});

describe("the final considerations (module “conclusion”)", () => {
  it("keeps the professional's four texts as typed, refuses a longer text, and reads anything else as empty", () => {
    expect(conclusionEmpty(EMPTY_CONCLUSION)).toBe(true);
    const read = conclusionFromForm({ considerations: "Quadril esquerdo aduzido.\nSem dor.", recommendations: "", limitations: "", referrals: "Avaliação médica" });
    expect(read.payload).toEqual({ considerations: "Quadril esquerdo aduzido.\nSem dor.", recommendations: "", limitations: "", referrals: "Avaliação médica" });
    expect(conclusionFromForm({ ...EMPTY_CONCLUSION, limitations: "x".repeat(4001) }).problems).toEqual(["Limitações observadas"]);
    expect(conclusionSchema.safeParse({ approved: true }).success).toBe(false);
    expect(readConclusion({ considerations: 3 })).toEqual(EMPTY_CONCLUSION);
  });
});
