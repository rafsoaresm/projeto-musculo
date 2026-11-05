import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ANSWERS, createPlannerEnv, type PlannerEnv } from "./helpers/ai-planner-env";

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/modules/auth/server", () => ({ requireWorkspace: async () => session.current }));

import { getLatestStrategies, getPlanningAvailability, getPlanningState, planStrategies } from "@/modules/prescricao/planejador/actions";

// The server actions of the planner (sub-stage 1.3): the session comes from the server (`requireWorkspace`), the environment from the real
// reader (`env.ts`: Worker env, then process.env), everything else from the service tested in planner-service.test.ts. The outcome is client-safe.
let t: PlannerEnv;
const as = (userId: string, organizationId = "org-a") => {
  session.current = { db: t.db, context: { userId, organizationId }, workspace: { id: organizationId, name: organizationId === "org-a" ? "Studio A" : "Studio B" } };
};
beforeAll(async () => {
  t = await createPlannerEnv("planner-actions-tests");
  as("tech-a");
});
afterAll(async () => {
  await t?.dispose();
});
afterEach(() => vi.unstubAllEnvs());

const payload = async (d: { revisionId: string }, mode: "AI" | "RULES", over: Record<string, unknown> = {}) => ({
  idempotencyKey: t.id("key"), baseContentVersion: await t.contentVersion(d.revisionId), mode, answers: ANSWERS, ...over,
});

describe("planner server actions", () => {
  it("with nothing configured: availability says so in coarse words, rules works, and the state and the latest suggestion read back", async () => {
    const d = await t.newDraft();
    const a = await getPlanningAvailability(d.planId, d.revisionId);
    expect(a).toMatchObject({ state: "not_configured", message: "IA não configurada." });
    expect(Object.keys(a!.usage).sort()).toEqual(["allowance", "month", "remaining", "used"]);
    expect(await getPlanningState(d.planId, d.revisionId)).toEqual({ state: "NONE" });
    expect(await getLatestStrategies(d.planId, d.revisionId)).toBeNull();
    expect(await planStrategies(d.planId, d.revisionId, (await payload(d, "AI")) as never)).toMatchObject({ ok: false, reason: "not_configured", canContinueByRules: true });
    const out = await planStrategies(d.planId, d.revisionId, (await payload(d, "RULES")) as never);
    expect(out).toMatchObject({ ok: true, producer: "RULES" });
    const state = await getPlanningState(d.planId, d.revisionId);
    expect(state).toMatchObject({ state: "READY" });
    expect(await getLatestStrategies(d.planId, d.revisionId)).toEqual(out.ok ? out.blueprint : null);
    // nothing a professional's browser must not see
    expect(JSON.stringify([a, out, state])).not.toMatch(/openai|anthropic|google|apiKey|key_|ciphertext|modelId|"provider|cost|price/i);
  });

  it("the environment decides: the kill switch is reported as 'disabled' (never as the variable), and the mock needs AI_MOCK_ENABLED", async () => {
    await t.configure({ provider: "mock", model: "mock-ok", orgs: ["org-a"] });
    const d = await t.newDraft();
    expect(await getPlanningAvailability(d.planId, d.revisionId)).toMatchObject({ state: "not_configured" });
    vi.stubEnv("AI_MOCK_ENABLED", "true");
    expect(await getPlanningAvailability(d.planId, d.revisionId)).toMatchObject({ state: "READY", message: "" });
    vi.stubEnv("AI_PLANNER_DISABLED", "true");
    const closed = await getPlanningAvailability(d.planId, d.revisionId);
    expect(closed).toMatchObject({ state: "disabled", message: "A IA está desligada pela plataforma." });
    expect(JSON.stringify(closed)).not.toContain("AI_PLANNER_DISABLED");
    expect(await planStrategies(d.planId, d.revisionId, (await payload(d, "AI")) as never)).toMatchObject({ ok: false, reason: "disabled", canContinueByRules: true });
  });

  it("AI through the action: one planning call, the suggestion is stored, and a second action with the same body replays it", async () => {
    vi.stubEnv("AI_MOCK_ENABLED", "true");
    const d = await t.newDraft();
    const body = await payload(d, "AI");
    const out = await planStrategies(d.planId, d.revisionId, body as never);
    expect(out).toMatchObject({ ok: true, producer: "AI", cache: expect.stringMatching(/HIT|MISS/) });
    const again = await planStrategies(d.planId, d.revisionId, body as never);
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(await getPlanningState(d.planId, d.revisionId)).toMatchObject({ state: "READY", view: { producer: "AI", label: "Sugestão da IA" } });
  });

  it("ids that are not ids, and a session from another organization, find nothing", async () => {
    const d = await t.newDraft();
    expect(await getPlanningAvailability("../etc", d.revisionId)).toBeNull();
    expect(await getPlanningState("x y", d.revisionId)).toEqual({ state: "NONE" });
    expect(await getLatestStrategies(d.planId, "")).toBeNull();
    expect(await planStrategies("a".repeat(65), d.revisionId, (await payload(d, "RULES")) as never)).toMatchObject({ ok: false, reason: "not_found" });
    as("tech-b", "org-b");
    expect(await getPlanningAvailability(d.planId, d.revisionId)).toBeNull();
    expect(await planStrategies(d.planId, d.revisionId, (await payload(d, "RULES")) as never)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await getPlanningState(d.planId, d.revisionId)).toEqual({ state: "NONE" });
    as("tech-a");
  });
});
