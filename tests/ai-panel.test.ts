import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlannerEnv, KEY, SECRETS_KEY, type PlannerEnv } from "./helpers/ai-planner-env";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const session = vi.hoisted(() => ({ user: "g1", db: null as unknown }));
// What the real guard does: an active platform manager gets { db, context }; anyone else is redirected away (here: it throws).
vi.mock("@/modules/auth/server", async () => {
  const { isPlatformAdmin } = await import("@/db/platform");
  return {
    requirePlatformAdmin: async () => {
      const db = session.db as import("@cloudflare/workers-types").D1Database;
      if (!(await isPlatformAdmin(db, session.user))) throw new Error("NEXT_REDIRECT");
      return { db, context: { userId: session.user } };
    },
  };
});

import { aiPlatformFor } from "@/db/ai-platform";
import {
  archivePlan, connectProvider, removeProvider, savePlan, saveTask, setKillSwitch, setOrganizationAi, testProviderConnection,
} from "@/modules/gestor/ai-actions";
import { gestorAi, MODEL_TEST_INTERVAL_MS } from "@/modules/gestor/ai-service";
import { resolveAiEnv } from "@/modules/prescricao/planejador/config";
import { AI_ORG_ACK_VERSION } from "@/modules/prescricao/planejador/copy";
import type { TaskFormValues, PlanFormValues } from "@/modules/gestor/ai-view";

// The gestor panel's server side (sub-stage 1.4): actions, service and repositories on a real local D1 with the real migrations. The session
// comes from the server guard (mocked as the real one behaves), the environment from process.env (the real reader), providers from a fake
// `fetch`. Nothing reaches a network; the key below is a canary that must appear nowhere but encrypted in the one ciphertext column.
let t: PlannerEnv;
const CANARY = KEY;
const as = (user: string) => { session.user = user; };
beforeAll(async () => {
  t = await createPlannerEnv("ai-panel-tests");
  session.db = t.db;
  // g2: a manager WITHOUT two-factor; g3: a manager whose access was revoked
  await t.db.batch([
    t.db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES ('g2','g2','g2@example.test',0,0),('g3','g3','g3@example.test',0,0)"),
    t.db.prepare("INSERT INTO users(id) VALUES ('g2'),('g3')"),
    t.db.prepare("INSERT INTO platform_admins(user_id, created_at) VALUES ('g2','2026-10-01T00:00:00Z'),('g3','2026-10-01T00:00:00Z')"),
    t.db.prepare("UPDATE platform_admins SET revoked_at = '2026-10-02T00:00:00Z' WHERE user_id = 'g3'"),
  ]);
});
afterAll(async () => {
  await t?.dispose();
});
afterEach(() => {
  vi.unstubAllEnvs();
  as("g1");
});
const secretsOn = () => vi.stubEnv("AI_SECRETS_KEY", SECRETS_KEY);
const everything = async () => JSON.stringify(await Promise.all(["auth_user", "access_audit_events", "ai_provider_connections", "ai_task_settings", "ai_quota_plans", "ai_organization_settings", "ai_platform_settings"].map((table) => t.all(`SELECT * FROM ${table}`))));
const count = (table: string) => t.n(`SELECT COUNT(*) AS n FROM ${table}`);
const auditActions = async () => (await t.all<{ action: string; subject_id: string; actor_user_id: string }>("SELECT action, subject_id, actor_user_id FROM access_audit_events WHERE action LIKE 'AI_%' ORDER BY rowid")).map((r) => `${r.action}:${r.subject_id}`);

const taskForm = (over: Partial<TaskFormValues> = {}): TaskFormValues => ({
  enabled: true, providerKind: "mock", modelId: "mock-ok", maxInputTokens: "12000", maxOutputTokens: "6144", timeoutSeconds: "25", maxRetries: "1", currency: "USD",
  priceInput: "", priceOutput: "", sendSystemExerciseNames: false, ...over,
});
const planForm = (over: Partial<PlanFormValues> = {}): PlanFormValues => ({
  name: "Essencial", mode: "TOTAL", total: "500.000", input: "", output: "", capPlanning: "60000", capAdjustment: "20000", requestsPerMinute: "6", costCap: "", costCurrency: "USD", ...over,
});
const taskVersion = async (task: "PLANNER" | "ADJUSTMENTS") => (await t.gestor().getTasks()).find((r) => r.task === task)!.version;

describe("who may use the panel", () => {
  it("a professional is turned away by the guard; the repository refuses them too, even if the guard were skipped", async () => {
    as("tech-a");
    await expect(connectProvider("openai", CANARY)).rejects.toThrow("NEXT_REDIRECT");
    await expect(setKillSwitch(true)).rejects.toThrow("NEXT_REDIRECT");
    await expect(setOrganizationAi("org-a", { enabled: false }, 0)).rejects.toThrow("NEXT_REDIRECT");
    // below the guard: the repository and the service on their own
    secretsOn();
    const service = gestorAi(t.db, { userId: "tech-a" }, { env: resolveAiEnv((n) => process.env[n]) });
    expect(await service.connect("openai", CANARY)).toMatchObject({ ok: false, reason: "denied" });
    expect(await service.testConnection("openai")).toMatchObject({ ok: false, reason: "denied" });
    const repo = aiPlatformFor(t.db, { userId: "tech-a" });
    expect(await repo.listConnections()).toEqual([]);
    expect(await repo.listPlans()).toEqual([]);
    expect(await repo.listOrganizations("2026-11")).toEqual([]);
    expect(await repo.canWrite()).toBe(false);
    expect(await count("ai_provider_connections")).toBe(0);
    expect(await auditActions()).toEqual([]);
  });

  it("a revoked manager and a manager without two-factor cannot change anything; the second is told why", async () => {
    secretsOn();
    as("g3");
    await expect(connectProvider("openai", CANARY)).rejects.toThrow("NEXT_REDIRECT");
    as("g2");
    const refusal = "Ative a verificação em duas etapas em Minha conta para alterar a IA.";
    expect(await connectProvider("openai", CANARY)).toEqual({ ok: false, message: refusal });
    expect(await removeProvider("openai")).toEqual({ ok: false, message: refusal });
    expect(await testProviderConnection("openai")).toEqual({ ok: false, message: refusal });
    expect(await setKillSwitch(true)).toEqual({ ok: false, message: refusal });
    expect(await saveTask("PLANNER", taskForm(), 1)).toEqual({ ok: false, message: refusal });
    expect(await savePlan(null, planForm(), null)).toEqual({ ok: false, message: refusal });
    expect(await setOrganizationAi("org-a", { enabled: false }, 0)).toEqual({ ok: false, message: refusal });
    expect(await count("ai_provider_connections")).toBe(0);
    expect(await count("ai_quota_plans")).toBe(0);
    expect((await aiPlatformFor(t.db, { userId: "g2" }).getSettings()).killSwitch).toBe(false);
    // reading is allowed without two-factor (the page shows the state and disables the forms)
    expect(await aiPlatformFor(t.db, { userId: "g2" }).getTasks()).toHaveLength(2);
    expect(await auditActions()).toEqual([]);
  });
});

describe("provider keys: write-only, encrypted, never echoed", () => {
  it("without AI_SECRETS_KEY nothing is stored and the answer says so", async () => {
    const out = await connectProvider("openai", CANARY);
    expect(out).toMatchObject({ ok: false });
    expect(out.message).toContain("AI_SECRETS_KEY");
    expect(out.message).toContain("Nada foi guardado");
    expect(await count("ai_provider_connections")).toBe(0);
    expect(JSON.stringify(out)).not.toContain(CANARY);
  });

  it("rejects an unknown provider and keys that are not a single printable token; nothing is stored", async () => {
    secretsOn();
    expect(await connectProvider("mock", CANARY)).toMatchObject({ ok: false, message: "Provedor desconhecido." });
    expect(await connectProvider("evil'; DROP TABLE x;--", CANARY)).toMatchObject({ ok: false });
    for (const bad of ["", "short", "has space inside key", "tab\tkey-0123456789", "x".repeat(513), "línea-com-acento-0123"]) {
      expect(await connectProvider("openai", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    expect(await connectProvider("openai", 42 as never)).toMatchObject({ ok: false });
    expect(await count("ai_provider_connections")).toBe(0);
  });

  it("connects, rotates and removes; each change has an audit row; the key is in no answer, no column but the ciphertext, and no audit row", async () => {
    secretsOn();
    const connected = await connectProvider("openai", CANARY);
    expect(connected).toMatchObject({ ok: true, rotated: false });
    expect(JSON.stringify(connected)).not.toContain(CANARY);
    const stored = (await t.all<{ key_ciphertext: string; key_last4: string; key_key_id: string }>("SELECT key_ciphertext, key_last4, key_key_id FROM ai_provider_connections"))[0];
    expect(stored.key_last4).toBe(CANARY.slice(-4));
    expect(stored.key_ciphertext).not.toContain(CANARY);
    expect(stored.key_ciphertext).not.toContain(CANARY.slice(-8));
    expect(stored.key_key_id).toBe("k1");
    const rotated = await connectProvider("openai", `${CANARY}-v2`);
    expect(rotated).toMatchObject({ ok: true, rotated: true });
    expect((await t.all<{ key_last4: string }>("SELECT key_last4 FROM ai_provider_connections"))[0].key_last4).toBe(`${CANARY}-v2`.slice(-4));
    expect(await connectProvider("anthropic", "sk-ant-0123456789abcdef")).toMatchObject({ ok: true });
    // the listing the page uses has the masked tail only
    const listed = await t.gestor().listConnections();
    expect(listed.map((c) => c.kind)).toEqual(["anthropic", "openai"]);
    expect(JSON.stringify(listed)).not.toMatch(/ciphertext|CANARY|sk-/);
    expect(listed.find((c) => c.kind === "openai")).toMatchObject({ connectedByEmail: "g1@example.test", rotatedAt: expect.any(String) });
    expect(await removeProvider("anthropic")).toMatchObject({ ok: true });
    expect(await removeProvider("anthropic")).toMatchObject({ ok: false, message: "Este provedor já não tem chave." });
    expect(await auditActions()).toEqual(["AI_PROVIDER_CONNECTED:openai", "AI_PROVIDER_ROTATED:openai", "AI_PROVIDER_CONNECTED:anthropic", "AI_PROVIDER_REMOVED:anthropic"]);
    // no secret anywhere in the database outside the one encrypted column
    const dump = (await everything()).replace(/"key_ciphertext":"[^"]*"/g, '"key_ciphertext":"<sealed>"');
    expect(dump).not.toContain(CANARY);
    expect(dump).not.toContain("sk-ant-0123456789abcdef");
    // the audit rows carry the actor and the provider kind, nothing else
    expect(await t.all("SELECT 1 FROM access_audit_events WHERE action LIKE 'AI_PROVIDER_%' AND (subject_id NOT IN ('openai','anthropic') OR actor_user_id <> 'g1')")).toEqual([]);
  });

  it("a provider that a task uses cannot be removed, and the answer says which task", async () => {
    secretsOn();
    expect(await saveTask("PLANNER", taskForm({ providerKind: "openai", modelId: "any-model" }), await taskVersion("PLANNER"))).toMatchObject({ ok: true });
    const out = await removeProvider("openai");
    expect(out).toMatchObject({ ok: false });
    expect(out.message).toContain("Planejador de treino");
    expect(await count("ai_provider_connections")).toBe(1);
  });
});

describe("tests and model listing: no student data, both switches honoured, codes not provider text", () => {
  const recorder = (answer: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string | null }> = [];
    const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, method: init.method ?? "GET", headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body: typeof init.body === "string" ? init.body : null });
      return answer(url, init);
    }) as typeof fetch;
    return { calls, impl };
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const envWith = (extra: Record<string, string> = {}) => resolveAiEnv((n) => ({ AI_SECRETS_KEY: SECRETS_KEY, AI_MOCK_ENABLED: "true", ...extra })[n]);

  it("'Testar conexão' lists models with the key in the header and NO body; the result is kept and audited without the key", async () => {
    const f = recorder(() => json({ data: [{ id: "m-a" }, { id: "m-b" }] }));
    const service = gestorAi(t.db, { userId: "g1" }, { env: envWith(), fetchImpl: f.impl });
    const out = await service.testConnection("openai");
    expect(out).toMatchObject({ ok: true, models: 2, message: "Conexão ok: 2 modelos listados." });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ url: "https://api.openai.com/v1/models", method: "GET", body: null });
    expect(f.calls[0].headers.Authorization ?? f.calls[0].headers.authorization).toBe(`Bearer ${CANARY}-v2`);
    expect(JSON.stringify(out)).not.toContain(CANARY);
    const row = (await t.gestor().listConnections()).find((c) => c.kind === "openai")!;
    expect(row).toMatchObject({ lastTestOk: true, lastTestCode: null });
    expect((await auditActions()).filter((a) => a === "AI_PROVIDER_TESTED:openai")).toHaveLength(1);
  });

  it("'Listar modelos' returns ids and labels sorted, capped, with free text still allowed by the form", async () => {
    const f = recorder(() => json({ data: [{ id: "zz" }, { id: "aa" }] }));
    const out = await gestorAi(t.db, { userId: "g1" }, { env: envWith(), fetchImpl: f.impl }).listModels("openai");
    expect(out).toMatchObject({ ok: true, models: [{ id: "aa", label: null }, { id: "zz", label: null }], message: "2 modelos listados." });
  });

  it("a refused key is reported by code only, stored as the last test, and never as the provider's text", async () => {
    const f = recorder(() => json({ error: { message: `Incorrect API key provided: ${CANARY}` } }, 401));
    const out = await gestorAi(t.db, { userId: "g1" }, { env: envWith(), fetchImpl: f.impl }).testConnection("openai");
    expect(out).toEqual({ ok: false, reason: "failed", message: "Falhou: chave recusada pelo provedor (AUTH)." });
    expect((await t.gestor().listConnections()).find((c) => c.kind === "openai")).toMatchObject({ lastTestOk: false, lastTestCode: "AUTH" });
    expect(await everything()).not.toContain("Incorrect API key");
  });

  it("an unconnected provider, an unreadable key and a missing server secret are explained and call nothing", async () => {
    const f = recorder(() => json({}));
    const service = (extra: Record<string, string> = {}, drop = false) => gestorAi(t.db, { userId: "g1" }, { env: drop ? resolveAiEnv(() => undefined) : envWith(extra), fetchImpl: f.impl });
    expect(await service().testConnection("google")).toMatchObject({ ok: false, reason: "not_connected" });
    expect(await service({ AI_SECRETS_KEY: "too-short" }).testConnection("openai")).toMatchObject({ ok: false, reason: "no_secret" });
    const other = Buffer.alloc(32, 9).toString("base64url");
    expect(await service({ AI_SECRETS_KEY: other }).testConnection("openai")).toMatchObject({ ok: false, reason: "unreadable" });
    expect(await service({}, true).listModels("openai")).toMatchObject({ ok: false, reason: "no_secret" });
    expect(await service().testConnection("nope")).toMatchObject({ ok: false, reason: "invalid" });
    expect(f.calls).toHaveLength(0);
  });

  it("the environment switch and the panel switch each block every call made from the panel", async () => {
    const f = recorder(() => json({ data: [] }));
    const blockedByEnv = gestorAi(t.db, { userId: "g1" }, { env: envWith({ AI_PLANNER_DISABLED: "true" }), fetchImpl: f.impl });
    expect(await blockedByEnv.testConnection("openai")).toMatchObject({ ok: false, reason: "blocked" });
    expect(await blockedByEnv.listModels("openai")).toMatchObject({ ok: false, reason: "blocked" });
    expect(await blockedByEnv.testModel("PLANNER")).toMatchObject({ ok: false, reason: "blocked" });
    expect(await setKillSwitch(true)).toMatchObject({ ok: true });
    const service = gestorAi(t.db, { userId: "g1" }, { env: envWith(), fetchImpl: f.impl });
    expect(await service.testConnection("openai")).toMatchObject({ ok: false, reason: "blocked" });
    expect(await service.listModels("openai")).toMatchObject({ ok: false, reason: "blocked" });
    expect(await service.testModel("PLANNER")).toMatchObject({ ok: false, reason: "blocked" });
    expect(f.calls).toHaveLength(0);
    expect(await setKillSwitch(false)).toMatchObject({ ok: true });
    expect(await auditActions()).toEqual(expect.arrayContaining(["AI_KILL_SWITCH_ON:platform", "AI_KILL_SWITCH_OFF:platform"]));
    expect((await t.gestor().getSettings())).toMatchObject({ killSwitch: false, byEmail: "g1@example.test" });
  });

  it("'Testar modelo' sends a constant prompt without any student data, through the privacy choke point", async () => {
    // map the PLANNER task to the connected real provider
    expect(await saveTask("PLANNER", taskForm({ providerKind: "openai", modelId: "model-x" }), await taskVersion("PLANNER"))).toMatchObject({ ok: true });
    const f = recorder(() => json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 6 } }));
    const service = gestorAi(t.db, { userId: "g1" }, { env: envWith(), fetchImpl: f.impl });
    const out = await service.testModel("PLANNER");
    expect(out).toMatchObject({ ok: true, inputTokens: 40, outputTokens: 6, message: expect.stringContaining("entrada 40 · saída 6 tokens") });
    expect(f.calls).toHaveLength(1);
    const sent = JSON.parse(f.calls[0].body!);
    expect(sent.model).toBe("model-x");
    expect(JSON.stringify(sent.messages)).toContain("CONNECTIVITY_CHECK");
    expect(f.calls[0].body).not.toMatch(/context|Zélia|zelia|birth|nascimento|student|aluno/i);
    expect(sent.max_completion_tokens).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(out)).not.toContain(CANARY);
    // the audit row was written, and a second test of the same task right away is refused without a call
    expect((await auditActions()).filter((a) => a === "AI_MODEL_TESTED:PLANNER")).toHaveLength(1);
    expect(await service.testModel("PLANNER")).toMatchObject({ ok: false, reason: "too_soon" });
    expect(f.calls).toHaveLength(1);
    const later = gestorAi(t.db, { userId: "g1" }, { env: envWith(), fetchImpl: f.impl, now: () => new Date(Date.now() + MODEL_TEST_INTERVAL_MS + 1000) });
    expect(await later.testModel("PLANNER")).toMatchObject({ ok: true });
    expect((await auditActions()).filter((a) => a === "AI_MODEL_TESTED:PLANNER")).toHaveLength(2);
  });

  it("'Testar modelo' reports a model that answers the wrong thing, a missing model and an unmapped task by code or reason", async () => {
    let step = 0;
    const clock = () => new Date(Date.now() + (step += 20_000));
    const bad = recorder(() => json({ choices: [{ message: { content: '{"ok":false}' }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    expect(await gestorAi(t.db, { userId: "g1" }, { env: envWith(), fetchImpl: bad.impl, now: clock }).testModel("PLANNER")).toMatchObject({ ok: false, message: expect.stringContaining("resposta fora do formato esperado") });
    const missing = recorder(() => json({ error: { message: "The model `model-x` does not exist" } }, 404));
    const out = await gestorAi(t.db, { userId: "g1" }, { env: envWith(), fetchImpl: missing.impl, now: clock }).testModel("PLANNER");
    expect(out).toEqual({ ok: false, reason: "failed", message: "Falhou: modelo não encontrado neste provedor (MODEL_NOT_FOUND)." });
    expect(await gestorAi(t.db, { userId: "g1" }, { env: envWith(), fetchImpl: bad.impl, now: clock }).testModel("ADJUSTMENTS")).toMatchObject({ ok: false, reason: "not_mapped" });
    expect(await gestorAi(t.db, { userId: "g1" }, { env: envWith(), now: clock }).testModel("OTHER")).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("the simulated provider answers the check only where AI_MOCK_ENABLED is on", async () => {
    expect(await saveTask("ADJUSTMENTS", taskForm({ providerKind: "mock", modelId: "mock-ok" }), await taskVersion("ADJUSTMENTS"))).toMatchObject({ ok: false }); // mock not allowed without the env flag
    vi.stubEnv("AI_MOCK_ENABLED", "true");
    expect(await saveTask("ADJUSTMENTS", taskForm({ providerKind: "mock", modelId: "mock-ok" }), await taskVersion("ADJUSTMENTS"))).toMatchObject({ ok: true });
    const clock = () => new Date(Date.now() + 600_000);
    const on = await gestorAi(t.db, { userId: "g1" }, { env: envWith(), now: clock }).testModel("ADJUSTMENTS");
    expect(on).toMatchObject({ ok: true, message: expect.stringContaining("(estimados)") });
    const off = await gestorAi(t.db, { userId: "g1" }, { env: resolveAiEnv((n) => ({ AI_SECRETS_KEY: SECRETS_KEY })[n]), now: () => new Date(Date.now() + 1_200_000) }).testModel("ADJUSTMENTS");
    expect(off).toMatchObject({ ok: false, reason: "not_mapped" });
  });
});

describe("task settings", () => {
  it("validates before saving, converts typed prices to micros, clamps to the environment ceilings, and uses compare-and-set", async () => {
    vi.stubEnv("AI_MOCK_ENABLED", "true");
    vi.stubEnv("AI_HARD_MAX_OUTPUT_TOKENS", "4000");
    vi.stubEnv("AI_HARD_TIMEOUT_MS", "20000");
    const version = await taskVersion("PLANNER");
    expect(await saveTask("PLANNER", taskForm({ maxInputTokens: "10" }), version)).toMatchObject({ ok: false });
    expect(await saveTask("PLANNER", taskForm({ priceInput: "0,15" }), version)).toMatchObject({ ok: false, message: expect.stringContaining("os dois preços") });
    expect(await saveTask("NOPE", taskForm(), version)).toMatchObject({ ok: false, message: "Tarefa desconhecida." });
    expect(await saveTask("PLANNER", taskForm(), 0)).toMatchObject({ ok: false });
    expect(await saveTask("PLANNER", taskForm({ providerKind: "google", modelId: "g-1" }), version)).toMatchObject({ ok: false, message: expect.stringContaining("não tem chave") });
    const ok = await saveTask("PLANNER", taskForm({ priceInput: "0,15", priceOutput: "0,6", currency: "USD", timeoutSeconds: "60", maxOutputTokens: "9000" }), version);
    expect(ok).toMatchObject({ ok: true });
    expect((await t.gestor().getTasks()).find((r) => r.task === "PLANNER")).toMatchObject({
      providerKind: "mock", modelId: "mock-ok", maxOutputTokens: 4000, timeoutMs: 20000, currency: "USD", priceInputMicrosPerMillion: 150_000, priceOutputMicrosPerMillion: 600_000,
    });
    // a second manager saving from the old version is told to refresh
    expect(await saveTask("PLANNER", taskForm(), version)).toEqual({ ok: false, message: "Outro gestor alterou estas configurações. Atualize a página." });
    // clearing the prices stores NULL (unknown), never 0
    const next = await taskVersion("PLANNER");
    expect(await saveTask("PLANNER", taskForm(), next)).toMatchObject({ ok: true });
    expect((await t.gestor().getTasks()).find((r) => r.task === "PLANNER")).toMatchObject({ currency: null, priceInputMicrosPerMillion: null, priceOutputMicrosPerMillion: null });
    expect((await auditActions()).filter((a) => a.startsWith("AI_TASK_CONFIGURED"))).toContain("AI_TASK_CONFIGURED:PLANNER");
  });

  it("'send system exercise names' exists only for the adjustments task", async () => {
    vi.stubEnv("AI_MOCK_ENABLED", "true");
    await saveTask("PLANNER", taskForm({ sendSystemExerciseNames: true }), await taskVersion("PLANNER"));
    await saveTask("ADJUSTMENTS", taskForm({ sendSystemExerciseNames: true }), await taskVersion("ADJUSTMENTS"));
    const tasks = await t.gestor().getTasks();
    expect(tasks.find((r) => r.task === "PLANNER")!.sendSystemExerciseNames).toBe(false);
    expect(tasks.find((r) => r.task === "ADJUSTMENTS")!.sendSystemExerciseNames).toBe(true);
  });
});

describe("quota plans and organizations", () => {
  let planId = "";
  it("creates, edits with compare-and-set, rejects duplicates and bad numbers, and archives", async () => {
    const created = await savePlan(null, planForm(), null);
    expect(created).toMatchObject({ ok: true, message: "Plano criado." });
    planId = (created as { id: string }).id;
    expect(await savePlan(null, planForm({ name: "  ESSENCIAL " }), null)).toEqual({ ok: false, message: "Já existe um plano com esse nome." });
    expect(await savePlan(null, planForm({ name: "Ruim", total: "abc" }), null)).toMatchObject({ ok: false });
    const row = (await t.gestor().listPlans()).find((p) => p.id === planId)!;
    expect(row).toMatchObject({ mode: "TOTAL", totalTokens: 500_000, perRequestCapPlanning: 60_000, requestsPerMinute: 6, costCapMicros: null });
    expect(await savePlan(planId, planForm({ total: "800000" }), row.version)).toMatchObject({ ok: true, message: "Plano salvo." });
    expect(await savePlan(planId, planForm({ total: "900000" }), row.version)).toEqual({ ok: false, message: "Outro gestor alterou este plano. Atualize a página." });
    expect(await savePlan(planId, planForm(), 0)).toMatchObject({ ok: false });
    expect(await savePlan("missing", planForm({ name: "X" }), 1)).toMatchObject({ ok: false });
    const split = await savePlan(null, planForm({ name: "Separado", mode: "SPLIT", input: "300000", output: "100000" }), null);
    expect(split).toMatchObject({ ok: true });
    expect((await t.gestor().listPlans()).find((p) => p.name === "Separado")).toMatchObject({ mode: "SPLIT", inputTokens: 300_000, outputTokens: 100_000, totalTokens: null });
    const zero = await savePlan(null, planForm({ name: "Sem IA", total: "0", capPlanning: "0", capAdjustment: "0" }), null);
    expect(zero).toMatchObject({ ok: true });
    expect(await archivePlan((zero as { id: string }).id)).toMatchObject({ ok: true });
    expect(await archivePlan((zero as { id: string }).id)).toMatchObject({ ok: false });
    expect(await archivePlan("x".repeat(65))).toMatchObject({ ok: false });
  });

  it("a cost cap exists only where prices were typed, in their currency; without typed prices cost stays unknown", async () => {
    // the PLANNER task currently has no prices (cleared above)
    const refused = await savePlan(null, planForm({ name: "Com teto", costCap: "25", costCurrency: "USD" }), null);
    expect(refused).toMatchObject({ ok: false, message: expect.stringContaining("Sem preço digitado") });
    vi.stubEnv("AI_MOCK_ENABLED", "true");
    await saveTask("PLANNER", taskForm({ priceInput: "1", priceOutput: "2", currency: "USD" }), await taskVersion("PLANNER"));
    expect(await savePlan(null, planForm({ name: "Com teto", costCap: "25", costCurrency: "BRL" }), null)).toMatchObject({ ok: false, message: expect.stringContaining("USD") });
    const ok = await savePlan(null, planForm({ name: "Com teto", costCap: "25,50", costCurrency: "USD" }), null);
    expect(ok).toMatchObject({ ok: true });
    expect((await t.gestor().listPlans()).find((p) => p.name === "Com teto")).toMatchObject({ costCapMicros: 25_500_000, costCapCurrency: "USD" });
  });

  it("enabling an organization needs a plan and the current acknowledgement; disabling is immediate; the audit trail names the organization", async () => {
    const version = async () => (await t.gestor().listOrganizations("2026-11")).find((o) => o.organizationId === "org-a")!.version;
    expect(await setOrganizationAi("org-a", { enabled: true }, await version())).toEqual({ ok: false, message: "Confirme o aviso de anonimização para habilitar a IA." });
    expect(await setOrganizationAi("org-a", { enabled: true, acknowledged: true }, await version())).toEqual({ ok: false, message: "Escolha um plano de IA (não arquivado) antes de habilitar." });
    expect(await setOrganizationAi("org-a", { quotaPlanId: planId }, await version())).toMatchObject({ ok: true, message: "Plano de IA atribuído." });
    expect(await setOrganizationAi("org-a", { enabled: true, acknowledged: false }, await version())).toMatchObject({ ok: false });
    expect(await setOrganizationAi("org-a", { enabled: true, acknowledged: true }, await version())).toMatchObject({ ok: true, message: "IA habilitada para a organização." });
    const row = await t.first<{ enabled: number; enabled_by_user_id: string; ack_version: string; quota_plan_id: string }>("SELECT * FROM ai_organization_settings WHERE organization_id = 'org-a'");
    expect(row).toMatchObject({ enabled: 1, enabled_by_user_id: "g1", ack_version: AI_ORG_ACK_VERSION, quota_plan_id: planId });
    expect(await setOrganizationAi("org-a", { enabled: false }, 999)).toEqual({ ok: false, message: "Outro gestor alterou esta organização. Atualize a página." });
    expect(await setOrganizationAi("org-a", { enabled: false }, await version())).toMatchObject({ ok: true });
    expect((await t.gestor().listOrganizations("2026-11")).find((o) => o.organizationId === "org-a")).toMatchObject({ enabled: false, quotaPlanName: "Essencial" });
    const audit = (await auditActions()).filter((a) => a.includes("org-a"));
    expect(audit).toEqual(["AI_ORG_PLAN_ASSIGNED:org-a", "AI_ORG_ENABLED:org-a", "AI_ORG_DISABLED:org-a"]);
    expect(await t.all("SELECT organization_id FROM access_audit_events WHERE action IN ('AI_ORG_ENABLED','AI_ORG_DISABLED','AI_ORG_PLAN_ASSIGNED') AND organization_id <> 'org-a'")).toEqual([]);
  });

  it("is per organization: an unknown or other organization's id changes nothing; untrusted arguments are refused", async () => {
    expect(await setOrganizationAi("nope", { enabled: false }, 0)).toEqual({ ok: false, message: "Organização não encontrada." });
    expect(await setOrganizationAi("", { enabled: false }, 0)).toMatchObject({ ok: false });
    expect(await setOrganizationAi("org-b", {}, 0)).toEqual({ ok: false, message: "Nada para alterar." });
    expect(await setOrganizationAi("org-b", { quotaPlanId: 5 as never }, 0)).toMatchObject({ ok: false });
    expect(await setOrganizationAi("org-b", { enabled: true, acknowledged: true, quotaPlanId: "nonexistent" }, 0)).toMatchObject({ ok: false });
    expect(await t.first("SELECT 1 FROM ai_organization_settings WHERE organization_id = 'org-b' AND (enabled = 1 OR quota_plan_id IS NOT NULL)")).toBeNull();
    // an organization with no row at all has AI off for its users
    const d = await t.newDraft("st-b", "tech-b", "org-b");
    const out = await t.service("tech-b", "org-b", { env: { AI_MOCK_ENABLED: "true", AI_SECRETS_KEY: SECRETS_KEY } }).availability(d.planId, d.revisionId);
    expect(out?.state).toBe("ORG_DISABLED");
  });

  it("an archived plan stops serving: the organization shows 'IA não incluída' and the professional's gate refuses", async () => {
    await setOrganizationAi("org-a", { enabled: true, acknowledged: true }, (await t.gestor().listOrganizations("2026-11")).find((o) => o.organizationId === "org-a")!.version);
    expect(await archivePlan(planId)).toMatchObject({ ok: true });
    const d = await t.newDraft();
    const state = await t.service("tech-a", "org-a", { env: { AI_MOCK_ENABLED: "true", AI_SECRETS_KEY: SECRETS_KEY } }).availability(d.planId, d.revisionId);
    expect(state?.state).not.toBe("READY");
    expect(JSON.stringify(state)).not.toMatch(/openai|mock|model|apiKey/i);
  });
});

describe("no key survives anywhere", () => {
  it("the canary is in no table outside the single encrypted column, after everything above", async () => {
    const dump = (await everything()).replace(/"key_ciphertext":"[^"]*"/g, '"key_ciphertext":"<sealed>"');
    expect(dump).not.toContain(CANARY);
    expect(dump).not.toContain(CANARY.slice(-12));
  });
});
