/**
 * Rules-mode templates (design V4 §3.11), constants while they live in code (`templatesVersion: "interim-1"`). PR 2.2 moves them into
 * the ruleset (`BLUEPRINT_STRATEGY_TEMPLATES`) and adds a test that these equal the ruleset's values until they are deleted.
 * Everything here is HEURISTIC operational and editable: the Técnico must validate it (docs/PENDENCIAS.md). Pure: no clock, no network.
 * Texts are fixed pt-BR sentences with no number, dose, study or alias: they are not model output.
 */
import { RULES_TEMPLATES_INTERIM } from "../versions";
import type { SplitFamily, WorkoutRole } from "../vocab";

export const RULES_TEMPLATES_VERSION = RULES_TEMPLATES_INTERIM;

/** Families that rotate roles over the volume labels of a phase, in order of first appearance. FULL_BODY and CUSTOM have no cycle. */
export const FAMILY_ROLE_CYCLE: Readonly<Record<"UPPER_LOWER" | "PUSH_PULL_LEGS" | "BODY_PART", readonly WorkoutRole[]>> = Object.freeze({
  UPPER_LOWER: ["UPPER", "LOWER"],
  PUSH_PULL_LEGS: ["PUSH", "PULL", "LEGS"],
  BODY_PART: ["CHEST_TRICEPS", "BACK_BICEPS", "LEGS", "SHOULDERS_ARMS", "LEGS"],
});

/** A family only makes sense with at least this many sessions per week in the reference phase. */
export const FAMILY_MIN_SESSIONS: Readonly<Record<Exclude<SplitFamily, "CUSTOM">, number>> = Object.freeze({
  FULL_BODY: 1, UPPER_LOWER: 2, PUSH_PULL_LEGS: 3, BODY_PART: 4,
});

export const RULES_GLOBAL_RATIONALE =
  "Sugestão por regras operacionais, editáveis: usa a frequência semanal, a experiência informada e a estrutura salva. Não foi usada IA.";

export const FAMILY_EXPLANATION: Readonly<Record<Exclude<SplitFamily, "CUSTOM">, string>> = Object.freeze({
  FULL_BODY: "Todos os treinos trabalham o corpo inteiro. Cabe em qualquer estrutura salva e repete cada grupo muscular várias vezes na semana.",
  UPPER_LOWER: "Divide os treinos entre parte superior e parte inferior do corpo, alternando-os na ordem em que aparecem na estrutura salva.",
  PUSH_PULL_LEGS: "Alterna treinos de empurrar, de puxar e de pernas, na ordem em que aparecem na estrutura salva.",
  BODY_PART: "Dedica cada treino a poucos grupos musculares, na ordem em que os treinos aparecem na estrutura salva.",
});

export const FAMILY_TRADEOFF: Readonly<Record<Exclude<SplitFamily, "CUSTOM">, string>> = Object.freeze({
  FULL_BODY: "Cada treino divide o tempo entre muitos grupos musculares.",
  UPPER_LOWER: "Pede um número par de treinos distintos na estrutura salva.",
  PUSH_PULL_LEGS: "Pede três ou seis treinos distintos na estrutura salva.",
  BODY_PART: "Cada grupo muscular aparece menos vezes na semana.",
});

export const SCHEDULE_CHANGE_TRADEOFF = "Exige alterar rótulos, rotação ou frequência na periodização salva antes de aceitar.";

export const RULES_UNCERTAINTY_TEXT = Object.freeze({
  EXPERIENCE_UNKNOWN: "A experiência do aluno não está registrada; a sugestão supõe pouca experiência.",
  GOAL_UNKNOWN: "O objetivo do aluno não foi reconhecido nos códigos de estímulo.",
  TIME_UNKNOWN: "O tempo disponível por sessão não está registrado.",
  DAYS_UNKNOWN: "Os dias de treino disponíveis não estão registrados.",
  METADATA_INFERRED: "Parte da biblioteca ainda não foi revisada; a elegibilidade usa metadados inferidos.",
  HISTORY_ABSENT: "Não há histórico de execução recente para considerar.",
  SCREENING_OPEN: "A triagem do aluno não está concluída ou tem pendência para o profissional.",
  STRUCTURE_CONSTRAINS: "A estrutura salva tem treinos irregulares entre as semanas.",
});

export const RULES_QUESTION_TEXT = "Confirme se esta divisão combina com o que você quer para este aluno.";

export interface RulesTemplates {
  version: string;
  cycle: typeof FAMILY_ROLE_CYCLE;
  minSessions: typeof FAMILY_MIN_SESSIONS;
}
export const RULES_TEMPLATES: RulesTemplates = Object.freeze({ version: RULES_TEMPLATES_VERSION, cycle: FAMILY_ROLE_CYCLE, minSessions: FAMILY_MIN_SESSIONS });
