/**
 * Blueprint compiler (design V4 §4.1): turns a professional's ACCEPTANCE of a stored blueprint into the compiled block that
 * travels in `GenerationAnswers.blueprint`, and merges that block into the answers. It reuses the generation answers and their
 * validation (the block is part of `generationAnswersSchema`), so a compiled blueprint is hashed, stored and replayed like any
 * other answer. No clock, no randomness, no network, no database: the same acceptance on the same structure always gives the
 * same JSON (workouts are sorted by phase and label, lists are deduplicated and sorted).
 *
 * What it refuses, as codes and never as exceptions:
 *  - STRUCTURE_CHANGED: the saved periodization is not the one the strategy was planned for. The compiler never edits the
 *    periodization and never relabels the strategy to fit; the professional edits the structure and plans again (§4.6).
 *  - STRATEGY_REQUIRES_SCHEDULE_CHANGE: an informational card (needs other labels, rotation or frequency) cannot be accepted.
 *  - PHASE_MISSING / LABEL_MISSING: the acceptance cites a phase or workout the saved structure does not have.
 *  - UNSUPPORTED_RULESET: the pinned rules have no strategy-guided selection (2026.11.4 and earlier). There is no degrade.
 *  - ACCEPTANCE_MISMATCH / INVALID_BLUEPRINT: the acceptance does not belong to the run, or its hash does not match its content.
 * Nothing here approves, delivers or applies a workout.
 */
import { canonicalJson } from "@/modules/prescricao/motor/hash";
import { getRuleSet } from "@/modules/prescricao/motor/rules";
import type { Issue, RuleSetRef, StructureFacts } from "@/modules/prescricao/motor/types";
import { cmp } from "@/modules/prescricao/motor/vocabulary";
import { blueprintAnswersSchema, type BlueprintAnswers, type GenerationAnswers } from "@/modules/prescricao/automatica/contracts";
import type { BlueprintAcceptance, TrainingBlueprint } from "./blueprint";
import { DELTA_KEYS, emptyDelta, isEmptyDelta, type FocusDelta } from "./focus";
import { acceptanceHash, blueprintHash, structureFingerprint } from "./hashes";
import { PLANNER_MAX_CANDIDATES_PER_WORKOUT } from "./versions";

export { structureFingerprint };

export type CompileOutcome =
  | { ok: true; blueprint: BlueprintAnswers; issues: Issue[] }
  | {
      ok: false;
      code:
        | "STRUCTURE_CHANGED" | "STRATEGY_REQUIRES_SCHEDULE_CHANGE" | "PHASE_MISSING" | "LABEL_MISSING" | "UNKNOWN_CANDIDATE" | "UNSUPPORTED_RULESET"
        | "ACCEPTANCE_MISMATCH" | "INVALID_BLUEPRINT";
      message: string;
    };

export const COMPILE_MESSAGES = {
  STRUCTURE_CHANGED: "A periodização mudou depois do aceite. Planeje de novo.",
  STRATEGY_REQUIRES_SCHEDULE_CHANGE: "Esta estratégia exige alterar rótulos, rotação ou frequência na periodização antes de ser aceita.",
  PHASE_MISSING: "O aceite cita uma fase que não existe na periodização salva. Planeje de novo.",
  LABEL_MISSING: "O aceite cita um treino que não existe na periodização salva. Planeje de novo.",
  UNKNOWN_CANDIDATE: "O aceite cita um exercício que não está na biblioteca visível.",
  UNSUPPORTED_RULESET: "Esta proposta usa regras anteriores à seleção por estratégia. Gere de novo com as regras atuais ou escolha \"Sem divisão\".",
  ACCEPTANCE_MISMATCH: "O aceite não corresponde ao plano de estratégia. Planeje de novo.",
  INVALID_BLUEPRINT: "O aceite não pôde ser compilado. Planeje de novo.",
} as const;

const fail = (code: Extract<CompileOutcome, { ok: false }>["code"]): CompileOutcome => ({ ok: false, code, message: COMPILE_MESSAGES[code] });

const sortedUnique = (list: readonly string[]): string[] => [...new Set(list)].sort(cmp);
const normalizeDelta = (delta: FocusDelta | null): FocusDelta | null => {
  if (!delta) return null;
  const out = emptyDelta();
  for (const k of DELTA_KEYS) out[k] = sortedUnique(delta[k]);
  return isEmptyDelta(out) ? null : out;
};
const key = (phaseIndex: number, label: string) => `${phaseIndex}|${label}`;
type CompiledWorkout = BlueprintAnswers["workouts"][number];
const byWorkout = (a: { phaseIndex: number; label: string }, b: { phaseIndex: number; label: string }) => a.phaseIndex - b.phaseIndex || cmp(a.label, b.label);

/** Workouts with a focus the professional already saved (in the structure or in the answers): that focus wins over any strategy. */
function savedFocusKeys(structure: StructureFacts, coverageByWorkout: GenerationAnswers["coverageByWorkout"]): Set<string> {
  const keys = new Set<string>();
  for (const p of structure.phases)
    for (const w of p.workouts) if (w.focus.muscles?.length || w.focus.patterns?.length) keys.add(key(p.index, w.label));
  for (const c of coverageByWorkout) if (c.muscles?.length || c.patterns?.length) keys.add(key(c.phaseIndex, c.label));
  return keys;
}

export interface CompileInput {
  run: TrainingBlueprint;
  acceptance: BlueprintAcceptance;
  /** The saved structure. Its per-workout focus (if any) is read as "saved professional focus". */
  structure: StructureFacts;
  /** Targets per workout the professional typed in the answers (they also win over the strategy). */
  coverageByWorkout?: GenerationAnswers["coverageByWorkout"];
  /** Ids of the library the organization can see now. */
  catalogIds: ReadonlySet<string>;
  rules: RuleSetRef;
}

/** Issues the adapter re-derives on every run: workouts without a planned role, and workouts whose saved focus wins. */
export function blueprintStructureIssues(
  structure: StructureFacts,
  planned: ReadonlyArray<{ phaseIndex: number; label: string }>,
  savedFocus: ReadonlySet<string>,
  strategyPhases: ReadonlySet<number>,
): Issue[] {
  const issues: Issue[] = [];
  const has = new Set(planned.map((w) => key(w.phaseIndex, w.label)));
  for (const p of structure.phases)
    for (const w of p.workouts) {
      const k = key(p.index, w.label);
      if (savedFocus.has(k))
        issues.push({
          severity: "INFO", code: "BLUEPRINT_STRUCTURE_FOCUS_WINS", path: `phases.${p.index}.workouts.${w.label}`, stage: "INPUT", phaseIndex: p.index, label: w.label,
          message: `Fase ${p.index}, treino ${w.label}: o foco salvo na periodização vale no lugar da estratégia.`,
        });
      else if (!has.has(k) && strategyPhases.has(p.index))
        issues.push({
          severity: "INFO", code: "BLUEPRINT_WORKOUT_NOT_PLANNED", path: `phases.${p.index}.workouts.${w.label}`, stage: "INPUT", phaseIndex: p.index, label: w.label,
          message: `Fase ${p.index}, treino ${w.label}: a estratégia não definiu o foco deste treino; vale a cobertura da fase.`,
        });
    }
  return issues;
}

export async function compileAcceptance(i: CompileInput): Promise<CompileOutcome> {
  const { run, acceptance, structure } = i;
  const ruleSet = getRuleSet(i.rules);
  if (!ruleSet?.rules.MICROCYCLE_BLUEPRINT || !ruleSet.rules.BLUEPRINT_ROLE_FOCUS) return fail("UNSUPPORTED_RULESET");

  // (1) The saved periodization is the one the strategy was planned for.
  const fingerprint = await structureFingerprint(structure);
  if (acceptance.structureFingerprint !== fingerprint || run.structureFingerprint !== fingerprint) return fail("STRUCTURE_CHANGED");

  // (2) The chosen strategy exists in the run and can be accepted as it stands; the acceptance is the run's and is intact.
  const strategy = acceptance.strategyId === "CUSTOM" ? null : run.strategies.find((s) => s.strategyId === acceptance.strategyId) ?? null;
  if (acceptance.strategyId !== "CUSTOM" && !strategy) return fail("ACCEPTANCE_MISMATCH");
  if (strategy && (strategy.requiresScheduleChange || strategy.supportedByContext === "NO")) return fail("STRATEGY_REQUIRES_SCHEDULE_CHANGE");
  const runHash = await blueprintHash(run);
  const expected = await acceptanceHash({ runBlueprintHash: runHash, strategyId: acceptance.strategyId, phases: acceptance.phases, dosing: acceptance.dosing });
  if (acceptance.acceptanceHash !== expected) return fail("ACCEPTANCE_MISMATCH");

  // (3) Every phase and workout of the acceptance exists in the saved structure.
  const labels = new Map(structure.phases.map((p) => [p.index, new Set(p.workouts.map((w) => w.label))]));
  for (const p of acceptance.phases) {
    const set = labels.get(p.phaseIndex);
    if (!set) return fail("PHASE_MISSING");
    for (const w of p.workouts) if (!set.has(w.label)) return fail("LABEL_MISSING");
  }

  // (4) A saved professional focus wins: that workout is not emitted. (5) Candidates the library no longer has are dropped, not an error.
  const saved = savedFocusKeys(structure, i.coverageByWorkout ?? []);
  const edited = new Set(acceptance.edits.map((e) => key(e.phaseIndex, e.label)));
  const issues: Issue[] = [];
  const emitted: CompiledWorkout[] = [];
  const planned: Array<{ phaseIndex: number; label: string }> = [];
  const custom = acceptance.strategyId === "CUSTOM";
  const provenance: "AI_SUGGESTED" | "RULES_HEURISTIC" = strategy ? strategy.provenance : run.producer.kind === "AI" ? "AI_SUGGESTED" : "RULES_HEURISTIC";
  for (const p of acceptance.phases)
    for (const w of p.workouts) {
      planned.push({ phaseIndex: p.phaseIndex, label: w.label });
      if (saved.has(key(p.phaseIndex, w.label))) continue;
      const candidates = sortedUnique(w.candidateExerciseIds);
      const known = candidates.filter((id) => i.catalogIds.has(id)).slice(0, PLANNER_MAX_CANDIDATES_PER_WORKOUT);
      if (known.length < candidates.length)
        issues.push({
          severity: "INFO", code: "BLUEPRINT_CANDIDATE_DROPPED", path: `phases.${p.phaseIndex}.workouts.${w.label}`, stage: "INPUT", phaseIndex: p.phaseIndex, label: w.label,
          count: candidates.length - known.length,
          message: `Fase ${p.phaseIndex}, treino ${w.label}: ${candidates.length - known.length} exercício(s) nomeado(s) pela estratégia não estão mais na biblioteca visível e foram deixados de fora.`,
        });
      emitted.push({
        phaseIndex: p.phaseIndex, label: w.label, acceptanceId: acceptance.id, role: w.role,
        source: custom || w.source === "PROFESSIONAL" || edited.has(key(p.phaseIndex, w.label)) ? "PROFESSIONAL" : provenance,
        focusDelta: normalizeDelta(w.focusDelta), candidateExerciseIds: known,
      });
    }
  issues.push(...blueprintStructureIssues(structure, planned, saved, new Set(acceptance.phases.map((p) => p.phaseIndex))));

  const dosing = acceptance.dosing.byClass.length || acceptance.dosing.progression.length
    ? {
        byClass: [...acceptance.dosing.byClass].sort((a, b) => cmp(a.exerciseClass, b.exerciseClass)),
        progression: [...acceptance.dosing.progression].sort((a, b) => a.phaseIndex - b.phaseIndex),
      }
    : undefined;
  const candidate = {
    version: 1 as const,
    structureFingerprint: fingerprint,
    acceptances: [{
      acceptanceId: acceptance.id, runId: acceptance.runId, blueprintHash: runHash, acceptanceHash: acceptance.acceptanceHash,
      strategyId: acceptance.strategyId, splitFamily: acceptance.splitFamily, source: provenance,
    }],
    workouts: emitted.sort(byWorkout),
    ...(dosing ? { dosing } : {}),
  };
  const parsed = blueprintAnswersSchema.safeParse(candidate);
  if (!parsed.success) return fail("INVALID_BLUEPRINT");
  // Same input, same bytes: the canonical form is what is hashed and stored.
  return { ok: true, blueprint: JSON.parse(canonicalJson(parsed.data)) as BlueprintAnswers, issues: issues.sort((a, b) => cmp(a.code, b.code) || (a.phaseIndex ?? 0) - (b.phaseIndex ?? 0) || cmp(a.label ?? "", b.label ?? "")) };
}

/**
 * Merges a compiled block into a stored one (design §2.7): workouts by (phaseIndex, label), acceptances by id (an acceptance no
 * workout references any more is dropped), progression by phase and dose profiles by exercise class. Untouched phases keep their
 * own acceptance and expansion, so a later regeneration of an untouched phase never silently applies a newer strategy.
 * `replaceAll` (a FULL replan) drops the stored block.
 */
export function mergeBlueprintAnswers(stored: BlueprintAnswers | undefined, incoming: BlueprintAnswers, replaceAll = false): BlueprintAnswers {
  if (!stored || replaceAll) return incoming;
  const incomingKeys = new Set(incoming.workouts.map((w) => key(w.phaseIndex, w.label)));
  const workouts = [...stored.workouts.filter((w) => !incomingKeys.has(key(w.phaseIndex, w.label))), ...incoming.workouts].sort(byWorkout);
  const referenced = new Set(workouts.map((w) => w.acceptanceId));
  const acceptances = new Map<string, BlueprintAnswers["acceptances"][number]>();
  for (const a of [...stored.acceptances, ...incoming.acceptances]) acceptances.set(a.acceptanceId, a);
  const byClass = new Map<string, NonNullable<BlueprintAnswers["dosing"]>["byClass"][number]>();
  const progression = new Map<number, NonNullable<BlueprintAnswers["dosing"]>["progression"][number]>();
  for (const d of [stored.dosing, incoming.dosing]) {
    for (const c of d?.byClass ?? []) byClass.set(c.exerciseClass, c);
    for (const p of d?.progression ?? []) progression.set(p.phaseIndex, p);
  }
  const dosing = byClass.size || progression.size
    ? { byClass: [...byClass.values()].sort((a, b) => cmp(a.exerciseClass, b.exerciseClass)), progression: [...progression.values()].sort((a, b) => a.phaseIndex - b.phaseIndex) }
    : undefined;
  return {
    version: 1,
    structureFingerprint: incoming.structureFingerprint,
    acceptances: [...acceptances.values()].filter((a) => referenced.has(a.acceptanceId)).sort((a, b) => cmp(a.acceptanceId, b.acceptanceId)),
    workouts,
    ...(dosing ? { dosing } : {}),
  };
}

/**
 * The answers with the compiled blueprint merged in (`{ ...base, blueprint }`). An old ruleset is refused later, in
 * `buildEngineInput` (UNSUPPORTED_RULESET): there is no degrade. A block with no workout (every workout kept its saved focus)
 * leaves the answers without the key, so the legacy path stays byte for byte the same.
 */
export function convertBlueprintToGenerationAnswers(base: GenerationAnswers, compiled: Extract<CompileOutcome, { ok: true }>, opts: { replaceAll?: boolean } = {}): GenerationAnswers {
  const merged = mergeBlueprintAnswers(base.blueprint, compiled.blueprint, opts.replaceAll);
  if (!merged.workouts.length) {
    const { blueprint: _dropped, ...rest } = base;
    void _dropped;
    return rest;
  }
  return { ...base, blueprint: merged };
}
