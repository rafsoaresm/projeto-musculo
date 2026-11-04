import { describe, expect, it } from "vitest";
import type { ResultRow } from "@/db/assessments";
import { SCREENING_ITEMS, type ScreeningKey } from "@/modules/avaliacoes/contracts";
import type { ExerciseRecord } from "@/db/exercises";
import type { PrescribedItemWithDose } from "@/db/prescription";
import type { StudentProfile } from "@/db/student-profile";
import { emptyProfile } from "@/modules/ficha/contracts";
import { EMPTY_SCREENING, type ScreeningPayload } from "@/modules/avaliacoes/v2/screening";
import { EMPTY_POSTURE } from "@/modules/avaliacoes/v2/posture";
import { EMPTY_TESTS } from "@/modules/avaliacoes/v2/physical-tests";
import { EMPTY_CONCLUSION } from "@/modules/avaliacoes/v2/conclusion";
import { toExposureHistory, type ExposureRow } from "@/modules/execucao/exposures";
import { buildEngineInput, goalSuggestions } from "@/modules/prescricao/automatica/build-input";
import { parseGenerationAnswers, type GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import {
  buildCatalog,
  existingItems,
  findingFacts,
  screeningFacts,
  structureFacts,
  type AssessmentRecord,
  type GenerationContext,
} from "@/modules/prescricao/automatica/facts";
import type { ResolvedMetadata } from "@/modules/biblioteca/metadata/status";
import type { FieldValue } from "@/modules/biblioteca/metadata/fields";
import { generate, scheduleOccurrences, type EngineInput, type EngineResult } from "@/modules/prescricao/motor";
import { buildPeriodization } from "@/modules/training/periodization";
import { CATALOG } from "./helpers/motor-fixtures";

// Motor S5, the pure half of the input adapter: mapping of the student's real records, the answers contract, the questions
// asked for what is missing (topic 7, "Dados ausentes") and the screening as flags only (topic 6, "Triagem com alertas").

const PARQ = ["heart_condition", "chest_pain_activity", "chest_pain_month", "dizziness", "bone_joint", "blood_pressure_medication", "other_reason"] as const;
const screening = (yes: string[] = [], decision: "cleared" | "medical_clearance" | "other" | null = null, unanswered: string[] = []): ScreeningPayload => ({
  ...EMPTY_SCREENING,
  anamnesis: { injuries: { answer: "yes", details: "SEGREDO-ANAMNESE" }, smoking: { answer: "no", details: "" } },
  parq: {
    ...EMPTY_SCREENING.parq,
    answers: Object.fromEntries(PARQ.filter((c) => !unanswered.includes(c)).map((c) => [c, yes.includes(c) ? "yes" : "no"])),
    professionalReview: { decision, notes: decision ? "SEGREDO-NOTA" : "" },
  },
});
const RESULT: ResultRow = {
  code: "body_fat_percent", value: 17.27, unit: "%", method: "jackson_pollock_7_male", formulaVersion: "2026.11", inputs: null,
  flags: ["outside_validation_population"],
};
const assessment = (over: Partial<AssessmentRecord> = {}): AssessmentRecord => ({
  id: "as-1", assessedOn: "2026-11-02", recordedAt: "2026-11-02T15:00:00.000Z", formatVersion: 2,
  standing: { risk: "CLEAR", reviewed: false, reviewedAt: null }, legacy: null, profile: { goals: ["hypertrophy", "health"], goalNotes: "SEGREDO-OBJ" },
  screening: screening(), posture: { ...EMPTY_POSTURE, findings: { lateral_shoulders: ["protracted"], lateral_hip: ["aligned"] }, notes: { lateral: "SEGREDO-POSTURA", posterior: "", anterior: "" } },
  movement: { flexitest: { variant: "pdf_15_movements_1_to_4", levels: { hip_flexion: 2, elbow_flexion: 3 }, classificationManual: "SEGREDO-FLEX", notes: "" } },
  tests: { ...EMPTY_TESTS, abdominal: { ...EMPTY_TESTS.abdominal, repetitions: 30, exercise: "SEGREDO-TESTE" } },
  conclusion: { ...EMPTY_CONCLUSION, limitations: "SEGREDO-CONCLUSAO" },
  results: [RESULT],
  ...over,
});
const profile = (over: Partial<StudentProfile> = {}): StudentProfile => ({
  ...emptyProfile, studentId: "st-1", updatedAt: "2026-11-01T10:00:00.000Z",
  level: "Intermediário", goal: "Hipertrofia", daysPerWeek: 2, sessionMinutes: 60,
  equipment: "SEGREDO-EQUIP halteres", injuries: "SEGREDO-LESAO",
  ...over,
});
const V2 = {
  schemaVersion: 2, startDate: "2026-11-23",
  phases: [
    { name: "Base", weeks: 2, sessionsPerWeek: 3, workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: null }], trainingDays: [0, 2, 4] },
    { name: null, weeks: 1, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 2, focus: { minutes: 40, note: "SEGREDO-FOCO" } }] },
  ],
};
const ctxOf = (over: Partial<GenerationContext> = {}): GenerationContext => ({
  asOf: "2026-11-20",
  plan: { id: "plan-1", studentId: "st-1", title: "Plano" },
  revision: { id: "rev-1", state: "DRAFT", contentVersion: 4, prescriptionModel: "TEMPLATE", schedule: buildPeriodization(V2) },
  profile: profile(),
  assessment: assessment(),
  catalog: CATALOG,
  catalogHash: "c".repeat(64),
  cautionTagsUnknown: [],
  history: { window: { since: "2026-05-24", until: "2026-11-20", sinceDays: 180, sessions: 0, truncated: false }, summary: toExposureHistory([]) },
  existing: [],
  ...over,
});
const FULL: GenerationAnswersInput = {
  stimulusByPhase: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" }, { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" }],
  exerciseCountByWorkout: [{ phaseIndex: 1, label: "B", count: 3 }],
  equipmentCodes: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE"],
};
const build = (ctx: GenerationContext, answers: GenerationAnswersInput = FULL) => {
  const out = buildEngineInput(ctx, parseGenerationAnswers(answers));
  if (!out.ok) throw new Error(out.code);
  return out;
};
const selection = (r: EngineResult) => r.occurrences.map((o) => `${o.phaseIndex}/${o.week}/${o.slot}:${o.items.map((i) => i.exerciseId).join(",")}`);

describe("the answers contract (GenerationAnswers)", () => {
  it("is strict: unknown fields, codes outside the library vocabulary, repeated targets and out-of-range numbers are refused", () => {
    const bad = (raw: unknown) => expect(() => parseGenerationAnswers(raw)).toThrow();
    bad({ organizationId: "org-b" });
    bad({ equipmentCodes: ["BARBEL"] });
    bad({ equipmentCodes: [] });
    bad({ excludedPatterns: ["SQUATS"] });
    bad({ stimulusByPhase: [{ phaseIndex: 1, value: "X", basis: "PROFESSIONAL" }, { phaseIndex: 1, value: "Y", basis: "PROFESSIONAL" }] });
    bad({ stimulusByPhase: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "HEURISTIC_ACCEPTED" }] });
    bad({ phaseCoverage: [{ phaseIndex: 1, patterns: ["SQUAT"], basis: "HEURISTIC_ACCEPTED" }] });
    bad({ stimulusByPhase: [{ phaseIndex: 13, value: "X", basis: "PROFESSIONAL" }] });
    bad({ exerciseCountByWorkout: [{ phaseIndex: 1, label: "A", count: 0 }] });
    bad({ availableMinutes: 0 });
    bad({ policyOverrides: [{ patch: { values: { sets: -1 } } }] });
    bad({ policyOverrides: [{ patch: { values: { sets: Number.POSITIVE_INFINITY } } }] });
    bad({ progressionByPhase: [{ phaseIndex: 1, progression: { model: "LINEAR", ramps: [{ param: "kg", from: 1, to: 2 }] } }] });
    bad({ doseMode: "INVENT" });
    // An alert code is a code: free text (it would stay in a table that is never deleted) is refused.
    bad({ acceptedFlagDecisions: [{ flagCode: "dor lombar crônica, hérnia L5", decision: { kind: "ACKNOWLEDGE" } }] });
    expect(parseGenerationAnswers({ acceptedFlagDecisions: [{ flagCode: "HISTORY_PAIN:sys-agachamento-livre", decision: { kind: "ACKNOWLEDGE" } }] }).acceptedFlagDecisions).toHaveLength(1);
  });

  it("takes an empty object (everything still to be answered) and keeps the defaults visible as absent", () => {
    const a = parseGenerationAnswers({});
    expect(a.doseMode).toBeUndefined();
    expect(a.metadataTrust).toBeUndefined();
    expect(a.equipmentCodes).toBeUndefined();
    expect(a.stimulusByPhase).toEqual([]);
    expect(parseGenerationAnswers({ equipmentCodes: "NONE" }).equipmentCodes).toBe("NONE");
  });
});

describe("mapping the real records", () => {
  it("reads the PAR-Q of the Avaliação Física: Não in all → CLEAR, any Sim → POSITIVE with the decision, unanswered → NOT_DONE", () => {
    expect(screeningFacts(assessment())).toEqual({ parq: "CLEAR", professionalDecision: null, medicalClearanceRecorded: false, ref: "assessment:as-1" });
    expect(screeningFacts(assessment({ screening: screening(["dizziness"], "medical_clearance") }))).toEqual({
      parq: "POSITIVE", professionalDecision: "MEDICAL_CLEARANCE", medicalClearanceRecorded: true, ref: "assessment:as-1",
    });
    expect(screeningFacts(assessment({ screening: screening(["bone_joint"], "cleared") })).professionalDecision).toBe("CLEARED");
    expect(screeningFacts(assessment({ screening: screening(["bone_joint"], "other") })).professionalDecision).toBe("OTHER");
    expect(screeningFacts(assessment({ screening: screening([], null, ["dizziness"]) })).parq).toBe("NOT_DONE");
    expect(screeningFacts(assessment({ screening: null })).parq).toBe("NOT_DONE");
    expect(screeningFacts(null)).toEqual({ parq: "NOT_DONE", professionalDecision: null, medicalClearanceRecorded: false });
  });

  it("reads the earlier format by its risk; a recorded review is REVIEWED, never 'cleared'; an unasked question is NOT_DONE", () => {
    const flagsOf = (value: boolean | null, overrides: Partial<Record<ScreeningKey, boolean | null>> = {}) =>
      ({ ...Object.fromEntries(SCREENING_ITEMS.map((item) => [item.key, value])), ...overrides }) as Record<ScreeningKey, boolean | null>;
    const legacy = (risk: "CLEAR" | "REVIEW_REQUIRED", reviewed: boolean, flags = flagsOf(false)) =>
      assessment({ formatVersion: null, standing: { risk, reviewed, reviewedAt: reviewed ? "x" : null }, screening: null, legacy: { flags, posture: { findings: [], notes: null }, movement: [] } });
    expect(screeningFacts(legacy("CLEAR", false)).parq).toBe("CLEAR");
    expect(screeningFacts(legacy("REVIEW_REQUIRED", false, flagsOf(false, { [SCREENING_ITEMS[0].key]: true })))).toMatchObject({ parq: "POSITIVE", professionalDecision: null });
    expect(screeningFacts(legacy("REVIEW_REQUIRED", true, flagsOf(null, { [SCREENING_ITEMS[0].key]: true })))).toMatchObject({ parq: "POSITIVE", professionalDecision: "REVIEWED" });
    // Before 0031: no "Sim" and questions the reader gives as not answered → the screening was not done, never "clear".
    expect(screeningFacts(legacy("CLEAR", false, flagsOf(null))).parq).toBe("NOT_DONE");
    expect(screeningFacts(legacy("CLEAR", false, flagsOf(false, { [SCREENING_ITEMS[1].key]: null }))).parq).toBe("NOT_DONE");
  });

  it("turns observations into findings from catalog labels and recorded numbers, never from free text; neutral posture is not a finding", () => {
    const found = findingFacts(assessment());
    expect(found.map((f) => `${f.kind}:${f.code}`)).toEqual([
      "POSTURE:lateral_shoulders:protracted",
      "FLEXIBILITY:FLEXITEST",
      "ANAMNESIS:injuries",
      "ASSESSMENT_CONTEXT:TEST:abdominal",
      "ASSESSMENT_CONTEXT:RESULT:body_fat_percent",
    ]);
    const result = found.find((f) => f.code === "RESULT:body_fat_percent")!;
    // Method and the formula's limitation travel with the number.
    expect(result.label).toContain("17,3%");
    expect(result.label).toContain("estimativa");
    expect(result.label).toContain("Fora da faixa original de validação");
    expect(JSON.stringify(found)).not.toMatch(/SEGREDO/);
  });

  it("maps library metadata to the engine (S4 handoff): pending fields are empty, never guessed; the summary becomes metadataStatus", () => {
    const record = (id: string, name: string): ExerciseRecord => ({
      id, scope: "SYSTEM", name, category: "Agachar", level: null, videoUrl: null, videoStatus: "NONE" as never, videoVerifiedAt: null,
      notes: null, source: "x", archivedAt: null, updatedAt: "x",
    });
    const field = (value: FieldValue | null, provenance: "REVIEWED" | "INFERRED" | "PENDING" = "INFERRED") => ({
      value: provenance === "PENDING" ? null : value, provenance, scope: "SYSTEM" as const, ruleId: "r", rulesVersion: "v", reviewedAt: null,
    });
    const meta = new Map<string, ResolvedMetadata>([
      ["sys-1", {
        exerciseId: "sys-1",
        fields: {
          modality: field("RESISTANCE"), metric: field("REPS"), primary_muscles: field(["QUADRICEPS"]), movement_patterns: field(["SQUAT"]),
          equipment: field(["DUMBBELL"]), laterality: field(null, "PENDING"), difficulty: field(2, "REVIEWED"), compound: field(true),
          equipment_alternatives: field([["KETTLEBELL"]]),
        },
        alternatives: [{ exerciseId: "sys-2", name: "B", provenance: "REVIEWED", scope: "SYSTEM" }, { exerciseId: "sys-2", name: "B", provenance: "REVIEWED", scope: "ORGANIZATION" }],
        summary: "INFERRED",
      }],
    ]);
    const [a, b] = buildCatalog([record("sys-2", "Sem metadados"), record("sys-1", "Agachamento  Goblet")], meta);
    expect(a).toMatchObject({
      id: "sys-1", nameKey: "agachamento goblet", modality: "RESISTANCE", metric: "REPS", primaryMuscles: ["QUADRICEPS"], patterns: ["SQUAT"],
      equipment: ["DUMBBELL"], equipmentAlternatives: [["KETTLEBELL"]], laterality: null, difficulty: 2, compound: true, secondsPerRep: null,
      cautionTags: [], substitutes: ["sys-2"], metadataStatus: "INFERRED",
    });
    expect(b).toMatchObject({ id: "sys-2", modality: null, metric: null, primaryMuscles: [], laterality: null, metadataStatus: "PENDING" });
  });

  it("takes the occurrences from the saved schedule: same weeks, slots and dates as the engine's calendar; v1 has no dates", () => {
    const facts = structureFacts(buildPeriodization(V2));
    const engine = scheduleOccurrences("2026-11-23", [
      { weeks: 2, sessionsPerWeek: 3, rotation: ["A", "B"], trainingDays: [0, 2, 4] },
      { weeks: 1, sessionsPerWeek: 1, rotation: ["Full"] },
    ]);
    expect(facts.phases.map((p) => p.occurrences)).toEqual(engine);
    expect(facts.phases[1].workouts).toEqual([{ label: "Full", name: null, exerciseTarget: 2, focus: { minutes: 40 } }]);
    const v1 = structureFacts(buildPeriodization({ startDate: "2026-11-23", phases: Array.from({ length: 3 }, () => ({ weeks: 3, sessionsPerWeek: 2, split: "AB", exercisesPerSession: 4 })) }));
    expect(v1.phases[0].occurrences[0]).toEqual({ week: 1, slot: 1, label: "A", plannedDate: null, weekStart: "2026-11-23" });
    expect(v1.phases[0].workouts.map((w) => w.exerciseTarget)).toEqual([4, 4]);
  });

  it("keeps every row already prescribed as typed (text), with a stored dose only when it is a valid one", () => {
    const row = (over: Partial<PrescribedItemWithDose>): PrescribedItemWithDose => ({
      id: "pe-1", phaseIndex: 1, workoutLabel: "A", position: 0, exerciseId: null, name: "Meu exercício", videoUrl: null, videoStatus: "NONE" as never,
      sets: "3", reps: "10", loadInstruction: null, cadence: null, restSeconds: 60, restText: null, rirMin: 2, rirMax: 2, notes: null,
      origin: "PROFESSIONAL", doseJson: null, doseText: null, applicationId: null, ...over,
    });
    const [manual, applied, broken] = existingItems([
      row({}),
      row({ id: "pe-2", doseJson: JSON.stringify({ metric: "TIME", sets: 2, durationSeconds: { min: 30, max: 30 }, restSeconds: 30 }), doseText: "2 × 30 s" }),
      row({ id: "pe-3", doseJson: JSON.stringify({ metric: "REPS", sets: -1 }) }),
    ]);
    expect(manual.dose).toBeNull();
    expect(manual.display.doseText).toBe("3 séries × 10 repetições · descanso 60 s · RIR 2");
    expect(applied.dose).toMatchObject({ metric: "TIME", sets: 2 });
    expect(applied.display.doseText).toBe("2 × 30 s");
    expect(broken.dose).toBeNull();
  });

  it("reads execution history without copying the exercise RIR onto sets; custom names and not-done exercises stay out, pain stays in", () => {
    const base = { sessionId: "s1", performedOn: "2026-11-10", createdAt: "x", effort: 7, position: 0, exerciseRir: 2, pain: 0, durationSeconds: null, distanceMeters: null, loadBasis: null, rir: null };
    const rows: ExposureRow[] = [
      { ...base, sessionExerciseId: "se1", exerciseId: "ex-squat", name: "Agachamento", done: 1, setNumber: 2, reps: 8, loadKg: 62.5 },
      { ...base, sessionExerciseId: "se1", exerciseId: "ex-squat", name: "Agachamento", done: 1, setNumber: 1, reps: 10, loadKg: 60, rir: 3, loadBasis: "TOTAL" },
      { ...base, sessionExerciseId: "se2", exerciseId: null, name: "Meu", done: 1, setNumber: 1, reps: 10, loadKg: null },
      { ...base, sessionExerciseId: "se3", exerciseId: "ex-bench", name: "Supino", done: 0, setNumber: null, reps: null, loadKg: null },
      { ...base, sessionExerciseId: "se4", exerciseId: "ex-row", name: "Remada", done: 0, pain: 1, setNumber: null, reps: null, loadKg: null },
      { ...base, sessionId: "s2", performedOn: "2026-11-12", effort: null, sessionExerciseId: "se5", exerciseId: "ex-plank", name: "Prancha", done: 1, setNumber: 1, reps: null, loadKg: null, durationSeconds: 45 },
    ];
    const h = toExposureHistory(rows, new Map([["ex-row", "REPS"]]));
    expect(h.customSkipped).toBe(1);
    expect(h.notDone).toBe(1);
    expect(h.sessionsWithEffort).toBe(1);
    expect(h.logs).toEqual([
      { exerciseId: "ex-row", date: "2026-11-10", equipmentKey: null, metric: "REPS", sets: [], pain: true, sessionEffort: 7, ref: "session:s1" },
      {
        exerciseId: "ex-squat", date: "2026-11-10", equipmentKey: null, metric: "REPS", pain: false, sessionEffort: 7, ref: "session:s1",
        sets: [
          { reps: 10, durationSeconds: null, loadKg: 60, loadBasis: "TOTAL", rir: 3, completed: true },
          { reps: 8, durationSeconds: null, loadKg: 62.5, loadBasis: null, rir: null, completed: true },
        ],
      },
      { exerciseId: "ex-plank", date: "2026-11-12", equipmentKey: null, metric: "TIME", pain: false, sessionEffort: null, ref: "session:s2", sets: [{ reps: null, durationSeconds: 45, loadKg: null, loadBasis: null, rir: null, completed: true }] },
    ]);
    expect(h.exercises.find((e) => e.exerciseId === "ex-squat")).toMatchObject({ exposures: 1, lastTopLoadKg: 62.5, lastReps: [10, 8] });
  });
});

describe("topic 7: missing data become questions and assumptions, never numbers", () => {
  it("asks the stimulus of each phase, the equipment and the count of a workout without target; generation is not ready", () => {
    const out = build(ctxOf(), {});
    expect(out.ready).toBe(false);
    const required = out.questions.filter((q) => q.required).map((q) => `${q.code}:${q.phaseIndex ?? ""}:${q.label ?? ""}`);
    expect(required).toEqual(["STIMULUS:1:", "EXERCISE_COUNT:1:B", "STIMULUS:2:", "EQUIPMENT::"]);
    // Suggestions from the goal are chips, nothing pre-selected, each with its rule.
    const stimulus = out.questions.find((q) => q.code === "STIMULUS")!;
    expect(stimulus.suggestions?.map((s) => s.value)).toEqual(["HYPERTROPHY", "GENERAL_FITNESS"]);
    expect(out.input.parameters.stimulusByPhase).toEqual([]);
    // The profile's free text is shown next to the question, never read into a code.
    expect(out.questions.find((q) => q.code === "EQUIPMENT")!.context).toContain("SEGREDO-EQUIP");
    expect(out.input.parameters.availableEquipment).toBeNull();
    // Defaults decided by the tool are written as assumptions when used.
    expect(out.assumptions.map((a) => a.code)).toEqual(expect.arrayContaining(["DOSE_MODE_DEFAULT", "METADATA_TRUST_DEFAULT", "TIME_BUDGET_SOFT_DEFAULT", "FREE_TEXT_NOT_PARSED", "CHECKINS_NOT_USED"]));
    expect(build(ctxOf()).ready).toBe(true);
  });

  it("asks for the modalities of a stimulus the rules do not map, and accepts a stimulus coming from the phase's progression", () => {
    const out = build(ctxOf(), { ...FULL, stimulusByPhase: [{ phaseIndex: 1, value: "Natação", basis: "PROFESSIONAL" }, FULL.stimulusByPhase![1]] });
    expect(out.questions.filter((q) => q.code === "MODALITIES").map((q) => q.label)).toEqual(["A", "B"]);
    expect(out.ready).toBe(false);
    const viaBlocks = build(ctxOf(), {
      ...FULL, stimulusByPhase: [FULL.stimulusByPhase![1]],
      progressionByPhase: [{ phaseIndex: 1, progression: { model: "BLOCK", blocks: [{ weeks: 1, stimulus: "HYPERTROPHY" }, { weeks: 1, stimulus: "STRENGTH" }] } }],
    });
    expect(viaBlocks.questions.filter((q) => q.code === "STIMULUS")).toEqual([]);
  });

  it("without profile, assessment or history: optional questions, NOT_DONE screening, and no invented level, goal, minutes or dates", () => {
    const empty = ctxOf({ profile: null, assessment: null, revision: { ...ctxOf().revision, schedule: buildPeriodization({ ...V2, phases: [{ ...V2.phases[0], trainingDays: null }, V2.phases[1]] }) } });
    const out = build(empty);
    expect(out.ready).toBe(true);
    expect(out.questions.map((q) => q.code)).toEqual(["AVAILABLE_MINUTES", "PROFILE_MISSING", "PROFILE_GOAL", "ASSESSMENT_MISSING"]);
    expect(out.questions.every((q) => !q.required)).toBe(true);
    expect(out.input.student).toEqual({ level: null, goal: null, sessionMinutes: null, screening: { parq: "NOT_DONE", professionalDecision: null, medicalClearanceRecorded: false }, findings: [] });
    expect(out.input.parameters.availableMinutes).toBeNull();
    expect(out.facts.profile).toBeNull();
    expect(out.facts.assessment).toBeNull();
    const result = generate(out.input);
    expect(result.flags.map((f) => f.code)).toContain("SCREENING_NOT_DONE");
    expect(result.assumptions.map((a) => a.code)).toEqual(expect.arrayContaining(["EXPERIENCE_UNKNOWN", "NO_HISTORY", "BUDGET_UNKNOWN", "DATES_NOT_PLANNED"]));
    const phase1 = result.occurrences.filter((o) => o.phaseIndex === 1);
    expect(phase1.every((o) => o.plannedDate === null && o.budgetMinutes === null)).toBe(true);
    // The workout's own minutes in the structure are the only budget phase 2 has.
    expect(result.occurrences.filter((o) => o.phaseIndex === 2).every((o) => o.budgetMinutes === 40 && o.budgetSource === "WORKOUT")).toBe(true);
    // No kg is ever proposed.
    expect(result.occurrences.flatMap((o) => o.items).every((i) => !i.dose || i.dose.metric !== "REPS" || i.dose.loadKg === null)).toBe(true);
  });

  it("refuses answers naming an exercise outside the visible library or a phase/workout that does not exist", () => {
    const ctx = ctxOf();
    expect(buildEngineInput(ctx, parseGenerationAnswers({ ...FULL, excludedExerciseIds: ["ex-squat", "org-b-secret"] }))).toEqual({ ok: false, code: "UNKNOWN_EXERCISE", exerciseIds: ["org-b-secret"] });
    expect(buildEngineInput(ctx, parseGenerationAnswers({ ...FULL, acceptedFlagDecisions: [{ flagCode: "x", decision: { kind: "EXCLUDE_EXERCISE", exerciseId: "nope" } }] }))).toMatchObject({ ok: false, code: "UNKNOWN_EXERCISE" });
    expect(buildEngineInput(ctx, parseGenerationAnswers({ ...FULL, exerciseCountByWorkout: [{ phaseIndex: 1, label: "C", count: 3 }] }))).toEqual({ ok: false, code: "UNKNOWN_TARGET", targets: [{ phaseIndex: 1, label: "C" }] });
    expect(buildEngineInput(ctx, parseGenerationAnswers({ ...FULL, stimulusByPhase: [{ phaseIndex: 3, value: "X", basis: "PROFESSIONAL" }] }))).toMatchObject({ ok: false, code: "UNKNOWN_TARGET" });
  });

  it("accepts 'sugestão aceita' only for what a rule actually suggested; a value the professional chose stays PROFESSIONAL", () => {
    const ctx = ctxOf(); // goal "Hipertrofia" → GOAL_STIMULUS_HINTS suggests HYPERTROPHY
    const run = (over: GenerationAnswersInput) => buildEngineInput(ctx, parseGenerationAnswers({ ...FULL, ...over }));
    const stimulus = (value: string, ruleId: string) => ({
      stimulusByPhase: [{ phaseIndex: 1, value, basis: "HEURISTIC_ACCEPTED" as const, ruleId }, { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" as const }],
    });
    expect(run(stimulus("HYPERTROPHY", "GOAL_STIMULUS_HINTS"))).toMatchObject({ ok: true });
    expect(run(stimulus("STRENGTH", "GOAL_STIMULUS_HINTS"))).toEqual({ ok: false, code: "UNSUPPORTED_SUGGESTION", targets: [{ field: "stimulusByPhase", phaseIndex: 1 }] });
    expect(run(stimulus("HYPERTROPHY", "MADE_UP_RULE"))).toMatchObject({ ok: false, code: "UNSUPPORTED_SUGGESTION" });
    // Without a goal there is no stimulus chip at all.
    expect(buildEngineInput(ctxOf({ profile: profile({ goal: null }), assessment: null }), parseGenerationAnswers({ ...FULL, ...stimulus("HYPERTROPHY", "GOAL_STIMULUS_HINTS") }))).toMatchObject({ code: "UNSUPPORTED_SUGGESTION" });
    const coverage = (c: Record<string, unknown>) => ({ phaseCoverage: [{ phaseIndex: 1, basis: "HEURISTIC_ACCEPTED", ruleId: "DEFAULT_COVERAGE", ...c }] }) as GenerationAnswersInput;
    expect(run(coverage({ patterns: ["SQUAT", "HINGE"] }))).toMatchObject({ ok: true });
    expect(run(coverage({ patterns: ["SQUAT"], ruleId: "MADE_UP_RULE" }))).toMatchObject({ code: "UNSUPPORTED_SUGGESTION" });
    expect(run(coverage({ muscles: ["QUADRICEPS"], patterns: ["SQUAT"] }))).toEqual({ ok: false, code: "UNSUPPORTED_SUGGESTION", targets: [{ field: "phaseCoverage", phaseIndex: 1 }] });
    // The same values typed by the professional are fine as PROFESSIONAL.
    expect(run({ phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", muscles: ["QUADRICEPS"] }], stimulusByPhase: [{ phaseIndex: 1, value: "STRENGTH", basis: "PROFESSIONAL" }, { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" }] })).toMatchObject({ ok: true });
  });

  it("warns when the profile's days per week are fewer than the sessions of a phase (fact, not a block)", () => {
    expect(build(ctxOf()).issues.map((i) => `${i.code}:${i.phaseIndex}`)).toEqual(["AVAILABILITY_BELOW_SESSIONS:1"]);
    expect(build(ctxOf({ profile: profile({ daysPerWeek: null }) })).issues).toEqual([]);
  });

  it("says a marker exclusion cannot reach exercises without markers, whether it comes from the answers or from an accepted alert decision", () => {
    const partial = (ctx: GenerationContext, answers: GenerationAnswersInput) => build(ctx, answers).assumptions.some((a) => a.code === "CAUTION_TAGS_PARTIAL");
    const unknown = ctxOf({ cautionTagsUnknown: [CATALOG[0].id] });
    expect(partial(unknown, FULL)).toBe(false);
    expect(partial(unknown, { ...FULL, excludedCautionTags: ["AXIAL_LOAD"] })).toBe(true);
    expect(partial(unknown, { ...FULL, acceptedFlagDecisions: [{ flagCode: "ANAMNESIS:injuries", decision: { kind: "EXCLUDE_CAUTION_TAG", tag: "AXIAL_LOAD" } }] })).toBe(true);
    expect(partial(unknown, { ...FULL, acceptedFlagDecisions: [{ flagCode: "ANAMNESIS:injuries", decision: { kind: "EXCLUDE_PATTERN", pattern: "SQUAT" } }] })).toBe(false);
    expect(partial(ctxOf(), { ...FULL, acceptedFlagDecisions: [{ flagCode: "ANAMNESIS:injuries", decision: { kind: "EXCLUDE_CAUTION_TAG", tag: "AXIAL_LOAD" } }] })).toBe(false);
  });

  it("is deterministic and keeps health free text out of the engine input and of the ledger references", () => {
    const a = build(ctxOf({ assessment: assessment({ screening: screening(["dizziness"], "medical_clearance") }) }));
    const b = build(ctxOf({ assessment: assessment({ screening: screening(["dizziness"], "medical_clearance") }) }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.input)).not.toMatch(/SEGREDO/);
    expect(JSON.stringify(a.facts)).not.toMatch(/SEGREDO/);
    expect(JSON.stringify(a.assumptions)).not.toMatch(/SEGREDO/);
  });
});

describe("topic 6: screening with alerts produces flags, never an automatic exclusion", () => {
  const withScreening = (s: AssessmentRecord | null) => generate(build(ctxOf({ assessment: s })).input);
  const strip = (input: EngineInput): EngineInput => ({ ...input, student: { ...input.student, screening: { parq: "CLEAR", professionalDecision: null, medicalClearanceRecorded: false }, findings: [] } });

  it("PAR-Q 'Sim' with 'Precisa de liberação médica': INFO flag, generation not blocked, same exercises as without alerts", () => {
    const alerted = build(ctxOf({ assessment: assessment({ screening: screening(["dizziness", "bone_joint"], "medical_clearance") }) })).input;
    const r = generate(alerted);
    const flags = new Map(r.flags.map((f) => [f.code, f]));
    expect(flags.get("MEDICAL_CLEARANCE_RECORDED")?.severity).toBe("INFO");
    expect(flags.has("SCREENING_REVIEW_REQUIRED")).toBe(false);
    expect(flags.get("ANAMNESIS:injuries")?.severity).toBe("INFO");
    expect(flags.get("ASSESSMENT:POSTURE:lateral_shoulders:protracted")?.message).toContain("não muda a seleção");
    expect(flags.get("ASSESSMENT:ASSESSMENT_CONTEXT:RESULT:body_fat_percent")?.severity).toBe("INFO");
    expect([...flags.values()].every((f) => !f.suggestedDecision)).toBe(true);
    expect(r.status).toBe("SUCCEEDED");
    expect(r.requiresProfessionalReview).toBe(true);
    expect(selection(r)).toEqual(selection(generate(strip(alerted))));
    expect(r.occurrences.flatMap((o) => o.items).filter((i) => i.origin === "ENGINE").length).toBeGreaterThan(5);
  });

  it("'Sim' without a decision and 'Outra decisão' are warnings for the professional; neither changes the selection", () => {
    const noDecision = withScreening(assessment({ screening: screening(["heart_condition"], null) }));
    expect(noDecision.flags.find((f) => f.code === "SCREENING_REVIEW_REQUIRED")?.severity).toBe("WARNING");
    const other = withScreening(assessment({ screening: screening(["heart_condition"], "other") }));
    expect(other.flags.find((f) => f.code === "SCREENING_OTHER_DECISION")?.severity).toBe("WARNING");
    expect(selection(noDecision)).toEqual(selection(other));
    expect(selection(other)).toEqual(selection(withScreening(null)));
  });

  it("a movement test graded MODERATE (earlier format) suggests excluding the pattern; only the professional's click applies it", () => {
    const legacy = assessment({
      formatVersion: null, standing: { risk: "REVIEW_REQUIRED", reviewed: true, reviewedAt: "x" }, screening: null, posture: null, movement: null, tests: null, conclusion: null, profile: null, results: [],
      legacy: { flags: {} as never, posture: { findings: ["ANTERIOR.KNEE_VALGUS"], notes: "SEGREDO" }, movement: [{ test: "SQUAT", grade: "MODERATE", notes: "SEGREDO" }, { test: "PUSH", grade: "MILD", notes: null }] },
    });
    const ctx = ctxOf({ assessment: legacy });
    const r = generate(build(ctx).input);
    const squat = r.flags.find((f) => f.code === "MOVEMENT_FINDING:SQUAT:SQUAT")!;
    expect(squat.suggestedDecision).toEqual({ kind: "EXCLUDE_PATTERN", pattern: "SQUAT" });
    expect(r.flags.find((f) => f.code === "SCREENING_REVIEWED")?.severity).toBe("INFO");
    expect(r.flags.some((f) => f.code.startsWith("MOVEMENT_FINDING:PUSH"))).toBe(false);
    const squats = (res: EngineResult) => res.occurrences.flatMap((o) => o.items).filter((i) => CATALOG.find((e) => e.id === i.exerciseId)?.patterns.includes("SQUAT")).length;
    expect(squats(r)).toBeGreaterThan(0);
    const decided = generate(build(ctx, { ...FULL, acceptedFlagDecisions: [{ flagCode: "MOVEMENT_FINDING:SQUAT:SQUAT", decision: { kind: "EXCLUDE_PATTERN", pattern: "SQUAT" } }] }).input);
    expect(decided.flags.find((f) => f.code === "MOVEMENT_FINDING:SQUAT:SQUAT")?.decided).toEqual({ kind: "EXCLUDE_PATTERN", pattern: "SQUAT" });
    expect(squats(decided)).toBe(0);
    expect(JSON.stringify(r.flags)).not.toMatch(/SEGREDO/);
  });

  it("goal suggestions come from the rule set only", () => {
    expect(goalSuggestions("Hipertrofia; Saúde e bem-estar").map((s) => s.value)).toEqual(["HYPERTROPHY", "GENERAL_FITNESS"]);
    expect(goalSuggestions(null)).toEqual([]);
  });
});
