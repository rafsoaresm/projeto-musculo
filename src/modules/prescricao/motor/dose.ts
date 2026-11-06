/**
 * Doses: um formato por métrica, combinadas em camadas (regra padrão → ajustes do profissional
 * → progressão semanal), cada parâmetro com a sua base. Texto pt-BR para exibição.
 * O motor nunca propõe quilos, zonas ou ritmos: esses só vêm do profissional.
 */
import { codeOf, METRIC_LABELS, MODALITY_LABELS, STIMULUS_LABELS } from "./vocabulary";
import type { RuleLog } from "./trace";
import type { DoseDefault } from "./rules";
import { applyWeeklyProgression, PROGRESSION_CHANGE_IF, progressionReasons } from "./progress-week";
import { applyProfile, classOf, profileFor, profileTrace, SETS_CHANGE_IF, type IntentOutcome, type ProfileChoice, type ProfileField, type ProfileRequest } from "./dose-profile";
import type {
  Basis,
  CatalogExercise,
  DisplayFields,
  Dose,
  DoseParam,
  DosePatch,
  Experience,
  Fact,
  GenerationParameters,
  Intensity,
  Issue,
  LoadBasis,
  Method,
  Metric,
  ParamTrace,
  Range,
  WeeklyProgression,
} from "./types";

export type Flat = Partial<Record<DoseParam, number>>;

export interface Extras {
  intensity?: Intensity;
  tempo?: string;
  method?: Method;
  loadBasis?: LoadBasis;
  loadInstruction?: string;
  recoveryMode?: "PASSIVE" | "ACTIVE";
}

/** Valores em construção, com a origem de cada parâmetro. */
export class DoseDraft {
  values: Flat = {};
  extras: Extras = {};
  readonly trace = new Map<string, ParamTrace>();

  set(param: DoseParam, value: number, t: Omit<ParamTrace, "param" | "value">): void {
    this.values[param] = value;
    this.trace.set(param, { param, value, ...t });
  }

  setExtra<K extends keyof Extras>(key: K, value: Extras[K], t: Omit<ParamTrace, "param" | "value">): void {
    this.extras[key] = value;
    this.trace.set(key, { param: key, value, ...t });
  }

  patch(p: DosePatch, t: Omit<ParamTrace, "param" | "value">): void {
    for (const [k, v] of Object.entries(p.values ?? {}) as Array<[DoseParam, number]>) this.set(k, v, t);
    if (p.intensity) this.setExtra("intensity", p.intensity, t);
    if (p.tempo !== undefined) this.setExtra("tempo", p.tempo, t);
    if (p.method) this.setExtra("method", p.method, t);
    if (p.loadBasis) this.setExtra("loadBasis", p.loadBasis, t);
    if (p.loadInstruction !== undefined) this.setExtra("loadInstruction", p.loadInstruction, t);
    if (p.recoveryMode) this.setExtra("recoveryMode", p.recoveryMode, t);
  }
}

export interface DoseRequest {
  exercise: CatalogExercise;
  stimulus: string | null;
  phaseIndex: number;
  label: string;
  week: number;
  phaseWeeks: number;
  progression: Fact<WeeklyProgression> | null;
  /** Experiência do aluno (ajuste de RIR dos perfis, 2026.11.6+). Ausente = desconhecida. */
  experience?: Experience | null;
  /** Minutos disponíveis do treino (ajuste de descanso dos perfis em sessão curta, 2026.11.6+). Ausente = sem tempo informado. */
  budgetMinutes?: number | null;
}

export interface DoseResolution {
  dose: Dose | null;
  metric: Metric | null;
  params: ParamTrace[];
  issues: Array<Omit<Issue, "path" | "stage">>;
  /** Só com a política de dose por perfil (2026.11.6+): ausente nas versões anteriores. */
  profile?: { id: string | null; expected: boolean; uncertain: ProfileField[]; intent?: IntentOutcome };
}

export function metricFor(exercise: CatalogExercise, parameters: GenerationParameters): { metric: Metric | null; trace: ParamTrace | null } {
  const override = parameters.metricOverrides.find((m) => m.exerciseId === exercise.id);
  if (override) return { metric: override.metric, trace: { param: "metric", value: override.metric, basis: "PROFESSIONAL" } };
  if (!exercise.metric) return { metric: null, trace: null };
  const basis: Basis = exercise.metadataStatus === "REVIEWED" ? "PROFESSIONAL" : "HEURISTIC";
  return { metric: exercise.metric, trace: { param: "metric", value: exercise.metric, basis } };
}

function specificity(o: GenerationParameters["doseOverrides"][number]): number {
  return [o.stimulus, o.modality, o.metric, o.phaseIndex, o.label, o.exerciseId].filter((v) => v !== undefined).length;
}

function findDefault(log: RuleLog, stimulus: string, modality: string, metric: Metric): DoseDefault | null {
  const table = log.rules.rules.DOSE_DEFAULTS.value;
  return (
    table.find((d) => d.stimulus === stimulus && d.modality === modality && d.metric === metric) ??
    table.find((d) => d.stimulus === "*" && d.modality === modality && d.metric === metric) ??
    null
  );
}

function range(values: Flat, min: DoseParam, max: DoseParam): Range | undefined {
  const a = values[min];
  const b = values[max];
  if (a === undefined && b === undefined) return undefined;
  return { min: a ?? (b as number), max: b ?? (a as number) };
}

function intensityOf(d: DoseDraft): Intensity | undefined {
  if (d.extras.intensity) return d.extras.intensity;
  const rir = range(d.values, "rirMin", "rirMax");
  if (rir) return { kind: "RIR", range: rir };
  const rpe = range(d.values, "rpeMin", "rpeMax");
  if (rpe) return { kind: "RPE", range: rpe };
  return undefined;
}

/** Monta a dose da métrica com os valores combinados; null quando falta um parâmetro obrigatório. */
export function buildDose(metric: Metric, d: DoseDraft): { dose: Dose | null; missing: string[] } {
  const v = d.values;
  const intensity = intensityOf(d);
  const rest = v.restSeconds ?? null;
  const missing: string[] = [];
  const need = (ok: unknown, name: string) => {
    if (ok === undefined) missing.push(name);
  };
  switch (metric) {
    case "REPS": {
      const reps = range(v, "repsMin", "repsMax");
      need(v.sets, "sets");
      need(reps, "reps");
      if (missing.length || !reps || v.sets === undefined) return { dose: null, missing };
      return {
        dose: {
          metric, sets: v.sets, reps, ...(intensity ? { intensity } : {}), ...(d.extras.tempo ? { tempo: d.extras.tempo } : {}),
          restSeconds: rest, loadBasis: d.extras.loadBasis ?? "TOTAL", loadKg: null,
          ...(d.extras.loadInstruction ? { loadInstruction: d.extras.loadInstruction } : {}),
          ...(d.extras.method ? { method: d.extras.method } : {}),
        },
        missing,
      };
    }
    case "TIME": {
      const durationSeconds = range(v, "durationMin", "durationMax");
      need(v.sets, "sets");
      need(durationSeconds, "duration");
      if (missing.length || !durationSeconds || v.sets === undefined) return { dose: null, missing };
      return { dose: { metric, sets: v.sets, durationSeconds, ...(intensity ? { intensity } : {}), restSeconds: rest, ...(d.extras.method ? { method: d.extras.method } : {}) }, missing };
    }
    case "DISTANCE": {
      const distanceMeters = range(v, "distanceMin", "distanceMax");
      need(v.sets, "sets");
      need(distanceMeters, "distance");
      if (missing.length || !distanceMeters || v.sets === undefined) return { dose: null, missing };
      return { dose: { metric, sets: v.sets, distanceMeters, ...(intensity ? { intensity } : {}), restSeconds: rest }, missing };
    }
    case "INTERVALS": {
      const workDuration = range(v, "workDurationMin", "workDurationMax");
      const workDistance = range(v, "workDistanceMin", "workDistanceMax");
      const recovery = range(v, "recoveryMin", "recoveryMax");
      need(v.blocks, "blocks");
      need(v.repeats, "repeats");
      need(workDuration ?? workDistance, "work");
      need(recovery, "recovery");
      need(d.extras.recoveryMode, "recoveryMode"); // passiva ou ativa: nunca suposta
      if (missing.length || v.blocks === undefined || v.repeats === undefined || !recovery || !d.extras.recoveryMode) return { dose: null, missing };
      return {
        dose: {
          metric, blocks: v.blocks, repeats: v.repeats,
          work: { ...(workDuration ? { durationSeconds: workDuration } : {}), ...(workDistance ? { distanceMeters: workDistance } : {}), ...(intensity ? { intensity } : {}) },
          recovery: { durationSeconds: recovery, mode: d.extras.recoveryMode },
          restBetweenBlocksSeconds: v.restBetweenBlocks ?? null,
        },
        missing,
      };
    }
    case "CONTINUOUS": {
      const durationSeconds = range(v, "durationMin", "durationMax");
      const distanceMeters = range(v, "distanceMin", "distanceMax");
      need(durationSeconds ?? distanceMeters, "duration_or_distance");
      if (missing.length) return { dose: null, missing };
      return { dose: { metric, ...(durationSeconds ? { durationSeconds } : {}), ...(distanceMeters ? { distanceMeters } : {}), ...(intensity ? { intensity } : {}) }, missing };
    }
  }
}

const GENERIC_CHANGE_IF = "Padrão do estímulo para exercícios sem perfil; muda com um perfil de dose na biblioteca, com a progressão da fase ou se o profissional editar.";
const PROFESSIONAL_CHANGE_IF = "Definido pelo profissional; muda se ele editar.";
const EXPLAINED_PARAMS: readonly string[] = ["sets", "repsMin", "repsMax", "rirMin", "rirMax", "restSeconds"];

/**
 * Com a política de dose (2026.11.6+), cada valor responde "por quê" e "o que mudaria": séries, repetições, RIR e descanso que não
 * vieram de perfil ganham a regra de origem e o que os mudaria (o perfil já escreve os dele). Só preenche o que falta.
 */
function explainDoseParams(draft: DoseDraft): void {
  for (const [key, t] of draft.trace) {
    if (!EXPLAINED_PARAMS.includes(key) || (t.changeIf !== undefined && t.origin !== undefined)) continue;
    const professional = t.basis === "PROFESSIONAL";
    const generic = t.ruleId === "DOSE_DEFAULTS";
    draft.trace.set(key, {
      ...t, changeIf: t.changeIf ?? (professional ? PROFESSIONAL_CHANGE_IF : generic ? GENERIC_CHANGE_IF : PROGRESSION_CHANGE_IF),
      origin: t.origin ?? (professional ? "PROFESSIONAL" : "RULES_HEURISTIC"),
    });
  }
}

/**
 * Dose de um exercício numa ocorrência. Camadas, em ordem: regra padrão (estímulo exato, depois
 * "*") → ajustes do profissional, do mais geral ao mais específico → progressão semanal.
 */
export function resolveDose(log: RuleLog, parameters: GenerationParameters, req: DoseRequest): DoseResolution {
  const issues: DoseResolution["issues"] = [];
  const { metric, trace: metricTrace } = metricFor(req.exercise, parameters);
  if (parameters.doseMode === "LEAVE_EMPTY")
    return { dose: null, metric, params: [{ param: "dose", value: null, basis: "PROFESSIONAL" }], issues };
  if (!metric) {
    issues.push({ severity: "WARNING", code: "METRIC_MISSING", message: `${req.exercise.name}: a biblioteca não diz a métrica (repetições, tempo, distância…); dose fica para o profissional.` });
    return { dose: null, metric, params: [], issues };
  }
  if (!req.stimulus) return { dose: null, metric, params: metricTrace ? [metricTrace] : [], issues };
  const modality = req.exercise.modality ? codeOf(req.exercise.modality) : "";
  const draft = new DoseDraft();
  const rule = findDefault(log, req.stimulus, modality, metric);
  if (rule) {
    log.get("DOSE_DEFAULTS");
    const t = { basis: log.basis("DOSE_DEFAULTS"), ruleId: "DOSE_DEFAULTS" } as const;
    for (const [k, v] of Object.entries(rule.values) as Array<[DoseParam, number]>) draft.set(k, v, t);
    if (rule.recoveryMode) draft.setExtra("recoveryMode", rule.recoveryMode, t);
    if (rule.loadBasis) draft.setExtra("loadBasis", rule.loadBasis, t);
    if (rule.loadInstruction) draft.setExtra("loadInstruction", rule.loadInstruction, t);
  }
  // Política por perfil (2026.11.6+): entre o padrão genérico e os ajustes do profissional. Sem a regra, nada daqui existe.
  const profiles = log.optional("DOSE_PROFILES");
  let choice: ProfileChoice | null = null;
  if (profiles) {
    // Pedido da estratégia aceita para a classe deste exercício (só o que o profissional confirmou): a política decide se serve.
    const cls = classOf(req.exercise).cls;
    const asked = parameters.doseIntentByClass?.find((x) => x.exerciseClass === cls);
    const request: ProfileRequest | undefined = asked ? { ...asked, code: asked.profileCode, classMap: log.optional("DOSE_CLASS_MAP") } : undefined;
    choice = profileFor(profiles, req.exercise, req.stimulus, modality, metric, request);
    if (choice.profile) {
      applyProfile(log, draft, choice.profile, { experience: req.experience ?? null, budgetMinutes: req.budgetMinutes ?? null }, choice.reasons, choice.via);
      const sets = draft.trace.get("sets");
      if (sets && sets.ruleId === "DOSE_DEFAULTS") draft.trace.set("sets", { ...sets, changeIf: SETS_CHANGE_IF });
    }
  }
  const overrides = parameters.doseOverrides
    .map((o, i) => ({ o, i }))
    .filter(({ o }) =>
      (o.stimulus === undefined || codeOf(o.stimulus) === req.stimulus) &&
      !(o.exceptStimuli ?? []).some((s) => codeOf(s) === req.stimulus) &&
      (o.modality === undefined || codeOf(o.modality) === modality) &&
      (o.metric === undefined || o.metric === metric) &&
      (o.phaseIndex === undefined || o.phaseIndex === req.phaseIndex) &&
      (o.label === undefined || o.label === req.label) &&
      (o.exerciseId === undefined || o.exerciseId === req.exercise.id),
    )
    .sort((a, b) => specificity(a.o) - specificity(b.o) || a.i - b.i);
  for (const { o } of overrides) draft.patch(o.patch, { basis: "PROFESSIONAL" });
  if (!rule && !overrides.length) {
    issues.push({
      severity: "WARNING", code: "DOSE_POLICY_MISSING",
      message: `${req.exercise.name}: nenhuma regra de dose para ${STIMULUS_LABELS[req.stimulus] ?? req.stimulus} / ${modality ? MODALITY_LABELS[modality] ?? modality : "modalidade não informada"} / ${METRIC_LABELS[metric] ?? metric}; a dose fica vazia para o profissional preencher.`,
    });
    return { dose: null, metric, params: metricTrace ? [metricTrace] : [], issues };
  }
  if (metric === "REPS") {
    if (!draft.extras.loadBasis)
      draft.setExtra("loadBasis", log.get("LOAD_BASIS_DEFAULT"), { basis: log.basis("LOAD_BASIS_DEFAULT"), ruleId: "LOAD_BASIS_DEFAULT" });
    if (draft.extras.loadInstruction === undefined)
      draft.setExtra("loadInstruction", log.get("LOAD_INSTRUCTION_DEFAULT"), { basis: log.basis("LOAD_INSTRUCTION_DEFAULT"), ruleId: "LOAD_INSTRUCTION_DEFAULT" });
  }
  if (req.progression) {
    issues.push(...applyWeeklyProgression(log, req.progression, req.week, req.phaseWeeks, metric, draft));
    // Texto de carga da intenção de progressão (LOAD_FIRST, REPS_THEN_LOAD): só aparece onde nenhuma instrução do profissional existe.
    const text = req.progression.loadInstruction;
    if (text !== undefined && metric === "REPS" && draft.trace.get("loadInstruction")?.basis !== "PROFESSIONAL")
      draft.setExtra("loadInstruction", text, {
        basis: req.progression.basis, ruleId: "PROGRESSION_TEMPLATES", origin: req.progression.origin ?? "RULES_HEURISTIC", reasons: progressionReasons(req.progression),
        changeIf: PROGRESSION_CHANGE_IF,
      });
  }
  if (choice) explainDoseParams(draft);
  const built = buildDose(metric, draft);
  const params = [...(metricTrace ? [metricTrace] : []), ...(choice ? profileTrace(log, choice) : []), ...draft.trace.values()];
  const profile = choice ? { id: choice.profile?.id ?? null, expected: choice.expected, uncertain: choice.uncertain, ...(choice.intent ? { intent: choice.intent } : {}) } : undefined;
  if (!built.dose) {
    issues.push({
      severity: "WARNING", code: "DOSE_POLICY_MISSING",
      message: `${req.exercise.name}: a regra não define ${built.missing.join(", ")} para ${metric}; a dose fica vazia para o profissional preencher.`,
    });
    return { dose: null, metric, params, issues, ...(profile ? { profile } : {}) };
  }
  return { dose: built.dose, metric, params, issues, ...(profile ? { profile } : {}) };
}

// ---------- validação ----------

function badNumber(n: number, integer = false): boolean {
  return !Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n));
}

function checkRange(r: Range | undefined, name: string, out: string[]): void {
  if (!r) return;
  if (badNumber(r.min) || badNumber(r.max)) out.push(`${name}: número inválido ou negativo`);
  else if (r.min > r.max) out.push(`${name}: mínimo maior que o máximo`);
}

function checkIntensity(i: Intensity | undefined, out: string[]): void {
  if (!i) return;
  if (i.kind === "RIR" || i.kind === "RPE") {
    checkRange(i.range, i.kind, out);
    if (i.range.max > 10) out.push(`${i.kind}: acima de 10`);
  } else if (i.kind === "PERCENT_1RM") {
    checkRange(i.range, "%1RM", out);
    if (i.range.max > 100) out.push("%1RM: acima de 100");
  } else if (i.kind === "PACE") checkRange(i.secondsPerKm, "ritmo", out);
  else if (i.kind === "ZONE" && i.bounds) checkRange(i.bounds.range, "zona", out);
  else if (i.kind === "TEXT" && !i.text.trim()) out.push("intensidade: texto vazio");
}

/** Problemas de uma dose; nunca lança. Sem problemas = []. */
export function validateDose(dose: Dose): Issue[] {
  const out: string[] = [];
  const rest = (n: number | null, name: string) => {
    if (n !== null && badNumber(n)) out.push(`${name}: inválido ou negativo`);
  };
  switch (dose.metric) {
    case "REPS":
      if (badNumber(dose.sets, true)) out.push("séries: inteiro não negativo");
      checkRange(dose.reps, "repetições", out);
      rest(dose.restSeconds, "descanso");
      if (dose.loadKg !== null) out.push("carga: o motor não propõe quilos");
      checkIntensity(dose.intensity, out);
      break;
    case "TIME":
      if (badNumber(dose.sets, true)) out.push("séries: inteiro não negativo");
      checkRange(dose.durationSeconds, "duração", out);
      rest(dose.restSeconds, "descanso");
      checkIntensity(dose.intensity, out);
      break;
    case "DISTANCE":
      if (badNumber(dose.sets, true)) out.push("séries: inteiro não negativo");
      checkRange(dose.distanceMeters, "distância", out);
      rest(dose.restSeconds, "descanso");
      checkIntensity(dose.intensity, out);
      break;
    case "INTERVALS":
      if (badNumber(dose.blocks, true)) out.push("blocos: inteiro não negativo");
      if (badNumber(dose.repeats, true)) out.push("repetições do bloco: inteiro não negativo");
      if (!dose.work.durationSeconds && !dose.work.distanceMeters) out.push("estímulo: falta duração ou distância");
      checkRange(dose.work.durationSeconds, "duração do estímulo", out);
      checkRange(dose.work.distanceMeters, "distância do estímulo", out);
      checkRange(dose.recovery.durationSeconds, "recuperação", out);
      rest(dose.restBetweenBlocksSeconds, "descanso entre blocos");
      checkIntensity(dose.work.intensity, out);
      break;
    case "CONTINUOUS":
      if (!dose.durationSeconds && !dose.distanceMeters) out.push("falta duração ou distância");
      checkRange(dose.durationSeconds, "duração", out);
      checkRange(dose.distanceMeters, "distância", out);
      checkIntensity(dose.intensity, out);
      break;
  }
  return out.map((message) => ({ severity: "ERROR", code: "DOSE_INVALID", path: "dose", message, stage: "VALIDATION" }));
}

// ---------- texto pt-BR ----------

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace(".", ","));
const rangeText = (r: Range, unit = "") => `${r.min === r.max ? num(r.min) : `${num(r.min)}–${num(r.max)}`}${unit}`;

function seconds(r: Range): string {
  if (r.min >= 60 && r.min % 60 === 0 && r.max % 60 === 0) return rangeText({ min: r.min / 60, max: r.max / 60 }, " min");
  return rangeText(r, " s");
}

function secondsOne(n: number): string {
  return n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${num(n)} s`;
}

function meters(r: Range): string {
  if (r.min >= 1000 && r.min % 100 === 0 && r.max % 100 === 0) return rangeText({ min: r.min / 1000, max: r.max / 1000 }, " km");
  return rangeText(r, " m");
}

function pace(s: number): string {
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return `${m}:${String(rest).padStart(2, "0")}`;
}

export function intensityText(i: Intensity | undefined): string | null {
  if (!i) return null;
  switch (i.kind) {
    case "RIR":
      return `RIR ${rangeText(i.range)}`;
    case "RPE":
      return `PSE ${rangeText(i.range)}`;
    case "PERCENT_1RM":
      return `${rangeText(i.range)}% de 1RM`;
    case "ZONE": {
      const unit = i.bounds ? { BPM: " bpm", PACE_S_PER_KM: " s/km", WATTS: " W", RPE: " PSE" }[i.bounds.unit] : "";
      return `${i.systemLabel} ${i.zone}${i.bounds ? ` (${rangeText(i.bounds.range, unit)})` : ""}`;
    }
    case "PACE":
      return `ritmo ${i.secondsPerKm.min === i.secondsPerKm.max ? pace(i.secondsPerKm.min) : `${pace(i.secondsPerKm.min)}–${pace(i.secondsPerKm.max)}`} /km`;
    case "TEXT":
      return i.text;
  }
}

const METHOD_TEXT: Record<Method["kind"], string> = {
  STRAIGHT: "",
  SUPERSET: "Bi-set",
  CIRCUIT: "Circuito",
  DROP_SET: "Drop-set",
  REST_PAUSE: "Rest-pause",
  CLUSTER: "Cluster",
  EMOM: "EMOM",
  AMRAP: "AMRAP",
  CUSTOM: "",
};

export function methodText(m: Method | undefined): string | null {
  if (!m) return null;
  const base = m.kind === "CUSTOM" ? m.text?.trim() ?? "" : METHOD_TEXT[m.kind];
  if (!base) return null;
  return m.groupKey ? `${base} (grupo ${m.groupKey})` : base;
}

const LOAD_BASIS_TEXT: Record<LoadBasis, string | null> = {
  TOTAL: null,
  PER_HAND: "carga por mão",
  PER_SIDE: "carga por lado",
  MACHINE_STACK: "carga da máquina",
  BODYWEIGHT: "peso do corpo",
  ASSISTANCE: "assistência",
  NONE: null,
};

/** Texto pt-BR da dose. Usado só na gravação: o que o aluno vê é o texto gravado. */
export function describeStructuredDose(dose: Dose): string {
  const parts: Array<string | null> = [];
  switch (dose.metric) {
    case "REPS":
      parts.push(`${dose.sets} × ${rangeText(dose.reps)} repetições`, intensityText(dose.intensity), dose.tempo ? `cadência ${dose.tempo}` : null,
        dose.restSeconds !== null ? `descanso ${secondsOne(dose.restSeconds)}` : null, LOAD_BASIS_TEXT[dose.loadBasis], methodText(dose.method));
      break;
    case "TIME":
      parts.push(`${dose.sets} × ${seconds(dose.durationSeconds)}`, intensityText(dose.intensity),
        dose.restSeconds !== null ? `descanso ${secondsOne(dose.restSeconds)}` : null, methodText(dose.method));
      break;
    case "DISTANCE":
      parts.push(`${dose.sets} × ${meters(dose.distanceMeters)}`, intensityText(dose.intensity),
        dose.restSeconds !== null ? `descanso ${secondsOne(dose.restSeconds)}` : null);
      break;
    case "INTERVALS": {
      const work = [dose.work.durationSeconds && seconds(dose.work.durationSeconds), dose.work.distanceMeters && meters(dose.work.distanceMeters)].filter(Boolean).join(" ou ");
      const block = `${dose.repeats} × ${work}${dose.work.intensity ? ` (${intensityText(dose.work.intensity)})` : ""}`;
      parts.push(dose.blocks === 1 ? block : `${dose.blocks} blocos de ${block}`,
        `recuperação ${dose.recovery.mode === "ACTIVE" ? "ativa" : "passiva"} ${seconds(dose.recovery.durationSeconds)}`,
        dose.blocks > 1 && dose.restBetweenBlocksSeconds !== null ? `descanso entre blocos ${secondsOne(dose.restBetweenBlocksSeconds)}` : null);
      break;
    }
    case "CONTINUOUS":
      parts.push([dose.durationSeconds && `${seconds(dose.durationSeconds)} contínuos`, dose.distanceMeters && meters(dose.distanceMeters)].filter(Boolean).join(" ou "),
        intensityText(dose.intensity));
      break;
  }
  return parts.filter((p): p is string => Boolean(p)).join(" · ");
}

export const EMPTY_DOSE_TEXT = "Dose a definir pelo profissional";

/** Campos da ficha atual (texto curto) a partir da dose estruturada. */
export function toDisplayFields(dose: Dose | null): DisplayFields {
  const empty: DisplayFields = { sets: null, reps: null, loadInstruction: null, cadence: null, restSeconds: null, restText: null, rirMin: null, rirMax: null, doseText: EMPTY_DOSE_TEXT };
  if (!dose) return empty;
  const doseText = describeStructuredDose(dose);
  switch (dose.metric) {
    case "REPS": {
      const rir = dose.intensity?.kind === "RIR" ? dose.intensity.range : null;
      const intensity = dose.intensity && dose.intensity.kind !== "RIR" ? intensityText(dose.intensity) : null;
      const load = [dose.loadInstruction, intensity].filter(Boolean).join(" · ");
      return {
        sets: String(dose.sets), reps: rangeText(dose.reps), loadInstruction: load || null, cadence: dose.tempo ?? null,
        restSeconds: dose.restSeconds, restText: dose.restSeconds !== null ? secondsOne(dose.restSeconds) : null,
        rirMin: rir && Number.isInteger(rir.min) ? rir.min : null, rirMax: rir && Number.isInteger(rir.max) ? rir.max : null, doseText,
      };
    }
    case "TIME":
    case "DISTANCE":
      return {
        ...empty, sets: String(dose.sets), reps: dose.metric === "TIME" ? seconds(dose.durationSeconds) : meters(dose.distanceMeters),
        loadInstruction: intensityText(dose.intensity), restSeconds: dose.restSeconds,
        restText: dose.restSeconds !== null ? secondsOne(dose.restSeconds) : null, doseText,
      };
    case "INTERVALS":
      return {
        ...empty, sets: `${dose.blocks} × ${dose.repeats}`,
        reps: [dose.work.durationSeconds && seconds(dose.work.durationSeconds), dose.work.distanceMeters && meters(dose.work.distanceMeters)].filter(Boolean).join(" ou "),
        loadInstruction: intensityText(dose.work.intensity), restSeconds: dose.restBetweenBlocksSeconds,
        restText: `rec. ${seconds(dose.recovery.durationSeconds)}`, doseText,
      };
    case "CONTINUOUS":
      return {
        ...empty, reps: [dose.durationSeconds && seconds(dose.durationSeconds), dose.distanceMeters && meters(dose.distanceMeters)].filter(Boolean).join(" ou "),
        loadInstruction: intensityText(dose.intensity), doseText,
      };
  }
}
