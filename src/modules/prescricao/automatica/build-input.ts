/**
 * The input adapter's building half (motor S5, design §2 and §2.3): from the context read on the server and the professional's
 * answers, the engine input, the questions still open, the assumptions used and the references for the ledger. Pure and
 * deterministic: same context and answers, same output.
 *
 * Nothing missing is invented: a phase without a stimulus, a workout without a target, the equipment available, a stimulus
 * without a default modality all become questions (`required` ones block generation). What the engine will do without an
 * optional fact is written as an assumption.
 */
import { CLASS_LABELS, PROFILE_CODE_LABELS } from "@/modules/prescricao/motor/dose-profile";
import { DEFAULT_RULESET, getRuleSet } from "@/modules/prescricao/motor/rules";
import { targetSuggestion, type TargetSuggestion } from "@/modules/prescricao/motor/targets";
import { codeOf, normalizeText, STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";
import type {
  Assumption,
  DoseProfileCode,
  EngineInput,
  ExerciseClass,
  GenerationParameters,
  Issue,
  ItemTarget,
  RuleSetRef,
  StructureFacts,
  Suggestion,
  WeeklySetsTarget,
} from "@/modules/prescricao/motor/types";
import { blueprintStructureIssues, COMPILE_MESSAGES } from "@/modules/prescricao/planejador/compile";
import { DELTA_KEYS, expandFocus } from "@/modules/prescricao/planejador/focus";
import type { RoleFocusTable } from "@/modules/prescricao/planejador/role-focus";
import type { BuildOutcome, GenerationAnswers, GenerationFactRefs, GenerationQuestion } from "./contracts";
import { existingItems, structureFacts, studentFacts, type GenerationContext } from "./facts";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Every exercise id the answers mention, so each is checked against the visible library before the engine runs. */
function answerExerciseIds(a: GenerationAnswers): string[] {
  return [
    ...a.preferredExerciseIds,
    ...a.excludedExerciseIds,
    ...a.policyOverrides.flatMap((o) => (o.exerciseId ? [o.exerciseId] : [])),
    ...a.metricOverrides.map((m) => m.exerciseId),
    ...a.acceptedFlagDecisions.flatMap((d) => (d.decision.kind === "EXCLUDE_EXERCISE" ? [d.decision.exerciseId] : [])),
    ...(a.blueprint?.workouts.flatMap((w) => w.candidateExerciseIds) ?? []),
  ];
}

/** Stimulus suggestions from the student's goal text (rule GOAL_STIMULUS_HINTS): chips only, nothing pre-selected. */
export function goalSuggestions(goal: string | null, rules: RuleSetRef = DEFAULT_RULESET): Suggestion[] {
  const set = getRuleSet(rules);
  if (!goal || !set) return [];
  const text = normalizeText(goal);
  const out: Suggestion[] = [];
  for (const hint of set.rules.GOAL_STIMULUS_HINTS.value)
    if (hint.keywords.some((k) => text.includes(normalizeText(k))) && !out.some((s) => s.value === hint.stimulus))
      out.push({ value: hint.stimulus, ruleId: "GOAL_STIMULUS_HINTS", label: STIMULUS_LABELS[hint.stimulus] ?? hint.stimulus });
  return out;
}

/**
 * Codes of the assumptions this adapter adds (beyond the engine's own). The proposal service replaces them on every engine run
 * with the current ones, so a stale assumption never survives a regeneration (S6).
 */
export const ADAPTER_ASSUMPTION_CODES = [
  "DOSE_MODE_DEFAULT", "METADATA_TRUST_DEFAULT", "TIME_BUDGET_SOFT_DEFAULT", "ASSESSMENT_USED", "HISTORY_WINDOW", "HISTORY_TRUNCATED",
  "HISTORY_CUSTOM_SKIPPED", "CATALOG_PENDING_EXCLUDED", "CAUTION_TAGS_PARTIAL", "STRUCTURE_V1", "EXISTING_PRESERVED", "FREE_TEXT_NOT_PARSED",
  "CHECKINS_NOT_USED", "BLUEPRINT_APPLIED",
] as const;
/** Codes of the issues this adapter adds (facts in the records worth a look; never blocking). */
export const ADAPTER_ISSUE_CODES = [
  "AVAILABILITY_BELOW_SESSIONS", "BLUEPRINT_WORKOUT_NOT_PLANNED", "BLUEPRINT_STRUCTURE_FOCUS_WINS", "BLUEPRINT_DELTA_IGNORED",
] as const;

export interface BuildOptions {
  scope?: EngineInput["scope"];
  locked?: ItemTarget[];
  rules?: RuleSetRef;
}

const sortedCodes = (list: readonly string[] | undefined) => [...new Set(list ?? [])].sort(cmp);

/** A weekly target as the engine reads it, with only the bounds that were given. */
function weeklyEntry(w: WeeklySetsTarget): WeeklySetsTarget {
  return {
    muscle: w.muscle,
    ...(w.minWeighted !== undefined ? { minWeighted: w.minWeighted } : {}),
    ...(w.maxWeighted !== undefined ? { maxWeighted: w.maxWeighted } : {}),
    ...(w.minDirectSessions !== undefined ? { minDirectSessions: w.minDirectSessions } : {}),
  };
}
const weeklyKey = (list: readonly WeeklySetsTarget[] | undefined) =>
  JSON.stringify([...(list ?? [])].map(weeklyEntry).sort((a, b) => cmp(a.muscle, b.muscle)).map((w) => [w.muscle, w.minWeighted ?? null, w.maxWeighted ?? null, w.minDirectSessions ?? null]));

/** Whether an accepted coverage is exactly the rule's suggestion: muscles, patterns and weekly targets (order does not matter). */
export function sameAsSuggestion(c: { muscles?: readonly string[]; patterns?: readonly string[]; weeklySets?: readonly WeeklySetsTarget[] }, s: TargetSuggestion): boolean {
  return (
    JSON.stringify(sortedCodes(c.muscles)) === JSON.stringify(sortedCodes(s.muscles)) &&
    JSON.stringify(sortedCodes(c.patterns)) === JSON.stringify(sortedCodes(s.patterns)) &&
    weeklyKey(c.weeklySets) === weeklyKey(s.weeklySets)
  );
}

/**
 * The professional's targets per workout (`coverageByWorkout`) written as each workout's focus, which the engine already reads
 * (a workout's focus wins over the phase coverage for that workout). An entry with no muscle and no pattern changes nothing.
 */
function withWorkoutCoverage(structure: StructureFacts, entries: GenerationAnswers["coverageByWorkout"]): StructureFacts {
  const useful = entries.filter((c) => c.muscles?.length || c.patterns?.length);
  if (!useful.length) return structure;
  return {
    ...structure,
    phases: structure.phases.map((p) => ({
      ...p,
      workouts: p.workouts.map((w) => {
        const c = useful.find((x) => x.phaseIndex === p.index && x.label === w.label);
        if (!c) return w;
        return {
          ...w,
          focus: {
            ...w.focus,
            ...(c.muscles?.length ? { muscles: sortedCodes(c.muscles) } : {}),
            ...(c.patterns?.length ? { patterns: sortedCodes(c.patterns) } : {}),
          },
        };
      }),
    })),
  };
}

/**
 * The engine's parameters from the answers: only what the professional answered, plus the two defaults decided on 04/11/2026.
 * `audited`: the rule set has the audit (AUDIT_THRESHOLDS); only then do weekly targets reach the engine.
 */
function engineParameters(answers: GenerationAnswers, audited: boolean, roleFocus?: RoleFocusTable, intents?: DoseIntents): GenerationParameters {
  const blueprintFocus = roleFocus ? expandedBlueprint(answers, roleFocus) : [];
  return {
    doseMode: answers.doseMode ?? "FILL_FROM_POLICY",
    metadataTrust: answers.metadataTrust ?? "REVIEWED_AND_INFERRED",
    stimulusByPhase: answers.stimulusByPhase.map((s) => ({ phaseIndex: s.phaseIndex, value: s.value, basis: s.basis, ...(s.ruleId ? { ruleId: s.ruleId } : {}) })),
    modalitiesByWorkout: answers.modalitiesByWorkout,
    availableEquipment: answers.equipmentCodes === undefined ? null : answers.equipmentCodes === "NONE" ? [] : [...answers.equipmentCodes].sort(cmp),
    availableMinutes: answers.availableMinutes ?? null,
    timeBudget: answers.timeBudget ?? "SOFT",
    exerciseCountByWorkout: answers.exerciseCountByWorkout,
    preferredExerciseIds: answers.preferredExerciseIds,
    excludedExerciseIds: answers.excludedExerciseIds,
    excludedPatterns: answers.excludedPatterns,
    excludedCautionTags: answers.excludedCautionTags,
    phaseCoverage: answers.phaseCoverage.map((c) => ({
      phaseIndex: c.phaseIndex, basis: c.basis,
      ...(c.muscles ? { muscles: c.muscles } : {}), ...(c.patterns ? { patterns: c.patterns } : {}),
      // Weekly targets exist only for rule sets with the audit: an older proposal's input stays as it was (no unknown field).
      ...(c.weeklySets?.length && audited ? { weeklySets: c.weeklySets.map(weeklyEntry) } : {}),
      ...(c.ruleId ? { ruleId: c.ruleId } : {}),
    })),
    progressionByPhase: answers.progressionByPhase,
    doseOverrides: answers.policyOverrides,
    metricOverrides: answers.metricOverrides,
    acceptedFlagDecisions: answers.acceptedFlagDecisions,
    // Only with rules that read it (2026.11.5+) and only with an accepted strategy: otherwise the key does not exist and the
    // canonical input is exactly what it was before (hash of every earlier proposal unchanged).
    ...(blueprintFocus.length ? { blueprintFocus } : {}),
    // Same rule for the dose/progression intents (2026.11.6+): only what the professional ticked AND the pinned policy admits.
    ...(intents?.doseIntentByClass.length ? { doseIntentByClass: intents.doseIntentByClass } : {}),
    ...(intents?.progressionIntentByPhase.length ? { progressionIntentByPhase: intents.progressionIntentByPhase } : {}),
  };
}

export interface DoseIntents {
  doseIntentByClass: NonNullable<GenerationParameters["doseIntentByClass"]>;
  progressionIntentByPhase: NonNullable<GenerationParameters["progressionIntentByPhase"]>;
  /** Explained notes for what the policy did not take (never blocking). */
  issues: Issue[];
}

/**
 * The strategy's dose and progression intents that reach the engine: ONLY the items the professional ticked
 * (`answers.blueprint.dosing`) and only what the pinned ruleset admits. Whatever the policy does not take is dropped with an
 * explained INFO issue (never an error, never silently): a profile code the class does not admit, a rule set without the dose
 * policy, an intent that is informative only (UNDULATING, BLOCKS), a phase whose progression is the professional's or is saved in
 * the structure (the intent never replaces those; precedence is professional > structure > intent). The intent is carried in its own
 * parameter and NEVER written into `progressionByPhase` (that would silently replace the saved periodization).
 */
export function doseIntentsOf(answers: GenerationAnswers, ruleSet: NonNullable<ReturnType<typeof getRuleSet>>, structure: StructureFacts): DoseIntents {
  const out: DoseIntents = { doseIntentByClass: [], progressionIntentByPhase: [], issues: [] };
  const dosing = answers.blueprint?.dosing;
  // Rules without the dose policy (before 2026.11.6) know nothing of these intents: no parameter and no notice, as before.
  if (!dosing || !ruleSet.rules.DOSE_PROFILES) return out;
  // The choices come from one acceptance, whose origin the compiler recorded; a block without it (older) falls back to "any AI".
  const origin = dosing.source ?? (answers.blueprint!.acceptances.some((a) => a.source === "AI_SUGGESTED") ? "AI_SUGGESTED" : "RULES_HEURISTIC");
  const note = (code: string, path: string, message: string, phaseIndex?: number) =>
    out.issues.push({ severity: "INFO", code, stage: "INPUT", path, message, ...(phaseIndex !== undefined ? { phaseIndex } : {}) });

  const profiles = ruleSet.rules.DOSE_PROFILES;
  const classMap = ruleSet.rules.DOSE_CLASS_MAP?.value;
  for (const d of dosing.byClass) {
    const cls = CLASS_LABELS[d.exerciseClass as ExerciseClass];
    const code = PROFILE_CODE_LABELS[d.profileCode as DoseProfileCode];
    if (!profiles || !classMap) {
      note("DOSE_INTENT_REJECTED", `dosing.byClass.${d.exerciseClass}`, `A estratégia pediu o perfil "${code}" para ${cls}, mas as regras fixadas desta proposta não têm política de dose por perfil. Pedido ignorado; valem as doses padrão.`);
      continue;
    }
    if (!classMap[d.exerciseClass as ExerciseClass]?.includes(d.profileCode as DoseProfileCode)) {
      note("DOSE_INTENT_REJECTED", `dosing.byClass.${d.exerciseClass}`, `A estratégia pediu o perfil "${code}" para ${cls}, mas a política desta versão não admite esse perfil para a classe. Pedido ignorado; vale o perfil que a política escolhe pelos dados de cada exercício.`);
      continue;
    }
    out.doseIntentByClass.push({ exerciseClass: d.exerciseClass as ExerciseClass, profileCode: d.profileCode as DoseProfileCode, origin });
  }

  const templates = ruleSet.rules.PROGRESSION_TEMPLATES?.value;
  const savedPhases = new Map(structure.phases.map((p) => [p.index, p]));
  for (const d of [...dosing.progression].sort((a, b) => a.phaseIndex - b.phaseIndex)) {
    const where = `phases.${d.phaseIndex}.progression`;
    const template = templates?.[d.intent];
    if (!template?.applied || !template.progression) {
      note("PROGRESSION_INTENT_NOT_APPLIED", where, `Fase ${d.phaseIndex}: a estratégia sugere a progressão "${d.intent}". Sugestão informativa; defina a progressão da fase para aplicar.`, d.phaseIndex);
      continue;
    }
    const byProfessional = answers.progressionByPhase.some((p) => p.phaseIndex === d.phaseIndex);
    if (byProfessional || savedPhases.get(d.phaseIndex)?.progression) {
      note("PROGRESSION_INTENT_SUPERSEDED", where, `Fase ${d.phaseIndex}: a fase já tem progressão ${byProfessional ? "definida por você nesta geração" : "gravada na periodização"}; a intenção "${d.intent}" da estratégia não foi aplicada.`, d.phaseIndex);
      continue;
    }
    out.progressionIntentByPhase.push({
      phaseIndex: d.phaseIndex, intent: d.intent, origin, progression: template.progression,
      ...(template.loadInstruction !== undefined ? { loadInstruction: template.loadInstruction } : {}),
    });
  }
  return out;
}

/** The ruleset's role table in the shape `expandFocus` reads (`spilloverPatterns` is the table's name for `allowedSpilloverPatterns`). */
export function roleFocusTableOf(table: Record<string, { dominantMuscles: string[]; supportingMuscles: string[]; targetPatterns: string[]; spilloverPatterns: string[] }>): RoleFocusTable {
  return Object.fromEntries(
    Object.entries(table).map(([role, f]) => [role, { dominantMuscles: f.dominantMuscles, supportingMuscles: f.supportingMuscles, targetPatterns: f.targetPatterns, allowedSpilloverPatterns: f.spilloverPatterns }]),
  ) as unknown as RoleFocusTable;
}

/** Each compiled workout expanded with the PINNED ruleset's table (role + delta -> lists), sorted by phase and label. */
function expandedBlueprint(answers: GenerationAnswers, table: RoleFocusTable): NonNullable<GenerationParameters["blueprintFocus"]> {
  const b = answers.blueprint;
  if (!b) return [];
  const strategyOf = new Map(b.acceptances.map((a) => [a.acceptanceId, a.strategyId]));
  return b.workouts
    .map((w) => {
      const f = expandFocus(w.role, w.focusDelta, table);
      return {
        phaseIndex: w.phaseIndex, label: w.label, role: w.role, source: w.source, strategyId: strategyOf.get(w.acceptanceId) ?? "CUSTOM",
        dominantMuscles: f.dominantMuscles, supportingMuscles: f.supportingMuscles, targetPatterns: f.targetPatterns, spilloverPatterns: f.allowedSpilloverPatterns,
        candidateExerciseIds: [...w.candidateExerciseIds].sort(cmp),
      };
    })
    .sort((x, y) => x.phaseIndex - y.phaseIndex || cmp(x.label, y.label));
}

/**
 * The suggested targets of some phases of an open proposal, exactly as `buildEngineInput` checks an acceptance: the saved
 * structure with the targets per workout of the answers, and the engine parameters of the answers. It reads nothing else
 * (no library, history or student data), so the proposal page can show the card without a full generation context. Phases
 * not in the structure are left out; `reason` says why a phase has no suggestion.
 */
export function suggestedTargets(
  schedule: GenerationContext["revision"]["schedule"],
  answers: GenerationAnswers,
  rules: RuleSetRef,
  phaseIndexes: readonly number[],
): Array<{ phaseIndex: number; suggestion: TargetSuggestion | null; reason: string | null }> {
  const ruleSet = getRuleSet(rules);
  if (!ruleSet?.rules.MICROCYCLE_TARGET_SUGGESTIONS || !phaseIndexes.length) return [];
  const structure = withWorkoutCoverage(structureFacts(schedule), answers.coverageByWorkout);
  const parameters = engineParameters(answers, Boolean(ruleSet.rules.AUDIT_THRESHOLDS));
  const wanted = new Set(phaseIndexes);
  return structure.phases
    .filter((p) => wanted.has(p.index))
    .map((phase) => {
      const out = targetSuggestion(rules, phase, { parameters });
      return { phaseIndex: phase.index, suggestion: out.suggestion, reason: out.suggestion ? null : out.reason };
    });
}

export function buildEngineInput(ctx: GenerationContext, answers: GenerationAnswers, options: BuildOptions = {}): BuildOutcome {
  const rules = options.rules ?? DEFAULT_RULESET;
  const ruleSet = getRuleSet(rules);
  if (!ruleSet) throw new Error("RULESET_UNKNOWN");
  const baseStructure = structureFacts(ctx.revision.schedule);

  // 0. An accepted strategy needs rules that read it. No degrade: merging its focus into per-workout targets would raise a
  // "not covered" warning in every workout (the strategy is a guide, not a goal).
  if (answers.blueprint && !ruleSet.rules.MICROCYCLE_BLUEPRINT) return { ok: false, code: "UNSUPPORTED_RULESET", message: COMPILE_MESSAGES.UNSUPPORTED_RULESET };
  // 1. Every exercise id and every target in the answers must exist: the visible library, the saved structure.
  const catalogIds = new Set(ctx.catalog.map((e) => e.id));
  const unknown = [...new Set(answerExerciseIds(answers).filter((id) => !catalogIds.has(id)))].sort(cmp);
  if (unknown.length) return { ok: false, code: "UNKNOWN_EXERCISE", exerciseIds: unknown };
  const phases = new Map(baseStructure.phases.map((p) => [p.index, new Set(p.workouts.map((w) => w.label))]));
  const badTargets: Array<{ phaseIndex: number; label?: string }> = [];
  const checkPhase = (phaseIndex: number) => {
    if (!phases.has(phaseIndex)) badTargets.push({ phaseIndex });
  };
  const checkWorkout = (phaseIndex: number, label: string) => {
    if (!phases.get(phaseIndex)?.has(label)) badTargets.push({ phaseIndex, label });
  };
  answers.stimulusByPhase.forEach((s) => checkPhase(s.phaseIndex));
  answers.phaseCoverage.forEach((c) => checkPhase(c.phaseIndex));
  answers.progressionByPhase.forEach((p) => checkPhase(p.phaseIndex));
  answers.modalitiesByWorkout.forEach((m) => checkWorkout(m.phaseIndex, m.label));
  answers.exerciseCountByWorkout.forEach((c) => checkWorkout(c.phaseIndex, c.label));
  answers.coverageByWorkout.forEach((c) => checkWorkout(c.phaseIndex, c.label));
  answers.blueprint?.workouts.forEach((w) => checkWorkout(w.phaseIndex, w.label));
  if (ruleSet.rules.DOSE_PROFILES) answers.blueprint?.dosing?.progression.forEach((p) => checkPhase(p.phaseIndex));
  answers.policyOverrides.forEach((o) => {
    if (o.phaseIndex !== undefined && o.label !== undefined) checkWorkout(o.phaseIndex, o.label);
    else if (o.phaseIndex !== undefined) checkPhase(o.phaseIndex);
  });
  if (options.scope?.kind === "PHASES") options.scope.phaseIndexes.forEach(checkPhase);
  if (badTargets.length) return { ok: false, code: "UNKNOWN_TARGET", targets: badTargets };

  // 1b. "Sugestão aceita" only for what a rule of this rule set actually suggests: the stimulus chips come from the student's goal
  // (GOAL_STIMULUS_HINTS). Coverage: with MICROCYCLE_TARGET_SUGGESTIONS (2026.11.4+) the one suggestion of that rule, exactly as the
  // rule computes it for the phase (checked below, once the parameters exist); without it, patterns of DEFAULT_COVERAGE (any
  // modality: which modality a workout ends up with is the engine's to resolve) and never muscles. A DEFAULT_COVERAGE acceptance
  // already stored stays valid under the newer rules, so saved answers keep working. Anything else the professional chose is
  // PROFESSIONAL: a subset or an edit of a suggestion included.
  const goalChips = new Set(goalSuggestions(studentFacts(ctx.profile, ctx.assessment).goal?.value ?? null, rules).map((s) => s.value));
  const coverageChips = new Set(Object.values(ruleSet.rules.DEFAULT_COVERAGE.value).flat());
  const suggests = Boolean(ruleSet.rules.MICROCYCLE_TARGET_SUGGESTIONS);
  const unsupported: Array<{ field: "stimulusByPhase" | "phaseCoverage"; phaseIndex: number }> = [];
  for (const s of answers.stimulusByPhase)
    if (s.basis === "HEURISTIC_ACCEPTED" && (s.ruleId !== "GOAL_STIMULUS_HINTS" || !goalChips.has(s.value)))
      unsupported.push({ field: "stimulusByPhase", phaseIndex: s.phaseIndex });
  const legacyCoverage = (c: GenerationAnswers["phaseCoverage"][number]) =>
    c.ruleId === "DEFAULT_COVERAGE" && !c.muscles?.length && !c.weeklySets?.length && Boolean(c.patterns?.length) && !c.patterns!.some((p) => !coverageChips.has(p));
  const toCheck: Array<GenerationAnswers["phaseCoverage"][number]> = [];
  for (const c of answers.phaseCoverage) {
    if (c.basis !== "HEURISTIC_ACCEPTED" || legacyCoverage(c)) continue;
    if (suggests && c.ruleId === "MICROCYCLE_TARGET_SUGGESTIONS") toCheck.push(c);
    else unsupported.push({ field: "phaseCoverage", phaseIndex: c.phaseIndex });
  }
  if (unsupported.length) return { ok: false, code: "UNSUPPORTED_SUGGESTION", targets: unsupported };

  // 2. The engine's parameters: only what the professional answered, plus the two defaults decided on 04/11/2026.
  const roleTable = ruleSet.rules.MICROCYCLE_BLUEPRINT && ruleSet.rules.BLUEPRINT_ROLE_FOCUS ? roleFocusTableOf(ruleSet.rules.BLUEPRINT_ROLE_FOCUS.value) : undefined;
  const intents = doseIntentsOf(answers, ruleSet, baseStructure);
  const parameters = engineParameters(answers, Boolean(ruleSet.rules.AUDIT_THRESHOLDS), roleTable, intents);
  // 2b. A suggestion accepted as is must be exactly what the rule suggests for that phase today (same omission rule for the
  // sessions per week), or it is the professional's choice and must say so. `suggestedTargets` computes the card's suggestion
  // from these same two pieces (structure and parameters), so what "Aceitar" sends is what is checked here.
  const structure = withWorkoutCoverage(baseStructure, answers.coverageByWorkout);
  for (const c of toCheck) {
    const phase = structure.phases.find((p) => p.index === c.phaseIndex)!;
    const out = targetSuggestion(rules, phase, { parameters });
    if (!out.suggestion || !sameAsSuggestion(c, out.suggestion)) unsupported.push({ field: "phaseCoverage", phaseIndex: c.phaseIndex });
  }
  if (unsupported.length) return { ok: false, code: "UNSUPPORTED_SUGGESTION", targets: unsupported };

  const studentAll = studentFacts(ctx.profile, ctx.assessment);
  // Leituras estruturadas só vão ao motor com a regra que as usa (2026.11.4+): a entrada das versões anteriores fica igual.
  const student = ruleSet.rules.FINDING_OBSERVATION_MAP
    ? studentAll
    : { ...studentAll, findings: studentAll.findings.map((f) => {
        if (!f.readings) return f;
        const rest = { ...f };
        delete rest.readings;
        return rest;
      }) };
  const input: EngineInput = {
    rules,
    asOf: ctx.asOf,
    parameters,
    student,
    structure,
    catalog: ctx.catalog,
    history: ctx.history.summary.logs,
    existing: existingItems(ctx.existing),
    locked: options.locked ?? [],
    scope: options.scope ?? { kind: "FULL" },
  };

  // 3. Questions: what the records and the structure do not say.
  const questions: GenerationQuestion[] = [];
  const suggestions = goalSuggestions(student.goal?.value ?? null, rules);
  const modalityFor = ruleSet.rules.MODALITY_FOR_STIMULUS.value;
  for (const phase of structure.phases) {
    const answer = answers.stimulusByPhase.find((s) => s.phaseIndex === phase.index);
    const progression = answers.progressionByPhase.find((p) => p.phaseIndex === phase.index)?.progression;
    const fromProgression = [...(progression?.sequence?.stimuli ?? []), ...(progression?.blocks?.map((b) => b.stimulus) ?? [])];
    const stimuli = answer ? [answer.value] : fromProgression;
    if (!stimuli.length)
      questions.push({
        code: "STIMULUS", required: true, where: "GENERATION", phaseIndex: phase.index,
        message: `Fase ${phase.index}${phase.name ? ` (${phase.name})` : ""}: qual o estímulo? A periodização salva não diz.`,
        ...(suggestions.length ? { suggestions } : {}),
      });
    for (const workout of phase.workouts) {
      if (workout.exerciseTarget === null && !answers.exerciseCountByWorkout.some((c) => c.phaseIndex === phase.index && c.label === workout.label))
        questions.push({
          code: "EXERCISE_COUNT", required: true, where: "GENERATION", phaseIndex: phase.index, label: workout.label,
          message: `Fase ${phase.index}, treino ${workout.label}: quantos exercícios? A estrutura está "sem alvo". Informe um número ou "pelo tempo disponível".`,
        });
      const chosen = answers.modalitiesByWorkout.some((m) => m.phaseIndex === phase.index && m.label === workout.label);
      const withoutDefault = stimuli.map(codeOf).filter((s) => !modalityFor[s]);
      if (!chosen && withoutDefault.length)
        questions.push({
          code: "MODALITIES", required: true, where: "GENERATION", phaseIndex: phase.index, label: workout.label,
          message: `Fase ${phase.index}, treino ${workout.label}: o estímulo ${withoutDefault.join(", ")} não tem modalidade padrão nas regras. Escolha as modalidades do treino.`,
        });
    }
  }
  const profileText = [ctx.profile?.location ? `Local: ${ctx.profile.location}` : null, ctx.profile?.equipment ? `Equipamentos na ficha: ${ctx.profile.equipment}` : null]
    .filter(Boolean)
    .join(" · ");
  if (answers.equipmentCodes === undefined)
    questions.push({
      code: "EQUIPMENT", required: true, where: "GENERATION",
      message: "Quais equipamentos o aluno tem disponíveis? Marque cada um, ou \"sem equipamento\". O texto da ficha não é interpretado.",
      ...(profileText ? { context: profileText } : {}),
    });
  const everyWorkoutHasMinutes = structure.phases.every((p) => p.workouts.every((w) => w.focus.minutes));
  if (answers.availableMinutes === undefined && !student.sessionMinutes && !everyWorkoutHasMinutes)
    questions.push({
      code: "AVAILABLE_MINUTES", required: false, where: "GENERATION",
      message: "Tempo por sessão não informado (nem na ficha nem nos treinos): a duração será estimada sem comparar com a disponibilidade.",
    });
  if (!ctx.profile)
    questions.push({ code: "PROFILE_MISSING", required: false, where: "PROFILE", message: "O aluno não tem ficha: nível, objetivo e tempo por sessão ficam desconhecidos." });
  else {
    if (!ctx.profile.level)
      questions.push({ code: "PROFILE_LEVEL", required: false, where: "PROFILE", message: "Nível de experiência não informado na ficha: a dificuldade pesa como para não iniciantes." });
  }
  if (!student.goal)
    questions.push({ code: "PROFILE_GOAL", required: false, where: "PROFILE", message: "Objetivo não informado na ficha nem na avaliação: nenhuma sugestão de estímulo." });
  if (!ctx.assessment)
    questions.push({ code: "ASSESSMENT_MISSING", required: false, where: "ASSESSMENT", message: "Nenhuma avaliação registrada: a triagem (PAR-Q) consta como não feita." });
  else if (student.screening.parq === "POSITIVE" && !student.screening.professionalDecision)
    questions.push({ code: "SCREENING_DECISION", required: false, where: "ASSESSMENT", message: "PAR-Q com \"Sim\" sem decisão profissional registrada na avaliação." });

  // 4. Assumptions the adapter made (the engine adds its own: experience, history, dates, equipment, budget).
  const assumptions: Assumption[] = [];
  if (answers.doseMode === undefined)
    assumptions.push({ code: "DOSE_MODE_DEFAULT", text: "Doses preenchidas pela política editável: padrão da ferramenta (decidido em 04/11/2026, a confirmar pelo usuário).", basis: "HEURISTIC" });
  if (answers.metadataTrust === undefined)
    assumptions.push({ code: "METADATA_TRUST_DEFAULT", text: "Seleção com metadados revisados e inferidos: padrão da ferramenta (decidido em 04/11/2026); restrinja a revisados se preferir.", basis: "HEURISTIC" });
  if (answers.timeBudget === undefined)
    assumptions.push({ code: "TIME_BUDGET_SOFT_DEFAULT", text: "Tempo disponível como referência (aviso quando passar), sem cortar exercícios.", basis: "HEURISTIC" });
  if (ctx.assessment)
    assumptions.push({
      code: "ASSESSMENT_USED",
      text: `Triagem e achados da avaliação de ${brDate(ctx.assessment.assessedOn)} (a mais recente registrada). Observações isoladas não são contraindicação automática.`,
      basis: "STUDENT_DATA",
    });
  const w = ctx.history.window;
  assumptions.push({
    code: "HISTORY_WINDOW",
    text: w.sessions
      ? `Histórico de execução: ${w.sessions} ${w.sessions === 1 ? "sessão" : "sessões"} entre ${brDate(w.since)} e ${brDate(w.until)} (janela de ${w.sinceDays} dias).`
      : `Nenhuma sessão registrada entre ${brDate(w.since)} e ${brDate(w.until)} (janela de ${w.sinceDays} dias).`,
    basis: ruleSet.rules.EXPOSURE_WINDOW_DAYS.basis,
    ruleId: "EXPOSURE_WINDOW_DAYS",
  });
  if (w.truncated)
    assumptions.push({ code: "HISTORY_TRUNCATED", text: `Só as ${w.sessions} sessões mais recentes da janela foram lidas (limite técnico).`, basis: "HEURISTIC" });
  if (ctx.history.summary.customSkipped)
    assumptions.push({ code: "HISTORY_CUSTOM_SKIPPED", text: `${ctx.history.summary.customSkipped} registro(s) de exercícios digitados pelo nome (fora da biblioteca) não entram no histórico do motor.`, basis: "STUDENT_DATA" });
  const pending = ctx.catalog.filter((e) => e.metadataStatus === "PENDING").length;
  if (pending)
    assumptions.push({ code: "CATALOG_PENDING_EXCLUDED", text: `${pending} exercício(s) da biblioteca pendentes de curadoria não entram na seleção automática.`, basis: "HEURISTIC" });
  // Markers excluded by the answers or by an accepted alert decision: either way an exercise with no marker set passes the exclusion.
  const excludesByTag = answers.excludedCautionTags.length > 0 || answers.acceptedFlagDecisions.some((d) => d.decision.kind === "EXCLUDE_CAUTION_TAG");
  if (excludesByTag && ctx.cautionTagsUnknown.length)
    assumptions.push({ code: "CAUTION_TAGS_PARTIAL", text: `${ctx.cautionTagsUnknown.length} exercício(s) sem marcadores de cuidado revisados: a exclusão por marcador não os alcança.`, basis: "HEURISTIC" });
  if (ctx.revision.schedule.schemaVersion === 1)
    assumptions.push({ code: "STRUCTURE_V1", text: "Periodização no formato anterior: o alvo de exercícios de cada treino é o da fase e não há datas previstas por sessão.", basis: "PROFESSIONAL" });
  if (ctx.existing.length)
    assumptions.push({ code: "EXISTING_PRESERVED", text: `${ctx.existing.length} exercício(s) já prescrito(s) neste rascunho são preservados e contam no alvo de cada treino.`, basis: "PROFESSIONAL" });
  const p = ctx.profile;
  if (p && [p.equipment, p.experience, p.injuries, p.surgeries, p.pains, p.limitations, p.medicationsConditions, p.relevantNotes, p.preferredExercises, p.dislikedExercises, p.excludedExercises, p.professionalNotes].some(Boolean))
    assumptions.push({ code: "FREE_TEXT_NOT_PARSED", text: "Os textos livres da ficha (equipamentos, preferências, saúde, observações) são mostrados ao profissional e nunca interpretados pelo motor: transforme-os em respostas explícitas.", basis: "PROFESSIONAL" });
  const planned = parameters.blueprintFocus ?? [];
  if (planned.length) {
    const ai = planned.some((b) => b.source === "AI_SUGGESTED");
    const mine = planned.some((b) => b.source === "PROFESSIONAL");
    assumptions.push({
      code: "BLUEPRINT_APPLIED",
      text: `Estratégia aceita pelo profissional guia ${planned.length} ${planned.length === 1 ? "treino" : "treinos"} (foco dominante por treino; os alvos semanais da fase continuam valendo em todos e nenhum exercício é proibido). Origem: ${[ai ? "sugestão da IA" : null, planned.some((b) => b.source === "RULES_HEURISTIC") ? "heurística operacional por regras" : null, mine ? "ajuste do profissional" : null].filter(Boolean).join(", ")}.`,
      basis: "HEURISTIC_ACCEPTED",
      ruleId: "MICROCYCLE_BLUEPRINT",
    });
  }
  assumptions.push({ code: "CHECKINS_NOT_USED", text: "Check-ins do aluno ficam de fora da geração (decidido em 04/11/2026, Q6).", basis: "PROFESSIONAL" });

  // 5. Facts in the records worth a look (never blocking).
  const issues: Issue[] = [...intents.issues];
  const days = p?.daysPerWeek ?? null;
  if (days !== null)
    for (const phase of structure.phases)
      if (phase.sessionsPerWeek > days)
        issues.push({
          severity: "WARNING", code: "AVAILABILITY_BELOW_SESSIONS", stage: "INPUT", path: `phases.${phase.index}`, phaseIndex: phase.index,
          message: `A ficha diz ${days} dia(s) por semana; a fase ${phase.index} tem ${phase.sessionsPerWeek} sessões por semana.`,
        });

  if (answers.blueprint && roleTable) {
    // Workouts the strategy does not cover, and workouts whose saved focus wins: derived again on every run, never stored as stale.
    const saved = new Set<string>();
    for (const ph of structure.phases) for (const w of ph.workouts) if (w.focus.muscles?.length || w.focus.patterns?.length) saved.add(`${ph.index}|${w.label}`);
    issues.push(...blueprintStructureIssues(structure, answers.blueprint.workouts, saved, new Set(answers.blueprint.workouts.map((w) => w.phaseIndex))));
    for (const w of answers.blueprint.workouts) {
      const base = expandFocus(w.role, null, roleTable);
      const baseOf: Record<string, readonly string[]> = {
        removeDominant: base.dominantMuscles, removeSupporting: base.supportingMuscles, removeTargetPatterns: base.targetPatterns, removeSpillover: base.allowedSpilloverPatterns,
      };
      const ignored = w.focusDelta ? DELTA_KEYS.filter((k) => k in baseOf).reduce((n, k) => n + w.focusDelta![k].filter((c) => !baseOf[k].includes(c)).length, 0) : 0;
      if (ignored)
        issues.push({
          severity: "INFO", code: "BLUEPRINT_DELTA_IGNORED", path: `phases.${w.phaseIndex}.workouts.${w.label}`, stage: "INPUT", phaseIndex: w.phaseIndex, label: w.label, count: ignored,
          message: `Fase ${w.phaseIndex}, treino ${w.label}: ${ignored} ajuste(s) de foco removiam algo que a tabela de papéis das regras atuais não tem e foram ignorados.`,
        });
    }
  }

  const counts = { reviewed: 0, inferred: 0, pending: 0 };
  for (const e of ctx.catalog) counts[e.metadataStatus === "REVIEWED" ? "reviewed" : e.metadataStatus === "INFERRED" ? "inferred" : "pending"] += 1;
  const facts: GenerationFactRefs = {
    plan: { id: ctx.plan.id, studentId: ctx.plan.studentId },
    revision: { id: ctx.revision.id, contentVersion: ctx.revision.contentVersion, prescriptionModel: ctx.revision.prescriptionModel, structureVersion: ctx.revision.schedule.schemaVersion },
    profile: ctx.profile ? { updatedAt: ctx.profile.updatedAt } : null,
    assessment: ctx.assessment
      ? { id: ctx.assessment.id, assessedOn: ctx.assessment.assessedOn, recordedAt: ctx.assessment.recordedAt, formatVersion: ctx.assessment.formatVersion }
      : null,
    catalog: { hash: ctx.catalogHash, exercises: ctx.catalog.length, ...counts },
    history: { since: w.since, until: w.until, sinceDays: w.sinceDays, sessions: w.sessions, truncated: w.truncated, logs: ctx.history.summary.logs.length },
    existing: { rows: ctx.existing.length },
    asOf: ctx.asOf,
  };
  return { ok: true, input, questions, ready: !questions.some((q) => q.required), assumptions, issues, facts };
}
