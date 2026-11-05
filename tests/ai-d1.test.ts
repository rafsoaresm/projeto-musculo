import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiPlatformFor, AI_AUDIT_ACTIONS, type PlanInput, type TaskInput } from "@/db/ai-platform";
import { aiPlanningFor, aiSystemFor, type ReserveInput, type RunStartInput } from "@/db/ai-planning";
import { plansFor } from "@/db/plans";
import { sealSecret, toBase64Url, type SecretsConfig } from "@/modules/prescricao/planejador/secrets";
import { evaluateAiGate } from "@/modules/prescricao/planejador/gate";
import { CIRCUIT_OPEN_MS } from "@/modules/prescricao/planejador/circuit";
import { monthKey, reservationFor, type TypedPrices } from "@/modules/prescricao/planejador/quota";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Miniflare/workerd D1 with migrations 0001-0047: the AI layer's persistence (design V4 §3.6-§3.8, §8.1 1.2c). Identities are rows, as the
// server derives them from a verified session. No provider is called here: the ledger, quota, cache, runs and breaker are the subject.
let mf: Miniflare;
let db: D1Database;
const NOW = new Date("2026-11-20T15:00:00Z");
const MONTH = monthKey(NOW);
const at = (ms: number) => new Date(NOW.getTime() + ms);
const STALE = 40_000;
const KEY = "sk-test-CANARY-0123456789abcdef";
const SECRETS: SecretsConfig = { current: { id: "k1", key: toBase64Url(new Uint8Array(32).fill(5)) } };

const org = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const ai = (userId = "tech-a", organizationId = "org-a") => aiPlanningFor(db, org(userId, organizationId));
const gestor = (userId = "g1") => aiPlatformFor(db, { userId });
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const first = <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const all = async <T,>(sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<T>()).results;
const n = async (sql: string, ...binds: unknown[]) => (await first<{ n: number }>(sql, ...binds))!.n;
let seq = 0;
const id = (label: string) => `${label}-${String(++seq).padStart(5, "0")}-0000-0000-0000`.slice(0, 40);

const V2 = {
  schemaVersion: 2, startDate: "2026-11-23",
  phases: [{ name: "Base", weeks: 3, sessionsPerWeek: 2, workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 }], trainingDays: [0, 3] }],
};
interface Draft { planId: string; revisionId: string }
async function newDraft(student = "st-1", who = "tech-a", organizationId = "org-a"): Promise<Draft> {
  const created = await plansFor(db, org(who, organizationId)).create(student, { title: "Plano de IA", input: V2 as never });
  if (!created) throw new Error("plan");
  return created;
}

const PLAN_TOTAL: PlanInput = { name: "Plano Teste", allowance: { mode: "TOTAL", total: 1000 }, perRequestCapPlanning: 400, perRequestCapAdjustment: 400, requestsPerMinute: 120, costCap: null };
const MOCK_TASK: TaskInput = {
  enabled: true, providerKind: "mock", modelId: "mock-ok", maxInputTokens: 12000, maxOutputTokens: 6144, timeoutMs: 25000, maxRetries: 1, prices: null,
  sendSystemExerciseNames: false, ceilings: { maxOutputTokens: 8192, timeoutMs: 25000 }, mockAllowed: true,
};
const RES = reservationFor({ estimatedInput: 100, effectiveMaxOutput: 100, maxRetries: 0, prices: null }); // 200 tokens per call

function reserveArgs(d: Draft, over: Partial<ReserveInput> = {}): ReserveInput {
  return {
    planId: d.planId, revisionId: d.revisionId, task: "PLANNER", ledgerId: id("led"), requestKey: `${id("run")}:1`, providerKind: "mock", modelId: "mock-ok",
    reservation: RES, prices: null, now: NOW, staleMs: STALE, ...over,
  };
}
function runArgs(d: Draft, over: Partial<RunStartInput> = {}): RunStartInput {
  return {
    runId: id("run"), planId: d.planId, revisionId: d.revisionId, idempotencyKey: id("key"), requestHash: "a".repeat(64), mode: "AI", baseContentVersion: 1,
    structureFingerprint: "f".repeat(32), contextHash: "c".repeat(64), aliasesHash: "d".repeat(64), cacheKey: id("ck").padEnd(64, "0").slice(0, 64), providerKind: "mock", modelId: "mock-ok",
    promptVersion: "planner-2026.11.1", schemaVersion: 1, templatesVersion: null, omittedJson: "[]", now: NOW, ...over,
  };
}
const ledgerRow = (ledgerId: string) => first<Record<string, unknown>>("SELECT * FROM ai_usage_ledger WHERE id = ?1", ledgerId);
const monthRow = (orgId = "org-a", month = MONTH) => first<Record<string, number | string | null>>("SELECT * FROM ai_usage_month WHERE organization_id = ?1 AND month = ?2", orgId, month);
/** Counters must always equal the sums of the RESERVED rows (reserved_*) and be consistent with the settled rows. */
async function reconciled(orgId = "org-a", month = MONTH) {
  const m = (await monthRow(orgId, month))!;
  const sums = (await first<{ ri: number; ro: number; rc: number }>(
    "SELECT COALESCE(SUM(reserved_input),0) AS ri, COALESCE(SUM(reserved_output),0) AS ro, COALESCE(SUM(reserved_cost_micros),0) AS rc FROM ai_usage_ledger WHERE organization_id = ?1 AND month = ?2 AND state = 'RESERVED'",
    orgId, month,
  ))!;
  expect({ ri: m.reserved_input, ro: m.reserved_output, rc: m.reserved_cost_micros }).toEqual({ ri: sums.ri, ro: sums.ro, rc: sums.rc });
  const used = (await first<{ i: number; o: number }>(
    "SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o FROM ai_usage_ledger WHERE organization_id = ?1 AND month = ?2 AND state IN ('SETTLED','CHARGED_UNKNOWN')",
    orgId, month,
  ))!;
  expect({ i: m.used_input, o: m.used_output }).toEqual({ i: used.i, o: used.o });
}
const SETTLE = (ledgerId: string, over: Record<string, unknown> = {}) => ({
  kind: "SETTLE" as const, ledgerId, inputTokens: 90, outputTokens: 40, cachedInputTokens: null, usageSource: "PROVIDER" as const, costMicros: null, prices: null,
  attempts: 1, latencyMs: 120, httpStatus: 200, now: NOW, ...over,
});

let D: { a1: Draft; a2: Draft; a3: Draft; b: Draft };
let PLAN_ID: string;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "ai-d1-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["g1", "g2", "g3", "tech-a", "tech-a2", "tech-off", "tech-b", "commercial-a", "stranger"];
  await db.batch([
    ...people.map((p) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(p, `${p}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.filter((p) => p !== "stranger").map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO platform_admins(user_id, created_at) VALUES ('g1','2026-10-01T00:00:00Z'),('g2','2026-10-01T00:00:00Z'),('g3','2026-10-01T00:00:00Z')"),
    db.prepare("UPDATE auth_user SET two_factor_enabled = 1 WHERE id = 'g1'"),
    db.prepare("UPDATE auth_user SET two_factor_enabled = 1 WHERE id = 'g3'"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),('org-a','tech-off','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-a2','org-a','tech-a2','Pro A2'),
       ('pro-off','org-a','tech-off','Off'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-2','org-a','Two'),('st-b','org-b','B')"),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-1','pro-off'),('org-a','st-2','pro-a'),('org-a','st-2','pro-a2'),('org-b','st-b','pro-b')`,
    ),
  ]);
  D = {
    a1: await newDraft("st-1"),
    a2: await newDraft("st-1"),
    a3: await newDraft("st-2"),
    b: await newDraft("st-b", "tech-b", "org-b"),
  };
  // tech-off lost the assignment AFTER the data existed
  await run("UPDATE care_assignments SET revoked_at = '2026-11-01T00:00:00Z' WHERE professional_id = 'pro-off'");
});
afterAll(async () => {
  await mf?.dispose();
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("gestor repository: who may touch the AI layer", () => {
  it("refuses every method to a user who is not a platform manager, and to a revoked one", async () => {
    for (const who of ["tech-a", "stranger"]) {
      const g = gestor(who);
      expect(await g.getSettings()).toEqual({ killSwitch: false, byEmail: null, at: null });
      expect(await g.listConnections()).toEqual([]);
      expect(await g.getTasks()).toEqual([]);
      expect(await g.listPlans()).toEqual([]);
      expect(await g.listOrganizations(MONTH)).toEqual([]);
      expect(await g.usage(MONTH)).toEqual([]);
      expect(await g.listAuditAi()).toEqual([]);
      expect(await g.setKillSwitch(true, NOW)).toBe(false);
      expect(await g.saveConnection("openai", await sealSecret(KEY, "openai", SECRETS), NOW)).toBe("denied");
      expect(await g.removeConnection("openai")).toBe("denied");
      expect(await g.recordTest("openai", true, null, NOW)).toBe(false);
      expect(await g.saveTask("PLANNER", MOCK_TASK, 1, NOW)).toBe("invalid");
      expect(await g.savePlan(null, PLAN_TOTAL, null, NOW)).toEqual({ ok: false, reason: "invalid" });
      expect(await g.archivePlan("nope", NOW)).toBe(false);
      expect(await g.setOrganization("org-a", { enabled: false }, 0, "1", NOW)).toBe("not_found");
    }
    expect(await n("SELECT COUNT(*) AS n FROM ai_provider_connections")).toBe(0);
    expect(await n("SELECT COUNT(*) AS n FROM ai_quota_plans")).toBe(0);
    expect((await first<{ kill_switch: number }>("SELECT kill_switch FROM ai_platform_settings WHERE id = 1"))!.kill_switch).toBe(0);
    await run("UPDATE platform_admins SET revoked_at = '2026-11-02T00:00:00Z' WHERE user_id = 'g3'");
    expect(await gestor("g3").listPlans()).toEqual([]);
    expect(await gestor("g3").setKillSwitch(true, NOW)).toBe(false);
    await run("UPDATE platform_admins SET revoked_at = NULL WHERE user_id = 'g3'");
  });

  it("lets a manager WITHOUT two-factor read, but not write (decision D5)", async () => {
    const g = gestor("g2");
    expect(await g.getTasks()).toHaveLength(2);
    expect(await g.setKillSwitch(true, NOW)).toBe(false);
    expect(await g.saveConnection("openai", await sealSecret(KEY, "openai", SECRETS), NOW)).toBe("denied");
    expect(await g.savePlan(null, PLAN_TOTAL, null, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(await g.saveTask("PLANNER", MOCK_TASK, 1, NOW)).toBe("invalid");
    expect(await n("SELECT COUNT(*) AS n FROM ai_provider_connections")).toBe(0);
    expect(await n("SELECT COUNT(*) AS n FROM access_audit_events WHERE actor_user_id = 'g2' AND action LIKE 'AI_%'")).toBe(0);
  });

  it("the default AI settings are all off", async () => {
    const tasks = await gestor().getTasks();
    expect(tasks.map((t) => [t.task, t.enabled, t.providerKind, t.modelId])).toEqual([["ADJUSTMENTS", false, null, null], ["PLANNER", false, null, null]]);
    expect(tasks[0]).toMatchObject({ maxOutputTokens: 6144, timeoutMs: 25000, maxRetries: 1, currency: null, priceInputMicrosPerMillion: null, version: 1 });
    expect(await gestor().getSettings()).toMatchObject({ killSwitch: false });
    expect(await n("SELECT COUNT(*) AS n FROM ai_organization_settings")).toBe(0);
  });
});

describe("provider keys are stored encrypted and never read back", () => {
  it("connects, lists only the masked tail, rotates, tests and removes — each with an audit row without key material", async () => {
    const g = gestor();
    const sealed = await sealSecret(KEY, "openai", SECRETS);
    expect(await g.saveConnection("openai", sealed, NOW)).toBe("connected");
    const [conn] = await g.listConnections();
    expect(conn).toMatchObject({ kind: "openai", last4: "cdef", connectedByEmail: "g1@example.test", rotatedAt: null, lastTestAt: null, version: 1 });
    // the constant select list never names the ciphertext
    expect(Object.keys(conn).sort()).toEqual(["connectedAt", "connectedByEmail", "kind", "last4", "lastTestAt", "lastTestCode", "lastTestOk", "rotatedAt", "version"]);
    expect(JSON.stringify(conn)).not.toContain(sealed.ciphertext);
    expect(JSON.stringify(conn)).not.toContain(KEY);

    const stored = (await first<{ key_ciphertext: string; key_key_id: string; key_last4: string }>("SELECT key_ciphertext, key_key_id, key_last4 FROM ai_provider_connections WHERE kind = 'openai'"))!;
    expect(stored).toEqual({ key_ciphertext: sealed.ciphertext, key_key_id: "k1", key_last4: "cdef" });
    expect(stored.key_ciphertext).not.toContain("CANARY");

    expect(await g.recordTest("openai", true, null, at(1000))).toBe(true);
    expect((await g.listConnections())[0]).toMatchObject({ lastTestOk: true, lastTestCode: null, lastTestAt: at(1000).toISOString() });
    const rotated = await sealSecret("sk-test-NEW-0123456789abcdef-wxyz", "openai", SECRETS);
    expect(await g.saveConnection("openai", rotated, at(2000))).toBe("rotated");
    expect((await g.listConnections())[0]).toMatchObject({ last4: "wxyz", version: 2, rotatedAt: at(2000).toISOString(), lastTestAt: null, lastTestOk: null });
    expect(await g.recordTest("openai", false, "AUTH", at(3000))).toBe(true);
    expect((await g.listConnections())[0]).toMatchObject({ lastTestOk: false, lastTestCode: "AUTH" });

    const audit = await all<{ action: string; subject_id: string; actor_user_id: string }>("SELECT action, subject_id, actor_user_id FROM access_audit_events WHERE action LIKE 'AI_PROVIDER_%' ORDER BY rowid");
    expect(audit.map((a) => a.action)).toEqual(["AI_PROVIDER_CONNECTED", "AI_PROVIDER_TESTED", "AI_PROVIDER_ROTATED", "AI_PROVIDER_TESTED"]);
    expect(audit.every((a) => a.subject_id === "openai" && a.actor_user_id === "g1")).toBe(true);

    // no row of the audit trail, anywhere, carries the key, its ciphertext or a fragment beyond the masked tail
    const dump = JSON.stringify(await all("SELECT * FROM access_audit_events"));
    for (const secret of [KEY, "CANARY", sealed.ciphertext, rotated.ciphertext, "0123456789abcdef"]) expect(dump).not.toContain(secret);
    expect(await g.listAuditAi()).toHaveLength(4);
    expect(JSON.stringify(await g.listAuditAi())).not.toContain("CANARY");
  });

  it("only the single server-side reader returns the ciphertext, and only for an active member", async () => {
    const sealed = (await first<{ key_ciphertext: string }>("SELECT key_ciphertext FROM ai_provider_connections WHERE kind = 'openai'"))!.key_ciphertext;
    expect(await aiSystemFor(db, org("tech-a")).readKeyForCall("openai")).toEqual({ ciphertext: sealed, keyId: "k1" });
    expect(await aiSystemFor(db, org("tech-b", "org-b")).readKeyForCall("openai")).toMatchObject({ keyId: "k1" });
    expect(await aiSystemFor(db, org("stranger")).readKeyForCall("openai")).toBeNull();
    expect(await aiSystemFor(db, org("tech-a", "org-b")).readKeyForCall("openai")).toBeNull();
    expect(await aiSystemFor(db, org("tech-a")).readKeyForCall("google")).toBeNull();
    expect(() => aiSystemFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
  });

  it("removing a provider that a task uses is refused; unmapped it is removed", async () => {
    const g = gestor();
    expect(await g.saveConnection("anthropic", await sealSecret("sk-ant-test-1234567890", "anthropic", SECRETS), NOW)).toBe("connected");
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, providerKind: "anthropic", modelId: "some-model" }, 1, NOW)).toBe("saved");
    expect(await g.removeConnection("anthropic")).toBe("mapped");
    expect(await n("SELECT COUNT(*) AS n FROM ai_provider_connections WHERE kind = 'anthropic'")).toBe(1);
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, enabled: false, providerKind: null, modelId: null }, 2, NOW)).toBe("saved");
    expect(await g.removeConnection("anthropic")).toBe("removed");
    expect(await g.removeConnection("anthropic")).toBe("not_found");
    expect((await all<{ action: string }>("SELECT action FROM access_audit_events WHERE action = 'AI_PROVIDER_REMOVED'")).length).toBe(1);
  });

  it("the table refuses a ciphertext that is too short or a provider outside the three", async () => {
    await expect(run("INSERT INTO ai_provider_connections(kind,key_ciphertext,key_key_id,key_last4,connected_at,connected_by_user_id) VALUES ('google','short','k1','abcd','x','g1')")).rejects.toThrow();
    await expect(run(`INSERT INTO ai_provider_connections(kind,key_ciphertext,key_key_id,key_last4,connected_at,connected_by_user_id) VALUES ('mock','${"x".repeat(60)}','k1','abcd','x','g1')`)).rejects.toThrow();
  });
});

describe("task -> provider/model mapping", () => {
  it("saves with compare-and-set on the version, clamps to the ceilings and keeps prices null when absent", async () => {
    const g = gestor();
    const before = (await g.getTasks()).find((t) => t.task === "ADJUSTMENTS")!;
    expect(await g.saveTask("ADJUSTMENTS", { ...MOCK_TASK, maxOutputTokens: 20_000, timeoutMs: 100_000 }, before.version, NOW)).toBe("saved");
    const saved = (await g.getTasks()).find((t) => t.task === "ADJUSTMENTS")!;
    expect(saved).toMatchObject({ enabled: true, providerKind: "mock", modelId: "mock-ok", maxOutputTokens: 8192, timeoutMs: 25000, version: before.version + 1, currency: null, priceInputMicrosPerMillion: null, priceOutputMicrosPerMillion: null });
    expect(await g.saveTask("ADJUSTMENTS", MOCK_TASK, before.version, NOW)).toBe("conflict");
  });

  it("the provider must be connected; the mock only where the environment allows it; a model id is a plain token", async () => {
    const g = gestor();
    const v = (await g.getTasks()).find((t) => t.task === "PLANNER")!.version;
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, providerKind: "google", modelId: "gem-x" }, v, NOW)).toBe("provider_not_connected");
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, mockAllowed: false }, v, NOW)).toBe("invalid");
    for (const bad of ["../x", "a b", "x?key=1", "", "m".repeat(81)]) {
      expect(await g.saveTask("PLANNER", { ...MOCK_TASK, modelId: bad }, v, NOW)).toBe("invalid");
    }
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, providerKind: null, modelId: "only-model" }, v, NOW)).toBe("invalid");
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, providerKind: null, modelId: null }, v, NOW)).toBe("invalid");
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, maxInputTokens: 10 }, v, NOW)).toBe("invalid");
  });

  it("typed prices are integer micros with a currency; absent prices stay null (cost unknown), and the table rejects half-priced rows", async () => {
    const g = gestor();
    const v = (await g.getTasks()).find((t) => t.task === "PLANNER")!.version;
    const prices: TypedPrices = { currency: "USD", inputMicrosPerMillion: 150_000, outputMicrosPerMillion: 600_000 };
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, prices }, v, NOW)).toBe("saved");
    expect((await g.getTasks()).find((t) => t.task === "PLANNER")).toMatchObject({ currency: "USD", priceInputMicrosPerMillion: 150_000, priceOutputMicrosPerMillion: 600_000 });
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, prices: { ...prices, inputMicrosPerMillion: 1.5 } }, v + 1, NOW)).toBe("invalid");
    expect(await g.saveTask("PLANNER", { ...MOCK_TASK, prices: { ...prices, outputMicrosPerMillion: -1 } }, v + 1, NOW)).toBe("invalid");
    await expect(run("UPDATE ai_task_settings SET price_input_micros_per_million = 5 WHERE task = 'PLANNER' AND price_output_micros_per_million IS NULL")).resolves.toBeDefined();
    await expect(run("UPDATE ai_task_settings SET price_output_micros_per_million = NULL WHERE task = 'PLANNER'")).rejects.toThrow();
    // back to "no prices": cost unknown again
    expect(await g.saveTask("PLANNER", MOCK_TASK, v + 1, NOW)).toBe("saved");
    expect((await g.getTasks()).find((t) => t.task === "PLANNER")).toMatchObject({ currency: null, priceInputMicrosPerMillion: null, priceOutputMicrosPerMillion: null });
    expect(await n("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = 'AI_TASK_CONFIGURED'")).toBeGreaterThanOrEqual(3);
  });
});

describe("quota plans and per-organization assignment", () => {
  it("creates TOTAL and SPLIT plans; zero is allowed and means 'not included'; names are unique ignoring case and accents", async () => {
    const g = gestor();
    const a = await g.savePlan(null, PLAN_TOTAL, null, NOW);
    expect(a.ok).toBe(true);
    PLAN_ID = (a as { id: string }).id;
    expect(await g.savePlan(null, { ...PLAN_TOTAL, name: "plano  TESTE" }, null, NOW)).toEqual({ ok: false, reason: "name_taken" });
    const split = await g.savePlan(null, { ...PLAN_TOTAL, name: "Dividido", allowance: { mode: "SPLIT", input: 600, output: 400 } }, null, NOW);
    const zero = await g.savePlan(null, { ...PLAN_TOTAL, name: "Sem IA", allowance: { mode: "TOTAL", total: 0 }, perRequestCapPlanning: 0 }, null, NOW);
    expect(split.ok && zero.ok).toBe(true);
    const plans = await g.listPlans();
    expect(plans.map((p) => p.name).sort()).toEqual(["Dividido", "Plano Teste", "Sem IA"]);
    expect(plans.find((p) => p.name === "Dividido")).toMatchObject({ mode: "SPLIT", totalTokens: null, inputTokens: 600, outputTokens: 400 });
    expect(plans.find((p) => p.name === "Sem IA")).toMatchObject({ mode: "TOTAL", totalTokens: 0, perRequestCapPlanning: 0 });
    expect(await g.savePlan(null, { ...PLAN_TOTAL, name: "x".repeat(61) }, null, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(await g.savePlan(null, { ...PLAN_TOTAL, name: "Neg", allowance: { mode: "TOTAL", total: -1 } }, null, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(await g.savePlan(null, { ...PLAN_TOTAL, name: "Rpm", requestsPerMinute: 0 }, null, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("edits with compare-and-set; archives; stores requests_per_minute", async () => {
    const g = gestor();
    const p = (await g.listPlans()).find((x) => x.id === PLAN_ID)!;
    expect(await g.savePlan(PLAN_ID, { ...PLAN_TOTAL, requestsPerMinute: 30 }, p.version, NOW)).toEqual({ ok: true, id: PLAN_ID });
    expect((await g.listPlans()).find((x) => x.id === PLAN_ID)).toMatchObject({ requestsPerMinute: 30, version: p.version + 1 });
    expect(await g.savePlan(PLAN_ID, PLAN_TOTAL, p.version, NOW)).toEqual({ ok: false, reason: "conflict" });
    expect(await g.savePlan(PLAN_ID, PLAN_TOTAL, p.version + 1, NOW)).toEqual({ ok: true, id: PLAN_ID });
    const tmp = (await g.savePlan(null, { ...PLAN_TOTAL, name: "Para arquivar" }, null, NOW)) as { id: string };
    expect(await g.archivePlan(tmp.id, NOW)).toBe(true);
    expect(await g.archivePlan(tmp.id, NOW)).toBe(false);
    expect(await g.savePlan(tmp.id, PLAN_TOTAL, 2, NOW)).toEqual({ ok: false, reason: "not_found" });
  });

  it("a cost cap needs the typed price currency to match; prices are never invented", async () => {
    const g = gestor();
    const v = (await g.getTasks()).find((t) => t.task === "PLANNER")!.version;
    await g.saveTask("PLANNER", { ...MOCK_TASK, prices: { currency: "USD", inputMicrosPerMillion: 1, outputMicrosPerMillion: 2 } }, v, NOW);
    expect(await g.savePlan(null, { ...PLAN_TOTAL, name: "Com custo BRL", costCap: { micros: 5_000_000, currency: "BRL" } }, null, NOW)).toEqual({ ok: false, reason: "currency_mismatch" });
    expect(await g.savePlan(null, { ...PLAN_TOTAL, name: "Com custo USD", costCap: { micros: 5_000_000, currency: "USD" } }, null, NOW)).toMatchObject({ ok: true });
    await g.saveTask("PLANNER", MOCK_TASK, v + 1, NOW);
    expect(await g.savePlan(null, { ...PLAN_TOTAL, name: "Com custo BRL", costCap: { micros: 5_000_000, currency: "BRL" } }, null, NOW)).toMatchObject({ ok: true });
  });

  it("enabling an organization needs a non-archived plan and the CURRENT acknowledgement; disabling is immediate", async () => {
    const g = gestor();
    expect(await g.setOrganization("org-a", { enabled: true, ackVersion: "1" }, 0, "1", NOW)).toBe("plan_required");
    expect(await g.setOrganization("org-a", { enabled: true, quotaPlanId: PLAN_ID }, 0, "1", NOW)).toBe("ack_required");
    expect(await g.setOrganization("org-a", { enabled: true, quotaPlanId: PLAN_ID, ackVersion: "0" }, 0, "1", NOW)).toBe("ack_required");
    expect(await n("SELECT COUNT(*) AS n FROM ai_organization_settings WHERE enabled = 1")).toBe(0);
    expect(await g.setOrganization("nope", { quotaPlanId: PLAN_ID }, 0, "1", NOW)).toBe("not_found");
    expect(await g.setOrganization("org-a", { quotaPlanId: PLAN_ID }, 0, "1", NOW)).toBe("saved");
    expect(await g.setOrganization("org-a", { enabled: true, ackVersion: "1" }, 2, "1", NOW)).toBe("saved");
    const row = (await first<Record<string, unknown>>("SELECT * FROM ai_organization_settings WHERE organization_id = 'org-a'"))!;
    expect(row).toMatchObject({ enabled: 1, quota_plan_id: PLAN_ID, ack_version: "1", enabled_by_user_id: "g1", version: 3 });
    expect(await g.setOrganization("org-a", { enabled: false }, 2, "1", NOW)).toBe("conflict");
    expect(await g.setOrganization("org-a", { enabled: false }, 3, "1", NOW)).toBe("saved");
    expect(await g.setOrganization("org-a", { enabled: true, ackVersion: "1" }, 4, "1", NOW)).toBe("saved");
    const listed = (await g.listOrganizations(MONTH)).find((o) => o.organizationId === "org-a")!;
    expect(listed).toMatchObject({ enabled: true, quotaPlanName: "Plano Teste", usedTokens: 0 });
    expect((await g.listOrganizations(MONTH)).find((o) => o.organizationId === "org-b")).toMatchObject({ enabled: false, quotaPlanId: null });
    const actions = (await all<{ action: string; organization_id: string }>("SELECT action, organization_id FROM access_audit_events WHERE action LIKE 'AI_ORG_%' ORDER BY rowid")).map((a) => a.action);
    expect(actions).toEqual(["AI_ORG_PLAN_ASSIGNED", "AI_ORG_ENABLED", "AI_ORG_DISABLED", "AI_ORG_ENABLED"]);
  });

  it("an archived plan cannot enable an organization, and the table checks refuse an 'enabled' row without acknowledgement", async () => {
    const g = gestor();
    const arch = (await g.listPlans()).find((p) => p.name === "Para arquivar")!;
    expect(await g.setOrganization("org-b", { quotaPlanId: arch.id, enabled: true, ackVersion: "1" }, 0, "1", NOW)).toBe("plan_required");
    await expect(run("INSERT INTO ai_organization_settings(organization_id, enabled, updated_at) VALUES ('org-b', 1, 'x')")).rejects.toThrow();
    await expect(run("INSERT INTO ai_quota_plans(id,name,name_key,allowance_mode,monthly_total_tokens,monthly_input_tokens,created_at,created_by_user_id,updated_at,updated_by_user_id) VALUES ('p','n','n','TOTAL',1,1,'x','g1','x','g1')")).rejects.toThrow();
  });

  it("the kill switch is audited and visible", async () => {
    const g = gestor();
    expect(await g.setKillSwitch(true, at(10))).toBe(true);
    expect(await g.getSettings()).toMatchObject({ killSwitch: true, byEmail: "g1@example.test", at: at(10).toISOString() });
    expect(await g.setKillSwitch(false, at(20))).toBe(true);
    expect((await g.getSettings()).killSwitch).toBe(false);
    expect((await all<{ action: string }>("SELECT action FROM access_audit_events WHERE action LIKE 'AI_KILL_SWITCH_%' ORDER BY rowid")).map((a) => a.action)).toEqual(["AI_KILL_SWITCH_ON", "AI_KILL_SWITCH_OFF"]);
  });

  it("audit actions are all registered for the manager audit trail", async () => {
    const { PLATFORM_AUDIT_ACTIONS } = await import("@/db/platform");
    for (const action of AI_AUDIT_ACTIONS) expect(PLATFORM_AUDIT_ACTIONS).toContain(action);
    expect(await gestor().recordModelTest("PLANNER")).toBe(true);
    expect(await n("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = 'AI_MODEL_TESTED' AND subject_id = 'PLANNER'")).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("gate state and reach (organization + membership + assignment + revocation)", () => {
  it("reads the gate for a reachable revision and reports the plan, month and task facts", async () => {
    const snap = await ai().gateState(D.a1.planId, D.a1.revisionId, "PLANNER", NOW);
    expect(snap.reach).toBe(true);
    expect(snap.month).toBe(MONTH);
    expect(snap.state).toMatchObject({
      panelKill: false, org: { enabled: true }, providerConnected: false,
      task: { enabled: true, providerKind: "mock", modelId: "mock-ok", hasPrices: false },
      plan: { archived: false, allowance: { mode: "TOTAL", total: 1000 }, perRequestCapPlanning: 400, perRequestCapAdjustment: 400 },
    });
    expect(snap.taskSettings).toMatchObject({ timeoutMs: 25000, maxRetries: 1, prices: null, sendSystemExerciseNames: false });
    expect(snap.requestsPerMinute).toBe(120);
    expect(evaluateAiGate({ ...snap.state, envKill: false, secretsKeyOk: false, mockEnabled: true, circuitOpen: false }, "PLANNER")).toBe("READY");
    expect(evaluateAiGate({ ...snap.state, envKill: false, secretsKeyOk: false, mockEnabled: false, circuitOpen: false }, "PLANNER")).toBe("TASK_NOT_MAPPED");
  });

  it.each([
    ["a member without an assignment to the student", "tech-a2", "org-a", "a1"],
    ["a professional whose assignment was revoked", "tech-off", "org-a", "a1"],
    ["a member of another organization", "tech-b", "org-b", "a1"],
    ["a user with the right organization id but no membership", "stranger", "org-a", "a1"],
    ["a non-technical role", "commercial-a", "org-a", "a1"],
  ] as const)("%s reaches nothing", async (_who, user, organization, draft) => {
    const repo = ai(user, organization);
    const d = D[draft];
    expect((await repo.gateState(d.planId, d.revisionId, "PLANNER", NOW)).reach).toBe(false);
    expect(await repo.reserve(reserveArgs(d))).toEqual({ ok: false });
    expect(await repo.runStart(runArgs(d))).toMatchObject({ ok: false });
    expect(await repo.latestRun(d.planId, d.revisionId)).toBeNull();
    expect(await repo.cacheGet(d.planId, d.revisionId, "k".repeat(64), NOW)).toBeNull();
  });

  it("usage is per organization: a user without membership sees none, another organization sees its own", async () => {
    expect((await ai("stranger").usageForProfessional(NOW)).allowance).toBeNull();
    expect((await ai("tech-b", "org-b").usageForProfessional(NOW)).allowance).toBeNull();
    expect((await ai("tech-a2").usageForProfessional(NOW)).allowance).toEqual({ mode: "TOTAL", total: 1000 });
  });

  it("another professional with an assignment to a different student reaches only that student", async () => {
    expect((await ai("tech-a2").gateState(D.a3.planId, D.a3.revisionId, "PLANNER", NOW)).reach).toBe(true);
    expect((await ai("tech-a2").gateState(D.a1.planId, D.a1.revisionId, "PLANNER", NOW)).reach).toBe(false);
  });
});

describe("ledger: reserve -> settle / release / charge-unknown", () => {
  it("reserves, then settles with exact counters", async () => {
    const d = D.a1;
    const before = await monthRow();
    const args = reserveArgs(d);
    expect(await ai().reserve(args)).toEqual({ ok: true, ledgerId: args.ledgerId });
    expect(await ledgerRow(args.ledgerId)).toMatchObject({ state: "RESERVED", reserved_input: 100, reserved_output: 100, organization_id: "org-a", month: MONTH, task: "PLANNER", requested_by_user_id: "tech-a" });
    const mid = (await monthRow())!;
    expect(mid.reserved_input).toBe(Number(before?.reserved_input ?? 0) + 100);
    expect(mid.reserved_output).toBe(Number(before?.reserved_output ?? 0) + 100);

    expect(await ai().ledger(SETTLE(args.ledgerId, { inputTokens: 90, outputTokens: 40, cachedInputTokens: 10 }))).toBe(true);
    expect(await ledgerRow(args.ledgerId)).toMatchObject({ state: "SETTLED", input_tokens: 90, output_tokens: 40, cached_input_tokens: 10, usage_source: "PROVIDER", cost_micros: null, currency: null, attempts: 1, http_status: 200 });
    const after = (await monthRow())!;
    expect(after.reserved_input).toBe(before?.reserved_input ?? 0);
    expect(after.used_input).toBe(Number(before?.used_input ?? 0) + 90);
    expect(after.used_output).toBe(Number(before?.used_output ?? 0) + 40);
    expect(after.requests).toBe(Number(before?.requests ?? 0) + 1);
    expect(after.cost_micros).toBe(0);
    expect(after.cost_currency).toBeNull();
    await reconciled();
    // settling twice is a no-op
    expect(await ai().ledger(SETTLE(args.ledgerId))).toBe(false);
    expect((await monthRow())!.used_input).toBe(after.used_input);
  });

  it("a settled or released row can never be updated or deleted", async () => {
    const row = (await first<{ id: string }>("SELECT id FROM ai_usage_ledger WHERE state = 'SETTLED' LIMIT 1"))!;
    await expect(run("UPDATE ai_usage_ledger SET input_tokens = 1 WHERE id = ?1", row.id)).rejects.toThrow(/AI_LEDGER_IMMUTABLE/);
    await expect(run("DELETE FROM ai_usage_ledger WHERE id = ?1", row.id)).rejects.toThrow(/AI_LEDGER_APPEND_ONLY/);
  });

  it("release gives the reservation back; cost stays null (unknown) without typed prices", async () => {
    const args = reserveArgs(D.a1);
    const before = (await monthRow())!;
    await ai().reserve(args);
    expect(await ai().ledger({ kind: "RELEASE", ledgerId: args.ledgerId, errorCode: "AUTH", countAsFailure: true, now: NOW })).toBe(true);
    expect(await ledgerRow(args.ledgerId)).toMatchObject({ state: "RELEASED", error_code: "AUTH", input_tokens: null, cost_micros: null });
    const after = (await monthRow())!;
    expect(after.reserved_input).toBe(before.reserved_input);
    expect(after.used_input).toBe(before.used_input);
    expect(after.failed_requests).toBe(Number(before.failed_requests) + 1);
    await reconciled();
  });

  it("charge-unknown bills one attempt's input estimate and releases the output", async () => {
    const args = reserveArgs(D.a1, { reservation: reservationFor({ estimatedInput: 100, effectiveMaxOutput: 100, maxRetries: 1, prices: null }) });
    const before = (await monthRow())!;
    await ai().reserve(args);
    expect((await ledgerRow(args.ledgerId))!.reserved_input).toBe(200);
    expect(await ai().ledger({ kind: "CHARGE_UNKNOWN", ledgerId: args.ledgerId, inputTokens: 100, errorCode: "TIMEOUT", attempts: 2, latencyMs: 25000, now: NOW })).toBe(true);
    expect(await ledgerRow(args.ledgerId)).toMatchObject({ state: "CHARGED_UNKNOWN", input_tokens: 100, output_tokens: 0, usage_source: "ESTIMATE", error_code: "TIMEOUT", attempts: 2 });
    const after = (await monthRow())!;
    expect(after.used_input).toBe(Number(before.used_input) + 100);
    expect(after.reserved_input).toBe(before.reserved_input);
    expect(after.reserved_output).toBe(before.reserved_output);
    await reconciled();
  });

  it("typed prices: the reservation carries the priced worst case and settle records cost, currency and the price snapshot", async () => {
    const prices: TypedPrices = { currency: "USD", inputMicrosPerMillion: 150_000, outputMicrosPerMillion: 600_000 };
    const reservation = reservationFor({ estimatedInput: 100, effectiveMaxOutput: 100, maxRetries: 0, prices });
    const args = reserveArgs(D.a1, { prices, reservation });
    await ai().reserve(args);
    expect((await ledgerRow(args.ledgerId))!.reserved_cost_micros).toBe(reservation.costMicros);
    expect(reservation.costMicros).toBeGreaterThan(0);
    await ai().ledger(SETTLE(args.ledgerId, { costMicros: 21, prices }));
    expect(await ledgerRow(args.ledgerId)).toMatchObject({ cost_micros: 21, currency: "USD", price_input_micros_per_million: 150_000, price_output_micros_per_million: 600_000 });
    expect(await monthRow()).toMatchObject({ cost_micros: 21, cost_currency: "USD", reserved_cost_micros: 0 });
    await reconciled();
  });

  it("the request key is SERVER generated per run and attempt: the same client key on two revisions both reserve, and a duplicate is an error, not 'exhausted'", async () => {
    const clientKey = id("client-key");
    const r1 = reserveArgs(D.a1, { requestKey: `${id("run")}:1` });
    const r2 = reserveArgs(D.a2, { requestKey: `${id("run")}:1` });
    void clientKey;
    expect((await ai().reserve(r1)).ok).toBe(true);
    expect((await ai().reserve(r2)).ok).toBe(true);
    await expect(ai().reserve(reserveArgs(D.a1, { requestKey: r1.requestKey }))).rejects.toThrow();
    for (const r of [r1, r2]) await ai().ledger({ kind: "RELEASE", ledgerId: r.ledgerId, errorCode: null, countAsFailure: false, now: NOW });
    await reconciled();
  });

  it("another organization or a user without reach cannot settle or release someone else's reservation", async () => {
    const args = reserveArgs(D.a1);
    await ai().reserve(args);
    expect(await ai("tech-b", "org-b").ledger(SETTLE(args.ledgerId))).toBe(false);
    expect(await ai("stranger").ledger(SETTLE(args.ledgerId))).toBe(false);
    expect(await ledgerRow(args.ledgerId)).toMatchObject({ state: "RESERVED" });
    await ai().ledger({ kind: "RELEASE", ledgerId: args.ledgerId, errorCode: null, countAsFailure: false, now: NOW });
    await reconciled();
  });

  it("the first reserve of a new month also sweeps what a crashed call left reserved at the end of the previous month", async () => {
    await run("INSERT OR IGNORE INTO ai_usage_month(organization_id, month, updated_at, reserved_input) VALUES ('org-a', '2026-10', 'x', 0)");
    await run("UPDATE ai_usage_month SET reserved_input = 40 WHERE organization_id = 'org-a' AND month = '2026-10'");
    await run("INSERT INTO ai_usage_ledger(id,organization_id,month,task,request_key,state,reserved_input,reserved_output,requested_by_user_id,created_at) VALUES ('led-oct-old','org-a','2026-10','PLANNER','run-oct-old-00000001:1','RESERVED',40,0,'tech-a','2026-10-31T23:00:00.000Z')");
    const args = reserveArgs(D.a1);
    expect((await ai().reserve(args)).ok).toBe(true);
    expect(await ledgerRow("led-oct-old")).toMatchObject({ state: "CHARGED_UNKNOWN", error_code: "STALE" });
    expect(await monthRow("org-a", "2026-10")).toMatchObject({ reserved_input: 0, used_input: 40 });
    await ai().ledger({ kind: "RELEASE", ledgerId: args.ledgerId, errorCode: null, countAsFailure: false, now: NOW });
    await reconciled("org-a", "2026-10");
    await reconciled();
  });

  it("the stale sweep (inside reserve) turns old RESERVED rows into CHARGED_UNKNOWN for THIS organization and month only", async () => {
    const old = reserveArgs(D.a1, { reservation: { ...RES, input: 50, output: 60 } });
    await ai().reserve(old);
    const later = at(STALE + 5000);
    const fresh = reserveArgs(D.a1, { now: later });
    // another organization has its own old RESERVED row: it must stay untouched
    await run("INSERT INTO ai_usage_month(organization_id, month, updated_at) VALUES ('org-b', ?1, 'x')", MONTH);
    await run("UPDATE ai_usage_month SET reserved_input = 7 WHERE organization_id = 'org-b'");
    await run("INSERT INTO ai_usage_ledger(id,organization_id,month,task,request_key,state,reserved_input,reserved_output,requested_by_user_id,created_at) VALUES ('led-b-old','org-b',?1,'PLANNER','run-b-old-0000000001:1','RESERVED',7,0,'tech-b',?2)", MONTH, NOW.toISOString());
    expect((await ai().reserve(fresh)).ok).toBe(true);
    expect(await ledgerRow(old.ledgerId)).toMatchObject({ state: "CHARGED_UNKNOWN", error_code: "STALE", input_tokens: 50, output_tokens: 0 });
    expect(await ledgerRow("led-b-old")).toMatchObject({ state: "RESERVED" });
    expect(await monthRow("org-b")).toMatchObject({ reserved_input: 7, used_input: 0 });
    await reconciled();
    await ai().ledger({ kind: "RELEASE", ledgerId: fresh.ledgerId, errorCode: null, countAsFailure: false, now: later });
    await reconciled();
    // sweepStale as a separate call is scoped the same way
    expect(await ai("tech-b", "org-b").sweepStale(MONTH, later, STALE)).toBe(1);
    expect(await ledgerRow("led-b-old")).toMatchObject({ state: "CHARGED_UNKNOWN" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("quota enforcement is race-safe", () => {
  /** A fresh organization-month-plan so the previous tests' usage does not matter. */
  async function freshOrg(label: string, planInput: PlanInput, task: Partial<TaskInput> = {}) {
    const orgId = `org-${label}`;
    const user = `tech-${label}`;
    const student = `st-${label}`;
    await db.batch([
      db.prepare("INSERT INTO organizations(id,name) VALUES (?1,?1)").bind(orgId),
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(user, `${user}@example.test`),
      db.prepare("INSERT INTO users(id) VALUES (?1)").bind(user),
      db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES (?1,?2,'TECHNICAL')").bind(orgId, user),
      db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES (?1,?2,?3,'p')").bind(`pro-${label}`, orgId, user),
      db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES (?1,?2,'s')").bind(student, orgId),
      db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES (?1,?2,?3)").bind(orgId, student, `pro-${label}`),
    ]);
    const planId = ((await gestor().savePlan(null, { ...planInput, name: `Plano ${label}` }, null, NOW)) as { id: string }).id;
    expect(await gestor().setOrganization(orgId, { quotaPlanId: planId, enabled: true, ackVersion: "1" }, 0, "1", NOW)).toBe("saved");
    void task;
    const draft = await newDraft(student, user, orgId);
    return { orgId, user, draft, repo: ai(user, orgId) };
  }
  const settled = async (orgId: string, state: string) => n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE organization_id = ?1 AND state = ?2", orgId, state);

  it("20 concurrent reserves against an allowance that fits 5 => exactly 5 (never 6)", async () => {
    const f = await freshOrg("race1", { ...PLAN_TOTAL, allowance: { mode: "TOTAL", total: 1000 }, perRequestCapPlanning: 1000 });
    const results = await Promise.all(Array.from({ length: 20 }, () => f.repo.reserve(reserveArgs(f.draft))));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(await settled(f.orgId, "RESERVED")).toBe(5);
    expect(await monthRow(f.orgId)).toMatchObject({ reserved_input: 500, reserved_output: 500, used_input: 0 });
    await reconciled(f.orgId);
    // the sixth is refused for the allowance, not by an error
    expect(await f.repo.reserve(reserveArgs(f.draft))).toEqual({ ok: false });
  });

  it("SPLIT mode blocks on output while input still has room", async () => {
    const f = await freshOrg("split1", { ...PLAN_TOTAL, allowance: { mode: "SPLIT", input: 10_000, output: 450 }, perRequestCapPlanning: 1000 });
    const results = await Promise.all(Array.from({ length: 10 }, () => f.repo.reserve(reserveArgs(f.draft))));
    expect(results.filter((r) => r.ok)).toHaveLength(4); // 4 x 100 output <= 450 < 5 x 100
    expect(await monthRow(f.orgId)).toMatchObject({ reserved_input: 400, reserved_output: 400 });
    await reconciled(f.orgId);
  });

  it("the cost cap is atomic with the allowance: 20 priced reserves against a cap that fits 5 => exactly 5; no typed prices => the cap is ignored", async () => {
    const prices: TypedPrices = { currency: "USD", inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 1_000_000 };
    const reservation = reservationFor({ estimatedInput: 100, effectiveMaxOutput: 100, maxRetries: 0, prices });
    expect(reservation.costMicros).toBe(200);
    const f = await freshOrg("cost1", { ...PLAN_TOTAL, allowance: { mode: "TOTAL", total: 100_000 }, perRequestCapPlanning: 1000, costCap: { micros: 1000, currency: "USD" } });
    const results = await Promise.all(Array.from({ length: 20 }, () => f.repo.reserve(reserveArgs(f.draft, { prices, reservation }))));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(await monthRow(f.orgId)).toMatchObject({ reserved_cost_micros: 1000 });
    // a reservation in another currency is refused (one currency per cost cap)
    expect(await f.repo.reserve(reserveArgs(f.draft, { prices: { ...prices, currency: "BRL" }, reservation }))).toEqual({ ok: false });
    // unpriced: the cost cap does not apply, the allowance does
    const more = await Promise.all(Array.from({ length: 5 }, () => f.repo.reserve(reserveArgs(f.draft))));
    expect(more.every((r) => r.ok)).toBe(true);
    await reconciled(f.orgId);
  });

  it("the cost cap accumulates SETTLED cost too and keeps one currency per month", async () => {
    const prices: TypedPrices = { currency: "USD", inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 1_000_000 };
    const reservation = reservationFor({ estimatedInput: 100, effectiveMaxOutput: 100, maxRetries: 0, prices });
    const f = await freshOrg("cost2", { ...PLAN_TOTAL, allowance: { mode: "TOTAL", total: 100_000 }, perRequestCapPlanning: 1000, costCap: { micros: 450, currency: "USD" } });
    const a = reserveArgs(f.draft, { prices, reservation });
    expect((await f.repo.reserve(a)).ok).toBe(true);
    expect(await f.repo.ledger(SETTLE(a.ledgerId, { inputTokens: 100, outputTokens: 100, costMicros: 200, prices }))).toBe(true);
    const b = reserveArgs(f.draft, { prices, reservation });
    expect((await f.repo.reserve(b)).ok).toBe(true);
    expect(await f.repo.ledger(SETTLE(b.ledgerId, { inputTokens: 100, outputTokens: 100, costMicros: 200, prices }))).toBe(true);
    expect(await monthRow(f.orgId)).toMatchObject({ cost_micros: 400, cost_currency: "USD" });
    expect(await f.repo.reserve(reserveArgs(f.draft, { prices, reservation }))).toEqual({ ok: false }); // 400 + 200 > 450
  });

  it("the per-minute limit blocks the (n+1)-th reserve and releases after the window", async () => {
    const f = await freshOrg("rpm1", { ...PLAN_TOTAL, allowance: { mode: "TOTAL", total: 100_000 }, perRequestCapPlanning: 1000, requestsPerMinute: 3 });
    const results = await Promise.all(Array.from({ length: 6 }, () => f.repo.reserve(reserveArgs(f.draft))));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await f.repo.reserve(reserveArgs(f.draft, { now: at(30_000) }))).toEqual({ ok: false });
    expect((await f.repo.reserve(reserveArgs(f.draft, { now: at(61_000) }))).ok).toBe(true);
  });

  it("a cache hit does not count against the per-minute limit", async () => {
    const f = await freshOrg("rpm2", { ...PLAN_TOTAL, allowance: { mode: "TOTAL", total: 100_000 }, perRequestCapPlanning: 1000, requestsPerMinute: 1 });
    for (let i = 0; i < 4; i += 1) {
      expect(await f.repo.recordCacheHit({ planId: f.draft.planId, revisionId: f.draft.revisionId, task: "PLANNER", ledgerId: id("hit"), requestKey: `${id("run")}:1`, providerKind: "mock", modelId: "mock-ok", now: NOW })).toBe(true);
    }
    expect((await f.repo.reserve(reserveArgs(f.draft))).ok).toBe(true);
    expect(await monthRow(f.orgId)).toMatchObject({ cache_hits: 4, used_input: 0, reserved_input: 100 });
    expect(await n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE organization_id = ?1 AND cache_hit = 1 AND state = 'SETTLED' AND input_tokens = 0 AND output_tokens = 0", f.orgId)).toBe(4);
  });

  it("the gate is re-checked INSIDE the reserve: kill switch, organization disabled, archived plan, per-request cap, no plan", async () => {
    const f = await freshOrg("gate1", { ...PLAN_TOTAL, allowance: { mode: "TOTAL", total: 100_000 }, perRequestCapPlanning: 250, perRequestCapAdjustment: 100 });
    const ok = reserveArgs(f.draft);
    // per-request cap is judged on ONE attempt (200 <= 250), and the adjustments cap is its own
    expect((await f.repo.reserve(ok)).ok).toBe(true);
    expect(await f.repo.reserve(reserveArgs(f.draft, { task: "ADJUSTMENTS" }))).toEqual({ ok: false });
    expect(await f.repo.reserve(reserveArgs(f.draft, { reservation: { ...RES, perAttemptTokens: 251 } }))).toEqual({ ok: false });
    // a retry doubles the reservation but not the per-attempt figure
    expect((await f.repo.reserve(reserveArgs(f.draft, { reservation: reservationFor({ estimatedInput: 100, effectiveMaxOutput: 100, maxRetries: 1, prices: null }) }))).ok).toBe(true);

    await run("UPDATE ai_platform_settings SET kill_switch = 1 WHERE id = 1");
    expect(await f.repo.reserve(reserveArgs(f.draft))).toEqual({ ok: false });
    await run("UPDATE ai_platform_settings SET kill_switch = 0 WHERE id = 1");
    expect((await f.repo.reserve(reserveArgs(f.draft))).ok).toBe(true);

    await run("UPDATE ai_organization_settings SET enabled = 0 WHERE organization_id = ?1", f.orgId);
    expect(await f.repo.reserve(reserveArgs(f.draft))).toEqual({ ok: false });
    await run("UPDATE ai_organization_settings SET enabled = 1 WHERE organization_id = ?1", f.orgId);
    expect((await f.repo.reserve(reserveArgs(f.draft))).ok).toBe(true);

    await run("UPDATE ai_quota_plans SET archived_at = 'x' WHERE id = (SELECT quota_plan_id FROM ai_organization_settings WHERE organization_id = ?1)", f.orgId);
    expect(await f.repo.reserve(reserveArgs(f.draft))).toEqual({ ok: false });
    await run("UPDATE ai_organization_settings SET quota_plan_id = NULL WHERE organization_id = ?1", f.orgId);
    expect(await f.repo.reserve(reserveArgs(f.draft))).toEqual({ ok: false });
    await reconciled(f.orgId);
  });

  it("a plan with allowance 0 or caps 0 never reserves ('IA não incluída no plano')", async () => {
    const f = await freshOrg("zero1", { ...PLAN_TOTAL, allowance: { mode: "TOTAL", total: 0 }, perRequestCapPlanning: 1000 });
    expect(await f.repo.reserve(reserveArgs(f.draft))).toEqual({ ok: false });
    const g = await freshOrg("zero2", { ...PLAN_TOTAL, allowance: { mode: "TOTAL", total: 100_000 }, perRequestCapPlanning: 0 });
    expect(await g.repo.reserve(reserveArgs(g.draft))).toEqual({ ok: false });
    expect(await n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE organization_id IN (?1, ?2)", f.orgId, g.orgId)).toBe(0);
    const snap = await f.repo.gateState(f.draft.planId, f.draft.revisionId, "PLANNER", NOW);
    expect(evaluateAiGate({ ...snap.state, envKill: false, secretsKeyOk: true, mockEnabled: true, circuitOpen: false }, "PLANNER")).toBe("ALLOWANCE_ZERO");
  });

  it("an organization with no row at all has AI off", async () => {
    const snap = await ai("tech-b", "org-b").gateState(D.b.planId, D.b.revisionId, "PLANNER", NOW);
    expect(snap.reach).toBe(true);
    expect(snap.state.org?.enabled ?? false).toBe(false);
    expect(evaluateAiGate({ ...snap.state, envKill: false, secretsKeyOk: true, mockEnabled: true, circuitOpen: false }, "PLANNER")).toBe("ORG_DISABLED");
    expect(await ai("tech-b", "org-b").reserve(reserveArgs(D.b))).toEqual({ ok: false });
  });

  it("the professional sees tokens used and remaining, and no cost field at all", async () => {
    const usage = await ai().usageForProfessional(NOW);
    expect(usage.allowance).toEqual({ mode: "TOTAL", total: 1000 });
    expect(Object.keys(usage).sort()).toEqual(["allowance", "month", "remaining", "used"]);
    expect(JSON.stringify(usage).toLowerCase()).not.toContain("cost");
    const m = (await monthRow())!;
    expect(usage.used).toEqual({ input: Number(m.used_input), output: Number(m.used_output) });
    expect(usage.remaining).toEqual({ mode: "TOTAL", total: Math.max(0, 1000 - Number(m.used_input) - Number(m.used_output) - Number(m.reserved_input) - Number(m.reserved_output)) });
    expect((await ai("tech-b", "org-b").usageForProfessional(NOW)).allowance).toBeNull();
  });

  it("the manager's usage overview equals the ledger sums", async () => {
    const rows = await gestor().usage(MONTH);
    const ledger = await all<{ organization_id: string; task: string; i: number; o: number; req: number; hits: number }>(
      `SELECT organization_id, task, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o,
              SUM(CASE WHEN cache_hit = 0 AND state IN ('SETTLED','CHARGED_UNKNOWN') THEN 1 ELSE 0 END) AS req, SUM(cache_hit) AS hits
         FROM ai_usage_ledger WHERE month = ?1 GROUP BY organization_id, task`, MONTH);
    expect(rows).toHaveLength(ledger.length);
    for (const l of ledger) {
      expect(rows.find((r) => r.organizationId === l.organization_id && r.task === l.task)).toMatchObject({ inputTokens: l.i, outputTokens: l.o, requests: l.req, cacheHits: l.hits });
    }
    // no priced row in org-a/PLANNER except the one priced test above: unpriced groups show null cost, never 0
    expect(rows.some((r) => r.costMicros === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("cache: tenant segregated, with TTL", () => {
  const key = (c: string) => c.repeat(64).slice(0, 64);
  const put = (d: Draft, cacheKey: string, over: Record<string, unknown> = {}, who = "tech-a", organizationId = "org-a") =>
    ai(who, organizationId).cachePut({
      planId: d.planId, revisionId: d.revisionId, cacheKey, task: "PLANNER", providerKind: "mock", modelId: "mock-ok", promptVersion: "planner-2026.11.1",
      responseJson: JSON.stringify({ ok: true, who: "A" }), responseHash: "9".repeat(64), inputTokens: 10, outputTokens: 5, now: NOW, expiresAt: at(86_400_000), ...over,
    });

  it("miss, then hit (the hit counter grows), then expiry", async () => {
    expect(await ai().cacheGet(D.a1.planId, D.a1.revisionId, key("a"), NOW)).toBeNull();
    await put(D.a1, key("a"));
    const hit = await ai().cacheGet(D.a1.planId, D.a1.revisionId, key("a"), at(1000));
    expect(hit).toMatchObject({ responseJson: JSON.stringify({ ok: true, who: "A" }), responseHash: "9".repeat(64), providerKind: "mock", modelId: "mock-ok", promptVersion: "planner-2026.11.1", hits: 1 });
    expect((await ai().cacheGet(D.a1.planId, D.a1.revisionId, key("a"), at(2000)))!.hits).toBe(2);
    expect(await ai().cacheGet(D.a1.planId, D.a1.revisionId, key("a"), at(86_400_000))).toBeNull(); // expires_at > now is required
    expect(await ai().cacheGet(D.a1.planId, D.a1.revisionId, key("a"), at(86_400_001))).toBeNull();
    expect(await ai().cacheGet(D.a1.planId, D.a1.revisionId, key("b"), NOW)).toBeNull();
  });

  it("the cache row holds the student id, a hash and the validated response — never a name, e-mail or prompt", async () => {
    const row = (await first<Record<string, unknown>>("SELECT * FROM ai_planner_cache WHERE cache_key = ?1", key("a")))!;
    expect(Object.keys(row).sort()).toEqual([
      "cache_key", "created_at", "expires_at", "hits", "input_tokens", "last_hit_at", "model_id", "organization_id", "output_tokens", "prompt_version", "provider_kind",
      "response_hash", "response_json", "student_id", "task",
    ]);
    expect(row.student_id).toBe("st-1");
    expect(row.cache_key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rewriting an expired key replaces the entry", async () => {
    await put(D.a1, key("c"), { responseJson: JSON.stringify({ v: 1 }), expiresAt: at(1000) });
    expect(await ai().cacheGet(D.a1.planId, D.a1.revisionId, key("c"), at(2000))).toBeNull();
    await put(D.a1, key("c"), { responseJson: JSON.stringify({ v: 2 }), now: at(2000), expiresAt: at(90_000) });
    expect(await ai().cacheGet(D.a1.planId, D.a1.revisionId, key("c"), at(3000))).toMatchObject({ responseJson: JSON.stringify({ v: 2 }), hits: 1 });
  });

  it("two organizations may hold the SAME cache key without seeing each other", async () => {
    await put(D.b, key("a"), { responseJson: JSON.stringify({ ok: true, who: "B" }) }, "tech-b", "org-b");
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE cache_key = ?1", key("a"))).toBe(2);
    expect((await ai("tech-b", "org-b").cacheGet(D.b.planId, D.b.revisionId, key("a"), at(1000)))!.responseJson).toContain('"B"');
    expect((await ai().cacheGet(D.a1.planId, D.a1.revisionId, key("a"), at(1000)))!.responseJson).toContain('"A"'); // each organization reads its own row
    // org B cannot read or write through org A's revision
    expect(await ai("tech-b", "org-b").cacheGet(D.a1.planId, D.a1.revisionId, key("c"), at(3000))).toBeNull();
    await put(D.a1, key("d"), {}, "tech-b", "org-b");
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE cache_key = ?1", key("d"))).toBe(0);
    await put(D.a1, key("d"), {}, "tech-a2", "org-a"); // no assignment to st-1
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE cache_key = ?1", key("d"))).toBe(0);
  });

  it("a put purges at most 50 expired rows of ITS organization in the same batch", async () => {
    for (let i = 0; i < 60; i += 1) {
      await run(
        "INSERT INTO ai_planner_cache(organization_id,cache_key,student_id,task,provider_kind,model_id,prompt_version,response_json,response_hash,created_at,expires_at) VALUES ('org-a',?1,'st-1','PLANNER','mock','m','p','{}',?2,'x',?3)",
        `e${String(i).padStart(2, "0")}`.padEnd(64, "0"), "8".repeat(64), "2026-01-01T00:00:00.000Z",
      );
    }
    const orgBBefore = await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-b'");
    await run("INSERT INTO ai_planner_cache(organization_id,cache_key,student_id,task,provider_kind,model_id,prompt_version,response_json,response_hash,created_at,expires_at) VALUES ('org-b',?1,'st-b','PLANNER','mock','m','p','{}',?2,'x','2026-01-01T00:00:00.000Z')", "f".repeat(64), "8".repeat(64));
    await put(D.a1, key("g"));
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-a' AND expires_at <= ?1", NOW.toISOString())).toBe(10);
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-b'")).toBe(orgBBefore + 1); // untouched
    await put(D.a1, key("h"));
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-a' AND expires_at <= ?1", NOW.toISOString())).toBe(0);
  });

  it("deletion by student removes cache and payloads of that student only, in that organization only", async () => {
    await put(D.a3, key("s"));
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE student_id = 'st-2'")).toBe(1);
    const stOneBefore = await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE student_id = 'st-1'");
    expect(await ai("stranger").eraseStudentAi("st-2")).toEqual({ cache: 0, payloads: 0 });
    expect(await ai("tech-b", "org-b").eraseStudentAi("st-2")).toEqual({ cache: 0, payloads: 0 });
    expect(await ai().eraseStudentAi("st-2")).toEqual({ cache: 1, payloads: 0 });
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE student_id = 'st-2'")).toBe(0);
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE student_id = 'st-1'")).toBe(stOneBefore);
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-b'")).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("planning runs: idempotency, single flight, append-only", () => {
  const finish = (d: Draft, r: RunStartInput, over: Record<string, unknown> = {}) => ({
    runId: r.runId, planId: d.planId, revisionId: d.revisionId, attempt: 1, status: "SUCCEEDED" as const, failureCode: null, cacheHit: false,
    responseHash: "b".repeat(64), blueprintHash: "e".repeat(64), usageJson: JSON.stringify({ in: 1, out: 2 }), ledgerId: null, now: at(500), ...over,
  });

  it("starts a RUNNING run; the same key is a duplicate; a terminal run does not block the cache key", async () => {
    const r = runArgs(D.a2);
    expect(await ai().runStart(r)).toEqual({ ok: true });
    expect(await ai().runByKey(D.a2.planId, D.a2.revisionId, r.idempotencyKey)).toMatchObject({ id: r.runId, status: "RUNNING", attempt: 1, mode: "AI", cacheKey: r.cacheKey, cacheHit: false, requestHash: r.requestHash });
    expect(await ai().runStart({ ...runArgs(D.a2), idempotencyKey: r.idempotencyKey })).toEqual({ ok: false, reason: "duplicate_key" });
    // a different key with the same context while RUNNING: single flight
    expect(await ai().runStart({ ...runArgs(D.a2), cacheKey: r.cacheKey })).toEqual({ ok: false, reason: "in_flight" });
    expect(await ai().runningByCacheKey(D.a2.planId, D.a2.revisionId, r.cacheKey!)).toMatchObject({ id: r.runId });
    expect(await ai().latestRun(D.a2.planId, D.a2.revisionId)).toMatchObject({ id: r.runId });

    expect(await ai().finishRun({ ledger: null, run: finish(D.a2, r) })).toBe(true);
    expect(await ai().runById(D.a2.planId, D.a2.revisionId, r.runId)).toMatchObject({ status: "SUCCEEDED", responseHash: "b".repeat(64), blueprintHash: "e".repeat(64), finishedAt: at(500).toISOString() });
    // finished: the key is free for a new run, but its idempotency key stays taken
    const again = { ...runArgs(D.a2), cacheKey: r.cacheKey };
    expect(await ai().runStart(again)).toEqual({ ok: true });
    expect(await ai().finishRun({ ledger: null, run: finish(D.a2, again, { status: "FAILED", failureCode: "timeout" }) })).toBe(true);
    // finishing twice is a no-op
    expect(await ai().finishRun({ ledger: null, run: finish(D.a2, again, { status: "SUCCEEDED" }) })).toBe(false);
    expect(await ai().runById(D.a2.planId, D.a2.revisionId, again.runId)).toMatchObject({ status: "FAILED", failureCode: "timeout" });
  });

  it("two organizations may run the same cache key; the same idempotency key on two revisions is fine", async () => {
    const shared = "7".repeat(64);
    const a = runArgs(D.a1, { cacheKey: shared });
    const b = runArgs(D.b, { cacheKey: shared });
    expect(await ai().runStart(a)).toEqual({ ok: true });
    expect(await ai("tech-b", "org-b").runStart(b)).toEqual({ ok: true });
    expect(await ai().runStart(runArgs(D.a3, { idempotencyKey: a.idempotencyKey }))).toEqual({ ok: true });
    await ai().finishRun({ ledger: null, run: finish(D.a1, a) });
    await ai("tech-b", "org-b").finishRun({ ledger: null, run: finish(D.b, b) });
    await ai().finishRun({ ledger: null, run: finish(D.a3, runArgs(D.a3)) }); // wrong run id: no effect
    const stuck = (await first<{ run_id: string }>("SELECT id AS run_id FROM planning_runs WHERE revision_id = ?1 AND status = 'RUNNING'", D.a3.revisionId))!;
    await ai().finishRun({ ledger: null, run: finish(D.a3, { runId: stuck.run_id } as RunStartInput) });
  });

  it("at most 2 runs are RUNNING per organization", async () => {
    const f = [runArgs(D.a1), runArgs(D.a1), runArgs(D.a1)];
    expect(await ai().runStart(f[0])).toEqual({ ok: true });
    expect(await ai().runStart(f[1])).toEqual({ ok: true });
    expect(await ai().runStart(f[2])).toEqual({ ok: false, reason: "busy" });
    for (const r of f.slice(0, 2)) await ai().finishRun({ ledger: null, run: finish(D.a1, r, { status: "FAILED", failureCode: "x" }) });
    expect(await ai().runStart(f[2])).toEqual({ ok: true });
    await ai().finishRun({ ledger: null, run: finish(D.a1, f[2], { status: "FAILED", failureCode: "x" }) });
  });

  it("a run needs reach to the DRAFT revision: other organization, no assignment and a non-draft revision are refused", async () => {
    expect(await ai("tech-b", "org-b").runStart(runArgs(D.a1))).toEqual({ ok: false, reason: "not_found" });
    expect(await ai("tech-a2").runStart(runArgs(D.a1))).toEqual({ ok: false, reason: "not_found" });
    expect(await ai("tech-off").runStart(runArgs(D.a1))).toEqual({ ok: false, reason: "not_found" });
    const frozen = await newDraft("st-2");
    await run("UPDATE plan_revisions SET state = 'READY' WHERE id = ?1", frozen.revisionId);
    expect(await ai().runStart(runArgs(frozen))).toEqual({ ok: false, reason: "not_found" });
    expect(await ai("tech-b", "org-b").runById(D.a1.planId, D.a1.revisionId, "x")).toBeNull();
  });

  it("2 parallel starts with the same idempotency key: exactly one wins", async () => {
    const base = runArgs(D.a3);
    const results = await Promise.all([ai().runStart({ ...base, runId: id("run"), cacheKey: "1".repeat(64) }), ai().runStart({ ...base, runId: id("run"), cacheKey: "2".repeat(64) })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "duplicate_key" });
    const winner = (await ai().runByKey(D.a3.planId, D.a3.revisionId, base.idempotencyKey))!;
    await ai().finishRun({ ledger: null, run: finish(D.a3, { runId: winner.id } as RunStartInput, { status: "FAILED", failureCode: "x" }) });
  });

  it("2 parallel starts with different keys and the same context: single flight lets one through", async () => {
    const shared = "3".repeat(64);
    const results = await Promise.all([ai().runStart(runArgs(D.a1, { cacheKey: shared })), ai().runStart(runArgs(D.a1, { cacheKey: shared }))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "in_flight" });
    const blocker = (await ai().runningByCacheKey(D.a1.planId, D.a1.revisionId, shared))!;
    await ai().finishRun({ ledger: null, run: finish(D.a1, { runId: blocker.id } as RunStartInput, { status: "FAILED", failureCode: "x" }) });
  });

  it("the table enforces the transitions: only RUNNING -> terminal, identity columns frozen, no delete", async () => {
    const r = runArgs(D.a2);
    await ai().runStart(r);
    await expect(run("UPDATE planning_runs SET idempotency_key = ?2 WHERE id = ?1", r.runId, "z".repeat(20))).rejects.toThrow(/PLANNING_RUN_IMMUTABLE/);
    await expect(run("UPDATE planning_runs SET request_hash = ?2 WHERE id = ?1", r.runId, "z".repeat(64))).rejects.toThrow(/PLANNING_RUN_IMMUTABLE/);
    await expect(run("UPDATE planning_runs SET mode = 'RULES' WHERE id = ?1", r.runId)).rejects.toThrow(/PLANNING_RUN_IMMUTABLE/);
    await expect(run("DELETE FROM planning_runs WHERE id = ?1", r.runId)).rejects.toThrow(/PLANNING_RUN_APPEND_ONLY/);
    await ai().finishRun({ ledger: null, run: finish(D.a2, r) });
    await expect(run("UPDATE planning_runs SET status = 'RUNNING' WHERE id = ?1", r.runId)).rejects.toThrow(/PLANNING_RUN_IMMUTABLE/);
    await expect(run("UPDATE planning_runs SET failure_code = 'x' WHERE id = ?1", r.runId)).rejects.toThrow(/PLANNING_RUN_IMMUTABLE/);
  });

  it("finishing with the payload stores the validated output for the plan's own student and nothing else", async () => {
    const f = await newDraft("st-2");
    const r = runArgs(f);
    await ai().runStart(r);
    const ok = await ai().finishRun({
      ledger: null, payloadJson: JSON.stringify({ blueprint: true }),
      cache: { planId: f.planId, revisionId: f.revisionId, cacheKey: r.cacheKey!, task: "PLANNER", providerKind: "mock", modelId: "mock-ok", promptVersion: "p", responseJson: "{}", responseHash: "a".repeat(64), inputTokens: 1, outputTokens: 1, now: NOW, expiresAt: at(1000) },
      run: finish(f, r),
    });
    expect(ok).toBe(true);
    expect(await ai().payloadOf(f.planId, f.revisionId, r.runId)).toBe(JSON.stringify({ blueprint: true }));
    expect(await first("SELECT student_id FROM planning_run_payloads WHERE run_id = ?1", r.runId)).toEqual({ student_id: "st-2" });
    expect(await n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE cache_key = ?1", r.cacheKey)).toBe(1);
    // org B and a user without reach cannot read it
    expect(await ai("tech-b", "org-b").payloadOf(f.planId, f.revisionId, r.runId)).toBeNull();
    expect(await ai("tech-a2").payloadOf(D.a1.planId, D.a1.revisionId, r.runId)).toBeNull();
    // append-only; the student trigger rejects a foreign student
    await expect(run("UPDATE planning_run_payloads SET blueprint_json = '{}' WHERE run_id = ?1", r.runId)).rejects.toThrow(/PLANNING_APPEND_ONLY/);
    await expect(run("INSERT INTO planning_run_payloads(run_id,organization_id,student_id,blueprint_json,created_at) VALUES (?1,'org-a','st-1','{}','x')", id("none"))).rejects.toThrow();
    const r2 = runArgs(f);
    await ai().runStart(r2);
    await expect(run("INSERT INTO planning_run_payloads(run_id,organization_id,student_id,blueprint_json,created_at) VALUES (?1,'org-a','st-1','{}','x')", r2.runId)).rejects.toThrow(/PLANNING_PAYLOAD_STUDENT_INVALID/);
    await ai().finishRun({ ledger: null, run: finish(f, r2, { status: "FAILED", failureCode: "x" }) });
    // a run that FAILED never stores a payload even if the caller passes one
    const r3 = runArgs(f);
    await ai().runStart(r3);
    await ai().finishRun({ ledger: null, payloadJson: "{}", run: finish(f, r3, { status: "FAILED", failureCode: "x" }) });
    expect(await n("SELECT COUNT(*) AS n FROM planning_run_payloads WHERE run_id = ?1", r3.runId)).toBe(0);
    // erasing the student removes the payload and the cache but keeps the run row
    expect(await ai().eraseStudentAi("st-2")).toMatchObject({ payloads: 1 });
    expect(await ai().payloadOf(f.planId, f.revisionId, r.runId)).toBeNull();
    expect(await ai().runById(f.planId, f.revisionId, r.runId)).toMatchObject({ status: "SUCCEEDED" });
  });

  it("blueprint acceptances are append-only", async () => {
    const r = (await first<{ id: string }>("SELECT id FROM planning_runs WHERE revision_id = ?1 AND status = 'SUCCEEDED' LIMIT 1", D.a2.revisionId))!;
    await run(
      `INSERT INTO blueprint_acceptances(id,organization_id,plan_id,revision_id,run_id,idempotency_key,request_hash,strategy_id,split_family,final_json,acceptance_hash,structure_fingerprint,base_content_version,accepted_by_user_id,accepted_at)
       VALUES ('acc-1','org-a',?1,?2,?3,?4,?5,'S1','UPPER_LOWER','{}',?5,'f',1,'tech-a','x')`,
      D.a2.planId, D.a2.revisionId, r.id, "acceptkey-0123456789", "a".repeat(64),
    );
    await expect(run("UPDATE blueprint_acceptances SET strategy_id = 'S2' WHERE id = 'acc-1'")).rejects.toThrow(/ACCEPTANCE_APPEND_ONLY/);
    await expect(run("DELETE FROM blueprint_acceptances WHERE id = 'acc-1'")).rejects.toThrow(/ACCEPTANCE_APPEND_ONLY/);
    await expect(run(
      `INSERT INTO blueprint_acceptances(id,organization_id,plan_id,revision_id,run_id,idempotency_key,request_hash,strategy_id,split_family,final_json,acceptance_hash,structure_fingerprint,base_content_version,accepted_by_user_id,accepted_at)
       VALUES ('acc-2','org-a',?1,?2,?3,?4,?5,'S1','UPPER_LOWER','{}',?5,'f',1,'tech-a','x')`,
      D.a2.planId, D.a2.revisionId, r.id, "acceptkey-0123456789", "a".repeat(64),
    )).rejects.toThrow();
  });
});

describe("takeover of a stale run", () => {
  beforeAll(async () => {
    await run("UPDATE ai_quota_plans SET monthly_total_tokens = 100000 WHERE id = ?1", PLAN_ID);
  });
  async function runningWithLedger(d: Draft) {
    const r = runArgs(d);
    await ai().runStart(r);
    const res = reserveArgs(d, { requestKey: `${r.runId}:1` });
    expect((await ai().reserve(res)).ok).toBe(true);
    return { r, res };
  }

  it("charges the old row as unknown, moves the attempt and reserves `${runId}:${attempt + 1}` in ONE batch, with no waiting window", async () => {
    const { r, res } = await runningWithLedger(D.a1);
    const before = (await monthRow())!;
    const later = at(STALE + 1000);
    const newLedger = id("led");
    const outcome = await ai().takeoverRun({
      runId: r.runId, expectedStartedAt: r.now.toISOString(), expectedAttempt: 1, oldLedgerId: res.ledgerId, oldInputEstimate: 100,
      reserve: { ...reserveArgs(D.a1, { now: later }), newLedgerId: newLedger },
    });
    expect(outcome).toEqual({ ok: true, ledgerId: newLedger, attempt: 2 });
    expect(await ledgerRow(res.ledgerId)).toMatchObject({ state: "CHARGED_UNKNOWN", input_tokens: 100, output_tokens: 0, error_code: "STALE" });
    expect(await ledgerRow(newLedger)).toMatchObject({ state: "RESERVED", request_key: `${r.runId}:2` });
    expect(await ai().runById(D.a1.planId, D.a1.revisionId, r.runId)).toMatchObject({ attempt: 2, status: "RUNNING", startedAt: later.toISOString() });
    const after = (await monthRow())!;
    expect(after.used_input).toBe(Number(before.used_input) + 100);
    expect(after.reserved_input).toBe(Number(before.reserved_input) - 100 + 100); // old released, new taken
    await reconciled();
    // the old holder's late finish is a no-op (the attempt moved)
    expect(await ai().finishRun({ ledger: { kind: "RELEASE", ledgerId: res.ledgerId, errorCode: null, countAsFailure: false, now: later }, run: { runId: r.runId, planId: D.a1.planId, revisionId: D.a1.revisionId, attempt: 1, status: "SUCCEEDED", failureCode: null, cacheHit: false, responseHash: null, blueprintHash: null, usageJson: null, ledgerId: res.ledgerId, now: later }, payloadJson: "{}" })).toBe(false);
    expect(await ai().runById(D.a1.planId, D.a1.revisionId, r.runId)).toMatchObject({ status: "RUNNING", attempt: 2 });
    expect(await n("SELECT COUNT(*) AS n FROM planning_run_payloads WHERE run_id = ?1", r.runId)).toBe(0);
    // the new holder finishes
    expect(await ai().finishRun({ ledger: SETTLE(newLedger), run: { runId: r.runId, planId: D.a1.planId, revisionId: D.a1.revisionId, attempt: 2, status: "SUCCEEDED", failureCode: null, cacheHit: false, responseHash: null, blueprintHash: null, usageJson: null, ledgerId: newLedger, now: later } })).toBe(true);
    await reconciled();
  });

  it("two concurrent takeovers: exactly one wins and only one new reservation exists", async () => {
    const { r, res } = await runningWithLedger(D.a1);
    const later = at(STALE + 2000);
    const take = () => ai().takeoverRun({
      runId: r.runId, expectedStartedAt: r.now.toISOString(), expectedAttempt: 1, oldLedgerId: res.ledgerId, oldInputEstimate: 100,
      reserve: { ...reserveArgs(D.a1, { now: later }), newLedgerId: id("led") },
    });
    const results = await Promise.all([take(), take()]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(await n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE request_key = ?1", `${r.runId}:2`)).toBe(1);
    expect(await ledgerRow(res.ledgerId)).toMatchObject({ state: "CHARGED_UNKNOWN" });
    await reconciled();
    const winner = (await ai().runById(D.a1.planId, D.a1.revisionId, r.runId))!;
    expect(winner.attempt).toBe(2);
    await ai().finishRun({ ledger: { kind: "RELEASE", ledgerId: (await first<{ id: string }>("SELECT id FROM ai_usage_ledger WHERE request_key = ?1", `${r.runId}:2`))!.id, errorCode: null, countAsFailure: false, now: later }, run: { runId: r.runId, planId: D.a1.planId, revisionId: D.a1.revisionId, attempt: 2, status: "FAILED", failureCode: "x", cacheHit: false, responseHash: null, blueprintHash: null, usageJson: null, ledgerId: null, now: later } });
    await reconciled();
  });

  it("a takeover whose reserve is refused (allowance) still charges the old row but does not take the run's new reservation", async () => {
    const { r, res } = await runningWithLedger(D.a1);
    await run("UPDATE ai_usage_month SET used_input = used_input + 100000 WHERE organization_id = 'org-a' AND month = ?1", MONTH);
    const outcome = await ai().takeoverRun({
      runId: r.runId, expectedStartedAt: r.now.toISOString(), expectedAttempt: 1, oldLedgerId: res.ledgerId, oldInputEstimate: 100,
      reserve: { ...reserveArgs(D.a1, { now: at(STALE + 3000) }), newLedgerId: id("led") },
    });
    expect(outcome.ok).toBe(false);
    await run("UPDATE ai_usage_month SET used_input = used_input - 100000 WHERE organization_id = 'org-a' AND month = ?1", MONTH);
    await ai().expireStaleRun({ planId: D.a1.planId, revisionId: D.a1.revisionId, runId: r.runId, expectedStartedAt: (await ai().runById(D.a1.planId, D.a1.revisionId, r.runId))!.startedAt, oldLedgerId: null, oldInputEstimate: 0, now: at(STALE + 4000) });
  });

  it("expireStaleRun frees a single-flight blocker of ANOTHER idempotency key: ledger charged as unknown, run FAILED/STALE", async () => {
    const { r, res } = await runningWithLedger(D.a1);
    const later = at(STALE + 5000);
    // a wrong expected start does nothing
    expect(await ai().expireStaleRun({ planId: D.a1.planId, revisionId: D.a1.revisionId, runId: r.runId, expectedStartedAt: "1999-01-01T00:00:00.000Z", oldLedgerId: res.ledgerId, oldInputEstimate: 100, now: later })).toBe(false);
    expect(await ledgerRow(res.ledgerId)).toMatchObject({ state: "CHARGED_UNKNOWN" }); // the ledger flip is independent of the run CAS (design §3.6 a)
    await reconciled();
    expect(await ai().expireStaleRun({ planId: D.a1.planId, revisionId: D.a1.revisionId, runId: r.runId, expectedStartedAt: r.now.toISOString(), oldLedgerId: null, oldInputEstimate: 0, now: later })).toBe(true);
    expect(await ai().runById(D.a1.planId, D.a1.revisionId, r.runId)).toMatchObject({ status: "FAILED", failureCode: "STALE" });
    // the cache key is free again
    expect(await ai().runStart(runArgs(D.a1, { cacheKey: r.cacheKey }))).toEqual({ ok: true });
    const next = (await ai().runningByCacheKey(D.a1.planId, D.a1.revisionId, r.cacheKey!))!;
    await ai().finishRun({ ledger: null, run: { runId: next.id, planId: D.a1.planId, revisionId: D.a1.revisionId, attempt: 1, status: "FAILED", failureCode: "x", cacheHit: false, responseHash: null, blueprintHash: null, usageJson: null, ledgerId: null, now: later } });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("circuit breaker (per provider and model)", () => {
  const M = "model-circuit-1";
  const fail = (code: "SERVER_ERROR" | "NETWORK" | "TIMEOUT" | "RATE_LIMIT" | "INVALID_JSON", t: Date, model = M) => ai().circuitFailure("openai", model, code, t);
  const state = (model = M) => first<Record<string, unknown>>("SELECT * FROM ai_circuit_state WHERE provider_kind = 'openai' AND model_id = ?1", model);

  it("5 consecutive availability failures open it; 429s and model-quality failures never do", async () => {
    for (let i = 0; i < 20; i += 1) await fail("RATE_LIMIT", at(i * 100), "rl-model");
    for (let i = 0; i < 20; i += 1) await fail("INVALID_JSON", at(i * 100), "rl-model");
    expect(await state("rl-model")).toBeNull();
    expect((await ai().circuitCheck("openai", "rl-model", at(5000), STALE)).decision).toBe("ALLOW");

    for (let i = 0; i < 4; i += 1) await fail("SERVER_ERROR", at(i * 1000));
    expect(await state()).toMatchObject({ state: "CLOSED", consecutive_failures: 4 });
    expect((await ai().circuitCheck("openai", M, at(4000), STALE)).allowed).toBe(true);
    await fail("TIMEOUT", at(4000));
    expect(await state()).toMatchObject({ state: "OPEN", consecutive_failures: 5, opened_at: at(4000).toISOString() });
    expect(await ai().circuitCheck("openai", M, at(5000), STALE)).toEqual({ decision: "BLOCK", allowed: false, probe: false });
    // the circuit is per (provider, model)
    expect((await ai().circuitCheck("openai", "other-model", at(5000), STALE)).allowed).toBe(true);
    expect((await ai().circuitCheck("anthropic", M, at(5000), STALE)).allowed).toBe(true);
  });

  it("failures older than the 120 s window start the count again", async () => {
    for (let i = 0; i < 3; i += 1) await fail("NETWORK", at(i * 1000), "win-model");
    await fail("NETWORK", at(130_000), "win-model");
    expect(await state("win-model")).toMatchObject({ state: "CLOSED", consecutive_failures: 1 });
  });

  it("after 60 s exactly ONE of two simultaneous callers wins the probe; success closes the circuit", async () => {
    const t = at(4000 + CIRCUIT_OPEN_MS);
    const results = await Promise.all([ai().circuitCheck("openai", M, t, STALE), ai().circuitCheck("openai", M, t, STALE)]);
    expect(results.filter((r) => r.probe)).toHaveLength(1);
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
    expect(await state()).toMatchObject({ state: "HALF_OPEN", probe_started_at: t.toISOString() });
    // while the probe is fresh nobody else passes
    expect((await ai().circuitCheck("openai", M, at(4000 + CIRCUIT_OPEN_MS + 1000), STALE)).allowed).toBe(false);
    await ai().circuitSuccess("openai", M, at(70_000));
    expect(await state()).toMatchObject({ state: "CLOSED", consecutive_failures: 0, first_failure_at: null, opened_at: null, probe_started_at: null });
    expect((await ai().circuitCheck("openai", M, at(71_000), STALE)).decision).toBe("ALLOW");
  });

  it("a failed probe re-opens at once; a crashed (stale) probe is re-claimed by exactly one caller", async () => {
    for (let i = 0; i < 5; i += 1) await fail("SERVER_ERROR", at(100_000 + i * 100), "probe-model");
    expect(await state("probe-model")).toMatchObject({ state: "OPEN" });
    const t1 = at(100_400 + CIRCUIT_OPEN_MS);
    expect((await ai().circuitCheck("openai", "probe-model", t1, STALE)).probe).toBe(true);
    await fail("SERVER_ERROR", at(100_500 + CIRCUIT_OPEN_MS), "probe-model");
    expect(await state("probe-model")).toMatchObject({ state: "OPEN", opened_at: at(100_500 + CIRCUIT_OPEN_MS).toISOString(), probe_started_at: null });
    // claim a probe, then let it go stale
    const t2 = at(100_500 + 2 * CIRCUIT_OPEN_MS);
    expect((await ai().circuitCheck("openai", "probe-model", t2, STALE)).probe).toBe(true);
    const crashed = at(100_500 + 2 * CIRCUIT_OPEN_MS + STALE);
    const results = await Promise.all([ai().circuitCheck("openai", "probe-model", crashed, STALE), ai().circuitCheck("openai", "probe-model", crashed, STALE)]);
    expect(results.filter((r) => r.probe)).toHaveLength(1);
    expect(await state("probe-model")).toMatchObject({ state: "HALF_OPEN", probe_started_at: crashed.toISOString() });
  });

  it("only an active member may move or read the circuit", async () => {
    await ai("stranger").circuitSuccess("openai", M, NOW);
    await ai("stranger").circuitFailure("openai", "stranger-model", "SERVER_ERROR", NOW);
    expect(await state("stranger-model")).toBeNull();
    expect((await ai("stranger").circuitCheck("openai", M, NOW, STALE)).decision).toBe("ALLOW"); // no row visible => nothing to enforce, and nothing leaked
  });
});

describe("no secret anywhere", () => {
  it("the canary key and its ciphertext are in no table except the single ciphertext column", async () => {
    const tables = (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'ai_%' OR name LIKE 'planning_%' OR name LIKE 'blueprint_%' OR name = 'access_audit_events')")).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["ai_usage_ledger", "ai_planner_cache", "planning_runs", "ai_provider_connections", "access_audit_events"]));
    for (const table of tables) {
      const dump = JSON.stringify(await all(`SELECT * FROM ${table}`));
      expect(dump, table).not.toContain(KEY);
      expect(dump, table).not.toContain("CANARY");
    }
  });
});
