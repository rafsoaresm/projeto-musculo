/**
 * Vocabulário do motor: códigos e rótulos em pt-BR. Códigos desconhecidos são aceitos (qualquer
 * objetivo, modalidade ou padrão): sem rótulo conhecido, aparecem como foram escritos.
 */
export const VOCABULARY_VERSION = "2026.11.1";

/** Compara por ponto de código (independe de ICU e de idioma do servidor). */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** minúsculas, sem acentos, espaços simples. */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Código canônico: MAIÚSCULAS_COM_SUBLINHADO, sem acentos. "Hipertrofia" → "HIPERTROFIA". */
export function codeOf(text: string): string {
  return normalizeText(text).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export const STIMULUS_LABELS: Record<string, string> = {
  HYPERTROPHY: "Hipertrofia",
  STRENGTH: "Força",
  POWER: "Potência",
  MUSCULAR_ENDURANCE: "Resistência muscular",
  GENERAL_FITNESS: "Condicionamento geral",
  AEROBIC_ENDURANCE: "Resistência aeróbia",
  INTERVALS: "Intervalado",
  MOBILITY: "Mobilidade",
  BALANCE: "Equilíbrio",
  RECOVERY: "Recuperação",
};

export const MODALITY_LABELS: Record<string, string> = {
  RESISTANCE: "Treino resistido",
  CARDIO: "Cardiorrespiratório",
  MOBILITY: "Mobilidade",
  BALANCE: "Equilíbrio",
  SKILL: "Habilidade",
};

export const PATTERN_LABELS: Record<string, string> = {
  SQUAT: "Agachar",
  HINGE: "Dobradiça de quadril",
  LUNGE: "Afundo",
  HORIZONTAL_PUSH: "Empurrar horizontal",
  HORIZONTAL_PULL: "Puxar horizontal",
  VERTICAL_PUSH: "Empurrar vertical",
  VERTICAL_PULL: "Puxar vertical",
  ANTI_EXTENSION: "Antiextensão",
  CYCLICAL: "Cíclico",
  MOBILITY: "Mobilidade",
  BALANCE: "Equilíbrio",
};

export function labelOf(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return "—";
  return map[code] ?? code;
}

/** Rótulos dos códigos de aviso; a UI mostra o rótulo e a mensagem. */
export const ISSUE_LABELS: Record<string, string> = {
  RULESET_UNKNOWN: "Conjunto de regras desconhecido",
  INPUT_INVALID: "Dado de entrada inválido",
  PHASES_OVER_TECHNICAL_LIMIT: "Mais fases do que o limite técnico",
  SESSIONS_OVER_TECHNICAL_LIMIT: "Mais sessões por semana do que o limite técnico",
  OCCURRENCES_MISSING: "Fase sem sessões no calendário",
  OCCURRENCE_LABEL_UNKNOWN: "Sessão com treino inexistente",
  STIMULUS_MISSING: "Estímulo não definido",
  MODALITY_MISSING: "Modalidade não definida",
  EXERCISE_COUNT_MISSING: "Quantidade de exercícios não definida",
  COUNT_BY_TIME_NEEDS_BUDGET: "Quantidade pelo tempo sem tempo disponível",
  EQUIPMENT_UNKNOWN: "Equipamentos disponíveis não informados",
  CATALOG_INSUFFICIENT: "Biblioteca sem exercícios elegíveis suficientes",
  EXERCISE_TARGET_UNMET: "Quantidade de exercícios não atingida",
  LOCKED_EXERCISE_INELIGIBLE: "Exercício travado não é mais elegível",
  EXISTING_EXCEEDS_TARGET: "Linhas existentes passam da quantidade",
  EXISTING_WORKOUT_NOT_IN_STRUCTURE: "Linha existente em treino que não está na estrutura",
  EXISTING_ROW_REPLACED: "Linha existente substituída",
  NO_TARGETS: "Treino sem alvos de cobertura",
  MUSCLE_NOT_COVERED: "Músculo-alvo sem exercício principal",
  PATTERN_NOT_COVERED: "Padrão-alvo sem exercício",
  METRIC_MISSING: "Exercício sem métrica",
  DOSE_POLICY_MISSING: "Sem regra de dose",
  DOSE_INVALID: "Dose inválida",
  PROGRESSION_INVALID: "Progressão inválida",
  PROGRESSION_PARAM_MISSING: "Progressão sobre parâmetro ausente",
  DURATION_UNKNOWN: "Duração não calculável",
  OVER_TIME_BUDGET: "Sessão passa do tempo disponível",
  BUDGET_UNKNOWN: "Tempo disponível não informado",
  DUPLICATE_EXERCISE: "Exercício repetido na sessão",
  WORKOUT_OVER_TECHNICAL_LIMIT: "Mais exercícios do que o limite técnico",
  OCCURRENCE_EMPTY: "Sessão sem exercícios",
  SLOT_KEY_TOO_LONG: "Chave do item longa demais",
  TRACE_TRUNCATED: "Justificativa resumida",
  DISPLAY_TRUNCATED: "Texto da dose resumido",
  ISSUES_AGGREGATED: "Avisos agrupados",
};
