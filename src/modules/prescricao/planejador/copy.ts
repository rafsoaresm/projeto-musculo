/** pt-BR strings of the AI layer (design V4 §3.4, §3.9). Professional-facing texts hide the cause (provider, model, key). */
import type { GateReason } from "./gate";
import type { ProviderErrorCode } from "./provedores/port";

export const AI_ORG_ACK_VERSION = "1";
export const AI_ORG_ACK_TEXT =
  "Confirmo que li o aviso: o planejamento por IA envia ao provedor escolhido um resumo codificado e anonimizado do aluno (sem nome, contato, documentos, datas exatas, textos livres ou fotos). Codificar não garante que a reidentificação seja impossível.";

/** What a professional reads when AI is not available. */
export const GATE_MESSAGE: Record<GateReason, string> = {
  KILL_SWITCH_ENV: "A IA está desligada pela plataforma.",
  KILL_SWITCH_PANEL: "A IA está desligada pela plataforma.",
  SECRETS_KEY_MISSING: "IA não configurada.",
  TASK_NOT_MAPPED: "IA não configurada.",
  PROVIDER_NOT_CONNECTED: "IA não configurada.",
  ORG_DISABLED: "IA não habilitada para a sua organização.",
  NO_QUOTA_PLAN: "IA não incluída no plano.",
  ALLOWANCE_ZERO: "IA não incluída no plano.",
  ALLOWANCE_EXHAUSTED: "Limite do plano atingido neste mês.",
  COST_CURRENCY_MISMATCH: "IA não incluída no plano.",
  CIRCUIT_OPEN: "O serviço de IA está instável. Tente mais tarde ou continue por regras.",
  MINOR_BLOCKED: "Para alunos menores de idade, ou sem data de nascimento cadastrada, a montagem é por regras.",
  REQUEST_TOO_LARGE: "O resumo passou do limite por pedido do plano.",
};

export const RATE_LIMIT_MESSAGE = "Muitos pedidos de IA em pouco tempo. Tente de novo em instantes.";
export const PRIVACY_BLOCKED_MESSAGE = "Não foi possível enviar com segurança: o resumo continha um dado de identificação. Nada foi enviado.";

/** Failure of a provider call, as the professional sees it (always with the way out: continue by rules). */
export const PROVIDER_FAILURE_MESSAGE: Record<ProviderErrorCode, string> = {
  AUTH: "A IA não está disponível agora. Você pode continuar por regras.",
  RATE_LIMIT: "O serviço de IA está ocupado. Tente de novo em instantes ou continue por regras.",
  PROVIDER_QUOTA: "A IA não está disponível agora. Você pode continuar por regras.",
  TIMEOUT: "A IA demorou demais para responder. Tente de novo ou continue por regras.",
  NETWORK: "Não foi possível falar com o serviço de IA. Tente de novo ou continue por regras.",
  BAD_REQUEST: "A IA não está disponível agora. Você pode continuar por regras.",
  MODEL_NOT_FOUND: "A IA não está disponível agora. Você pode continuar por regras.",
  INVALID_JSON: "A IA devolveu uma resposta inválida. Nada foi aplicado. Tente de novo ou continue por regras.",
  TRUNCATED: "A IA devolveu uma resposta incompleta. Nada foi aplicado. Tente de novo ou continue por regras.",
  REFUSED: "A IA não respondeu a este pedido. Você pode continuar por regras.",
  SERVER_ERROR: "O serviço de IA está instável. Tente de novo ou continue por regras.",
  UNKNOWN: "A IA não está disponível agora. Você pode continuar por regras.",
};

/** What the gestor sees (precise reasons, never a key). */
export const GESTOR_GATE_MESSAGE: Record<GateReason, string> = {
  KILL_SWITCH_ENV: "Desligada pela variável de ambiente AI_PLANNER_DISABLED.",
  KILL_SWITCH_PANEL: "Desligada pelo interruptor geral do painel.",
  SECRETS_KEY_MISSING: "A chave de criptografia do servidor (AI_SECRETS_KEY) não está configurada.",
  TASK_NOT_MAPPED: "A tarefa não tem provedor e modelo escolhidos, ou está desligada.",
  PROVIDER_NOT_CONNECTED: "O provedor escolhido não tem chave conectada.",
  ORG_DISABLED: "A organização não está habilitada para IA.",
  NO_QUOTA_PLAN: "A organização não tem plano de IA.",
  ALLOWANCE_ZERO: "IA não incluída no plano: franquia ou limite por pedido igual a zero.",
  ALLOWANCE_EXHAUSTED: "Limite do plano atingido neste mês.",
  COST_CURRENCY_MISMATCH: "A moeda do limite de custo difere da moeda dos preços digitados.",
  CIRCUIT_OPEN: "Disjuntor aberto para este provedor e modelo.",
  MINOR_BLOCKED: "Aluno menor de idade ou sem data de nascimento: apenas por regras.",
  REQUEST_TOO_LARGE: "O pedido passa do limite por pedido do plano ou do teto de saída.",
};

/** Messages of the planning service for outcomes that are not a gate reason or a provider code (professional-facing). */
export const PLAN_MESSAGE = {
  not_found: "Prescrição não encontrada.",
  not_open: "Só é possível planejar uma prescrição em rascunho.",
  invalid: "Confira as respostas: algum valor não é aceito.",
  key_reused: "Esta tentativa já foi usada com outros dados. Tente de novo.",
  revision_changed: "A prescrição mudou desde que esta tela foi aberta. Recarregue para planejar com os dados atuais.",
  questions: "Faltam respostas obrigatórias para planejar.",
  in_progress: "Já há planejamentos em andamento. Aguarde alguns instantes.",
  structure_too_large: "A periodização salva é grande demais para o planejador. Use a geração automática atual.",
  privacy_blocked: PRIVACY_BLOCKED_MESSAGE,
  invalid_response: "A IA devolveu uma resposta que não passou na validação. Nada foi aplicado. Tente de novo ou continue por regras.",
  stale: "A tentativa anterior não terminou. Tente de novo ou continue por regras.",
  limit_rate: RATE_LIMIT_MESSAGE,
  rules_failed: "Não foi possível montar a sugestão por regras para esta estrutura.",
} as const;
