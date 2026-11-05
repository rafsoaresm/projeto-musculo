/**
 * Geração completa: para cada fase, cada treino tem UMA seleção de exercícios; cada ocorrência
 * (semana × sessão) recebe a sua dose (estímulo da ocorrência + progressão semanal). Puro,
 * síncrono e determinístico: mesma entrada → mesma saída, byte a byte.
 */
import { auditPlan, boundAudit } from "./audit";
import { applyBounds } from "./bounds";
import { TECHNICAL_LIMITS } from "./bounds";
import { resolveDose, toDisplayFields, validateDose, metricFor } from "./dose";
import { occurrenceMinutes } from "./duration";
import { eligibilityContext, ineligibleReason, INELIGIBLE_TEXT, type EligibilityContext, type IneligibleReason } from "./eligibility";
import { assessmentObservations, buildFlags } from "./flags";
import { proposeProgression } from "./progression";
import { indexInWeek, occurrencesOf, occurrenceStimulus, progressionFor } from "./occurrence";
export { occurrenceStimulus, progressionFor } from "./occurrence";
import { existingFor, metadataOf, nameKeyOf, parseSlotKey, rankAlternatives, selectExercises, slotKeyOf, type Coverage, type SelectionRequest } from "./select";
import { targetSuggestion } from "./targets";
import { planPhaseMicrocycle, type GenerateOptions, type ReservedSubstitution } from "./microcycle";
import { ruleLogFor, RuleLog, uniqueIssues } from "./trace";
import { validateInput } from "./validate";
import { volumeFor } from "./volume";
import { cmp, codeOf, labelsOf, MODALITY_LABELS, MUSCLE_LABELS, normalizeText, numberText, PATTERN_LABELS, STIMULUS_LABELS, VOCABULARY_VERSION } from "./vocabulary";
import type {
  Assumption,
  CatalogExercise,
  EngineInput,
  EngineResult,
  ExistingItem,
  Experience,
  Fact,
  HistorySuggestion,
  Issue,
  ItemOut,
  OccurrenceOut,
  ParamTrace,
  PhaseSummary,
  StructureOccurrence,
  StructurePhase,
  StructureWorkout,
  Suggestion,
  TraceEntry,
  WorkoutSummary,
} from "./types";

export const ENGINE_VERSION = "2.3.0";

// ---------- contexto ----------

export interface EngineContext {
  input: EngineInput;
  log: RuleLog;
  elig: EligibilityContext;
  byId: Map<string, CatalogExercise>;
  catalog: CatalogExercise[];
  experience: Experience | null;
  history: Map<string, { exposures: number; pain: boolean }>;
}

export function prepare(input: EngineInput): EngineContext | null {
  const log = ruleLogFor(input.rules);
  if (!log) return null;
  const catalog = [...input.catalog].sort((a, b) => cmp(a.id, b.id));
  const history = new Map<string, { exposures: number; pain: boolean }>();
  for (const h of input.history) {
    if (h.date > input.asOf) continue;
    const cur = history.get(h.exerciseId) ?? { exposures: 0, pain: false };
    history.set(h.exerciseId, { exposures: cur.exposures + 1, pain: cur.pain || h.pain });
  }
  const map = log.get("EXPERIENCE_MAP");
  const level = input.student.level?.value;
  const experience = level ? (map[normalizeText(level)] ?? null) : null;
  return { input, log, elig: eligibilityContext(input), byId: new Map(catalog.map((e) => [e.id, e])), catalog, experience, history };
}

function emptyResult(input: EngineInput, issues: Issue[]): EngineResult {
  return {
    engineVersion: ENGINE_VERSION, rules: input.rules, vocabularyVersion: VOCABULARY_VERSION,
    status: "INFEASIBLE", validation: "BLOCKED", requiresProfessionalReview: true,
    phases: [], workouts: [], occurrences: [], issues, assumptions: [], flags: [], volume: [], historySuggestions: [], rulesUsed: [],
  };
}

export function unknownRules(input: EngineInput): EngineResult {
  return emptyResult(input, [{ severity: "ERROR", code: "RULESET_UNKNOWN", path: "rules", stage: "INPUT", message: `Conjunto de regras ${input.rules.id}@${input.rules.version} não existe nesta versão do motor.` }]);
}

// ---------- fatos por fase / treino / ocorrência ----------

export function budgetFor(input: EngineInput, workout: StructureWorkout | undefined): { minutes: number; source: "WORKOUT" | "PARAMETERS" | "PROFILE" } | null {
  if (workout?.focus.minutes) return { minutes: workout.focus.minutes, source: "WORKOUT" };
  if (input.parameters.availableMinutes) return { minutes: input.parameters.availableMinutes, source: "PARAMETERS" };
  if (input.student.sessionMinutes?.value) return { minutes: input.student.sessionMinutes.value, source: "PROFILE" };
  return null;
}

function goalSuggestions(ctx: EngineContext): Suggestion[] {
  const goal = ctx.input.student.goal?.value;
  if (!goal) return [];
  const text = normalizeText(goal);
  const out: Suggestion[] = [];
  for (const hint of ctx.log.get("GOAL_STIMULUS_HINTS"))
    if (hint.keywords.some((k) => text.includes(normalizeText(k))) && !out.some((s) => s.value === hint.stimulus))
      out.push({ value: hint.stimulus, ruleId: "GOAL_STIMULUS_HINTS", label: STIMULUS_LABELS[hint.stimulus] ?? hint.stimulus });
  return out;
}

function modalitiesFor(ctx: EngineContext, phase: StructurePhase, workout: StructureWorkout, stimuli: string[]): Fact<string[]> | null {
  if (workout.focus.modalities?.length) return { value: workout.focus.modalities.map(codeOf), source: "STRUCTURE", basis: "PROFESSIONAL" };
  const p = ctx.input.parameters.modalitiesByWorkout.find((m) => m.phaseIndex === phase.index && m.label === workout.label);
  if (p?.modalities.length) return { value: p.modalities.map(codeOf), source: "PROFESSIONAL", basis: "PROFESSIONAL" };
  if (!stimuli.length) return null;
  const map = ctx.log.get("MODALITY_FOR_STIMULUS");
  const out = new Set<string>();
  for (const s of stimuli) {
    const m = map[s];
    if (!m) return null; // estímulo sem modalidade padrão: pergunta, nunca palpite
    for (const x of m) out.add(x);
  }
  return { value: [...out].sort(cmp), source: "RULES", basis: ctx.log.basis("MODALITY_FOR_STIMULUS"), ruleId: "MODALITY_FOR_STIMULUS" };
}

function countFor(input: EngineInput, phase: StructurePhase, workout: StructureWorkout): Fact<number> | "BY_TIME" | null {
  if (workout.exerciseTarget !== null) return { value: workout.exerciseTarget, source: "STRUCTURE", basis: "PROFESSIONAL" };
  const c = input.parameters.exerciseCountByWorkout.find((x) => x.phaseIndex === phase.index && x.label === workout.label);
  if (!c) return null;
  if (c.count === "BY_TIME") return "BY_TIME";
  return { value: c.count, source: "PROFESSIONAL", basis: "PROFESSIONAL" };
}

/**
 * Alvos de cobertura do treino: o foco do treino vence o alvo da fase. Com as regras da auditoria (2026.11.3+) o objeto também
 * grava de onde veio (`origin`) e os alvos semanais da fase (`weeklySets`, com a base da entrada); versões anteriores, como antes.
 */
export function coverageFor(ctx: EngineContext, phase: StructurePhase, workout: StructureWorkout): Coverage | null {
  const { input, log } = ctx;
  const audited = log.optional("AUDIT_THRESHOLDS") !== undefined;
  const c = input.parameters.phaseCoverage.find((x) => x.phaseIndex === phase.index);
  const weeklySets = audited && c?.weeklySets?.length
    ? { weeklySets: c.weeklySets.map((w) => ({ ...w, muscle: codeOf(w.muscle), basis: c.basis, ...(c.ruleId ? { ruleId: c.ruleId } : {}) })) }
    : {};
  if (workout.focus.muscles?.length || workout.focus.patterns?.length)
    return { muscles: workout.focus.muscles ?? [], patterns: workout.focus.patterns ?? [], basis: "PROFESSIONAL", ...(audited ? { origin: "WORKOUT_FOCUS" as const } : {}), ...weeklySets };
  // Foco dominante da estratégia aceita (2026.11.5+): vale só neste treino; os alvos semanais da fase continuam globais.
  // A regra só é lida (e só entra em `rulesUsed`) quando há foco para este treino: sem estratégia, o resultado é o da 2026.11.4.
  const b = input.parameters.blueprintFocus?.find((x) => x.phaseIndex === phase.index && x.label === workout.label);
  if (b && log.optional("MICROCYCLE_BLUEPRINT")) {
    // Papéis sem volume (cardio, mobilidade, equilíbrio, habilidade) não geram cobertura: a seleção antiga cuida do treino.
    // Papel personalizado vazio (sem músculo nem padrão): nada a puxar; vale a cobertura da fase, que o profissional já aceitou.
    if (b.role !== "CARDIO" && b.role !== "MOBILITY" && b.role !== "BALANCE" && b.role !== "SKILL" && (b.dominantMuscles.length || b.targetPatterns.length))
      return {
        muscles: b.dominantMuscles, patterns: b.targetPatterns, basis: b.source === "PROFESSIONAL" ? "PROFESSIONAL" : "HEURISTIC_ACCEPTED", ruleId: "MICROCYCLE_BLUEPRINT",
        origin: "BLUEPRINT_FOCUS",
        blueprint: { role: b.role, source: b.source, strategyId: b.strategyId, supporting: b.supportingMuscles, spillover: b.spilloverPatterns, candidates: b.candidateExerciseIds },
        ...weeklySets,
      };
  }
  if (c && (c.muscles?.length || c.patterns?.length || "weeklySets" in weeklySets))
    return { muscles: c.muscles ?? [], patterns: c.patterns ?? [], basis: c.basis, ...(c.ruleId ? { ruleId: c.ruleId } : {}), ...(audited ? { origin: "PHASE_COVERAGE" as const } : {}), ...weeklySets };
  return null;
}

// ---------- plano de um treino ----------

export interface SlotPlan {
  slotKey: string;
  exercise: CatalogExercise | null;
  existing: ExistingItem | null;
  origin: ItemOut["origin"];
  selection: TraceEntry[];
  alternatives: string[];
}

/** O treino antes da seleção: o que ele pode receber e o que já está fixo nele. */
export interface WorkoutDraft {
  phase: StructurePhase;
  workout: StructureWorkout;
  stimulus: Fact<string> | null;
  modalities: Fact<string[]> | null;
  pool: CatalogExercise[];
  excluded: Partial<Record<IneligibleReason, number>>;
  /** Preservados, travados (e, no microciclo, trocas do profissional mantidas numa regeneração). */
  slots: SlotPlan[];
  preserved: ExistingItem[];
  /** Exercícios que já ocupam lugar no treino (não entram na seleção). */
  taken: Set<string>;
  /** Exercícios que uma troca mantida tirou do treino: a seleção não os traz de volta. */
  blocked: Set<string>;
  count: Fact<number> | "BY_TIME" | null;
  budget: { minutes: number; source: "WORKOUT" | "PARAMETERS" | "PROFILE" } | null;
  runnable: boolean;
  coverage: Coverage | null;
  occs: StructureOccurrence[];
  issues: Issue[];
  nextKey: (exerciseId: string | null, nameKey: string) => string;
}

export interface WorkoutPlan {
  phase: StructurePhase;
  workout: StructureWorkout;
  stimulus: Fact<string> | null;
  modalities: Fact<string[]> | null;
  pool: CatalogExercise[];
  excluded: Partial<Record<IneligibleReason, number>>;
  slots: SlotPlan[];
  summary: WorkoutSummary;
  issues: Issue[];
}

export function eligiblePool(ctx: EngineContext, modalities: Fact<string[]> | null, workout: StructureWorkout): { pool: CatalogExercise[]; excluded: Partial<Record<IneligibleReason, number>> } {
  const excluded: Partial<Record<IneligibleReason, number>> = {};
  const pool: CatalogExercise[] = [];
  if (!modalities) return { pool, excluded };
  const mods = new Set(modalities.value);
  const workoutExcluded = new Set(workout.focus.excludedExerciseIds ?? []);
  for (const e of ctx.catalog) {
    const reason = ineligibleReason(e, ctx.elig, mods, workoutExcluded);
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    else pool.push(e);
  }
  return { pool, excluded };
}

export function dosePreview(ctx: EngineContext, plan: { phase: StructurePhase; workout: StructureWorkout }, exercises: CatalogExercise[], fixedExisting: ExistingItem[]): number | null {
  const occ = occurrencesOf(plan.phase, plan.workout.label)[0];
  if (!occ) return null;
  const stim = occurrenceStimulus(ctx.input, plan.phase, plan.workout, occ.week, indexInWeek(plan.phase, occ));
  const prog = progressionFor(ctx.input, plan.phase);
  const fixedIds = new Set(fixedExisting.map((x) => x.exerciseId));
  const items = [
    ...fixedExisting.map((x) => ({ dose: x.dose, exercise: x.exerciseId ? ctx.byId.get(x.exerciseId) ?? null : null })),
    ...exercises.filter((e) => !fixedIds.has(e.id)).map((e) => ({
      exercise: e,
      dose: resolveDose(ctx.log, ctx.input.parameters, { exercise: e, stimulus: stim?.value ?? null, phaseIndex: plan.phase.index, label: plan.workout.label, week: occ.week, phaseWeeks: plan.phase.weeks, progression: prog }).dose,
    })),
  ];
  const r = occurrenceMinutes(ctx.log, items);
  return r.complete ? r.minutes : null;
}

/**
 * Primeira parte do plano de um treino: estímulo, modalidades, biblioteca elegível, linhas existentes (preservadas), travados,
 * quantidade e tempo. Não escolhe nada: a seleção (por treino ou pela fase inteira) vem depois. Os avisos saem na mesma
 * ordem da seleção antiga.
 */
export function prepareWorkout(ctx: EngineContext, phase: StructurePhase, workout: StructureWorkout, reserved: readonly ReservedSubstitution[] = []): WorkoutDraft {
  const { input } = ctx;
  const issues: Issue[] = [];
  const path = `phases.${phase.index}.workouts.${workout.label}`;
  const at = { phaseIndex: phase.index, label: workout.label, stage: "SELECTION" as const };
  const occs = occurrencesOf(phase, workout.label);
  const stimuli = occs.map((o) => occurrenceStimulus(input, phase, workout, o.week, indexInWeek(phase, o)));
  const stimulus = stimuli.find((s) => s !== null) ?? (occs.length ? null : occurrenceStimulus(input, phase, workout, 1, 1));
  if (stimuli.some((s) => s === null) || (!occs.length && !stimulus))
    issues.push({ severity: "ERROR", code: "STIMULUS_MISSING", path, ...at, suggestions: goalSuggestions(ctx),
      message: `Fase ${phase.index}, treino ${workout.label}: estímulo não definido. Escolha um (as sugestões vêm do objetivo do aluno; nada é escolhido sozinho).` });
  const codes = [...new Set(stimuli.filter((s): s is Fact<string> => s !== null).map((s) => s.value))].sort(cmp);
  const modalities = modalitiesFor(ctx, phase, workout, codes.length ? codes : stimulus ? [stimulus.value] : []);
  if (!modalities && (stimulus || codes.length))
    issues.push({ severity: "ERROR", code: "MODALITY_MISSING", path, ...at, message: `Treino ${workout.label}: o estímulo não tem modalidade padrão; diga quais modalidades este treino usa.` });
  const { pool, excluded } = eligiblePool(ctx, modalities, workout);

  // 1. linhas existentes (sempre preservadas)
  const slots: SlotPlan[] = [];
  const keyCount = new Map<string, number>();
  const nextKey = (exerciseId: string | null, nameKey: string) => {
    const ref = exerciseId ?? `custom:${nameKey}`;
    const k = keyCount.get(ref) ?? 0;
    keyCount.set(ref, k + 1);
    return slotKeyOf(phase.index, workout.label, exerciseId, nameKey, k);
  };
  const preserved = existingFor(input.existing, phase.index, workout.label);
  for (const x of preserved) {
    const exercise = x.exerciseId ? ctx.byId.get(x.exerciseId) ?? null : null;
    slots.push({
      slotKey: nextKey(x.exerciseId, nameKeyOf(x.name, x.nameKey)), exercise, existing: x, origin: "PRESERVED",
      selection: [{ code: "PRESERVED", basis: "PROFESSIONAL", detail: "Linha que já estava na revisão em rascunho: preservada como está." }], alternatives: [],
    });
  }
  // 2. travados
  const taken = new Set(slots.map((s) => s.exercise?.id).filter((id): id is string => Boolean(id)));
  for (const lock of input.locked.filter((l) => l.phaseIndex === phase.index).sort((a, b) => cmp(a.slotKey, b.slotKey))) {
    const parsed = parseSlotKey(lock.slotKey);
    if (!parsed || parsed.label !== workout.label || !parsed.exerciseId || taken.has(parsed.exerciseId)) continue;
    const e = ctx.byId.get(parsed.exerciseId);
    const reason = e ? ineligibleReason(e, ctx.elig, modalities ? new Set(modalities.value) : null, new Set(workout.focus.excludedExerciseIds ?? []), { ignoreMetadata: true }) : "ARCHIVED";
    if (!e || reason) {
      issues.push({ severity: "ERROR", code: "LOCKED_EXERCISE_INELIGIBLE", path, ...at,
        message: `Treino ${workout.label}: o exercício travado ${e?.name ?? parsed.exerciseId} não é mais elegível (${INELIGIBLE_TEXT[reason ?? "ARCHIVED"]}).`, suggestedAction: "Destravar ou substituir." });
      continue;
    }
    taken.add(e.id);
    slots.push({ slotKey: nextKey(e.id, nameKeyOf(e.name, e.nameKey)), exercise: e, existing: null, origin: "LOCKED",
      selection: [{ code: "LOCKED", basis: "PROFESSIONAL", detail: "Travado pelo profissional na proposta." }], alternatives: [] });
  }
  // 2b. trocas do profissional mantidas numa regeneração (só no microciclo): ocupam a vaga; o exercício trocado não volta
  const blocked = new Set<string>();
  for (const r of [...reserved].sort((a, b) => cmp(a.exerciseId, b.exerciseId))) {
    const e = ctx.byId.get(r.exerciseId);
    if (!e || taken.has(e.id)) continue;
    if (ineligibleReason(e, ctx.elig, modalities ? new Set(modalities.value) : null, new Set(workout.focus.excludedExerciseIds ?? []), { ignoreMetadata: true })) continue;
    taken.add(e.id);
    if (r.replaces) blocked.add(r.replaces);
    slots.push({ slotKey: nextKey(e.id, nameKeyOf(e.name, e.nameKey)), exercise: e, existing: null, origin: "ENGINE",
      selection: [{ code: "RESERVED_SUBSTITUTION", basis: "PROFESSIONAL", detail: "Troca do profissional mantida nesta regeneração: ocupa a vaga e conta no volume da semana." }], alternatives: [] });
  }
  // 3. quantidade e tempo
  const count = countFor(input, phase, workout);
  const budget = budgetFor(input, workout);
  if (count === null)
    issues.push({ severity: "ERROR", code: "EXERCISE_COUNT_MISSING", path, ...at,
      message: `Treino ${workout.label}: quantos exercícios? Informe a quantidade ou escolha "pelo tempo disponível".`,
      suggestions: [{ value: "BY_TIME", ruleId: "COUNT_FROM_TIME", label: "Pelo tempo disponível" }] });
  if (count === "BY_TIME" && !budget)
    issues.push({ severity: "ERROR", code: "COUNT_BY_TIME_NEEDS_BUDGET", path, ...at, message: `Treino ${workout.label}: quantidade pelo tempo, mas o tempo disponível não foi informado.` });
  const runnable = count !== null && !(count === "BY_TIME" && !budget) && modalities !== null;
  return {
    phase, workout, stimulus, modalities, pool, excluded, slots, preserved, taken, blocked, count, budget, runnable,
    coverage: coverageFor(ctx, phase, workout), occs, issues, nextKey,
  };
}

/** Quantos itens a seleção ainda pode escolher para o treino (a regra da seleção antiga). */
export function openSlots(draft: WorkoutDraft): number {
  if (!draft.runnable || draft.count === null) return 0;
  return draft.count === "BY_TIME" ? TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT - draft.slots.length : Math.min(draft.count.value, TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT) - draft.slots.length;
}

export function selectionRequest(ctx: EngineContext, draft: WorkoutDraft, usedInPhase: ReadonlySet<string>, usedInPreviousPhase: ReadonlySet<string>): SelectionRequest {
  const { input } = ctx;
  const { phase, workout, count } = draft;
  return {
    stimulus: draft.stimulus?.value ?? null,
    pool: draft.pool.filter((e) => !draft.taken.has(e.id) && !draft.blocked.has(e.id)),
    count: count === "BY_TIME" || count === null ? "BY_TIME" : count.value,
    estimate: (list) => dosePreview(ctx, { phase, workout }, list, draft.preserved),
    budgetMinutes: draft.budget?.minutes ?? null,
    coverage: draft.coverage,
    fixed: draft.slots.map((s) => s.exercise).filter((e): e is CatalogExercise => e !== null), fixedCount: draft.slots.length,
    preferred: new Set(input.parameters.preferredExerciseIds),
    experience: ctx.experience, history: ctx.history, usedInPhase, usedInPreviousPhase,
    avoid: new Set(), maxItems: TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT,
  };
}

/** Entradas de traço comuns a toda escolha do motor: elegibilidade e equipamento. */
export function choiceEntries(ctx: EngineContext, draft: WorkoutDraft, e: CatalogExercise): TraceEntry[] {
  const { modalities } = draft;
  const eligibilityEntry: TraceEntry = {
    code: "ELIGIBLE", basis: modalities?.basis ?? "PROFESSIONAL", ...(modalities?.ruleId ? { ruleId: modalities.ruleId } : {}),
    detail: `Elegível: modalidade ${modalities ? labelsOf(MODALITY_LABELS, modalities.value) : "—"}, sem exclusões do profissional.`,
  };
  const equipmentEntry: TraceEntry =
    ctx.input.parameters.availableEquipment === null
      ? { code: "EQUIPMENT", basis: "HEURISTIC", detail: "Equipamentos disponíveis não informados: entrou por não precisar de equipamento." }
      : !e.equipment.length
        ? { code: "EQUIPMENT", basis: "PROFESSIONAL", detail: "Não precisa de equipamento." }
        : { code: "EQUIPMENT", basis: "PROFESSIONAL", detail: "Equipamento entre os informados como disponíveis." };
  return [eligibilityEntry, equipmentEntry];
}

export interface CompleteOptions {
  /** CHECK (seleção antiga): todo alvo é conferido no treino. SKIP (microciclo): só os alvos do próprio treino (WORKOUT_FOCUS). */
  phaseTargets: "CHECK" | "SKIP";
  /** A seleção parou no limite técnico de passos: a falta de itens sai como MICROCYCLE_STEP_LIMIT, não como biblioteca insuficiente. */
  stepLimited?: boolean;
  /** Treino mantido como está numa regeneração parcial (microciclo): sem avisos de quantidade nem de cobertura. */
  fixed?: boolean;
}

/** Segunda parte: escolhas no lugar, avisos de quantidade e cobertura, alternativas e resumo do treino. */
export function completeWorkout(ctx: EngineContext, draft: WorkoutDraft, chosenSlots: Array<{ exercise: CatalogExercise; selection: TraceEntry[] }>, options: CompleteOptions): WorkoutPlan {
  const { input, log } = ctx;
  const { phase, workout, pool, excluded, count, runnable, modalities, occs, coverage } = draft;
  const issues = [...draft.issues];
  const slots = [...draft.slots];
  const path = `phases.${phase.index}.workouts.${workout.label}`;
  const at = { phaseIndex: phase.index, label: workout.label, stage: "SELECTION" as const };
  let countFact: Fact<number> | null = count === "BY_TIME" ? null : count;
  for (const c of chosenSlots)
    slots.push({ slotKey: draft.nextKey(c.exercise.id, nameKeyOf(c.exercise.name, c.exercise.nameKey)), exercise: c.exercise, existing: null, origin: "ENGINE", selection: c.selection, alternatives: [] });
  if (count === "BY_TIME" && runnable) {
    log.get("COUNT_FROM_TIME");
    countFact = { value: slots.length, source: "PROFESSIONAL", basis: "HEURISTIC_ACCEPTED", ruleId: "COUNT_FROM_TIME" };
  }
  if (!options.fixed) {
    if (runnable && count !== "BY_TIME" && count !== null) {
      const needed = Math.min(count.value, TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT);
      if (slots.length > count.value)
        issues.push({ severity: "WARNING", code: "EXISTING_EXCEEDS_TARGET", path, ...at, message: `Treino ${workout.label}: ${slots.length} linhas já existentes ou travadas para uma quantidade de ${count.value}; nada foi removido.` });
      else if (slots.length < needed && options.stepLimited)
        issues.push({ severity: "WARNING", code: "MICROCYCLE_STEP_LIMIT", path, ...at,
          message: `Treino ${workout.label}: a seleção parou no limite técnico de passos com ${needed - slots.length} vaga(s) aberta(s).`,
          suggestedAction: "Gerar a fase de novo em partes (por treino) ou reduzir a quantidade. Nada é inventado." });
      else if (slots.length < needed) {
        const reasons = Object.entries(excluded).map(([r, n]) => `${n} ${INELIGIBLE_TEXT[r as IneligibleReason]}`).join("; ");
        issues.push({ severity: "ERROR", code: "CATALOG_INSUFFICIENT", path, ...at,
          message: `Treino ${workout.label}: pedidos ${count.value} exercícios, ${slots.length} possíveis. Fora da seleção: ${reasons || "nenhum exercício na biblioteca"}.`,
          suggestedAction: "Completar metadados na biblioteca, rever equipamentos e exclusões ou reduzir a quantidade. Nada é inventado." });
      }
      if (count.value > TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT)
        issues.push({ severity: "ERROR", code: "WORKOUT_OVER_TECHNICAL_LIMIT", path, ...at, message: `Treino ${workout.label}: ${count.value} exercícios; o limite técnico por treino é ${TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT}.` });
    }
    if (count === "BY_TIME" && runnable && !chosenSlots.length && !slots.length)
      issues.push({ severity: "ERROR", code: "CATALOG_INSUFFICIENT", path, ...at, message: `Treino ${workout.label}: nenhum exercício elegível para preencher pelo tempo.` });
  }
  // cobertura
  const chosen = slots.map((s) => s.exercise).filter((e): e is CatalogExercise => e !== null);
  // Só `weeklySets` (sem músculos nem padrões) não orienta a seleção: o aviso NO_TARGETS continua.
  if (coverage && (coverage.muscles.length || coverage.patterns.length)) {
    // Na seleção por microciclo, o alvo da fase é conferido uma vez na fase (planPhaseMicrocycle), não em cada treino.
    if (!options.fixed && (options.phaseTargets === "CHECK" || coverage.origin === "WORKOUT_FOCUS")) {
      for (const m of coverage.muscles)
        if (!chosen.some((e) => e.primaryMuscles.some((x) => codeOf(x) === codeOf(m))))
          issues.push({ severity: "WARNING", code: "MUSCLE_NOT_COVERED", path, ...at, message: `Treino ${workout.label}: ${MUSCLE_LABELS[codeOf(m)] ?? m} sem exercício como músculo principal.` });
      for (const p of coverage.patterns)
        if (!chosen.some((e) => e.patterns.map(codeOf).includes(codeOf(p))))
          issues.push({ severity: "WARNING", code: "PATTERN_NOT_COVERED", path, ...at, message: `Treino ${workout.label}: padrão ${PATTERN_LABELS[codeOf(p)] ?? p} sem exercício.` });
    }
  } else if (occs.length && runnable && !options.fixed) {
    issues.push(noTargetsIssue(ctx, draft));
  }
  // alternativas
  const limit = log.get("ALTERNATIVES_LIMIT");
  const inWorkout = new Set(chosen.map((e) => e.id));
  for (const s of slots) {
    if (!s.exercise) continue;
    s.alternatives = rankAlternatives(log, s.exercise, metricFor(s.exercise, input.parameters).metric, pool, inWorkout, limit).map((a) => a.exerciseId);
  }
  const summary: WorkoutSummary = {
    phaseIndex: phase.index, label: workout.label, name: workout.name, stimulus: draft.stimulus, modalities, count: countFact,
    coverage: coverage ? { ...coverage } : null, eligible: pool.length, excluded: { ...excluded },
  };
  return { phase, workout, stimulus: draft.stimulus, modalities, pool, excluded, slots, summary, issues };
}

/**
 * Treino sem alvos: com a regra de alvos sugeridos (2026.11.4+), o aviso traz a sugestão da fase (aceite do profissional);
 * sem ela, os padrões de DEFAULT_COVERAGE, como antes.
 */
function noTargetsIssue(ctx: EngineContext, draft: WorkoutDraft): Issue {
  const { log } = ctx;
  const { phase, workout, modalities } = draft;
  const path = `phases.${phase.index}.workouts.${workout.label}`;
  const at = { phaseIndex: phase.index, label: workout.label, stage: "SELECTION" as const };
  const message = `Treino ${workout.label}: sem músculos ou padrões-alvo; a seleção seguiu a elegibilidade e a variação entre treinos.`;
  if (log.optional("MICROCYCLE_TARGET_SUGGESTIONS")) {
    // Treino sem modalidade de volume (cardio, mobilidade) numa fase de hipertrofia: os alvos sugeridos são de volume e não
    // valem para ele; o aviso fica sem sugestão.
    const vol = new Set(log.get("VOLUME_MODALITIES").map(codeOf));
    if (!modalities?.value.some((m) => vol.has(codeOf(m)))) return { severity: "WARNING", code: "NO_TARGETS", path, ...at, message, suggestions: [] };
    const s = targetSuggestion(log, phase, ctx.input);
    if (!s.suggestion)
      return { severity: "WARNING", code: "NO_TARGETS", path, ...at,
        message: `${message}${s.reason === "MIXED_STIMULI" ? " Os estímulos variam nesta fase; defina os alvos manualmente." : ""}`, suggestions: [] };
    return { severity: "WARNING", code: "NO_TARGETS", path, ...at, message,
      suggestions: [{ value: s.suggestion.stimulus, ruleId: "MICROCYCLE_TARGET_SUGGESTIONS", label: `Alvos sugeridos para ${STIMULUS_LABELS[s.suggestion.stimulus] ?? s.suggestion.stimulus} (heurística operacional, editável)` }] };
  }
  const def = log.get("DEFAULT_COVERAGE");
  const patterns = [...new Set((modalities?.value ?? []).flatMap((m) => def[m] ?? []))];
  return { severity: "WARNING", code: "NO_TARGETS", path, ...at, message,
    suggestions: patterns.map((p) => ({ value: p, ruleId: "DEFAULT_COVERAGE", label: PATTERN_LABELS[p] ?? p })) };
}

/** Seleção antiga: um treino de cada vez (preparar → escolher → completar). */
export function planWorkout(ctx: EngineContext, phase: StructurePhase, workout: StructureWorkout, usedInPhase: ReadonlySet<string>, usedInPreviousPhase: ReadonlySet<string>): WorkoutPlan {
  const draft = prepareWorkout(ctx, phase, workout);
  return completeWorkout(ctx, draft, legacyPicks(ctx, draft, usedInPhase, usedInPreviousPhase), { phaseTargets: "CHECK" });
}

/** A seleção gulosa por treino (antiga), com o traço de cada escolha. */
export function legacyPicks(ctx: EngineContext, draft: WorkoutDraft, usedInPhase: ReadonlySet<string>, usedInPreviousPhase: ReadonlySet<string>): Array<{ exercise: CatalogExercise; selection: TraceEntry[] }> {
  const { log } = ctx;
  const picks = draft.runnable ? selectExercises(log, selectionRequest(ctx, draft, usedInPhase, usedInPreviousPhase)) : [];
  return picks.map((p, rank) => ({
    exercise: p.exercise,
    selection: [...choiceEntries(ctx, draft, p.exercise), ...p.trace, { code: "RANK", basis: log.basis("SELECTION_WEIGHTS"), ruleId: "SELECTION_WEIGHTS", detail: `Escolha ${rank + 1} pela pontuação ${numberText(p.score)}${p.tie ? "; empate desfeito pelo código do exercício" : ""}.` }],
  }));
}

// ---------- itens de uma ocorrência ----------

export function itemFor(ctx: EngineContext, plan: { phase: StructurePhase; workout: StructureWorkout }, slot: SlotPlan, position: number, occ: StructureOccurrence, stimulus: Fact<string> | null, issues: Issue[]): ItemOut {
  const base = {
    slotKey: slot.slotKey, position, exerciseId: slot.exercise?.id ?? slot.existing?.exerciseId ?? null,
    exerciseName: slot.existing?.name ?? slot.exercise?.name ?? "", modality: slot.exercise?.modality ?? null,
    origin: slot.origin, existingPrescribedExerciseId: slot.existing?.prescribedExerciseId ?? null, substitutesSlotKey: null,
    alternatives: slot.alternatives, metadata: metadataOf(slot.exercise),
  };
  if (slot.existing)
    return { ...base, dose: slot.existing.dose, display: slot.existing.display, trace: { selection: slot.selection, params: [] } };
  const exercise = slot.exercise as CatalogExercise;
  const r = resolveDose(ctx.log, ctx.input.parameters, {
    exercise, stimulus: stimulus?.value ?? null, phaseIndex: plan.phase.index, label: plan.workout.label,
    week: occ.week, phaseWeeks: plan.phase.weeks, progression: progressionFor(ctx.input, plan.phase),
  });
  for (const i of r.issues)
    issues.push({ ...i, path: `phases.${plan.phase.index}.workouts.${plan.workout.label}`, phaseIndex: plan.phase.index, label: plan.workout.label, stage: "SELECTION" });
  const stimTrace: ParamTrace[] = stimulus ? [{ param: "stimulus", value: stimulus.value, basis: stimulus.basis, ...(stimulus.ruleId ? { ruleId: stimulus.ruleId } : {}) }] : [];
  return { ...base, dose: r.dose, display: toDisplayFields(r.dose), trace: { selection: slot.selection, params: [...stimTrace, ...r.params] } };
}

export function occurrenceFor(ctx: EngineContext, plan: WorkoutPlan, occ: StructureOccurrence, issues: Issue[]): OccurrenceOut {
  const stimulus = occurrenceStimulus(ctx.input, plan.phase, plan.workout, occ.week, indexInWeek(plan.phase, occ));
  return {
    phaseIndex: plan.phase.index, week: occ.week, slot: occ.slot, label: occ.label, plannedDate: occ.plannedDate, weekStart: occ.weekStart,
    stimulus, items: plan.slots.map((s, i) => itemFor(ctx, plan, s, i + 1, occ, stimulus, issues)),
    estimatedMinutes: null, durationComplete: false, budgetMinutes: null, budgetSource: null,
  };
}

/** Planos de todos os treinos, fase a fase (a fase anterior influencia a variação da seguinte). Seleção antiga. */
export function planAll(ctx: EngineContext): Map<number, WorkoutPlan[]> {
  const plans = new Map<number, WorkoutPlan[]>();
  let previous = new Set<string>();
  for (const phase of ctx.input.structure.phases) {
    const usedInPhase = new Set<string>();
    const list: WorkoutPlan[] = [];
    for (const workout of phase.workouts) {
      const plan = planWorkout(ctx, phase, workout, usedInPhase, previous);
      for (const s of plan.slots) if (s.exercise) usedInPhase.add(s.exercise.id);
      list.push(plan);
    }
    plans.set(phase.index, list);
    previous = usedInPhase;
  }
  return plans;
}

/**
 * Com MICROCYCLE_SELECTION (2026.11.4+): só as fases do escopo são planejadas, cada uma inteira de uma vez. A variação da
 * fase seguinte usa a fase anterior desta chamada ou, se ela não foi planejada agora, a fase gravada
 * (`options.previousPhaseExercises`, com as trocas do profissional). Sem a regra: a seleção antiga (todas as fases).
 */
export function planPhases(ctx: EngineContext, options: GenerateOptions = {}): { plans: Map<number, WorkoutPlan[]>; phaseIssues: Map<number, Issue[]> } {
  const phaseIssues = new Map<number, Issue[]>();
  if (!ctx.log.optional("MICROCYCLE_SELECTION")) return { plans: planAll(ctx), phaseIssues };
  const plans = new Map<number, WorkoutPlan[]>();
  let previous: { index: number; ids: Set<string> } | null = null;
  let predecessor: number | null = null;
  for (const phase of ctx.input.structure.phases) {
    const pred = predecessor;
    predecessor = phase.index;
    if (!inScope(ctx.input, phase.index)) continue;
    const used = previous && previous.index === pred ? previous.ids : new Set(pred === null ? [] : options.previousPhaseExercises?.get(pred) ?? []);
    const planned = planPhaseMicrocycle(ctx, phase, used, options);
    plans.set(phase.index, planned.plans);
    phaseIssues.set(phase.index, planned.issues);
    const ids = new Set<string>();
    for (const p of planned.plans) for (const sl of p.slots) if (sl.exercise) ids.add(sl.exercise.id);
    // Um treino mantido (regeneração parcial) não tem escolhas aqui: os exercícios gravados dele contam.
    for (const [key, f] of options.fixedWorkouts ?? []) if (key.startsWith(`${phase.index}|`)) for (const id of Object.keys(f.exercises)) ids.add(id);
    previous = { index: phase.index, ids };
  }
  return { plans, phaseIssues };
}

function inScope(input: EngineInput, phaseIndex: number): boolean {
  return input.scope.kind === "FULL" || input.scope.phaseIndexes.includes(phaseIndex);
}

function assumptionsFor(ctx: EngineContext): Assumption[] {
  const { input, log } = ctx;
  const out: Assumption[] = [
    { code: "DEFAULTS_NOT_UNIVERSAL", text: "Os valores padrão desta ferramenta não são recomendação universal.", basis: "HEURISTIC" },
    { code: "NO_LOAD_KG", text: "O motor não propõe quilos: a carga é escolhida na execução pelo esforço indicado.", basis: "HEURISTIC", ruleId: "LOAD_INSTRUCTION_DEFAULT" },
  ];
  if (input.parameters.doseMode === "FILL_FROM_POLICY")
    out.push({ code: "DOSE_FROM_POLICY", text: "Doses preenchidas pela política de doses (heurística operacional editável); revise cada uma.", basis: log.basis("DOSE_DEFAULTS"), ruleId: "DOSE_DEFAULTS" });
  else out.push({ code: "DOSE_LEFT_EMPTY", text: "Doses deixadas vazias a pedido do profissional.", basis: "PROFESSIONAL" });
  if (input.parameters.metadataTrust === "REVIEWED_AND_INFERRED")
    out.push({ code: "INFERRED_METADATA_USED", text: "A seleção usa metadados revisados e inferidos; os inferidos aparecem como \"Inferido (não revisado)\".", basis: "PROFESSIONAL" });
  if (!ctx.experience)
    out.push({ code: "EXPERIENCE_UNKNOWN", text: "Nível de experiência não informado ou não reconhecido: a dificuldade pesa como para não iniciantes.", basis: "HEURISTIC", ruleId: "EXPERIENCE_MAP" });
  if (!input.history.length)
    out.push({ code: "NO_HISTORY", text: "Sem histórico de execução: nenhuma progressão por histórico foi sugerida.", basis: "STUDENT_DATA" });
  if (input.structure.phases.some((p) => p.occurrences.some((o) => o.plannedDate === null)))
    out.push({ code: "DATES_NOT_PLANNED", text: "Sem dias de treino na estrutura: as sessões não têm data prevista.", basis: "PROFESSIONAL" });
  if (input.parameters.availableEquipment === null)
    out.push({ code: "EQUIPMENT_NOT_INFORMED", text: "Equipamentos não informados: só exercícios sem equipamento foram considerados.", basis: "PROFESSIONAL" });
  if (!input.parameters.availableMinutes && !input.student.sessionMinutes)
    out.push({ code: "BUDGET_UNKNOWN", text: "Tempo por sessão não informado: a duração é estimada, sem comparar com a disponibilidade.", basis: "PROFESSIONAL" });
  return out;
}

export function phaseSummaries(input: EngineInput): PhaseSummary[] {
  return input.structure.phases.map((p) => ({ phaseIndex: p.index, name: p.name, weeks: p.weeks, sessionsPerWeek: p.sessionsPerWeek, progression: progressionFor(input, p) }));
}

/** Gera a proposta. Nunca lança: problemas viram avisos; INFEASIBLE devolve o rascunho completo. */
export function generate(input: EngineInput, options: GenerateOptions = {}): EngineResult {
  const ctx = prepare(input);
  if (!ctx) return unknownRules(input);
  const issues: Issue[] = validateInput(input);
  if (input.parameters.availableEquipment === null)
    issues.push({ severity: "WARNING", code: "EQUIPMENT_UNKNOWN", path: "parameters.availableEquipment", stage: "INPUT", message: "Equipamentos disponíveis não informados: só exercícios sem equipamento entram. Informe os equipamentos para ampliar." });
  const { plans, phaseIssues } = planPhases(ctx, options);
  const occurrences: OccurrenceOut[] = [];
  const workouts: WorkoutSummary[] = [];
  for (const phase of input.structure.phases) {
    const list = plans.get(phase.index) ?? [];
    workouts.push(...list.map((p) => p.summary));
    if (!inScope(input, phase.index)) continue;
    const byLabel = new Map(list.map((p) => [p.workout.label, p]));
    for (const p of list) issues.push(...p.issues);
    issues.push(...(phaseIssues.get(phase.index) ?? []));
    for (const occ of occurrencesOf(phase)) {
      const plan = byLabel.get(occ.label);
      if (plan) occurrences.push(occurrenceFor(ctx, plan, occ, issues));
    }
  }
  const result: EngineResult = {
    engineVersion: ENGINE_VERSION, rules: input.rules, vocabularyVersion: VOCABULARY_VERSION,
    status: "SUCCEEDED", validation: "PASSED", requiresProfessionalReview: true,
    phases: phaseSummaries(input), workouts, occurrences, issues: uniqueIssues(issues), assumptions: assumptionsFor(ctx),
    flags: [], volume: [], historySuggestions: [], rulesUsed: [],
  };
  return finalize(ctx, result);
}

// ---------- revalidação ----------

function existingSlotKeys(ctx: EngineContext): Set<string> {
  const out = new Set<string>();
  for (const phase of ctx.input.structure.phases)
    for (const w of phase.workouts) {
      const counts = new Map<string, number>();
      for (const x of existingFor(ctx.input.existing, phase.index, w.label)) {
        const ref = x.exerciseId ?? `custom:${nameKeyOf(x.name, x.nameKey)}`;
        const k = counts.get(ref) ?? 0;
        counts.set(ref, k + 1);
        out.add(slotKeyOf(phase.index, w.label, x.exerciseId, nameKeyOf(x.name, x.nameKey), k));
      }
    }
  return out;
}

function historySuggestions(ctx: EngineContext, occurrences: OccurrenceOut[]): HistorySuggestion[] {
  if (!ctx.input.history.length) return [];
  const H = ctx.log.get("PROGRESSION_HISTORY");
  const window = ctx.log.get("EXPOSURE_WINDOW_DAYS");
  const seen = new Set<string>();
  const out: HistorySuggestion[] = [];
  for (const o of occurrences)
    for (const item of o.items) {
      const key = `${o.phaseIndex}|${item.slotKey}`;
      if (seen.has(key) || !item.exerciseId || !item.dose || item.origin === "PRESERVED" || !ctx.history.has(item.exerciseId)) continue;
      seen.add(key);
      const exercise = ctx.byId.get(item.exerciseId);
      if (!exercise) continue;
      out.push({
        phaseIndex: o.phaseIndex, slotKey: item.slotKey, exerciseId: item.exerciseId,
        proposal: proposeProgression(ctx.input.history, exercise, item.dose, { consecutiveSuccesses: H.consecutiveSuccesses, maximumIncrementFraction: H.maximumIncrementFraction, incrementKg: null, windowDays: window }, ctx.input.asOf),
      });
    }
  return out;
}

/**
 * Contribuição do item no volume da semana (regras com auditoria): só números do próprio item (séries × sessões do treino na
 * semana), para que uma mudança em outro treino não reescreva este item. Os totais da semana ficam na leitura (view).
 */
function weeklyContribution(ctx: EngineContext, o: OccurrenceOut, item: ItemOut): TraceEntry | null {
  const { log } = ctx;
  const e = item.exerciseId ? ctx.byId.get(item.exerciseId) : undefined;
  const modalities = new Set(log.get("VOLUME_MODALITIES").map(codeOf));
  if (!e?.modality || !modalities.has(codeOf(e.modality))) return null;
  const direct = [...new Set(e.primaryMuscles.map(codeOf))];
  const indirect = [...new Set(e.secondaryMuscles.map(codeOf))].filter((m) => !direct.includes(m));
  if (!direct.length && !indirect.length) return null;
  const phase = ctx.input.structure.phases.find((p) => p.index === o.phaseIndex);
  const sessions = phase ? phase.occurrences.filter((x) => x.week === o.week && x.label === o.label).length : 0;
  const sets = item.dose && (item.dose.metric === "REPS" || item.dose.metric === "TIME" || item.dose.metric === "DISTANCE") ? item.dose.sets : null;
  const factor = log.get("INDIRECT_VOLUME_FACTOR");
  if (sets === null)
    return log.entry("INDIRECT_VOLUME_FACTOR", "WEEKLY_CONTRIBUTION", `Semana ${o.week}: séries não definidas; contribuição no volume não calculada.`);
  const total = sets * sessions;
  const parts = [
    direct.length ? `${numberText(total)} séries diretas de ${labelsOf(MUSCLE_LABELS, direct)}` : null,
    indirect.length ? `${numberText(total)} indiretas de ${labelsOf(MUSCLE_LABELS, indirect)} (peso ${numberText(factor)})` : null,
  ].filter(Boolean);
  return log.entry("INDIRECT_VOLUME_FACTOR", "WEEKLY_CONTRIBUTION",
    `Semana ${o.week}: ${sessions} ${sessions === 1 ? "sessão" : "sessões"} do treino ${o.label} × ${numberText(sets)} séries = ${parts.join("; ")}.`);
}

/** Recalcula duração, avisos de validação, volume, alertas e estado sobre um resultado inteiro. */
export function finalize(ctx: EngineContext, result: EngineResult): EngineResult {
  const { input, log } = ctx;
  const issues: Issue[] = result.issues.filter((i) => i.stage !== "VALIDATION");
  const replaced = existingSlotKeys(ctx);
  const workoutOf = (phaseIndex: number, label: string) => input.structure.phases.find((p) => p.index === phaseIndex)?.workouts.find((w) => w.label === label);
  const audited = log.optional("AUDIT_THRESHOLDS") !== undefined;
  const observations = assessmentObservations(log, input);
  const observationOf = (item: ItemOut): TraceEntry[] => {
    const e = item.exerciseId ? ctx.byId.get(item.exerciseId) : undefined;
    if (!e || !observations.length) return [];
    const patterns = new Set(e.patterns.map(codeOf));
    return observations.filter((x) => x.patterns.some((p) => patterns.has(p))).map((x) => log.entry("FINDING_OBSERVATION_MAP", "ASSESSMENT_OBSERVATION",
      `${x.label}: nível ${numberText(x.level)} (mediana das leituras do aluno: ${numberText(x.median)}); ${x.text}${x.ref ? ` (avaliação ${x.ref})` : ""}. Não é contraindicação; não mudou a escolha.`))
      .map((t) => ({ ...t, basis: "STUDENT_DATA" as const }));
  };
  const derived = audited || log.optional("FINDING_OBSERVATION_MAP") !== undefined;
  const occurrences = result.occurrences.map((o) => {
    const path = `occurrences.${o.phaseIndex}.${o.week}.${o.slot}`;
    const at = { phaseIndex: o.phaseIndex, label: o.label, stage: "VALIDATION" as const };
    const items = o.items.map((item) => {
      const next = item.origin === "PRESERVED" ? item : { ...item, display: toDisplayFields(item.dose) };
      if (!derived) return next;
      // derivados: recalculados a cada operação (os anteriores saem), depois das entradas da seleção
      const contribution = audited ? weeklyContribution(ctx, o, next) : null;
      const selection = next.trace.selection.filter((t) => t.code !== "WEEKLY_CONTRIBUTION" && t.code !== "ASSESSMENT_OBSERVATION");
      return { ...next, trace: { ...next.trace, selection: [...selection, ...(contribution ? [contribution] : []), ...observationOf(next)] } };
    });
    const ids = new Set<string>();
    for (const item of items) {
      if (item.dose) for (const i of validateDose(item.dose)) issues.push({ ...i, path: `${path}.${item.slotKey}`, ...at, message: `${item.exerciseName}: ${i.message}.` });
      if (item.exerciseId) {
        if (ids.has(item.exerciseId)) issues.push({ severity: "ERROR", code: "DUPLICATE_EXERCISE", path, ...at, message: `Semana ${o.week}, sessão ${o.slot}: ${item.exerciseName} aparece duas vezes.` });
        ids.add(item.exerciseId);
      }
      if (item.substitutesSlotKey && replaced.has(item.substitutesSlotKey))
        issues.push({ severity: "WARNING", code: "EXISTING_ROW_REPLACED", path: `${path}.${item.slotKey}`, ...at, message: `${item.exerciseName} substitui uma linha que já estava na revisão; aplicar exige confirmação.` });
    }
    if (items.length > TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT)
      issues.push({ severity: "ERROR", code: "WORKOUT_OVER_TECHNICAL_LIMIT", path, ...at, message: `Sessão com ${items.length} exercícios; limite técnico ${TECHNICAL_LIMITS.MAX_ITEMS_PER_WORKOUT}.` });
    if (!items.length)
      issues.push({ severity: "WARNING", code: "OCCURRENCE_EMPTY", path: `phases.${o.phaseIndex}.workouts.${o.label}`, ...at, message: `Treino ${o.label} da fase ${o.phaseIndex}: sessões sem exercícios.` });
    const d = occurrenceMinutes(log, items.map((i) => ({ dose: i.dose, exercise: i.exerciseId ? ctx.byId.get(i.exerciseId) ?? null : null })));
    const budget = budgetFor(input, workoutOf(o.phaseIndex, o.label));
    if (items.length && !d.complete)
      issues.push({ severity: "WARNING", code: "DURATION_UNKNOWN", path: `phases.${o.phaseIndex}.workouts.${o.label}`, ...at,
        message: `Treino ${o.label} da fase ${o.phaseIndex}: duração parcial (dose vazia, descanso não informado ou distância sem ritmo).` });
    if (budget && d.minutes !== null && d.minutes > budget.minutes) {
      const hard = input.parameters.timeBudget === "HARD";
      issues.push({ severity: hard ? "ERROR" : "WARNING", code: "OVER_TIME_BUDGET", path, ...at,
        message: `Semana ${o.week}, sessão ${o.slot} (treino ${o.label}): ≈ ${d.minutes} min${d.complete ? "" : " (parcial)"} de ${budget.minutes} min disponíveis.`,
        suggestedAction: "Rever quantidade, séries ou descansos. O motor não troca exercícios nem corta descansos para caber." });
    }
    return { ...o, items, estimatedMinutes: d.minutes, durationComplete: d.complete, budgetMinutes: budget?.minutes ?? null, budgetSource: budget?.source ?? null };
  });
  const all = uniqueIssues(issues);
  const errors = all.some((i) => i.severity === "ERROR");
  const warnings = all.some((i) => i.severity === "WARNING");
  const volume = volumeFor(log, occurrences, ctx.byId);
  // A auditoria (regras 2026.11.3+) é recalculada aqui em toda operação: nenhum achado antigo sobrevive.
  const audit = log.optional("AUDIT_THRESHOLDS")
    ? boundAudit(log, auditPlan({ log, phases: result.phases, structure: input.structure.phases, workouts: result.workouts, occurrences, volume, byId: ctx.byId }))
    : undefined;
  const rest: EngineResult = { ...result };
  delete rest.audit;
  const next: EngineResult = {
    ...rest,
    occurrences,
    issues: all,
    flags: buildFlags(log, input),
    volume,
    historySuggestions: historySuggestions(ctx, occurrences),
    status: errors ? "INFEASIBLE" : "SUCCEEDED",
    validation: errors ? "BLOCKED" : warnings ? "WARNINGS" : "PASSED",
    requiresProfessionalReview: true,
    ...(audit ? { audit } : {}),
  };
  next.rulesUsed = log.rulesUsed(result.rulesUsed);
  const bounded = applyBounds(next);
  const finalErrors = bounded.issues.some((i) => i.severity === "ERROR");
  return { ...bounded, status: finalErrors ? "INFEASIBLE" : "SUCCEEDED", validation: finalErrors ? "BLOCKED" : bounded.issues.some((i) => i.severity === "WARNING") ? "WARNINGS" : "PASSED" };
}

export function revalidate(input: EngineInput, result: EngineResult): EngineResult {
  const ctx = prepare(input);
  if (!ctx) return unknownRules(input);
  return finalize(ctx, result);
}

/** Unidades de trabalho (ocorrências × catálogo), para o chamador dividir a geração por fases. */
export function workUnits(input: EngineInput): number {
  return input.structure.phases.filter((p) => inScope(input, p.index)).reduce((a, p) => a + p.occurrences.length, 0) * Math.max(1, input.catalog.length);
}
