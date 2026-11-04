/**
 * Alvos sugeridos para uma fase sem alvos (regra MICROCYCLE_TARGET_SUGGESTIONS, 2026.11.4+). Só uma sugestão: nada vira alvo
 * sem o aceite do profissional, e o servidor recalcula esta mesma entrada para conferir um aceite. Puro e determinístico.
 */
import { getRuleSet } from "./rules";
import type { RuleLog } from "./trace";
import { checkWeeksOf, indexInWeek, occurrenceStimulus, roundExposure, weeklyExposureOf } from "./occurrence";
import { cmp, codeOf } from "./vocabulary";
import type { EngineInput, RuleSetRef, StructurePhase, WeeklySetsTarget } from "./types";

export interface TargetSuggestion {
  phaseIndex: number;
  stimulus: string;
  ruleId: "MICROCYCLE_TARGET_SUGGESTIONS";
  muscles: string[];
  patterns: string[];
  /** Um alvo por músculo sugerido; `minDirectSessions` some quando forçaria o músculo em todos os treinos de volume. */
  weeklySets: WeeklySetsTarget[];
  /**
   * Sessões semanais com treino de volume: o que a estrutura oferece a cada músculo. Por treino, a pior semana que conta;
   * treino que falta em alguma semana entra pela média (pode dar fração, ex.: ABC 2×/semana → 2).
   */
  supply: number;
}

export type TargetSuggestionOutcome =
  | { suggestion: TargetSuggestion }
  | { suggestion: null; reason: "NO_RULE" | "MIXED_STIMULI" | "UNKNOWN_STIMULUS" };

/**
 * A sugestão de alvos da fase. Existe só quando todas as sessões da fase têm o mesmo estímulo (depois de semanas, treinos e
 * sequências da progressão) e a regra tem uma entrada para ele; com estímulos variados, o profissional define os alvos.
 */
export function targetSuggestion(rules: RuleSetRef | RuleLog, phase: StructurePhase, input: Pick<EngineInput, "parameters">): TargetSuggestionOutcome {
  const set = "rules" in rules ? rules.rules : getRuleSet(rules);
  const table = set?.rules.MICROCYCLE_TARGET_SUGGESTIONS?.value;
  if (!set || !table) return { suggestion: null, reason: "NO_RULE" };
  const stimuli = new Set<string>();
  let unknown = false;
  for (const o of phase.occurrences) {
    const w = phase.workouts.find((x) => x.label === o.label);
    const s = w ? occurrenceStimulus(input, phase, w, o.week, indexInWeek(phase, o)) : null;
    if (s) stimuli.add(s.value);
    else unknown = true;
  }
  if (stimuli.size > 1) return { suggestion: null, reason: "MIXED_STIMULI" };
  const stimulus = [...stimuli][0];
  const entry = stimulus ? table[stimulus] : undefined;
  if (unknown || !stimulus || !entry) return { suggestion: null, reason: "UNKNOWN_STIMULUS" };
  // Treinos de volume: modalidades do treino, da resposta da geração ou do estímulo (a mesma ordem do motor).
  const volume = new Set(set.rules.VOLUME_MODALITIES.value.map(codeOf));
  const weeks = checkWeeksOf(phase);
  let supply = 0;
  for (const w of phase.workouts) {
    const answered = input.parameters.modalitiesByWorkout.find((m) => m.phaseIndex === phase.index && m.label === w.label)?.modalities;
    const mods = w.focus.modalities?.length ? w.focus.modalities : answered?.length ? answered : set.rules.MODALITY_FOR_STIMULUS.value[stimulus] ?? [];
    // Treino que falta em alguma semana (ABCD 3×/semana): conta a média de sessões por semana, não 0.
    if (mods.some((m) => volume.has(codeOf(m)))) supply = roundExposure(supply + weeklyExposureOf(phase, w.label, weeks));
  }
  const muscles = [...(entry.muscles ?? [])].sort(cmp);
  const minDirect = entry.minDirectSessions !== undefined && entry.minDirectSessions < supply ? entry.minDirectSessions : undefined;
  const weekly = entry.weeklyWeightedSets;
  const weeklySets: WeeklySetsTarget[] =
    weekly || minDirect !== undefined
      ? muscles.map((muscle) => ({
          muscle,
          ...(weekly ? { minWeighted: weekly.min, maxWeighted: weekly.max } : {}),
          ...(minDirect !== undefined ? { minDirectSessions: minDirect } : {}),
        }))
      : [];
  return {
    suggestion: {
      phaseIndex: phase.index, stimulus, ruleId: "MICROCYCLE_TARGET_SUGGESTIONS",
      muscles, patterns: [...(entry.patterns ?? [])].sort(cmp), weeklySets, supply,
    },
  };
}
