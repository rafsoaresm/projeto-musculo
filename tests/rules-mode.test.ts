import { describe, expect, it } from "vitest";
import { BLUEPRINT_LABEL, trainingBlueprintSchema, type TrainingBlueprint } from "@/modules/prescricao/planejador/blueprint";
import { validatePlannerResponse } from "@/modules/prescricao/planejador/blueprint-validate";
import type { PlanningContextBundle, PlanningWorkout } from "@/modules/prescricao/planejador/context-types";
import { blueprintHash } from "@/modules/prescricao/planejador/hashes";
import { ROLE_FOCUS_INTERIM_TABLE } from "@/modules/prescricao/planejador/role-focus";
import { chooseFamilies, nonVolumeRoleOf, preferenceFor, produceRulesBlueprint } from "@/modules/prescricao/planejador/rules-mode/producer";
import {
  FAMILY_EXPLANATION, FAMILY_TRADEOFF, RULES_GLOBAL_RATIONALE, RULES_QUESTION_TEXT, RULES_TEMPLATES, RULES_TEMPLATES_VERSION, RULES_UNCERTAINTY_TEXT, SCHEDULE_CHANGE_TRADEOFF,
} from "@/modules/prescricao/planejador/rules-mode/templates";
import { proseProblems } from "@/modules/prescricao/planejador/text-guards";
import { toStrategyListView } from "@/modules/prescricao/planejador/strategy-view";
import { ROLE_FOCUS_INTERIM } from "@/modules/prescricao/planejador/versions";
import { CANARY, canaryBundle, upperLowerResponse, xintusBundle } from "./helpers/planning-fixtures";

// Rules mode (sub-stage 1.3): the SAME TrainingBlueprint type as the AI planner, built with no network and no clock from the coded context.
// Pure tests; the persistence and the service are in planner-service.test.ts.
type Spec = string | { label: string; modalities?: string[] | null; existingFocus?: PlanningWorkout["existingFocus"] };
interface PhaseSpec { sessionsPerWeek: number; labels: Spec[] }

let base: PlanningContextBundle | null = null;
async function synth(phases: PhaseSpec[], experience: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null = "INTERMEDIATE"): Promise<PlanningContextBundle> {
  base ??= await xintusBundle();
  const workouts = new Map<string, `T${number}`>();
  const alias = (label: string): `T${number}` => {
    if (!workouts.has(label)) workouts.set(label, `T${workouts.size + 1}`);
    return workouts.get(label)!;
  };
  const periodization = {
    irregular: false,
    phases: phases.map((p, i) => ({
      index: i + 1, weeks: 4, sessionsPerWeek: p.sessionsPerWeek, stimulus: "HYPERTROPHY", weekdays: null,
      weekSequence: [] as string[],
      workouts: p.labels.map((spec) => {
        const s = typeof spec === "string" ? { label: spec } : spec;
        return {
          alias: alias(s.label), sessionsInPhase: 4, perWeek: { min: 1, max: 1 }, modalities: s.modalities === undefined ? ["RESISTANCE"] : s.modalities,
          exerciseTarget: 6, existingFocus: s.existingFocus ?? null, hasFixedItems: false,
        } satisfies PlanningWorkout;
      }),
    })),
  };
  return {
    ...base,
    context: { ...base.context, student: { ...base.context.student, experience }, periodization },
    aliases: { ...base.aliases, workouts: new Map([...workouts].map(([label, a]) => [a, label])) },
  };
}
const families = (b: TrainingBlueprint) => b.strategies.map((s) => s.splitFamily);
const rolesOf = (b: TrainingBlueprint, strategy: "S1" | "S2" | "S3", phase = 1) =>
  Object.fromEntries(b.strategies.find((s) => s.strategyId === strategy)!.phases.find((p) => p.phaseIndex === phase)!.workouts.map((w) => [w.label, w.role]));
const phasesOf = (n: number, sessionsPerWeek: number, labels: Spec[]): PhaseSpec[] => Array.from({ length: n }, () => ({ sessionsPerWeek, labels }));

describe("the producer returns the contract's blueprint, deterministically", () => {
  it("Xintus (4 sessions, ABAB, intermediate): upper/lower recommended, A and B get different roles, full body next, and a card that needs a schedule change", async () => {
    const bundle = await xintusBundle();
    const b = produceRulesBlueprint(bundle);
    expect(trainingBlueprintSchema.safeParse(b).success).toBe(true);
    expect(families(b)).toEqual(["UPPER_LOWER", "FULL_BODY", "PUSH_PULL_LEGS"]);
    expect(b.recommendedStrategyId).toBe("S1");
    // the accepted split shows up as concrete differences between A and B, in every phase
    for (const phase of [1, 2, 3]) expect(rolesOf(b, "S1", phase)).toEqual({ A: "UPPER", B: "LOWER" });
    expect(rolesOf(b, "S2")).toEqual({ A: "FULL_BODY", B: "FULL_BODY" });
    const [s1, s2, s3] = b.strategies;
    expect([s1, s2, s3].map((s) => [s.supportedByContext, s.requiresScheduleChange])).toEqual([["YES", false], ["YES", false], ["NO", true]]);
    expect(s3.tradeoffs).toContain(SCHEDULE_CHANGE_TRADEOFF);
    // it can be accepted (PR 2) only when no schedule change is needed
    const view = toStrategyListView(b, "run-1", 3);
    expect(view.strategies.map((s) => s.acceptable)).toEqual([true, true, false]);
  });

  it("is a RULES blueprint, never presented as AI: producer, label, provenance, fixed names, no candidates, no deltas, no dose or progression intent", async () => {
    const b = produceRulesBlueprint(await xintusBundle());
    expect(b.producer).toEqual({ kind: "RULES", templatesVersion: RULES_TEMPLATES_VERSION });
    expect(RULES_TEMPLATES_VERSION).toBe("interim-1");
    expect(b.label).toBe(BLUEPRINT_LABEL.RULES);
    expect(b.label).toBe("Heurística operacional (editável)");
    expect(b.roleFocusRef).toBe(ROLE_FOCUS_INTERIM);
    for (const s of b.strategies) {
      expect(s.provenance).toBe("RULES_HEURISTIC");
      expect(s.dosingIntent).toEqual([]);
      expect(s.progressionIntent).toEqual([]);
      for (const p of s.phases)
        for (const w of p.workouts) {
          expect(w.focusDelta).toBeNull();
          expect(w.candidateExerciseIds).toEqual([]);
          expect(w.source).toBe("RULES_HEURISTIC");
        }
    }
    const view = toStrategyListView(b, "run-1", 3);
    expect(view.producer).toBe("RULES");
    expect(JSON.stringify(view)).not.toMatch(/openai|anthropic|google|mock|modelId|provider/i);
  });

  it("is deterministic: the same bundle gives the same blueprint hash, and there is no clock or network in the module", async () => {
    const a = produceRulesBlueprint(await xintusBundle());
    const b = produceRulesBlueprint(await xintusBundle());
    expect(await blueprintHash(a)).toBe(await blueprintHash(b));
    expect(a.contextHash).toBe((await xintusBundle()).contextHash);
  });

  it("carries the hashes of the bundle it was made from (context, structure, alias map)", async () => {
    const bundle = await xintusBundle();
    const b = produceRulesBlueprint(bundle);
    expect(b).toMatchObject({ contextHash: bundle.contextHash, structureFingerprint: bundle.refs.structureFingerprint, aliasMapHash: bundle.aliases.aliasMapHash });
  });

  it("uses the real labels of the alias table and nothing of the student's identity (canary)", async () => {
    const bundle = await canaryBundle();
    const json = JSON.stringify(produceRulesBlueprint(bundle));
    // labels are the saved structure's own (the professional's), they are NOT identity; the student's values never reach the producer
    for (const value of [CANARY.name, CANARY.email, CANARY.phone, CANARY.cpf, CANARY.birthDate, CANARY.pain, CANARY.address]) expect(json).not.toContain(value);
    expect(json).toContain(CANARY.labels[0]);
  });
});

describe("the recommendation table (design §3.11, heuristic: the Técnico validates it)", () => {
  const recommended = async (S: number, labels: Spec[], experience: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null = "INTERMEDIATE", phases = 1) =>
    produceRulesBlueprint(await synth(phasesOf(phases, S, labels), experience)).strategies[0].splitFamily;

  it("S <= 2 is full body; a beginner up to 4 sessions is full body", async () => {
    expect(await recommended(1, ["A"])).toBe("FULL_BODY");
    expect(await recommended(2, ["A", "B"])).toBe("FULL_BODY");
    expect(await recommended(4, ["A", "B"], "BEGINNER")).toBe("FULL_BODY");
    expect(await recommended(3, ["A", "B", "C"], "BEGINNER")).toBe("FULL_BODY");
  });

  it("S = 3: beginner or unknown experience is full body; otherwise push/pull/legs for 3 labels, upper/lower for 2, full body when nothing is supported", async () => {
    expect(await recommended(3, ["A", "B", "C"], null)).toBe("FULL_BODY");
    expect(await recommended(3, ["A", "B", "C"], "INTERMEDIATE")).toBe("PUSH_PULL_LEGS");
    expect(await recommended(3, ["A", "B"], "ADVANCED")).toBe("UPPER_LOWER");
    expect(await recommended(3, ["A"], "ADVANCED")).toBe("FULL_BODY");
  });

  it("S = 4: upper/lower when the labels support it (2 or 4), else full body; 4 labels alternate A,C upper and B,D lower", async () => {
    expect(await recommended(4, ["A", "B"])).toBe("UPPER_LOWER");
    expect(await recommended(4, ["A", "B", "C"])).toBe("FULL_BODY");
    const b = produceRulesBlueprint(await synth(phasesOf(1, 4, ["A", "B", "C", "D"])));
    expect(b.strategies[0].splitFamily).toBe("UPPER_LOWER");
    expect(rolesOf(b, "S1")).toEqual({ A: "UPPER", B: "LOWER", C: "UPPER", D: "LOWER" });
  });

  it("S >= 5: push/pull/legs, else body part, else upper/lower, else full body", async () => {
    expect(await recommended(6, ["A", "B", "C", "D", "E", "F"])).toBe("PUSH_PULL_LEGS");
    expect(await recommended(5, ["A", "B", "C"])).toBe("PUSH_PULL_LEGS");
    expect(await recommended(5, ["A", "B", "C", "D", "E"])).toBe("BODY_PART");
    expect(await recommended(5, ["A", "B"])).toBe("UPPER_LOWER");
    expect(await recommended(5, ["A"])).toBe("FULL_BODY");
    const ppl6 = produceRulesBlueprint(await synth(phasesOf(1, 6, ["A", "B", "C", "D", "E", "F"])));
    expect(rolesOf(ppl6, "S1")).toEqual({ A: "PUSH", B: "PULL", C: "LEGS", D: "PUSH", E: "PULL", F: "LEGS" });
    const bp = produceRulesBlueprint(await synth(phasesOf(1, 5, ["A", "B", "C", "D", "E"])));
    expect(rolesOf(bp, "S1")).toEqual({ A: "CHEST_TRICEPS", B: "BACK_BICEPS", C: "LEGS", D: "SHOULDERS_ARMS", E: "LEGS" });
  });

  it("preferenceFor documents the order and chooseFamilies returns at most 3 with the recommended first", async () => {
    expect(preferenceFor(4, "INTERMEDIATE")).toEqual(["UPPER_LOWER", "FULL_BODY"]);
    expect(preferenceFor(6, null)).toEqual(["PUSH_PULL_LEGS", "BODY_PART", "UPPER_LOWER", "FULL_BODY"]);
    for (const S of [1, 2, 3, 4, 5, 6, 7])
      for (const k of [1, 2, 3, 4, 5, 6]) {
        const labels = Array.from({ length: k }, (_, i) => String.fromCharCode(65 + i));
        const chosen = chooseFamilies((await synth(phasesOf(1, S, labels))).context, RULES_TEMPLATES);
        expect(chosen.length).toBeGreaterThanOrEqual(1);
        expect(chosen.length).toBeLessThanOrEqual(3);
        expect(chosen[0].support).toBe("YES");
        expect(new Set(chosen.map((c) => c.family)).size).toBe(chosen.length);
      }
  });

  it("a family the labels cannot carry is never recommended and is only an informational card", async () => {
    const b = produceRulesBlueprint(await synth(phasesOf(1, 5, ["A", "B", "C", "D", "E"]), "INTERMEDIATE"));
    for (const s of b.strategies) expect(s.requiresScheduleChange).toBe(s.supportedByContext !== "YES");
    expect(b.strategies[0].requiresScheduleChange).toBe(false);
    const cards = b.strategies.filter((s) => s.requiresScheduleChange);
    for (const card of cards) {
      expect(card.confidence).toBe("LOW");
      expect(card.tradeoffs).toContain(SCHEDULE_CHANGE_TRADEOFF);
    }
  });

  it("phases that disagree: a family supported by only some phases is PARTIAL and needs a schedule change", async () => {
    const b = produceRulesBlueprint(await synth([{ sessionsPerWeek: 4, labels: ["A", "B"] }, { sessionsPerWeek: 4, labels: ["A", "B", "C"] }]));
    expect(b.strategies[0].splitFamily).toBe("FULL_BODY");
    const ul = b.strategies.find((s) => s.splitFamily === "UPPER_LOWER");
    expect(ul).toMatchObject({ supportedByContext: "PARTIAL", requiresScheduleChange: true });
  });
});

describe("modalities other than resistance, structure and edge cases", () => {
  it("a cardio or mobility workout always gets the role of its modality and is not counted for the family table", async () => {
    const labels: Spec[] = ["A", "B", { label: "C", modalities: ["CARDIO"] }, { label: "D", modalities: ["MOBILITY"] }, { label: "E", modalities: null }];
    const b = produceRulesBlueprint(await synth(phasesOf(1, 5, labels)));
    // K = 3 volume labels (A, B and E, whose modalities are unknown) with S = 5 => push/pull/legs
    expect(b.strategies[0].splitFamily).toBe("PUSH_PULL_LEGS");
    expect(rolesOf(b, "S1")).toEqual({ A: "PUSH", B: "PULL", C: "CARDIO", D: "MOBILITY", E: "LEGS" });
    for (const s of b.strategies) {
      const r = rolesOf(b, s.strategyId);
      expect(r.C).toBe("CARDIO");
      expect(r.D).toBe("MOBILITY");
    }
    expect(nonVolumeRoleOf(["BALANCE"])).toBe("BALANCE");
    expect(nonVolumeRoleOf(["SKILL"])).toBe("SKILL");
  });

  it("a plan without any resistance work gets one full-body strategy whose roles are all modalities", async () => {
    const b = produceRulesBlueprint(await synth(phasesOf(2, 3, [{ label: "A", modalities: ["CARDIO"] }, { label: "B", modalities: ["MOBILITY"] }])));
    expect(b.strategies).toHaveLength(1);
    expect(b.strategies[0].splitFamily).toBe("FULL_BODY");
    expect(rolesOf(b, "S1", 2)).toEqual({ A: "CARDIO", B: "MOBILITY" });
    expect(trainingBlueprintSchema.safeParse(b).success).toBe(true);
  });

  it("a saved focus of the periodization is kept: the workout is marked STRUCTURE and still gets its role", async () => {
    const b = produceRulesBlueprint(await synth(phasesOf(1, 4, [{ label: "A", existingFocus: { muscles: ["CHEST"], patterns: [] } }, "B"])));
    const w = b.strategies[0].phases[0].workouts;
    expect(w.map((x) => [x.label, x.role, x.source])).toEqual([["A", "UPPER", "STRUCTURE"], ["B", "LOWER", "RULES_HEURISTIC"]]);
    expect(w.every((x) => x.focusDelta === null)).toBe(true);
  });

  it("phases keep one blueprint entry each, with the phase's own labels (a repeated structure is repeated, not referenced)", async () => {
    const b = produceRulesBlueprint(await synth([{ sessionsPerWeek: 4, labels: ["A", "B"] }, { sessionsPerWeek: 2, labels: ["Full"] }, { sessionsPerWeek: 4, labels: ["A", "B"] }]));
    expect(b.strategies[0].phases.map((p) => p.workouts.map((w) => w.label))).toEqual([["A", "B"], ["Full"], ["A", "B"]]);
    expect(b.strategies[0].phases.map((p) => p.phaseIndex)).toEqual([1, 2, 3]);
  });

  it("uncertainties are fixed codes with fixed texts, at most 4; a known intermediate student with a clear screening has none about the person", async () => {
    const unknown = produceRulesBlueprint(await synth(phasesOf(1, 4, ["A", "B"]), null));
    expect(unknown.global.uncertainties.map((u) => u.code)).toContain("EXPERIENCE_UNKNOWN");
    expect(unknown.global.uncertainties.length).toBeLessThanOrEqual(4);
    for (const u of unknown.global.uncertainties) expect(u.text).toBe(RULES_UNCERTAINTY_TEXT[u.code as keyof typeof RULES_UNCERTAINTY_TEXT]);
    const known = produceRulesBlueprint(await xintusBundle());
    expect(known.global.uncertainties.map((u) => u.code)).not.toContain("EXPERIENCE_UNKNOWN");
    expect(known.global.rationale).toBe(RULES_GLOBAL_RATIONALE);
    expect(known.global.questionsForProfessional).toEqual([{ code: "CONFIRM_SPLIT", text: RULES_QUESTION_TEXT }]);
    const fb = produceRulesBlueprint(await synth(phasesOf(1, 2, ["A", "B"])));
    expect(fb.global.questionsForProfessional).toEqual([]);
  });
});

describe("the fixed texts follow the same rules as model prose", () => {
  it("none has a dose, a study, a clinical claim, markup, an instruction or an alias", () => {
    const texts = [
      RULES_GLOBAL_RATIONALE, RULES_QUESTION_TEXT, SCHEDULE_CHANGE_TRADEOFF, ...Object.values(FAMILY_EXPLANATION), ...Object.values(FAMILY_TRADEOFF),
      ...Object.values(RULES_UNCERTAINTY_TEXT),
    ];
    for (const t of texts) {
      expect(proseProblems(t, { denyTokens: [], aliases: new Set() }), t).toEqual([]);
      expect(t.length).toBeLessThanOrEqual(160 + (t === RULES_GLOBAL_RATIONALE || t in FAMILY_EXPLANATION ? 140 : 0));
    }
    for (const t of [RULES_GLOBAL_RATIONALE, ...Object.values(FAMILY_EXPLANATION)]) expect(t.length).toBeLessThanOrEqual(300);
  });
});

describe("rules and AI share one contract", () => {
  it("the validator accepts an AI answer for the same bundle and produces the same TYPE, differing only in producer, label and provenance", async () => {
    const bundle = await xintusBundle();
    const rules = produceRulesBlueprint(bundle);
    const ai = validatePlannerResponse(upperLowerResponse(), bundle, ROLE_FOCUS_INTERIM_TABLE, {
      producer: { kind: "AI", provider: "mock", modelId: "mock-ok", promptVersion: "planner-2026.11.1" }, roleFocusRef: ROLE_FOCUS_INTERIM,
    });
    expect(ai.ok).toBe(true);
    if (!ai.ok) return;
    expect(Object.keys(ai.blueprint).sort()).toEqual(Object.keys(rules).sort());
    expect(Object.keys(ai.blueprint.strategies[0]).sort()).toEqual(Object.keys(rules.strategies[0]).sort());
    // the same split, the same roles for A and B
    expect(rolesOf(ai.blueprint, "S1")).toEqual(rolesOf(rules, "S1"));
    expect(ai.blueprint.label).toBe(BLUEPRINT_LABEL.AI);
    expect(rules.label).toBe(BLUEPRINT_LABEL.RULES);
    expect(ai.blueprint.contextHash).toBe(rules.contextHash);
    expect(ai.blueprint.aliasMapHash).toBe(rules.aliasMapHash);
  });

  it("every role the producer emits is allowed by the validator's family table (the producer cannot contradict the AI contract)", async () => {
    for (const labels of [["A", "B"], ["A", "B", "C"], ["A", "B", "C", "D"], ["A", "B", "C", "D", "E"], ["A", "B", "C", "D", "E", "F"]] as Spec[][]) {
      const b = produceRulesBlueprint(await synth(phasesOf(2, labels.length, labels)));
      for (const s of b.strategies) for (const p of s.phases) for (const w of p.workouts) expect(ROLE_FOCUS_INTERIM_TABLE[w.role], `${s.splitFamily}/${w.role}`).toBeDefined();
      expect(trainingBlueprintSchema.safeParse(b).success).toBe(true);
    }
  });
});
