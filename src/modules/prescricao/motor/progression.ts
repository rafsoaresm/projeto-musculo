import type { Dose, ProgressionProposal, TrainingExposure } from "./types.ts";
export interface ProgressionSettings { consecutiveSuccesses?: number; incrementKg?: number; maximumIncrementFraction?: number; }
/** A proposal, not an automatic modification of delivered sessions. */
export function proposeProgression(exposures: TrainingExposure[], exerciseId: string, prescribed: Dose, settings: ProgressionSettings = {}): ProgressionProposal {
  const relevant = exposures.filter(x => x.exerciseId === exerciseId).sort((a, b) => a.date.localeCompare(b.date));
  if (relevant.some(x => x.sets.some(s => s.pain))) return { action: "REVIEW", newLoadKg: null, explanation: "Dor relatada em uma exposição: revisão profissional antes de progressão." };
  const threshold = settings.consecutiveSuccesses ?? 2;
  if (!Number.isSafeInteger(threshold) || threshold <= 0) throw new Error("INVALID_PROGRESSION_THRESHOLD");
  const completed = relevant.filter(x => x.sets.length >= prescribed.sets && x.sets.every(s => s.completed)).slice(-threshold);
  if (completed.length < threshold) return { action: "INSUFFICIENT_DATA", newLoadKg: null, explanation: "Poucas exposições completas e comparáveis; não inventar carga." };
  const equipment = completed[0]?.equipmentKey;
  if (completed.some(x => x.equipmentKey !== equipment || x.exerciseMetric !== "reps")) return { action: "REVIEW", newLoadKg: null, explanation: "Equipamento ou métrica diferente impede comparação." };
  const logs = completed.flatMap(x => x.sets.slice(0, prescribed.sets));
  if (logs.some(s => s.loadKg === undefined || s.loadBasis !== prescribed.loadBasis || s.rir === undefined)) {
    return { action: "INSUFFICIENT_DATA", newLoadKg: null, explanation: "Faltam kg, unidade/base ou RIR comparáveis." };
  }
  const uniqueLoads = [...new Set(logs.map(s => s.loadKg))];
  if (uniqueLoads.length !== 1) return { action: "REVIEW", newLoadKg: null, explanation: "Cargas diferentes entre séries/exposições; conferir antes da progressão." };
  const load = uniqueLoads[0];
  if (load === undefined || prescribed.repsMax === undefined) return { action: "INSUFFICIENT_DATA", newLoadKg: null, explanation: "Faltam parâmetros suficientes para propor progressão." };
  if (!logs.every(s => (s.reps ?? -1) >= prescribed.repsMax! && (s.rir ?? -1) >= (prescribed.rirMin ?? 0))) {
    return { action: "MAINTAIN", newLoadKg: load, explanation: "Ainda não atingiu o topo da faixa com esforço adequado em todas as séries." };
  }
  const increment = settings.incrementKg;
  if (increment === undefined || !Number.isFinite(increment) || increment <= 0) {
    return { action: "MAINTAIN", newLoadKg: load, explanation: "Incremento do equipamento não informado; manter kg até confirmar." };
  }
  const maximumFraction = settings.maximumIncrementFraction ?? 0.10;
  if (load <= 0 || increment / load > maximumFraction) return { action: "MAINTAIN", newLoadKg: load, explanation: "O menor incremento excede a progressão máxima configurada; não aumentar automaticamente." };
  return { action: "INCREASE", newLoadKg: Math.round((load + increment) * 100) / 100, explanation: `Propor +${increment} kg na mesma base ${prescribed.loadBasis} após ${threshold} exposições comparáveis; exige aceite profissional.` };
}