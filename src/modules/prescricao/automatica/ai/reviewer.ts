/**
 * Porta da revisão opcional por IA (design V3 §6). Só existe a implementação desligada: nenhuma chamada de rede, nenhum
 * fornecedor. `requestAiReview` é a costura que um fornecedor futuro usaria: confere a configuração e o tamanho do resumo
 * contra `maxInputTokens` (ver `aiSummaryLimits`), monta a chave de cache e valida a resposta crua no servidor antes de
 * devolvê-la. O limite de saída (`maxOutputTokens`) segue na configuração entregue ao fornecedor, que o aplica na chamada. O resultado é só leitura para o profissional; nada aqui aprova,
 * entrega ou altera a proposta.
 */
import "server-only";
import { aiReviewUsable, aiSummaryLimits, type AiReviewConfig } from "./config";
import { aiCacheKey, validateAiResponse, type AiReviewResponse, type AiReviewSummary } from "./contracts";
import type { AiSummaryBuild } from "./summary";

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export type AiFailure = "TIMEOUT" | "INVALID_RESPONSE" | "BUDGET" | "PROVIDER" | "INPUT_TOO_LARGE";

/** O que um fornecedor devolve: a resposta crua, ainda não confiável. */
export type AiReviewerReply =
  | { status: "NOT_CONFIGURED"; message: "IA não configurada" }
  | { status: "OK"; raw: unknown; usage: AiUsage }
  | { status: "FAILED"; reason: Exclude<AiFailure, "INVALID_RESPONSE" | "INPUT_TOO_LARGE"> };

/** O que o servidor entrega: a resposta só aparece depois de validada contra o contrato e o resumo. */
export type AiReviewOutcome =
  | { status: "NOT_CONFIGURED"; message: "IA não configurada" }
  | { status: "OK"; response: AiReviewResponse; usage: AiUsage; cacheKey: string }
  | { status: "FAILED"; reason: AiFailure; problems?: string[] };

export interface ProposalReviewer {
  review(req: { summary: AiReviewSummary; cacheKey: string; config: AiReviewConfig }): Promise<AiReviewerReply>;
}

const NOT_CONFIGURED = { status: "NOT_CONFIGURED", message: "IA não configurada" } as const;

/** Implementação padrão: responde "IA não configurada" sem chamar nada. */
export const disabledReviewer: ProposalReviewer = {
  review: async () => NOT_CONFIGURED,
};

export async function requestAiReview(
  build: AiSummaryBuild,
  config: AiReviewConfig,
  reviewer: ProposalReviewer = disabledReviewer,
): Promise<AiReviewOutcome> {
  if (!aiReviewUsable(config) || config.modelId === null) return NOT_CONFIGURED;
  // O teto vem da configuração, não do `maxChars` com que o resumo foi montado: quem chama não consegue furar o limite de custo.
  if (!build.fits || build.chars > aiSummaryLimits(config).maxChars) return { status: "FAILED", reason: "INPUT_TOO_LARGE" };
  const cacheKey = await aiCacheKey(build.summary, config.modelId, config.promptVersion);
  let reply: AiReviewerReply;
  try {
    reply = await reviewer.review({ summary: build.summary, cacheKey, config });
  } catch {
    return { status: "FAILED", reason: "PROVIDER" };
  }
  if (reply.status !== "OK") return reply;
  const checked = validateAiResponse(reply.raw, build.allowed);
  if (!checked.ok) return { status: "FAILED", reason: "INVALID_RESPONSE", problems: checked.problems };
  return { status: "OK", response: checked.response, usage: reply.usage, cacheKey };
}
