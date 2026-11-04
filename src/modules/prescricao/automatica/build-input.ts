/**
 * The input adapter's building half (motor S5, design §2 and §2.3): from the context read on the server and the professional's
 * answers, the engine input, the questions still open, the assumptions used and the references for the ledger. Pure and
 * deterministic: same context and answers, same output.
 *
 * Nothing missing is invented: a phase without a stimulus, a workout without a target, the equipment available, a stimulus
 * without a default modality all become questions (`required` ones block generation). What the engine will do without an
 * optional fact is written as an assumption.
 */
import { DEFAULT_RULESET, getRuleSet } from "@/modules/prescricao/motor/rules";
import { codeOf, normalizeText, STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";
import type {
  Assumption,
  EngineInput,
  GenerationParameters,
  Issue,
  ItemTarget,
  RuleSetRef,
  Suggestion,
} from "@/modules/prescricao/motor/types";
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

export interface BuildOptions {
  scope?: EngineInput["scope"];
  locked?: ItemTarget[];
  rules?: RuleSetRef;
}

export function buildEngineInput(ctx: GenerationContext, answers: GenerationAnswers, options: BuildOptions = {}): BuildOutcome {
  const rules = options.rules ?? DEFAULT_RULESET;
  const ruleSet = getRuleSet(rules);
  if (!ruleSet) throw new Error("RULESET_UNKNOWN");
  const structure = structureFacts(ctx.revision.schedule);

  // 1. Every exercise id and every target in the answers must exist: the visible library, the saved structure.
  const catalogIds = new Set(ctx.catalog.map((e) => e.id));
  const unknown = [...new Set(answerExerciseIds(answers).filter((id) => !catalogIds.has(id)))].sort(cmp);
  if (unknown.length) return { ok: false, code: "UNKNOWN_EXERCISE", exerciseIds: unknown };
  const phases = new Map(structure.phases.map((p) => [p.index, new Set(p.workouts.map((w) => w.label))]));
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
  answers.policyOverrides.forEach((o) => {
    if (o.phaseIndex !== undefined && o.label !== undefined) checkWorkout(o.phaseIndex, o.label);
    else if (o.phaseIndex !== undefined) checkPhase(o.phaseIndex);
  });
  if (options.scope?.kind === "PHASES") options.scope.phaseIndexes.forEach(checkPhase);
  if (badTargets.length) return { ok: false, code: "UNKNOWN_TARGET", targets: badTargets };

  // 1b. "Sugestão aceita" only for what a rule of this rule set actually suggests: the stimulus chips come from the student's goal
  // (GOAL_STIMULUS_HINTS); the coverage chips are patterns of DEFAULT_COVERAGE (any modality: which modality a workout ends up with is
  // the engine's to resolve) and never muscles. Anything else the professional chose is PROFESSIONAL.
  const goalChips = new Set(goalSuggestions(studentFacts(ctx.profile, ctx.assessment).goal?.value ?? null, rules).map((s) => s.value));
  const coverageChips = new Set(Object.values(ruleSet.rules.DEFAULT_COVERAGE.value).flat());
  const unsupported: Array<{ field: "stimulusByPhase" | "phaseCoverage"; phaseIndex: number }> = [];
  for (const s of answers.stimulusByPhase)
    if (s.basis === "HEURISTIC_ACCEPTED" && (s.ruleId !== "GOAL_STIMULUS_HINTS" || !goalChips.has(s.value)))
      unsupported.push({ field: "stimulusByPhase", phaseIndex: s.phaseIndex });
  for (const c of answers.phaseCoverage)
    if (
      c.basis === "HEURISTIC_ACCEPTED" &&
      (c.ruleId !== "DEFAULT_COVERAGE" || Boolean(c.muscles?.length) || !c.patterns?.length || c.patterns.some((p) => !coverageChips.has(p)))
    )
      unsupported.push({ field: "phaseCoverage", phaseIndex: c.phaseIndex });
  if (unsupported.length) return { ok: false, code: "UNSUPPORTED_SUGGESTION", targets: unsupported };

  // 2. The engine's parameters: only what the professional answered, plus the two defaults decided on 04/11/2026.
  const parameters: GenerationParameters = {
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
      ...(c.muscles ? { muscles: c.muscles } : {}), ...(c.patterns ? { patterns: c.patterns } : {}), ...(c.ruleId ? { ruleId: c.ruleId } : {}),
    })),
    progressionByPhase: answers.progressionByPhase,
    doseOverrides: answers.policyOverrides,
    metricOverrides: answers.metricOverrides,
    acceptedFlagDecisions: answers.acceptedFlagDecisions,
  };
  const student = studentFacts(ctx.profile, ctx.assessment);
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
  assumptions.push({ code: "CHECKINS_NOT_USED", text: "Check-ins do aluno ficam de fora da geração (decidido em 04/11/2026, Q6).", basis: "PROFESSIONAL" });

  // 5. Facts in the records worth a look (never blocking).
  const issues: Issue[] = [];
  const days = p?.daysPerWeek ?? null;
  if (days !== null)
    for (const phase of structure.phases)
      if (phase.sessionsPerWeek > days)
        issues.push({
          severity: "WARNING", code: "AVAILABILITY_BELOW_SESSIONS", stage: "INPUT", path: `phases.${phase.index}`, phaseIndex: phase.index,
          message: `A ficha diz ${days} dia(s) por semana; a fase ${phase.index} tem ${phase.sessionsPerWeek} sessões por semana.`,
        });

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
