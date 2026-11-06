/**
 * What the generation FLOW shows (Figma GEN-01..04 and M-01), as pure functions: the step in the address, the four context cards, the mode
 * picker with every honest state of the AI gate, the strategy cards, the focus per phase and its editable draft, the week-type preview, the
 * footer of each step and the banner of each planning failure. No React, no database and no network here, so every rule is tested directly.
 *
 * Nothing is invented: titles and names come from fixed pt-BR tables or from the stored structure and facts; a model's text appears only
 * where the screen says so (the explanation of a strategy, plain text). Nothing here accepts, applies, approves or delivers anything: the
 * professional's choice becomes an `AcceptPayload` only through `acceptanceInput`, and the server checks it again.
 */
import { MUSCLE_LABELS, PATTERN_LABELS } from "@/modules/prescricao/motor/vocabulary";
import { cmp } from "@/modules/prescricao/motor/vocabulary";
import { deriveDelta, deltaSize, expandFocus, type ExpandedFocus } from "@/modules/prescricao/planejador/focus";
import type { PlanFailure, PlanningOutcome } from "@/modules/prescricao/planejador/orchestration";
import type { RoleFocusTable } from "@/modules/prescricao/planejador/role-focus";
import type { StrategyListView, StrategyView } from "@/modules/prescricao/planejador/strategy-view";
import { FOCUS_DELTA_MAX_ITEMS } from "@/modules/prescricao/planejador/versions";
import { isNonVolumeRole, SPLIT_DISPLAY_NAME, WORKOUT_ROLES, type FocusSource, type SplitFamily, type WorkoutRole } from "@/modules/prescricao/planejador/vocab";
import type { AcceptanceView, AcceptPayload } from "@/modules/prescricao/planejador/accept";
import type { PlanningAvailability } from "@/modules/prescricao/planejador/actions";
import { phaseSpans, weeksText } from "./generation-view";
import type { ProposalActionResult } from "./actions";
import type { ConsideredFact, GenerationScreen, GenerationSummary, ProposalOutcome } from "./service";

// ---------- the step in the address ----------

export type FlowStep = "contexto" | "estrategia" | "focos" | "previa";
export const FLOW_STEPS: readonly FlowStep[] = ["contexto", "estrategia", "focos", "previa"];
/** `?etapa=`: anything else is the first step (a stale or forged value never breaks the page). */
export function parseStep(value: string | null | undefined): FlowStep {
  return FLOW_STEPS.find((s) => s === value) ?? "contexto";
}
/** The three pills of the stepper (the wireframe leaves GEN-03/04 on "2" and M-01 on "1": corrected here, see VALIDACAO). */
export const STEP_PILLS = [
  { id: "contexto", long: "Contexto", short: "Contexto" },
  { id: "estrategia", long: "Estratégia", short: "Estratégia" },
  { id: "previa", long: "Revisar e gerar", short: "Revisão" },
] as const;
export const pillOf = (step: FlowStep): 0 | 1 | 2 => (step === "contexto" ? 0 : step === "previa" ? 2 : 1);

// ---------- small text helpers ----------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lowerFirst = (text: string) => (text ? `${text[0].toLowerCase()}${text.slice(1)}` : text);
const brShort = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const NOT_INFORMED = "não informado";

/** Plural title of a workout role ("Treino A · Superiores"). Fixed table, never model text. */
export const ROLE_TITLE: Record<WorkoutRole, string> = {
  FULL_BODY: "Corpo inteiro", UPPER: "Superiores", LOWER: "Inferiores", PUSH: "Empurrar", PULL: "Puxar", LEGS: "Pernas",
  CHEST_TRICEPS: "Peito e tríceps", BACK_BICEPS: "Costas e bíceps", SHOULDERS_ARMS: "Ombros e braços", CORE: "Core", CUSTOM: "Personalizado",
  CARDIO: "Cardio", MOBILITY: "Mobilidade", BALANCE: "Equilíbrio", SKILL: "Habilidade",
};
/** Short phrase of a role in a sentence ("Treino A: superiores · B: inferiores"). */
export const ROLE_PHRASE: Record<WorkoutRole, string> = Object.fromEntries(WORKOUT_ROLES.map((r) => [r, lowerFirst(ROLE_TITLE[r])])) as Record<WorkoutRole, string>;
export const isWorkoutRole = (value: string): value is WorkoutRole => (WORKOUT_ROLES as readonly string[]).includes(value);
const roleOf = (value: string): WorkoutRole => (isWorkoutRole(value) ? value : "CUSTOM");

const labelsOf = (codes: readonly string[], table: Record<string, string>, max = 6): string => {
  const names = codes.map((c) => table[c] ?? c);
  return names.length > max ? `${names.slice(0, max).join(", ")} e mais ${names.length - max}` : names.join(", ");
};
export const musclesText = (codes: readonly string[]): string => labelsOf(codes, MUSCLE_LABELS);
export const patternsText = (codes: readonly string[]): string => labelsOf(codes, PATTERN_LABELS);

// ---------- the sequence of the saved structure ----------

/** "ABAB" when the first phase's week holds single-letter labels; otherwise the labels joined (never invented). */
export function rotationText(structure: GenerationScreen["structure"], phaseIndex?: number): string {
  const phase = structure.find((p) => p.index === phaseIndex) ?? structure[0];
  const labels = phase?.weekSlots.map((s) => s.label) ?? [];
  if (!labels.length) return "";
  return labels.every((l) => l.length === 1) ? labels.join("") : labels.join(" · ");
}
/** " · alternância ABAB", only when the structure alternates more than one workout (a single Full Body has no rotation to show). */
export function rotationPart(structure: GenerationScreen["structure"], phaseIndex?: number): string {
  const rotation = rotationText(structure, phaseIndex);
  const distinct = new Set((structure.find((p) => p.index === phaseIndex) ?? structure[0])?.weekSlots.map((s) => s.label) ?? []);
  return rotation && distinct.size > 1 ? ` · alternância ${rotation}` : "";
}
const distinctLabels = (structure: GenerationScreen["structure"]): string[] => {
  const out: string[] = [];
  for (const p of structure) for (const w of p.workouts) if (!out.includes(w.label)) out.push(w.label);
  return out;
};

// ---------- GEN-01: the four context cards ----------

export interface ContextCard {
  id: "routine" | "assessment" | "periodization" | "history";
  title: string;
  line: string;
  meta: string;
}

const PARQ_TEXT: Record<GenerationSummary["parq"], string> = { CLEAR: "PAR-Q sem alertas", POSITIVE: "PAR-Q com “Sim”", NOT_DONE: "PAR-Q não realizado" };

/** "Dados que vão orientar a prescrição": what the records say; what they do not say reads "não informado" (nothing is guessed). */
export function contextCards(summary: GenerationSummary, structure: GenerationScreen["structure"], considered: readonly ConsideredFact[]): ContextCard[] {
  const weeksEach = structure.length > 0 && structure.every((p) => p.weeks === structure[0].weeks) ? ` de ${plural(structure[0].weeks, "semana", "semanas")}` : "";
  const labels = distinctLabels(structure);
  const history = considered.find((c) => c.label === "Histórico de execução")?.value ?? "Nenhuma sessão registrada";
  const noExecution = /^Nenhuma/.test(history);
  return [
    {
      id: "routine",
      title: "Objetivo e rotina",
      line: `${summary.goal ?? `objetivo ${NOT_INFORMED}`} • experiência ${summary.level ?? NOT_INFORMED}`,
      meta: `${summary.daysPerWeek ? plural(summary.daysPerWeek, "treino", "treinos") : `treinos ${NOT_INFORMED}`}/semana · ${summary.sessionMinutes ? `${summary.sessionMinutes} min` : `duração ${NOT_INFORMED}`} por sessão`,
    },
    {
      id: "assessment",
      title: "Avaliação física",
      line: `${PARQ_TEXT[summary.parq]} · ${summary.assessedOn ? `avaliação registrada em ${brShort(summary.assessedOn)}` : "nenhuma avaliação registrada"}`,
      meta: summary.findings ? `${plural(summary.findings, "achado", "achados")} da avaliação: contexto, não contraindicação` : "Nenhum achado registrado na avaliação",
    },
    {
      id: "periodization",
      title: "Periodização existente",
      line: `${plural(summary.weeks, "semana", "semanas")} · ${plural(summary.phases, "fase", "fases")}${weeksEach}`,
      meta: labels.length ? `Estrutura ${labels.join(" / ")}${rotationPart(structure)}` : "Estrutura sem treinos definidos",
    },
    {
      id: "history",
      title: "Histórico e limitações",
      line: history,
      meta: noExecution ? "Sem dado de execução, não inferir cargas" : "Cargas só a partir do que foi registrado",
    },
  ];
}

// ---------- GEN-01: the mode picker ----------

export type Mode = "AI" | "RULES";
export interface ModeOption {
  id: Mode;
  title: string;
  description: string;
  meta: string;
  disabled: boolean;
  /** Why the card cannot be chosen: the honest state of the gate, in the words a professional reads (null when available). */
  reason: string | null;
}
export interface ModePanel {
  options: ModeOption[];
  defaultMode: Mode;
  /** "Uso de IA neste mês: X de Y tokens" only when the AI is available and the plan has an allowance. Never a cost. */
  usageLine: string | null;
  /** The privacy notice under the AI card. */
  notice: string;
}
export const AI_PRIVACY_NOTICE = "Enviamos ao provedor só um resumo codificado e anonimizado (sem nome, contato, datas exatas ou textos livres).";
const num = (n: number) => n.toLocaleString("pt-BR");

export function usageLine(usage: PlanningAvailability["usage"] | null | undefined): string | null {
  if (!usage?.allowance) return null;
  const used = usage.used.input + usage.used.output;
  const total = usage.allowance.mode === "TOTAL" ? usage.allowance.total : usage.allowance.input + usage.allowance.output;
  return `Uso de IA neste mês: ${num(used)} de ${num(total)} tokens`;
}

export function modePanel(availability: PlanningAvailability | null): ModePanel {
  const ready = availability?.state === "READY";
  const reason = ready ? null : availability?.message || "IA não configurada.";
  return {
    options: [
      { id: "AI", title: "Assistida por IA", description: "A IA sugere estratégia, divisão e focos; o motor valida.", meta: "1 planejamento por versão", disabled: !ready, reason },
      { id: "RULES", title: "Por regras", description: "Mantém o gerador atual e permite definir focos manualmente.", meta: "Sem chamada de IA", disabled: false, reason: null },
    ],
    defaultMode: ready ? "AI" : "RULES",
    usageLine: ready ? usageLine(availability?.usage) : null,
    notice: AI_PRIVACY_NOTICE,
  };
}

// ---------- planning: states and failure banners ----------

export type PlanningUi =
  | { state: "IDLE" }
  | { state: "RUNNING"; mode: Mode }
  | { state: "FAILED"; reason: PlanFailure; message: string; canContinueByRules: boolean }
  | { state: "READY"; list: StrategyListView };

export interface Banner {
  tone: "warning" | "error" | "info";
  text: string;
  /** Short reason after the main text (tempo esgotado, resposta inválida, serviço instável). */
  detail: string | null;
  actions: Array<"retry" | "rules" | "replan">;
  role: "alert" | "status";
}

const FAILURE_DETAIL: Partial<Record<PlanFailure, string>> = { timeout: "tempo esgotado", invalid_response: "resposta inválida", provider_failed: "serviço instável", circuit_open: "serviço instável" };

/** The banner of a failed planning (design §7.0): honest, with the way out, never a toast. `null` for a success. */
export function planningBanner(outcome: Extract<PlanningOutcome, { ok: false }> | { reason: PlanFailure; message: string; canContinueByRules: boolean }, mode: Mode): Banner {
  const reason = outcome.reason;
  if (reason === "limit_reached") return { tone: "warning", text: "Limite do plano atingido neste mês. Você pode continuar por regras.", detail: null, actions: ["rules"], role: "alert" };
  if (reason === "minor_blocked") return { tone: "info", text: "Para alunos menores de idade a montagem é por regras.", detail: null, actions: ["rules"], role: "alert" };
  if (reason === "privacy_blocked") return { tone: "error", text: outcome.message, detail: null, actions: ["rules"], role: "alert" };
  if (reason === "in_progress") return { tone: "info", text: "Já existe um planejamento em andamento para este plano.", detail: null, actions: [], role: "status" };
  if (reason === "revision_changed" || reason === "stale") return { tone: "warning", text: "A periodização mudou. Planeje de novo para atualizar as estratégias.", detail: null, actions: ["replan"], role: "alert" };
  if (reason === "provider_failed" || reason === "timeout" || reason === "invalid_response" || reason === "circuit_open")
    return { tone: "error", text: "Falha da IA — continuar por regras. Nada foi perdido e nada foi alterado no plano.", detail: FAILURE_DETAIL[reason] ?? null, actions: ["retry", "rules"], role: "alert" };
  // Gate states and the rest: the server's own message, with the way out when there is one (and only in the AI mode).
  return { tone: "warning", text: outcome.message, detail: null, actions: mode === "AI" && outcome.canContinueByRules ? ["rules"] : [], role: "alert" };
}

// ---------- GEN-02: the strategy cards ----------

export type StrategyChoice = "S1" | "S2" | "S3" | "CUSTOM" | "NONE";
export interface Pill {
  text: string;
  tone: "brand" | "neutral" | "warning" | "success";
}
export interface StrategyCard {
  id: StrategyChoice;
  title: string;
  line: string;
  meta: string;
  pills: Pill[];
  /** Cannot be accepted (the saved labels, rotation or frequency cannot carry it): shown, never silently applied. */
  disabled: boolean;
  disabledReason: string | null;
}

const UPPER_ROLES: readonly WorkoutRole[] = ["UPPER", "PUSH", "PULL", "CHEST_TRICEPS", "BACK_BICEPS", "SHOULDERS_ARMS"];
const LOWER_ROLES: readonly WorkoutRole[] = ["LOWER", "LEGS"];

/** "4 dias · 2 exposições por região", from the structure's first week and the strategy's roles; never from model text. */
export function strategyMeta(strategy: StrategyView, structure: GenerationScreen["structure"]): string {
  const phase = structure[0];
  const first = strategy.phases[0];
  const slots = phase?.weekSlots.length ? phase.weekSlots : [];
  const days = slots.length || phase?.sessionsPerWeek || 0;
  const head = days ? plural(days, "dia", "dias") : "frequência não informada";
  if (!first || !slots.length) return head;
  const roles = slots.map((s) => first.workouts.find((w) => w.label === s.label)?.role).filter((r): r is WorkoutRole => Boolean(r));
  const fullBody = roles.filter((r) => r === "FULL_BODY").length;
  const upper = roles.filter((r) => UPPER_ROLES.includes(r)).length;
  const lower = roles.filter((r) => LOWER_ROLES.includes(r)).length;
  if (fullBody && !upper && !lower) return `${head} · distribuição de fadiga por sessão`;
  if (upper || lower) return upper === lower ? `${head} · ${plural(upper, "exposição", "exposições")} por região` : `${head} · superiores ${upper}× · inferiores ${lower}×`;
  return head;
}

export const CUSTOM_CARD: StrategyCard = { id: "CUSTOM", title: "Personalizar", line: "Definir focos de cada treino e fase", meta: "Sem divisão obrigatória", pills: [], disabled: false, disabledReason: null };
export const NONE_CARD: StrategyCard = { id: "NONE", title: "Sem divisão (geração atual)", line: "Mantém o gerador atual, sem blueprint", meta: "Comportamento anterior, inalterado", pills: [], disabled: false, disabledReason: null };

export function strategyCards(list: StrategyListView, structure: GenerationScreen["structure"]): StrategyCard[] {
  const cards: StrategyCard[] = list.strategies.map((s) => {
    const pills: Pill[] = [s.provenance === "AI_SUGGESTED" ? { text: "Sugestão da IA", tone: "brand" } : { text: "Padrão por regras", tone: "neutral" }];
    if (s.recommended) pills.push({ text: "Recomendada", tone: "success" });
    if (!s.acceptable) pills.push({ text: "Exige alterar a periodização", tone: "warning" });
    return {
      id: s.strategyId, title: s.displayName, line: s.explanation, meta: strategyMeta(s, structure), pills,
      disabled: !s.acceptable, disabledReason: s.acceptable ? null : "Exige alterar a periodização",
    };
  });
  return [...cards, CUSTOM_CARD, NONE_CARD];
}

/** The card chosen when the screen opens: the recommended strategy when it can be accepted (as drawn), else the first acceptable, else "Sem divisão". */
export function defaultChoice(list: StrategyListView): StrategyChoice {
  const recommended = list.strategies.find((s) => s.recommended && s.acceptable);
  return recommended?.strategyId ?? list.strategies.find((s) => s.acceptable)?.strategyId ?? "NONE";
}

export interface InfoCard {
  title: string;
  line: string;
  meta: string;
  highlight?: boolean;
}

/** "Por que esta sugestão?": three cards from facts and the strategy's roles (a model's explanation stays on the strategy card). */
export function whyCards(list: StrategyListView, choice: StrategyChoice, summary: GenerationSummary, structure: GenerationScreen["structure"]): InfoCard[] {
  const strategy = list.strategies.find((s) => s.strategyId === choice) ?? null;
  const days = summary.daysPerWeek;
  const context: InfoCard = {
    title: "Contexto",
    line: `${days ? `${plural(days, "sessão", "sessões")}` : `sessões ${NOT_INFORMED}`}${summary.sessionMinutes ? ` de ${summary.sessionMinutes} min` : ""}, objetivo ${summary.goal ? lowerFirst(summary.goal) : NOT_INFORMED}.`,
    meta: `Experiência ${summary.level ? lowerFirst(summary.level) : NOT_INFORMED}`,
  };
  let structureCard: InfoCard;
  if (strategy) {
    const first = strategy.phases[0];
    const roles = first ? first.workouts.map((w) => `${w.label}: ${ROLE_PHRASE[roleOf(w.role)]}`).join(" · ") : "";
    structureCard = {
      title: "Decisão de estrutura", highlight: true,
      line: strategy.acceptable ? "Preserva a periodização salva." : "Exige alterar a rotação, os rótulos ou a frequência da fase.",
      meta: roles ? `Foco ${roles}` : "Foco por treino a definir",
    };
  } else if (choice === "CUSTOM") structureCard = { title: "Decisão de estrutura", highlight: true, line: "Você define o foco de cada treino e fase.", meta: "A periodização salva é respeitada" };
  else structureCard = { title: "Decisão de estrutura", highlight: true, line: "Sem divisão: o gerador atual segue como antes.", meta: `Estrutura ${distinctLabels(structure).join(" / ") || "salva"} inalterada` };
  const control: InfoCard = {
    title: "Controle",
    line: "É possível editar foco e estratégia por fase.",
    meta: list.producer === "AI" ? "IA não aprova nem entrega" : "Padrão por regras: heurística operacional, editável",
  };
  return [context, structureCard, control];
}

/** The plain-text assumptions and questions of the planner (a disclosure "Premissas e dúvidas"); empty for a rules suggestion without any. */
export function assumptionLines(list: StrategyListView): string[] {
  return [...list.global.assumptions, ...list.global.uncertainties.map((u) => u.text), ...list.global.questionsForProfessional.map((q) => q.text)];
}

// ---------- GEN-03: the editable draft of the acceptance ----------

export type ListKey = "dominantMuscles" | "supportingMuscles" | "targetPatterns" | "allowedSpilloverPatterns";
export const LIST_KEYS: readonly ListKey[] = ["dominantMuscles", "supportingMuscles", "targetPatterns", "allowedSpilloverPatterns"];
export const LIST_TITLE: Record<ListKey, string> = {
  dominantMuscles: "Músculos dominantes", supportingMuscles: "Músculos de apoio", targetPatterns: "Padrões-alvo", allowedSpilloverPatterns: "Padrões permitidos como complemento",
};

export interface DraftWorkout {
  phaseIndex: number;
  label: string;
  role: WorkoutRole;
  focus: ExpandedFocus;
  /** What the strategy (or the first suggestion, for "Personalizar") said: the edit is measured against it. */
  baseRole: WorkoutRole;
  baseFocus: ExpandedFocus;
  baseSource: FocusSource | "STRUCTURE";
  /** The saved periodization holds this workout's focus: read-only here (it wins at generation). */
  locked: boolean;
  candidateExerciseIds: string[];
}
export interface AcceptanceDraft {
  choice: Exclude<StrategyChoice, "NONE">;
  displayName: string;
  family: SplitFamily;
  /** "Personalizar": every workout is the professional's. */
  custom: boolean;
  table: RoleFocusTable;
  workouts: DraftWorkout[];
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameFocus = (a: ExpandedFocus, b: ExpandedFocus) => LIST_KEYS.every((k) => sameList(a[k], b[k]));
const cloneFocus = (f: ExpandedFocus): ExpandedFocus => ({ dominantMuscles: [...f.dominantMuscles], supportingMuscles: [...f.supportingMuscles], targetPatterns: [...f.targetPatterns], allowedSpilloverPatterns: [...f.allowedSpilloverPatterns] });
const key = (phaseIndex: number, label: string) => `${phaseIndex}|${label}`;

/** Start of the acceptance: a strategy as suggested, or "Personalizar" starting from the recommended one (both editable). `null` when the table is unknown. */
export function draftFrom(list: StrategyListView, choice: Exclude<StrategyChoice, "NONE">, structure: GenerationScreen["structure"]): AcceptanceDraft | null {
  const table = list.roleFocus;
  if (!table) return null;
  const strategy = choice === "CUSTOM" ? list.strategies.find((s) => s.recommended) ?? list.strategies[0] : list.strategies.find((s) => s.strategyId === choice);
  if (!strategy) return null;
  const savedFocus = new Set<string>();
  for (const p of structure) for (const w of p.workouts) if (w.focusSaved) savedFocus.add(key(p.index, w.label));
  const workouts: DraftWorkout[] = [];
  for (const phase of strategy.phases)
    for (const w of phase.workouts) {
      const role = roleOf(w.role);
      const focus = w.focus ?? expandFocus(role, w.focusDelta, table);
      workouts.push({
        phaseIndex: phase.phaseIndex, label: w.label, role, focus: cloneFocus(focus), baseRole: role, baseFocus: cloneFocus(focus), baseSource: w.source,
        locked: w.source === "STRUCTURE" || savedFocus.has(key(phase.phaseIndex, w.label)),
        candidateExerciseIds: choice === "CUSTOM" ? [] : [...w.candidateExerciseIds],
      });
    }
  return { choice, displayName: choice === "CUSTOM" ? SPLIT_DISPLAY_NAME.CUSTOM : strategy.displayName, family: choice === "CUSTOM" ? "CUSTOM" : (strategy.splitFamily as SplitFamily), custom: choice === "CUSTOM", table, workouts };
}

/** Rebuilds the draft of an acceptance already written (a refresh on GEN-04): the strategy as the base, the accepted role and focus on top. */
export function draftFromAcceptance(list: StrategyListView, acceptance: AcceptanceView, structure: GenerationScreen["structure"]): AcceptanceDraft | null {
  const base = draftFrom(list, acceptance.strategyId, structure);
  if (!base) return null;
  return {
    ...base,
    workouts: base.workouts.map((w) => {
      const accepted = acceptance.workouts.find((a) => a.phaseIndex === w.phaseIndex && a.label === w.label);
      if (!accepted || w.locked) return w;
      const role = roleOf(accepted.role);
      return { ...w, role, focus: cloneFocus(expandFocus(role, accepted.focusDelta, base.table)) };
    }),
  };
}

const mapWorkout = (draft: AcceptanceDraft, phaseIndex: number, label: string, change: (w: DraftWorkout) => DraftWorkout): AcceptanceDraft => ({
  ...draft,
  workouts: draft.workouts.map((w) => (w.phaseIndex === phaseIndex && w.label === label && !w.locked ? change(w) : w)),
});

/** A new role resets the lists to that role's defaults (the professional then edits from there). */
export function setRole(draft: AcceptanceDraft, phaseIndex: number, label: string, role: WorkoutRole): AcceptanceDraft {
  return mapWorkout(draft, phaseIndex, label, (w) => (w.role === role ? w : { ...w, role, focus: cloneFocus(expandFocus(role, null, draft.table)) }));
}
export function toggleItem(draft: AcceptanceDraft, phaseIndex: number, label: string, list: ListKey, code: string, checked: boolean): AcceptanceDraft {
  return mapWorkout(draft, phaseIndex, label, (w) => {
    const current = w.focus[list];
    const next = checked ? [...new Set([...current, code])] : current.filter((c) => c !== code);
    return { ...w, focus: { ...w.focus, [list]: next.sort(cmp) } };
  });
}
/** "Restaurar sugestão". */
export function restoreWorkout(draft: AcceptanceDraft, phaseIndex: number, label: string): AcceptanceDraft {
  return mapWorkout(draft, phaseIndex, label, (w) => ({ ...w, role: w.baseRole, focus: cloneFocus(w.baseFocus) }));
}
/** "Aplicar às outras fases": copies this workout's role and lists to the workouts with the same label in the other phases (locked ones keep their saved focus). */
export function applyToOtherPhases(draft: AcceptanceDraft, phaseIndex: number, label: string): AcceptanceDraft {
  const from = draft.workouts.find((w) => w.phaseIndex === phaseIndex && w.label === label);
  if (!from) return draft;
  return { ...draft, workouts: draft.workouts.map((w) => (w.label === label && w.phaseIndex !== phaseIndex && !w.locked ? { ...w, role: from.role, focus: cloneFocus(from.focus) } : w)) };
}

export function isEdited(w: DraftWorkout): boolean {
  return w.role !== w.baseRole || !sameFocus(w.focus, w.baseFocus);
}
export function editedFieldNames(w: DraftWorkout): string[] {
  const out: string[] = [];
  if (w.role !== w.baseRole) out.push("papel");
  for (const k of LIST_KEYS) if (!sameList(w.focus[k], w.baseFocus[k])) out.push(LIST_TITLE[k].toLowerCase());
  return out;
}

export type SourcePill = { text: string; tone: Pill["tone"] };
/** Who decided this workout's focus, as the pill on its card. */
export function workoutPill(w: DraftWorkout, draft: AcceptanceDraft): SourcePill {
  if (w.locked) return { text: "Foco salvo na periodização", tone: "neutral" };
  if (draft.custom || isEdited(w)) return { text: "Decisão do profissional", tone: "success" };
  return w.baseSource === "AI_SUGGESTED" ? { text: "Sugestão da IA", tone: "brand" } : { text: "Padrão por regras", tone: "neutral" };
}

/** Inline validation (`role="alert"`): a volume workout needs at least one dominant muscle or target pattern, and the change against the role's defaults is bounded (as the server bounds it). Empty = valid. */
export function draftProblems(draft: AcceptanceDraft): string[] {
  const out: string[] = [];
  for (const w of draft.workouts) {
    if (w.locked) continue;
    const where = `Fase ${w.phaseIndex}, treino ${w.label}`;
    if (!isNonVolumeRole(w.role) && w.focus.dominantMuscles.length === 0 && w.focus.targetPatterns.length === 0) out.push(`${where}: escolha ao menos um músculo dominante ou um padrão-alvo.`);
    const delta = deriveDelta(w.role, w.focus, draft.table);
    if (deltaSize(delta) > FOCUS_DELTA_MAX_ITEMS) out.push(`${where}: o ajuste do foco é grande demais; use outro papel como ponto de partida.`);
  }
  return out;
}

/** What the professional ticked in GEN-04: only these ever reach the acceptance (nothing is pre-ticked). */
export interface DosingChoice {
  byClass: Array<{ exerciseClass: string; profileCode: string }>;
  progression: Array<{ phaseIndex: number; intent: string }>;
}
export const NO_DOSING: DosingChoice = { byClass: [], progression: [] };

/**
 * The payload of `acceptStrategy`. A strategy sends only the workouts the professional changed (the rest keep the strategy's own);
 * "Personalizar" sends every workout that is not locked, as the server expects. Locked workouts are never sent.
 */
export function acceptanceInput(
  draft: AcceptanceDraft,
  meta: { idempotencyKey: string; runId: string; baseContentVersion: number; dosing?: DosingChoice },
): AcceptPayload {
  const phases = new Map<number, NonNullable<AcceptPayload["phases"]>[number]["workouts"]>();
  for (const w of draft.workouts) {
    if (w.locked || (!draft.custom && !isEdited(w))) continue;
    const list = phases.get(w.phaseIndex) ?? [];
    list.push({ label: w.label, role: w.role, focusDelta: deriveDelta(w.role, w.focus, draft.table), candidateExerciseIds: draft.custom ? [] : w.candidateExerciseIds });
    phases.set(w.phaseIndex, list);
  }
  return {
    idempotencyKey: meta.idempotencyKey,
    runId: meta.runId,
    strategyId: draft.choice,
    phases: [...phases.entries()].sort((a, b) => a[0] - b[0]).map(([phaseIndex, workouts]) => ({ phaseIndex, workouts })),
    dosing: (meta.dosing ?? NO_DOSING) as AcceptPayload["dosing"],
    baseContentVersion: meta.baseContentVersion,
  };
}

/** The payload of "Aceitar" for an unedited strategy of the list (no draft was opened). */
export function plainAcceptanceInput(choice: "S1" | "S2" | "S3", meta: { idempotencyKey: string; runId: string; baseContentVersion: number; dosing?: DosingChoice }): AcceptPayload {
  return { idempotencyKey: meta.idempotencyKey, runId: meta.runId, strategyId: choice, phases: [], dosing: (meta.dosing ?? NO_DOSING) as AcceptPayload["dosing"], baseContentVersion: meta.baseContentVersion };
}

// ---------- GEN-03: the phase and workout cards ----------

export interface PhaseFocusCard {
  phaseIndex: number;
  title: string;
  line: string;
  meta: string;
}
export function phaseCards(draft: AcceptanceDraft, structure: GenerationScreen["structure"], producerLabel: string): PhaseFocusCard[] {
  const spans = phaseSpans(structure);
  const phases = [...new Set(draft.workouts.map((w) => w.phaseIndex))].sort((a, b) => a - b);
  return phases.map((phaseIndex, n) => {
    const span = spans.find((s) => s.index === phaseIndex);
    const ws = draft.workouts.filter((w) => w.phaseIndex === phaseIndex);
    const roles = ws.map((w) => `${w.label}: ${ROLE_PHRASE[w.role]}`).join(" · ");
    return {
      phaseIndex,
      title: `Fase ${phaseIndex}${span ? ` · ${weeksText(span)}` : ""}`,
      line: `${draft.displayName}${rotationPart(structure, phaseIndex)}`,
      meta: n === 0 ? `Treino ${roles}` : ws.some((w) => w.locked) ? `Treino ${roles} · foco salvo na periodização em parte` : `Treino ${roles} · ${producerLabel}`,
    };
  });
}

export interface WorkoutFocusCard {
  phaseIndex: number;
  label: string;
  title: string;
  line: string;
  meta: string;
  locked: boolean;
  pill: SourcePill;
  edited: string[];
}
export function workoutCards(draft: AcceptanceDraft, phaseIndex: number): WorkoutFocusCard[] {
  return draft.workouts
    .filter((w) => w.phaseIndex === phaseIndex)
    .map((w) => ({
      phaseIndex, label: w.label, title: `Treino ${w.label} · ${ROLE_TITLE[w.role]}`,
      line: w.focus.dominantMuscles.length ? `${musclesText(w.focus.dominantMuscles)}.` : "Sem músculo dominante definido.",
      meta: w.focus.targetPatterns.length ? patternsText(w.focus.targetPatterns) : "Sem padrões-alvo",
      locked: w.locked, pill: workoutPill(w, draft), edited: isEdited(w) ? editedFieldNames(w) : [],
    }));
}

// ---------- GEN-04: the week-type preview ----------

export interface WeekTypeCard {
  title: string;
  line: string;
  meta: string;
  highlight: boolean;
}
export function weekPreview(draft: AcceptanceDraft, structure: GenerationScreen["structure"], phaseIndex: number): WeekTypeCard[] {
  const phase = structure.find((p) => p.index === phaseIndex);
  if (!phase) return [];
  const seen = new Set<string>();
  let repeats = 0;
  const hasDays = phase.weekSlots.length > 0 && phase.weekSlots.every((s) => s.weekday !== null);
  return phase.weekSlots.map((slot, n) => {
    const w = draft.workouts.find((x) => x.phaseIndex === phaseIndex && x.label === slot.label);
    const first = !seen.has(slot.label);
    seen.add(slot.label);
    const day = hasDays && slot.weekday !== null ? WEEKDAYS[slot.weekday] : `Sessão ${n + 1}`;
    const role = w ? w.role : null;
    const title = `${day} · Treino ${slot.label}${role ? ` · ${ROLE_TITLE[role]}` : ""}`;
    if (!first) {
      repeats += 1;
      return { title, line: `Repetição do foco ${slot.label} com progressão planejada`, meta: repeats % 2 === 1 ? "Escolha e dose ainda serão validadas" : "Cargas não são inferidas", highlight: false };
    }
    if (!w || !role) return { title, line: "Foco salvo na periodização", meta: "O motor segue o foco salvo", highlight: n === 0 };
    const patterns = w.focus.targetPatterns.map((c) => lowerFirst(PATTERN_LABELS[c] ?? c));
    return {
      title,
      line: isNonVolumeRole(role) ? "Sem padrões de força para este papel" : patterns.length ? capitalize(patterns.slice(0, 4).join(" + ")) : "Sem padrões-alvo definidos",
      meta: `Foco principal: ${ROLE_PHRASE[role]}`,
      highlight: n === 0,
    };
  });
}
const capitalize = (t: string) => (t ? `${t[0].toUpperCase()}${t.slice(1)}` : t);

/** "Antes de gerar": data available (with origin and date), points to review (observations, never diagnoses) and the mandatory validation. */
export function beforeGenerating(summary: GenerationSummary, equipment: string): InfoCard[] {
  const available: InfoCard = {
    title: "Dados disponíveis", highlight: true,
    line: `${summary.daysPerWeek ? `${summary.daysPerWeek} sessões/semana` : `sessões ${NOT_INFORMED}`} · ${summary.sessionMinutes ? `${summary.sessionMinutes} minutos` : `duração ${NOT_INFORMED}`} · ${equipment}`,
    meta: "Com origem e data",
  };
  const review: InfoCard = {
    title: "Pontos a revisar",
    line: summary.findings ? `${plural(summary.findings, "achado", "achados")} da avaliação: observar a execução, sem excluir exercícios.` : "Nenhum achado registrado na avaliação.",
    meta: summary.findings ? "Observação, não diagnóstico" : "Sem dado, nada é inferido",
  };
  const validation: InfoCard = { title: "Validação obrigatória", line: "Volume, duração, cobertura, biblioteca e regras de negócio.", meta: "O motor audita após gerar" };
  return [available, review, validation];
}

/** The unchecked suggestions of GEN-04 ("Usar sugestão: ..."), from the chosen strategy's intents; empty for a strategy without them. */
export function suggestedIntents(list: StrategyListView, choice: StrategyChoice): DosingChoice {
  if (choice === "NONE") return NO_DOSING;
  const source = list.strategies.find((s) => s.strategyId === (choice === "CUSTOM" ? list.recommendedStrategyId : choice));
  return { byClass: source?.dosingIntent ?? [], progression: source?.progressionIntent ?? [] };
}

// ---------- the footer of each step ----------

export interface FooterView {
  guide: string;
  primary: string;
  disabled: boolean;
  /** Why the primary is disabled, in words (null when enabled). */
  reason: string | null;
}
export interface FooterState {
  step: FlowStep;
  openAnswers: number;
  running: boolean;
  mode: Mode;
  choice: StrategyChoice;
  choiceName: string | null;
  choiceAcceptable: boolean;
  problems: number;
  generating: boolean;
  /** The phone's wording (M-01): "Nenhuma divisão será aplicada sem aceite." and "Conferir divisão por fase". */
  phone?: boolean;
}
export function footerFor(s: FooterState): FooterView {
  if (s.step === "contexto")
    return {
      guide: "Próximo: escolher estratégia. Nada será aplicado ou entregue sem revisão.",
      primary: s.running ? "Gerando estratégia…" : "Continuar para estratégia",
      disabled: s.running || s.openAnswers > 0,
      reason: s.openAnswers > 0 ? `Faltam ${plural(s.openAnswers, "resposta", "respostas")}` : null,
    };
  if (s.step === "estrategia") {
    const primary = s.choice === "NONE" ? "Gerar sem divisão" : s.choice === "CUSTOM" ? "Personalizar focos" : `Usar ${(s.choiceName ?? "estratégia").toLowerCase()}`;
    return {
      guide: s.phone ? "Nenhuma divisão será aplicada sem aceite." : "Escolha uma opção ou personalize. A divisão escolhida é uma decisão do profissional.",
      primary: s.phone && s.choice !== "NONE" ? "Conferir divisão por fase" : primary, disabled: !s.choiceAcceptable, reason: s.choiceAcceptable ? null : "Esta opção exige alterar a periodização",
    };
  }
  if (s.step === "focos")
    return {
      guide: s.mode === "AI" ? "A IA sugere. A geração só começa depois de aceitar esta organização." : "O padrão por regras é editável. A geração só começa depois de aceitar esta organização.",
      primary: "Conferir blueprint", disabled: s.problems > 0, reason: s.problems > 0 ? `${plural(s.problems, "ajuste", "ajustes")} a corrigir` : null,
    };
  return {
    guide: "Aceitar estratégia → gerar proposta → revisar → aplicar ao rascunho.",
    primary: s.generating ? "Gerando…" : "Gerar proposta", disabled: s.generating || s.openAnswers > 0, reason: s.openAnswers > 0 ? `Faltam ${plural(s.openAnswers, "resposta", "respostas")}` : null,
  };
}

// ---------- headings ----------

export interface StepHeading {
  crumbTail: string;
  title: string;
  sub: string;
}
export function headingFor(step: FlowStep, mode: Mode): StepHeading {
  if (step === "contexto") return { crumbTail: "Rascunho", title: "Montar prescrição", sub: "Confira os dados do aluno e escolha como estruturar o plano." };
  if (step === "estrategia") return { crumbTail: "Rascunho", title: "Escolher estratégia de treino", sub: "Compare opções de divisão antes de gerar exercícios." };
  if (step === "focos") return { crumbTail: "Rascunho", title: "Definir focos por fase", sub: "Configure o papel de cada treino; a periodização será respeitada." };
  return {
    crumbTail: "Blueprint", title: "Revisar e gerar",
    sub: `Estrutura proposta ${mode === "AI" ? "pela IA" : "por regras"}; os cálculos e exercícios ainda serão validados pelo motor.`,
  };
}

/** `XINTUS / HIPERTROFIA / RASCUNHO`: student, goal (when known) and where the flow is. */
export function crumbText(studentName: string, goal: string | null, tail: string): string {
  return [studentName, goal, tail].filter(Boolean).join(" / ").toUpperCase();
}

/** A generation outcome of the strategy path, in the shape the screen already reads for the plain generation (same fields as the server action's). */
export function proposalResultOf(outcome: ProposalOutcome): ProposalActionResult {
  if (outcome.ok)
    return { ...(outcome.notice ? { notice: outcome.notice } : {}), data: { proposalId: outcome.proposalId, version: outcome.version, complete: outcome.complete, replayed: outcome.replayed, ...(outcome.progress ? { progress: outcome.progress } : {}) } };
  return {
    error: outcome.message,
    data: {
      reason: outcome.reason,
      ...(outcome.proposalId ? { proposalId: outcome.proposalId } : {}),
      ...(outcome.version !== undefined ? { version: outcome.version } : {}),
      ...(outcome.contentVersion !== undefined ? { contentVersion: outcome.contentVersion } : {}),
      ...(outcome.questions ? { questions: outcome.questions } : {}),
    },
  };
}
