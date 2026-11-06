/**
 * Rules-mode tables read from the ruleset (design V4 §3.11/§4.5): `BLUEPRINT_STRATEGY_TEMPLATES` (families, role cycles, recommendation
 * order) and `BLUEPRINT_ROLE_FOCUS` (what each role means). They are HEURISTIC operational values of ruleset gymgital-base@2026.11.5,
 * editable by publishing a new ruleset, for the Técnico to validate (docs/PENDENCIAS.md); this module reads them, it invents nothing.
 * Pure: no clock, no network. A ruleset without them (before 2026.11.5) has no rules-mode strategies: `null`.
 */
import { DEFAULT_RULESET, getRuleSet } from "../../motor/rules";
import type { BlueprintRecommendation, BlueprintStrategyTemplates } from "../../motor/rules";
import type { RuleSetRef } from "../../motor/types";
import type { RoleFocusTable } from "../role-focus";
import { WORKOUT_ROLES, type SplitFamily, type WorkoutRole } from "../vocab";
import { FAMILY_MIN_SESSIONS, type RulesTemplates } from "./templates";

type RankedFamily = Exclude<SplitFamily, "CUSTOM">;
const CYCLED = ["UPPER_LOWER", "PUSH_PULL_LEGS", "BODY_PART"] as const;

export const rulesetRefText = (ref: RuleSetRef): string => `${ref.id}@${ref.version}`;

/** Families recommended for (sessions per week, experience): every matching entry, in the ruleset's order, without repeating a family. */
export function preferenceFromRecommend(recommend: readonly BlueprintRecommendation[], sessionsPerWeek: number, experience: Parameters<RulesTemplates["preference"]>[1]): RankedFamily[] {
  const out: RankedFamily[] = [];
  for (const r of recommend) {
    const w = r.when;
    if (w.sessionsPerWeekMin !== undefined && sessionsPerWeek < w.sessionsPerWeekMin) continue;
    if (w.sessionsPerWeekMax !== undefined && sessionsPerWeek > w.sessionsPerWeekMax) continue;
    if (w.experience && !w.experience.includes(experience)) continue;
    const family = r.family as RankedFamily;
    if (!out.includes(family)) out.push(family);
  }
  return out;
}

export function supportsFromTemplates(t: BlueprintStrategyTemplates, family: RankedFamily, volumeLabels: number): boolean {
  if (volumeLabels === 0) return true;
  const f = t.families.find((x) => x.family === family);
  if (!f) return false;
  if (f.minLabels !== undefined && volumeLabels < f.minLabels) return false;
  return f.labelCounts === "ANY" || f.labelCounts.includes(volumeLabels);
}

/** The templates of `ref`, or null when that ruleset has no strategy templates. */
export function rulesTemplatesFromRuleSet(ref: RuleSetRef = DEFAULT_RULESET): RulesTemplates | null {
  const rs = getRuleSet(ref);
  const t = rs?.rules.BLUEPRINT_STRATEGY_TEMPLATES?.value;
  if (!rs || !t) return null;
  const cycle = Object.fromEntries(CYCLED.map((family) => [family, (t.families.find((f) => f.family === family)?.roleCycle ?? []) as WorkoutRole[]])) as unknown as RulesTemplates["cycle"];
  // The ruleset states a minimum frequency only where the design needs one (body part); the other minimums stay the code defaults.
  const minSessions = Object.fromEntries(
    (["FULL_BODY", "UPPER_LOWER", "PUSH_PULL_LEGS", "BODY_PART"] as const).map((family) => [family, t.families.find((f) => f.family === family)?.minSessionsPerWeek ?? FAMILY_MIN_SESSIONS[family]]),
  ) as unknown as RulesTemplates["minSessions"];
  const templates: RulesTemplates = {
    version: rulesetRefText(ref), cycle, minSessions,
    preference: (sessionsPerWeek, experience) => preferenceFromRecommend(t.recommend, sessionsPerWeek, experience),
    supports: (family, volumeLabels) => supportsFromTemplates(t, family, volumeLabels),
    maxStrategies: t.maxStrategies,
  };
  return Object.freeze(templates);
}

/** The role table (`BLUEPRINT_ROLE_FOCUS`) of `ref` in the planner's shape; null before 2026.11.5. */
export function roleFocusFromRuleSet(ref: RuleSetRef = DEFAULT_RULESET): RoleFocusTable | null {
  const table = getRuleSet(ref)?.rules.BLUEPRINT_ROLE_FOCUS?.value;
  if (!table) return null;
  return Object.freeze(
    Object.fromEntries(
      WORKOUT_ROLES.map((role) => {
        const f = table[role as keyof typeof table] ?? { dominantMuscles: [], supportingMuscles: [], targetPatterns: [], spilloverPatterns: [] };
        return [role, { dominantMuscles: [...f.dominantMuscles], supportingMuscles: [...f.supportingMuscles], targetPatterns: [...f.targetPatterns], allowedSpilloverPatterns: [...f.spilloverPatterns] }];
      }),
    ),
  ) as unknown as RoleFocusTable;
}
