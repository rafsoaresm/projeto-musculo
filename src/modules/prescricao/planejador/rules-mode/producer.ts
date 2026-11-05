/**
 * Rules-mode producer (design V4 §3.11): the same `TrainingBlueprint` type as the AI planner, built with no network and no clock from
 * exactly what the planner would see (`TrainingPlanningContext`) plus the real labels of the alias table. Deterministic: the same
 * bundle gives the same blueprint, byte for byte. It never reads the student's names or free text (they are not in the bundle).
 *
 * Output: `producer { kind: "RULES" }`, `label` "Heurística operacional (editável)", provenance RULES_HEURISTIC, fixed display names,
 * `focusDelta: null` (pure role defaults), no candidate exercises (the engine selects from the library) and no dose or progression
 * intent (PR 3). A family the saved labels cannot carry is listed ONLY as an informational card (`requiresScheduleChange`), never
 * recommended; changing labels, rotation or frequency stays an edit of the saved periodization, never a blueprint field.
 * All of it is HEURISTIC operational, for the Técnico to validate.
 */
import { BLUEPRINT_LABEL, type StoredPhase, type StoredStrategy, type StoredWorkout, type TrainingBlueprint } from "../blueprint";
import type { PlanningContextBundle, PlanningPhase, PlanningWorkout, TrainingPlanningContext } from "../context-types";
import { BLUEPRINT_VERSION, ROLE_FOCUS_INTERIM } from "../versions";
import { SPLIT_DISPLAY_NAME, UNCERTAINTY_CODES, isNonVolumeRole, type SplitFamily, type WorkoutRole } from "../vocab";
import { rulesTemplatesFromRuleSet } from "./ruleset-templates";
import {
  FAMILY_EXPLANATION, FAMILY_TRADEOFF, preferenceFor, RULES_GLOBAL_RATIONALE, RULES_QUESTION_TEXT, RULES_TEMPLATES, RULES_UNCERTAINTY_TEXT,
  SCHEDULE_CHANGE_TRADEOFF, type RulesTemplates,
} from "./templates";

type RankedFamily = Exclude<SplitFamily, "CUSTOM">;
type UncertaintyCode = (typeof UNCERTAINTY_CODES)[number];

const isVolume = (w: PlanningWorkout): boolean => w.modalities === null || w.modalities.includes("RESISTANCE");

/** The role of a label whose workout has no resistance work: by its modality. */
export function nonVolumeRoleOf(modalities: readonly string[] | null): WorkoutRole {
  return modalities?.includes("CARDIO") ? "CARDIO" : modalities?.includes("MOBILITY") ? "MOBILITY" : modalities?.includes("BALANCE") ? "BALANCE" : "SKILL";
}

const volumeCount = (phase: PlanningPhase): number => phase.workouts.filter(isVolume).length;

export { preferenceFor };

function rolesFor(phase: PlanningPhase, family: RankedFamily, templates: RulesTemplates): Map<string, WorkoutRole> {
  const roles = new Map<string, WorkoutRole>();
  let index = 0;
  for (const w of phase.workouts) {
    if (!isVolume(w)) {
      roles.set(w.alias, nonVolumeRoleOf(w.modalities));
      continue;
    }
    if (family === "FULL_BODY") roles.set(w.alias, "FULL_BODY");
    else {
      const cycle = templates.cycle[family];
      roles.set(w.alias, cycle[index % cycle.length]);
    }
    index += 1;
  }
  return roles;
}

function storedPhase(phase: PlanningPhase, family: RankedFamily, bundle: PlanningContextBundle, templates: RulesTemplates): StoredPhase {
  const roles = rolesFor(phase, family, templates);
  const workouts: StoredWorkout[] = phase.workouts.map((w) => {
    const role = roles.get(w.alias) as WorkoutRole;
    const structureWins = w.existingFocus !== null && !isNonVolumeRole(role);
    return {
      label: bundle.aliases.workouts.get(w.alias) ?? "",
      role,
      focusDelta: null,
      candidateExerciseIds: [],
      source: structureWins ? "STRUCTURE" : "RULES_HEURISTIC",
    };
  });
  return { phaseIndex: phase.index, splitType: family, workouts };
}

function supportOf(family: RankedFamily, phases: readonly PlanningPhase[], templates: RulesTemplates): "YES" | "PARTIAL" | "NO" {
  const supported = phases.map((p) => templates.supports(family, volumeCount(p)));
  return supported.every(Boolean) ? "YES" : supported.some(Boolean) ? "PARTIAL" : "NO";
}

function uncertaintiesOf(context: TrainingPlanningContext): Array<{ code: UncertaintyCode; text: string }> {
  const s = context.student;
  const out: Array<{ code: UncertaintyCode; text: string }> = [];
  const add = (code: keyof typeof RULES_UNCERTAINTY_TEXT, when: boolean) => when && out.push({ code, text: RULES_UNCERTAINTY_TEXT[code] });
  add("EXPERIENCE_UNKNOWN", s.experience === null);
  add("GOAL_UNKNOWN", s.goalCodes.length === 0);
  add("SCREENING_OPEN", context.screening.parq !== "CLEAR");
  add("TIME_UNKNOWN", s.sessionMinutes === null);
  add("DAYS_UNKNOWN", s.daysPerWeek === null);
  add("METADATA_INFERRED", context.library.reviewedShare === "NONE" || context.library.reviewedShare === "SOME");
  add("HISTORY_ABSENT", context.history.sessionsBand === "NONE");
  add("STRUCTURE_CONSTRAINS", context.periodization.irregular);
  return out.slice(0, 4);
}

/**
 * The strategies, in order: the recommended one (the first family of the reference phase's preference list that every phase supports),
 * full body when not already there, then the next supported family, then (if a slot is left) ONE informational card for a family
 * the saved labels cannot carry.
 */
export function chooseFamilies(context: TrainingPlanningContext, templates: RulesTemplates = currentTemplates()): Array<{ family: RankedFamily; support: "YES" | "PARTIAL" | "NO" }> {
  const phases = context.periodization.phases;
  const reference = phases.find((p) => volumeCount(p) > 0);
  if (!reference) return [{ family: "FULL_BODY", support: "YES" }];
  const preference = templates.preference(reference.sessionsPerWeek, context.student.experience);
  const order = [...new Set<RankedFamily>([...preference, "UPPER_LOWER", "PUSH_PULL_LEGS", "BODY_PART", "FULL_BODY"])];
  const sensible = (f: RankedFamily) => reference.sessionsPerWeek >= templates.minSessions[f];
  const support = new Map(order.map((f) => [f, supportOf(f, phases, templates)] as const));
  const recommended = preference.find((f) => support.get(f) === "YES") ?? "FULL_BODY";
  const picked: RankedFamily[] = [recommended];
  if (!picked.includes("FULL_BODY")) picked.push("FULL_BODY");
  for (const f of order) {
    if (picked.length >= templates.maxStrategies) break;
    if (!picked.includes(f) && sensible(f) && support.get(f) === "YES") picked.push(f);
  }
  if (picked.length < templates.maxStrategies) {
    const card = order.find((f) => !picked.includes(f) && sensible(f) && support.get(f) !== "YES");
    if (card) picked.push(card);
  }
  return picked.map((family) => ({ family, support: support.get(family) ?? "YES" }));
}

/** The templates rules mode uses: the default ruleset's (gymgital-base@2026.11.5+); the interim constants only if a ruleset has none. */
export function currentTemplates(): RulesTemplates {
  return rulesTemplatesFromRuleSet() ?? RULES_TEMPLATES;
}

export function produceRulesBlueprint(bundle: PlanningContextBundle, templates: RulesTemplates = currentTemplates()): TrainingBlueprint {
  const { context } = bundle;
  const chosen = chooseFamilies(context, templates);
  const ids = ["S1", "S2", "S3"] as const;
  const strategies: StoredStrategy[] = chosen.map(({ family, support }, i) => {
    const supported = support === "YES";
    return {
      strategyId: ids[i],
      splitFamily: family,
      displayName: SPLIT_DISPLAY_NAME[family],
      explanation: FAMILY_EXPLANATION[family],
      tradeoffs: supported ? [FAMILY_TRADEOFF[family]] : [FAMILY_TRADEOFF[family], SCHEDULE_CHANGE_TRADEOFF],
      requiresScheduleChange: !supported,
      supportedByContext: support,
      confidence: supported ? "MEDIUM" : "LOW",
      evidenceRefs: i === 0 && context.student.experience !== null ? ["S.experience"] : [],
      provenance: "RULES_HEURISTIC",
      phases: context.periodization.phases.map((p) => storedPhase(p, family, bundle, templates)),
      dosingIntent: [],
      progressionIntent: [],
    };
  });
  const recommendedIsFamily = chosen[0].family;
  return {
    blueprintVersion: BLUEPRINT_VERSION,
    producer: { kind: "RULES", templatesVersion: templates.version },
    contextHash: bundle.contextHash,
    structureFingerprint: bundle.refs.structureFingerprint,
    aliasMapHash: bundle.aliases.aliasMapHash,
    roleFocusRef: templates.version === RULES_TEMPLATES.version ? ROLE_FOCUS_INTERIM : templates.version,
    global: {
      goalCodes: context.student.goalCodes.filter((g) => /^[A-Z_]{3,30}$/.test(g)).slice(0, 3),
      rationale: RULES_GLOBAL_RATIONALE,
      assumptions: [],
      uncertainties: uncertaintiesOf(context),
      questionsForProfessional: recommendedIsFamily === "FULL_BODY" ? [] : [{ code: "CONFIRM_SPLIT", text: RULES_QUESTION_TEXT }],
      keyTradeoffs: [],
    },
    recommendedStrategyId: "S1",
    strategies,
    label: BLUEPRINT_LABEL.RULES,
  };
}
