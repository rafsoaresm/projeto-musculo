/**
 * What the screens of the automatic prescription show and send (motor S9, design §6), as pure functions: labels, the dose
 * policy table and its overrides, the generation form turned into answers, the navigation of a proposal (phase → week →
 * session), the bases of an item and the weekly progression of a workout. No database and no React here, so every rule is
 * tested directly; the components only draw what these return.
 *
 * Nothing is invented: an empty field stays empty (never 0), a value the professional did not touch is not sent (the adapter
 * then records its default as an assumption), and nothing is pre-selected where the design says the choice is the professional's.
 */
import type { DoseDefault, RuleSet } from "@/modules/prescricao/motor/rules";
import type {
  Basis,
  DoseParam,
  Issue,
  ItemOut,
  Metric,
  OccurrenceOut,
  PhaseSummary,
  WeeklyProgression,
} from "@/modules/prescricao/motor/types";
import { MODALITY_LABELS, STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";
import type { GenerationAnswersInput, GenerationQuestion } from "./contracts";

// ---------- labels ----------

/** How each basis is named on screen (Q2: "Evidência" only with a verified reference). */
export const BASIS_LABELS: Record<Basis, string> = {
  EVIDENCE: "Evidência (referência verificada)",
  HEURISTIC: "Heurística operacional (editável)",
  HEURISTIC_ACCEPTED: "Heurística aceita por você",
  PROFESSIONAL: "Decisão do profissional",
  STUDENT_DATA: "Dado do aluno",
};
export const BASIS_TONES: Record<Basis, "brand" | "neutral" | "success" | "warning"> = {
  EVIDENCE: "success",
  HEURISTIC: "warning",
  HEURISTIC_ACCEPTED: "brand",
  PROFESSIONAL: "brand",
  STUDENT_DATA: "neutral",
};

/** Origin of an item inside the proposal. */
export const PROPOSAL_ORIGIN_LABELS: Record<ItemOut["origin"], string> = {
  ENGINE: "Proposto pela ferramenta",
  PRESERVED: "Já estava no rascunho",
  LOCKED: "Mantido por você",
  SUBSTITUTED: "Trocado por você",
};

/** Origin of a prescribed row or session dose after the apply (design §6.1, editor). */
export function revisionOriginLabel(origin: string): { text: string; tone: "brand" | "neutral" | "warning" } {
  if (origin === "SYSTEM") return { text: "Proposta automática", tone: "warning" };
  if (origin === "SYSTEM_EDITED") return { text: "Editada por você", tone: "brand" };
  return { text: "Sua", tone: "neutral" };
}

export const METADATA_LABELS: Record<ItemOut["metadata"], string | null> = {
  REVIEWED: null,
  INCLUDES_INFERRED: "Inferido (não revisado)",
  PENDING: "Pendente de curadoria",
  NOT_APPLICABLE: null,
};

export const SEVERITY_LABELS: Record<Issue["severity"], string> = { ERROR: "Impede", WARNING: "Atenção", INFO: "Informação" };
export const SEVERITY_TONES: Record<Issue["severity"], "danger" | "warning" | "neutral"> = { ERROR: "danger", WARNING: "warning", INFO: "neutral" };

export const NOT_UNIVERSAL = "Os valores padrão desta ferramenta não são recomendação universal.";

/** Dose parameters as the professional reads them, with the unit when there is one. */
export const PARAM_LABELS: Record<DoseParam, string> = {
  sets: "Séries",
  repsMin: "Repetições (mín.)",
  repsMax: "Repetições (máx.)",
  durationMin: "Duração mín. (s)",
  durationMax: "Duração máx. (s)",
  distanceMin: "Distância mín. (m)",
  distanceMax: "Distância máx. (m)",
  restSeconds: "Descanso (s)",
  rirMin: "RIR mín.",
  rirMax: "RIR máx.",
  rpeMin: "RPE mín.",
  rpeMax: "RPE máx.",
  blocks: "Blocos",
  repeats: "Repetições do bloco",
  workDurationMin: "Esforço mín. (s)",
  workDurationMax: "Esforço máx. (s)",
  workDistanceMin: "Esforço mín. (m)",
  workDistanceMax: "Esforço máx. (m)",
  recoveryMin: "Recuperação mín. (s)",
  recoveryMax: "Recuperação máx. (s)",
  restBetweenBlocks: "Descanso entre blocos (s)",
};

const TRACE_PARAM_LABELS: Record<string, string> = {
  stimulus: "Estímulo",
  metric: "Medida",
  modality: "Modalidade",
  loadBasis: "Base da carga",
  loadInstruction: "Orientação de carga",
  intensity: "Intensidade",
  tempo: "Cadência",
  method: "Método",
  recoveryMode: "Recuperação",
};
const METRIC_LABELS: Record<string, string> = { REPS: "Repetições", TIME: "Tempo", DISTANCE: "Distância", INTERVALS: "Intervalado", CONTINUOUS: "Contínuo" };
const LOAD_BASIS_LABELS: Record<string, string> = {
  TOTAL: "Total", PER_HAND: "Por mão", PER_SIDE: "Por lado", MACHINE_STACK: "Placas da máquina", BODYWEIGHT: "Peso do corpo", ASSISTANCE: "Assistência", NONE: "Sem carga",
};

/** A traced parameter as the professional reads it ("repsMin" → "Repetições (mín.)"); an unknown one as it is. */
export function traceParamLabel(param: string): string {
  return (PARAM_LABELS as Record<string, string>)[param] ?? TRACE_PARAM_LABELS[param] ?? param;
}

/** Parameters a weekly progression of the form can move (any metric; the engine skips one the dose does not have, with a warning). */
export const PROGRESSION_PARAMS: DoseParam[] = [
  "sets", "repsMin", "repsMax", "rirMin", "rirMax", "restSeconds", "durationMin", "durationMax", "distanceMin", "distanceMax", "repeats",
];

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const shortDate = brDate;

// ---------- the dose policy table ----------

export interface PolicyRow {
  /** Stable key: index in the rule set's table. */
  key: string;
  stimulus: string;
  modality: string;
  metric: Metric;
  /** The rule's values, in the table's order. */
  defaults: Array<{ param: DoseParam; value: number }>;
}

/** The rule set's dose table as rows (Q1: shown and editable before generating, every value a heuristic). */
export function policyRows(rules: RuleSet): PolicyRow[] {
  return rules.rules.DOSE_DEFAULTS.value.map((d: DoseDefault, i) => ({
    key: String(i),
    stimulus: d.stimulus,
    modality: d.modality,
    metric: d.metric,
    defaults: (Object.entries(d.values) as Array<[DoseParam, number]>).map(([param, value]) => ({ param, value })),
  }));
}

/** Edited cells: `${rowKey}:${param}` → text typed. Untouched cells are absent. */
export type PolicyEdits = Record<string, string>;

/** A typed number, or null when empty or not a finite non-negative number. */
export function numberOf(text: string | undefined): number | null {
  if (text === undefined) return null;
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type PolicyOverride = NonNullable<GenerationAnswersInput["policyOverrides"]>[number];

/**
 * The edited policy as overrides (engine `DoseOverride`, applied as the professional's decision). A cell left as it was sends
 * nothing. A "*" row (any stimulus of the modality) is the default of the stimuli without a row of their own: its override names
 * those that have one (`exceptStimuli`), so an edit there never changes a named row, which keeps the value the table shows (its
 * own edit or its heuristic default, still labelled as such). Returns the cells that are not valid numbers instead, so the form
 * can say which.
 */
export function policyOverrides(rows: PolicyRow[], edits: PolicyEdits): { ok: true; overrides: PolicyOverride[] } | { ok: false; invalid: string[] } {
  const invalid: string[] = [];
  const valueOf = (row: PolicyRow, param: DoseParam, fallback: number): number => {
    const text = edits[`${row.key}:${param}`];
    if (text === undefined) return fallback;
    const n = numberOf(text);
    if (n === null) {
      invalid.push(`${row.key}:${param}`);
      return fallback;
    }
    return n;
  };
  const changedValues = (row: PolicyRow) => {
    const values: Partial<Record<DoseParam, number>> = {};
    for (const { param, value } of row.defaults) {
      const next = valueOf(row, param, value);
      if (next !== value) values[param] = next;
    }
    return values;
  };
  const overrides: PolicyOverride[] = [];
  for (const row of rows) {
    const values = changedValues(row);
    if (!Object.keys(values).length) continue;
    if (row.stimulus === "*") {
      const named = [
        ...new Set(rows.filter((r) => r.stimulus !== "*" && r.modality === row.modality && r.metric === row.metric).map((r) => r.stimulus)),
      ];
      overrides.push({ ...(named.length ? { exceptStimuli: named } : {}), modality: row.modality, metric: row.metric, patch: { values } });
    } else overrides.push({ stimulus: row.stimulus, modality: row.modality, metric: row.metric, patch: { values } });
  }
  // Range cells: a minimum above its maximum is refused here, before the engine says so.
  for (const o of overrides) {
    const v = o.patch.values ?? {};
    const row = rows.find((r) => r.modality === o.modality && r.metric === o.metric && (o.stimulus === undefined ? r.stimulus === "*" : r.stimulus === o.stimulus))!;
    const full = { ...Object.fromEntries(row.defaults.map((d) => [d.param, valueOf(row, d.param, d.value)])), ...v } as Record<string, number>;
    for (const [min, max] of RANGE_PAIRS) if (full[min] !== undefined && full[max] !== undefined && full[min] > full[max]) invalid.push(`${row.key}:${min}`);
  }
  return invalid.length ? { ok: false, invalid: [...new Set(invalid)] } : { ok: true, overrides };
}

const RANGE_PAIRS: Array<[DoseParam, DoseParam]> = [
  ["repsMin", "repsMax"], ["durationMin", "durationMax"], ["distanceMin", "distanceMax"], ["rirMin", "rirMax"], ["rpeMin", "rpeMax"],
  ["workDurationMin", "workDurationMax"], ["workDistanceMin", "workDistanceMax"], ["recoveryMin", "recoveryMax"],
];

// ---------- the generation form ----------

export interface ProgressionForm {
  model: "NONE" | "LINEAR" | "STEP";
  param: DoseParam;
  from: string;
  to: string;
  delta: string;
  everyWeeks: string;
  limit: string;
  /** Week numbers, comma separated, e.g. "4" or "4, 8". */
  deloadWeeks: string;
  /** Fraction of the sets kept in a deload week (0 to 1), e.g. "0,5". */
  deloadMultiplier: string;
}

export const EMPTY_PROGRESSION: ProgressionForm = {
  model: "NONE", param: "sets", from: "", to: "", delta: "", everyWeeks: "1", limit: "", deloadWeeks: "", deloadMultiplier: "",
};

export interface GenerationForm {
  stimulus: Array<{ phaseIndex: number; value: string; basis: "PROFESSIONAL" | "HEURISTIC_ACCEPTED"; ruleId?: string }>;
  /** "NONE": no equipment at all. An empty list: not answered yet. */
  equipment: "NONE" | string[];
  availableMinutes: string;
  /** "": not chosen (the adapter's default, recorded as an assumption). */
  timeBudget: "" | "SOFT" | "HARD";
  counts: Array<{ phaseIndex: number; label: string; count: string }>;
  modalities: Array<{ phaseIndex: number; label: string; modalities: string[] }>;
  /** null: the default decided on 04/11/2026 (sent as nothing, recorded as an assumption). */
  doseMode: null | "FILL_FROM_POLICY" | "LEAVE_EMPTY";
  metadataTrust: null | "REVIEWED_AND_INFERRED" | "REVIEWED_ONLY";
  policy: PolicyEdits;
  progression: Array<{ phaseIndex: number } & ProgressionForm>;
  preferredExerciseIds: string[];
  excludedExerciseIds: string[];
  excludedPatterns: string[];
  excludedCautionTags: string[];
}

export const EMPTY_FORM: GenerationForm = {
  stimulus: [], equipment: [], availableMinutes: "", timeBudget: "", counts: [], modalities: [], doseMode: null, metadataTrust: null,
  policy: {}, progression: [], preferredExerciseIds: [], excludedExerciseIds: [], excludedPatterns: [], excludedCautionTags: [],
};

/** Required questions the form has not answered yet (the "Gerar" button waits for none). */
export function openRequired(questions: GenerationQuestion[], form: GenerationForm): GenerationQuestion[] {
  return questions.filter((q) => {
    if (!q.required) return false;
    if (q.code === "STIMULUS") return !form.stimulus.some((s) => s.phaseIndex === q.phaseIndex && s.value.trim());
    if (q.code === "EQUIPMENT") return form.equipment !== "NONE" && form.equipment.length === 0;
    if (q.code === "EXERCISE_COUNT")
      return !form.counts.some((c) => c.phaseIndex === q.phaseIndex && c.label === q.label && (c.count === "BY_TIME" || countOf(c.count) !== null));
    if (q.code === "MODALITIES") return !form.modalities.some((m) => m.phaseIndex === q.phaseIndex && m.label === q.label && m.modalities.length > 0);
    return true;
  });
}

const countOf = (text: string): number | null => {
  const n = numberOf(text);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 30 ? n : null;
};

function weekList(text: string): number[] | null {
  if (!text.trim()) return [];
  const parts = text.split(/[,;\s]+/).filter(Boolean).map(Number);
  return parts.every((n) => Number.isInteger(n) && n >= 1) ? [...new Set(parts)].sort((a, b) => a - b) : null;
}

/** One phase's progression form as the engine's `WeeklyProgression`, or a message saying what to fix. */
export function progressionOf(p: ProgressionForm): { ok: true; progression: WeeklyProgression | null } | { ok: false; message: string } {
  const deload = weekList(p.deloadWeeks);
  if (deload === null) return { ok: false, message: "Semanas de descarga: números inteiros a partir de 1, separados por vírgula." };
  const multiplier = numberOf(p.deloadMultiplier);
  if (deload.length && (multiplier === null || multiplier > 1))
    return { ok: false, message: "Na descarga, informe a fração das séries mantida, de 0 a 1 (ex.: 0,5)." };
  const deloadPart = deload.length ? { deload: { weeks: deload, setsMultiplier: multiplier as number } } : {};
  if (p.model === "NONE") return { ok: true, progression: deload.length ? { model: "CUSTOM", ...deloadPart } : null };
  if (p.model === "LINEAR") {
    const from = numberOf(p.from);
    const to = numberOf(p.to);
    if (from === null || to === null) return { ok: false, message: "Na progressão linear, informe o valor da primeira e da última semana." };
    return { ok: true, progression: { model: "LINEAR", ramps: [{ param: p.param, from, to }], ...deloadPart } };
  }
  const delta = Number(p.delta.trim().replace(",", "."));
  const every = numberOf(p.everyWeeks);
  const limit = p.limit.trim() ? numberOf(p.limit) : undefined;
  if (!p.delta.trim() || !Number.isFinite(delta) || delta === 0) return { ok: false, message: "Na progressão em degraus, informe quanto muda a cada passo (diferente de zero)." };
  if (every === null || !Number.isInteger(every) || every < 1) return { ok: false, message: "Na progressão em degraus, informe a cada quantas semanas (inteiro, 1 ou mais)." };
  if (limit === null) return { ok: false, message: "O limite da progressão em degraus precisa ser um número." };
  return { ok: true, progression: { model: "STEP", steps: [{ param: p.param, delta, everyWeeks: every, ...(limit !== undefined ? { limit } : {}) }], ...deloadPart } };
}

/**
 * The form as the answers the server parses strictly. Only what the professional chose goes: empty fields and the two untouched
 * defaults are left out (the adapter records the default it used as an assumption). Errors name what to fix.
 */
export function answersFromForm(form: GenerationForm, rows: PolicyRow[]): { ok: true; answers: GenerationAnswersInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const answers: GenerationAnswersInput = {};
  const stimulus = form.stimulus.filter((s) => s.value.trim());
  if (stimulus.length)
    answers.stimulusByPhase = stimulus.map((s) => ({ phaseIndex: s.phaseIndex, value: s.value.trim(), basis: s.basis, ...(s.ruleId ? { ruleId: s.ruleId } : {}) }));
  if (form.equipment === "NONE") answers.equipmentCodes = "NONE";
  else if (form.equipment.length) answers.equipmentCodes = [...form.equipment].sort();
  if (form.availableMinutes.trim()) {
    const n = numberOf(form.availableMinutes);
    if (n === null || !Number.isInteger(n) || n < 1 || n > 600) errors.push("Tempo por sessão: minutos inteiros de 1 a 600.");
    else answers.availableMinutes = n;
  }
  if (form.timeBudget) answers.timeBudget = form.timeBudget;
  const counts = form.counts.filter((c) => c.count.trim());
  for (const c of counts) if (c.count !== "BY_TIME" && countOf(c.count) === null) errors.push(`Fase ${c.phaseIndex}, treino ${c.label}: quantidade de 1 a 30, ou "pelo tempo disponível".`);
  if (counts.length) answers.exerciseCountByWorkout = counts.map((c) => ({ phaseIndex: c.phaseIndex, label: c.label, count: c.count === "BY_TIME" ? "BY_TIME" : (countOf(c.count) ?? 1) }));
  const modalities = form.modalities.filter((m) => m.modalities.length);
  if (modalities.length) answers.modalitiesByWorkout = modalities;
  if (form.doseMode) answers.doseMode = form.doseMode;
  if (form.metadataTrust) answers.metadataTrust = form.metadataTrust;
  const policy = policyOverrides(rows, form.policy);
  if (!policy.ok) errors.push(`Política de doses: confira ${policy.invalid.length === 1 ? "1 valor" : `${policy.invalid.length} valores`} (números de 0 em diante; mínimo até o máximo).`);
  else if (policy.overrides.length) answers.policyOverrides = policy.overrides;
  const progressions: NonNullable<GenerationAnswersInput["progressionByPhase"]> = [];
  for (const p of form.progression) {
    const out = progressionOf(p);
    if (!out.ok) errors.push(`Fase ${p.phaseIndex}: ${out.message}`);
    else if (out.progression) progressions.push({ phaseIndex: p.phaseIndex, progression: out.progression });
  }
  if (progressions.length) answers.progressionByPhase = progressions;
  if (form.preferredExerciseIds.length) answers.preferredExerciseIds = [...new Set(form.preferredExerciseIds)];
  if (form.excludedExerciseIds.length) answers.excludedExerciseIds = [...new Set(form.excludedExerciseIds)];
  if (form.excludedPatterns.length) answers.excludedPatterns = [...new Set(form.excludedPatterns)];
  if (form.excludedCautionTags.length) answers.excludedCautionTags = [...new Set(form.excludedCautionTags)];
  return errors.length ? { ok: false, errors } : { ok: true, answers };
}

/**
 * The answers of an earlier generation back into the form ("Usar as respostas da geração anterior"): only what fits the current
 * structure (phases and workouts that still exist) and the current rule table; anything else is dropped, never guessed.
 */
export function formFromAnswers(
  raw: unknown,
  structure: Array<{ index: number; workouts: Array<{ label: string }> }>,
  rows: PolicyRow[],
): GenerationForm {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const phases = new Set(structure.map((p) => p.index));
  const hasWorkout = (phaseIndex: number, label: string) => structure.some((p) => p.index === phaseIndex && p.workouts.some((w) => w.label === label));
  const form: GenerationForm = { ...EMPTY_FORM, policy: {} };
  form.stimulus = arr<GenerationForm["stimulus"][number]>(a.stimulusByPhase).filter((s) => phases.has(s?.phaseIndex) && typeof s.value === "string");
  form.equipment = a.equipmentCodes === "NONE" ? "NONE" : arr<string>(a.equipmentCodes).filter((c) => typeof c === "string");
  form.availableMinutes = typeof a.availableMinutes === "number" ? String(a.availableMinutes) : "";
  form.timeBudget = a.timeBudget === "SOFT" || a.timeBudget === "HARD" ? a.timeBudget : "";
  form.counts = arr<{ phaseIndex: number; label: string; count: number | "BY_TIME" }>(a.exerciseCountByWorkout)
    .filter((c) => hasWorkout(c?.phaseIndex, c?.label))
    .map((c) => ({ phaseIndex: c.phaseIndex, label: c.label, count: String(c.count) }));
  form.modalities = arr<GenerationForm["modalities"][number]>(a.modalitiesByWorkout).filter((m) => hasWorkout(m?.phaseIndex, m?.label));
  form.doseMode = a.doseMode === "FILL_FROM_POLICY" || a.doseMode === "LEAVE_EMPTY" ? a.doseMode : null;
  form.metadataTrust = a.metadataTrust === "REVIEWED_ONLY" || a.metadataTrust === "REVIEWED_AND_INFERRED" ? a.metadataTrust : null;
  for (const o of arr<PolicyOverride>(a.policyOverrides)) {
    if (o.phaseIndex !== undefined || o.label !== undefined || o.exerciseId !== undefined) continue;
    const row = rows.find((r) => r.modality === o.modality && r.metric === o.metric && (o.stimulus === undefined ? r.stimulus === "*" : r.stimulus === o.stimulus));
    if (!row) continue;
    for (const [param, value] of Object.entries(o.patch?.values ?? {}))
      if (row.defaults.some((d) => d.param === param && d.value !== value)) form.policy[`${row.key}:${param}`] = String(value);
  }
  form.progression = arr<{ phaseIndex: number; progression: WeeklyProgression }>(a.progressionByPhase)
    .filter((p) => phases.has(p?.phaseIndex))
    .flatMap((p) => {
      const g = p.progression;
      const deload = g.deload ? { deloadWeeks: g.deload.weeks.join(", "), deloadMultiplier: String(g.deload.setsMultiplier) } : {};
      if (g.model === "LINEAR" && g.ramps?.length === 1)
        return [{ ...EMPTY_PROGRESSION, ...deload, phaseIndex: p.phaseIndex, model: "LINEAR" as const, param: g.ramps[0].param, from: String(g.ramps[0].from), to: String(g.ramps[0].to) }];
      if (g.model === "STEP" && g.steps?.length === 1) {
        const s = g.steps[0];
        return [{ ...EMPTY_PROGRESSION, ...deload, phaseIndex: p.phaseIndex, model: "STEP" as const, param: s.param, delta: String(s.delta), everyWeeks: String(s.everyWeeks), limit: s.limit === undefined ? "" : String(s.limit) }];
      }
      if (g.deload) return [{ ...EMPTY_PROGRESSION, ...deload, phaseIndex: p.phaseIndex }];
      return [];
    });
  form.preferredExerciseIds = arr<string>(a.preferredExerciseIds);
  form.excludedExerciseIds = arr<string>(a.excludedExerciseIds);
  form.excludedPatterns = arr<string>(a.excludedPatterns);
  form.excludedCautionTags = arr<string>(a.excludedCautionTags);
  return form;
}

// ---------- the proposal ----------

/** The phase chosen in the address among the generated ones (the first generated when absent or not generated). */
export function pickPhase(phases: PhaseSummary[], generated: number[], raw: string | undefined): number | null {
  const n = Number(raw);
  const available = phases.filter((p) => generated.includes(p.phaseIndex)).map((p) => p.phaseIndex);
  if (available.includes(n)) return n;
  return available[0] ?? null;
}

/** The week chosen in the address, kept inside the phase (1 when absent or out of range). */
export function pickWeek(phase: PhaseSummary | undefined, raw: string | undefined): number {
  const n = Number(raw);
  return phase && Number.isInteger(n) && n >= 1 && n <= phase.weeks ? n : 1;
}

/** The distinct bases of an item's trace, in a fixed order: what the "Por quê?" pills show. */
export function itemBases(item: Pick<ItemOut, "trace">): Basis[] {
  const seen = new Set<Basis>([...item.trace.selection.map((t) => t.basis), ...item.trace.params.map((p) => p.basis)]);
  return (["EVIDENCE", "STUDENT_DATA", "PROFESSIONAL", "HEURISTIC_ACCEPTED", "HEURISTIC"] as Basis[]).filter((b) => seen.has(b));
}

/** A traced value as text: numbers and words as they are, ranges as "a–b", anything else as compact JSON. */
export function traceValue(value: unknown, param?: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    if (param === "stimulus") return STIMULUS_LABELS[value] ?? value;
    if (param === "metric") return METRIC_LABELS[value] ?? value;
    if (param === "loadBasis") return LOAD_BASIS_LABELS[value] ?? value;
    if (param === "modality") return MODALITY_LABELS[value] ?? value;
  }
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && value && "min" in value && "max" in value) {
    const r = value as { min: unknown; max: unknown };
    return r.min === r.max ? String(r.min) : `${String(r.min)}–${String(r.max)}`;
  }
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** Issues of one phase (and the ones without a phase), errors first. */
export function issuesOfPhase(issues: Issue[], phaseIndex: number): Issue[] {
  const rank = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
  return issues.filter((i) => i.phaseIndex === undefined || i.phaseIndex === phaseIndex).sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface ProgressionRow {
  slotKey: string;
  name: string;
  /** One text per week of the phase; "—" when the exercise is not in that week's sessions of the workout. */
  cells: string[];
}

/**
 * How each exercise of a workout moves across the weeks of a phase: the dose of its first session in each week. Several sessions
 * of a week with different doses show the first one followed by "…".
 */
export function proposalProgression(occurrences: OccurrenceOut[], phaseIndex: number, weeks: number, label: string): ProgressionRow[] {
  const rows = new Map<string, ProgressionRow>();
  const ofWorkout = occurrences.filter((o) => o.phaseIndex === phaseIndex && o.label === label).sort((a, b) => a.week - b.week || a.slot - b.slot);
  for (const o of ofWorkout)
    for (const item of o.items) {
      const row = rows.get(item.slotKey) ?? { slotKey: item.slotKey, name: item.exerciseName, cells: Array.from({ length: weeks }, () => "—") };
      const text = item.display.doseText || "Dose em branco";
      const at = o.week - 1;
      if (at >= 0 && at < weeks) {
        if (row.cells[at] === "—") row.cells[at] = text;
        else if (row.cells[at] !== text && !row.cells[at].endsWith("…")) row.cells[at] = `${row.cells[at]} …`;
      }
      rows.set(item.slotKey, row);
    }
  return [...rows.values()];
}

/** Workout labels of a phase as the sessions show them, in the order they first appear. */
export function labelsOf(occurrences: OccurrenceOut[], phaseIndex: number): string[] {
  const out: string[] = [];
  for (const o of occurrences) if (o.phaseIndex === phaseIndex && !out.includes(o.label)) out.push(o.label);
  return out;
}

/** "≈ 52 min de 45" / "≈ 52 min" / null (no estimate). */
export function durationText(o: Pick<OccurrenceOut, "estimatedMinutes" | "durationComplete" | "budgetMinutes">): string | null {
  if (o.estimatedMinutes === null) return null;
  const base = `${o.durationComplete ? "≈" : "≥"} ${o.estimatedMinutes} min`;
  return o.budgetMinutes ? `${base} de ${o.budgetMinutes}` : base;
}
