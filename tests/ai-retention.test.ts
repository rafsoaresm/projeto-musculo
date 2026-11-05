import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { aiPlanningFor } from "@/db/ai-planning";
import { dataRequestsFor, studentRequestsFor } from "@/db/data-requests";
import { plansFor } from "@/db/plans";
import { ANSWERS, BASE_ENV, createPlannerEnv, NOW, type PlannerEnv } from "./helpers/ai-planner-env";
import { PATTERN_CODES } from "@/modules/prescricao/planejador/vocab";
import type { PlanningOutcome } from "@/modules/prescricao/planejador/orchestration";

vi.mock("server-only", () => ({}));

// Retention and erasure of what the AI layer keeps ABOUT a student (design V4 §3.6, §3.8, review item 13): the opportunistic purge of expired
// cache entries, the TTL, and the erasure wired into the data-subject request flow. Student-linked rows exist from sub-stage 1.3, so the
// erasure ships with them. Local D1 (Miniflare); no provider is called but the deterministic mock.
let t: PlannerEnv;
let seq = 0;
const DAY = 86_400_000;
const answers = () => ({ ...ANSWERS, excludedPatterns: [PATTERN_CODES[seq++ % PATTERN_CODES.length]] });

beforeAll(async () => {
  t = await createPlannerEnv("ai-retention-tests");
  await t.configure({ provider: "mock", model: "mock-ok", orgs: ["org-a", "org-b"] });
  // a second adult student of org-a, attended by tech-a, with no login (no requests of his own)
  await t.db.batch([
    t.db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-3','org-a','Terceiro Aluno')"),
    t.db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-3','pro-a')"),
    t.db.prepare(
      "INSERT INTO student_profiles(student_id,organization_id,goal,level,days_per_week,session_minutes,birth_date,updated_by_user_id) VALUES ('st-3','org-a','Hipertrofia','Intermediário',4,60,'1988-02-02','tech-a')",
    ),
  ]);
});
afterAll(async () => {
  await t?.dispose();
});

const ok = (o: PlanningOutcome) => {
  if (!o.ok) throw new Error(`${o.reason}: ${o.message}`);
  return o;
};
const body = async (d: { revisionId: string }, mode: "AI" | "RULES", extra: Record<string, unknown> = {}) => ({
  idempotencyKey: t.id("key"), baseContentVersion: await t.contentVersion(d.revisionId), mode, answers: ANSWERS, ...extra,
});
const cacheOf = (student: string) => t.n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE student_id = ?1", student);
const payloadsOf = (student: string) => t.n("SELECT COUNT(*) AS n FROM planning_run_payloads WHERE student_id = ?1", student);

describe("opportunistic purge and TTL (there is no background process)", () => {
  it("a successful call deletes up to 50 expired entries of ITS organization only, in batches, and never an unexpired one", async () => {
    const d = await t.newDraft("st-1");
    const past = "2026-01-01T00:00:00.000Z";
    const rows = (org: string, student: string, n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) =>
        t.db
          .prepare(
            "INSERT INTO ai_planner_cache(organization_id,cache_key,student_id,task,provider_kind,model_id,prompt_version,response_json,response_hash,created_at,expires_at) VALUES (?1,?2,?3,'PLANNER','mock','m','p','{}',?4,'x',?5)",
          )
          .bind(org, `${prefix}${String(i).padStart(3, "0")}`.padEnd(64, "0"), student, "8".repeat(64), past),
      );
    await t.db.batch([...rows("org-a", "st-1", 60, "a"), ...rows("org-b", "st-b", 5, "b")]);
    // an entry of org-a that has NOT expired
    await t.run(
      "INSERT INTO ai_planner_cache(organization_id,cache_key,student_id,task,provider_kind,model_id,prompt_version,response_json,response_hash,created_at,expires_at) VALUES ('org-a',?1,'st-1','PLANNER','mock','m','p','{}',?2,'x','2099-01-01T00:00:00.000Z')",
      "c".repeat(64), "8".repeat(64),
    );
    const svc = t.service("tech-a", "org-a");
    ok(await svc.plan(d.planId, d.revisionId, (await body(d, "AI", { answers: answers() })) as never));
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-a' AND expires_at <= ?1", NOW.toISOString())).toBe(10);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-b' AND expires_at <= ?1", NOW.toISOString())).toBe(5);
    ok(await svc.plan(d.planId, d.revisionId, (await body(d, "AI", { answers: answers() })) as never));
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-a' AND expires_at <= ?1", NOW.toISOString())).toBe(0);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-a' AND cache_key = ?1", "c".repeat(64))).toBe(1);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE organization_id = 'org-b'")).toBe(5);
    await t.run("DELETE FROM ai_planner_cache WHERE organization_id = 'org-b'");
  });

  it("an entry past its validity is not a hit: the provider is called again and the entry is replaced; AI_CACHE_TTL_DAYS sets the validity", async () => {
    const d = await t.newDraft("st-3", "tech-a");
    const same = answers();
    const env = { ...BASE_ENV, AI_CACHE_TTL_DAYS: "2" };
    const first = t.spy();
    const a = ok(await t.service("tech-a", "org-a", { providers: { mock: first.provider }, env }).plan(d.planId, d.revisionId, (await body(d, "AI", { answers: same })) as never));
    expect(a.cache).toBe("MISS");
    const row = (await t.first<{ created_at: string; expires_at: string; hits: number }>("SELECT created_at, expires_at, hits FROM ai_planner_cache WHERE student_id = 'st-3'"))!;
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(2 * DAY);
    // one day later: still valid
    const day1 = t.spy();
    const b = ok(await t.service("tech-a", "org-a", { providers: { mock: day1.provider }, env, now: () => new Date(NOW.getTime() + DAY) }).plan(d.planId, d.revisionId, (await body(d, "AI", { answers: same })) as never));
    expect(b.cache).toBe("HIT");
    expect(day1.calls).toHaveLength(0);
    // three days later: expired, a real call, the entry replaced
    const day3 = t.spy();
    const c = ok(await t.service("tech-a", "org-a", { providers: { mock: day3.provider }, env, now: () => new Date(NOW.getTime() + 3 * DAY) }).plan(d.planId, d.revisionId, (await body(d, "AI", { answers: same })) as never));
    expect(c.cache).toBe("MISS");
    expect(day3.calls).toHaveLength(1);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_planner_cache WHERE student_id = 'st-3'")).toBe(1);
    const after = (await t.first<{ expires_at: string; hits: number }>("SELECT expires_at, hits FROM ai_planner_cache WHERE student_id = 'st-3'"))!;
    expect(after.hits).toBe(0);
    expect(Date.parse(after.expires_at)).toBe(NOW.getTime() + 3 * DAY + 2 * DAY);
  });
});

describe("erasure follows the data-subject request", () => {
  it("what the AI layer keeps about a student is erased when the professional fulfils a deletion, and only then", async () => {
    const d1 = await t.newDraft("st-1");
    const d3 = await t.newDraft("st-3");
    const dB = await t.newDraft("st-b", "tech-b", "org-b");
    const svcA = t.service("tech-a", "org-a");
    const run1 = ok(await svcA.plan(d1.planId, d1.revisionId, (await body(d1, "AI", { answers: answers() })) as never));
    const key1 = (await t.first<{ idempotency_key: string; base_content_version: number }>("SELECT idempotency_key, base_content_version FROM planning_runs WHERE id = ?1", run1.runId))!;
    const rules1 = ok(await svcA.plan(d1.planId, d1.revisionId, (await body(d1, "RULES")) as never));
    ok(await svcA.plan(d3.planId, d3.revisionId, (await body(d3, "AI", { answers: answers() })) as never));
    ok(await t.service("tech-b", "org-b").plan(dB.planId, dB.revisionId, (await body(dB, "AI", { answers: answers() })) as never));
    // an acceptance (PR 2 writes them; here a raw row proves they are NOT erased with the student)
    await t.run(
      `INSERT INTO blueprint_acceptances(id,organization_id,plan_id,revision_id,run_id,idempotency_key,request_hash,strategy_id,split_family,final_json,acceptance_hash,structure_fingerprint,base_content_version,accepted_by_user_id,accepted_at)
       VALUES ('acc-1','org-a',?1,?2,?3,?4,?5,'S1','UPPER_LOWER','{}',?5,'f',0,'tech-a','2026-11-20T15:00:00Z')`,
      d1.planId, d1.revisionId, run1.runId, "acceptance-key-0001", "a".repeat(64),
    );
    const before = { st1: [await cacheOf("st-1"), await payloadsOf("st-1")], st3: [await cacheOf("st-3"), await payloadsOf("st-3")], stB: [await cacheOf("st-b"), await payloadsOf("st-b")] };
    expect(before.st1[0]).toBeGreaterThan(0);
    expect(before.st1[1]).toBeGreaterThanOrEqual(2);
    const ledgerRows = await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger");
    const runRows = await t.n("SELECT COUNT(*) AS n FROM planning_runs");

    const student = studentRequestsFor(t.db, "owner-a");
    const pro = dataRequestsFor(t.db, t.org("tech-a"));
    // 1. an ACCESS request fulfilled: nothing erased
    const access = await student.open("st-1", { kind: "ACCESS" }, NOW);
    expect(access.status).toBe("opened");
    if (access.status !== "opened") return;
    expect(await pro.answer(access.id, { outcome: "FULFILLED" }, NOW)).toEqual({ status: "answered" });
    expect([await cacheOf("st-1"), await payloadsOf("st-1")]).toEqual(before.st1);
    // 2. a DELETION declined (with the reason): nothing erased
    const declined = await student.open("st-1", { kind: "DATA_DELETION" }, NOW);
    if (declined.status !== "opened") throw new Error("open");
    expect(await pro.answer(declined.id, { outcome: "DECLINED", note: "Preciso manter por obrigação legal." }, NOW)).toEqual({ status: "answered" });
    expect([await cacheOf("st-1"), await payloadsOf("st-1")]).toEqual(before.st1);
    // 3. a professional who does NOT attend the student cannot answer it, nor erase through the repository
    const second = await student.open("st-1", { kind: "DATA_DELETION" }, NOW);
    if (second.status !== "opened") throw new Error("open");
    expect(await dataRequestsFor(t.db, t.org("tech-a2")).answer(second.id, { outcome: "FULFILLED" }, NOW)).toEqual({ status: "not_found" });
    expect(await dataRequestsFor(t.db, t.org("tech-b", "org-b")).answer(second.id, { outcome: "FULFILLED" }, NOW)).toEqual({ status: "not_found" });
    expect(await aiPlanningFor(t.db, t.org("tech-a2")).eraseStudentAi("st-1")).toEqual({ cache: 0, payloads: 0 });
    expect(await aiPlanningFor(t.db, t.org("tech-b", "org-b")).eraseStudentAi("st-1")).toEqual({ cache: 0, payloads: 0 });
    expect([await cacheOf("st-1"), await payloadsOf("st-1")]).toEqual(before.st1);
    // 4. the deletion fulfilled by the professional who attends the student
    expect(await pro.answer(second.id, { outcome: "FULFILLED" }, NOW)).toEqual({ status: "answered" });
    expect([await cacheOf("st-1"), await payloadsOf("st-1")]).toEqual([0, 0]);
    // other students and other organizations are untouched
    expect([await cacheOf("st-3"), await payloadsOf("st-3")]).toEqual(before.st3);
    expect([await cacheOf("st-b"), await payloadsOf("st-b")]).toEqual(before.stB);
    // runs, the usage ledger and acceptances (hashes, counts, codes) stay
    expect(await t.n("SELECT COUNT(*) AS n FROM planning_runs")).toBe(runRows);
    expect(await t.n("SELECT COUNT(*) AS n FROM ai_usage_ledger")).toBe(ledgerRows);
    expect(await t.n("SELECT COUNT(*) AS n FROM blueprint_acceptances WHERE id = 'acc-1'")).toBe(1);
    expect(await t.first("SELECT status FROM planning_runs WHERE id = ?1", run1.runId)).toEqual({ status: "SUCCEEDED" });

    // what an erased run can no longer do: replay, be read as the latest suggestion, or be offered for acceptance
    expect(await svcA.plan(d1.planId, d1.revisionId, { idempotencyKey: key1.idempotency_key, baseContentVersion: key1.base_content_version, mode: "AI", answers: ANSWERS } as never)).toMatchObject({ ok: false });
    expect(await svcA.latest(d1.planId, d1.revisionId)).toBeNull();
    expect(await svcA.state(d1.planId, d1.revisionId)).toEqual({ state: "NONE" });
    expect(rules1.runId).not.toBe(run1.runId);
    // the proposal and the prescription are still readable: only the AI's derived data went
    expect(await plansFor(t.db, t.org("tech-a")).findRevision(d1.planId, d1.revisionId)).toMatchObject({ revision: { state: "DRAFT" } });
    // the cache went too: the same context is a real call again
    const again = t.spy();
    const fresh = ok(await t.service("tech-a", "org-a", { providers: { mock: again.provider } }).plan(d1.planId, d1.revisionId, (await body(d1, "AI", { answers: answers() })) as never));
    expect(fresh.cache).toBe("MISS");
    expect(again.calls).toHaveLength(1);
    // and an audit trail of the request is untouched
    expect(await t.n("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = 'DATA_REQUEST_ANSWERED'")).toBe(3);
  });

  it("an answer whose AI erasure cannot run leaves the request open (no half-answered state)", async () => {
    // a request of a student the professional attends, answered by someone who lost the assignment meanwhile: not found, nothing erased, still open
    const student = studentRequestsFor(t.db, "owner-a");
    const req = await student.open("st-1", { kind: "ACCEPTANCE_WITHDRAWAL" }, NOW);
    if (req.status !== "opened") throw new Error("open");
    expect(await dataRequestsFor(t.db, t.org("tech-off")).answer(req.id, { outcome: "FULFILLED" }, NOW)).toEqual({ status: "not_found" });
    expect(await t.n("SELECT COUNT(*) AS n FROM data_subject_request_outcomes WHERE request_id = ?1", req.id)).toBe(0);
    // withdrawal of acceptance, fulfilled by the attending professional, also erases
    const d = await t.newDraft("st-1");
    ok(await t.service("tech-a", "org-a").plan(d.planId, d.revisionId, (await body(d, "AI", { answers: answers() })) as never));
    expect(await cacheOf("st-1")).toBeGreaterThan(0);
    expect(await dataRequestsFor(t.db, t.org("tech-a")).answer(req.id, { outcome: "PARTIALLY_FULFILLED", note: "Mantidos só os registros obrigatórios." }, NOW)).toEqual({ status: "answered" });
    expect([await cacheOf("st-1"), await payloadsOf("st-1")]).toEqual([0, 0]);
  });
});
