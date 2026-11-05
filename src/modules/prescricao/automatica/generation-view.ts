/**
 * What the generation screens (Figma GEN-01..08) show, as pure functions: the compact "Base utilizada" strip, the student card, the
 * weeks and workouts of each phase, the equipment choice, the dose policy grouped by modality with one compact line per policy, the
 * editor draft of one policy, and the exact list of pending answers. No React and no database here, so every rule is tested directly.
 *
 * Nothing is invented: every number comes from the screen (`GenerationScreen`), the policy rows of the engine's rule set and the
 * form's own state. A policy the professional did not edit shows the rule set's value; an edit is only recorded when it differs.
 */
import { EQUIPMENT } from "@/modules/biblioteca/metadata/vocabulary";
import { METRIC_LABELS, MODALITY_LABELS, STIMULUS_LABELS, numberText } from "@/modules/prescricao/motor/vocabulary";
import type { DoseParam } from "@/modules/prescricao/motor/types";
import type { GenerationQuestion } from "./contracts";
import type { GenerationSummary } from "./service";
import { PARAM_LABELS, RANGE_PAIRS, countOf, numberOf, progressionOf, type GenerationForm, type PolicyEdits, type PolicyRow, type ProgressionForm } from "./view";

// ---------- small text helpers ----------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const NUMBER_WORDS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze"];
/** "três" for 3 (the structure's cap is 12 phases); a digit beyond the list. */
export const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);
export const phaseLabel = (p: { index: number; name: string | null }): string => `Fase ${String(p.index).padStart(2, "0")}${p.name ? ` · ${p.name}` : ""}`;
export const phaseNumber = (index: number): string => `Fase ${String(index).padStart(2, "0")}`;

// ---------- the compact summary ----------

export interface BaseCell {
  value: string;
  label: string;
  /** "warning" paints the value in the warning colour (an unknown that matters). */
  tone?: "warning";
}

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** The five cells of "BASE UTILIZADA": periodization, library, last assessment, screening, what the draft keeps. */
export function baseCells(s: GenerationSummary): BaseCell[] {
  const library = [s.catalogInferred ? `${s.catalogInferred} ${s.catalogInferred === 1 ? "inferido" : "inferidos"}` : "", s.catalogPending ? `${plural(s.catalogPending, "pendente", "pendentes")}` : ""].filter(Boolean);
  const parq =
    s.parq === "NOT_DONE" ? { value: "Triagem não feita", tone: "warning" as const } : s.parq === "POSITIVE" ? { value: "Triagem com “Sim”", tone: "warning" as const } : { value: "Triagem sem “Sim”" };
  return [
    { value: `${plural(s.phases, "fase", "fases")} · ${plural(s.weeks, "semana", "semanas")}`, label: "Periodização" },
    { value: plural(s.catalogTotal, "exercício", "exercícios"), label: library.length ? `Biblioteca (${library.join(", ")})` : "Biblioteca" },
    { value: s.assessedOn ? brDate(s.assessedOn) : "Nenhuma", label: "Última avaliação" },
    { ...parq, label: "PAR-Q" },
    { value: s.preserved ? plural(s.preserved, "preservado", "preservados") : "Nenhum preservado", label: "Rascunho atual" },
  ];
}

export interface StudentCardView {
  status: "COMPLETO" | "PARCIAL" | "SEM DADOS";
  /** The four facts the generation reads, each as the record says or "não informado". */
  facts: Array<{ label: string; value: string | null }>;
  missing: string[];
  parq: { text: string; warning: boolean };
  findings: string;
}

export function studentCard(s: GenerationSummary): StudentCardView {
  const facts = [
    { label: "Nível", value: s.level },
    { label: "Objetivo", value: s.goal },
    { label: "Dias/semana", value: s.daysPerWeek ? String(s.daysPerWeek) : null },
    { label: "Tempo/sessão", value: s.sessionMinutes ? `${s.sessionMinutes} min` : null },
  ];
  const missing = facts.filter((f) => f.value === null).map((f) => f.label);
  return {
    status: missing.length === 0 ? "COMPLETO" : missing.length === facts.length ? "SEM DADOS" : "PARCIAL",
    facts,
    missing,
    parq:
      s.parq === "NOT_DONE"
        ? { text: "Triagem PAR-Q: não realizada", warning: true }
        : s.parq === "POSITIVE"
          ? { text: "Triagem PAR-Q: com “Sim”", warning: true }
          : { text: "Triagem PAR-Q: sem “Sim”", warning: false },
    findings: s.findings
      ? `${plural(s.findings, "achado", "achados")} da avaliação: contexto, não contraindicação.`
      : "Nenhum achado registrado na avaliação.",
  };
}

/** The sentence of the right panel of GEN-03 about what the records do not say (null when they say all four). */
export function missingFactsText(s: GenerationSummary): string | null {
  const missing = studentCard(s).missing.map((m) => m.replace("Dias/semana", "dias por semana").replace("Tempo/sessão", "tempo de sessão").toLowerCase());
  if (!missing.length) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} e ${missing[missing.length - 1]}`;
  return `${list[0].toUpperCase()}${list.slice(1)}. Não ${missing.length === 1 ? "será preenchido" : "serão preenchidos"} automaticamente.`;
}

// ---------- phases ----------

export interface PhaseSpan {
  index: number;
  start: number;
  end: number;
}

/** First and last week of each phase, counted from the first week of the periodization. */
export function phaseSpans(structure: ReadonlyArray<{ index: number; weeks: number }>): PhaseSpan[] {
  let next = 1;
  return structure.map((p) => {
    const span = { index: p.index, start: next, end: next + Math.max(p.weeks, 1) - 1 };
    next = span.end + 1;
    return span;
  });
}

export const weeksText = (span: Pick<PhaseSpan, "start" | "end">): string => (span.start === span.end ? `Semana ${span.start}` : `Semanas ${span.start}–${span.end}`);

const consecutiveLetters = (labels: readonly string[]) =>
  labels.length >= 2 && labels.every((l, i) => /^[A-Z]$/.test(l) && l.charCodeAt(0) === labels[0].charCodeAt(0) + i);

/** "A, B, C" (desktop), "A a F" when six or more consecutive letters: the labels as the structure has them. */
export function workoutsText(labels: readonly string[]): string {
  if (labels.length >= 4 && consecutiveLetters(labels)) return `${labels[0]} a ${labels[labels.length - 1]}`;
  return labels.join(", ");
}
/** "A/B/C" and "A–F" on the phone. */
export function workoutsShort(labels: readonly string[]): string {
  if (labels.length >= 4 && consecutiveLetters(labels)) return `${labels[0]}–${labels[labels.length - 1]}`;
  return labels.join("/");
}

// ---------- equipment ----------

/** Options shown before "Ver lista completa": "Sem equipamento" plus the first nine of the catalog (5 rows of 2, as in GEN-01). */
export const EQUIPMENT_COLLAPSED = 10;
export const equipmentCodes = (): string[] => Object.keys(EQUIPMENT);

export function equipmentSelection(equipment: GenerationForm["equipment"]): { none: boolean; codes: string[] } {
  return equipment === "NONE" ? { none: true, codes: [] } : { none: false, codes: equipment };
}

/** "Sem equipamento" is exclusive: choosing it clears the rest; choosing another one clears it. Unchecking everything is "not answered". */
export function toggleEquipment(current: GenerationForm["equipment"], code: string | "NONE", checked: boolean): GenerationForm["equipment"] {
  if (code === "NONE") return checked ? "NONE" : [];
  const codes = current === "NONE" ? [] : current;
  return checked ? [...codes.filter((c) => c !== code), code] : codes.filter((c) => c !== code);
}

export function equipmentSummary(equipment: GenerationForm["equipment"]): string {
  const { none, codes } = equipmentSelection(equipment);
  if (none) return "Sem equipamento (só peso do corpo)";
  if (!codes.length) return "Nenhum selecionado";
  const labels = codes.map((c) => EQUIPMENT[c] ?? c);
  return labels.length <= 3 ? labels.join(", ") : `${plural(labels.length, "selecionado", "selecionados")}`;
}

export function equipmentStatus(equipment: GenerationForm["equipment"]): string {
  const { none, codes } = equipmentSelection(equipment);
  if (none) return "Sem equipamento";
  return codes.length ? plural(codes.length, "opção selecionada", "opções selecionadas") : "Nenhuma opção selecionada";
}

// ---------- the dose policy ----------

export interface PolicyTab {
  id: "RESISTANCE" | "CARDIO" | "OTHER";
  long: string;
  short: string;
  modalities: readonly string[];
}

export const POLICY_TABS: readonly PolicyTab[] = [
  { id: "RESISTANCE", long: "Treino resistido", short: "Resistido", modalities: ["RESISTANCE"] },
  { id: "CARDIO", long: "Cardiorrespiratório", short: "Cardio", modalities: ["CARDIO"] },
  { id: "OTHER", long: "Mobilidade e outros", short: "Outros", modalities: [] },
];

export const policyTabOf = (modality: string): PolicyTab["id"] => (modality === "RESISTANCE" ? "RESISTANCE" : modality === "CARDIO" ? "CARDIO" : "OTHER");

/** The tabs that have at least one policy, each with its rows (the rule set's order). */
export function policyTabs(rows: readonly PolicyRow[]): Array<PolicyTab & { rows: PolicyRow[] }> {
  return POLICY_TABS.map((t) => ({ ...t, rows: rows.filter((r) => policyTabOf(r.modality) === t.id) })).filter((t) => t.rows.length > 0);
}

const lower = (text: string) => (text ? text[0].toLowerCase() + text.slice(1) : text);

/**
 * The name of a policy as the list shows it: the stimulus ("Hipertrofia"); the line "any stimulus" and the stimuli that have more than
 * one line in the same modality say the measure too ("Qualquer estímulo · Tempo").
 */
export function policyTitle(row: PolicyRow, all: readonly PolicyRow[]): string {
  const stimulus = row.stimulus === "*" ? "Qualquer estímulo" : (STIMULUS_LABELS[row.stimulus] ?? row.stimulus);
  const shared = all.some((r) => r.key !== row.key && r.modality === row.modality && r.stimulus === row.stimulus);
  return row.stimulus === "*" || shared ? `${stimulus} · ${METRIC_LABELS[row.metric] ?? row.metric}` : stimulus;
}

/** "Treino resistido · repetições" (modality · measure). */
export function policySubtitle(row: PolicyRow): string {
  return `${MODALITY_LABELS[row.modality] ?? row.modality} · ${lower(METRIC_LABELS[row.metric] ?? row.metric)}`;
}

/** The value of one cell: what the professional saved when it is a valid number, otherwise the rule set's value. */
function cellValue(row: PolicyRow, param: DoseParam, edits: PolicyEdits): number | undefined {
  const base = row.defaults.find((d) => d.param === param)?.value;
  const typed = numberOf(edits[`${row.key}:${param}`]);
  return typed ?? base;
}

const range = (min: number | undefined, max: number | undefined, unit = ""): string | null => {
  if (min === undefined && max === undefined) return null;
  const a = min ?? max!;
  const b = max ?? min!;
  return `${a === b ? numberText(a) : `${numberText(a)}–${numberText(b)}`}${unit}`;
};
const seconds = (min: number | undefined, max: number | undefined): string | null => {
  const longRange = (min ?? 0) >= 120 && (max ?? 0) >= 120 && (min ?? 0) % 60 === 0 && (max ?? 0) % 60 === 0;
  return longRange ? range(min! / 60, max! / 60, " min") : range(min, max, " s");
};

/**
 * One compact line with the dose of the policy: "3 × 8–12 • RIR 1–3 • 90 s". It reads the values saved in the form (an edit) or
 * the rule set's, only for the parameters the policy has; nothing is added.
 */
export function doseSummary(row: PolicyRow, edits: PolicyEdits = {}): string {
  const v = (p: DoseParam) => cellValue(row, p, edits);
  const parts: string[] = [];
  const reps = range(v("repsMin"), v("repsMax"));
  const time = seconds(v("durationMin"), v("durationMax"));
  const distance = range(v("distanceMin"), v("distanceMax"), " m");
  const sets = v("sets");
  const amount = reps ?? time ?? distance;
  if (row.metric === "INTERVALS") {
    const blocks = v("blocks");
    const repeats = v("repeats");
    if (blocks !== undefined || repeats !== undefined) parts.push([blocks !== undefined ? plural(blocks, "bloco", "blocos") : "", repeats !== undefined ? `${numberText(repeats)}×` : ""].filter(Boolean).join(" · "));
    const work = seconds(v("workDurationMin"), v("workDurationMax")) ?? range(v("workDistanceMin"), v("workDistanceMax"), " m");
    if (work) parts.push(`esforço ${work}`);
    const recovery = seconds(v("recoveryMin"), v("recoveryMax"));
    if (recovery) parts.push(`recuperação ${recovery}`);
  } else {
    if (amount) parts.push(sets !== undefined ? `${numberText(sets)} × ${amount}` : amount);
    else if (sets !== undefined) parts.push(plural(sets, "série", "séries"));
    const rir = range(v("rirMin"), v("rirMax"));
    if (rir) parts.push(`RIR ${rir}`);
    const rpe = range(v("rpeMin"), v("rpeMax"));
    if (rpe) parts.push(`RPE ${rpe}`);
    const rest = v("restSeconds");
    if (rest !== undefined) parts.push(row.metric === "REPS" ? `${numberText(rest)} s` : `descanso ${numberText(rest)} s`);
  }
  return parts.join(" • ");
}

/** Whether a saved edit changes any value of the policy (an edit equal to the rule set's value is not an edit). */
export function rowEdited(row: PolicyRow, edits: PolicyEdits): boolean {
  return row.defaults.some((d) => {
    const typed = edits[`${row.key}:${d.param}`];
    return typed !== undefined && numberOf(typed) !== d.value;
  });
}

// ---------- the editor of one policy ----------

export type PolicyDraft = Record<string, string>;
export type DraftErrors = Record<string, string>;

const SHORT_LABELS: Partial<Record<DoseParam, string>> = { repsMin: "Reps mín.", repsMax: "Reps máx." };
const UNIT_WORDS: Record<string, string> = { s: "segundos", m: "metros" };

/** The field of one parameter: the short label of GEN-02, its unit (inside the field on the desktop, in the label on the phone) and the full name. */
export function paramField(param: DoseParam): { short: string; unit: "s" | "m" | null; name: string } {
  const full = PARAM_LABELS[param] ?? param;
  const unit = /\((s|m)\)$/.exec(full)?.[1] as "s" | "m" | undefined;
  const short = SHORT_LABELS[param] ?? full.replace(/\s*\((s|m)\)$/, "");
  return { short, unit: unit ?? null, name: unit ? `${short} (${UNIT_WORDS[unit]})` : short };
}

/** The text of each field when the editor opens: the saved edit or the rule set's value. */
export function draftFor(row: PolicyRow, edits: PolicyEdits): PolicyDraft {
  return Object.fromEntries(row.defaults.map((d) => [d.param, edits[`${row.key}:${d.param}`] ?? numberText(d.value)]));
}

/** What is wrong in each field of the draft, by parameter: a number of 0 onwards, a minimum not above its maximum. */
export function validateDraft(row: PolicyRow, draft: PolicyDraft): DraftErrors {
  const errors: DraftErrors = {};
  const numbers: Partial<Record<DoseParam, number>> = {};
  for (const d of row.defaults) {
    const n = numberOf(draft[d.param]);
    if (n === null) errors[d.param] = "Informe um número de 0 em diante.";
    else numbers[d.param] = n;
  }
  for (const [min, max] of RANGE_PAIRS) {
    if (numbers[min] !== undefined && numbers[max] !== undefined && numbers[min]! > numbers[max]!) errors[min] = "O mínimo não pode passar do máximo.";
  }
  return errors;
}

/**
 * The edits of the form with this policy's draft committed. A field equal to the rule set's value is not recorded (a value copied
 * from the default is not an edit); the cells of the other policies stay as they are.
 */
export function commitDraft(row: PolicyRow, edits: PolicyEdits, draft: PolicyDraft): PolicyEdits {
  const next: PolicyEdits = { ...edits };
  for (const d of row.defaults) {
    const key = `${row.key}:${d.param}`;
    const n = numberOf(draft[d.param]);
    if (n === null || n === d.value) delete next[key];
    else next[key] = draft[d.param].trim();
  }
  return next;
}

/** "Restaurar padrão": every saved edit of the policy goes, back to the rule set's values. */
export function restoreRow(row: PolicyRow, edits: PolicyEdits): PolicyEdits {
  const next: PolicyEdits = { ...edits };
  for (const d of row.defaults) delete next[`${row.key}:${d.param}`];
  return next;
}

/** Whether the draft differs from what is saved (so the editor can say there is something to save). */
export function draftDirty(row: PolicyRow, edits: PolicyEdits, draft: PolicyDraft | undefined): boolean {
  if (!draft) return false;
  const saved = draftFor(row, edits);
  return row.defaults.some((d) => (numberOf(draft[d.param]) ?? draft[d.param]) !== (numberOf(saved[d.param]) ?? saved[d.param]));
}

// ---------- the pending answers ----------

export interface PendingItem {
  /** Id of the field in the page (the link of the list goes there). */
  fieldId: string;
  label: string;
  code: GenerationQuestion["code"];
}

export const stimulusFieldId = (phaseIndex: number) => `fig-gen-stimulus-${phaseIndex}`;
export const EQUIPMENT_FIELD_ID = "fig-gen-equipment";
export const countFieldId = (phaseIndex: number, label: string) => `fig-gen-count-${phaseIndex}-${label.replace(/\W+/g, "_")}`;
export const modalityFieldId = (phaseIndex: number, label: string) => `fig-gen-modalities-${phaseIndex}-${label.replace(/\W+/g, "_")}`;

const ORDER: Partial<Record<GenerationQuestion["code"], number>> = { STIMULUS: 0, EQUIPMENT: 1, EXERCISE_COUNT: 2, MODALITIES: 3 };

/** The required questions still open, in the order the screen asks them, each with the field it is answered in. */
export function pendingItems(open: readonly GenerationQuestion[]): PendingItem[] {
  return [...open]
    .sort((a, b) => (ORDER[a.code] ?? 9) - (ORDER[b.code] ?? 9) || (a.phaseIndex ?? 0) - (b.phaseIndex ?? 0) || (a.label ?? "").localeCompare(b.label ?? ""))
    .map((q): PendingItem => {
      const p = q.phaseIndex ?? 0;
      if (q.code === "STIMULUS") return { code: q.code, fieldId: stimulusFieldId(p), label: `Estímulo da ${phaseNumber(p).toLowerCase()}` };
      if (q.code === "EQUIPMENT") return { code: q.code, fieldId: EQUIPMENT_FIELD_ID, label: "Equipamentos disponíveis" };
      if (q.code === "EXERCISE_COUNT") return { code: q.code, fieldId: countFieldId(p, q.label ?? ""), label: `Exercícios do treino ${q.label} · ${phaseNumber(p)}` };
      if (q.code === "MODALITIES") return { code: q.code, fieldId: modalityFieldId(p, q.label ?? ""), label: `Modalidades do treino ${q.label} · ${phaseNumber(p)}` };
      return { code: q.code, fieldId: "", label: q.message };
    });
}

const join = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}` : (parts[0] ?? ""));

function pendingParts(items: readonly PendingItem[], mobile: boolean, totalPhases: number): string[] {
  const stimuli = items.filter((i) => i.code === "STIMULUS").length;
  const counts = items.filter((i) => i.code === "EXERCISE_COUNT").length;
  const modalities = items.filter((i) => i.code === "MODALITIES").length;
  const parts: string[] = [];
  if (stimuli) parts.push(mobile ? (stimuli === totalPhases && stimuli > 1 ? `estímulos das ${stimuli} fases` : stimuli === 1 ? "estímulo de 1 fase" : `estímulos de ${stimuli} fases`) : plural(stimuli, "estímulo", "estímulos"));
  if (items.some((i) => i.code === "EQUIPMENT")) parts.push("equipamentos");
  if (counts) parts.push(mobile ? `exercícios de ${plural(counts, "treino", "treinos")}` : plural(counts, "quantidade de exercícios", "quantidades de exercícios"));
  if (modalities) parts.push(mobile ? `modalidades de ${plural(modalities, "treino", "treinos")}` : plural(modalities, "treino sem modalidade", "treinos sem modalidade"));
  return parts;
}

/** "4 respostas faltam: 3 estímulos e equipamentos" (the footer of the desktop). Empty text when nothing is open. */
export function pendingSummary(items: readonly PendingItem[]): string {
  if (!items.length) return "";
  return `${items.length} ${items.length === 1 ? "resposta falta" : "respostas faltam"}: ${join(pendingParts(items, false, 0))}`;
}

/** "Faltam estímulos das 3 fases e equipamentos." (the footer of the phone). */
export function pendingSummaryShort(items: readonly PendingItem[], totalPhases: number): string {
  if (!items.length) return "";
  return `Falta${items.length === 1 ? "" : "m"} ${join(pendingParts(items, true, totalPhases))}.`;
}

export const pendingCountText = (n: number): string => (n === 0 ? "Escolhas obrigatórias completas" : `${n} ${n === 1 ? "escolha obrigatória pendente" : "escolhas obrigatórias pendentes"}`);
export const pendingPhoneText = (n: number): string => (n === 0 ? "Respostas obrigatórias completas" : `${n} ${n === 1 ? "resposta obrigatória pendente" : "respostas obrigatórias pendentes"}`);

// ---------- validation by field ----------

export type FieldErrors = Record<string, string>;

export const progressionFieldId = (phaseIndex: number) => `fig-gen-progression-${phaseIndex}`;
/** Id of one field of the policy editor (only one editor is mounted at a time). */
export const policyFieldId = (param: string) => `fig-gen-policy-field-${param}`;
export const MINUTES_FIELD_ID = "fig-gen-minutes";

/**
 * What the form refuses, by field (so each message sits next to its field): the progression of a phase, the minutes of a session,
 * the count of exercises of a workout. The keys are the ids of the fields. The server still checks everything again.
 */
export function formFieldErrors(form: GenerationForm): FieldErrors {
  const errors: FieldErrors = {};
  for (const p of form.progression) {
    const out = progressionOf(p as ProgressionForm);
    if (!out.ok) errors[progressionFieldId(p.phaseIndex)] = out.message;
  }
  if (form.availableMinutes.trim()) {
    const n = numberOf(form.availableMinutes);
    if (n === null || !Number.isInteger(n) || n < 1 || n > 600) errors[MINUTES_FIELD_ID] = "Informe minutos inteiros de 1 a 600.";
  }
  for (const c of form.counts) {
    if (c.count.trim() && c.count !== "BY_TIME" && countOf(c.count) === null) errors[countFieldId(c.phaseIndex, c.label)] = "Informe uma quantidade de 1 a 30, ou marque “Pelo tempo disponível”.";
  }
  return errors;
}
