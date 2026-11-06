import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { aiReportsFor, LATENCY_SAMPLE_LIMIT } from "@/db/ai-reports";
import { aiPlanningFor } from "@/db/ai-planning";
import { cacheHitRate, errorRate, formatLatency, formatPercent, percentile, quotaAlerts, summarizeLatency } from "@/modules/gestor/ai-report-view";
import type { OrganizationAiRow, PlanRow } from "@/db/ai-platform";
import { createPlannerEnv, NOW, PLAN_BIG, STUDENT, type PlannerEnv } from "./helpers/ai-planner-env";

vi.mock("server-only", () => ({}));

// PR 5.1: the observability read models over the usage ledger (latency percentiles, errors by cause, cache), the quota alerts and the
// permissions around them. Local D1 with the real migrations; ledger rows are seeded directly (as the settle path would leave them).
const MONTH = "2026-11";
let t: PlannerEnv;
let seq = 0;
beforeAll(async () => {
  t = await createPlannerEnv("ai-usage-reports");
  await t.db.batch([
    t.db.prepare("INSERT INTO ai_usage_month(organization_id,month,updated_at) VALUES ('org-a',?1,'x'),('org-b',?1,'x'),('org-a','2026-10','x')").bind(MONTH),
  ]);
});
afterAll(async () => {
  await t?.dispose();
});

interface Seed {
  org?: string; month?: string; task?: "PLANNER" | "ADJUSTMENTS"; state?: "SETTLED" | "RELEASED" | "CHARGED_UNKNOWN"; model?: string; latency?: number | null;
  cache?: boolean; error?: string | null; input?: number; output?: number;
}
async function seed(s: Seed = {}) {
  const n = ++seq;
  await t.run(
    `INSERT INTO ai_usage_ledger(id,organization_id,month,task,request_key,state,provider_kind,model_id,reserved_input,reserved_output,input_tokens,output_tokens,usage_source,latency_ms,error_code,cache_hit,requested_by_user_id,created_at,settled_at)
     VALUES (?1,?2,?3,?4,?5,?6,'mock',?7,100,100,?8,?9,'PROVIDER',?10,?11,?12,'tech-a',?13,?13)`,
    `led-${n}`, s.org ?? "org-a", s.month ?? MONTH, s.task ?? "PLANNER", `request-key-${String(n).padStart(8, "0")}`, s.state ?? "SETTLED", s.model ?? "m-1",
    s.input ?? 10, s.output ?? 5, s.latency === undefined ? 100 : s.latency, s.error ?? null, s.cache ? 1 : 0, `2026-11-0${1 + (n % 8)}T10:00:00.000Z`,
  );
}

describe("pure read-model helpers", () => {
  it("nearest-rank percentiles; empty is null, never 0", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(summarizeLatency([300, 100, 200, Number.NaN, -1])).toEqual({ samples: 3, p50Ms: 200, p95Ms: 300, maxMs: 300 });
    expect(summarizeLatency([])).toEqual({ samples: 0, p50Ms: null, p95Ms: null, maxMs: null });
  });
  it("rates are null without activity and formatting keeps unknown as a dash", () => {
    expect(cacheHitRate(0, 0)).toBeNull();
    expect(cacheHitRate(1, 3)).toBe(0.25);
    expect(errorRate(0, 0)).toBeNull();
    expect(errorRate(1, 3)).toBe(0.25);
    expect(errorRate(1, 1, 1)).toBe(1); // one CHARGED_UNKNOWN call is in both counts
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0.256)).toBe("26%");
    expect(formatLatency(null)).toBe("—");
    expect(formatLatency(850)).toBe("850 ms");
    expect(formatLatency(1250)).toBe("1,3 s");
  });

  const plan = (over: Partial<PlanRow> = {}): PlanRow => ({
    id: "p1", name: "P", mode: "TOTAL", totalTokens: 1000, inputTokens: null, outputTokens: null, perRequestCapPlanning: 100, perRequestCapAdjustment: 100,
    requestsPerMinute: 6, costCapMicros: null, costCapCurrency: null, archivedAt: null, organizations: 1, version: 1, ...over,
  });
  const org = (over: Partial<OrganizationAiRow> = {}): OrganizationAiRow => ({
    organizationId: "o1", organizationName: "Studio A", enabled: true, quotaPlanId: "p1", quotaPlanName: "P", usedTokens: 0, usedInput: 0, usedOutput: 0,
    reservedTokens: 0, reservedInput: 0, reservedOutput: 0, costMicros: 0, reservedCostMicros: 0, costCurrency: null, version: 1, ...over,
  });
  it("quota alerts: none below 80%, warning from 80%, limit at 100%; disabled, planless and zero-allowance organizations raise none", () => {
    const plans = [plan(), plan({ id: "zero", totalTokens: 0 })];
    const alerts = quotaAlerts(
      [
        org({ organizationId: "low", organizationName: "Low", usedTokens: 790 }),
        org({ organizationId: "warn", organizationName: "Warn", usedTokens: 800 }),
        org({ organizationId: "reserved", organizationName: "Reserved", usedTokens: 500, reservedTokens: 400 }),
        org({ organizationId: "limit", organizationName: "Limit", usedTokens: 1000 }),
        org({ organizationId: "off", organizationName: "Off", enabled: false, usedTokens: 2000 }),
        org({ organizationId: "none", organizationName: "None", quotaPlanId: null }),
        org({ organizationId: "zero", organizationName: "Zero", quotaPlanId: "zero" }),
      ],
      plans,
    );
    expect(alerts.map((a) => [a.organizationId, a.level, a.percent])).toEqual([["limit", "LIMIT", 100], ["reserved", "WARNING", 90], ["warn", "WARNING", 80]]);
    expect(alerts[0]!.message).toContain("limite do plano atingido");
  });
  it("archived plan, rounding and cost-cap warnings", () => {
    expect(quotaAlerts([org({ usedTokens: 1500 })], [plan({ archivedAt: "2026-11-01T00:00:00.000Z" })])).toEqual([]);
    expect(quotaAlerts([org({ usedTokens: 795 })], [plan()])).toEqual([]);
    expect(quotaAlerts([org({ usedTokens: 999 })], [plan()]).map((a) => [a.level, a.percent])).toEqual([["WARNING", 99]]);
    const capped = plan({ costCapMicros: 1_000_000, costCapCurrency: "USD" });
    expect(quotaAlerts([org({ costMicros: 850_000, costCurrency: "USD" })], [capped]).map((a) => a.level)).toEqual(["WARNING"]);
  });
  it("split allowance alerts on the worst side; a reached cost cap is a limit", () => {
    const split = plan({ mode: "SPLIT", totalTokens: null, inputTokens: 1000, outputTokens: 100 });
    expect(quotaAlerts([org({ usedInput: 100, usedOutput: 85 })], [split]).map((a) => a.level)).toEqual(["WARNING"]);
    const capped = plan({ costCapMicros: 1_000_000, costCapCurrency: "USD" });
    expect(quotaAlerts([org({ costMicros: 1_000_000, costCurrency: "USD" })], [capped]).map((a) => a.level)).toEqual(["LIMIT"]);
  });
});

describe("operational report over the ledger (D1)", () => {
  it("latency percentiles, errors by cause and per-model counts, per organization and task", async () => {
    for (const ms of [100, 200, 300, 400, 1000]) await seed({ latency: ms });
    await seed({ latency: 2000, state: "RELEASED", error: "TIMEOUT", input: 0, output: 0 });
    await seed({ latency: 50, state: "RELEASED", error: "RATE_LIMIT" });
    await seed({ latency: 60, state: "RELEASED", error: "RATE_LIMIT", model: "m-2" });
    await seed({ latency: null, cache: true });
    await seed({ latency: 70, task: "ADJUSTMENTS" });
    await seed({ latency: 5000, org: "org-b" });
    await seed({ latency: 9999, month: "2026-10" });
    const report = await aiReportsFor(t.db, { userId: "g1" }).operational(MONTH);
    expect(report.latencyTruncated).toBe(false);
    const a = report.rows.find((r) => r.organizationId === "org-a" && r.task === "PLANNER")!;
    // failed calls (2000, 50, 60) count as errors and stay out of the percentiles of answered calls
    expect(a.latency).toEqual({ samples: 5, p50Ms: 300, p95Ms: 1000, maxMs: 1000 });
    expect(a.errorsByCode).toEqual([{ code: "RATE_LIMIT", count: 2 }, { code: "TIMEOUT", count: 1 }]);
    expect(a.byModel).toEqual([
      { providerKind: "mock", modelId: "m-1", requests: 7, errors: 2, p95Ms: 1000 },
      { providerKind: "mock", modelId: "m-2", requests: 1, errors: 1, p95Ms: null },
    ]);
    expect(report.rows.find((r) => r.organizationId === "org-a" && r.task === "ADJUSTMENTS")!.latency.p50Ms).toBe(70);
    expect(report.rows.find((r) => r.organizationId === "org-b")!.latency.p95Ms).toBe(5000);
    // the other month is a separate report
    expect((await aiReportsFor(t.db, { userId: "g1" }).operational("2026-10")).rows[0]!.latency.p50Ms).toBe(9999);
    expect(await aiReportsFor(t.db, { userId: "g1" }).operational("2026-09")).toEqual({ month: "2026-09", rows: [], latencyTruncated: false });
  });

  it("matches the totals of the usage overview (requests, cache, errors) for the same month", async () => {
    const usage = await t.gestor().usage(MONTH);
    const report = await aiReportsFor(t.db, { userId: "g1" }).operational(MONTH);
    for (const u of usage) {
      const o = report.rows.find((r) => r.organizationId === u.organizationId && r.task === u.task)!;
      expect(o.errorsByCode.reduce((s, e) => s + e.count, 0)).toBe(u.errors);
    }
  });

  it("only an active platform manager reads it: professionals, owners and revoked managers get nothing", async () => {
    for (const who of ["tech-a", "owner-a", "commercial-a", "tech-b", "nobody"]) {
      expect(await aiReportsFor(t.db, { userId: who }).operational(MONTH)).toEqual({ month: MONTH, rows: [], latencyTruncated: false });
    }
    await t.run("UPDATE platform_admins SET revoked_at = '2026-11-02T00:00:00Z' WHERE user_id = 'g1'");
    expect((await aiReportsFor(t.db, { userId: "g1" }).operational(MONTH)).rows).toEqual([]);
    await t.run("UPDATE platform_admins SET revoked_at = NULL WHERE user_id = 'g1'");
    expect((await aiReportsFor(t.db, { userId: "g1" }).operational(MONTH)).rows.length).toBeGreaterThan(0);
  });

  it("no prompt, response or student data can be in a report: the ledger has no such column and the report carries none of the canaries", async () => {
    const columns = (await t.all<{ name: string }>("SELECT name FROM pragma_table_info('ai_usage_ledger')")).map((c) => c.name).sort();
    expect(columns).toEqual([
      "attempts", "cache_hit", "cached_input_tokens", "created_at", "currency", "error_code", "http_status", "id", "input_tokens", "latency_ms", "model_id",
      "month", "organization_id", "output_tokens", "price_input_micros_per_million", "price_output_micros_per_million", "provider_kind", "request_key",
      "requested_by_user_id", "reserved_cost_micros", "reserved_input", "reserved_output", "settled_at", "state", "task", "usage_source", "cost_micros",
    ].sort());
    const report = JSON.stringify(await aiReportsFor(t.db, { userId: "g1" }).operational(MONTH));
    for (const canary of [STUDENT.name, STUDENT.email, STUDENT.phone, STUDENT.injury, "st-1", "tech-a"]) expect(report).not.toContain(canary);
    expect(Object.keys(JSON.parse(report).rows[0]).sort()).toEqual(["byModel", "errorsByCode", "latency", "organizationId", "task"]);
  });

  it("the latency sample is bounded and says so", () => {
    expect(LATENCY_SAMPLE_LIMIT).toBeGreaterThan(1000);
  });
});

describe("the professional's allowance (read only, no cost, own organization)", () => {
  it("shows tokens only, per organization, to an active member; nothing to others", async () => {
    const g = t.gestor();
    const created = await g.savePlan(null, { ...PLAN_BIG, name: "Franquia relatorio", allowance: { mode: "TOTAL", total: 1000 } }, null, NOW);
    if (!created.ok) throw new Error("plan");
    const row = (await g.listOrganizations(MONTH)).find((o) => o.organizationId === "org-a")!;
    expect(await g.setOrganization("org-a", { quotaPlanId: created.id, enabled: true, ackVersion: "1" }, row.version, "1", NOW)).toBe("saved");
    await t.run("UPDATE ai_usage_month SET used_input = 40, used_output = 10, cost_micros = 777000, cost_currency = 'USD' WHERE organization_id = 'org-a' AND month = ?1", MONTH);
    const own = await aiPlanningFor(t.db, t.org("tech-a")).usageForProfessional(NOW);
    expect(own.allowance).toEqual({ mode: "TOTAL", total: 1000 });
    expect(own.used).toEqual({ input: 40, output: 10 });
    const text = JSON.stringify(own).toLowerCase();
    for (const word of ["cost", "price", "currency", "usd", "777000", "provider", "model", "latency"]) expect(text).not.toContain(word);
    // org-b: its own (empty) state, never org-a's numbers
    const other = await aiPlanningFor(t.db, t.org("tech-b", "org-b")).usageForProfessional(NOW);
    expect(other.allowance).toBeNull();
    expect(other.used).toEqual({ input: 0, output: 0 });
    // a user with no membership in org-a reading as org-a gets nothing
    const outsider = await aiPlanningFor(t.db, { userId: "tech-b", organizationId: "org-a" }).usageForProfessional(NOW);
    expect(outsider.allowance).toBeNull();
    expect(outsider.used).toEqual({ input: 0, output: 0 });
  });
});
