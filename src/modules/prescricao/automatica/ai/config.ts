/**
 * Configuração da revisão opcional por IA. Desligada: não existe fornecedor, credencial nem variável de ambiente.
 *
 * Ligar exige, antes de qualquer código: decisão do Responsável sobre usar IA na revisão, revisão jurídica do envio de dados
 * de saúde (mesmo sem identificação) a um terceiro, escolha do fornecedor e do modelo, e onde guardar cache, uso e orçamento.
 */
import "server-only";
import { AI_PROMPT_VERSION } from "./contracts";

export interface AiReviewConfig {
  enabled: boolean;
  modelId: string | null;
  maxInputTokens: number;
  maxOutputTokens: number;
  /** Orçamento mensal em centavos. 0 = nenhum gasto permitido. */
  monthlyBudgetCents: number;
  timeoutMs: number;
  maxRetries: 0 | 1;
  promptVersion: string;
}

/** Limites de partida (design V3 §6), sem fornecedor medido: a confirmar quando houver um. */
export const AI_REVIEW_DEFAULTS: Readonly<AiReviewConfig> = Object.freeze({
  enabled: false,
  modelId: null,
  maxInputTokens: 4000,
  maxOutputTokens: 800,
  monthlyBudgetCents: 0,
  timeoutMs: 15000,
  maxRetries: 1,
  promptVersion: AI_PROMPT_VERSION,
});

/** Sempre os padrões desligados: não há fonte de configuração enquanto não houver fornecedor. */
export function resolveAiReviewConfig(): AiReviewConfig {
  return { ...AI_REVIEW_DEFAULTS };
}

/** Uma revisão só pode rodar com tudo definido: ligada, modelo escolhido, orçamento e limites positivos. */
export function aiReviewUsable(config: AiReviewConfig): boolean {
  return (
    config.enabled &&
    config.modelId !== null &&
    config.modelId.length > 0 &&
    config.monthlyBudgetCents > 0 &&
    config.maxInputTokens > 0 &&
    config.maxOutputTokens > 0 &&
    config.timeoutMs > 0
  );
}
