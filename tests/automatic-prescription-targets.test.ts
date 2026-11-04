import { describe, expect, it } from "vitest";
import type { StudentProfile } from "@/db/student-profile";
import { emptyProfile } from "@/modules/ficha/contracts";
import { toExposureHistory } from "@/modules/execucao/exposures";
import { buildEngineInput } from "@/modules/prescricao/automatica/build-input";
import { parseGenerationAnswers, type GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import type { GenerationContext } from "@/modules/prescricao/automatica/facts";
import { patchAnswers, screenTargetSuggestions } from "@/modules/prescricao/automatica/service";
import {
  answersFromForm,
  coverageFromEdit,
  editFromSuggestion,
  EMPTY_FORM,
  formFromAnswers,
  formSuggestionFor,
  suggestionEntry,
  targetSuggestionView,
} from "@/modules/prescricao/automatica/view";
import { generate, type EngineResult } from "@/modules/prescricao/motor";
import { targetSuggestion, type TargetSuggestion } from "@/modules/prescricao/motor/targets";
import { buildPeriodization } from "@/modules/training/periodization";
import { AUDIT_RULES, CATALOG, LEGACY_RULES } from "./helpers/motor-fixtures";

// Motor V3 S4 (design §3.6, §4.6, §7.4, §8.3.5 and §8.7.6 pure part): weekly targets and targets per workout in the answers,
// the one acceptance branch per rule set (exact equality with the rule's suggestion), free splits through the adapter, the
// merge of a regeneration patch by phase and workout, and the screen's suggestion per stimulus.

const profile = (): StudentProfile => ({
  ...emptyProfile, studentId: "st-1", updatedAt: "2026-11-01T10:00:00.000Z", level: "Intermediário", goal: "Hipertrofia", daysPerWeek: 4, sessionMinutes: 60,
});
type Phase = { name: string | null; weeks: number; sessionsPerWeek: number; workouts: Array<{ label: string; exerciseTarget: number | null }>; trainingDays: number[] };
const ctxOf = (phases: Phase[]): GenerationContext => ({
  asOf: "2026-11-20",
  plan: { id: "plan-1", studentId: "st-1", title: "Plano" },
  revision: { id: "rev-1", state: "DRAFT", contentVersion: 1, prescriptionModel: "TEMPLATE", schedule: buildPeriodization({ schemaVersion: 2, startDate: "2026-11-23", phases }) },
  profile: profile(),
  assessment: null,
  catalog: CATALOG,
  catalogHash: "c".repeat(64),
  cautionTagsUnknown: [],
  history: { window: { since: "2026-05-24", until: "2026-11-20", sinceDays: 180, sessions: 0, truncated: false }, summary: toExposureHistory([]) },
  existing: [],
});
const ABCD = ctxOf([{ name: "Base", weeks: 2, sessionsPerWeek: 4, trainingDays: [0, 1, 3, 4], workouts: ["A", "B", "C", "D"].map((label) => ({ label, exerciseTarget: 4 })) }]);
const AB = ctxOf([{ name: "Base", weeks: 2, sessionsPerWeek: 2, trainingDays: [0, 3], workouts: ["A", "B"].map((label) => ({ label, exerciseTarget: 4 })) }]);
const BASE: GenerationAnswersInput = {
  stimulusByPhase: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" }],
  equipmentCodes: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE"],
};
const UPPER = ["BICEPS", "CHEST", "FRONT_DELTOID", "LATS", "TRICEPS", "UPPER_BACK"];
const LOWER = ["GLUTEUS", "HAMSTRINGS", "QUADRICEPS"];

const built = (ctx: GenerationContext, answers: GenerationAnswersInput, rules?: { id: string; version: string }) => {
  const out = buildEngineInput(ctx, parseGenerationAnswers(answers), rules ? { rules } : {});
  if (!out.ok) throw new Error(`${out.code} ${JSON.stringify(out)}`);
  return out;
};
const suggestionOf = (ctx: GenerationContext): TargetSuggestion => {
  const input = built(ctx, BASE).input;
  const s = targetSuggestion(input.rules, input.structure.phases[0], input).suggestion;
  if (!s) throw new Error("no suggestion");
  return s;
};
const primaryIn = (r: EngineResult, labels: string[]) =>
  new Set(
    r.occurrences
      .filter((o) => labels.includes(o.label))
      .flatMap((o) => o.items.flatMap((i) => CATALOG.find((e) => e.id === i.exerciseId)?.primaryMuscles ?? [])),
  );

describe("the answers contract: weekly targets and targets per workout", () => {
  it("takes weekly sets per muscle (min never above max, one per muscle) and targets per workout (one per workout)", () => {
    const ok = parseGenerationAnswers({
      phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", muscles: ["CHEST"], weeklySets: [{ muscle: "CHEST", minWeighted: 10, maxWeighted: 20, minDirectSessions: 2 }] }],
      coverageByWorkout: [{ phaseIndex: 1, label: "A", muscles: ["CHEST"] }],
    });
    expect(ok.phaseCoverage[0].weeklySets).toEqual([{ muscle: "CHEST", minWeighted: 10, maxWeighted: 20, minDirectSessions: 2 }]);
    expect(ok.coverageByWorkout).toEqual([{ phaseIndex: 1, label: "A", muscles: ["CHEST"] }]);
    // Saved answers from before keep parsing: both fields are optional.
    expect(parseGenerationAnswers({}).coverageByWorkout).toEqual([]);
    const bad = (raw: unknown) => expect(() => parseGenerationAnswers(raw)).toThrow();
    bad({ phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", weeklySets: [{ muscle: "CHEST", minWeighted: 20, maxWeighted: 10 }] }] });
    bad({ phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", weeklySets: [{ muscle: "CHEST" }, { muscle: "CHEST" }] }] });
    bad({ phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", weeklySets: [{ muscle: "NOPE" }] }] });
    bad({ phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", weeklySets: [{ muscle: "CHEST", minDirectSessions: 1.5 }] }] });
    bad({ coverageByWorkout: [{ phaseIndex: 1, label: "A" }, { phaseIndex: 1, label: "A" }] });
    bad({ coverageByWorkout: [{ phaseIndex: 1, label: "A", muscles: ["CHEST"], basis: "HEURISTIC_ACCEPTED" }] });
  });
});

describe("the adapter: targets per workout and weekly sets (design V3 §3.6)", () => {
  it("writes a workout's targets as its focus; an unknown workout is refused", () => {
    const out = built(ABCD, { ...BASE, coverageByWorkout: [{ phaseIndex: 1, label: "A", muscles: ["LATS", "CHEST"], patterns: ["HORIZONTAL_PUSH"] }] });
    const [a, b] = out.input.structure.phases[0].workouts;
    expect(a.focus).toMatchObject({ muscles: ["CHEST", "LATS"], patterns: ["HORIZONTAL_PUSH"] });
    expect(b.focus.muscles).toBeUndefined();
    expect(buildEngineInput(ABCD, parseGenerationAnswers({ ...BASE, coverageByWorkout: [{ phaseIndex: 1, label: "Z", muscles: ["CHEST"] }] }))).toEqual({
      ok: false, code: "UNKNOWN_TARGET", targets: [{ phaseIndex: 1, label: "Z" }],
    });
    // Without targets per workout, the input is the same as before this field existed.
    expect(built(ABCD, { ...BASE, coverageByWorkout: [] }).input).toEqual(built(ABCD, BASE).input);
  });

  it("keeps weekly sets only for rule sets with the audit; an older proposal's input gains no unknown field", () => {
    const answers: GenerationAnswersInput = {
      ...BASE, phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", muscles: ["CHEST"], weeklySets: [{ muscle: "CHEST", minWeighted: 8 }] }],
    };
    expect(built(ABCD, answers).input.parameters.phaseCoverage[0].weeklySets).toEqual([{ muscle: "CHEST", minWeighted: 8 }]);
    expect(built(ABCD, answers, AUDIT_RULES).input.parameters.phaseCoverage[0].weeklySets).toEqual([{ muscle: "CHEST", minWeighted: 8 }]);
    const legacy = built(ABCD, answers, LEGACY_RULES).input.parameters.phaseCoverage[0];
    expect("weeklySets" in legacy).toBe(false);
    expect(legacy).toEqual(built(ABCD, { ...BASE, phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", muscles: ["CHEST"] }] }, LEGACY_RULES).input.parameters.phaseCoverage[0]);
  });
});

describe("accepting the suggested targets: one branch per rule set, exact equality (design V3 §4.6)", () => {
  it("takes the suggestion as is; a subset or a changed number is the professional's, never 'aceita'", () => {
    const s = suggestionOf(ABCD);
    const run = (entry: Record<string, unknown>) => buildEngineInput(ABCD, parseGenerationAnswers({ ...BASE, phaseCoverage: [entry] } as GenerationAnswersInput));
    expect(run(suggestionEntry(s))).toMatchObject({ ok: true });
    // order does not matter
    expect(run({ ...suggestionEntry(s), muscles: [...s.muscles].reverse() })).toMatchObject({ ok: true });
    const refused = { ok: false, code: "UNSUPPORTED_SUGGESTION", targets: [{ field: "phaseCoverage", phaseIndex: 1 }] };
    const subset = { ...suggestionEntry(s), muscles: s.muscles.slice(1), weeklySets: s.weeklySets.slice(1) };
    expect(run(subset)).toEqual(refused);
    expect(run({ ...subset, basis: "PROFESSIONAL", ruleId: undefined })).toMatchObject({ ok: true });
    expect(run({ ...suggestionEntry(s), weeklySets: s.weeklySets.map((w) => ({ ...w, minWeighted: 12 })) })).toEqual(refused);
    expect(run({ ...suggestionEntry(s), weeklySets: undefined })).toEqual(refused);
    expect(run({ ...suggestionEntry(s), ruleId: "MADE_UP_RULE" })).toEqual(refused);
    // A DEFAULT_COVERAGE acceptance already stored keeps parsing under the newer rules (saved answers keep working).
    expect(run({ phaseIndex: 1, basis: "HEURISTIC_ACCEPTED", ruleId: "DEFAULT_COVERAGE", patterns: ["SQUAT", "HINGE"] })).toMatchObject({ ok: true });
    // The suggestion of another stimulus is not the suggestion of this phase.
    const strength = buildEngineInput(ABCD, parseGenerationAnswers({ ...BASE, stimulusByPhase: [{ phaseIndex: 1, value: "STRENGTH", basis: "PROFESSIONAL" }], phaseCoverage: [suggestionEntry(s)] }));
    expect(strength).toEqual(refused);
  });

  it("rule sets without the suggestion rule (2026.11.2, 2026.11.3) refuse it and keep the DEFAULT_COVERAGE branch as it was", () => {
    const s = suggestionOf(ABCD);
    for (const rules of [LEGACY_RULES, AUDIT_RULES]) {
      expect(buildEngineInput(ABCD, parseGenerationAnswers({ ...BASE, phaseCoverage: [suggestionEntry(s)] }), { rules })).toMatchObject({ ok: false, code: "UNSUPPORTED_SUGGESTION" });
      expect(buildEngineInput(ABCD, parseGenerationAnswers({ ...BASE, phaseCoverage: [{ phaseIndex: 1, basis: "HEURISTIC_ACCEPTED", ruleId: "DEFAULT_COVERAGE", patterns: ["SQUAT"] }] }), { rules })).toMatchObject({ ok: true });
    }
  });

  it("the suggested sessions per week follow what the structure offers: ABCD 4×/week ≥ 2 of 4; AB 2×/week none (would force every workout)", () => {
    const abcd = suggestionOf(ABCD);
    expect(abcd.supply).toBe(4);
    expect(abcd.weeklySets.every((w) => w.minDirectSessions === 2)).toBe(true);
    expect(targetSuggestionView(abcd).sessions).toBe("Sessões com estímulo direto por semana, por músculo: ≥ 2 de 4 sessões por semana que a estrutura oferece.");
    const ab = suggestionOf(AB);
    expect(ab.supply).toBe(2);
    expect(ab.weeklySets.some((w) => w.minDirectSessions !== undefined)).toBe(false);
    expect(targetSuggestionView(ab).sessions).toContain("A estrutura oferece 2 sessões por semana com treino de volume; frequência mínima não sugerida");
    // The card never suggests calves, biceps, triceps or abs.
    expect(abcd.muscles.some((m) => ["CALVES", "BICEPS", "TRICEPS", "ABS"].includes(m))).toBe(false);
  });

  it("accepting goes into the engine as heurística aceita with its rule, and every target muscle then has a weekly target", () => {
    const s = suggestionOf(ABCD);
    const input = built(ABCD, { ...BASE, phaseCoverage: [suggestionEntry(s)] }).input;
    const result = generate(input);
    expect(result.status).toBe("SUCCEEDED");
    const cov = result.workouts.find((w) => w.label === "A")?.coverage;
    expect(cov).toMatchObject({ basis: "HEURISTIC_ACCEPTED", ruleId: "MICROCYCLE_TARGET_SUGGESTIONS", origin: "PHASE_COVERAGE" });
    expect(cov?.weeklySets?.map((w) => w.muscle).sort()).toEqual([...s.muscles].sort());
    expect(result.issues.some((i) => i.code === "NO_TARGETS")).toBe(false);
    expect(result.audit?.findings.some((f) => f.code === "AUDIT_NO_TARGETS")).toBe(false);
  });
});

describe("free splits through the adapter (design V3 §8.3.5)", () => {
  it("ABCD upper/lower: no upper muscle is primary in a lower workout and vice versa; CHEST (≥ 2 sessions) goes to the two upper workouts", () => {
    const answers: GenerationAnswersInput = {
      ...BASE,
      coverageByWorkout: [
        { phaseIndex: 1, label: "A", muscles: UPPER },
        { phaseIndex: 1, label: "B", muscles: LOWER },
        { phaseIndex: 1, label: "C", muscles: UPPER },
        { phaseIndex: 1, label: "D", muscles: LOWER },
      ],
      phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", weeklySets: [{ muscle: "CHEST", minDirectSessions: 2 }] }],
    };
    const result = generate(built(ABCD, answers).input);
    expect(result.status).toBe("SUCCEEDED");
    const lower = primaryIn(result, ["B", "D"]);
    const upper = primaryIn(result, ["A", "C"]);
    for (const m of UPPER) expect(lower.has(m)).toBe(false);
    for (const m of LOWER) expect(upper.has(m)).toBe(false);
    for (const label of ["A", "C"]) expect(primaryIn(result, [label]).has("CHEST")).toBe(true);
    // counts respected in every session
    expect(result.occurrences.every((o) => o.items.length === 4)).toBe(true);
    // the audit reads CHEST with 2 direct sessions every week
    const chest = result.audit?.phases[0].muscles.find((m) => m.muscle === "CHEST");
    expect(chest?.directSessions.min).toBe(2);
  });

  it("AB (both full body) and a single workout still generate with the counts respected", () => {
    for (const [ctx, count] of [[AB, 4], [ctxOf([{ name: null, weeks: 2, sessionsPerWeek: 3, trainingDays: [0, 2, 4], workouts: [{ label: "Full", exerciseTarget: 5 }] }]), 5]] as const) {
      const result = generate(built(ctx, BASE).input);
      expect(result.status).toBe("SUCCEEDED");
      expect(result.occurrences.every((o) => o.items.length === count)).toBe(true);
    }
  });
});

describe("a regeneration patch merges the targets by phase and by workout (design V3 §4.5)", () => {
  it("accepting phase 2 keeps phase 1; a workout's targets replace only that workout's", () => {
    const stored = {
      phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", muscles: ["CHEST"] }],
      coverageByWorkout: [{ phaseIndex: 1, label: "A", muscles: ["CHEST"] }, { phaseIndex: 1, label: "B", muscles: ["QUADRICEPS"] }],
      acceptedFlagDecisions: [{ flagCode: "X", decision: { kind: "ACKNOWLEDGE" } }],
      equipmentCodes: ["BARBELL"],
    };
    const out = patchAnswers(stored, {
      phaseCoverage: [{ phaseIndex: 2, basis: "PROFESSIONAL", muscles: ["LATS"] }],
      coverageByWorkout: [{ phaseIndex: 1, label: "B", muscles: ["HAMSTRINGS"] }],
    }) as Record<string, unknown>;
    expect(out.phaseCoverage).toEqual([{ phaseIndex: 1, basis: "PROFESSIONAL", muscles: ["CHEST"] }, { phaseIndex: 2, basis: "PROFESSIONAL", muscles: ["LATS"] }]);
    expect(out.coverageByWorkout).toEqual([{ phaseIndex: 1, label: "A", muscles: ["CHEST"] }, { phaseIndex: 1, label: "B", muscles: ["HAMSTRINGS"] }]);
    expect(out.acceptedFlagDecisions).toEqual(stored.acceptedFlagDecisions);
    expect(out.equipmentCodes).toEqual(["BARBELL"]);
    // the same phase again replaces it; a patch without the field keeps the stored list
    expect((patchAnswers(stored, { phaseCoverage: [{ phaseIndex: 1, basis: "PROFESSIONAL", muscles: ["LATS"] }] }) as Record<string, unknown>).phaseCoverage).toEqual([
      { phaseIndex: 1, basis: "PROFESSIONAL", muscles: ["LATS"] },
    ]);
    expect((patchAnswers(stored, {}) as Record<string, unknown>).phaseCoverage).toEqual(stored.phaseCoverage);
    expect(patchAnswers(stored, [1])).toEqual([1]);
  });
});

describe("the card and the form (design V3 §7.4)", () => {
  it("the editor sends exactly the suggestion as aceita; any change, removal or per-workout target as the professional's", () => {
    const s = suggestionOf(ABCD);
    const labels = ["A", "B", "C", "D"];
    const same = coverageFromEdit(1, editFromSuggestion(s, labels), s);
    expect(same).toEqual({ ok: true, coverage: suggestionEntry(s), byWorkout: [] });
    const fewer = coverageFromEdit(1, { ...editFromSuggestion(s, labels), muscles: s.muscles.slice(1) }, s);
    expect(fewer.ok && fewer.coverage?.basis).toBe("PROFESSIONAL");
    expect(fewer.ok && fewer.coverage?.weeklySets?.length).toBe(s.muscles.length - 1);
    const split = coverageFromEdit(1, { ...editFromSuggestion(s, labels), byWorkout: [{ label: "A", muscles: ["CHEST"] }, { label: "B", muscles: [] }] }, s);
    expect(split).toMatchObject({ ok: true, coverage: { basis: "PROFESSIONAL" }, byWorkout: [{ phaseIndex: 1, label: "A", muscles: ["CHEST"] }] });
    // empty numbers are left out (never 0); a bad number names what to fix
    const blank = coverageFromEdit(1, { ...editFromSuggestion(s, labels), minWeighted: "", maxWeighted: "", minDirectSessions: "" }, s);
    expect(blank.ok && blank.coverage?.weeklySets).toBeUndefined();
    expect(coverageFromEdit(1, { ...editFromSuggestion(s, labels), minWeighted: "30", maxWeighted: "10" }, s)).toMatchObject({ ok: false });
    expect(coverageFromEdit(1, { ...editFromSuggestion(s, labels), minDirectSessions: "1,5" }, s)).toMatchObject({ ok: false });
    // nothing chosen at all: no coverage
    expect(coverageFromEdit(1, { muscles: [], patterns: [], minWeighted: "", maxWeighted: "", minDirectSessions: "", byWorkout: [] }, null)).toEqual({ ok: true, coverage: null, byWorkout: [] });
    // both answers go through the strict contract
    for (const out of [same, fewer, split]) if (out.ok) expect(() => parseGenerationAnswers({ phaseCoverage: out.coverage ? [out.coverage] : [], coverageByWorkout: out.byWorkout })).not.toThrow();
  });

  it("the form's suggestion follows the stimulus chosen on screen; modalities chosen there send it to the proposal; the server agrees", () => {
    const screen = screenTargetSuggestions(built(ABCD, { equipmentCodes: BASE.equipmentCodes }).input);
    expect(screen).toHaveLength(1);
    const phase = screen[0];
    expect(phase.asIs.suggestion).toBeNull(); // no stimulus in the periodization
    const form = { ...EMPTY_FORM, stimulus: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" as const }] };
    const picked = formSuggestionFor(phase, form);
    expect(picked.suggestion).toEqual(suggestionOf(ABCD));
    expect(formSuggestionFor(phase, { ...form, modalities: [{ phaseIndex: 1, label: "A", modalities: ["RESISTANCE"] }] })).toEqual({ suggestion: null, reason: "MODALITIES_CHOSEN" });
    // accepted in the form, sent on "Gerar", accepted by the server
    const answers = answersFromForm({ ...form, equipment: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE"], coverage: [suggestionEntry(picked.suggestion!)] }, []);
    expect(answers.ok).toBe(true);
    if (answers.ok) expect(buildEngineInput(ABCD, parseGenerationAnswers(answers.answers))).toMatchObject({ ok: true });
    // earlier answers come back with the professional's own targets only (an old acceptance is accepted again on screen)
    const back = formFromAnswers(
      { phaseCoverage: [suggestionEntry(picked.suggestion!), { phaseIndex: 9, basis: "PROFESSIONAL", muscles: ["CHEST"] }], coverageByWorkout: [{ phaseIndex: 1, label: "A", muscles: ["CHEST"] }, { phaseIndex: 1, label: "Z", muscles: ["CHEST"] }] },
      [{ index: 1, workouts: [{ label: "A" }, { label: "B" }] }],
      [],
    );
    expect(back.coverage).toEqual([]);
    expect(back.coverageByWorkout).toEqual([{ phaseIndex: 1, label: "A", muscles: ["CHEST"] }]);
    // older rule sets: no suggestions on the screen
    expect(screenTargetSuggestions(built(ABCD, BASE, AUDIT_RULES).input, AUDIT_RULES)).toEqual([]);
  });
});
