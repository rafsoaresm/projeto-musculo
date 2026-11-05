import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlannerEnv, ANSWERS, BASE_ENV, KEY, NOW, STUDENT, taskOf, type PlannerEnv } from "./helpers/ai-planner-env";
import { aiPlanningFor } from "@/db/ai-planning";
import { parseGenerationAnswers } from "@/modules/prescricao/automatica/contracts";
import { canonicalJson, sha256Hex } from "@/modules/prescricao/motor/hash";
import { reservationFor } from "@/modules/prescricao/planejador/quota";
import { PATTERN_CODES } from "@/modules/prescricao/planejador/vocab";
import { toBase64Url } from "@/modules/prescricao/planejador/secrets";
import { mockPlan, mockProvider } from "@/modules/prescricao/planejador/provedores/mock";
import type { ProviderResult } from "@/modules/prescricao/planejador/provedores/port";
import type { PlanningOutcome } from "@/modules/prescricao/planejador/orchestration";

vi.mock("server-only", () => ({}));

// The planning service (sub-stage 1.3) on a local D1 (Miniflare, migrations 0001-0047) with the mock provider and, for the real-adapter test, the
// OpenAI adapter against a MOCKED fetch. No real provider is ever called. The persistence primitives are tested in ai-d1.test.ts; here the
// subject is the ORDER and the STATES: gates -> context -> cache/idempotent run -> provider -> validate -> persist, and the way out by rules.
let t: PlannerEnv;
beforeAll(async () => {
  t = await createPlannerEnv("planner-service-tests");
});
afterAll(async () => {
  await t?.dispose();
});

const key = () => t.id("key");
/**
 * Answers that make a context (and so a cache key) no earlier test has used: the pair of excluded patterns is the n-th pair in mixed radix.
 * (A session length above 3 h would not do: it shares one band.)
 */
let uniqueSeq = 0;
const uniqueAnswers = () => uniqueFor(uniqueSeq++);
const uniqueFor = (n: number) => {
  const first = PATTERN_CODES[n % PATTERN_CODES.length];
  const second = PATTERN_CODES[Math.floor(n / PATTERN_CODES.length) % PATTERN_CODES.length];
  return { ...ANSWERS, excludedPatterns: first === second ? [first] : [first, second] };
};
const body = (d: { revisionId: string }, mode: "AI" | "RULES", over: Record<string, unknown> = {}) =>
  t.contentVersion(d.revisionId).then((baseContentVersion) => ({ idempotencyKey: key(), baseContentVersion, mode, answers: ANSWERS, ...over }));
async function plan(d: { planId: string; revisionId: string }, mode: "AI" | "RULES", svc = t.service(), over: Record<string, unknown> = {}): Promise<PlanningOutcome> {
  return svc.plan(d.planId, d.revisionId, (await body(d, mode, over)) as never);
}
const reason = (o: PlanningOutcome) => (o.ok ? "ok" : o.reason);
function ok(o: PlanningOutcome) {
  if (!o.ok) throw new Error(`${o.reason}: ${o.message}`);
  return o;
}
const counts = async () => ({
  runs: await t.n("SELECT COUNT(*) AS n FROM planning_runs"),
  ledger: await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger"),
  cache: await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache"),
  payloads: await t.n("SELECT COUNT(*) AS n FROM planning_run_payloads"),
});
/** Nothing that belongs to the prescription moved: no row written, no state, no version. */
async function prescriptionState(d: { planId: string; revisionId: string }) {
  return {
    revision: await t.first<Record<string, unknown>>("SELECT state, content_version FROM plan_revisions WHERE id = ?1", d.revisionId),
    items: await t.n("SELECT COUNT(*) AS n FROM prescribed_exercises WHERE revision_id = ?1", d.revisionId),
    proposals: await t.n("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", d.revisionId),
    approvals: await t.n("SELECT COUNT(*) AS n FROM training_plan_events WHERE plan_id = ?1 AND action NOT IN ('CREATED')", d.planId),
  };
}

describe("rules mode works with the AI completely unconfigured", () => {
  it("suggests strategies by rules, labelled as a heuristic, persists the run and the blueprint, and touches neither the ledger nor the prescription", async () => {
    const d = await t.newDraft();
    const before = await prescriptionState(d);
    const out = ok(await plan(d, "RULES"));
    expect(out).toMatchObject({ producer: "RULES", replayed: false, cache: null, usage: null });
    expect(out.blueprint.label).toBe("Heurística operacional (editável)");
    expect(out.blueprint.producer).toBe("RULES");
    expect(out.blueprint.strategies.map((s) => s.splitFamily)).toEqual(["UPPER_LOWER", "FULL_BODY", "PUSH_PULL_LEGS"]);
    expect(out.blueprint.strategies[0].phases[0].workouts.map((w) => [w.label, w.role])).toEqual([["A", "UPPER"], ["B", "LOWER"]]);
    const run = await t.first<Record<string, unknown>>("SELECT * FROM planning_runs WHERE id = ?1", out.runId);
    expect(run).toMatchObject({ mode: "RULES", status: "SUCCEEDED", failure_code: null, cache_hit: 0, provider_kind: null, model_id: null, ledger_id: null, templates_version: "gymgital-base@2026.11.5", base_content_version: before.revision!.content_version });
    expect(String(run!.blueprint_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(await t.n("SELECT COUNT(*) AS n FROM planning_run_payloads WHERE run_id = ?1", out.runId)).toBe(1);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger")).toBe(0);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_month")).toBe(0);
    expect(await prescriptionState(d)).toEqual(before);
  });

  it("the AI path is closed with every gate off: not configured, nothing is called, nothing is written, and the way out is rules", async () => {
    const d = await t.newDraft();
    const { provider, calls } = t.spy();
    const before = await counts();
    const out = await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: provider } }));
    expect(out).toMatchObject({ ok: false, reason: "not_configured", canContinueByRules: true, message: "IA não configurada." });
    expect(calls).toHaveLength(0);
    expect(await counts()).toEqual(before);
    // the same draft continues by rules right away
    expect(ok(await plan(d, "RULES")).producer).toBe("RULES");
  });

  it("availability reads the same gate without calling anything, and the professional's usage line has no cost", async () => {
    const d = await t.newDraft();
    const a = (await t.service().availability(d.planId, d.revisionId))!;
    expect(a).toMatchObject({ state: "TASK_NOT_MAPPED", message: "IA não configurada." });
    expect(a.usage).toEqual({ month: "2026-11", allowance: null, used: { input: 0, output: 0 }, remaining: null });
    expect(JSON.stringify(a)).not.toMatch(/cost|price|provider|model/i);
    expect(await t.service("tech-b", "org-b").availability(d.planId, d.revisionId)).toBeNull();
  });
});

describe("AI mode with the mock provider: gates, cache, idempotency, persistence", () => {
  beforeAll(async () => {
    await t.configure({ provider: "mock", model: "mock-ok", orgs: ["org-a"] });
  });

  it("runs the whole sequence: anonymised request, reserve, call, validate, settle, persist run + blueprint + cache; nothing else", async () => {
    const d = await t.newDraft();
    const before = await prescriptionState(d);
    const { provider, calls } = t.spy();
    const out = ok(await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: provider } })));
    expect(out).toMatchObject({ producer: "AI", replayed: false, cache: "MISS" });
    expect(out.blueprint.label).toBe("Sugestão da IA");
    expect(out.blueprint.strategies[0]).toMatchObject({ splitFamily: "UPPER_LOWER", provenance: "AI_SUGGESTED", recommended: true });
    expect(out.usage!.inputTokens).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    // what left the server: the coded context only
    for (const secret of [STUDENT.name, STUDENT.email, STUDENT.phone, STUDENT.birthDate, STUDENT.injury, "Zélia", "Quintanilha", "Plano de teste", "st-1", d.planId, d.revisionId, "org-a"])
      expect(calls[0].user, secret).not.toContain(secret);
    expect(calls[0].settings).toMatchObject({ kind: "mock", modelId: "mock-ok", apiKey: null });
    // run, ledger, month, cache, payload
    const run = (await t.first<Record<string, unknown>>("SELECT * FROM planning_runs WHERE id = ?1", out.runId))!;
    expect(run).toMatchObject({ mode: "AI", status: "SUCCEEDED", attempt: 1, cache_hit: 0, provider_kind: "mock", model_id: "mock-ok", prompt_version: "planner-2026.11.1", schema_version: 1, failure_code: null });
    expect(String(run.context_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(run.response_hash)).toMatch(/^[0-9a-f]{64}$/);
    const ledger = (await t.first<Record<string, unknown>>("SELECT * FROM ai_usage_ledger WHERE id = ?1", run.ledger_id))!;
    expect(ledger).toMatchObject({ state: "SETTLED", task: "PLANNER", cache_hit: 0, usage_source: "ESTIMATE", cost_micros: null, requested_by_user_id: "tech-a" });
    expect(ledger.request_key).toBe(`${out.runId}:1`);
    expect(ledger.input_tokens).toBe(out.usage!.inputTokens);
    const month = (await t.first<Record<string, number>>("SELECT * FROM ai_usage_month WHERE organization_id = 'org-a'"))!;
    expect(month.reserved_input).toBe(0);
    expect(month.reserved_output).toBe(0);
    expect(month.used_input).toBeGreaterThan(0);
    expect(month.requests).toBeGreaterThan(0);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-a' AND cache_key = ?1", run.cache_key)).toBe(1);
    expect(await t.n("SELECT COUNT(*) AS n FROM planning_run_payloads WHERE run_id = ?1", out.runId)).toBe(1);
    // no prompt, no response text, no name anywhere in the rows the layer keeps (hashes and counts only)
    const dump = JSON.stringify(await t.all("SELECT * FROM planning_runs"))
      + JSON.stringify(await t.all("SELECT * FROM ai_usage_ledger"))
      + JSON.stringify(await t.all("SELECT cache_key, provider_kind, model_id, prompt_version FROM ai_planner_cache"));
    for (const secret of [STUDENT.name, STUDENT.email, STUDENT.injury, "Zélia"]) expect(dump).not.toContain(secret);
    // generating a suggestion never changes the prescription or approves anything
    expect(await prescriptionState(d)).toEqual(before);
    // the stored blueprint is readable back and equals what was returned
    expect(await t.service().latest(d.planId, d.revisionId)).toEqual(out.blueprint);
    expect(await t.service().state(d.planId, d.revisionId)).toEqual({ state: "READY", view: out.blueprint });
  });

  it("is idempotent: the same key replays the stored outcome (no provider call, no ledger row); the same key with another body is refused", async () => {
    const d = await t.newDraft();
    const { provider, calls } = t.spy();
    const svc = t.service("tech-a", "org-a", { providers: { mock: provider } });
    // each test uses its own session length so that its context (and so its cache key) is not one an earlier test already cached
    const payload = await body(d, "AI", { answers: { ...ANSWERS, availableMinutes: 75 } });
    const first = ok(await svc.plan(d.planId, d.revisionId, payload as never));
    const ledgerRows = await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger");
    const again = ok(await svc.plan(d.planId, d.revisionId, payload as never));
    expect(again).toMatchObject({ runId: first.runId, replayed: true, producer: "AI", cache: "MISS" });
    expect(again.blueprint).toEqual(first.blueprint);
    expect(calls).toHaveLength(1);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger")).toBe(ledgerRows);
    expect(await t.n("SELECT COUNT(*) AS n FROM planning_runs WHERE revision_id = ?1", d.revisionId)).toBe(1);
    // same key, another mode / other content version
    expect(reason(await svc.plan(d.planId, d.revisionId, { ...payload, mode: "RULES" } as never))).toBe("key_reused");
    expect(reason(await svc.plan(d.planId, d.revisionId, { ...payload, baseContentVersion: payload.baseContentVersion + 1 } as never))).toBe("key_reused");
    expect(reason(await svc.plan(d.planId, d.revisionId, { ...payload, answers: { ...ANSWERS, availableMinutes: 45 } } as never))).toBe("key_reused");
    expect(calls).toHaveLength(1);
  });

  it("a second key with the same context is served from the cache: 0 tokens, a 0-token ledger row marked cache_hit, no provider call", async () => {
    const d = await t.newDraft();
    const { provider, calls } = t.spy();
    const svc = t.service("tech-a", "org-a", { providers: { mock: provider } });
    const answers = { ...ANSWERS, availableMinutes: 90 };
    const miss = ok(await plan(d, "AI", svc, { answers }));
    const monthBefore = (await t.first<Record<string, number>>("SELECT used_input, used_output, cache_hits FROM ai_usage_month WHERE organization_id = 'org-a'"))!;
    const hit = ok(await plan(d, "AI", svc, { answers }));
    expect(hit).toMatchObject({ producer: "AI", cache: "HIT", replayed: false, usage: { inputTokens: 0, outputTokens: 0 } });
    expect(hit.runId).not.toBe(miss.runId);
    expect(hit.blueprint.strategies).toEqual(miss.blueprint.strategies);
    expect(calls).toHaveLength(1);
    const monthAfter = (await t.first<Record<string, number>>("SELECT used_input, used_output, cache_hits FROM ai_usage_month WHERE organization_id = 'org-a'"))!;
    expect(monthAfter.used_input).toBe(monthBefore.used_input);
    expect(monthAfter.used_output).toBe(monthBefore.used_output);
    expect(monthAfter.cache_hits).toBe(monthBefore.cache_hits + 1);
    const run = (await t.first<Record<string, unknown>>("SELECT * FROM planning_runs WHERE id = ?1", hit.runId))!;
    expect(run).toMatchObject({ status: "SUCCEEDED", cache_hit: 1, cache_key: null }); // a hit never holds the single-flight slot of its cache key
    expect(await t.first("SELECT state, cache_hit, input_tokens, output_tokens FROM ai_usage_ledger WHERE id = ?1", run.ledger_id)).toEqual({ state: "SETTLED", cache_hit: 1, input_tokens: 0, output_tokens: 0 });
    // a replay of the hit's own key says it was a cache hit
    expect((await svc.plan(d.planId, d.revisionId, { idempotencyKey: run.idempotency_key, baseContentVersion: run.base_content_version, mode: "AI", answers } as never))).toMatchObject({ ok: true, replayed: true, cache: "HIT" });
  });

  it("changes the cache key when the context changes (other answers) but not for the same student data", async () => {
    const d = await t.newDraft();
    const { provider, calls } = t.spy();
    const svc = t.service("tech-a", "org-a", { providers: { mock: provider } });
    ok(await plan(d, "AI", svc, { answers: { ...ANSWERS, availableMinutes: 105 } }));
    ok(await plan(d, "AI", svc, { answers: { ...ANSWERS, availableMinutes: 120 } }));
    expect(calls).toHaveLength(2);
    // the same data again is a hit
    expect(ok(await plan(d, "AI", svc, { answers: { ...ANSWERS, availableMinutes: 105 } })).cache).toBe("HIT");
    expect(calls).toHaveLength(2);
  });

  it("refuses a stale screen (the prescription changed) and a draft that is not open, and writes nothing", async () => {
    const d = await t.newDraft();
    const before = await counts();
    expect(reason(await plan(d, "AI", t.service(), { baseContentVersion: 999 }))).toBe("revision_changed");
    expect(reason(await plan(d, "RULES", t.service(), { baseContentVersion: 999 }))).toBe("revision_changed");
    await t.run("UPDATE plan_revisions SET state = 'READY' WHERE id = ?1", d.revisionId);
    expect(reason(await plan(d, "AI"))).toBe("not_open");
    expect(reason(await plan(d, "RULES"))).toBe("not_open");
    expect(await counts()).toEqual(before);
  });

  it("asks the required questions instead of planning, and writes nothing; refuses malformed bodies", async () => {
    const d = await t.newDraft();
    const before = await counts();
    const out = await plan(d, "RULES", t.service(), { answers: {} });
    expect(out).toMatchObject({ ok: false, reason: "questions", canContinueByRules: false });
    if (!out.ok) expect(out.questions!.filter((q) => q.required).map((q) => q.code)).toEqual(expect.arrayContaining(["STIMULUS", "EQUIPMENT"]));
    expect(reason(await plan(d, "AI", t.service(), { answers: { equipmentCodes: ["NOPE-NOT-A-CODE"] } }))).toBe("invalid");
    expect(reason(await plan(d, "AI", t.service(), { answers: { blueprint: { version: 1 } } }))).toBe("invalid");
    expect(reason(await plan(d, "AI", t.service(), { idempotencyKey: "short" }))).toBe("invalid");
    expect(reason(await plan(d, "AI", t.service(), { mode: "MAGIC" }))).toBe("invalid");
    expect(reason(await t.service().plan(d.planId, d.revisionId, { ...(await body(d, "AI")), extra: 1 } as never))).toBe("invalid");
    expect(await counts()).toEqual(before);
  });
});

describe("the gates: every closed gate has its own state, calls nothing, writes nothing", () => {
  const setOrg = async (orgId: string, change: { enabled?: boolean; quotaPlanId?: string | null; ackVersion?: string }) => {
    const row = (await t.gestor().listOrganizations("2026-11")).find((o) => o.organizationId === orgId)!;
    return t.gestor().setOrganization(orgId, change, row.version, "1", NOW);
  };
  const orgRow = (orgId: string) => t.first<{ enabled: number; quota_plan_id: string | null }>("SELECT enabled, quota_plan_id FROM ai_organization_settings WHERE organization_id = ?1", orgId);

  it("kill switch (environment and panel), unmapped task, missing mock allowance and a disabled organization", async () => {
    const d = await t.newDraft("st-1");
    const { provider, calls } = t.spy();
    const svc = (env = BASE_ENV) => t.service("tech-a", "org-a", { providers: { mock: provider }, env });
    const before = await counts();
    const only = async (env?: Record<string, string | undefined>) => {
      const out = await plan(d, "AI", svc(env), { answers: { ...ANSWERS, availableMinutes: 135 } });
      return out.ok ? "ok" : `${out.reason}|${out.message}|${out.canContinueByRules}`;
    };
    for (const v of ["true", "TRUE", "1", "yes", "anything"]) expect(await only({ ...BASE_ENV, AI_PLANNER_DISABLED: v })).toBe("disabled|A IA está desligada pela plataforma.|true");
    expect(await only({ AI_SECRETS_KEY: BASE_ENV.AI_SECRETS_KEY })).toBe("not_configured|IA não configurada.|true"); // the mock needs AI_MOCK_ENABLED
    // the panel's switch
    expect(await t.gestor().setKillSwitch(true, NOW)).toBe(true);
    expect(await only()).toBe("disabled|A IA está desligada pela plataforma.|true");
    expect((await svc().availability(d.planId, d.revisionId))!.state).toBe("KILL_SWITCH_PANEL");
    expect(await t.gestor().setKillSwitch(false, NOW)).toBe(true);
    // the organization
    expect(await setOrg("org-a", { enabled: false })).toBe("saved");
    expect(await only()).toBe("org_disabled|IA não habilitada para a sua organização.|true");
    expect(await setOrg("org-a", { enabled: true, ackVersion: "1" })).toBe("saved");
    expect(calls).toHaveLength(0);
    expect(await counts()).toEqual(before);
    // rules work under EVERY closed gate, even the environment kill switch
    expect(ok(await plan(d, "RULES", svc({ ...BASE_ENV, AI_PLANNER_DISABLED: "true" }))).producer).toBe("RULES");
  });

  it("an archived or zero plan is 'IA não incluída no plano'; an exhausted allowance is 'Limite do plano atingido'; a small per-request cap refuses a large request", async () => {
    const d = await t.newDraft("st-1");
    const { provider, calls } = t.spy();
    const svc = () => t.service("tech-a", "org-a", { providers: { mock: provider } });
    const original = (await orgRow("org-a"))!.quota_plan_id!;
    const g = t.gestor();
    const answers = { ...ANSWERS, availableMinutes: 150 };
    const assign = async (plan: Parameters<typeof g.savePlan>[1]) => {
      const created = await g.savePlan(null, { ...plan, name: `${plan.name} ${t.id("n")}` }, null, NOW);
      if (!created.ok) throw new Error(created.reason);
      expect(await setOrg("org-a", { quotaPlanId: created.id })).toBe("saved");
      return created.id;
    };
    const before = await counts();
    const small = { name: "Pequeno", allowance: { mode: "TOTAL" as const, total: 1000 }, perRequestCapPlanning: 200_000, perRequestCapAdjustment: 1, requestsPerMinute: 120, costCap: null };
    await assign({ ...small, allowance: { mode: "TOTAL", total: 0 } });
    expect(await plan(d, "AI", svc(), { answers })).toMatchObject({ ok: false, reason: "no_plan", message: "IA não incluída no plano.", canContinueByRules: true });
    await assign({ ...small, perRequestCapPlanning: 0 });
    expect(await plan(d, "AI", svc(), { answers })).toMatchObject({ ok: false, reason: "no_plan" });
    await assign(small);
    expect(await plan(d, "AI", svc(), { answers })).toMatchObject({ ok: false, reason: "limit_reached", message: "Limite do plano atingido neste mês.", canContinueByRules: true });
    await assign({ ...small, allowance: { mode: "SPLIT", input: 1_000_000, output: 10 } });
    expect(await plan(d, "AI", svc(), { answers })).toMatchObject({ ok: false, reason: "limit_reached" });
    await assign({ ...small, allowance: { mode: "TOTAL", total: 5_000_000 }, perRequestCapPlanning: 500 });
    expect(await plan(d, "AI", svc(), { answers })).toMatchObject({ ok: false, reason: "request_too_large", canContinueByRules: true });
    // the professional's usage line follows the plan: tokens only
    const usage = (await svc().availability(d.planId, d.revisionId))!.usage;
    expect(usage.allowance).toEqual({ mode: "TOTAL", total: 5_000_000 });
    expect(Object.keys(usage).sort()).toEqual(["allowance", "month", "remaining", "used"]);
    expect(calls).toHaveLength(0);
    expect(await counts()).toEqual(before);
    // restore the generous plan
    expect(await setOrg("org-a", { quotaPlanId: original })).toBe("saved");
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE state = 'RESERVED'")).toBe(0);
  });

  it("a minor student is never sent to a provider: the gate answers minor_blocked before anything is built or reserved; rules works", async () => {
    const d = await t.newDraft("st-2");
    const { provider, calls } = t.spy();
    const before = await counts();
    expect(await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: provider } }))).toMatchObject({ ok: false, reason: "minor_blocked", message: "Para alunos menores de idade, ou sem data de nascimento cadastrada, a montagem é por regras.", canContinueByRules: true });
    expect(calls).toHaveLength(0);
    expect(await counts()).toEqual(before);
    expect(ok(await plan(d, "RULES")).producer).toBe("RULES");
  });

  it("a per-minute limit that the gate cannot see is enforced by the reserve: a FAILED run with the way out, no provider call, no ledger row", async () => {
    const g = t.gestor();
    const original = (await orgRow("org-a"))!.quota_plan_id!;
    const created = await g.savePlan(null, { name: `Um por minuto ${t.id("n")}`, allowance: { mode: "TOTAL", total: 5_000_000 }, perRequestCapPlanning: 200_000, perRequestCapAdjustment: 1, requestsPerMinute: 1, costCap: null }, null, NOW);
    if (!created.ok) throw new Error("plan");
    expect(await setOrg("org-a", { quotaPlanId: created.id })).toBe("saved");
    const { provider, calls } = t.spy();
    // an hour later in the same month: the earlier tests' ledger rows are outside the one-minute window
    let later = NOW.getTime() + 3_600_000;
    const svc = t.service("tech-a", "org-a", { providers: { mock: provider }, now: () => new Date((later += 1000)) });
    const d = await t.newDraft("st-1");
    ok(await plan(d, "AI", svc, { answers: { ...ANSWERS, availableMinutes: 165 } }));
    const ledgerBefore = await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger");
    const refused = await plan(d, "AI", svc, { answers: { ...ANSWERS, availableMinutes: 180 } });
    expect(refused).toMatchObject({ ok: false, reason: "limit_reached", message: "Muitos pedidos de IA em pouco tempo. Tente de novo em instantes.", canContinueByRules: true });
    expect(calls).toHaveLength(1);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger")).toBe(ledgerBefore);
    if (!refused.ok) expect(await t.first("SELECT status, failure_code FROM planning_runs WHERE id = ?1", refused.runId)).toEqual({ status: "FAILED", failure_code: "limit_reached:RATE" });
    expect(await svc.state(d.planId, d.revisionId)).toMatchObject({ state: "FAILED", reason: "limit_reached", canContinueByRules: true });
    expect(await setOrg("org-a", { quotaPlanId: original })).toBe("saved");
    // the stored failure replays with its own message
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_month WHERE reserved_input <> 0 OR reserved_output <> 0")).toBe(0);
  });
});

describe("provider failures never lose data or advance anything: a clear state and the way out by rules", () => {
  const failure = (code: string, over: Record<string, unknown> = {}): ProviderResult => ({
    ok: false, code: code as never, httpStatus: null, retryable: false, retryAfterMs: null, usage: null, latencyMs: 5, ...over,
  });
  const reservedClean = async () => {
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE state = 'RESERVED'")).toBe(0);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_month WHERE reserved_input <> 0 OR reserved_output <> 0 OR reserved_cost_micros <> 0")).toBe(0);
  };
  const answers = uniqueAnswers;
  const GOOD_USAGE = { inputTokens: 1234, outputTokens: 56, cachedInputTokens: null, source: "PROVIDER" as const };

  const cases: Array<{ code: string; reason: string; ledger: string; calls: number; over?: Record<string, unknown>; message: string }> = [
    { code: "SERVER_ERROR", reason: "provider_failed", ledger: "RELEASED", calls: 2, over: { retryable: true, httpStatus: 500 }, message: "O serviço de IA está instável. Tente de novo ou continue por regras." },
    { code: "NETWORK", reason: "provider_failed", ledger: "CHARGED_UNKNOWN", calls: 2, over: { retryable: true }, message: "Não foi possível falar com o serviço de IA. Tente de novo ou continue por regras." },
    { code: "TIMEOUT", reason: "timeout", ledger: "CHARGED_UNKNOWN", calls: 1, message: "A IA demorou demais para responder. Tente de novo ou continue por regras." },
    { code: "RATE_LIMIT", reason: "provider_failed", ledger: "RELEASED", calls: 2, over: { retryable: true, httpStatus: 429 }, message: "O serviço de IA está ocupado. Tente de novo em instantes ou continue por regras." },
    { code: "AUTH", reason: "provider_failed", ledger: "RELEASED", calls: 1, over: { httpStatus: 401 }, message: "A IA não está disponível agora. Você pode continuar por regras." },
    { code: "PROVIDER_QUOTA", reason: "provider_failed", ledger: "RELEASED", calls: 1, over: { httpStatus: 402 }, message: "A IA não está disponível agora. Você pode continuar por regras." },
    { code: "MODEL_NOT_FOUND", reason: "provider_failed", ledger: "RELEASED", calls: 1, over: { httpStatus: 404 }, message: "A IA não está disponível agora. Você pode continuar por regras." },
    { code: "INVALID_JSON", reason: "invalid_response", ledger: "SETTLED", calls: 1, over: { usage: GOOD_USAGE, httpStatus: 200 }, message: "A IA devolveu uma resposta inválida. Nada foi aplicado. Tente de novo ou continue por regras." },
    { code: "TRUNCATED", reason: "invalid_response", ledger: "SETTLED", calls: 1, over: { usage: GOOD_USAGE, httpStatus: 200 }, message: "A IA devolveu uma resposta incompleta. Nada foi aplicado. Tente de novo ou continue por regras." },
    { code: "REFUSED", reason: "invalid_response", ledger: "RELEASED", calls: 1, over: { httpStatus: 200 }, message: "A IA não respondeu a este pedido. Você pode continuar por regras." },
  ];

  for (const c of cases) {
    it(`${c.code}: ${c.reason}, the reservation ends ${c.ledger}, nothing is cached or applied, the failure replays, and rules continues`, async () => {
      const d = await t.newDraft("st-1");
      const before = await prescriptionState(d);
      const cacheBefore = await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache");
      const { provider, calls } = t.spy(() => failure(c.code, c.over));
      const svc = t.service("tech-a", "org-a", { providers: { mock: provider } });
      const payload = await body(d, "AI", { answers: answers() });
      const out = await svc.plan(d.planId, d.revisionId, payload as never);
      expect(out).toMatchObject({ ok: false, reason: c.reason, message: c.message, canContinueByRules: true });
      expect(calls).toHaveLength(c.calls);
      const run = (await t.first<Record<string, unknown>>("SELECT * FROM planning_runs WHERE id = ?1", out.ok ? "" : out.runId))!;
      expect(run).toMatchObject({ status: "FAILED", failure_code: `${c.reason}:${c.code}`, cache_hit: 0, response_hash: null, blueprint_hash: null });
      const ledger = (await t.first<Record<string, unknown>>("SELECT * FROM ai_usage_ledger WHERE id = ?1", run.ledger_id))!;
      expect(ledger.state).toBe(c.ledger);
      if (c.ledger === "CHARGED_UNKNOWN") expect(ledger).toMatchObject({ error_code: c.code, output_tokens: 0 });
      if (c.ledger === "CHARGED_UNKNOWN") expect(ledger.input_tokens as number).toBeGreaterThan(0);
      if (c.ledger === "SETTLED") expect(ledger).toMatchObject({ input_tokens: 1234, output_tokens: 56, usage_source: "PROVIDER" });
      if (c.ledger === "RELEASED") expect(ledger).toMatchObject({ error_code: c.code, input_tokens: null });
      await reservedClean();
      expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache")).toBe(cacheBefore);
      expect(await t.n("SELECT COUNT(*) AS n FROM planning_run_payloads WHERE run_id = ?1", run.id)).toBe(0);
      expect(await prescriptionState(d)).toEqual(before);
      // the explicit state, and the stored failure replays without calling again
      expect(await svc.state(d.planId, d.revisionId)).toEqual({ state: "FAILED", runId: run.id, reason: c.reason, message: c.message, canContinueByRules: true });
      expect(await svc.plan(d.planId, d.revisionId, payload as never)).toMatchObject({ ok: false, reason: c.reason, message: c.message, runId: run.id });
      expect(calls).toHaveLength(c.calls);
      // continue by rules: a new key, the same draft, works at once; the failed run is history
      const rules = ok(await plan(d, "RULES", svc));
      expect(rules.producer).toBe("RULES");
      expect(await svc.state(d.planId, d.revisionId)).toMatchObject({ state: "READY" });
      expect(await svc.latest(d.planId, d.revisionId)).toEqual(rules.blueprint);
    });
  }

  it("an answer that does not pass validation: tokens are settled (they were spent), nothing is cached, the run says why in codes", async () => {
    const d = await t.newDraft("st-1");
    const { provider, calls } = t.spy(() => ({ ok: true, json: { schemaVersion: 1, strategies: "not a list", nome: STUDENT.name }, usage: { inputTokens: 900, outputTokens: 40, cachedInputTokens: null, source: "PROVIDER" }, latencyMs: 9, providerRequestId: null, finish: "STOP" } satisfies ProviderResult & { ok: true }));
    const cacheBefore = await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache");
    const out = await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: provider } }), { answers: answers() });
    expect(out).toMatchObject({ ok: false, reason: "invalid_response", canContinueByRules: true, message: "A IA devolveu uma resposta que não passou na validação. Nada foi aplicado. Tente de novo ou continue por regras." });
    expect(calls).toHaveLength(1);
    const run = (await t.first<Record<string, unknown>>("SELECT * FROM planning_runs WHERE id = ?1", out.ok ? "" : out.runId))!;
    expect(run.failure_code).toBe("invalid_response:VALIDATION");
    expect(await t.first("SELECT state, input_tokens, output_tokens FROM ai_usage_ledger WHERE id = ?1", run.ledger_id)).toEqual({ state: "SETTLED", input_tokens: 900, output_tokens: 40 });
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache")).toBe(cacheBefore);
    // the model's text (which carried a name) is stored nowhere
    expect(JSON.stringify(await t.all("SELECT * FROM planning_runs")) + JSON.stringify(await t.all("SELECT * FROM ai_usage_ledger"))).not.toContain(STUDENT.name);
    await reservedClean();
  });

  it("a hostile answer (alias outside the shortlist, a dose and a link in prose) is refused whole; a provider that throws is a failure of unknown cost", async () => {
    const d = await t.newDraft("st-1");
    const hostile = t.spy((req, settings) => mockProvider.call(req, { ...settings, modelId: "mock-hostile" }));
    const out = await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: hostile.provider } }), { answers: answers() });
    expect(out).toMatchObject({ ok: false, reason: "invalid_response" });
    const run = (await t.first<Record<string, unknown>>("SELECT failure_code, ledger_id FROM planning_runs WHERE id = ?1", out.ok ? "" : out.runId))!;
    expect(run.failure_code).toBe("invalid_response:VALIDATION");
    const throwing = t.spy(() => {
      throw new Error("socket hang up with secret in it");
    });
    const boom = await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: throwing.provider } }), { answers: answers() });
    expect(boom).toMatchObject({ ok: false, reason: "provider_failed", canContinueByRules: true, message: "Não foi possível falar com o serviço de IA. Tente de novo ou continue por regras." });
    expect(JSON.stringify(boom)).not.toContain("socket");
    expect(await t.first("SELECT state FROM ai_usage_ledger WHERE id = (SELECT ledger_id FROM planning_runs WHERE id = ?1)", boom.ok ? "" : boom.runId)).toEqual({ state: "CHARGED_UNKNOWN" });
    await reservedClean();
  });

  it("a provider that never answers is cut at the window the stale threshold counts on, and the unknown cost is charged", async () => {
    const g = t.gestor();
    const planner = (await g.getTasks()).find((x) => x.task === "PLANNER")!;
    expect(await g.saveTask("PLANNER", taskOf("mock", "mock-ok", { timeoutMs: 2000, maxRetries: 0 }), planner.version, NOW)).toBe("saved");
    const d = await t.newDraft("st-1");
    const hang = t.spy(() => new Promise<ProviderResult>(() => undefined));
    const started = Date.now();
    const out = await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: hang.provider } }), { answers: answers() });
    const took = Date.now() - started;
    expect(out).toMatchObject({ ok: false, reason: "timeout", canContinueByRules: true });
    // (maxRetries + 1) * timeout + pauses + 1 s of tolerance = 3 s, not the 25 s of the default
    expect(took).toBeGreaterThanOrEqual(2900);
    expect(took).toBeLessThan(8000);
    expect(await t.first("SELECT state FROM ai_usage_ledger WHERE id = (SELECT ledger_id FROM planning_runs WHERE id = ?1)", out.ok ? "" : out.runId)).toEqual({ state: "CHARGED_UNKNOWN" });
    const again = (await g.getTasks()).find((x) => x.task === "PLANNER")!;
    expect(await g.saveTask("PLANNER", taskOf("mock", "mock-ok"), again.version, NOW)).toBe("saved");
    await reservedClean();
  });

  it("five availability failures open the circuit: the next request is refused without a call (with the way out); after the open period one probe closes it", async () => {
    let clock = NOW;
    const call = (svc: ReturnType<typeof t.service>, d: { planId: string; revisionId: string }) => plan(d, "AI", svc, { answers: answers() });
    const dead = t.spy(() => failure("SERVER_ERROR", { retryable: true, httpStatus: 503 }));
    const svc = t.service("tech-a", "org-a", { providers: { mock: dead.provider }, now: () => clock });
    const d = await t.newDraft("st-1");
    const good = t.spy();
    ok(await call(t.service("tech-a", "org-a", { providers: { mock: good.provider }, now: () => clock }), d)); // a success resets the count
    for (let i = 0; i < 5; i += 1) expect(await call(svc, d)).toMatchObject({ ok: false, reason: "provider_failed" });
    const callsBefore = dead.calls.length;
    const blocked = await call(svc, d);
    expect(blocked).toMatchObject({ ok: false, reason: "circuit_open", message: "O serviço de IA está instável. Tente mais tarde ou continue por regras.", canContinueByRules: true });
    expect(dead.calls).toHaveLength(callsBefore);
    expect(await t.first("SELECT state, consecutive_failures FROM ai_circuit_state WHERE provider_kind = 'mock' AND model_id = 'mock-ok'")).toEqual({ state: "OPEN", consecutive_failures: 5 });
    // the circuit refuses before a run exists: no run was created for the blocked request
    expect(blocked.ok).toBe(false);
    clock = new Date(NOW.getTime() + 61_000);
    ok(await call(t.service("tech-a", "org-a", { providers: { mock: good.provider }, now: () => clock }), d));
    expect(await t.first("SELECT state, consecutive_failures FROM ai_circuit_state WHERE provider_kind = 'mock' AND model_id = 'mock-ok'")).toEqual({ state: "CLOSED", consecutive_failures: 0 });
    await reservedClean();
  });
});

describe("idempotent re-execution, single flight, stale takeover", () => {
  const answers = uniqueAnswers;
  const wait = async (until: () => boolean, ms = 8000) => {
    const stop = Date.now() + ms;
    while (!until() && Date.now() < stop) await new Promise((r) => setTimeout(r, 15));
    expect(until()).toBe(true);
  };
  /** A provider that holds every call until released, then answers like the mock. */
  function blocking() {
    let release!: () => void;
    const open = new Promise<void>((r) => (release = r));
    const s = t.spy(async (req, settings) => {
      await open;
      return mockProvider.call(req, settings);
    });
    return { ...s, release };
  }
  const hashOf = (d: { planId: string; revisionId: string }, payload: { baseContentVersion: number; mode: string; answers: unknown }) =>
    sha256Hex(canonicalJson({ kind: "PLAN", planId: d.planId, revisionId: d.revisionId, baseContentVersion: payload.baseContentVersion, mode: payload.mode, answers: parseGenerationAnswers(payload.answers) }));

  it("a request that arrives while the same key is running is 'in_progress' (never a second call); the same context under another key is single flight; a third context beyond two running is 'busy'; rules is never blocked", async () => {
    const b = blocking();
    const svc = t.service("tech-a", "org-a", { providers: { mock: b.provider } });
    const d = await t.newDraft("st-1");
    const one = await body(d, "AI", { answers: answers() });
    const two = await body(d, "AI", { answers: answers() });
    const p1 = svc.plan(d.planId, d.revisionId, one as never);
    await wait(() => b.calls.length === 1);
    const running = (await t.first<{ id: string }>("SELECT id FROM planning_runs WHERE idempotency_key = ?1", one.idempotencyKey))!;
    expect(await t.n("SELECT COUNT(*) AS n FROM planning_runs WHERE status = 'RUNNING'")).toBe(1);
    // the same key again: in progress, with the run id (never a second call)
    expect(await svc.plan(d.planId, d.revisionId, one as never)).toMatchObject({ ok: false, reason: "in_progress", runId: running.id, canContinueByRules: false });
    // the same context under another key: single flight on the cache key
    expect(await svc.plan(d.planId, d.revisionId, { ...one, idempotencyKey: key() } as never)).toMatchObject({ ok: false, reason: "in_progress", runId: running.id });
    expect(b.calls).toHaveLength(1);
    // a second context runs; a third is refused: two AI runs are already running
    const p2 = svc.plan(d.planId, d.revisionId, two as never);
    await wait(() => b.calls.length === 2);
    expect(await t.n("SELECT COUNT(*) AS n FROM planning_runs WHERE status = 'RUNNING'")).toBe(2);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE state = 'RESERVED'")).toBe(2);
    expect(await svc.plan(d.planId, d.revisionId, (await body(d, "AI", { answers: answers() })) as never)).toMatchObject({ ok: false, reason: "in_progress", message: "Já há planejamentos em andamento. Aguarde alguns instantes." });
    // the explicit state while it runs
    expect(await svc.state(d.planId, d.revisionId)).toMatchObject({ state: "GENERATING", mode: "AI" });
    // rules is never blocked by busy AI runs
    expect(ok(await plan(d, "RULES", svc)).producer).toBe("RULES");
    expect(b.calls).toHaveLength(2);
    b.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(ok(r1).cache).toBe("MISS");
    expect(ok(r2).cache).toBe("MISS");
    expect(await t.n("SELECT COUNT(*) AS n FROM planning_runs WHERE status = 'RUNNING'")).toBe(0);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE state = 'RESERVED'")).toBe(0);
    // finished: the same key now replays
    expect(await svc.plan(d.planId, d.revisionId, one as never)).toMatchObject({ ok: true, replayed: true, runId: running.id });
    expect(b.calls).toHaveLength(2);
  });

  it("two parallel requests with the same key make exactly one provider call and one ledger row", async () => {
    const b = blocking();
    const svc = t.service("tech-a", "org-a", { providers: { mock: b.provider } });
    const d = await t.newDraft("st-1");
    const payload = await body(d, "AI", { answers: answers() });
    const ledgerBefore = await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger");
    const both = Promise.all([svc.plan(d.planId, d.revisionId, payload as never), svc.plan(d.planId, d.revisionId, payload as never)]);
    await wait(() => b.calls.length >= 1);
    b.release();
    const [x, y] = await both;
    expect([x, y].filter((o) => o.ok && !o.replayed)).toHaveLength(1);
    expect([x, y].filter((o) => !o.ok).every((o) => !o.ok && o.reason === "in_progress")).toBe(true);
    expect(b.calls).toHaveLength(1);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger")).toBe(ledgerBefore + 1);
    expect(await t.n("SELECT COUNT(*) AS n FROM planning_runs WHERE idempotency_key = ?1", payload.idempotencyKey)).toBe(1);
  });

  it("takes over a stale run of the same key: the old reservation is charged as unknown by id, attempt 2 completes, nothing is double counted", async () => {
    const d = await t.newDraft("st-1");
    const payload = await body(d, "AI", { answers: answers() });
    const repo = aiPlanningFor(t.db, t.org("tech-a"));
    const runId = t.id("run");
    const then = new Date(NOW.getTime() - 10 * 60_000);
    const started = await repo.runStart({
      runId, planId: d.planId, revisionId: d.revisionId, idempotencyKey: payload.idempotencyKey, requestHash: await hashOf(d, payload), mode: "AI",
      baseContentVersion: payload.baseContentVersion, structureFingerprint: "f".repeat(32), contextHash: "c".repeat(64), aliasesHash: "d".repeat(64), cacheKey: "e".repeat(64),
      providerKind: "mock", modelId: "mock-ok", promptVersion: "planner-2026.11.1", schemaVersion: 1, templatesVersion: null, omittedJson: "[]", now: then,
    });
    expect(started).toEqual({ ok: true });
    const oldLedger = t.id("led");
    expect(await repo.reserve({
      planId: d.planId, revisionId: d.revisionId, task: "PLANNER", ledgerId: oldLedger, requestKey: `${runId}:1`, runId, providerKind: "mock", modelId: "mock-ok",
      reservation: reservationFor({ estimatedInput: 500, effectiveMaxOutput: 1000, maxRetries: 1, prices: null }), prices: null, now: then, staleMs: 65_400,
    })).toEqual({ ok: true, ledgerId: oldLedger });
    const usedBefore = (await t.first<{ used_input: number }>("SELECT used_input FROM ai_usage_month WHERE organization_id = 'org-a'"))!.used_input;
    const { provider, calls } = t.spy();
    const svc = t.service("tech-a", "org-a", { providers: { mock: provider } });
    const out = ok(await svc.plan(d.planId, d.revisionId, payload as never));
    expect(out).toMatchObject({ runId, producer: "AI", replayed: false, cache: "MISS" });
    expect(calls).toHaveLength(1);
    expect(await t.first("SELECT attempt, status FROM planning_runs WHERE id = ?1", runId)).toEqual({ attempt: 2, status: "SUCCEEDED" });
    expect(await t.first("SELECT state, error_code, output_tokens FROM ai_usage_ledger WHERE id = ?1", oldLedger)).toEqual({ state: "CHARGED_UNKNOWN", error_code: "STALE", output_tokens: 0 });
    const fresh = await t.first<{ state: string; request_key: string }>("SELECT state, request_key FROM ai_usage_ledger WHERE id = (SELECT ledger_id FROM planning_runs WHERE id = ?1)", runId);
    expect(fresh).toEqual({ state: "SETTLED", request_key: `${runId}:2` });
    // the unknown charge is in the month counters and the new settle on top; nothing stays reserved
    const month = (await t.first<{ used_input: number; reserved_input: number }>("SELECT used_input, reserved_input FROM ai_usage_month WHERE organization_id = 'org-a'"))!;
    expect(month.reserved_input).toBe(0);
    // (the old reservation held 2 x 500 input tokens: both attempts; the unknown charge is capped by what was reserved)
    expect(month.used_input).toBe(usedBefore + 1000 + out.usage!.inputTokens);
    // and it replays as the finished run
    expect(await svc.plan(d.planId, d.revisionId, payload as never)).toMatchObject({ ok: true, replayed: true, runId });
  });

  it("a stale RULES run is closed as STALE and answered 'stale' with the way out; a fresh one is in progress", async () => {
    const d = await t.newDraft("st-1");
    const payload = await body(d, "RULES");
    const repo = aiPlanningFor(t.db, t.org("tech-a"));
    const runId = t.id("run");
    await repo.runStart({
      runId, planId: d.planId, revisionId: d.revisionId, idempotencyKey: payload.idempotencyKey, requestHash: await hashOf(d, payload), mode: "RULES",
      baseContentVersion: payload.baseContentVersion, structureFingerprint: "f".repeat(32), contextHash: null, aliasesHash: null, cacheKey: null, providerKind: null,
      modelId: null, promptVersion: null, schemaVersion: 1, templatesVersion: "interim-1", omittedJson: "[]", now: NOW,
    });
    expect(await t.service().plan(d.planId, d.revisionId, payload as never)).toMatchObject({ ok: false, reason: "in_progress", runId });
    const later = t.service("tech-a", "org-a", { now: () => new Date(NOW.getTime() + 10 * 60_000) });
    expect(await later.plan(d.planId, d.revisionId, payload as never)).toMatchObject({ ok: false, reason: "stale", canContinueByRules: true, message: "A tentativa anterior não terminou. Tente de novo ou continue por regras." });
    expect(await t.first("SELECT status, failure_code FROM planning_runs WHERE id = ?1", runId)).toEqual({ status: "FAILED", failure_code: "STALE" });
    expect(ok(await plan(d, "RULES", later)).producer).toBe("RULES");
  });

  it("AI runs left RUNNING by a dead Worker do not count against the per-organization ceiling once they are stale; a busy answer still offers rules", async () => {
    const d = await t.newDraft("st-1");
    const repo = aiPlanningFor(t.db, t.org("tech-a"));
    const old = new Date(NOW.getTime() - 6 * 3_600_000);
    for (const k of ["zombie-1", "zombie-2"]) {
      const started = await repo.runStart({
        runId: t.id("run"), planId: d.planId, revisionId: d.revisionId, idempotencyKey: `${k}-idempotency-key`, requestHash: "h".repeat(64), mode: "AI",
        baseContentVersion: 1, structureFingerprint: "f".repeat(32), contextHash: "c".repeat(64), aliasesHash: "a".repeat(64), cacheKey: `${k}-cache`, providerKind: "mock",
        modelId: "mock-ul", promptVersion: "p", schemaVersion: 1, templatesVersion: null, omittedJson: "[]", now: old,
      });
      expect(started).toEqual({ ok: true });
    }
    expect(await t.n("SELECT COUNT(*) AS n FROM planning_runs WHERE status = 'RUNNING' AND mode = 'AI'")).toBe(2);
    const { provider, calls } = t.spy();
    const svc = t.service("tech-a", "org-a", { providers: { mock: provider } });
    const outcome = await plan(d, "AI", svc, { answers: uniqueAnswers() });
    expect(ok(outcome)).toMatchObject({ producer: "AI", cache: "MISS" });
    expect(calls).toHaveLength(1);
    await t.run("UPDATE planning_runs SET status = 'FAILED', failure_code = 'STALE', finished_at = ?1 WHERE idempotency_key LIKE 'zombie-%' AND status = 'RUNNING'", NOW.toISOString());
  });

  it("a student without a birth date is treated like a minor: no provider call, rules works", async () => {
    await t.run("UPDATE student_profiles SET birth_date = NULL WHERE student_id = 'st-2'");
    try {
      const d = await t.newDraft("st-2");
      const { provider, calls } = t.spy();
      expect(await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: provider } }))).toMatchObject({ ok: false, reason: "minor_blocked", canContinueByRules: true });
      expect(calls).toHaveLength(0);
      expect(ok(await plan(d, "RULES")).producer).toBe("RULES");
    } finally {
      await t.run("UPDATE student_profiles SET birth_date = '2014-05-05' WHERE student_id = 'st-2'");
    }
  });
});

describe("tenant isolation: the organization and the person come from the session, never from the request", () => {
  let d: { planId: string; revisionId: string };
  let dB: { planId: string; revisionId: string };
  const answers = uniqueAnswers;
  beforeAll(async () => {
    await t.configure({ provider: "mock", model: "mock-ok", orgs: ["org-b"] });
    d = await t.newDraft("st-1");
    dB = await t.newDraft("st-b", "tech-b", "org-b");
  });

  it("another organization, a revoked assignment, a student of another professional and a non-technical role all get 'not found' and leave no trace", async () => {
    const { provider, calls } = t.spy();
    const before = await counts();
    const mine = ok(await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: provider } }), { answers: answers() }));
    const afterMine = await counts();
    expect(afterMine.runs).toBe(before.runs + 1);
    const outsiders: Array<[string, string]> = [["tech-b", "org-b"], ["tech-off", "org-a"], ["tech-a2", "org-a"], ["commercial-a", "org-a"], ["owner-a", "org-a"]];
    for (const [who, organization] of outsiders) {
      const svc = t.service(who, organization, { providers: { mock: provider } });
      const ctx = `${who}@${organization}`;
      expect(reason(await plan(d, "AI", svc)), ctx).toBe("not_found");
      expect(reason(await plan(d, "RULES", svc)), ctx).toBe("not_found");
      expect(await svc.availability(d.planId, d.revisionId), ctx).toBeNull();
      expect(await svc.state(d.planId, d.revisionId), ctx).toEqual({ state: "NONE" });
      expect(await svc.latest(d.planId, d.revisionId), ctx).toBeNull();
      // replaying the owner's idempotency key from outside finds nothing (not the stored outcome, not 'key reused')
      const stolen = await t.first<{ idempotency_key: string; base_content_version: number }>("SELECT idempotency_key, base_content_version FROM planning_runs WHERE id = ?1", mine.runId);
      expect(reason(await svc.plan(d.planId, d.revisionId, { idempotencyKey: stolen!.idempotency_key, baseContentVersion: stolen!.base_content_version, mode: "AI", answers: ANSWERS } as never)), ctx).toBe("not_found");
    }
    expect(calls).toHaveLength(1);
    expect(await counts()).toEqual(afterMine);
    // the other direction: tech-a cannot plan org-b's student, and a forged organization in the body is not a field at all
    expect(reason(await plan(dB, "AI", t.service("tech-a", "org-a", { providers: { mock: provider } })))).toBe("not_found");
    expect(reason(await t.service("tech-a").plan(d.planId, d.revisionId, { ...(await body(d, "AI")), organizationId: "org-b" } as never))).toBe("invalid");
  });

  it("the cache and the usage are per organization: identical data in another organization is a MISS, with its own counters and rows", async () => {
    const { provider, calls } = t.spy();
    const same = answers();
    const a = ok(await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: provider } }), { answers: same }));
    const b = ok(await plan(dB, "AI", t.service("tech-b", "org-b", { providers: { mock: provider } }), { answers: same }));
    expect(a.cache).toBe("MISS");
    expect(b.cache).toBe("MISS");
    expect(calls).toHaveLength(2);
    const rows = await t.all<{ organization_id: string; cache_key: string }>("SELECT organization_id, cache_key FROM ai_planner_cache WHERE cache_key IN (SELECT cache_key FROM planning_runs WHERE id IN (?1, ?2))", a.runId, b.runId);
    expect(rows.map((r) => r.organization_id).sort()).toEqual(["org-a", "org-b"]);
    expect(new Set(rows.map((r) => r.cache_key)).size).toBe(1);
    const ledgerOf = (runId: string) => t.first<{ organization_id: string; requested_by_user_id: string }>("SELECT organization_id, requested_by_user_id FROM ai_usage_ledger WHERE request_key = ?1", `${runId}:1`);
    expect(await ledgerOf(a.runId)).toEqual({ organization_id: "org-a", requested_by_user_id: "tech-a" });
    expect(await ledgerOf(b.runId)).toEqual({ organization_id: "org-b", requested_by_user_id: "tech-b" });
    const months = await t.all<{ organization_id: string; used_input: number }>("SELECT organization_id, used_input FROM ai_usage_month ORDER BY organization_id");
    expect(months.map((m) => m.organization_id)).toEqual(["org-a", "org-b"]);
    // the second time each organization hits ITS cache only
    expect(ok(await plan(dB, "AI", t.service("tech-b", "org-b", { providers: { mock: provider } }), { answers: same })).cache).toBe("HIT");
    expect(calls).toHaveLength(2);
  });

  it("an organization that was never enabled cannot use another's allowance", async () => {
    // org-b is enabled above; a third, never configured organization would be 'org_disabled': simulate by disabling org-b only
    const g = t.gestor();
    const row = (await g.listOrganizations("2026-11")).find((o) => o.organizationId === "org-b")!;
    expect(await g.setOrganization("org-b", { enabled: false }, row.version, "1", NOW)).toBe("saved");
    const { provider, calls } = t.spy();
    expect(await plan(dB, "AI", t.service("tech-b", "org-b", { providers: { mock: provider } }), { answers: answers() })).toMatchObject({ ok: false, reason: "org_disabled" });
    // org-a is unaffected
    expect(ok(await plan(d, "AI", t.service("tech-a", "org-a", { providers: { mock: provider } }), { answers: answers() })).producer).toBe("AI");
    expect(calls).toHaveLength(1);
    const again = (await g.listOrganizations("2026-11")).find((o) => o.organizationId === "org-b")!;
    expect(await g.setOrganization("org-b", { enabled: true, ackVersion: "1" }, again.version, "1", NOW)).toBe("saved");
  });
});

describe("a REAL adapter (OpenAI) against a mocked fetch: key, anonymised body, usage, cost, errors", () => {
  const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
  type Call = { url: string; headers: Record<string, string>; body: string };
  function fakeOpenAi(handler?: (call: Call) => Response | undefined) {
    const calls: Call[] = [];
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const call: Call = { url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body ?? "") };
      calls.push(call);
      const special = handler?.(call);
      if (special) return special;
      const request = JSON.parse(call.body) as { messages: Array<{ content: string }> };
      const context = (JSON.parse(request.messages[1].content) as { context: Parameters<typeof mockPlan>[0] }).context;
      const answer = { choices: [{ message: { content: JSON.stringify(mockPlan(context, "mock-ok")) }, finish_reason: "stop" }], usage: { prompt_tokens: 4321, completion_tokens: 765, prompt_tokens_details: { cached_tokens: 100 } } };
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_1" } });
    });
    return { calls, fetchImpl: impl as unknown as typeof fetch };
  }
  const svc = (fetchImpl: typeof fetch, env = BASE_ENV) => t.service("tech-a", "org-a", { fetchImpl, env });
  const setTask = async (over: Parameters<typeof taskOf>[2]) => {
    const planner = (await t.gestor().getTasks()).find((x) => x.task === "PLANNER")!;
    expect(await t.gestor().saveTask("PLANNER", taskOf("openai", "any-model-1", over), planner.version, NOW)).toBe("saved");
  };
  const httpError = (status: number, text = "{}") => new Response(text, { status, headers: { "content-type": "application/json" } });
  beforeAll(async () => {
    await t.configure({ provider: "openai", model: "any-model-1", orgs: ["org-a"] });
  });

  it("calls the provider ONLY after every gate: the stored key is decrypted on the server, sent in the Authorization header, and nothing that identifies the student is in the body", async () => {
    const f = fakeOpenAi();
    const d = await t.newDraft("st-1");
    const before = await prescriptionState(d);
    const out = ok(await plan(d, "AI", svc(f.fetchImpl), { answers: uniqueAnswers() }));
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(OPENAI_URL);
    expect(f.calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(f.calls[0].body) as Record<string, unknown>;
    expect(sent).toMatchObject({ model: "any-model-1" });
    expect(Object.keys(sent).sort()).toEqual(["max_completion_tokens", "messages", "model", "response_format"]);
    for (const secret of [KEY, STUDENT.name, STUDENT.email, STUDENT.phone, STUDENT.birthDate, STUDENT.injury, "Zélia", "Plano de teste", "st-1", d.planId, d.revisionId, "org-a", "Studio A", "tech-a"])
      expect(f.calls[0].body, secret).not.toContain(secret);
    expect(out).toMatchObject({ producer: "AI", cache: "MISS", usage: { inputTokens: 4321, outputTokens: 765 } });
    const run = (await t.first<Record<string, unknown>>("SELECT * FROM planning_runs WHERE id = ?1", out.runId))!;
    expect(run).toMatchObject({ provider_kind: "openai", model_id: "any-model-1", status: "SUCCEEDED" });
    expect(await t.first("SELECT state, usage_source, input_tokens, output_tokens, cached_input_tokens, cost_micros, provider_kind FROM ai_usage_ledger WHERE id = ?1", run.ledger_id)).toEqual({
      state: "SETTLED", usage_source: "PROVIDER", input_tokens: 4321, output_tokens: 765, cached_input_tokens: 100, cost_micros: null, provider_kind: "openai",
    });
    // the key lives only encrypted: no table holds it in the clear
    for (const table of ["ai_provider_connections", "planning_runs", "ai_usage_ledger", "ai_usage_month", "ai_planner_cache", "planning_run_payloads", "access_audit_events"])
      expect(JSON.stringify(await t.all(`SELECT * FROM ${table}`)), table).not.toContain(KEY);
    expect(await prescriptionState(d)).toEqual(before);
  });

  it("with typed prices the ledger carries the cost from the provider's usage; the professional's outcome has no cost, provider or model", async () => {
    await setTask({ prices: { currency: "USD", inputMicrosPerMillion: 150_000, outputMicrosPerMillion: 600_000 } });
    const f = fakeOpenAi();
    const d = await t.newDraft("st-1");
    const out = ok(await plan(d, "AI", svc(f.fetchImpl), { answers: uniqueAnswers() }));
    const ledger = (await t.first<Record<string, unknown>>("SELECT * FROM ai_usage_ledger WHERE request_key = ?1", `${out.runId}:1`))!;
    expect(ledger).toMatchObject({ cost_micros: Math.ceil((4321 * 150_000) / 1e6) + Math.ceil((765 * 600_000) / 1e6), currency: "USD", price_input_micros_per_million: 150_000, price_output_micros_per_million: 600_000 });
    expect(JSON.stringify(out)).not.toMatch(/cost|price|\bUSD\b|openai|any-model|"provider|"modelId|micros/);
    expect(JSON.stringify(await svc(f.fetchImpl).availability(d.planId, d.revisionId))).not.toMatch(/cost|price|\bUSD\b|openai|any-model|micros/);
    await setTask({});
  });

  it("HTTP errors become codes: 401 and exhausted-account 429 are not retried and release the reservation; 500 is retried once", async () => {
    const d = await t.newDraft("st-1");
    const cases: Array<[string, () => Response, number, string]> = [
      ["AUTH", () => httpError(401, '{"error":{"message":"Incorrect API key sk-live-LEAK"}}'), 1, "RELEASED"],
      ["PROVIDER_QUOTA", () => httpError(429, '{"error":{"code":"insufficient_quota"}}'), 1, "RELEASED"],
      ["SERVER_ERROR", () => httpError(500, "boom"), 2, "RELEASED"],
    ];
    for (const [code, response, calls, ledger] of cases) {
      const f = fakeOpenAi(() => response());
      const out = await plan(d, "AI", svc(f.fetchImpl), { answers: uniqueAnswers() });
      expect(out, code).toMatchObject({ ok: false, reason: "provider_failed", canContinueByRules: true });
      expect(f.calls, code).toHaveLength(calls);
      expect(JSON.stringify(out), code).not.toMatch(/LEAK|sk-|Incorrect/);
      const run = (await t.first<Record<string, unknown>>("SELECT failure_code, ledger_id FROM planning_runs WHERE id = ?1", out.ok ? "" : out.runId))!;
      expect(run.failure_code).toBe(`provider_failed:${code}`);
      expect((await t.first<{ state: string }>("SELECT state FROM ai_usage_ledger WHERE id = ?1", run.ledger_id))!.state).toBe(ledger);
    }
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE state = 'RESERVED'")).toBe(0);
  });

  it("an unreadable key (master key changed) or a missing one: nothing is sent, the reservation is released, the state is 'not configured'", async () => {
    const d = await t.newDraft("st-1");
    const f = fakeOpenAi();
    const wrongMaster = { ...BASE_ENV, AI_SECRETS_KEY: toBase64Url(new Uint8Array(32).fill(9)) };
    const out = await plan(d, "AI", svc(f.fetchImpl, wrongMaster), { answers: uniqueAnswers() });
    expect(out).toMatchObject({ ok: false, reason: "not_configured", canContinueByRules: true, message: "IA não configurada." });
    expect(f.calls).toHaveLength(0);
    const run = (await t.first<Record<string, unknown>>("SELECT failure_code, ledger_id FROM planning_runs WHERE id = ?1", out.ok ? "" : out.runId))!;
    expect(run.failure_code).toBe("not_configured");
    expect(await t.first("SELECT state, error_code FROM ai_usage_ledger WHERE id = ?1", run.ledger_id)).toEqual({ state: "RELEASED", error_code: "KEY_UNREADABLE" });
    // no master key at all: the gate closes before anything exists
    const before = await counts();
    expect(await plan(d, "AI", svc(f.fetchImpl, { AI_MOCK_ENABLED: "true" }), { answers: uniqueAnswers() })).toMatchObject({ ok: false, reason: "not_configured" });
    expect(await counts()).toEqual(before);
    // a connection cannot be removed while a task uses it; if the row is gone anyway (restore, manual edit) the gate says so
    expect(await t.gestor().removeConnection("openai")).toBe("mapped");
    await t.run("DELETE FROM ai_provider_connections WHERE kind = 'openai'");
    expect(await plan(d, "AI", svc(f.fetchImpl), { answers: uniqueAnswers() })).toMatchObject({ ok: false, reason: "not_configured" });
    expect(f.calls).toHaveLength(0);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE state = 'RESERVED'")).toBe(0);
  });

  it("the environment kill switch wins over a connected provider: no request leaves, rules still works", async () => {
    await t.configure({ provider: "openai", model: "any-model-1", orgs: ["org-a"] });
    const f = fakeOpenAi();
    const d = await t.newDraft("st-1");
    const killed = { ...BASE_ENV, AI_PLANNER_DISABLED: "true" };
    expect(await plan(d, "AI", svc(f.fetchImpl, killed), { answers: uniqueAnswers() })).toMatchObject({ ok: false, reason: "disabled" });
    expect(f.calls).toHaveLength(0);
    expect(ok(await plan(d, "RULES", svc(f.fetchImpl, killed))).producer).toBe("RULES");
    expect(f.calls).toHaveLength(0);
  });
});

describe("review corrections: stale reservations never block the gate; stale suggestions are never served", () => {
  beforeAll(async () => {
    await t.configure({ provider: "mock", model: "mock-ok", orgs: ["org-a"] });
  });
  const setOrg = async (change: { quotaPlanId: string }) => {
    const row = (await t.gestor().listOrganizations("2026-11")).find((o) => o.organizationId === "org-a")!;
    return t.gestor().setOrganization("org-a", change, row.version, "1", NOW);
  };

  it("a reservation leaked by a dead Worker (under ANOTHER key) is swept by the gate itself: planning continues, the leak is charged as unknown", async () => {
    const d = await t.newDraft("st-1");
    const original = (await t.first<{ quota_plan_id: string }>("SELECT quota_plan_id FROM ai_organization_settings WHERE organization_id = 'org-a'"))!.quota_plan_id;
    const month = (await t.first<{ used_input: number; used_output: number }>("SELECT used_input, used_output FROM ai_usage_month WHERE organization_id = 'org-a'"))!;
    const created = await t.gestor().savePlan(
      null,
      { name: `Vazamento ${t.id("n")}`, allowance: { mode: "TOTAL", total: month.used_input + month.used_output + 150_000 }, perRequestCapPlanning: 200_000, perRequestCapAdjustment: 1, requestsPerMinute: 120, costCap: null },
      null,
      NOW,
    );
    if (!created.ok) throw new Error(created.reason);
    expect(await setOrg({ quotaPlanId: created.id })).toBe("saved");
    try {
      const leaked = t.id("led");
      const then = new Date(NOW.getTime() - 10 * 60_000);
      expect(await aiPlanningFor(t.db, t.org("tech-a")).reserve({
        planId: d.planId, revisionId: d.revisionId, task: "PLANNER", ledgerId: leaked, requestKey: `${t.id("dead")}:1`, providerKind: "mock", modelId: "mock-ok",
        reservation: reservationFor({ estimatedInput: 1000, effectiveMaxOutput: 140_000, maxRetries: 0, prices: null }), prices: null, now: then, staleMs: 65_400,
      })).toEqual({ ok: true, ledgerId: leaked });
      const { provider, calls } = t.spy();
      const svc = t.service("tech-a", "org-a", { providers: { mock: provider } });
      // the ghost holds 140k of OUTPUT allowance until swept; the pure read sweeps too, so the professional is not told "limite atingido" because of it
      expect((await svc.availability(d.planId, d.revisionId))!.state).toBe("READY");
      const out = await plan(d, "AI", svc, { answers: uniqueFor(9) });
      expect(reason(out)).toBe("ok");
      expect(calls).toHaveLength(1);
      expect(await t.first("SELECT state, error_code FROM ai_usage_ledger WHERE id = ?1", leaked)).toEqual({ state: "CHARGED_UNKNOWN", error_code: "STALE" });
      expect((await t.first<{ reserved_input: number }>("SELECT reserved_input FROM ai_usage_month WHERE organization_id = 'org-a'"))!.reserved_input).toBe(0);
    } finally {
      expect(await setOrg({ quotaPlanId: original })).toBe("saved");
    }
  });

  it("a sweep with nothing stale writes nothing (a read of the gate does not touch the month row)", async () => {
    const d = await t.newDraft("st-1");
    const before = await t.first("SELECT updated_at, failed_requests FROM ai_usage_month WHERE organization_id = 'org-a'");
    await t.service().availability(d.planId, d.revisionId);
    expect(await t.first("SELECT updated_at, failed_requests FROM ai_usage_month WHERE organization_id = 'org-a'")).toEqual(before);
  });

  it("a suggestion made for another version of the draft is not served by state, latest or a replay; a new plan on the new version is", async () => {
    const d = await t.newDraft("st-1");
    const svc = t.service();
    const payload = await body(d, "RULES");
    const first = ok(await svc.plan(d.planId, d.revisionId, payload as never));
    expect(await svc.state(d.planId, d.revisionId)).toMatchObject({ state: "READY", view: { runId: first.runId } });
    expect((await svc.latest(d.planId, d.revisionId))?.runId).toBe(first.runId);
    expect(ok(await svc.plan(d.planId, d.revisionId, payload as never)).replayed).toBe(true);

    await t.run("UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = ?1", d.revisionId);
    expect(await svc.state(d.planId, d.revisionId)).toMatchObject({ state: "STALE", runId: first.runId });
    expect(await svc.latest(d.planId, d.revisionId)).toBeNull();
    expect(await svc.plan(d.planId, d.revisionId, payload as never)).toMatchObject({ ok: false, reason: "revision_changed", canContinueByRules: false });
    // another organization still sees nothing at all
    expect(await t.service("tech-b", "org-b").state(d.planId, d.revisionId)).toEqual({ state: "NONE" });

    const fresh = ok(await plan(d, "RULES", svc));
    expect(await svc.state(d.planId, d.revisionId)).toMatchObject({ state: "READY", view: { runId: fresh.runId } });
  });
});
