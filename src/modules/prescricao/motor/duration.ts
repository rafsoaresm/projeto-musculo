/**
 * Estimativa de duração de uma ocorrência com a sua própria dose. Conservadora: usa o máximo das
 * faixas. Sem como calcular (distância sem ritmo, dose vazia, descanso não informado), a parte
 * fica de fora e a estimativa é marcada como incompleta; nada é suposto.
 */
import type { RuleLog } from "./trace";
import type { CatalogExercise, Dose, Intensity } from "./types";

export interface ItemDuration {
  seconds: number | null;
}

function pacePerKm(i: Intensity | undefined): number | null {
  if (i?.kind === "PACE") return i.secondsPerKm.max;
  if (i?.kind === "ZONE" && i.bounds?.unit === "PACE_S_PER_KM") return i.bounds.range.max;
  return null;
}

function distanceSeconds(meters: number, intensity: Intensity | undefined): number | null {
  const pace = pacePerKm(intensity);
  return pace === null ? null : (meters / 1000) * pace;
}

export function itemSeconds(log: RuleLog, dose: Dose | null, exercise: CatalogExercise | null): number | null {
  if (!dose) return null;
  const D = log.get("DURATION");
  const sides = exercise?.laterality === "UNILATERAL" ? D.unilateralFactor : 1;
  const restTotal = (sets: number, rest: number | null) => (sets <= 1 ? 0 : rest === null ? null : (sets - 1) * rest);
  switch (dose.metric) {
    case "REPS": {
      const perRep = exercise?.secondsPerRep ?? D.defaultSecondsPerRep;
      const rest = restTotal(dose.sets, dose.restSeconds);
      if (rest === null) return null;
      return dose.sets * dose.reps.max * perRep * sides + rest + D.transitionSecondsPerExercise;
    }
    case "TIME": {
      const rest = restTotal(dose.sets, dose.restSeconds);
      if (rest === null) return null;
      return dose.sets * dose.durationSeconds.max * sides + rest + D.transitionSecondsPerExercise;
    }
    case "DISTANCE": {
      const each = distanceSeconds(dose.distanceMeters.max, dose.intensity);
      const rest = restTotal(dose.sets, dose.restSeconds);
      if (each === null || rest === null) return null;
      return dose.sets * each + rest + D.transitionSecondsPerExercise;
    }
    case "INTERVALS": {
      const work = dose.work.durationSeconds?.max ?? (dose.work.distanceMeters ? distanceSeconds(dose.work.distanceMeters.max, dose.work.intensity) : null);
      if (work === null) return null;
      const betweenBlocks = dose.blocks <= 1 ? 0 : dose.restBetweenBlocksSeconds;
      if (betweenBlocks === null) return null;
      const perBlock = dose.repeats * work + Math.max(0, dose.repeats - 1) * dose.recovery.durationSeconds.max;
      return dose.blocks * perBlock + Math.max(0, dose.blocks - 1) * betweenBlocks + D.transitionSecondsPerExercise;
    }
    case "CONTINUOUS": {
      const s = dose.durationSeconds?.max ?? (dose.distanceMeters ? distanceSeconds(dose.distanceMeters.max, dose.intensity) : null);
      return s === null ? null : s + D.transitionSecondsPerExercise;
    }
  }
}

export function occurrenceMinutes(
  log: RuleLog,
  items: Array<{ dose: Dose | null; exercise: CatalogExercise | null }>,
): { minutes: number | null; complete: boolean } {
  if (!items.length) return { minutes: 0, complete: true };
  const D = log.get("DURATION");
  let total = D.warmupSeconds;
  let complete = true;
  let known = 0;
  for (const i of items) {
    const s = itemSeconds(log, i.dose, i.exercise);
    if (s === null) complete = false;
    else {
      total += s;
      known++;
    }
  }
  if (!known) return { minutes: null, complete: false };
  return { minutes: Math.ceil(total / 60), complete };
}
