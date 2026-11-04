/**
 * Progressão semanal dentro de uma fase: rampas lineares, degraus, sequência ondulatória, blocos,
 * ajustes por semana e descarga. As partes se combinam; os números vêm do profissional (ou da
 * estrutura) e os arredondamentos das regras. Nunca lança: entradas inválidas viram avisos.
 */
import type { RuleLog } from "./trace";
import type { DoseDraft } from "./dose";
import type { Basis, DoseParam, Fact, Issue, Metric, WeeklyProgression } from "./types";

const PARAMS: ReadonlySet<string> = new Set<DoseParam>([
  "sets", "repsMin", "repsMax", "durationMin", "durationMax", "distanceMin", "distanceMax", "restSeconds", "rirMin", "rirMax",
  "rpeMin", "rpeMax", "blocks", "repeats", "workDurationMin", "workDurationMax", "workDistanceMin", "workDistanceMax",
  "recoveryMin", "recoveryMax", "restBetweenBlocks",
]);

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Problemas de uma progressão para uma fase de `weeks` semanas; [] = válida. */
export function validateProgression(p: WeeklyProgression, weeks: number): string[] {
  const out: string[] = [];
  for (const r of p.ramps ?? []) {
    if (!PARAMS.has(r.param)) out.push(`rampa: parâmetro desconhecido ${r.param}`);
    if (!finite(r.from) || !finite(r.to)) out.push(`rampa de ${r.param}: falta o valor inicial ou o final`);
    else if (r.from < 0 || r.to < 0) out.push(`rampa de ${r.param}: valor negativo`);
  }
  for (const s of p.steps ?? []) {
    if (!PARAMS.has(s.param)) out.push(`degrau: parâmetro desconhecido ${s.param}`);
    if (!finite(s.delta)) out.push(`degrau de ${s.param}: incremento inválido`);
    if (!Number.isInteger(s.everyWeeks) || s.everyWeeks < 1) out.push(`degrau de ${s.param}: "a cada" precisa ser inteiro ≥ 1`);
    if (s.limit !== undefined && (!finite(s.limit) || s.limit < 0)) out.push(`degrau de ${s.param}: limite inválido`);
  }
  if (p.sequence) {
    if (!p.sequence.stimuli.length) out.push("sequência ondulatória vazia");
    if (p.sequence.stimuli.some((s) => !s.trim())) out.push("sequência com estímulo vazio");
  }
  if (p.blocks) {
    if (!p.blocks.length) out.push("blocos vazios");
    if (p.blocks.some((b) => !Number.isInteger(b.weeks) || b.weeks < 1)) out.push("bloco com semanas inválidas");
    if (p.blocks.some((b) => !b.stimulus.trim())) out.push("bloco sem estímulo");
    const total = p.blocks.reduce((a, b) => a + b.weeks, 0);
    if (total !== weeks) out.push(`blocos somam ${total} semanas; a fase tem ${weeks}`);
  }
  for (const o of p.weekOverrides ?? []) {
    if (!Number.isInteger(o.week) || o.week < 1 || o.week > weeks) out.push(`ajuste da semana ${o.week}: fora da fase`);
    for (const [k, v] of Object.entries(o.patch.values ?? {}))
      if (!finite(v) || v < 0) out.push(`ajuste da semana ${o.week}: ${k} inválido`);
  }
  if (p.deload) {
    const m = p.deload.setsMultiplier;
    if (!finite(m) || m < 0 || m > 1) out.push("descarga: multiplicador de séries precisa estar entre 0 e 1");
    if (p.deload.weeks.some((w) => !Number.isInteger(w) || w < 1 || w > weeks)) out.push("descarga: semana fora da fase");
  }
  if (p.model === "LINEAR" && !(p.ramps ?? []).length) out.push("progressão linear sem rampa");
  if (p.model === "STEP" && !(p.steps ?? []).length) out.push("progressão em degraus sem degrau");
  if (p.model === "SEQUENCE" && !p.sequence) out.push("progressão ondulatória sem sequência");
  if (p.model === "BLOCK" && !p.blocks) out.push("progressão em blocos sem blocos");
  return out;
}

/** Estímulo que a progressão impõe a uma ocorrência (sequência ou bloco); null = nenhum. */
export function stimulusFromProgression(p: WeeklyProgression, week: number, indexInWeek: number): string | null {
  if (p.blocks?.length) {
    let end = 0;
    for (const b of p.blocks) {
      end += b.weeks;
      if (week <= end) return b.stimulus;
    }
    return null;
  }
  if (p.sequence?.stimuli.length) {
    const i = p.sequence.per === "WEEK" ? week - 1 : indexInWeek - 1;
    return p.sequence.stimuli[((i % p.sequence.stimuli.length) + p.sequence.stimuli.length) % p.sequence.stimuli.length];
  }
  return null;
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Aplica a progressão da semana sobre a dose em construção. Parâmetros que a dose não tem são
 * ignorados com aviso (nunca inventados).
 */
export function applyWeeklyProgression(
  log: RuleLog,
  progression: Fact<WeeklyProgression>,
  week: number,
  phaseWeeks: number,
  metric: Metric,
  draft: DoseDraft,
): Array<Omit<Issue, "path" | "stage">> {
  const p = progression.value;
  const issues: Array<Omit<Issue, "path" | "stage">> = [];
  const t: { basis: Basis; ruleId?: string } = { basis: progression.basis, ...(progression.ruleId ? { ruleId: progression.ruleId } : {}) };
  const applies = (m?: Metric) => m === undefined || m === metric;
  if (validateProgression(p, phaseWeeks).length) return issues; // erros já registrados uma vez por fase
  for (const r of p.ramps ?? []) {
    if (!applies(r.metric)) continue;
    if (draft.values[r.param] === undefined) {
      issues.push({ severity: "INFO", code: "PROGRESSION_PARAM_MISSING", message: `Rampa sobre ${r.param}, que esta dose não tem; ignorada.` });
      continue;
    }
    const { decimals } = log.get("LINEAR_ROUNDING");
    const fraction = phaseWeeks <= 1 ? 0 : (week - 1) / (phaseWeeks - 1);
    draft.set(r.param, roundTo(r.from + (r.to - r.from) * fraction, decimals), t);
  }
  for (const s of p.steps ?? []) {
    if (!applies(s.metric)) continue;
    const current = draft.values[s.param];
    if (current === undefined) {
      issues.push({ severity: "INFO", code: "PROGRESSION_PARAM_MISSING", message: `Degrau sobre ${s.param}, que esta dose não tem; ignorado.` });
      continue;
    }
    const n = Math.floor((week - 1) / s.everyWeeks);
    if (n === 0) continue;
    let value = current + s.delta * n;
    if (s.limit !== undefined) value = s.delta >= 0 ? Math.min(s.limit, value) : Math.max(s.limit, value);
    draft.set(s.param, Math.max(0, value), t);
  }
  for (const o of p.weekOverrides ?? []) if (o.week === week) draft.patch(o.patch, t);
  if (p.deload?.weeks.includes(week)) {
    const { floor } = log.get("DELOAD_ROUNDING");
    for (const key of ["sets", "blocks"] as const) {
      const current = draft.values[key];
      if (current === undefined) continue;
      draft.set(key, Math.max(floor, Math.round(current * p.deload.setsMultiplier)), { ...t, ruleId: "DELOAD_ROUNDING" });
    }
    if (p.deload.patch) draft.patch(p.deload.patch, t);
  }
  return issues;
}
