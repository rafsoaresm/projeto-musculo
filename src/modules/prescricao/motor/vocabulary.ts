/**
 * Vocabulário do motor: códigos e rótulos em pt-BR. Códigos desconhecidos são aceitos (qualquer
 * objetivo, modalidade ou padrão): sem rótulo conhecido, aparecem como foram escritos.
 */
import { EQUIPMENT, METRICS, MUSCLES, PATTERNS } from "@/modules/biblioteca/metadata/vocabulary";
import type { DoseParam } from "./types";

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

/** Rótulos da biblioteca (mesmo vocabulário de códigos): o texto do motor nunca mostra o código cru. */
export const PATTERN_LABELS: Record<string, string> = { ...PATTERNS };
export const MUSCLE_LABELS: Record<string, string> = { ...MUSCLES };
export const EQUIPMENT_LABELS: Record<string, string> = { ...EQUIPMENT };
export const METRIC_LABELS: Record<string, string> = { ...METRICS };

/** Parâmetros da dose como o profissional lê, com a unidade quando há. */
export const DOSE_PARAM_LABELS: Record<DoseParam, string> = {
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

/** Lista de códigos em texto, com o rótulo de cada um (o código só quando não há rótulo). */
export function labelsOf(map: Record<string, string>, codes: readonly string[]): string {
  return codes.map((c) => map[c] ?? c).join(", ");
}

/** Número para o texto em português: vírgula decimal, no máximo duas casas (sem ICU: o texto entra no hash da saída). */
export function numberText(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

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
  MICROCYCLE_STEP_LIMIT: "Seleção parou no limite técnico de passos",
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
  DOSE_PROFILE_UNCERTAIN: "Perfil de dose sem metadado da biblioteca",
  DOSE_INTENT_REJECTED: "Perfil de dose pedido fora da política",
  PROGRESSION_INTENT_NOT_APPLIED: "Intenção de progressão só informativa",
  PROGRESSION_INTENT_SUPERSEDED: "Intenção de progressão substituída pela progressão da fase",
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

/** Rótulos dos achados da auditoria técnica do plano (códigos aditivos; o vocabulário não muda de versão). */
export const AUDIT_LABELS: Record<string, string> = {
  AUDIT_TARGET_MUSCLE_UNMET: "Alvo de músculo não atingido",
  AUDIT_TARGET_MUSCLE_ABOVE: "Músculo acima do alvo",
  AUDIT_TARGET_PATTERN_UNMET: "Padrão-alvo sem sessão",
  AUDIT_INDIRECT_ONLY: "Músculos só com estímulo indireto",
  AUDIT_NON_TARGET_OMITTED: "Fora dos alvos e sem estímulo",
  AUDIT_NO_DIRECT_STIMULUS: "Sem estímulo nesta fase",
  AUDIT_NO_TARGETS: "Fase sem alvos estruturados",
  AUDIT_UNCOUNTED_ITEMS: "Itens não contados",
  AUDIT_DOSE_STIMULUS_MISMATCH: "Dose distante do estímulo",
  AUDIT_PATTERN_IMBALANCE: "Desequilíbrio entre padrões",
  AUDIT_REGION_CONCENTRATION: "Volume concentrado numa região",
  AUDIT_WORKOUT_SHARE: "Volume concentrado num treino",
  AUDIT_EXERCISE_REPEATED: "Exercício em mais de um treino",
  AUDIT_PATTERN_REPEATED_IN_SESSION: "Padrão repetido na sessão",
  AUDIT_WEEK_VOLUME_JUMP: "Salto de volume entre semanas",
  AUDIT_PHASE_VOLUME_JUMP: "Salto de volume entre fases",
  AUDIT_UNIFORM_SET_STEP: "Mesmo passo de séries em todos os exercícios",
  AUDIT_DOSE_UNIFORM: "Doses iguais em exercícios diferentes",
  AUDIT_DOSE_PROFILE_FALLBACK: "Exercícios com a dose padrão por falta de perfil",
  AUDIT_DOSE_EXERCISE_JUMP: "Salto de dose de um exercício entre semanas",
  AUDIT_INTENSITY_MISSING: "Sem intensidade num estímulo de carga",
  AUDIT_DURATION_UNDERUSED: "Tempo disponível pouco usado",
  AUDIT_PARTIAL_WEEK: "Semana parcial",
  AUDIT_PHASES_NOT_GENERATED: "Fases ainda não geradas",
  AUDIT_STRATEGY_ADHERENCE_LOW: "Pouca aderência ao foco do treino",
  AUDIT_STRATEGY_OFF_FOCUS_ITEMS: "Exercícios fora do foco por escolha do profissional",
  AUDIT_STRATEGY_SUPPLY_LOW: "Pouca oferta no foco do treino",
  AUDIT_STRATEGY_OVERLAP: "Músculos em comum entre treinos",
  AUDIT_STRATEGY_EXPOSURE: "Região com pouca exposição na semana",
  AUDIT_STRATEGY_PHASE_TARGET_OUTSIDE: "Alvo da fase fora do foco dos treinos",
  AUDIT_AGGREGATED: "Achados agrupados",
};
