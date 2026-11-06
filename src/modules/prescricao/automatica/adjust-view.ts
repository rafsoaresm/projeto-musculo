/**
 * View models of the assisted-adjustments screen (design V4 §7.6, Figma RX-02 / M-02). Pure: no React, no network, no clock (the caller passes
 * `now`). The component only draws what these return; the business rules (eligibility, volume, duration, constraints) stay in the engine and the
 * service: here are texts, the request builder (chips and numbers, never free text) and the state of "Aplicar ajuste à proposta".
 */
import { EQUIPMENT, MUSCLES } from "@/modules/biblioteca/metadata/vocabulary";
import {
  adjustmentRequestSchema, constraintText, OP_LABEL, type AdjustConstraint, type AdjustIntent, type AdjustOp, ADJUST_OPS,
} from "@/modules/prescricao/planejador/adjust";
import type { AdjustmentDiff } from "@/modules/prescricao/planejador/adjust-diff";
import type { AdjustAvailabilityView } from "@/modules/prescricao/planejador/adjust-actions";
import type { SuggestionView } from "@/modules/prescricao/planejador/adjust-service";

/** The order of the "O que ajustar" select (design §7.6). */
export const OP_ORDER: readonly AdjustOp[] = ["SUBSTITUTE_EXERCISE", "CHANGE_SETS", "CHANGE_REPS", "CHANGE_RIR", "CHANGE_REST"];
export { OP_LABEL, ADJUST_OPS };
export type { AdjustOp };

/** The items of the selected session the professional can point at (custom rows without a library exercise cannot be adjusted). */
export interface TargetOption {
  slotKey: string;
  exerciseId: string;
  name: string;
  /** "Treino A". */
  workout: string;
  label: string;
  position: number;
  locked: boolean;
}

export function targetOptions(session: { label: string; items: Array<{ slotKey: string; exerciseId: string | null; exerciseName: string; origin: string; position: number }> } | null): TargetOption[] {
  if (!session) return [];
  return session.items
    .filter((i): i is typeof i & { exerciseId: string } => i.exerciseId !== null)
    .map((i) => ({ slotKey: i.slotKey, exerciseId: i.exerciseId, name: i.exerciseName, workout: `Treino ${session.label}`, label: session.label, position: i.position, locked: i.origin === "LOCKED" || i.origin === "PRESERVED" }));
}

export const muscleLabel = (code: string) => MUSCLES[code] ?? code;

/** The equipment classes the "Equipamento" chip offers (the ones a substitution is usually about). */
export const EQUIPMENT_CHOICES = ["MACHINE", "CABLE", "DUMBBELL", "BARBELL", "KETTLEBELL", "RESISTANCE_BAND"] as const;
export const equipmentLabel = (code: string) => EQUIPMENT[code] ?? code;

export interface BuilderState {
  itemKey: string | null;
  op: AdjustOp;
  scope: AdjustIntent["scope"];
  sets: string;
  repsMin: string;
  repsMax: string;
  rirMin: string;
  rirMax: string;
  rest: string;
  volume: boolean;
  duration: boolean;
  maxMinutes: boolean;
  maxMinutesValue: string;
  samePattern: boolean;
  equipment: string;
  /** The alternative the professional picked from the engine's list (the structured path). */
  replacement: string | null;
}

export const INITIAL_BUILDER: BuilderState = {
  itemKey: null, op: "SUBSTITUTE_EXERCISE", scope: "PHASE", sets: "", repsMin: "", repsMax: "", rirMin: "", rirMax: "", rest: "", volume: false, duration: false, maxMinutes: false,
  maxMinutesValue: "60", samePattern: false, equipment: "", replacement: null,
};

const int = (text: string): number | null => (/^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : null);

/** The constraint chips that are ticked, as the contract's constraints. */
export function constraintsOf(state: BuilderState, muscles: readonly string[]): AdjustConstraint[] {
  const out: AdjustConstraint[] = [];
  if (state.volume && muscles.length) out.push({ kind: "NO_WEEKLY_SETS_INCREASE", muscles: muscles.slice(0, 6) });
  if (state.duration) out.push({ kind: "NO_DURATION_INCREASE" });
  const minutes = int(state.maxMinutesValue);
  if (state.maxMinutes && minutes !== null) out.push({ kind: "MAX_SESSION_MINUTES", minutes });
  if (state.samePattern && state.op === "SUBSTITUTE_EXERCISE") out.push({ kind: "SAME_PATTERN" });
  if (state.equipment && state.op === "SUBSTITUTE_EXERCISE") out.push({ kind: "EQUIPMENT_CLASS", equipment: state.equipment });
  return out.slice(0, 4);
}

/** The labels of the checkboxes, in the order the builder draws them. */
export function constraintChoices(muscles: readonly string[]): Array<{ id: "volume" | "duration" | "maxMinutes" | "samePattern"; label: string; substitutionOnly: boolean }> {
  const names = muscles.length ? muscles.slice(0, 6) : [];
  return [
    ...(names.length ? [{ id: "volume" as const, label: constraintText({ kind: "NO_WEEKLY_SETS_INCREASE", muscles: names } as AdjustConstraint), substitutionOnly: false }] : []),
    { id: "duration", label: "Sem aumentar a duração", substitutionOnly: false },
    { id: "maxMinutes", label: "Máximo de minutos por sessão", substitutionOnly: false },
    { id: "samePattern", label: "Mesmo padrão de movimento", substitutionOnly: true },
  ];
}

export interface BuilderContext {
  phaseIndex: number;
  /** The session selected on the screen: scope "week" and "session" come from it. */
  week: number;
  slot: number;
  /** Primary muscles of the selected item. */
  muscles: readonly string[];
  target: TargetOption | null;
}

/** The request the builder stands for, or why it cannot be sent yet. The server parses it again; this only guides the screen. */
export function buildIntent(state: BuilderState, c: BuilderContext, useAi: boolean): { ok: true; intent: AdjustIntent } | { ok: false; errors: string[] } {
  if (!c.target) return { ok: false, errors: ["Escolha o exercício que será ajustado."] };
  if (c.target.locked) return { ok: false, errors: ["Este exercício está travado ou foi mantido da revisão: destrave antes de ajustar."] };
  const errors: string[] = [];
  const values: NonNullable<AdjustIntent["values"]> = {};
  if (state.op === "CHANGE_SETS") {
    const n = int(state.sets);
    if (n === null || n < 1 || n > 8) errors.push("Séries: de 1 a 8.");
    else values.sets = n;
  }
  if (state.op === "CHANGE_REPS") {
    const a = int(state.repsMin);
    const b = int(state.repsMax);
    if (a === null || b === null || a < 1 || b > 100) errors.push("Repetições: informe o mínimo e o máximo.");
    else if (a > b) errors.push("As repetições mínimas passam das máximas.");
    else Object.assign(values, { repsMin: a, repsMax: b });
  }
  if (state.op === "CHANGE_RIR") {
    const a = int(state.rirMin);
    const b = int(state.rirMax);
    if (a === null || b === null || a > 10 || b > 10) errors.push("RIR: informe o mínimo e o máximo (0 a 10).");
    else if (a > b) errors.push("O RIR mínimo passa do máximo.");
    else Object.assign(values, { rirMin: a, rirMax: b });
  }
  if (state.op === "CHANGE_REST") {
    const n = int(state.rest);
    if (n === null || n > 600) errors.push("Pausa: de 0 a 600 segundos.");
    else values.restSeconds = n;
  }
  if (state.maxMinutes && (int(state.maxMinutesValue) ?? 0) < 5) errors.push("Máximo de minutos: de 5 a 240.");
  if (errors.length) return { ok: false, errors };
  const substitution = state.op === "SUBSTITUTE_EXERCISE";
  const intent: AdjustIntent = {
    op: state.op,
    target: { phaseIndex: c.phaseIndex, label: c.target.label, slotKey: c.target.slotKey, ...(substitution && state.scope !== "PHASE" ? { week: c.week } : {}), ...(substitution && state.scope === "OCCURRENCE" ? { slot: c.slot } : {}) },
    scope: substitution ? state.scope : "PHASE",
    values: substitution ? null : values,
    constraints: constraintsOf(state, c.muscles),
    replacementExerciseId: substitution && !useAi ? state.replacement : null,
    useAi: substitution && useAi,
  };
  // The same contract the server enforces: whatever it refuses is shown here instead of sent.
  const parsed = adjustmentRequestSchema.shape.intent.safeParse(intent);
  return parsed.success ? { ok: true, intent } : { ok: false, errors: ["Revise os valores informados."] };
}

export interface ButtonState {
  disabled: boolean;
  label: string;
  /** Shown next to the button and bound with aria-describedby. */
  reason: string | null;
}

/** "Sugerir alternativa com IA" (substitution only, gate READY) or "Ver alternativas do motor". */
export function aiButton(availability: AdjustAvailabilityView | null, op: AdjustOp, running: boolean): ButtonState {
  if (op !== "SUBSTITUTE_EXERCISE") return { disabled: false, label: "Ver impacto", reason: null };
  if (running) return { disabled: true, label: "Buscando alternativa…", reason: null };
  if (!availability || availability.state !== "READY")
    return { disabled: true, label: "Sugerir alternativa com IA", reason: `Sugestão por IA exige a IA habilitada${availability?.message ? ` (${availability.message.replace(/\.$/, "")})` : ""}. Use as alternativas do motor.` };
  return { disabled: false, label: "Sugerir alternativa com IA", reason: null };
}

export interface ApplyState {
  canApply: boolean;
  /** Next to the button. Null when it can be applied. */
  reason: string | null;
  needsAcknowledgement: boolean;
}

/** "Aplicar ajuste à proposta": disabled when nothing is selected, a constraint is violated, an operation has no effect, or the suggestion is stale. */
export function applyState(suggestion: SuggestionView | null, version: number, now: Date): ApplyState {
  if (!suggestion) return { canApply: false, reason: "Peça uma sugestão para ver o efeito antes de aplicar.", needsAcknowledgement: false };
  if (suggestion.baseVersion !== version) return { canApply: false, reason: "A proposta mudou desde o pedido. Peça de novo.", needsAcknowledgement: false };
  if (now.getTime() > Date.parse(suggestion.expiresAt)) return { canApply: false, reason: "Esta sugestão expirou. Peça de novo.", needsAcknowledgement: false };
  if (!suggestion.canApply) return { canApply: false, reason: suggestion.blockedReason ?? "Este ajuste não pode ser aplicado.", needsAcknowledgement: false };
  return { canApply: true, reason: null, needsAcknowledgement: suggestion.needsAcknowledgement };
}

export const STATUS_PILL: Record<"OK" | "VIOLATED" | "UNCHECKABLE", { text: string; tone: "success" | "danger" | "warning" }> = {
  OK: { text: "OK", tone: "success" },
  VIOLATED: { text: "VIOLADA", tone: "danger" },
  UNCHECKABLE: { text: "NÃO VERIFICÁVEL", tone: "warning" },
};

const sign = (n: number) => `${n > 0 ? "+" : ""}${String(Math.round(n * 100) / 100).replace(".", ",")}`;

export interface DiffRows {
  items: Array<{ key: string; where: string; before: string; after: string; scope: string; changedDose: boolean }>;
  volume: Array<{ key: string; where: string; muscle: string; before: string; after: string; delta: string; tone: "up" | "down" }>;
  minutes: Array<{ key: string; where: string; before: string; after: string }>;
  introduced: Array<{ key: string; text: string }>;
  resolved: Array<{ key: string; text: string }>;
  constraints: Array<{ key: string; text: string; status: "OK" | "VIOLATED" | "UNCHECKABLE"; pill: string; tone: "success" | "danger" | "warning"; detail: string | null }>;
  truncated: number;
  summary: string;
}

export function diffRows(diff: AdjustmentDiff): DiffRows {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return {
    items: diff.items.map((r, i) => ({
      key: `${i}-${r.slotKey}`,
      where: `Fase ${r.phaseIndex} · Treino ${r.label}`,
      before: `${r.before.exerciseName} — ${r.before.doseText || "sem dose"}`,
      after: `${r.after.exerciseName} — ${r.after.doseText || "sem dose"}`,
      scope: `${r.scopeText} (${plural(r.sessions, "sessão", "sessões")})`,
      changedDose: r.before.exerciseName === r.after.exerciseName,
    })),
    volume: diff.volume.map((v) => ({
      key: `${v.phaseIndex}-${v.week}-${v.muscle}`, where: `Fase ${v.phaseIndex} · semana ${v.week}`, muscle: muscleLabel(v.muscle),
      before: sign(v.before).replace("+", ""), after: sign(v.after).replace("+", ""), delta: sign(v.delta), tone: v.delta > 0 ? "up" : "down",
    })),
    minutes: diff.minutes.map((m) => ({
      key: `${m.phaseIndex}-${m.week}-${m.slot}`, where: `Fase ${m.phaseIndex} · semana ${m.week}, sessão ${m.slot} (treino ${m.label})`,
      before: m.before === null ? "—" : `≈ ${Math.round(m.before)} min`, after: m.after === null ? "—" : `≈ ${Math.round(m.after)} min`,
    })),
    introduced: diff.audit.introduced.map((f) => ({ key: f.key, text: f.rationale })),
    resolved: diff.audit.resolved.map((f) => ({ key: f.key, text: f.rationale })),
    constraints: diff.constraints.map((c, i) => ({
      key: `${i}-${c.constraint.kind}`, text: constraintText(c.constraint as AdjustConstraint), status: c.status, pill: STATUS_PILL[c.status].text, tone: STATUS_PILL[c.status].tone, detail: c.detail,
    })),
    truncated: diff.volumeTruncated,
    summary: `${plural(diff.counts.itemsChanged, "linha muda", "linhas mudam")} · ${plural(diff.counts.occurrencesTouched, "sessão tocada", "sessões tocadas")}`,
  };
}

/** The three cards of the thread (Figma: "Profissional", "IA · Sugestão", "Confirmar mudança"). */
export interface ThreadCard {
  id: "professional" | "suggestion" | "confirm";
  title: string;
  lines: string[];
  highlight: boolean;
  /** Reason pills of the suggestion card. */
  pills: string[];
}

export function adjustCards(suggestion: SuggestionView | null, apply: ApplyState): ThreadCard[] {
  const confirm: ThreadCard = {
    id: "confirm",
    title: "Confirmar mudança",
    lines: ["Comparar doses, séries, duração e alvos após recalcular.", suggestion ? (apply.canApply ? "Aplicação após revisão" : "Aplicação bloqueada") : "Aplicação após revisão"],
    highlight: false,
    pills: [],
  };
  if (!suggestion) return [confirm];
  const ai = suggestion.mode === "AI";
  const clarification = suggestion.suggestion.clarification;
  return [
    { id: "professional", title: "Profissional", lines: [suggestion.request.text, "Solicitação do profissional"], highlight: false, pills: [] },
    {
      id: "suggestion",
      title: ai ? "IA · Sugestão" : "Alternativa escolhida",
      lines: [clarification ? clarification.text : suggestion.suggestion.text, "Nenhuma alteração aplicada"],
      highlight: true,
      pills: suggestion.suggestion.reasons.map((r) => r.text),
    },
    confirm,
  ];
}

export const SCOPE_CHOICES: Array<{ value: AdjustIntent["scope"]; label: (week: number, slot: number) => string }> = [
  { value: "PHASE", label: () => "Na fase toda" },
  { value: "FROM_WEEK", label: (week) => `Da semana ${week} em diante` },
  { value: "OCCURRENCE", label: (week, slot) => `Só na semana ${week}, sessão ${slot}` },
];
