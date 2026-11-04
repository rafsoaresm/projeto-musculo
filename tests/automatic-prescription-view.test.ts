import { describe, expect, it, vi } from "vitest";
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
  auditPhaseRows,
  auditTargetText,
  auditValueText,
  auditView,
  canAcceptSuggestions,
  contributionView,
  changeConditions,
  phasesWithoutTargets,
  whyView,
  rangeText,
  storedAudit,
  UNDEFINED_SETS,
  NOT_COUNTED,
  pageAudit,
  weekTableAudit,
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
import { CATALOG, LEGACY_RULES, baseInput, parameters, structure } from "./helpers/motor-fixtures";
import { xintusInput } from "./helpers/xintus";
import type { AuditReport } from "@/modules/prescricao/motor/types";
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
      .toEqual({ muscle: "Tríceps", direct: "0", indirect: "3", weighted: "1,5", sessions: 1, directSessions: "—", target: null });
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

// Motor V3 S2 (design V3 §7.1): the audit panel's model, the weekly table's extra columns and "Contribuição na semana".
describe("Motor V3 S2: the plan audit on the proposal screen", () => {
  const xintus = generate(xintusInput());
  const audit = xintus.audit!;
  const stored = storedAudit(xintus)!;

  it("the stored audit comes from the summary; a summary without one gives null (computed at view time instead)", () => {
    expect(stored).toEqual({ report: audit, source: "STORED", rules: audit.rules });
    const legacy = generate(xintusInput(LEGACY_RULES));
    expect(legacy.audit).toBeUndefined();
    expect(storedAudit(legacy)).toBeNull();
  });

  it("acceptance follows the proposal's own rule set: only 2026.11.4+ carries the suggestion rule", () => {
    expect(canAcceptSuggestions(getRuleSet(LEGACY_RULES))).toBe(false);
    expect(canAcceptSuggestions(getRuleSet({ id: "gymgital-base", version: "2026.11.3" }))).toBe(false);
    expect(canAcceptSuggestions(getRuleSet(DEFAULT_RULESET))).toBe(true);
    expect(canAcceptSuggestions(null)).toBe(false);
    expect(canAcceptSuggestions({ rules: { MICROCYCLE_TARGET_SUGGESTIONS: {} } } as never)).toBe(true);
  });

  it("KPIs from the real sessions (Xintus ABAB: 4 per week), attention vs observations vs description, grouped by phase", () => {
    const view = auditView(stored, { engineVersion: xintus.engineVersion, acceptSuggestions: false });
    expect(view.viewNotice).toBeNull();
    expect(view.kpis.sessionsPerWeek).toBe("4");
    expect(view.kpis.phases).toBe("3 de 3");
    const count = (status: (f: AuditReport["findings"][number]) => boolean) => audit.findings.filter(status).length;
    expect(view.kpis.attention).toBe(count((f) => f.severity === "WARNING" && f.status !== "DESCRIPTIVE"));
    expect(view.kpis.observations).toBe(count((f) => f.severity === "INFO" && f.status !== "DESCRIPTIVE"));
    expect(view.descriptive.flatMap((g) => g.findings).length).toBe(count((f) => f.status === "DESCRIPTIVE"));
    // The 2 → 3 sets step of week 2 → 3 is a point of attention, with the measured numbers and a link to the week.
    const jump = view.attention.flatMap((g) => g.findings).find((f) => f.code === "AUDIT_WEEK_VOLUME_JUMP")!;
    expect(jump.label).toBe("Salto de volume entre semanas");
    expect(jump.measured).toMatch(/^Medido: \d+(,\d+)? séries ponderadas \(antes: \d+(,\d+)? séries ponderadas\)$/);
    expect(jump.target).toEqual({ text: "Sem alvo definido", basis: null });
    expect(jump.links[0]).toMatchObject({ phaseIndex: 1, text: expect.stringMatching(/^Ver a semana \d+ da fase 1$/) });
    // Groups are in phase order; descriptive findings never count as observations.
    for (const groups of [view.attention, view.observations, view.descriptive])
      expect(groups.map((g) => g.phaseIndex ?? 0)).toEqual([...groups.map((g) => g.phaseIndex ?? 0)].sort((a, b) => a - b));
    const noTargets = view.observations.flatMap((g) => g.findings).find((f) => f.code === "AUDIT_NO_TARGETS")!;
    expect(noTargets.offerSuggestion).toBe(false);
    expect(noTargets.links).toEqual([{ phaseIndex: 1, text: "Ver a fase 1" }]);
    expect(noTargets.location).toBeNull();
  });

  it("an audit computed now is labelled with its rules and the engine, and never offers an acceptance", () => {
    const view = auditView({ ...stored, source: "VIEW" }, { engineVersion: "2.0.1", acceptSuggestions: true });
    expect(view.viewNotice).toBe(
      "Auditoria calculada agora com as regras gymgital-base 2026.11.4, porque esta proposta foi gerada antes da auditoria (motor 2.0.1). Não foi gravada na proposta.",
    );
    expect([...view.attention, ...view.observations, ...view.descriptive].flatMap((g) => g.findings).every((f) => !f.offerSuggestion)).toBe(true);
    // A recorded audit under rules that can back it would offer it, on AUDIT_NO_TARGETS only (the card comes with those rules).
    const offered = auditView(stored, { engineVersion: "2.1.0", acceptSuggestions: true }).observations.flatMap((g) => g.findings);
    expect(offered.filter((f) => f.offerSuggestion).map((f) => f.code)).toEqual(offered.filter((f) => f.code === "AUDIT_NO_TARGETS").map((f) => f.code));
  });

  it("measured and target texts: units, ranges, basis; nothing invented", () => {
    expect(auditValueText("SESSIONS", 1)).toBe("1 sessão");
    expect(auditValueText("DIRECT_SETS", 0)).toBe("0 séries diretas");
    expect(auditValueText("SHARE", 0.456)).toBe("45,6%");
    expect(auditValueText("RATIO", 3.5)).toBe("3,5 : 1");
    expect(auditValueText("MINUTES", 38)).toBe("38 min");
    expect(auditTargetText({ unit: "SESSIONS", min: 1, basis: "PROFESSIONAL", origin: "PHASE_COVERAGE" })).toBe("≥ 1 sessão");
    expect(auditTargetText({ unit: "WEIGHTED_SETS", min: 10, max: 20, basis: "HEURISTIC_ACCEPTED", origin: "PHASE_COVERAGE" })).toBe("10–20 séries ponderadas");
    expect(auditTargetText({ unit: "MINUTES", max: 60, basis: "STUDENT_DATA", origin: "AVAILABILITY" })).toBe("≤ 60 min");
    expect(auditTargetText({ unit: "MINUTES", basis: "STUDENT_DATA", origin: "AVAILABILITY" })).toBeNull();
    expect(rangeText({ min: 3, max: 3 })).toBe("3");
    expect(rangeText({ min: 1.5, max: 4 })).toBe("1,5–4");
    expect(rangeText(null)).toBeNull();
    // An imbalance shows both sides and the pair's name, never "0 : 1".
    const imbalance: AuditReport["findings"][number] = {
      code: "AUDIT_PATTERN_IMBALANCE", severity: "INFO", status: "OPEN", stage: "VALIDATION", phaseIndex: 1, week: 4, pattern: "KNEE_HIP",
      measured: { unit: "RATIO", value: 0, detail: { a: 12, b: 0 } }, sourceRefs: [], rationale: "r", suggestedAction: null,
    };
    const iv = auditView({ ...stored, report: { ...audit, findings: [imbalance] } }, { engineVersion: "2.1.0", acceptSuggestions: false }).observations[0].findings[0];
    expect(iv).toMatchObject({ measured: "Medido: 12 × 0 séries diretas", location: "Semana 4 · dominantes de joelho × de quadril" });
    const unmet: AuditReport["findings"][number] = {
      code: "AUDIT_TARGET_MUSCLE_UNMET", severity: "WARNING", status: "OPEN", stage: "VALIDATION", phaseIndex: 2, week: 3, label: "A", muscle: "QUADRICEPS",
      measured: { unit: "SESSIONS", value: 0 }, target: { unit: "SESSIONS", min: 1, basis: "PROFESSIONAL", origin: "WORKOUT_FOCUS" },
      sourceRefs: [], rationale: "r", suggestedAction: null, count: 3,
    };
    const v = auditView({ ...stored, report: { ...audit, findings: [unmet] } }, { engineVersion: "2.1.0", acceptSuggestions: false });
    expect(v.attention).toHaveLength(1);
    expect(v.attention[0].title).toBe("Fase 2");
    expect(v.attention[0].findings[0]).toMatchObject({
      location: "Semana 3 · treino A · Quadríceps",
      measured: "Medido: 0 sessões",
      target: { text: "Alvo: ≥ 1 sessão", basis: "PROFESSIONAL" },
      aggregated: "(3 achados iguais agrupados)",
      links: [{ phaseIndex: 2, week: 3, text: "Ver a semana 3 da fase 2" }],
    });
  });

  it("time use: the time available is the target with its basis; the rule's threshold is a heuristic on a line of its own", () => {
    const st = structure("2026-11-09", [{ weeks: 2, sessionsPerWeek: 2, stimulus: "STRENGTH", workouts: [{ label: "A", exerciseTarget: 1 }, { label: "B", exerciseTarget: 1 }] }]);
    const r = generate(baseInput({ structure: st, parameters: parameters({ availableMinutes: 60 }) }));
    const view = auditView(storedAudit(r)!, { engineVersion: r.engineVersion, acceptSuggestions: false });
    const all = [...view.attention, ...view.observations, ...view.descriptive].flatMap((g) => g.findings);
    const under = all.find((f) => f.code === "AUDIT_DURATION_UNDERUSED")!;
    // Never "36–60 min" under the professional's (or the student's) pill: 36 is 60% of 60, a heuristic.
    expect(under.target).toEqual({ text: "Alvo: ≤ 60 min", basis: "PROFESSIONAL" });
    expect(under.threshold).toEqual({ text: "Limiar de uso: 36 min", basis: "HEURISTIC" });
    expect(all.filter((f) => f.code !== "AUDIT_DURATION_UNDERUSED").every((f) => f.threshold === null)).toBe(true);
  });

  it("an unknown total says why: doses without sets, items not counted, or both", () => {
    const phase = audit.phases[0];
    const as = (unknownSetItems: number, uncountedItems: number): AuditReport => ({
      ...audit,
      phases: [{
        ...phase,
        weekRows: phase.weekRows.map((w) => ({ ...w, unknownSetItems, uncountedItems, weighted: null })),
        muscles: phase.muscles.map((m) => ({ ...m, direct: null, indirect: null, weighted: null })),
        patterns: phase.patterns.map((x) => ({ ...x, sets: null })),
      }],
    });
    // A custom row (no library exercise) only: "não contado", never "séries não definidas".
    const uncounted = auditPhaseRows(as(0, 1), 1)!;
    expect(new Set(uncounted.muscles.flatMap((m) => [m.direct, m.indirect, m.weighted]))).toEqual(new Set([NOT_COUNTED]));
    expect(uncounted.patterns.every((x) => x.sets === NOT_COUNTED)).toBe(true);
    expect(uncounted.unknownNote).toContain("Item não contado");
    expect(uncounted.unknownNote).not.toContain("Séries não definidas");
    // Doses without sets only.
    const unknown = auditPhaseRows(as(1, 0), 1)!;
    expect(unknown.muscles[0].direct).toBe(UNDEFINED_SETS);
    expect(unknown.unknownNote).toContain("dose sem séries");
    expect(unknown.unknownNote).not.toContain("não contado");
    // Both: neither cause alone.
    const both = auditPhaseRows(as(1, 1), 1)!;
    expect(both.muscles[0].direct).toBe("não calculado");
    expect(both.unknownNote).toContain("dose sem séries");
    expect(both.unknownNote).toContain("não contado");
    // Every total known: no note.
    expect(auditPhaseRows(audit, 1)!.unknownNote).toBeNull();
    // The week total of "Contribuição na semana" names the cause of that week.
    const occ = xintus.occurrences.find((o) => o.phaseIndex === 1 && o.week === 3)!;
    const item = occ.items.find((i) => i.trace.selection.some((t) => t.code === "WEEKLY_CONTRIBUTION"))!;
    const c = contributionView(item, as(0, 1), 1, 3)!.weekTotal!;
    expect(c).toContain("não calculado, há item não contado");
    expect(c).not.toContain(UNDEFINED_SETS);
    expect(contributionView(item, as(1, 1), 1, 3)!.weekTotal).toContain(`${UNDEFINED_SETS} e item não contado`);
  });

  it("the weekly table takes only a recorded audit; the page computes one only when none is recorded", async () => {
    expect(weekTableAudit(stored)).toBe(audit);
    expect(weekTableAudit({ ...stored, source: "VIEW" })).toBeNull();
    expect(weekTableAudit(null)).toBeNull();
    const compute = vi.fn(async () => ({ status: "ok" as const, audit, source: "VIEW" as const, rules: audit.rules }));
    // A recorded audit: straight from the summary already loaded, no call (so no extra read).
    expect(await pageAudit(xintus, compute)).toEqual(stored);
    expect(compute).not.toHaveBeenCalled();
    const legacy = generate(xintusInput(LEGACY_RULES));
    expect(await pageAudit(legacy, compute)).toEqual({ report: audit, source: "VIEW", rules: audit.rules });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(await pageAudit(legacy, async () => ({ status: "not_found" as const }))).toBeNull();
  });

  it("the phase tables: ranges per week, situation, split shape; unknown sets read 'séries não definidas', never 0", () => {
    const rows = auditPhaseRows(audit, 1)!;
    expect(rows.shape).not.toBeNull();
    const quads = rows.muscles.find((m) => m.muscle === "Quadríceps")!;
    expect(quads.situation).toBe("Direto");
    expect(quads.direct).toMatch(/^\d+(–\d+)?$/);
    expect(rows.muscles.every((m) => !/^[A-Z_]+$/.test(m.muscle))).toBe(true);
    expect(rows.patterns.every((p) => p.sessions !== "0")).toBe(true);
    expect(auditPhaseRows(audit, 9)).toBeNull();
    // Empty doses (LEAVE_EMPTY): set ranges are unknown, presence still counts.
    const empty = generate(xintusInput(DEFAULT_RULESET, { parameters: { ...xintusInput().parameters, doseMode: "LEAVE_EMPTY" } }));
    const er = auditPhaseRows(empty.audit!, 1)!;
    const q = er.muscles.find((m) => m.muscle === "Quadríceps")!;
    expect([q.direct, q.indirect, q.weighted]).toEqual([UNDEFINED_SETS, UNDEFINED_SETS, UNDEFINED_SETS]);
    expect(q.situation).toBe("Direto");
    expect(Number(q.directSessions.split("–")[0])).toBeGreaterThan(0);
  });

  it("the weekly table gains sessions with direct stimulus (from the audit) and the target; '—' without an audit", () => {
    const rows = weekVolume(xintus.volume, 1, 1, audit);
    const quads = rows.find((r) => r.muscle === "Quadríceps")!;
    expect(Number(quads.directSessions)).toBe(audit.phases[0].weekRows[0].directSessions.QUADRICEPS);
    expect(quads.target).toBeNull();
    expect(weekVolume(xintus.volume, 1, 1).every((r) => r.directSessions === "—" && r.target === null)).toBe(true);
    // A muscle only worked indirectly that week has 0 sessions with direct stimulus when every item was counted.
    const indirect = rows.find((r) => r.direct === "0");
    if (indirect) expect(indirect.directSessions).toBe("0");
  });

  it("'Contribuição na semana': the item's recorded sentence plus the week total from the audit, or nothing", () => {
    const occ = xintus.occurrences.find((o) => o.phaseIndex === 1 && o.week === 3)!;
    const item = occ.items.find((i) => i.trace.selection.some((t) => t.code === "WEEKLY_CONTRIBUTION"))!;
    const c = contributionView(item, audit, 1, 3)!;
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]).toMatch(/^Semana 3: 2 sessões do treino [AB] × \d+ séries = /);
    expect(c.weekTotal).toBe(`Total da semana 3 na fase (4 sessões): ${auditValueText("WEIGHTED_SETS", audit.phases[0].weekRows[2].weighted!)}.`);
    expect(contributionView(item, null, 1, 3)!.weekTotal).toBeNull();
    // Rules without the audit: no entry, nothing shown.
    const legacy = generate(xintusInput(LEGACY_RULES));
    expect(contributionView(legacy.occurrences[0].items[0], null, 1, 1)).toBeNull();
    // Unknown sets: the total is not computed (never 0).
    const empty = generate(xintusInput(DEFAULT_RULESET, { parameters: { ...xintusInput().parameters, doseMode: "LEAVE_EMPTY" } }));
    const eItem = empty.occurrences[0].items.find((i) => i.trace.selection.some((t) => t.code === "WEEKLY_CONTRIBUTION"))!;
    const ec = contributionView(eItem, empty.audit!, 1, empty.occurrences[0].week)!;
    expect(ec.lines[0]).toContain("séries não definidas");
    expect(ec.weekTotal).toContain("não calculado");
  });
});

describe("Motor V3 S4: 'Por quê?' answers the six questions (design §5, §7.1)", () => {
  const xintus = generate(xintusInput());
  const audit = xintus.audit!;
  const occ = xintus.occurrences.find((o) => o.phaseIndex === 1 && o.week === 3)!;
  const squat = occ.items.find((i) => i.trace.selection.some((t) => t.code === "ASSESSMENT_OBSERVATION"))!;

  it("six sections in order, each from the item's own trace; empty ones are left out", () => {
    const why = whyView(squat, { rulesUsed: xintus.rulesUsed, contribution: contributionView(squat, audit, 1, 3) });
    expect(why.map((s) => s.key)).toEqual(["choice", "student", "contribution", "sets", "rules", "change"]);
    const by = Object.fromEntries(why.map((s) => [s.key, s]));
    // why this exercise: the selection entries (eligibility, equipment, microcycle terms, rank), never the derived ones
    expect(by.choice.lines.map((l) => l.text).join(" ")).toMatch(/Elegível/);
    expect(by.choice.lines.some((l) => /Não é contraindicação|sessões do treino/.test(l.text))).toBe(false);
    // the student's data: the assessment reading with its reference, labelled as not a contraindication
    const obs = by.student.lines.find((l) => l.text.includes("Não é contraindicação"))!;
    expect(obs.basis).toBe("STUDENT_DATA");
    expect(obs.text).toContain("assessment:as-xintus");
    expect(obs.rule).toBeTruthy();
    // weekly contribution with the week total, why N sets with its basis and rule
    expect(by.contribution.lines[0].text).toMatch(/^Semana 3: 2 sessões do treino [AB] × 3 séries/);
    expect(by.contribution.lines.at(-1)!.muted).toBe(true);
    expect(by.sets.title).toBe("Por que 3 séries");
    expect(by.sets.lines[0]).toMatchObject({ basis: "HEURISTIC" });
    expect(by.sets.lines[0].text).toContain("política de doses");
    // rules used: each rule id once, with its label
    const ruleIds = by.rules.lines.map((l) => /\(([A-Z_]+)\)$/.exec(l.text)?.[1]);
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
    expect(ruleIds).toContain("DOSE_DEFAULTS");
    expect(ruleIds).toContain("FINDING_OBSERVATION_MAP");
    // what would change it: from the codes present
    expect(by.change.lines.map((l) => l.text)).toContain("Se a observação na execução mostrar compensação, decida com o aluno (não é contraindicação).");
  });

  it("'O que mudaria esta escolha' only for codes present: no history entry, no history condition", () => {
    const item = (selection: Array<{ code: string; basis?: string }>, sets?: { basis: string; ruleId?: string }) =>
      ({
        trace: {
          selection: selection.map((t) => ({ code: t.code, basis: t.basis ?? "HEURISTIC", detail: t.code })),
          params: sets ? [{ param: "sets", value: 3, ...sets }] : [],
        },
      }) as unknown as ItemOut;
    expect(changeConditions(item([{ code: "ELIGIBLE" }]))).toEqual(["Se as modalidades do treino ou as suas exclusões mudarem."]);
    expect(changeConditions(item([{ code: "ELIGIBLE" }])).some((t) => t.includes("dor"))).toBe(false);
    expect(changeConditions(item([{ code: "HISTORY_PAIN", basis: "STUDENT_DATA" }, { code: "HISTORY_CONTINUITY", basis: "STUDENT_DATA" }]))).toEqual([
      "Se o aluno registrar dor ou não tolerar o exercício.",
    ]);
    expect(changeConditions(item([{ code: "MICRO_TARGET_DEFICIT" }]))[0]).toContain("alvo semanal");
    expect(changeConditions(item([{ code: "LOCKED", basis: "PROFESSIONAL" }]))).toEqual(["Está mantido por você: só muda se você destravar."]);
    expect(changeConditions(item([], { basis: "PROFESSIONAL" }))).toEqual(["A dose é sua: muda só se você a editar."]);
    expect(changeConditions(item([], { basis: "HEURISTIC", ruleId: "DOSE_DEFAULTS" }))[0]).toContain("política de doses");
    expect(changeConditions(item([{ code: "UNMAPPED_CODE" }]))).toEqual([]);
  });

  it("an item without sets, contribution or student data has only what it carries; a preserved row says it is the professional's", () => {
    const legacy = generate(xintusInput(LEGACY_RULES));
    const plain = legacy.occurrences[0].items[0];
    const why = whyView(plain, { rulesUsed: legacy.rulesUsed, contribution: contributionView(plain, null, 1, 1) });
    expect(why.map((s) => s.key)).not.toContain("contribution");
    expect(why.map((s) => s.key)).not.toContain("student");
    const empty = generate(xintusInput(DEFAULT_RULESET, { parameters: { ...xintusInput().parameters, doseMode: "LEAVE_EMPTY" } }));
    const blank = empty.occurrences[0].items[0];
    expect(whyView(blank, { rulesUsed: empty.rulesUsed, contribution: null }).map((s) => s.key)).not.toContain("sets");
    const preserved = { trace: { selection: [{ code: "PRESERVED", basis: "PROFESSIONAL", detail: "Linha preservada." }], params: [] } } as unknown as ItemOut;
    expect(whyView(preserved, { rulesUsed: [], contribution: null })).toEqual([
      { key: "choice", title: "Por que este exercício", lines: [{ text: "Linha preservada.", basis: "PROFESSIONAL", rule: null }] },
      { key: "change", title: "O que mudaria esta escolha", lines: [{ text: "Já estava no rascunho: a ferramenta não o troca; mude no editor da revisão.", basis: null, rule: null }] },
    ]);
  });

  it("the suggested-targets card is drawn only for phases a recorded audit says have none, under rules that can back it", () => {
    const stored = storedAudit(xintus)!;
    expect(audit.findings.some((f) => f.code === "AUDIT_NO_TARGETS")).toBe(true);
    expect(phasesWithoutTargets(stored, true)).toEqual([1, 2, 3]);
    expect(phasesWithoutTargets(stored, false)).toEqual([]);
    expect(phasesWithoutTargets({ ...stored, source: "VIEW" }, true)).toEqual([]);
    expect(phasesWithoutTargets(null, true)).toEqual([]);
    const view = auditView(stored, { engineVersion: xintus.engineVersion, acceptSuggestions: true });
    const offered = [...view.observations, ...view.attention].flatMap((g) => g.findings).filter((f) => f.offerSuggestion);
    expect(offered.map((f) => f.phaseIndex)).toEqual([1, 2, 3]);
  });
});
