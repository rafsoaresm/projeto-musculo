import { describe, expect, it } from "vitest";
import { DEFAULT_RULESET, getRuleSet } from "@/modules/prescricao/motor/rules";
import { parseGenerationAnswers, type GenerationQuestion } from "@/modules/prescricao/automatica/contracts";
import {
  EMPTY_FORM,
  EMPTY_PROGRESSION,
  answersFromForm,
  durationText,
  formFromAnswers,
  historySuggestionText,
  issuesOfPhase,
  itemBases,
  itemBasisGroups,
  PROGRESSION_MODEL_LABELS,
  weekVolume,
  numberOf,
  openRequired,
  pickPhase,
  pickWeek,
  policyOverrides,
  policyRows,
  progressionOf,
  proposalProgression,
  revisionOriginLabel,
  traceValue,
  type GenerationForm,
} from "@/modules/prescricao/automatica/view";
import { sessionTargets } from "@/modules/prescricao/occurrences";
import { changedDoseFields, restTextForEditing } from "@/modules/prescricao/describe";
import { generate } from "@/modules/prescricao/motor";
import { CATALOG, baseInput, parameters, structure } from "./helpers/motor-fixtures";
import type { ItemOut, OccurrenceOut, PhaseSummary } from "@/modules/prescricao/motor/types";

// Motor S9: the pure rules behind the professional's screens (generation form, proposal view, per-session editor).
const rules = getRuleSet(DEFAULT_RULESET)!;
const rows = policyRows(rules);
const keyOf = (stimulus: string, modality: string, metric: string) => rows.find((r) => r.stimulus === stimulus && r.modality === modality && r.metric === metric)!.key;

describe("dose policy table (Q1: prefilled, editable, a heuristic)", () => {
  it("lists every rule row with its values", () => {
    expect(rows).toHaveLength(rules.rules.DOSE_DEFAULTS.value.length);
    const hyper = rows.find((r) => r.stimulus === "HYPERTROPHY")!;
    expect(hyper.defaults).toContainEqual({ param: "sets", value: 3 });
  });

  it("sends nothing when no cell changed, and only the changed cells otherwise", () => {
    expect(policyOverrides(rows, {})).toEqual({ ok: true, overrides: [] });
    const k = keyOf("HYPERTROPHY", "RESISTANCE", "REPS");
    expect(policyOverrides(rows, { [`${k}:sets`]: "3" })).toEqual({ ok: true, overrides: [] });
    expect(policyOverrides(rows, { [`${k}:sets`]: "4" })).toEqual({
      ok: true,
      overrides: [{ stimulus: "HYPERTROPHY", modality: "RESISTANCE", metric: "REPS", patch: { values: { sets: 4 } } }],
    });
  });

  it("an edited 'any stimulus' row is not sent to the stimuli that have their own row", () => {
    const any = keyOf("*", "CARDIO", "CONTINUOUS");
    const out = policyOverrides(rows, { [`${any}:durationMin`]: "900" });
    if (!out.ok) throw new Error("invalid");
    // AEROBIC_ENDURANCE has its own CONTINUOUS row: excepted, and not re-sent with its heuristic defaults as a decision.
    expect(out.overrides).toEqual([
      { exceptStimuli: ["AEROBIC_ENDURANCE"], modality: "CARDIO", metric: "CONTINUOUS", patch: { values: { durationMin: 900 } } },
    ]);
  });

  it("both rows edited: each stimulus gets what its row shows (engine run)", () => {
    const any = keyOf("*", "CARDIO", "CONTINUOUS");
    const named = keyOf("AEROBIC_ENDURANCE", "CARDIO", "CONTINUOUS");
    const namedRow = rows.find((r) => r.key === named)!;
    const namedMin = namedRow.defaults.find((d) => d.param === "durationMin")!.value;
    const out = policyOverrides(rows, { [`${any}:durationMin`]: "900", [`${any}:durationMax`]: "1000", [`${named}:durationMax`]: "2000" });
    if (!out.ok) throw new Error("invalid");
    const cardio = (stimulus: string) => ({
      weeks: 1, sessionsPerWeek: 1, stimulus, workouts: [{ label: "C", exerciseTarget: 1 }],
    });
    const r = generate(baseInput({
      catalog: CATALOG.filter((e) => e.id === "ex-walk"),
      parameters: parameters({
        doseOverrides: out.overrides,
        modalitiesByWorkout: [{ phaseIndex: 1, label: "C", modalities: ["CARDIO"] }, { phaseIndex: 2, label: "C", modalities: ["CARDIO"] }],
      }),
      structure: structure("2026-11-09", [cardio("AEROBIC_ENDURANCE"), cardio("Condicionamento geral")]),
    }));
    const doseOf = (phaseIndex: number) => r.occurrences.find((o) => o.phaseIndex === phaseIndex)!.items[0].dose;
    // The named row: its own minimum (never the 900 typed for "any stimulus") and the maximum typed for it.
    expect(doseOf(1)).toMatchObject({ metric: "CONTINUOUS", durationSeconds: { min: namedMin, max: 2000 } });
    // A stimulus without its own row: the "any stimulus" row as typed.
    expect(doseOf(2)).toMatchObject({ metric: "CONTINUOUS", durationSeconds: { min: 900, max: 1000 } });
    const minBasis = r.occurrences.find((o) => o.phaseIndex === 1)!.items[0].trace.params.find((p) => p.param === "durationMin")!.basis;
    expect(minBasis).not.toBe("PROFESSIONAL");
  });

  it("refuses an empty or negative cell and a minimum above its maximum, naming the cell", () => {
    const k = keyOf("HYPERTROPHY", "RESISTANCE", "REPS");
    expect(policyOverrides(rows, { [`${k}:sets`]: "" })).toEqual({ ok: false, invalid: [`${k}:sets`] });
    expect(policyOverrides(rows, { [`${k}:sets`]: "-1" })).toEqual({ ok: false, invalid: [`${k}:sets`] });
    expect(policyOverrides(rows, { [`${k}:repsMin`]: "15" })).toEqual({ ok: false, invalid: [`${k}:repsMin`] });
  });

  it("reads decimals with a comma and never turns empty into 0", () => {
    expect(numberOf("0,5")).toBe(0.5);
    expect(numberOf("")).toBeNull();
    expect(numberOf("  ")).toBeNull();
    expect(numberOf("abc")).toBeNull();
  });
});

describe("generation form → answers", () => {
  const structure = [
    { index: 1, workouts: [{ label: "A" }, { label: "B" }] },
    { index: 2, workouts: [{ label: "Full" }] },
  ];
  const questions: GenerationQuestion[] = [
    { code: "STIMULUS", required: true, where: "GENERATION", message: "", phaseIndex: 1 },
    { code: "STIMULUS", required: true, where: "GENERATION", message: "", phaseIndex: 2 },
    { code: "EQUIPMENT", required: true, where: "GENERATION", message: "" },
    { code: "EXERCISE_COUNT", required: true, where: "GENERATION", message: "", phaseIndex: 2, label: "Full" },
    { code: "PROFILE_GOAL", required: false, where: "PROFILE", message: "" },
  ];

  it("blocks until every required question is answered; nothing is pre-selected", () => {
    expect(openRequired(questions, EMPTY_FORM).map((q) => q.code)).toEqual(["STIMULUS", "STIMULUS", "EQUIPMENT", "EXERCISE_COUNT"]);
    const form: GenerationForm = {
      ...EMPTY_FORM,
      stimulus: [
        { phaseIndex: 1, value: "HYPERTROPHY", basis: "HEURISTIC_ACCEPTED", ruleId: "GOAL_STIMULUS_HINTS" },
        { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" },
      ],
      equipment: "NONE",
      counts: [{ phaseIndex: 2, label: "Full", count: "BY_TIME" }],
    };
    expect(openRequired(questions, form)).toEqual([]);
    expect(openRequired(questions, { ...form, counts: [{ phaseIndex: 2, label: "Full", count: "0" }] }).map((q) => q.code)).toEqual(["EXERCISE_COUNT"]);
  });

  it("sends only what was chosen: the untouched defaults stay out (the adapter records them as assumptions)", () => {
    const out = answersFromForm({ ...EMPTY_FORM, stimulus: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" }], equipment: ["DUMBBELL", "BENCH"] }, rows);
    expect(out).toEqual({ ok: true, answers: { stimulusByPhase: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" }], equipmentCodes: ["BENCH", "DUMBBELL"] } });
    if (out.ok) expect(() => parseGenerationAnswers(out.answers)).not.toThrow();
  });

  it("builds a strict, parseable answer with every optional section", () => {
    const k = keyOf("HYPERTROPHY", "RESISTANCE", "REPS");
    const out = answersFromForm(
      {
        ...EMPTY_FORM,
        stimulus: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "HEURISTIC_ACCEPTED", ruleId: "GOAL_STIMULUS_HINTS" }],
        equipment: "NONE",
        availableMinutes: "50",
        timeBudget: "HARD",
        counts: [{ phaseIndex: 2, label: "Full", count: "4" }],
        doseMode: "FILL_FROM_POLICY",
        metadataTrust: "REVIEWED_ONLY",
        policy: { [`${k}:sets`]: "4" },
        progression: [{ ...EMPTY_PROGRESSION, phaseIndex: 1, model: "LINEAR", param: "sets", from: "3", to: "5", deloadWeeks: "4", deloadMultiplier: "0,5" }],
        excludedExerciseIds: ["sys-001", "sys-001"],
        excludedPatterns: ["HINGE"],
        excludedCautionTags: ["AXIAL_LOAD"],
      },
      rows,
    );
    if (!out.ok) throw new Error(out.errors.join());
    const parsed = parseGenerationAnswers(out.answers);
    expect(parsed.doseMode).toBe("FILL_FROM_POLICY");
    expect(parsed.metadataTrust).toBe("REVIEWED_ONLY");
    expect(parsed.equipmentCodes).toBe("NONE");
    expect(parsed.exerciseCountByWorkout).toEqual([{ phaseIndex: 2, label: "Full", count: 4 }]);
    expect(parsed.progressionByPhase).toEqual([
      { phaseIndex: 1, progression: { model: "LINEAR", ramps: [{ param: "sets", from: 3, to: 5 }], deload: { weeks: [4], setsMultiplier: 0.5 } } },
    ]);
    expect(parsed.excludedExerciseIds).toEqual(["sys-001"]);
    expect(parsed.policyOverrides).toHaveLength(1);
  });

  it("says what to fix instead of guessing", () => {
    const out = answersFromForm(
      {
        ...EMPTY_FORM,
        availableMinutes: "0",
        progression: [{ ...EMPTY_PROGRESSION, phaseIndex: 1, model: "LINEAR", from: "3", to: "" }],
      },
      rows,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors).toHaveLength(2);
  });

  it("progression forms: none, linear, steps, deload only, and their errors", () => {
    expect(progressionOf(EMPTY_PROGRESSION)).toEqual({ ok: true, progression: null });
    expect(progressionOf({ ...EMPTY_PROGRESSION, deloadWeeks: "3", deloadMultiplier: "0.6" })).toEqual({ ok: true, progression: { model: "CUSTOM", deload: { weeks: [3], setsMultiplier: 0.6 } } });
    expect(progressionOf({ ...EMPTY_PROGRESSION, model: "STEP", param: "repsMax", delta: "-1", everyWeeks: "2", limit: "8" })).toEqual({
      ok: true,
      progression: { model: "STEP", steps: [{ param: "repsMax", delta: -1, everyWeeks: 2, limit: 8 }] },
    });
    expect(progressionOf({ ...EMPTY_PROGRESSION, model: "STEP", delta: "0" }).ok).toBe(false);
    expect(progressionOf({ ...EMPTY_PROGRESSION, deloadWeeks: "x" }).ok).toBe(false);
    expect(progressionOf({ ...EMPTY_PROGRESSION, deloadWeeks: "2" }).ok).toBe(false);
  });

  it("previous answers come back into the form only where they still fit the structure and the table", () => {
    const k = keyOf("HYPERTROPHY", "RESISTANCE", "REPS");
    const form = formFromAnswers(
      {
        stimulusByPhase: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" }, { phaseIndex: 9, value: "STRENGTH", basis: "PROFESSIONAL" }],
        equipmentCodes: ["DUMBBELL"],
        exerciseCountByWorkout: [{ phaseIndex: 2, label: "Full", count: "BY_TIME" }, { phaseIndex: 1, label: "Z", count: 3 }],
        policyOverrides: [{ stimulus: "HYPERTROPHY", modality: "RESISTANCE", metric: "REPS", patch: { values: { sets: 5, repsMin: 8 } } }],
        progressionByPhase: [{ phaseIndex: 1, progression: { model: "LINEAR", ramps: [{ param: "sets", from: 3, to: 4 }] } }],
        doseMode: "LEAVE_EMPTY",
      },
      structure,
      rows,
    );
    expect(form.stimulus).toEqual([{ phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" }]);
    expect(form.counts).toEqual([{ phaseIndex: 2, label: "Full", count: "BY_TIME" }]);
    expect(form.policy).toEqual({ [`${k}:sets`]: "5" });
    expect(form.progression[0]).toMatchObject({ phaseIndex: 1, model: "LINEAR", from: "3", to: "4" });
    expect(form.doseMode).toBe("LEAVE_EMPTY");
    expect(formFromAnswers(null, structure, rows)).toEqual({ ...EMPTY_FORM, policy: {} });
  });
});

describe("proposal view", () => {
  const phases: PhaseSummary[] = [
    { phaseIndex: 1, name: null, weeks: 3, sessionsPerWeek: 2, progression: null },
    { phaseIndex: 2, name: null, weeks: 2, sessionsPerWeek: 1, progression: null },
  ];
  const item = (slotKey: string, name: string, doseText: string, bases: Array<"HEURISTIC" | "PROFESSIONAL" | "STUDENT_DATA">): ItemOut => ({
    slotKey, position: 1, exerciseId: "x", exerciseName: name, modality: "RESISTANCE", dose: null,
    display: { sets: null, reps: null, loadInstruction: null, cadence: null, restSeconds: null, restText: null, rirMin: null, rirMax: null, doseText },
    origin: "ENGINE", existingPrescribedExerciseId: null, substitutesSlotKey: null, alternatives: [], metadata: "REVIEWED",
    trace: { selection: bases.map((basis) => ({ code: "C", basis, detail: "d" })), params: [{ param: "sets", value: 3, basis: "HEURISTIC" }] },
  });
  const occ = (week: number, slot: number, label: string, items: ItemOut[]): OccurrenceOut => ({
    phaseIndex: 1, week, slot, label, plannedDate: null, weekStart: "2026-11-23", stimulus: null, items,
    estimatedMinutes: null, durationComplete: true, budgetMinutes: null, budgetSource: null,
  });

  it("phase and week come from the address, kept inside what exists", () => {
    expect(pickPhase(phases, [1, 2], "2")).toBe(2);
    expect(pickPhase(phases, [1], "2")).toBe(1);
    expect(pickPhase(phases, [], "1")).toBeNull();
    expect(pickWeek(phases[0], "3")).toBe(3);
    expect(pickWeek(phases[0], "4")).toBe(1);
    expect(pickWeek(phases[0], "abc")).toBe(1);
  });

  it("bases of an item in a fixed order, each once", () => {
    expect(itemBases(item("k", "Agachamento", "3 × 8", ["PROFESSIONAL", "HEURISTIC", "STUDENT_DATA"]))).toEqual(["STUDENT_DATA", "PROFESSIONAL", "HEURISTIC"]);
  });

  it("weekly progression per exercise of a workout, '—' where it is not in that week", () => {
    const list = [
      occ(1, 1, "A", [item("a", "Agachamento", "3 × 8–12", ["HEURISTIC"])]),
      occ(2, 1, "A", [item("a", "Agachamento", "4 × 8–12", ["HEURISTIC"]), item("b", "Remada", "3 × 10", ["HEURISTIC"])]),
      occ(2, 2, "A", [item("a", "Agachamento", "5 × 5", ["HEURISTIC"])]),
      occ(1, 2, "B", [item("c", "Supino", "3 × 8", ["HEURISTIC"])]),
    ];
    expect(proposalProgression(list, 1, 3, "A")).toEqual([
      { slotKey: "a", name: "Agachamento", cells: ["3 × 8–12", "4 × 8–12 …", "—"] },
      { slotKey: "b", name: "Remada", cells: ["—", "3 × 10", "—"] },
    ]);
  });

  it("issues of a phase, errors first; durations and traced values as text", () => {
    const issues = [
      { severity: "INFO" as const, code: "I", path: "", message: "", stage: "VALIDATION" as const, phaseIndex: 1 },
      { severity: "ERROR" as const, code: "E", path: "", message: "", stage: "VALIDATION" as const },
      { severity: "WARNING" as const, code: "W", path: "", message: "", stage: "VALIDATION" as const, phaseIndex: 2 },
    ];
    expect(issuesOfPhase(issues, 1).map((i) => i.code)).toEqual(["E", "I"]);
    expect(durationText({ estimatedMinutes: 52, durationComplete: true, budgetMinutes: 45 })).toBe("≈ 52 min de 45");
    expect(durationText({ estimatedMinutes: 30, durationComplete: false, budgetMinutes: null })).toBe("≥ 30 min");
    expect(durationText({ estimatedMinutes: null, durationComplete: false, budgetMinutes: 45 })).toBeNull();
    expect(traceValue({ min: 8, max: 12 })).toBe("8–12");
    expect(traceValue(null)).toBe("—");
  });

  it("origin of a prescribed row after the apply", () => {
    expect(revisionOriginLabel("SYSTEM").text).toBe("Proposta automática");
    expect(revisionOriginLabel("SYSTEM_EDITED").text).toBe("Editada por você");
    expect(revisionOriginLabel("PROFESSIONAL").text).toBe("Sua");
  });
});

describe("per-session editor scope", () => {
  const sessions = [
    { id: "w1a", week: 1, label: "A", items: [{ id: "x1", prescribedExerciseId: "pe1" }, { id: "y1", prescribedExerciseId: "pe2" }] },
    { id: "w1b", week: 1, label: "B", items: [{ id: "z1", prescribedExerciseId: "pe3" }] },
    { id: "w2a", week: 2, label: "A", items: [{ id: "x2", prescribedExerciseId: "pe1" }] },
    { id: "w3a", week: 3, label: "A", items: [{ id: "x3", prescribedExerciseId: "pe1" }] },
  ];
  it("this session, from this week on, or the whole phase; never another workout", () => {
    expect(sessionTargets(sessions, { sessionId: "w2a", prescribedExerciseId: "pe1" }, "ONLY")).toEqual({ sessionIds: ["w2a"], itemIds: ["x2"] });
    expect(sessionTargets(sessions, { sessionId: "w2a", prescribedExerciseId: "pe1" }, "FROM_WEEK")).toEqual({ sessionIds: ["w2a", "w3a"], itemIds: ["x2", "x3"] });
    expect(sessionTargets(sessions, { sessionId: "w2a", prescribedExerciseId: "pe1" }, "PHASE")).toEqual({ sessionIds: ["w1a", "w2a", "w3a"], itemIds: ["x1", "x2", "x3"] });
    expect(sessionTargets(sessions, { sessionId: "w1b" }, "PHASE")).toEqual({ sessionIds: ["w1b"], itemIds: [] });
    expect(sessionTargets(sessions, { sessionId: "nope" }, "PHASE")).toEqual({ sessionIds: [], itemIds: [] });
  });
});

describe("dose edit forms send only what changed (review of S9)", () => {
  const initial = { sets: "3", reps: "8–12", loadInstruction: "", cadence: "", restSeconds: "90", restText: "", rirMin: "1", rirMax: "3", notes: "" };
  it("a notes-only save sends the notes only, so the stored dose stays", () => {
    expect(changedDoseFields(initial, { ...initial, notes: "Pegada neutra" })).toEqual({ notes: "Pegada neutra" });
    expect(changedDoseFields(initial, initial)).toEqual({});
  });
  it("a changed dose field sends every dose field as typed; empty is null, never 0", () => {
    expect(changedDoseFields(initial, { ...initial, sets: "4", rirMin: "" })).toEqual({
      sets: "4", reps: "8–12", loadInstruction: null, cadence: null, restSeconds: 90, restText: null, rirMin: null, rirMax: 3,
    });
    expect(Object.keys(changedDoseFields(initial, initial, true))).toHaveLength(8);
  });
  it("opening an engine dose drops the rest written as text, but keeps the interval recovery", () => {
    expect(restTextForEditing({ restText: "90 s", doseText: "3 × 8–12 · descanso 90 s" })).toBe("");
    expect(restTextForEditing({ restText: "rec. 60–90 s", doseText: "1 × 6 × 30–60 s · recuperação passiva 60–90 s" })).toBe("rec. 60–90 s");
    expect(restTextForEditing({ restText: "1 min", doseText: null })).toBe("1 min");
  });
});

describe("final review: what the engine computes reaches the proposal screen", () => {
  const legpressLog = (date: string) => ({
    exerciseId: "ex-legpress", date, equipmentKey: "m1", metric: "REPS" as const, pain: false,
    sets: [1, 2, 3].map(() => ({ reps: 12, durationSeconds: null, loadKg: 100, loadBasis: "TOTAL" as const, rir: 2, completed: true })),
  });

  it("the history suggestion of an item becomes text for that item only, never a dose", () => {
    const r = generate(baseInput({ history: [legpressLog("2026-10-01"), legpressLog("2026-10-05")] }));
    const occ = r.occurrences.find((o) => o.items.some((i) => i.exerciseId === "ex-legpress"))!;
    const item = occ.items.find((i) => i.exerciseId === "ex-legpress")!;
    const text = historySuggestionText(r.historySuggestions, occ.phaseIndex, item.slotKey);
    expect(text).toMatchObject({ title: "Sugestão por histórico: manter a carga (100 kg)", basis: "STUDENT_DATA" });
    expect(text!.detail).toContain("Registros usados: 2.");
    const other = occ.items.find((i) => i.exerciseId !== "ex-legpress")!;
    expect(historySuggestionText(r.historySuggestions, occ.phaseIndex, other.slotKey)).toBeNull();
    expect(historySuggestionText(r.historySuggestions, occ.phaseIndex + 1, item.slotKey)).toBeNull();
  });

  it("the weekly volume per muscle of the selected week, with the library's labels and a decimal comma", () => {
    const r = generate(baseInput());
    const rows = weekVolume(r.volume, 1, 1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((v) => v.muscle)).toContain("Quadríceps");
    expect(rows.every((v) => !/^[A-Z_]+$/.test(v.muscle))).toBe(true);
    expect(weekVolume([{ phaseIndex: 1, week: 1, muscle: "TRICEPS", directSets: 0, indirectSets: 3, weightedSets: 1.5, occurrences: 1 }], 1, 1)[0])
      .toEqual({ muscle: "Tríceps", direct: "0", indirect: "3", weighted: "1,5", sessions: 1 });
    expect(weekVolume(r.volume, 1, 99)).toEqual([]);
  });

  it("the bases are split between the choice of the exercise and the dose (a professional stimulus is not the dose's basis)", () => {
    const r = generate(baseInput());
    const item = r.occurrences[0].items.find((i) => i.origin === "ENGINE")!;
    const groups = itemBasisGroups(item);
    expect(groups.selection).toContain("PROFESSIONAL");
    expect(groups.dose).toContain("HEURISTIC");
    // The stimulus (and the measure) chosen by the professional back the choice, not the numbers: the dose is all heuristic here.
    expect(item.trace.params.find((p) => p.param === "stimulus")?.basis).toBe("PROFESSIONAL");
    expect(groups.dose).toEqual(["HEURISTIC"]);
    expect(PROGRESSION_MODEL_LABELS.STEP).toBe("em degraus");
  });
});
