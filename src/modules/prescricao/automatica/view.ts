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
  AuditFinding,
  AuditMuscleRow,
  AuditPhase,
  AuditRange,
  AuditReport,
  AuditTarget,
  AuditUnit,
  AuditWeek,
  Basis,
  DoseParam,
  HistorySuggestion,
  Issue,
  ItemOut,
  Metric,
  ParamTrace,
  OccurrenceOut,
  PhaseSummary,
  ProgressionProposal,
  RuleSetRef,
  RuleUse,
  VolumeRow,
  WorkoutSummary,
  WeeklyProgression,
  WeeklySetsTarget,
} from "@/modules/prescricao/motor/types";
import { parseSlotKey } from "@/modules/prescricao/motor/select";
import type { TargetSuggestion, TargetSuggestionOutcome } from "@/modules/prescricao/motor/targets";
import {
  AUDIT_LABELS,
  DOSE_PARAM_LABELS,
  MODALITY_LABELS,
  MUSCLE_LABELS,
  PATTERN_LABELS,
  STIMULUS_LABELS,
  numberText,
} from "@/modules/prescricao/motor/vocabulary";
import { ORIGIN_LABELS, ROLE_LABELS, itemProvenance, type OriginKind } from "./blueprint-view";
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

/** Dose parameters as the professional reads them, with the unit when there is one (the engine's own labels). */
export const PARAM_LABELS = DOSE_PARAM_LABELS;

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

export const RANGE_PAIRS: Array<[DoseParam, DoseParam]> = [
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
  /** Targets of each phase: a suggestion accepted as is, or the professional's own (design V3 §7.4). Optional. */
  coverage: CoverageAnswer[];
  /** The professional's targets per workout (free splits). Optional. */
  coverageByWorkout: WorkoutCoverageAnswer[];
  /**
   * Opt-in to the dose profiles (rules 2026.11.6, heuristic to be validated by the Técnico). Unchecked: the generation keeps the
   * default rules. It is not an answer of the request: it pins the rules version the generation is made with (`rulesVersion`).
   */
  doseProfiles: boolean;
}

/** The published rules version that carries the dose profiles; the server accepts no other opt-in (`OPT_IN_RULESETS`). */
export const DOSE_PROFILES_RULES_VERSION = "2026.11.6";

export const EMPTY_FORM: GenerationForm = {
  stimulus: [], equipment: [], availableMinutes: "", timeBudget: "", counts: [], modalities: [], doseMode: null, metadataTrust: null,
  policy: {}, progression: [], preferredExerciseIds: [], excludedExerciseIds: [], excludedPatterns: [], excludedCautionTags: [],
  coverage: [], coverageByWorkout: [], doseProfiles: false,
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

export const countOf = (text: string): number | null => {
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
  if (form.coverage.length) answers.phaseCoverage = form.coverage.map((c) => ({ ...c }));
  if (form.coverageByWorkout.length) answers.coverageByWorkout = form.coverageByWorkout.map((c) => ({ ...c }));
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
  // Targets: only the professional's own come back. A suggestion accepted then is checked against today's rule on "Gerar", so it
  // is accepted again on screen rather than restored and possibly refused.
  form.coverage = arr<CoverageAnswer>(a.phaseCoverage).filter((c) => phases.has(c?.phaseIndex) && c.basis === "PROFESSIONAL");
  form.coverageByWorkout = arr<WorkoutCoverageAnswer>(a.coverageByWorkout).filter((c) => hasWorkout(c?.phaseIndex, c?.label));
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

const KIND_PARAMS: ReadonlySet<string> = new Set(["stimulus", "modality", "metric"]);
const BASIS_ORDER: Basis[] = ["EVIDENCE", "STUDENT_DATA", "PROFESSIONAL", "HEURISTIC_ACCEPTED", "HEURISTIC"];
const ordered = (seen: Set<Basis>) => BASIS_ORDER.filter((b) => seen.has(b));

/** The distinct bases of an item's trace, in a fixed order. */
export function itemBases(item: Pick<ItemOut, "trace">): Basis[] {
  return ordered(new Set<Basis>([...item.trace.selection.map((t) => t.basis), ...item.trace.params.map((p) => p.basis)]));
}

/**
 * The bases of an item split by what they back: the choice of the exercise and the values of its dose. The pills then say which
 * basis belongs to which (a professional's stimulus next to a heuristic dose is not "Decisão do profissional" for the dose).
 */
export function itemBasisGroups(item: Pick<ItemOut, "trace">): { selection: Basis[]; dose: Basis[] } {
  return {
    // Stimulus, modality and measure say what kind of work it is (they back the choice); the dose is the values themselves.
    selection: ordered(new Set([...item.trace.selection.map((t) => t.basis), ...item.trace.params.filter((p) => KIND_PARAMS.has(p.param)).map((p) => p.basis)])),
    dose: ordered(new Set(item.trace.params.filter((p) => !KIND_PARAMS.has(p.param)).map((p) => p.basis))),
  };
}

/** How a weekly progression model is named on screen. */
export const PROGRESSION_MODEL_LABELS: Record<WeeklyProgression["model"], string> = {
  NONE: "sem progressão",
  LINEAR: "linear",
  STEP: "em degraus",
  SEQUENCE: "ondulatória",
  BLOCK: "em blocos",
  CUSTOM: "personalizada",
};

const HISTORY_ACTIONS: Record<ProgressionProposal["action"], string> = {
  INCREASE: "Sugestão por histórico: aumentar a carga",
  MAINTAIN: "Sugestão por histórico: manter a carga",
  REVIEW: "Histórico pede revisão",
  INSUFFICIENT_DATA: "Histórico insuficiente para sugerir",
};

/**
 * The suggestion the engine read from the student's logs for one item of a phase, as text (design: "a progressão por histórico é
 * só sugestão"). Never applied to the dose: the professional decides. Null when the engine made none for this item.
 */
export function historySuggestionText(
  suggestions: readonly HistorySuggestion[],
  phaseIndex: number,
  slotKey: string,
): { title: string; detail: string; tone: "brand" | "warning" | "neutral"; basis: Basis } | null {
  const s = suggestions.find((x) => x.phaseIndex === phaseIndex && x.slotKey === slotKey);
  if (!s) return null;
  const p = s.proposal;
  const load = p.suggestedLoadKg !== null ? ` (${String(p.suggestedLoadKg).replace(".", ",")} kg)` : "";
  const used = p.exposuresUsed ? ` Registros usados: ${p.exposuresUsed}.` : "";
  return {
    title: `${HISTORY_ACTIONS[p.action]}${load}`,
    detail: `${p.explanation}${used}`,
    tone: p.action === "REVIEW" ? "warning" : p.action === "INSUFFICIENT_DATA" ? "neutral" : "brand",
    basis: p.basis,
  };
}

export interface VolumeView {
  muscle: string;
  direct: string;
  indirect: string;
  weighted: string;
  sessions: number;
  /** Sessions of the week with this muscle as principal (audit presence); "—" without an audit. */
  directSessions: string;
  /** The muscle's target in this phase (audit row), or null. */
  target: string | null;
}

/**
 * The weekly sets per muscle of one week of a phase (direct = principal, indirect = secondary), most worked first. With the
 * audit, also the sessions with direct stimulus and the muscle's target ("—" when the week has items that could not be counted
 * and the muscle was not seen: unknown, not 0).
 */
export function weekVolume(volume: readonly VolumeRow[], phaseIndex: number, week: number, audit: AuditReport | null = null): VolumeView[] {
  const n = (x: number) => String(x).replace(".", ",");
  const phase = audit?.phases.find((p) => p.phaseIndex === phaseIndex);
  const row = phase?.weekRows[week - 1];
  const direct = (muscle: string): string => {
    if (!row) return "—";
    const seen = row.directSessions[muscle];
    if (seen !== undefined) return String(seen);
    return row.uncountedItems > 0 ? "—" : "0";
  };
  const target = (muscle: string): string | null => {
    const m = phase?.muscles.find((x) => x.muscle === muscle);
    return m && (m.target || m.isTarget) ? targetCell(m.target, m.isTarget) : null;
  };
  return volume
    .filter((v) => v.phaseIndex === phaseIndex && v.week === week)
    .sort((a, b) => b.weightedSets - a.weightedSets || a.muscle.localeCompare(b.muscle))
    .map((v) => ({
      muscle: MUSCLE_LABELS[v.muscle] ?? v.muscle,
      direct: n(v.directSets),
      indirect: n(v.indirectSets),
      weighted: n(v.weightedSets),
      sessions: v.occurrences,
      directSessions: direct(v.muscle),
      target: target(v.muscle),
    }));
}

/** The label of a rule for a tooltip ("Pesos da pontuação de seleção…"), or its id when the summary does not list it. */
export function ruleLabel(rulesUsed: readonly RuleUse[], ruleId: string): string {
  return rulesUsed.find((r) => r.ruleId === ruleId)?.label ?? ruleId;
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

// ---------- the plan audit (design V3 §3.9, §7.1) ----------

/** The audit the screen shows, where it came from and with which rules. */
export interface AuditSource {
  report: AuditReport;
  /** STORED: recorded with the proposal (recomputed on every change); VIEW: computed now for a proposal recorded before it. */
  source: "STORED" | "VIEW";
  rules: RuleSetRef;
}

/** The audit recorded in the summary the page already loaded (no extra read), or null for a proposal generated before it. */
export function storedAudit(summary: { audit?: AuditReport }): AuditSource | null {
  return summary.audit ? { report: summary.audit, source: "STORED", rules: summary.audit.rules } : null;
}

/**
 * The page's audit: the one recorded in the summary already loaded, with no call and no read; only a proposal generated before
 * the audit calls `compute` (the service's `viewAudit`, design V3 §3.9). Null when there is none.
 */
export async function pageAudit(
  summary: { audit?: AuditReport },
  compute: () => Promise<{ status: "ok"; audit: AuditReport; source: AuditSource["source"]; rules: RuleSetRef } | { status: "not_found" }>,
): Promise<AuditSource | null> {
  const stored = storedAudit(summary);
  if (stored) return stored;
  const out = await compute();
  return out.status === "ok" ? { report: out.audit, source: out.source, rules: out.rules } : null;
}

/**
 * The audit that may add columns to the weekly volume table. That table shows the volume stored with the proposal; only a
 * recorded audit comes from the same reading. One computed now uses today's library, so its counts could disagree with the
 * stored ones in the same row: it stays in its own panel.
 */
export function weekTableAudit(audit: AuditSource | null): AuditReport | null {
  return audit?.source === "STORED" ? audit.report : null;
}

/**
 * Whether the proposal's own rule set offers suggested targets to accept (`MICROCYCLE_TARGET_SUGGESTIONS`, rules 2026.11.4+).
 * A regeneration runs with the proposal's rule set, which would refuse an acceptance that its rules cannot back, so no card or
 * accept button is offered otherwise (design V3 §3.9, review point 9).
 */
export function canAcceptSuggestions(rules: Pick<RuleSet, "rules"> | null): boolean {
  return Boolean(rules && "MICROCYCLE_TARGET_SUGGESTIONS" in rules.rules);
}

/**
 * Phases the recorded audit says have no targets (`AUDIT_NO_TARGETS`), when the proposal's own rules can back an acceptance:
 * the only phases whose suggested-targets card is drawn. An audit computed now offers no card (its rules are not the proposal's).
 */
export function phasesWithoutTargets(audit: AuditSource | null, acceptSuggestions: boolean): number[] {
  if (!audit || audit.source !== "STORED" || !acceptSuggestions) return [];
  return [...new Set(audit.report.findings.filter((f) => f.code === "AUDIT_NO_TARGETS" && f.phaseIndex !== undefined).map((f) => f.phaseIndex!))].sort((a, b) => a - b);
}

const num = (n: number) => numberText(Math.round(n * 100) / 100);

/** "4" / "3–4"; null stays null (the caller says what it means). */
export function rangeText(r: AuditRange | null): string | null {
  if (!r) return null;
  return r.min === r.max ? num(r.min) : `${num(r.min)}–${num(r.max)}`;
}

const UNIT_TEXT: Record<AuditUnit, [string, string]> = {
  DIRECT_SETS: ["série direta", "séries diretas"],
  INDIRECT_SETS: ["série indireta", "séries indiretas"],
  WEIGHTED_SETS: ["série ponderada", "séries ponderadas"],
  SESSIONS: ["sessão", "sessões"],
  SHARE: ["", ""],
  MINUTES: ["min", "min"],
  ITEMS: ["item", "itens"],
  RATIO: ["", ""],
};

/** A measured or target number with its unit ("0 séries diretas", "45%", "3,5 : 1", "38 min"). */
export function auditValueText(unit: AuditUnit, value: number): string {
  if (unit === "SHARE") return `${num(value * 100)}%`;
  if (unit === "RATIO") return `${num(value)} : 1`;
  const [one, many] = UNIT_TEXT[unit];
  return `${num(value)} ${value === 1 ? one : many}`;
}

/** "≥ 1 sessão", "≤ 20 séries ponderadas", "10–20 séries ponderadas"; null without bounds. */
export function auditTargetText(t: AuditTarget): string | null {
  if (t.min !== undefined && t.max !== undefined) return t.min === t.max ? auditValueText(t.unit, t.min) : `${num(t.min)}–${auditValueText(t.unit, t.max)}`;
  if (t.min !== undefined) return `≥ ${auditValueText(t.unit, t.min)}`;
  if (t.max !== undefined) return `≤ ${auditValueText(t.unit, t.max)}`;
  return null;
}

export interface AuditFindingView {
  key: string;
  /** The phase the finding is about (null for the plan as a whole). */
  phaseIndex: number | null;
  code: string;
  label: string;
  severity: AuditFinding["severity"];
  /** "Escolha do profissional" for BY_DESIGN; null otherwise (the group already says the rest). */
  statusText: string | null;
  /** "Semana 3 · treino A · Quadríceps" (the group names the phase); null when there is nothing more to say. */
  location: string | null;
  /** "Medido: 0 sessões na semana 3 (antes: …)"; null when the finding measures nothing. */
  measured: string | null;
  /** The target with its basis, or "Sem alvo definido" (never a heuristic presented as a target). */
  target: { text: string; basis: Basis | null };
  /**
   * A bound of the target that comes from a rule threshold, not from the student or the professional (the lower bound of the
   * time-use range: a fraction of the time available). Shown apart, labelled as the heuristic it is; null otherwise.
   */
  threshold: { text: string; basis: "HEURISTIC" } | null;
  rationale: string;
  suggestedAction: string | null;
  /** Rows aggregated by the technical limit: "(14 achados iguais agrupados)". */
  aggregated: string | null;
  links: Array<{ phaseIndex: number; week?: number; text: string }>;
  /** `AUDIT_NO_TARGETS` with an acceptance the proposal's rules can back (recorded audit only). The card itself comes later. */
  offerSuggestion: boolean;
}

export interface AuditGroupView {
  phaseIndex: number | null;
  title: string;
  findings: AuditFindingView[];
}

export interface AuditView {
  auditVersion: string;
  rules: RuleSetRef;
  source: AuditSource["source"];
  /** Only for an audit computed now: says so, with the rules and the engine of the proposal. */
  viewNotice: string | null;
  kpis: { sessionsPerWeek: string; attention: number; observations: number; phases: string };
  attention: AuditGroupView[];
  observations: AuditGroupView[];
  descriptive: AuditGroupView[];
}

const muscleName = (m: string) => MUSCLE_LABELS[m] ?? m;
/** Pairs of AUDIT_BALANCE_PAIRS as the professional reads them. */
const PAIR_LABELS: Record<string, string> = {
  KNEE_HIP: "dominantes de joelho × de quadril",
  PUSH_PULL: "empurrar × puxar",
};
const patternName = (p: string) => PATTERN_LABELS[p] ?? p;

function findingView(f: AuditFinding, n: number, offer: boolean): AuditFindingView {
  const where: string[] = [];
  const toPhase = f.toPhaseIndex !== undefined && f.toPhaseIndex !== f.phaseIndex ? f.toPhaseIndex : null;
  if (f.week !== undefined) where.push(`Semana ${f.week}${f.toWeek !== undefined ? ` → ${toPhase !== null ? `fase ${toPhase}, ` : ""}semana ${f.toWeek}` : ""}`);
  if (f.label) where.push(`treino ${f.label}`);
  if (f.muscle) where.push(muscleName(f.muscle));
  if (f.pattern) where.push(f.code === "AUDIT_PATTERN_IMBALANCE" ? (PAIR_LABELS[f.pattern] ?? f.pattern) : `padrão ${patternName(f.pattern)}`);
  const m = f.measured;
  const sides = f.code === "AUDIT_PATTERN_IMBALANCE" && m?.detail && m.detail.a !== undefined && m.detail.b !== undefined ? m.detail : null;
  // AUDIT_INDIRECT_ONLY: `value` counts the muscles; what was measured is each muscle's weekly maximum (in `detail`).
  const perMuscle = f.code === "AUDIT_INDIRECT_ONLY" && m?.detail && Object.keys(m.detail).length ? m.detail : null;
  const measured = !m
    ? null
    : perMuscle
      ? `Medido (máximo semanal, ${UNIT_TEXT[m.unit][1]}): ${Object.entries(perMuscle).map(([k, v]) => `${muscleName(k)} ${num(v)}`).join(" · ")}`
      : sides
      // the two sides as measured (sets, or sessions when some sets are unknown); "0" on one side is "no stimulus there", not a ratio
      ? `Medido: ${num(sides.a)} × ${num(sides.b)} ${m.unit === "SESSIONS" ? "sessões" : "séries diretas"}`
      : `Medido: ${auditValueText(m.unit, m.value)}${m.from !== undefined ? ` (antes: ${auditValueText(m.unit, m.from)})` : ""}`;
  // The time-use range: its upper bound is the time available (student data or the professional's), its lower bound is the
  // rule's threshold (a heuristic). One basis pill cannot cover both, so the threshold goes on a line of its own.
  const split = f.target && f.target.origin === "AVAILABILITY" && f.target.ruleId && f.target.min !== undefined && f.target.max !== undefined;
  const shown: AuditTarget | undefined = split ? { unit: f.target!.unit, max: f.target!.max!, basis: f.target!.basis, origin: f.target!.origin } : f.target;
  const targetText = shown ? auditTargetText(shown) : null;
  const threshold: AuditFindingView["threshold"] = split ? { text: `Limiar de uso: ${auditValueText(f.target!.unit, f.target!.min!)}`, basis: "HEURISTIC" } : null;
  const links: AuditFindingView["links"] = [];
  if (f.phaseIndex !== undefined) {
    if (f.week !== undefined) links.push({ phaseIndex: f.phaseIndex, week: f.week, text: `Ver a semana ${f.week} da fase ${f.phaseIndex}` });
    else links.push({ phaseIndex: f.phaseIndex, text: `Ver a fase ${f.phaseIndex}` });
    const toPhase = f.toPhaseIndex ?? f.phaseIndex;
    if (f.toWeek !== undefined && (toPhase !== f.phaseIndex || f.toWeek !== f.week))
      links.push({ phaseIndex: toPhase, week: f.toWeek, text: `Ver a semana ${f.toWeek} da fase ${toPhase}` });
  }
  return {
    key: `${f.code}-${f.phaseIndex ?? "x"}-${f.week ?? "x"}-${f.label ?? ""}-${f.muscle ?? f.pattern ?? ""}-${n}`,
    phaseIndex: f.phaseIndex ?? null,
    code: f.code,
    label: AUDIT_LABELS[f.code] ?? f.code,
    severity: f.severity,
    statusText: f.status === "BY_DESIGN" ? "Escolha do profissional" : null,
    location: where.length ? where.join(" · ") : null,
    measured,
    // The upper bound of the time-use range is the time available, not a target the plan should stay under.
    target: split
      ? { text: `Tempo disponível: ${auditValueText(f.target!.unit, f.target!.max!)}`, basis: f.target!.basis }
      : targetText && f.target ? { text: `Alvo: ${targetText}`, basis: f.target.basis } : { text: "Sem alvo definido", basis: null },
    threshold,
    rationale: f.rationale,
    suggestedAction: f.suggestedAction,
    aggregated: f.count && f.count > 1 ? `(${f.count} achados iguais agrupados)` : null,
    links,
    offerSuggestion: offer && f.code === "AUDIT_NO_TARGETS",
  };
}

function byPhase(findings: AuditFindingView[], source: AuditFinding[]): AuditGroupView[] {
  const groups = new Map<string, AuditGroupView>();
  findings.forEach((v, n) => {
    const p = source[n].phaseIndex ?? null;
    const key = p === null ? "plan" : String(p);
    const g = groups.get(key) ?? { phaseIndex: p, title: p === null ? "Plano inteiro" : `Fase ${p}`, findings: [] };
    g.findings.push(v);
    groups.set(key, g);
  });
  return [...groups.values()].sort((a, b) => (a.phaseIndex ?? 0) - (b.phaseIndex ?? 0));
}

/**
 * The audit panel's model: KPIs, findings split into "Atenção" (WARNING), "Observações" (INFO) and "Descrição do plano"
 * (DESCRIPTIVE, not counted as observations), each grouped by phase, with measured vs target, the basis of the target, links to
 * the phase/week, and, for an audit computed now, the notice that says so. Nothing is invented: a finding without a target reads
 * "Sem alvo definido".
 */
export function auditView(audit: AuditSource, options: { engineVersion: string; acceptSuggestions: boolean }): AuditView {
  const { report } = audit;
  const offer = audit.source === "STORED" && options.acceptSuggestions;
  const views = report.findings.map((f, n) => findingView(f, n, offer));
  const pick = (test: (f: AuditFinding) => boolean) => {
    const idx = report.findings.map((f, n) => (test(f) ? n : -1)).filter((n) => n >= 0);
    return byPhase(idx.map((n) => views[n]), idx.map((n) => report.findings[n]));
  };
  const attention = pick((f) => f.status !== "DESCRIPTIVE" && f.severity === "WARNING");
  const observations = pick((f) => f.status !== "DESCRIPTIVE" && f.severity === "INFO");
  const descriptive = pick((f) => f.status === "DESCRIPTIVE");
  const count = (g: AuditGroupView[]) => g.reduce((a, x) => a + x.findings.length, 0);
  const perWeek = report.phases.flatMap((p) => {
    const full = p.weekRows.filter((w) => w.full);
    return (full.length ? full : p.weekRows).map((w) => w.occurrences);
  });
  const total = report.phasesAudited.length + report.phasesMissing.length;
  return {
    auditVersion: report.auditVersion,
    rules: audit.rules,
    source: audit.source,
    viewNotice:
      audit.source === "VIEW"
        ? `Auditoria calculada agora com as regras ${audit.rules.id} ${audit.rules.version}, porque esta proposta foi gerada antes da auditoria (motor ${options.engineVersion}). Não foi gravada na proposta.`
        : null,
    kpis: {
      sessionsPerWeek: perWeek.length ? rangeText({ min: Math.min(...perWeek), max: Math.max(...perWeek) })! : "—",
      attention: count(attention),
      observations: count(observations),
      phases: `${report.phasesAudited.length} de ${total}`,
    },
    attention,
    observations,
    descriptive,
  };
}

const SHAPE_TEXT: Record<NonNullable<AuditPhase["splitShape"]>, string> = {
  FULL_BODY: "corpo inteiro",
  UPPER_LOWER: "superior e inferior",
  SINGLE: "um treino",
  OTHER: "outro",
};
const SITUATION_TEXT: Record<AuditMuscleRow["classification"], string> = {
  DIRECT: "Direto",
  INDIRECT_ONLY: "Só indireto",
  NONE: "Sem estímulo",
  UNKNOWN: "Não contado",
};
export const UNDEFINED_SETS = "séries não definidas";
/** A total not computed because some item could not be counted (no library exercise, or no muscles): not a dose without sets. */
export const NOT_COUNTED = "não calculado (item não contado)";
const NOT_COMPUTED = "não calculado";
/** Sets of a pattern worked only by items whose dose has no sets (continuous cardio, mobility by time): not missing data. */
export const SETS_NOT_APPLICABLE = "não se aplica (sem séries)";

/** Why a set total is unknown, from the per-week counts of the audit: doses without sets, items not counted, or both. */
function unknownCause(weeks: ReadonlyArray<Pick<AuditWeek, "unknownSetItems" | "uncountedItems">>): { cell: string; note: string | null } {
  const unknown = weeks.some((w) => w.unknownSetItems > 0);
  const uncounted = weeks.some((w) => w.uncountedItems > 0);
  const notes = [
    unknown ? "“Séries não definidas”: há dose sem séries." : null,
    uncounted ? "“Item não contado”: há item fora da biblioteca ou sem músculos cadastrados, que não entra na conta." : null,
  ].filter((x): x is string => x !== null);
  return {
    cell: unknown && uncounted ? NOT_COMPUTED : uncounted ? NOT_COUNTED : UNDEFINED_SETS,
    note: notes.length ? `${notes.join(" ")} Por isso o total não é calculado (não é zero).` : null,
  };
}

export interface AuditMuscleRowView {
  muscle: string;
  direct: string;
  indirect: string;
  weighted: string;
  directSessions: string;
  target: string;
  situation: string;
  isTarget: boolean;
}
export interface AuditPatternRowView {
  pattern: string;
  sets: string;
  sessions: string;
  target: string;
}

function targetCell(t: AuditTarget | undefined, isTarget: boolean): string {
  if (t) {
    const text = auditTargetText(t);
    if (text) return `${text} (${BASIS_LABELS[t.basis]})`;
  }
  return isTarget ? "Alvo" : "—";
}

/**
 * One phase of the audit as table rows (texts only): per muscle the weekly ranges (min–max across the weeks), the sessions with
 * direct stimulus, the target and the situation; per pattern the weekly sets and sessions (patterns never worked and not targeted
 * are left out). Unknown sets read "séries não definidas", never 0. Null when the phase was not audited.
 */
export function auditPhaseRows(
  report: AuditReport,
  phaseIndex: number,
): { shape: string | null; volume: boolean; muscles: AuditMuscleRowView[]; patterns: AuditPatternRowView[]; unknownNote: string | null } | null {
  const p = report.phases.find((x) => x.phaseIndex === phaseIndex);
  if (!p) return null;
  const cause = unknownCause(p.weekRows);
  // No volume workout in the phase (cardio, mobility): the muscle table would be all zeros; the panel says so in one line.
  const volume = p.workouts.some((w) => w.volumeWorkout);
  const order: Record<AuditMuscleRow["classification"], number> = { DIRECT: 0, INDIRECT_ONLY: 1, UNKNOWN: 2, NONE: 3 };
  const muscles = (volume ? [...p.muscles] : [])
    .sort((a, b) => Number(b.isTarget) - Number(a.isTarget) || order[a.classification] - order[b.classification] || muscleName(a.muscle).localeCompare(muscleName(b.muscle), "pt-BR"))
    .map((m) => ({
      muscle: muscleName(m.muscle),
      direct: rangeText(m.direct) ?? cause.cell,
      indirect: rangeText(m.indirect) ?? cause.cell,
      weighted: rangeText(m.weighted) ?? cause.cell,
      directSessions: rangeText(m.directSessions)!,
      target: targetCell(m.target, m.isTarget),
      situation: SITUATION_TEXT[m.classification],
      isTarget: m.isTarget,
    }));
  const patterns = p.patterns
    .filter((x) => x.isTarget || x.sessions.max > 0)
    .sort((a, b) => Number(b.isTarget) - Number(a.isTarget) || b.sessions.max - a.sessions.max || patternName(a.pattern).localeCompare(patternName(b.pattern), "pt-BR"))
    .map((x) => ({
      pattern: patternName(x.pattern),
      // Without doses lacking sets or items not counted in the phase, a null total can only come from items with no sets.
      sets: rangeText(x.sets) ?? (cause.note ? cause.cell : SETS_NOT_APPLICABLE),
      sessions: rangeText(x.sessions)!,
      target: x.isTarget ? "Alvo" : "—",
    }));
  return { shape: p.splitShape ? SHAPE_TEXT[p.splitShape] : null, volume, muscles, patterns, unknownNote: cause.note };
}

/**
 * "Contribuição na semana" of an item: the item-local sentence the engine recorded (`WEEKLY_CONTRIBUTION`) and, from the audit,
 * the total of that week of the phase (never stored with the item, so a change elsewhere does not rewrite it). Null when the
 * item has no such entry (outside the volume modalities, or rules without the audit).
 */
export function contributionView(
  item: Pick<ItemOut, "trace">,
  audit: AuditReport | null,
  phaseIndex: number,
  week: number,
): { lines: string[]; weekTotal: string | null } | null {
  const lines = item.trace.selection.filter((t) => t.code === "WEEKLY_CONTRIBUTION").map((t) => t.detail);
  if (!lines.length) return null;
  const row = audit?.phases.find((p) => p.phaseIndex === phaseIndex)?.weekRows[week - 1];
  const sessions = row ? `${row.occurrences} ${row.occurrences === 1 ? "sessão" : "sessões"}` : "";
  const weekTotal = !row
    ? null
    : row.weighted === null
      ? `Total da semana ${week} na fase (${sessions}): não calculado, há ${[row.unknownSetItems > 0 ? UNDEFINED_SETS : null, row.uncountedItems > 0 ? "item não contado (fora da biblioteca ou sem músculos)" : null].filter(Boolean).join(" e ")}.`
      : `Total da semana ${week} na fase (${sessions}): ${auditValueText("WEIGHTED_SETS", row.weighted)}.`;
  return { lines, weekTotal };
}

// ---------- "Por quê?" of an item (design V3 §5, §7.1) ----------

/** One line of "Por quê?": the text, the basis it rests on and the rule it came from (null when there is none). */
export interface WhyLine {
  text: string;
  basis: Basis | null;
  rule: string | null;
  muted?: boolean;
}
export type WhySectionKey = "choice" | "student" | "contribution" | "sets" | "rules" | "change";
export interface WhySection {
  key: WhySectionKey;
  title: string;
  lines: WhyLine[];
}

/** Entries derived after the selection: they answer their own questions, not "why this exercise". */
const DERIVED_CODES: ReadonlySet<string> = new Set(["WEEKLY_CONTRIBUTION", "ASSESSMENT_OBSERVATION"]);

/**
 * What would justify changing an item, from the trace codes it actually carries (design V3 §5). A pure mapping: a condition
 * appears only when its code is there (no history entry, no history condition), and nothing is invented beyond the code.
 */
const CHANGE_BY_CODE: Record<string, string> = {
  ELIGIBLE: "Se as modalidades do treino ou as suas exclusões mudarem.",
  EQUIPMENT: "Se o equipamento deixar de estar disponível (ou a lista de equipamentos mudar).",
  PREFERRED: "Se você tirar o exercício dos preferidos.",
  HISTORY_PAIN: "Se o aluno registrar dor ou não tolerar o exercício.",
  HISTORY_CONTINUITY: "Se o aluno registrar dor ou não tolerar o exercício.",
  USED_IN_PREVIOUS_PHASE: "Se a fase anterior mudar: a variação entre fases pesou na escolha.",
  DIFFICULTY: "Se o nível de experiência do aluno na ficha mudar.",
  INFERRED_METADATA: "Se os metadados do exercício forem revisados (hoje são inferidos) ou se você restringir a seleção a metadados revisados.",
  COMPOUND: "Se o estímulo da fase mudar: o peso de multiarticular depende dele.",
  NO_EXTERNAL_LOAD: "Se o estímulo da fase mudar: o peso de carga externa depende dele.",
  TARGET_PRIMARY: "Se os alvos (músculos ou padrões) desta fase ou deste treino mudarem.",
  TARGET_SECONDARY: "Se os alvos (músculos ou padrões) desta fase ou deste treino mudarem.",
  TARGET_PATTERN: "Se os alvos (músculos ou padrões) desta fase ou deste treino mudarem.",
  TARGET_PATTERN_REPEAT: "Se os alvos (músculos ou padrões) desta fase ou deste treino mudarem.",
  MICRO_TARGET_AFFINITY: "Se os alvos (músculos ou padrões) desta fase ou deste treino mudarem.",
  MICRO_TARGET_DEFICIT: "Se o alvo semanal citado acima mudar ou já estiver atendido por outro exercício.",
  MICRO_TARGET_DEFICIT_SECONDARY: "Se o alvo semanal citado acima mudar ou já estiver atendido por outro exercício.",
  MICRO_FREQUENCY: "Se o alvo semanal citado acima mudar ou já estiver atendido por outro exercício.",
  MICRO_OVER_TARGET: "Se o alvo semanal citado acima mudar ou já estiver atendido por outro exercício.",
  MICRO_PATTERN_NEW: "Se o padrão-alvo já tiver sessão na semana por outro exercício.",
  MICRO_PATTERN_REPEAT: "Se o padrão-alvo já tiver sessão na semana por outro exercício.",
  MICRO_REDUNDANCY: "Se outro exercício do mesmo padrão entrar ou sair da semana: a repetição do padrão pesou contra.",
  NO_TARGETS_PATTERN_REPEAT: "Se outro exercício do mesmo padrão entrar ou sair do treino: a repetição do padrão pesou contra.",
  MICRO_SAME_EXERCISE: "Se você preferir não repetir o exercício em outro treino da fase: troque um deles.",
  USED_IN_PHASE: "Se você preferir não repetir o exercício em outro treino da fase: troque um deles.",
  NO_TARGETS: "Se você definir alvos (músculos, padrões ou séries por semana) para esta fase.",
  ASSESSMENT_OBSERVATION: "Se a observação na execução mostrar compensação, decida com o aluno (não é contraindicação).",
  LOCKED: "Está mantido por você: só muda se você destravar.",
  PRESERVED: "Já estava no rascunho: a ferramenta não o troca; mude no editor da revisão.",
  PROFESSIONAL_SUBSTITUTION: "Foi trocado por você: muda só com outra troca sua.",
  RESERVED_SUBSTITUTION: "Foi trocado por você: muda só com outra troca sua.",
  ENGINE_REPLACEMENT: "Se você pedir outra troca ou escolher o exercício você mesmo.",
};

/** "O que mudaria esta escolha": conditions only for the codes and dose bases present in the item's trace. */
export function changeConditions(item: Pick<ItemOut, "trace">): string[] {
  const out: string[] = [];
  const add = (text: string | undefined) => {
    if (text && !out.includes(text)) out.push(text);
  };
  for (const t of item.trace.selection) add(CHANGE_BY_CODE[t.code]);
  const sets = item.trace.params.find((p) => p.param === "sets");
  if (sets?.basis === "PROFESSIONAL") add("A dose é sua: muda só se você a editar.");
  else if (sets?.ruleId === "DOSE_DEFAULTS") add("Se a política de doses da geração mudar, ou se você editar a dose deste item depois de aplicar.");
  else if (sets?.ruleId) add("Se a regra da dose ou a progressão da fase mudar, ou se você editar a dose deste item depois de aplicar.");
  return out;
}

const setsWord = (v: unknown) => (typeof v === "number" ? `${numberText(v)} ${v === 1 ? "série" : "séries"}` : traceValue(v, "sets"));

/**
 * "Por quê?" of an item as the six answers of design V3 §5, in order: why this exercise, the student's data used, the
 * contribution to the week, why N sets, the rules used, and what would change it. Built only from the item's trace (and the
 * week total the audit read); a section with nothing to say is left out, never filled with "—".
 */
export function whyView(
  item: Pick<ItemOut, "trace">,
  options: {
    rulesUsed: readonly RuleUse[];
    contribution: { lines: string[]; weekTotal: string | null } | null;
    /** The week of the phase this item's session is in (the progression is per week). */
    week?: number;
    /** The proposal recorded EXPERIENCE_UNKNOWN: the level was not in the records, so it is not student data. */
    experienceUnknown?: boolean;
  },
): WhySection[] {
  const rule = (id: string | undefined) => (id ? ruleLabel(options.rulesUsed, id) : null);
  const sel = item.trace.selection;
  // The difficulty term is weighted by the student's experience level (EXPERIENCE_MAP): the level is student data when the
  // records had it; when not, the proposal's assumption says how it was weighed instead.
  const difficulty = sel.find((t) => t.code === "DIFFICULTY");
  const levelLine = difficulty
    ? options.experienceUnknown
      ? { text: `Nível de experiência não informado: a dificuldade pesou como para não iniciantes (${difficulty.detail}).`, basis: "HEURISTIC" as Basis, rule: rule("EXPERIENCE_MAP") }
      : {
          text: `Nível de experiência do perfil (${difficulty.detail.includes("para iniciante") ? "iniciante" : "não iniciante"}) usado no peso da dificuldade: ${difficulty.detail}.`,
          basis: "STUDENT_DATA" as Basis,
          rule: rule("EXPERIENCE_MAP"),
        }
    : null;
  const sections: WhySection[] = [
    {
      key: "choice",
      title: "Por que este exercício",
      lines: sel.filter((t) => !DERIVED_CODES.has(t.code) && t.basis !== "STUDENT_DATA").map((t) => ({ text: t.detail, basis: t.basis, rule: rule(t.ruleId) })),
    },
    {
      key: "student",
      title: "Dados do aluno usados",
      lines: [
        ...sel.filter((t) => t.basis === "STUDENT_DATA").map((t) => ({ text: t.detail, basis: t.basis, rule: rule(t.ruleId) })),
        ...item.trace.params
          .filter((p) => p.basis === "STUDENT_DATA")
          .map((p) => ({ text: `${traceParamLabel(p.param)}: ${traceValue(p.value, p.param)}${p.refs?.length ? ` (${p.refs.join(", ")})` : ""}`, basis: p.basis, rule: rule(p.ruleId) })),
        ...(levelLine ? [levelLine] : []),
      ],
    },
    {
      key: "contribution",
      title: "Contribuição na semana",
      lines: options.contribution
        ? [
            ...options.contribution.lines.map((text) => ({ text, basis: null, rule: null })),
            ...(options.contribution.weekTotal ? [{ text: options.contribution.weekTotal, basis: null, rule: null, muted: true }] : []),
          ]
        : [],
    },
  ];
  const sets = item.trace.params.find((p) => p.param === "sets");
  if (sets && sets.value !== null && sets.value !== undefined)
    sections.push({
      key: "sets",
      title: `Por que ${setsWord(sets.value)}`,
      lines: [
        {
          text:
            sets.basis === "PROFESSIONAL"
              ? `${setsWord(sets.value)}: valor seu (dose preservada, editada ou ajustada por você).`
              : sets.ruleId === "DOSE_DEFAULTS"
                ? `${setsWord(sets.value)}: política de doses da geração para o estímulo desta sessão.`
                : options.week !== undefined && sets.ruleId
                  ? `${setsWord(sets.value)} na semana ${options.week} da fase, ${sets.ruleId === "DELOAD_ROUNDING" ? "semana de descarga da progressão" : "pela progressão da fase"}.`
                  : `${setsWord(sets.value)} nesta sessão.`,
          basis: sets.basis,
          rule: rule(sets.ruleId),
        },
      ],
    });
  else sections.push({ key: "sets", title: "Por que N séries", lines: [] });
  const ids = [...new Set([...sel.map((t) => t.ruleId), ...item.trace.params.map((p) => p.ruleId)].filter((x): x is string => Boolean(x)))];
  sections.push({
    key: "rules",
    title: "Regras usadas",
    lines: ids.map((id) => {
      const use = options.rulesUsed.find((r) => r.ruleId === id);
      return { text: `${use?.label ?? id} (${id})`, basis: use?.basis ?? null, rule: null };
    }),
  });
  sections.push({ key: "change", title: "O que mudaria esta escolha", lines: changeConditions(item).map((text) => ({ text, basis: null, rule: null })) });
  return sections.filter((s) => s.lines.length > 0);
}

// ---------- dose "Por quê?" and origin of an item (V4, PR 3.3) ----------

/** Who is behind each facet of an item: the professional, the rules' heuristics, the AI's suggestion or the student's data. */
export const PROVENANCE_LABELS: Record<OriginKind, string> = ORIGIN_LABELS;

/** The reason codes a dose value can carry (profile table, modifiers, generic row, progression), in plain pt-BR. Unknown codes are shown as they are. */
export const DOSE_REASON_LABELS: Record<string, string> = {
  COMPOUND: "exercício composto",
  HEAVY_PATTERN: "padrão pesado (agachar ou dobradiça)",
  HIGH_DIFFICULTY: "dificuldade alta",
  UNILATERAL: "exercício unilateral",
  ISOLATION: "exercício de isolamento",
  SMALL_MUSCLE: "região pequena",
  STRENGTH: "estímulo de força",
  ACCESSORY: "acessório de força",
  GENERAL_FITNESS: "condicionamento geral",
  EXPERIENCE_BEGINNER: "aluno iniciante (RIR um ponto acima)",
  TIME_BUDGET_SHORT: "sessão curta (descanso reduzido)",
  BLUEPRINT_INTENT: "pedido da estratégia aceita",
  GENERIC_DEFAULT: "padrão genérico do estímulo",
  PROFESSIONAL_CHOICE: "ajuste do profissional",
  PHASE_PROGRESSION: "progressão da fase",
};
const METADATA_MISSING_PREFIX = "METADATA_MISSING:";
const PROGRESSION_INTENT_PREFIX = "PROGRESSION_INTENT:";
export function doseReasonText(code: string): string {
  if (code.startsWith(METADATA_MISSING_PREFIX)) {
    const field = code.slice(METADATA_MISSING_PREFIX.length);
    const names: Record<string, string> = { compound: "composto ou isolado", laterality: "lateralidade", difficulty: "dificuldade", patterns: "padrões de movimento", primaryMuscles: "músculos principais" };
    return `falta ${names[field] ?? field} na biblioteca`;
  }
  if (code.startsWith(PROGRESSION_INTENT_PREFIX)) return `intenção de progressão da estratégia (${code.slice(PROGRESSION_INTENT_PREFIX.length)})`;
  return DOSE_REASON_LABELS[code] ?? code;
}

const DOSE_RULE_LABELS: Record<string, string> = {
  DOSE_DEFAULTS: "Política de doses",
  DOSE_PROFILES: "Perfis de dose",
  PROGRESSION_TEMPLATES: "Intenção de progressão",
  DELOAD_ROUNDING: "Semana de descarga da progressão",
};

export interface DoseWhyLine {
  param: "sets" | "reps" | "rir" | "rest";
  /** The question the line answers: "Por que 3 séries?". */
  question: string;
  /** The value as the screen writes it ("6–10 repetições"). */
  text: string;
  /** The rule behind it, in short words (the dose rules have fixed names; others use the proposal's label). */
  rule: string;
  /** The dose profile that set it (2026.11.6+), or null. */
  profile: string | null;
  basis: Basis;
  reasons: string[];
  changeIf: string | null;
}
export interface ProvenancePill {
  facet: "decidedBy" | "focus" | "selection" | "dose" | "studentData";
  kind: OriginKind;
  label: string;
}
export interface ItemWhy {
  /** The workout's role in the accepted strategy, or null when the proposal has none for this workout. */
  focusLine: string | null;
  selectionPills: ProvenancePill[];
  /** Sets, repetitions, RIR and rest, each with its rule, profile, reasons and what would change it. Empty on proposals without the dose policy. */
  dose: DoseWhyLine[];
  /** Audit findings that name this item (rationale text, as the audit wrote it). */
  auditLines: string[];
}

type TraceOf = (param: string) => ParamTrace | undefined;
const doseRange = (min: unknown, max: unknown, unit: string): string | null => {
  if (typeof min !== "number" && typeof max !== "number") return null;
  const lo = typeof min === "number" ? min : (max as number);
  const hi = typeof max === "number" ? max : lo;
  return `${lo === hi ? numberText(lo) : `${numberText(lo)}–${numberText(hi)}`}${unit}`;
};

/**
 * "Por quê?" of the dose of one item, built only from its trace: the four questions (séries, repetições, RIR, pausa) with the rule,
 * the profile, the reasons and what would change each. A proposal made before the dose policy (no reasons in the trace) has an empty
 * `dose`: nothing is invented for it. Also the origin pills (professional / rules / AI / student data), the workout's role in the
 * strategy and the audit findings that name this item.
 */
export function itemWhy(
  item: Pick<ItemOut, "origin" | "trace" | "exerciseId" | "slotKey">,
  workout: Pick<WorkoutSummary, "coverage"> | null,
  audit: Pick<AuditReport, "findings"> | null,
  options: { rulesUsed?: readonly RuleUse[]; phaseIndex?: number } = {},
): ItemWhy {
  const provenance = itemProvenance(item, workout);
  const pills: ProvenancePill[] = [
    { facet: "decidedBy", kind: provenance.decidedBy, label: provenance.labels.decidedBy },
    ...(provenance.focus && provenance.labels.focus ? [{ facet: "focus" as const, kind: provenance.focus, label: provenance.labels.focus }] : []),
    { facet: "selection", kind: provenance.selection, label: provenance.labels.selection },
    { facet: "dose", kind: provenance.dose, label: provenance.labels.dose },
    ...(provenance.studentData ? [{ facet: "studentData" as const, kind: "STUDENT_DATA" as const, label: ORIGIN_LABELS.STUDENT_DATA }] : []),
  ];
  const bp = workout?.coverage?.origin === "BLUEPRINT_FOCUS" ? workout.coverage.blueprint : undefined;
  const focusLine = bp ? `Foco do treino: ${ROLE_LABELS[bp.role] ?? bp.role} (${ORIGIN_LABELS[bp.source]}).` : null;

  const find: TraceOf = (param) => item.trace.params.find((p) => p.param === param);
  const explained = item.trace.params.some((p) => p.reasons?.length || p.profileId);
  const lines: DoseWhyLine[] = [];
  if (explained) {
    const ruleName = (t: ParamTrace) => (t.basis === "PROFESSIONAL" ? "Decisão do profissional" : t.ruleId ? (DOSE_RULE_LABELS[t.ruleId] ?? (options.rulesUsed ? ruleLabel(options.rulesUsed, t.ruleId) : t.ruleId)) : "Regra da ferramenta");
    const push = (param: DoseWhyLine["param"], question: string, text: string | null, traces: Array<ParamTrace | undefined>) => {
      const present = traces.filter((t): t is ParamTrace => t !== undefined);
      // The trace that explains the value: the one a profile wrote, else the first with reasons, else the first.
      const t = present.find((x) => x.profileId) ?? present.find((x) => x.reasons?.length) ?? present[0];
      if (!t || text === null) return;
      lines.push({ param, question, text, rule: ruleName(t), profile: t.profileId ?? null, basis: t.basis, reasons: (t.reasons ?? []).map(doseReasonText), changeIf: t.changeIf ?? null });
    };
    const sets = find("sets");
    const setsText = sets && typeof sets.value === "number" ? `${numberText(sets.value)} ${sets.value === 1 ? "série" : "séries"}` : null;
    push("sets", setsText ? `Por que ${setsText}?` : "Por que estas séries?", setsText, [sets]);
    const reps = doseRange(find("repsMin")?.value, find("repsMax")?.value, " repetições");
    push("reps", reps ? `Por que ${reps}?` : "Por que estas repetições?", reps, [find("repsMin"), find("repsMax")]);
    const rir = doseRange(find("rirMin")?.value, find("rirMax")?.value, "");
    push("rir", rir ? `Por que RIR ${rir}?` : "Por que este RIR?", rir ? `RIR ${rir}` : null, [find("rirMin"), find("rirMax")]);
    const restValue = find("restSeconds")?.value;
    const rest = typeof restValue === "number" ? `${numberText(restValue)} s de pausa` : null;
    push("rest", rest ? `Por que ${rest.replace(" de pausa", "")} de pausa?` : "Por que esta pausa?", rest, [find("restSeconds")]);
  }

  const phaseIndex = options.phaseIndex ?? parseSlotKey(item.slotKey)?.phaseIndex ?? null;
  const ref = phaseIndex === null ? null : `item:${phaseIndex}:${item.slotKey}`;
  const auditLines = ref && audit ? audit.findings.filter((f) => f.sourceRefs.includes(ref)).map((f) => f.rationale) : [];
  return { focusLine, selectionPills: pills, dose: lines, auditLines };
}

// ---------- suggested targets (design V3 §4.6, §7.4) ----------

/** One phase's coverage answer, as the server parses it. */
export type CoverageAnswer = NonNullable<GenerationAnswersInput["phaseCoverage"]>[number];
export type WorkoutCoverageAnswer = NonNullable<GenerationAnswersInput["coverageByWorkout"]>[number];

/** The suggestion accepted exactly as the rule computed it: the only answer the server takes as "Heurística aceita". */
export function suggestionEntry(s: TargetSuggestion): CoverageAnswer {
  return {
    phaseIndex: s.phaseIndex,
    muscles: [...s.muscles],
    patterns: [...s.patterns],
    ...(s.weeklySets.length ? { weeklySets: s.weeklySets.map((w) => ({ ...w })) } : {}),
    basis: "HEURISTIC_ACCEPTED",
    ruleId: s.ruleId,
  };
}

/** The suggestion card's texts (no numbers beyond the rule's own and the structure's sessions per week). */
export interface TargetSuggestionView {
  stimulus: string;
  muscles: Array<{ code: string; label: string }>;
  patterns: Array<{ code: string; label: string }>;
  /** "≥ 2 de 4 sessões por semana que a estrutura oferece", or why no minimum is suggested. */
  sessions: string;
  /** "10–20 séries ponderadas por semana, por músculo sugerido"; null when the rule has no set range. */
  sets: string | null;
}

export function targetSuggestionView(s: TargetSuggestion): TargetSuggestionView {
  const supply = num(s.supply);
  const offered = `${supply} ${s.supply === 1 ? "sessão" : "sessões"} por semana`;
  const min = s.weeklySets.find((w) => w.minDirectSessions !== undefined)?.minDirectSessions;
  const range = s.weeklySets.find((w) => w.minWeighted !== undefined || w.maxWeighted !== undefined);
  const lo = range?.minWeighted;
  const hi = range?.maxWeighted;
  return {
    stimulus: STIMULUS_LABELS[s.stimulus] ?? s.stimulus,
    muscles: s.muscles.map((code) => ({ code, label: muscleName(code) })),
    patterns: s.patterns.map((code) => ({ code, label: patternName(code) })),
    sessions:
      min !== undefined
        ? `Sessões com estímulo direto por semana, por músculo: ≥ ${num(min)} de ${offered} que a estrutura oferece.`
        : `A estrutura oferece ${offered} com treino de volume; frequência mínima não sugerida (forçaria o músculo em todos os treinos).`,
    sets:
      lo !== undefined && hi !== undefined
        ? `Séries ponderadas por semana, por músculo sugerido: ${num(lo)}–${num(hi)}.`
        : lo !== undefined
          ? `Séries ponderadas por semana, por músculo sugerido: ≥ ${num(lo)}.`
          : hi !== undefined
            ? `Séries ponderadas por semana, por músculo sugerido: ≤ ${num(hi)}.`
            : null,
  };
}

/** Why a phase has no suggestion, as the card says it. */
export function noSuggestionText(reason: string | null): string {
  if (reason === "MODALITIES_CHOSEN")
    return "Com modalidades escolhidas para os treinos desta fase, a sugestão é conferida depois de gerar, na proposta; aqui, defina os alvos manualmente se quiser.";
  if (reason === "MIXED_STIMULI") return "Os estímulos variam nesta fase; defina os alvos manualmente.";
  if (reason === "UNKNOWN_STIMULUS") return "Não há alvos sugeridos para o estímulo desta fase; defina os alvos manualmente, se quiser.";
  return "As regras desta proposta não sugerem alvos; defina os alvos manualmente, se quiser.";
}

/** The card's editor: what the professional toggles and types (text fields, as typed). */
export interface TargetEdit {
  muscles: string[];
  patterns: string[];
  minWeighted: string;
  maxWeighted: string;
  minDirectSessions: string;
  byWorkout: Array<{ label: string; muscles: string[] }>;
}

export function editFromSuggestion(s: TargetSuggestion | null, labels: readonly string[]): TargetEdit {
  const range = s?.weeklySets.find((w) => w.minWeighted !== undefined || w.maxWeighted !== undefined);
  const min = s?.weeklySets.find((w) => w.minDirectSessions !== undefined)?.minDirectSessions;
  return {
    muscles: [...(s?.muscles ?? [])],
    patterns: [...(s?.patterns ?? [])],
    minWeighted: range?.minWeighted !== undefined ? numberText(range.minWeighted) : "",
    maxWeighted: range?.maxWeighted !== undefined ? numberText(range.maxWeighted) : "",
    minDirectSessions: min !== undefined ? String(min) : "",
    byWorkout: labels.map((label) => ({ label, muscles: [] })),
  };
}

/**
 * The editor turned into answers. Exactly the suggestion, with nothing per workout, stays "Heurística aceita"; any edit, removal
 * or per-workout target is the professional's (`PROFESSIONAL`), so a changed suggestion is never passed off as the rule's. The
 * set range and the sessions per week apply to each target muscle; empty fields are left out (never 0).
 */
export function coverageFromEdit(
  phaseIndex: number,
  edit: TargetEdit,
  suggestion: TargetSuggestion | null,
  options: { requireTargets?: boolean } = {},
): { ok: true; coverage: CoverageAnswer | null; byWorkout: WorkoutCoverageAnswer[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const parse = (text: string, what: string, opts: { int?: boolean; min: number; max: number }) => {
    if (!text.trim()) return undefined;
    const n = numberOf(text);
    if (n === null || n < opts.min || n > opts.max || (opts.int && !Number.isInteger(n))) {
      errors.push(`${what}: ${opts.int ? "inteiro" : "número"} de ${opts.min} a ${opts.max}.`);
      return undefined;
    }
    return n;
  };
  const minWeighted = parse(edit.minWeighted, "Séries ponderadas por semana (mínimo)", { min: 0, max: 60 });
  const maxWeighted = parse(edit.maxWeighted, "Séries ponderadas por semana (máximo)", { min: 0, max: 60 });
  const minDirectSessions = parse(edit.minDirectSessions, "Sessões com estímulo direto por semana", { int: true, min: 1, max: 14 });
  if (minWeighted !== undefined && maxWeighted !== undefined && minWeighted > maxWeighted) errors.push("O mínimo de séries por semana não passa do máximo.");
  if (errors.length) return { ok: false, errors };
  const muscles = [...new Set(edit.muscles)].sort();
  const patterns = [...new Set(edit.patterns)].sort();
  const bounds = {
    ...(minWeighted !== undefined ? { minWeighted } : {}),
    ...(maxWeighted !== undefined ? { maxWeighted } : {}),
    ...(minDirectSessions !== undefined ? { minDirectSessions } : {}),
  };
  const weeklySets = Object.keys(bounds).length ? muscles.map((muscle) => ({ muscle, ...bounds })) : [];
  const byWorkout = edit.byWorkout.filter((w) => w.muscles.length).map((w) => ({ phaseIndex, label: w.label, muscles: [...new Set(w.muscles)].sort() }));
  const candidate = { muscles, patterns, weeklySets };
  if (suggestion && !byWorkout.length && sameCoverage(candidate, suggestion)) return { ok: true, coverage: suggestionEntry(suggestion), byWorkout: [] };
  const coverage: CoverageAnswer | null =
    muscles.length || patterns.length || weeklySets.length
      ? { phaseIndex, ...(muscles.length ? { muscles } : {}), ...(patterns.length ? { patterns } : {}), ...(weeklySets.length ? { weeklySets } : {}), basis: "PROFESSIONAL" }
      : null;
  // On the proposal the phase has no targets (that is why the card is there): an empty edit would regenerate it for nothing.
  if (options.requireTargets && !coverage && !byWorkout.length) return { ok: false, errors: ["Marque ao menos um músculo ou padrão, da fase ou de um treino, ou cancele."] };
  return { ok: true, coverage, byWorkout };
}

function sameCoverage(c: { muscles: string[]; patterns: string[]; weeklySets: WeeklySetsTarget[] }, s: TargetSuggestion): boolean {
  const key = (w: WeeklySetsTarget) => `${w.muscle}|${w.minWeighted ?? ""}|${w.maxWeighted ?? ""}|${w.minDirectSessions ?? ""}`;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, n) => x === b[n]);
  return same(c.muscles, [...s.muscles].sort()) && same(c.patterns, [...s.patterns].sort()) && same(c.weeklySets.map(key).sort(), s.weeklySets.map(key).sort());
}

/** A phase's coverage answer as a short line ("Heurística aceita: 7 músculos, 7 padrões, 10–20 séries…"). */
export function coverageSummary(c: CoverageAnswer, byWorkout: readonly WorkoutCoverageAnswer[] = []): string {
  const parts: string[] = [];
  if (c.muscles?.length) parts.push(`músculos: ${c.muscles.map(muscleName).join(", ")}`);
  if (c.patterns?.length) parts.push(`padrões: ${c.patterns.map(patternName).join(", ")}`);
  const w = c.weeklySets?.[0];
  if (w?.minWeighted !== undefined || w?.maxWeighted !== undefined)
    parts.push(`séries ponderadas por semana: ${w?.minWeighted !== undefined ? num(w.minWeighted) : "—"}–${w?.maxWeighted !== undefined ? num(w.maxWeighted) : "—"}`);
  if (w?.minDirectSessions !== undefined) parts.push(`≥ ${num(w.minDirectSessions)} sessões com estímulo direto`);
  for (const b of byWorkout) parts.push(`treino ${b.label}: ${(b.muscles ?? []).map(muscleName).join(", ")}`);
  return parts.join(" · ");
}

/**
 * The form's view of a phase's suggestion: the outcome for the stimulus chosen on screen (or the periodization's own when none
 * is answered). Modalities typed for a workout of the phase change what the rule counts, so the form then offers editing only
 * (the proposal, after generating, offers the exact suggestion).
 */
export function formSuggestionFor(
  phase: { phaseIndex: number; asIs: TargetSuggestionOutcome; byStimulus: Record<string, TargetSuggestionOutcome> },
  form: Pick<GenerationForm, "stimulus" | "modalities">,
): { suggestion: TargetSuggestion | null; reason: string | null } {
  if (form.modalities.some((m) => m.phaseIndex === phase.phaseIndex && m.modalities.length))
    return { suggestion: null, reason: "MODALITIES_CHOSEN" };
  const chosen = form.stimulus.find((s) => s.phaseIndex === phase.phaseIndex && s.value.trim());
  const out = chosen ? phase.byStimulus[chosen.value.trim()] : phase.asIs;
  if (!out) return { suggestion: null, reason: "UNKNOWN_STIMULUS" };
  return out.suggestion ? { suggestion: out.suggestion, reason: null } : { suggestion: null, reason: out.reason };
}
