/**
 * Fatos de uma ocorrência que não dependem da seleção: progressão da fase, estímulo de cada sessão, posição na semana e
 * exposições semanais de cada treino. Puro.
 */
import { stimulusFromProgression } from "./progress-week";
import { codeOf } from "./vocabulary";
import type { EngineInput, Fact, StructureOccurrence, StructurePhase, StructureWorkout, WeeklyProgression } from "./types";

export function progressionFor(input: Pick<EngineInput, "parameters">, phase: StructurePhase): Fact<WeeklyProgression> | null {
  const p = input.parameters.progressionByPhase.find((x) => x.phaseIndex === phase.index);
  if (p) return { value: p.progression, source: "PROFESSIONAL", basis: "PROFESSIONAL" };
  return phase.progression ?? null;
}

function stimulusFact(value: string, from: Omit<Fact<string>, "value">): Fact<string> {
  return { ...from, value: codeOf(value) };
}

/** Estímulo de uma ocorrência: treino → progressão (sequência/bloco) → fase → resposta da geração. */
export function occurrenceStimulus(input: Pick<EngineInput, "parameters">, phase: StructurePhase, workout: StructureWorkout, week: number, indexInWeek: number): Fact<string> | null {
  if (workout.focus.stimulus) return stimulusFact(workout.focus.stimulus.value, workout.focus.stimulus);
  const prog = progressionFor(input, phase);
  const fromProg = prog ? stimulusFromProgression(prog.value, week, indexInWeek) : null;
  if (fromProg) return { value: codeOf(fromProg), source: prog!.source, basis: prog!.basis, ...(prog!.ruleId ? { ruleId: prog!.ruleId } : {}) };
  if (phase.stimulus) return stimulusFact(phase.stimulus.value, phase.stimulus);
  const answer = input.parameters.stimulusByPhase.find((s) => s.phaseIndex === phase.index);
  if (answer) return { value: codeOf(answer.value), source: "PROFESSIONAL", basis: answer.basis, ...(answer.ruleId ? { ruleId: answer.ruleId } : {}) };
  return null;
}

/** Posição (1, 2…) desta ocorrência entre as do mesmo treino na mesma semana. */
export function indexInWeek(phase: StructurePhase, occ: StructureOccurrence): number {
  return phase.occurrences.filter((o) => o.week === occ.week && o.label === occ.label && o.slot <= occ.slot).length;
}

export function occurrencesOf(phase: StructurePhase, label?: string): StructureOccurrence[] {
  return phase.occurrences.filter((o) => label === undefined || o.label === label).sort((a, b) => a.week - b.week || a.slot - b.slot);
}

/**
 * Semanas que contam para "por semana": as completas (com todas as sessões da fase); se nenhuma for completa, as que têm
 * alguma sessão. É a mesma regra da auditoria (§3.5.2).
 */
export function checkWeeksOf(phase: StructurePhase): number[] {
  const counts = new Map<number, number>();
  for (const o of phase.occurrences) counts.set(o.week, (counts.get(o.week) ?? 0) + 1);
  const weeks = Array.from({ length: phase.weeks }, (_, i) => i + 1);
  const full = weeks.filter((w) => (counts.get(w) ?? 0) >= phase.sessionsPerWeek && (counts.get(w) ?? 0) > 0);
  return full.length ? full : weeks.filter((w) => (counts.get(w) ?? 0) > 0);
}

/** Sessões do treino por semana: o MENOR número inteiro entre as semanas que contam (a pior semana, como na auditoria). */
export function exposuresOf(phase: StructurePhase, label: string, weeks: number[] = checkWeeksOf(phase)): number {
  if (!weeks.length) return 0;
  return Math.min(...weeks.map((w) => phase.occurrences.filter((o) => o.week === w && o.label === label).length));
}

/**
 * Exposição semanal usada pela seleção por microciclo e pela oferta dos alvos sugeridos: o mínimo inteiro por semana que
 * conta (`exposuresOf`) quando o treino aparece em toda semana; quando ele falta em alguma (ABCD 3×/semana, ABC 2×, AB 1×),
 * a média de sessões por semana que conta (fração, > 0). Sem isso, um treino que não aparece toda semana valeria 0 e
 * nenhum alvo, repetição ou redundância pesaria nele. Arredondada em 1e-9 para que somas de frações sejam estáveis.
 */
export function weeklyExposureOf(phase: StructurePhase, label: string, weeks: number[] = checkWeeksOf(phase)): number {
  const min = exposuresOf(phase, label, weeks);
  if (min > 0 || !weeks.length) return min;
  const inWeeks = new Set(weeks);
  const n = phase.occurrences.filter((o) => o.label === label && inWeeks.has(o.week)).length;
  return roundExposure(n / weeks.length);
}

/** Arredonda somas de exposições (frações) para comparações estáveis: 2/3 + 2/3 + 2/3 = 2. */
export function roundExposure(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}
