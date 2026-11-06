/**
 * Fixed pt-BR names of the planner's closed codes (progression intents, exercise classes, dose profiles), for the suggestions of GEN-04.
 * Never model text: a code outside the table reads as the code itself (so nothing is hidden), lowercased.
 */
const INTENT: Record<string, string> = {
  HOLD: "mantida (sem progressão)", VOLUME_RAMP: "por volume", LOAD_FIRST: "por carga primeiro", REPS_THEN_LOAD: "por repetições e depois carga", UNDULATING: "ondulatória", BLOCKS: "em blocos",
};
const CLASS: Record<string, string> = {
  COMPOUND_UPPER_PUSH: "composto de empurrar (superior)", COMPOUND_UPPER_PULL: "composto de puxar (superior)", COMPOUND_LOWER: "composto de inferiores",
  ISOLATION_UPPER: "isolador de superiores", ISOLATION_LOWER: "isolador de inferiores", CORE: "core", CONDITIONING: "condicionamento", MOBILITY: "mobilidade", OTHER: "outros",
};
const PROFILE: Record<string, string> = {
  COMPOUND_HEAVY: "composto pesado", COMPOUND_MODERATE: "composto moderado", ISOLATION_STANDARD: "isolador padrão", ISOLATION_HIGH_REP: "isolador de repetições altas",
  UNILATERAL_STANDARD: "unilateral padrão", CORE_STABILITY: "estabilidade de core", TIME_BASED: "por tempo", CONDITIONING_CONTINUOUS: "condicionamento contínuo",
  CONDITIONING_INTERVALS: "condicionamento intervalado", MOBILITY_HOLD: "mobilidade com sustentação", SKILL_PRACTICE: "prática de habilidade",
};
const pick = (table: Record<string, string>) => (code: string) => table[code] ?? code.toLowerCase().replace(/_/g, " ");

export const PROFILE_TEXT = { intent: pick(INTENT), exerciseClass: pick(CLASS), profile: pick(PROFILE) } as const;
