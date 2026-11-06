import type { OrganizationAiRow, PlanRow } from "@/db/ai-platform";
import { organizationState, organizationUsage } from "./ai-view";

/**
 * Pure read-model helpers of the usage reports (PR 5.1): latency percentiles, rates and quota alerts. Nothing here reads a payload: the inputs
 * are counts, durations and enums taken from the ledger.
 */

/** Nearest-rank percentile of an ascending list; null for an empty list. `p` in (0, 100]. */
export function percentile(sortedAscending: readonly number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sortedAscending.length));
  return sortedAscending[Math.min(rank, sortedAscending.length) - 1]!;
}

export interface LatencySummary {
  /** Calls that reached the provider and reported a duration (cache hits have none). */
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export function summarizeLatency(values: readonly number[]): LatencySummary {
  const sorted = [...values].filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  return { samples: sorted.length, p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95), maxMs: sorted.length ? sorted[sorted.length - 1]! : null };
}

/** Cache hits over (cache hits + calls that went to the provider); null when there was no activity at all, never 0 of 0. */
export function cacheHitRate(cacheHits: number, requests: number): number | null {
  const total = cacheHits + requests;
  return total === 0 ? null : cacheHits / total;
}

/** Errors over calls that reached the provider (settled or failed); null without calls. */
export function errorRate(errors: number, requests: number): number | null {
  const total = errors + requests;
  return total === 0 ? null : errors / total;
}

export function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export const ERROR_CODE_LABEL: Record<string, string> = {
  AUTH: "chave recusada",
  RATE_LIMIT: "limite de pedidos do provedor",
  PROVIDER_QUOTA: "saldo ou cota do provedor",
  TIMEOUT: "tempo esgotado",
  NETWORK: "falha de rede",
  BAD_REQUEST: "pedido recusado",
  MODEL_NOT_FOUND: "modelo não encontrado",
  INVALID_JSON: "resposta inválida",
  TRUNCATED: "resposta cortada",
  REFUSED: "recusa do modelo",
  SERVER_ERROR: "erro do provedor",
  STALE: "pedido sem resposta (encerrado pela ferramenta)",
  UNKNOWN: "erro desconhecido",
};
export const errorCodeLabel = (code: string) => ERROR_CODE_LABEL[code] ?? code;

export const QUOTA_WARN_PERCENT = 80;

export type QuotaAlertLevel = "WARNING" | "LIMIT";
export interface QuotaAlert {
  organizationId: string;
  organizationName: string;
  level: QuotaAlertLevel;
  percent: number;
  message: string;
}

/** Alerts for organizations with AI on and a measurable allowance: 80% of the plan used (or reserved) and 100% (limit reached). */
export function quotaAlerts(organizations: readonly OrganizationAiRow[], plans: readonly PlanRow[]): QuotaAlert[] {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const alerts: QuotaAlert[] = [];
  for (const org of organizations) {
    if (!org.enabled) continue;
    const plan = org.quotaPlanId ? (byId.get(org.quotaPlanId) ?? null) : null;
    const state = organizationState(org, plan);
    if (state.code === "LIMIT_REACHED") {
      alerts.push({ organizationId: org.organizationId, organizationName: org.organizationName, level: "LIMIT", percent: 100, message: `${org.organizationName}: limite do plano atingido. Novos pedidos de IA ficam bloqueados até o próximo mês ou até trocar o plano.` });
      continue;
    }
    const percent = organizationUsage(org, plan).percent;
    if (percent !== null && percent >= QUOTA_WARN_PERCENT) {
      alerts.push({ organizationId: org.organizationId, organizationName: org.organizationName, level: "WARNING", percent, message: `${org.organizationName}: ${percent}% da franquia do mês já foi usada.` });
    }
  }
  return alerts.sort((a, b) => (a.level === b.level ? b.percent - a.percent || a.organizationName.localeCompare(b.organizationName) : a.level === "LIMIT" ? -1 : 1));
}
