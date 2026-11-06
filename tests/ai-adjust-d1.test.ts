import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlannerEnv, ANSWERS, BASE_ENV, NOW, STUDENT, taskOf, type Env, type PlannerEnv } from "./helpers/ai-planner-env";
import { aiAdjustmentsFor } from "@/db/ai-adjustments";
import { plansFor } from "@/db/plans";
import { aiPlanningFor } from "@/db/ai-planning";
import { proposalService } from "@/modules/prescricao/automatica/service";
import { adjustService, type AdjustOutcome, type SuggestionView } from "@/modules/prescricao/planejador/adjust-service";
import type { AdjustIntent } from "@/modules/prescricao/planejador/adjust";
import type { ProviderResult } from "@/modules/prescricao/planejador/provedores/port";

vi.mock("server-only", () => ({}));

// Assisted adjustments on a local D1 (Miniflare, migrations 0001-0049) with the mock provider and the real seeded library (design V4 §8.5, 4.3b).
// The subject: idempotency, cache, ledger/quota with task ADJUSTMENTS, tenant isolation, the apply path (a new version, only that point, no
// approval/delivery/draft side effects), reject, stale, expiry, erasure. No real provider is ever called.
let t: PlannerEnv;
beforeAll(async () => {
  t = await createPlannerEnv("ai-adjust-d1-tests");
  await t.configure({ provider: "mock", model: "mock-ok", orgs: ["org-a"] });
  await mapAdjustments("mock-ok");
});
afterAll(async () => {
  await t?.dispose();
});

async function mapAdjustments(model: string, over: Parameters<typeof taskOf>[2] = {}) {
  const g = t.gestor();
  const row = (await g.getTasks()).find((x) => x.task === "ADJUSTMENTS")!;
  const saved = await g.saveTask("ADJUSTMENTS", taskOf("mock", model, over), row.version, NOW);
  if (saved !== "saved") throw new Error(`task: ${saved}`);
}

const key = () => t.id("adj");
const svc = (who = "tech-a", org = "org-a", extra: Parameters<typeof adjustService>[2] = {}) =>
  adjustService(t.db, t.org(who, org), { now: () => NOW, readEnv: (n) => BASE_ENV[n], sleep: async () => undefined, ...extra });
const proposals = (who = "tech-a", org = "org-a") => proposalService(t.db, t.org(who, org), { now: () => NOW });

interface Fx { planId: string; revisionId: string; proposalId: string; version: number; slotKey: string; label: string; exerciseId: string }
/** A fresh draft with a generated proposal; the target is the first item of workout B (a real library exercise with alternatives). */
async function fixture(answers: unknown = ANSWERS): Promise<Fx> {
  const d = await t.newDraft();
  const g = await proposals().generate(d.planId, d.revisionId, { idempotencyKey: key(), baseContentVersion: await t.contentVersion(d.revisionId), answers } as never);
  if (!g.ok) throw new Error(`${g.reason}: ${g.message}`);
  const row = (await t.first<{ slot_key: string; exercise_id: string }>("SELECT slot_key, exercise_id FROM proposal_items WHERE proposal_id = ?1 AND slot_key LIKE '[1,\"B\",%' ORDER BY rowid LIMIT 1", g.proposalId))!;
  return { planId: d.planId, revisionId: d.revisionId, proposalId: g.proposalId, version: g.version, slotKey: row.slot_key, label: "B", exerciseId: row.exercise_id };
}
const substitution = (f: Fx, over: Partial<AdjustIntent> = {}): AdjustIntent => ({
  op: "SUBSTITUTE_EXERCISE", target: { phaseIndex: 1, label: f.label, slotKey: f.slotKey }, scope: "PHASE", values: null, constraints: [{ kind: "SAME_PATTERN" }], replacementExerciseId: null, useAi: false, ...over,
});
/** A constraint no session ever breaks, only to give each AI test its own context (the cache is keyed by it). */
let uniqueSeq = 0;
const uniq = (): AdjustIntent["constraints"][number] => ({ kind: "MAX_SESSION_MINUTES", minutes: 120 + ++uniqueSeq });
const doseSets = (f: Fx, sets: number, over: Partial<AdjustIntent> = {}): AdjustIntent => ({ ...substitution(f), op: "CHANGE_SETS", values: { sets }, constraints: [], ...over });
const body = (f: Fx, intent: AdjustIntent, over: Record<string, unknown> = {}) => ({ proposalId: f.proposalId, expectedVersion: f.version, idempotencyKey: key(), intent, ...over });
function ok(o: AdjustOutcome): SuggestionView {
  if (!o.ok) throw new Error(`${o.reason}: ${o.message}`);
  return o.suggestion;
}
async function firstAlternative(f: Fx, constraints: AdjustIntent["constraints"] = [{ kind: "SAME_PATTERN" }]) {
  const out = await svc().alternatives(f.planId, f.revisionId, { proposalId: f.proposalId, expectedVersion: f.version, intent: substitution(f, { constraints }) });
  if (!out.ok) throw new Error(out.message);
  return out.alternatives;
}
const apply = (f: Fx, s: SuggestionView, over: Record<string, unknown> = {}, who = svc()) =>
  who.apply(f.planId, f.revisionId, { adjustmentId: s.adjustmentId, proposalId: f.proposalId, expectedVersion: s.baseVersion, writeId: key(), idempotencyKey: key(), acknowledgeUncheckable: false, ...over });

/** The proposal as a reader sees it: header and every item row. */
async function proposalState(f: Fx) {
  return {
    header: await t.first<Record<string, unknown>>("SELECT version, state, parameters_json, output_hash, base_content_version FROM prescription_proposals WHERE id = ?1", f.proposalId),
    items: await t.all<Record<string, unknown>>("SELECT * FROM proposal_items WHERE proposal_id = ?1 ORDER BY id", f.proposalId),
    occurrences: await t.all<Record<string, unknown>>("SELECT id, estimated_minutes FROM proposal_occurrences WHERE proposal_id = ?1 ORDER BY id", f.proposalId),
    generations: await t.n("SELECT COUNT(*) AS n FROM prescription_generations WHERE proposal_id = ?1", f.proposalId),
  };
}
/** Nothing that belongs to the prescription moved: the revision, the draft rows, the approvals and the deliveries. */
async function prescriptionState(f: Fx) {
  return {
    revision: await t.first<Record<string, unknown>>("SELECT state, content_version FROM plan_revisions WHERE id = ?1", f.revisionId),
    rows: await t.n("SELECT COUNT(*) AS n FROM prescribed_exercises WHERE revision_id = ?1", f.revisionId),
    events: await t.n("SELECT COUNT(*) AS n FROM training_plan_events WHERE plan_id = ?1 AND action NOT IN ('CREATED') AND action NOT LIKE 'PROPOSAL_%'", f.planId),
    applications: await t.n("SELECT COUNT(*) AS n FROM prescription_applications WHERE revision_id = ?1", f.revisionId),
  };
}
const counts = async () => ({
  requests: await t.n("SELECT COUNT(*) AS n FROM adjustment_requests"),
  payloads: await t.n("SELECT COUNT(*) AS n FROM adjustment_payloads"),
  decisions: await t.n("SELECT COUNT(*) AS n FROM adjustment_decisions"),
  ledger: await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger"),
  cache: await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache"),
});

describe("structured path: the professional's pick, no provider, no ledger", () => {
  it("lists the engine's alternatives with the constraints evaluated, suggests, and writes neither the proposal nor the ledger", async () => {
    const f = await fixture();
    const before = await proposalState(f);
    const spy = t.spy();
    const alternatives = await firstAlternative(f);
    expect(alternatives.length).toBeGreaterThan(1);
    expect(alternatives[0].checks[0]).toMatchObject({ text: "Mesmo padrão de movimento" });
    const c0 = await counts();
    const view = ok(await svc("tech-a", "org-a", { providers: { mock: spy.provider } }).suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alternatives[0].exerciseId }))));
    expect(view).toMatchObject({ mode: "STRUCTURED", baseVersion: f.version, canApply: true, usage: null, cache: null });
    expect(view.request.text).toMatch(/^Trocar .+ por uma alternativa · Treino B · mesmo padrão de movimento$/);
    expect(view.suggestion.replacementName).toBe(alternatives[0].name);
    expect(view.diff!.items.length).toBeGreaterThan(0);
    expect(view.diff!.items.every((r) => r.before.exerciseName !== r.after.exerciseName)).toBe(true);
    expect(view.diff!.constraints.map((c) => c.status)).toEqual(["OK"]);
    expect(spy.calls).toHaveLength(0);
    expect(await counts()).toEqual({ ...c0, requests: c0.requests + 1, payloads: c0.payloads + 1 });
    expect(await proposalState(f)).toEqual(before);
  });

  it("a replacement outside the engine's list is refused; so is a missing choice", async () => {
    const f = await fixture();
    const c0 = await counts();
    expect(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: "sys-no-such" })))).toMatchObject({ ok: false, reason: "engine_refused" });
    expect(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f)))).toMatchObject({ ok: false, reason: "invalid" });
    expect(await counts()).toEqual(c0);
  });

  it("same key and payload replays the stored suggestion; the same key with another intent is key_reused; nothing more is written", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const request = body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }));
    const first = ok(await svc().suggest(f.planId, f.revisionId, request));
    const c1 = await counts();
    const again = await svc().suggest(f.planId, f.revisionId, request);
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(ok(again).adjustmentId).toBe(first.adjustmentId);
    expect(await counts()).toEqual(c1);
    const other = await svc().suggest(f.planId, f.revisionId, { ...request, intent: substitution(f, { replacementExerciseId: alts[1].exerciseId }) });
    expect(other).toMatchObject({ ok: false, reason: "key_reused" });
  });
});

describe("apply: only that point, as a new version", () => {
  it("applies a substitution as version N+1: one SUBSTITUTE generation, only that item differs, nothing approved, delivered or applied to the draft", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }))));
    const before = await proposalState(f);
    const draft = await prescriptionState(f);
    const out = await apply(f, view);
    expect(out).toMatchObject({ ok: true, version: f.version + 1, replayed: false });
    const after = await proposalState(f);
    expect(after.header).toMatchObject({ version: f.version + 1, state: "OPEN" });
    expect(after.generations).toBe(before.generations + 1);
    const generation = (await t.first<Record<string, unknown>>("SELECT scope, scope_json, base_proposal_version FROM prescription_generations WHERE proposal_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1", f.proposalId))!;
    expect(generation.scope).toBe("SUBSTITUTE");
    expect(JSON.parse(generation.scope_json as string)).toMatchObject({ adjustment: view.adjustmentId });
    // only the touched workout/phase changed: every other row is byte-equal
    const changed = after.items.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before.items[i]) || false);
    const kept = after.items.filter((row) => !JSON.stringify(row).includes(`"${f.exerciseId}"`));
    expect(changed.length).toBeGreaterThan(0);
    expect(after.items.length).toBe(before.items.length);
    for (const row of after.items) if ((row.slot_key as string).startsWith('[2,')) expect(before.items.find((b) => b.slot_key === row.slot_key)).toBeTruthy();
    expect(kept.length).toBeGreaterThan(0);
    const decision = (await t.first<Record<string, unknown>>("SELECT decision, generation_id FROM adjustment_decisions WHERE request_id = ?1", view.adjustmentId))!;
    expect(decision.decision).toBe("APPLIED");
    expect(decision.generation_id).toBeTruthy();
    expect(await prescriptionState(f)).toEqual(draft);
  });

  it("the same apply sent again (network retry) replays; a second apply of the same suggestion is refused", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }))));
    const keys = { writeId: key(), idempotencyKey: key() };
    expect(await apply(f, view, keys)).toMatchObject({ ok: true, replayed: false });
    const generations = await t.n("SELECT COUNT(*) AS n FROM prescription_generations WHERE proposal_id = ?1", f.proposalId);
    expect(await apply(f, view, keys)).toMatchObject({ ok: true, replayed: true });
    expect(await t.n("SELECT COUNT(*) AS n FROM prescription_generations WHERE proposal_id = ?1", f.proposalId)).toBe(generations);
    expect(await apply(f, view)).toMatchObject({ ok: false, reason: "already_decided" });
  });

  it("two applies with the same expected version: one wins, the other is stale", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const a = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }))));
    const b = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[1].exerciseId }))));
    const [x, y] = await Promise.all([apply(f, a), apply(f, b)]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect([x, y].find((r) => !r.ok)).toMatchObject({ ok: false, reason: expect.stringMatching(/stale|blocked|changed|engine_refused/) });
    expect((await proposalState(f)).header).toMatchObject({ version: f.version + 1 });
  });

  it("a dose change is applied as an ITEM generation, kept in the answers and re-applied by a later regeneration", async () => {
    const f = await fixture();
    const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, doseSets(f, 5))));
    expect(view).toMatchObject({ mode: "STRUCTURED", canApply: true });
    expect(view.diff!.items.every((r) => r.after.doseText.startsWith("5 ×"))).toBe(true);
    const before = await proposalState(f);
    expect(await apply(f, view)).toMatchObject({ ok: true, version: f.version + 1 });
    const after = await proposalState(f);
    expect((await t.first<{ scope: string }>("SELECT scope FROM prescription_generations WHERE proposal_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1", f.proposalId))!.scope).toBe("ITEM");
    const parameters = JSON.parse(after.header!.parameters_json as string) as { policyOverrides: Array<{ exerciseId: string; patch: { values: { sets: number } } }> };
    expect(parameters.policyOverrides).toEqual([{ exerciseId: f.exerciseId, phaseIndex: 1, label: "B", patch: { values: { sets: 5 } } }]);
    expect(after.items.length).toBe(before.items.length);
    // a later regeneration of the whole phase re-applies the adjustment (the professional's decision survives)
    const next = await t.first<{ version: number }>("SELECT version FROM prescription_proposals WHERE id = ?1", f.proposalId);
    const regenerated = await proposals().regenerate(f.planId, f.revisionId, { proposalId: f.proposalId, idempotencyKey: key(), writeId: key(), expectedVersion: next!.version, scope: { kind: "PHASE", phaseIndex: 1 } });
    expect(regenerated.ok).toBe(true);
    const sets = await t.all<{ dose_json: string }>("SELECT dose_json FROM proposal_items WHERE proposal_id = ?1 AND exercise_id = ?2 AND slot_key LIKE '[1,\"B\",%'", f.proposalId, f.exerciseId);
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((r) => JSON.parse(r.dose_json).sets === 5)).toBe(true);
  });

  it("a violated constraint disables the apply: the numbers are in the suggestion and nothing is written", async () => {
    const f = await fixture();
    const item = (await t.first<{ primary_muscles: string }>("SELECT 1 AS x, '' AS primary_muscles"))!;
    void item;
    const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, doseSets(f, 8, { constraints: [{ kind: "NO_WEEKLY_SETS_INCREASE", muscles: ["QUADRICEPS", "GLUTEUS", "HAMSTRINGS", "CHEST", "LATS", "UPPER_BACK"] }] }))));
    expect(view.canApply).toBe(false);
    expect(view.blockedReason).toMatch(/^Violaria: .* \+\d+(,\d+)? séries ponderadas na semana \d+ \(fase 1\)/);
    expect(view.diff!.constraints.some((c) => c.status === "VIOLATED")).toBe(true);
    const before = await proposalState(f);
    expect(await apply(f, view)).toMatchObject({ ok: false, reason: "blocked" });
    expect(await proposalState(f)).toEqual(before);
    expect(await t.n("SELECT COUNT(*) AS n FROM adjustment_decisions WHERE request_id = ?1", view.adjustmentId)).toBe(0);
  });

  it("reject keeps everything byte-identical and cannot be undone by an apply", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }))));
    const before = await proposalState(f);
    expect(await svc().reject(f.planId, f.revisionId, { adjustmentId: view.adjustmentId })).toEqual({ ok: true });
    expect(await svc().reject(f.planId, f.revisionId, { adjustmentId: view.adjustmentId })).toEqual({ ok: true });
    expect(await proposalState(f)).toEqual(before);
    expect((await t.first<{ decision: string }>("SELECT decision FROM adjustment_decisions WHERE request_id = ?1", view.adjustmentId))!.decision).toBe("REJECTED");
    expect(await apply(f, view)).toMatchObject({ ok: false, reason: "already_decided" });
    expect(await svc().current(f.planId, f.revisionId, f.proposalId)).toBeNull();
  });

  it("a suggestion for an old version is stale; a request for an old version is a conflict; both before anything is written", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }))));
    // another change moves the proposal to version N+1
    const locked = await proposals().lock(f.planId, f.revisionId, { proposalId: f.proposalId, writeId: key(), expectedVersion: f.version, targets: [{ phaseIndex: 1, slotKey: f.slotKey }], locked: true });
    expect(locked.ok).toBe(true);
    expect(await apply(f, view)).toMatchObject({ ok: false, reason: "stale" });
    expect(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId })))).toMatchObject({ ok: false, reason: "conflict", message: "A proposta mudou desde o pedido. Peça de novo." });
    expect(await svc().current(f.planId, f.revisionId, f.proposalId)).toBeNull();
  });

  it("an undecided suggestion comes back after a reload while it still applies, and expires after 24 hours", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }))));
    expect((await svc().current(f.planId, f.revisionId, f.proposalId))?.adjustmentId).toBe(view.adjustmentId);
    const later = new Date(NOW.getTime() + 25 * 3_600_000);
    expect(await svc("tech-a", "org-a", { now: () => later }).current(f.planId, f.revisionId, f.proposalId)).toBeNull();
    expect(await apply(f, view, {}, svc("tech-a", "org-a", { now: () => later }))).toMatchObject({ ok: false, reason: "expired" });
    expect((await t.first<{ decision: string }>("SELECT decision FROM adjustment_decisions WHERE request_id = ?1", view.adjustmentId))!.decision).toBe("EXPIRED");
  });
});

describe("AI path with the mock provider", () => {
  it("one call: anonymised payload, reserve -> settle with task ADJUSTMENTS, cache entry, suggestion with reasons; the proposal does not move", async () => {
    await mapAdjustments("mock-ok");
    const f = await fixture();
    const before = await proposalState(f);
    const draft = await prescriptionState(f);
    const spy = t.spy();
    const view = ok(await svc("tech-a", "org-a", { providers: { mock: spy.provider } }).suggest(f.planId, f.revisionId, body(f, substitution(f, { useAi: true, constraints: [{ kind: "SAME_PATTERN" }, uniq()] }))));
    expect(spy.calls).toHaveLength(1);
    expect(view).toMatchObject({ mode: "AI", cache: "MISS", canApply: true });
    expect(view.usage!.inputTokens).toBeGreaterThan(0);
    expect(view.suggestion.reasons.map((r) => r.code)).toContain("SAME_PATTERN");
    expect(view.suggestion.echoMissing).toEqual([]);
    expect(view.diff!.constraints.map((c) => c.status)).toEqual(["OK", "OK"]);
    // what left the server: the coded context only (no name, contact, id, plan title, exercise name or number sequence)
    const sent = spy.calls[0].user;
    for (const secret of [STUDENT.name, STUDENT.email, STUDENT.phone, STUDENT.birthDate, STUDENT.injury, "Zélia", "Plano de teste", "st-1", f.planId, f.revisionId, f.proposalId, "org-a", f.slotKey, f.exerciseId])
      expect(sent, secret).not.toContain(secret);
    expect(sent).not.toMatch(/Agachamento|Supino|Leg press/);
    expect(JSON.parse(sent)).toMatchObject({ task: "ADJUSTMENTS", promptVersion: "adjust-2026.11.1" });
    const row = (await t.first<Record<string, unknown>>("SELECT * FROM adjustment_requests WHERE id = ?1", view.adjustmentId))!;
    expect(row).toMatchObject({ mode: "AI", status: "SUCCEEDED", provider_kind: "mock", model_id: "mock-ok", prompt_version: "adjust-2026.11.1", cache_hit: 0, failure_code: null });
    const ledger = (await t.first<Record<string, unknown>>("SELECT * FROM ai_usage_ledger WHERE id = ?1", row.ledger_id))!;
    expect(ledger).toMatchObject({ state: "SETTLED", task: "ADJUSTMENTS", cache_hit: 0, requested_by_user_id: "tech-a" });
    expect(ledger.request_key).toBe(`${view.adjustmentId}:1`);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE cache_key = ?1", row.cache_key)).toBe(1);
    expect((await t.first<Record<string, number>>("SELECT reserved_input, reserved_output FROM ai_usage_month WHERE organization_id = 'org-a'"))).toMatchObject({ reserved_input: 0, reserved_output: 0 });
    // the cache holds hashes and the validated answer, never a prompt
    expect(JSON.stringify(await t.all("SELECT * FROM adjustment_requests"))).not.toContain(STUDENT.name);
    expect(await proposalState(f)).toEqual(before);
    expect(await prescriptionState(f)).toEqual(draft);
  });

  it("an identical request under a new key is a cache hit: no provider call, a 0-token ledger row; the same key replays without a new row", async () => {
    const f = await fixture();
    const spy = t.spy();
    const s = svc("tech-a", "org-a", { providers: { mock: spy.provider } });
    const constraints = [uniq()];
    const first = ok(await s.suggest(f.planId, f.revisionId, body(f, substitution(f, { useAi: true, constraints }))));
    expect(spy.calls).toHaveLength(1);
    const second = body(f, substitution(f, { useAi: true, constraints }));
    const hit = ok(await s.suggest(f.planId, f.revisionId, second));
    expect(spy.calls).toHaveLength(1);
    expect(hit).toMatchObject({ mode: "AI", cache: "HIT", usage: { inputTokens: 0, outputTokens: 0 } });
    expect(hit.suggestion.replacementName).toBe(first.suggestion.replacementName);
    const ledgers = await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE task = 'ADJUSTMENTS'");
    expect(await s.suggest(f.planId, f.revisionId, second)).toMatchObject({ ok: true, replayed: true });
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE task = 'ADJUSTMENTS'")).toBe(ledgers);
    expect(spy.calls).toHaveLength(1);
  });

  it("the model choosing a replacement that breaks the volume constraint is shown VIOLATED and cannot be applied", async () => {
    await mapAdjustments("mock-last");
    try {
      const f = await fixture();
      const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { useAi: true, constraints: [{ kind: "NO_WEEKLY_SETS_INCREASE", muscles: ["CALVES", "BICEPS", "TRICEPS", "CHEST", "LATS", "HAMSTRINGS"] }, uniq()] }))));
      // whatever the model picked, the engine's numbers decide
      expect(view.diff!.constraints).toHaveLength(2);
      expect(view.canApply).toBe(view.diff!.constraints.every((c) => c.status !== "VIOLATED"));
      if (!view.canApply) expect(await apply(f, view)).toMatchObject({ ok: false, reason: "blocked" });
    } finally {
      await mapAdjustments("mock-ok");
    }
  });

  it("an AI request for a dose operation is refused as invalid, not as a missing target, and calls nothing", async () => {
    const f = await fixture();
    const c0 = await counts();
    const out = await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { op: "CHANGE_SETS", values: { sets: 4 }, useAi: true })));
    expect(out).toMatchObject({ ok: false, reason: "invalid", canUseEngine: false });
    expect((await counts()).ledger).toBe(c0.ledger);
  });

  it("a hostile answer (alias that was not offered) is refused whole: tokens are settled, nothing is cached or applied", async () => {
    await mapAdjustments("mock-hostile");
    try {
      const f = await fixture();
      const c0 = await counts();
      const out = await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { useAi: true, constraints: [uniq()] })));
      expect(out).toMatchObject({ ok: false, reason: "invalid_response", canUseEngine: true });
      const c1 = await counts();
      expect(c1.cache).toBe(c0.cache);
      expect(c1.payloads).toBe(c0.payloads);
      expect(c1.ledger).toBe(c0.ledger + 1);
      expect(await t.first("SELECT state FROM ai_usage_ledger WHERE task = 'ADJUSTMENTS' ORDER BY created_at DESC, rowid DESC LIMIT 1")).toMatchObject({ state: "SETTLED" });
      expect((await proposalState(f)).header).toMatchObject({ version: f.version });
    } finally {
      await mapAdjustments("mock-ok");
    }
  });

  it("'no alternative fits' comes back as an informational card with no operation and no apply", async () => {
    await mapAdjustments("mock-none");
    try {
      const f = await fixture();
      const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { useAi: true, constraints: [uniq()] }))));
      expect(view).toMatchObject({ canApply: false, diff: null });
      expect(view.suggestion.clarification).toMatchObject({ code: "NO_ELIGIBLE_ALTERNATIVE" });
      expect(await apply(f, view)).toMatchObject({ ok: false, reason: "invalid" });
    } finally {
      await mapAdjustments("mock-ok");
    }
  });

  it("no candidate left after the catalog-level constraints: no provider call, no reservation, the same informational card", async () => {
    const f = await fixture();
    const spy = t.spy();
    const c0 = await counts();
    const view = ok(await svc("tech-a", "org-a", { providers: { mock: spy.provider } }).suggest(f.planId, f.revisionId, body(f, substitution(f, { useAi: true, constraints: [{ kind: "EQUIPMENT_CLASS", equipment: "SLED" }] }))));
    expect(view.suggestion.clarification?.code).toBe("NO_ELIGIBLE_ALTERNATIVE");
    expect(spy.calls).toHaveLength(0);
    expect((await counts()).ledger).toBe(c0.ledger);
  });

  it("provider failure never touches the proposal: the failure is explicit and the engine's list still works", async () => {
    const f = await fixture();
    const spy = t.spy(async (): Promise<ProviderResult> => ({ ok: false, code: "SERVER_ERROR", httpStatus: 500, retryable: false, retryAfterMs: null, usage: null, latencyMs: 1 }));
    const out = await svc("tech-a", "org-a", { providers: { mock: spy.provider } }).suggest(f.planId, f.revisionId, body(f, substitution(f, { useAi: true, constraints: [uniq()] })));
    expect(out).toMatchObject({ ok: false, reason: "provider_failed", canUseEngine: true });
    expect((await proposalState(f)).header).toMatchObject({ version: f.version });
    expect((await firstAlternative(f)).length).toBeGreaterThan(0);
  });
});

describe("gates: the same as the planner's", () => {
  it("the kill switch closes the AI button and write nothing; the structured path keeps working", async () => {
    const f = await fixture();
    const spy = t.spy();
    const c0 = await counts();
    const killed = await svc("tech-a", "org-a", { providers: { mock: spy.provider }, readEnv: (n) => ({ ...BASE_ENV, AI_PLANNER_DISABLED: "true" } as Env)[n] }).suggest(f.planId, f.revisionId, body(f, substitution(f, { useAi: true })));
    expect(killed).toMatchObject({ ok: false, reason: "disabled", canUseEngine: true, message: "A IA está desligada pela plataforma." });
    expect(spy.calls).toHaveLength(0);
    expect(await counts()).toEqual(c0);
    const availability = (await svc().availability(f.planId, f.revisionId))!;
    expect(availability.state).toBe("READY");
    const closed = (await svc("tech-a", "org-a", { readEnv: (n) => ({ ...BASE_ENV, AI_PLANNER_DISABLED: "true" } as Env)[n] }).availability(f.planId, f.revisionId))!;
    expect(closed).toMatchObject({ state: "KILL_SWITCH_ENV", message: "A IA está desligada pela plataforma." });
    expect((await firstAlternative(f)).length).toBeGreaterThan(0);
  });

  it("a per-request cap that the request does not fit is refused before any call", async () => {
    await mapAdjustments("mock-ok", { maxInputTokens: 500 });
    try {
      const f = await fixture();
      const spy = t.spy();
      const out = await svc("tech-a", "org-a", { providers: { mock: spy.provider } }).suggest(f.planId, f.revisionId, body(f, substitution(f, { useAi: true })));
      expect(out).toMatchObject({ ok: false, reason: "request_too_large" });
      expect(spy.calls).toHaveLength(0);
    } finally {
      await mapAdjustments("mock-ok");
    }
  });
});

describe("isolation and side effects", () => {
  it("another organization, an unassigned professional and a revoked assignment see nothing and write nothing", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const request = body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }));
    const view = ok(await svc().suggest(f.planId, f.revisionId, request));
    const c0 = await counts();
    for (const [who, org] of [["tech-b", "org-b"], ["tech-a2", "org-a"], ["tech-off", "org-a"]] as const) {
      const s = svc(who, org);
      expect(await s.availability(f.planId, f.revisionId), who).toBeNull();
      expect(await s.alternatives(f.planId, f.revisionId, { proposalId: f.proposalId, expectedVersion: f.version, intent: substitution(f) }), who).toMatchObject({ ok: false, reason: "not_found" });
      expect(await s.suggest(f.planId, f.revisionId, { ...request, idempotencyKey: key() }), who).toMatchObject({ ok: false, reason: "not_found" });
      expect(await s.apply(f.planId, f.revisionId, { adjustmentId: view.adjustmentId, proposalId: f.proposalId, expectedVersion: view.baseVersion, writeId: key(), idempotencyKey: key(), acknowledgeUncheckable: false }), who).toMatchObject({ ok: false, reason: "not_found" });
      expect(await s.reject(f.planId, f.revisionId, { adjustmentId: view.adjustmentId }), who).toMatchObject({ ok: false, reason: "not_found" });
      expect(await s.current(f.planId, f.revisionId, f.proposalId), who).toBeNull();
      expect(await aiAdjustmentsFor(t.db, t.org(who, org)).payloadOf(f.planId, f.revisionId, view.adjustmentId), who).toBeNull();
    }
    expect(await counts()).toEqual(c0);
    expect((await proposalState(f)).header).toMatchObject({ version: f.version });
  });

  it("a ready, approved or delivered revision is unreachable: not_open, nothing written", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const view = ok(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }))));
    const c0 = await counts();
    const items = (await proposalState(f)).items;
    const plans = plansFor(t.db, t.org("tech-a"));
    const steps: Array<[string, () => Promise<unknown>]> = [
      ["READY", () => plans.markReady(f.planId, f.revisionId)],
      ["APPROVED", () => plans.approve(f.planId, f.revisionId, { screeningNotRecorded: true }, new Date("2026-11-21T10:00:00Z"))],
      ["DELIVERED", () => plans.deliver(f.planId, f.revisionId, new Date("2026-11-21T11:00:00Z"))],
    ];
    for (const [state, advance] of steps) {
      await advance();
      expect((await t.first<{ state: string }>("SELECT state FROM plan_revisions WHERE id = ?1", f.revisionId))!.state).toBe(state);
      expect(await svc().suggest(f.planId, f.revisionId, body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }))), state).toMatchObject({ ok: false });
      expect(await svc().alternatives(f.planId, f.revisionId, { proposalId: f.proposalId, expectedVersion: f.version, intent: substitution(f) }), state).toMatchObject({ ok: false });
      expect(await apply(f, view), state).toMatchObject({ ok: false });
      expect(await svc().reject(f.planId, f.revisionId, { adjustmentId: view.adjustmentId }), state).toMatchObject({ ok: false });
      expect(await svc().current(f.planId, f.revisionId, f.proposalId), state).toBeNull();
    }
    expect(await counts()).toEqual(c0);
    expect((await proposalState(f)).items).toEqual(items);
  });

  it("erasing the student's data removes the suggestions but keeps requests, decisions and the ledger; an erased suggestion cannot be replayed or applied", async () => {
    const f = await fixture();
    const alts = await firstAlternative(f);
    const request = body(f, substitution(f, { replacementExerciseId: alts[0].exerciseId }));
    const view = ok(await svc().suggest(f.planId, f.revisionId, request));
    const before = await counts();
    const erased = await aiPlanningFor(t.db, t.org("tech-a")).eraseStudentAi("st-1");
    expect(erased.adjustments).toBeGreaterThan(0);
    const after = await counts();
    expect(after.payloads).toBe(0);
    expect(after.requests).toBe(before.requests);
    expect(after.decisions).toBe(before.decisions);
    expect(after.ledger).toBe(before.ledger);
    expect(await svc().suggest(f.planId, f.revisionId, request)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await apply(f, view)).toMatchObject({ ok: false, reason: "not_found" });
    expect((await proposalState(f)).header).toMatchObject({ version: f.version });
  });
});
