import type { D1Database } from "@cloudflare/workers-types";
import type { AiTask } from "@/modules/prescricao/planejador/provedores/port";
import { summarizeLatency, type LatencySummary } from "@/modules/gestor/ai-report-view";
import { adminGuard, type PlatformContext } from "./platform";

/**
 * Observability read models of the AI layer (design V4 §8.6, PR 5.1), for the platform manager only. Everything is derived from the
 * append-only `ai_usage_ledger`, which holds counts, durations, enums and hashes: no prompt, no response text, no student id and no health
 * data exists in any column read here (a test pins the exact column list). Every statement carries the manager guard; the professional's
 * read-only allowance is `usageForProfessional` in `ai-planning.ts` and has no cost field.
 */

/** Most recent rows read per organization and task for the latency percentiles of one month; beyond this the percentiles cover the latest ones and the panel says so. */
export const LATENCY_SAMPLE_LIMIT = 20000;

export interface OperationalRow {
  organizationId: string;
  task: AiTask;
  /** Errors of the group by `error_code` (RELEASED and CHARGED_UNKNOWN calls), sorted by count then code. */
  errorsByCode: Array<{ code: string; count: number }>;
  latency: LatencySummary;
  /** Calls that failed at the provider, per provider/model, so one bad model stands out. */
  byModel: Array<{ providerKind: string; modelId: string; requests: number; errors: number; p95Ms: number | null }>;
}

export interface OperationalReport {
  month: string;
  rows: OperationalRow[];
  /** True when the latency sample was cut at `LATENCY_SAMPLE_LIMIT` rows for some organization and task. */
  latencyTruncated: boolean;
}

interface LatencyRow {
  organizationId: string;
  task: AiTask;
  providerKind: string | null;
  modelId: string | null;
  latencyMs: number;
  failed: number;
  rn: number;
}

export function aiReportsFor(db: D1Database, context: PlatformContext) {
  const userId = context.userId;
  return {
    async operational(month: string): Promise<OperationalReport> {
      const [errors, latencies] = await db.batch([
        db
          .prepare(
            `SELECT l.organization_id AS organizationId, l.task, l.error_code AS code, COUNT(*) AS count
               FROM ai_usage_ledger l
              WHERE l.month = ?2 AND l.error_code IS NOT NULL AND l.state IN ('RELEASED','CHARGED_UNKNOWN') AND ${adminGuard("?1")}
              GROUP BY l.organization_id, l.task, l.error_code`,
          )
          .bind(userId, month),
        db
          .prepare(
            `SELECT organizationId, task, providerKind, modelId, latencyMs, failed, rn FROM (
               SELECT l.organization_id AS organizationId, l.task, l.provider_kind AS providerKind, l.model_id AS modelId, l.latency_ms AS latencyMs,
                      CASE WHEN l.state IN ('RELEASED','CHARGED_UNKNOWN') THEN 1 ELSE 0 END AS failed,
                      ROW_NUMBER() OVER (PARTITION BY l.organization_id, l.task ORDER BY l.created_at DESC, l.id DESC) AS rn
                 FROM ai_usage_ledger l
                WHERE l.month = ?2 AND l.cache_hit = 0 AND l.latency_ms IS NOT NULL AND ${adminGuard("?1")}
             ) WHERE rn <= ?3 ORDER BY organizationId, task, rn DESC`,
          )
          .bind(userId, month, LATENCY_SAMPLE_LIMIT),
      ]);
      const groups = new Map<string, { organizationId: string; task: AiTask; errors: Map<string, number>; values: number[]; models: Map<string, { providerKind: string; modelId: string; values: number[]; calls: number; errors: number }> }>();
      const group = (organizationId: string, task: AiTask) => {
        const key = `${organizationId}\u0000${task}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { organizationId, task, errors: new Map(), values: [], models: new Map() }));
        return g;
      };
      for (const e of errors.results as Array<{ organizationId: string; task: AiTask; code: string; count: number }>) {
        group(e.organizationId, e.task).errors.set(e.code, e.count);
      }
      const sample = latencies.results as unknown as LatencyRow[];
      for (const r of sample) {
        const g = group(r.organizationId, r.task);
        // Latency is the time to an answer: failed calls (timeouts, refusals) are counted as errors, not mixed into the percentiles.
        if (!r.failed) g.values.push(r.latencyMs);
        const mk = `${r.providerKind ?? "?"}\u0000${r.modelId ?? "?"}`;
        let m = g.models.get(mk);
        if (!m) g.models.set(mk, (m = { providerKind: r.providerKind ?? "?", modelId: r.modelId ?? "?", values: [], calls: 0, errors: 0 }));
        m.calls += 1;
        if (!r.failed) m.values.push(r.latencyMs);
        m.errors += r.failed;
      }
      const rows: OperationalRow[] = [...groups.values()]
        .map((g) => ({
          organizationId: g.organizationId,
          task: g.task,
          errorsByCode: [...g.errors.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
          latency: summarizeLatency(g.values),
          byModel: [...g.models.values()]
            .map((m) => ({ providerKind: m.providerKind, modelId: m.modelId, requests: m.calls, errors: m.errors, p95Ms: summarizeLatency(m.values).p95Ms }))
            .sort((a, b) => a.providerKind.localeCompare(b.providerKind) || a.modelId.localeCompare(b.modelId)),
        }))
        .sort((a, b) => a.organizationId.localeCompare(b.organizationId) || a.task.localeCompare(b.task));
      return { month, rows, latencyTruncated: sample.some((r) => r.rn >= LATENCY_SAMPLE_LIMIT) };
    },
  };
}
