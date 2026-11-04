import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { outputHashOf, proposalsFor, jsonChunks } from "@/db/prescription-proposals";
import { ADAPTER_ASSUMPTION_CODES } from "@/modules/prescricao/automatica/build-input";
import type { GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import { proposalService, withAdapter, type ProposalOutcome } from "@/modules/prescricao/automatica/service";
import { canonicalJson, generate, sha256Hex, type EngineInput, type EngineResult } from "@/modules/prescricao/motor";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Motor S6 on a real local D1 (Miniflare/workerd, migrations 0001–0045): the proposal repository and the proposal service the
// server actions call. Topics 9 (regeneração parcial), 10 (substituição de exercícios), 12 (concorrência e idempotência) and 13
// (isolamento entre organizações). Identities are rows, as the server derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const NOW = new Date("2026-11-20T15:00:00Z");
const service = (userId = "tech-a", organizationId = "org-a", workUnitsPerRequest?: number) =>
  proposalService(db, scope(userId, organizationId), { now: () => NOW, ...(workUnitsPerRequest ? { workUnitsPerRequest } : {}) });
const repo = (userId = "tech-a", organizationId = "org-a") => proposalsFor(db, scope(userId, organizationId));
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
let seq = 0;
const id = (label: string) => `${label}-${String(++seq).padStart(4, "0")}-0000-0000-000000000000`.slice(0, 40);

const V2 = {
  schemaVersion: 2, startDate: "2026-11-23",
  phases: [
    { name: "Base", weeks: 3, sessionsPerWeek: 2, workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 }], trainingDays: [0, 3] },
    { name: "Força", weeks: 2, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 3 }] },
    { name: "Pico", weeks: 1, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 2 }] },
  ],
};
const ANSWERS: GenerationAnswersInput = {
  stimulusByPhase: [
    { phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" },
    { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" },
    { phaseIndex: 3, value: "STRENGTH", basis: "PROFESSIONAL" },
  ],
  equipmentCodes: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE", "PULL_UP_BAR"],
};

function ok(outcome: ProposalOutcome) {
  if (!outcome.ok) throw new Error(`${outcome.reason}: ${outcome.message}`);
  return outcome;
}
const failure = (outcome: ProposalOutcome) => (outcome.ok ? "ok" : outcome.reason);

interface Draft {
  planId: string;
  revisionId: string;
}
async function newDraft(student = "st-1", input: unknown = V2): Promise<Draft> {
  const created = await plansFor(db, scope("tech-a")).create(student, { title: "Plano gerado", input: input as never });
  if (!created) throw new Error("plan");
  return created;
}
async function contentVersion(d: Draft) {
  return count("SELECT content_version AS n FROM plan_revisions WHERE id = ?1", d.revisionId);
}
async function generated(d: Draft, answers: GenerationAnswersInput = ANSWERS, who = service()) {
  return ok(await who.generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: await contentVersion(d), answers }));
}
async function snapshot(d: Draft, proposalId: string) {
  const snap = await repo().asEngineResult(d.planId, d.revisionId, proposalId);
  if (!snap) throw new Error("snapshot");
  return snap;
}
/** Stored item rows by session: "phase/week/slot" -> exercise ids in order. */
async function picks(proposalId: string) {
  const rows = await db
    .prepare(
      `SELECT o.phase_index AS p, o.week_index AS w, o.slot_index AS s, i.exercise_id AS e, i.id AS id, i.origin AS origin
       FROM proposal_items i JOIN proposal_occurrences o ON o.id = i.proposal_occurrence_id
       WHERE i.proposal_id = ?1 ORDER BY o.phase_index, o.week_index, o.slot_index, i.position`,
    )
    .bind(proposalId)
    .all<{ p: number; w: number; s: number; e: string; id: string; origin: string }>();
  const out = new Map<string, { exercises: string[]; ids: string[]; origins: string[] }>();
  for (const r of rows.results) {
    const k = `${r.p}/${r.w}/${r.s}`;
    const v = out.get(k) ?? { exercises: [], ids: [], origins: [] };
    v.exercises.push(r.e);
    v.ids.push(r.id);
    v.origins.push(r.origin);
    out.set(k, v);
  }
  return out;
}
const cas = (version: number) => ({ writeId: id("write"), expectedVersion: version });

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "prescription-proposals-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["tech-a", "tech-a2", "commercial-a", "tech-off", "tech-rev", "tech-ra", "tech-b", "client-1", "owner-a"];
  await db.batch([
    ...people.map((p) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(p, `${p}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-a','tech-off','TECHNICAL'),('org-a','tech-rev','TECHNICAL'),('org-a','tech-ra','TECHNICAL'),
       ('org-a','owner-a','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-a2','org-a','tech-a2','Pro A2'),
       ('pro-off','org-a','tech-off','Off'),('pro-rev','org-a','tech-rev','Rev'),('pro-ra','org-a','tech-ra','Ra'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-b','org-b','B')"),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-1','pro-off'),
       ('org-a','st-1','pro-rev'),('org-a','st-1','pro-ra'),('org-b','st-b','pro-b')`,
    ),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
    db.prepare(
      `INSERT INTO student_profiles(student_id,organization_id,goal,level,days_per_week,session_minutes,injuries,updated_by_user_id)
       VALUES ('st-1','org-a','Hipertrofia','Intermediário',3,60,'SEGREDO-LESAO','tech-a')`,
    ),
    // An exercise of another organization: never usable by org-a, even by id.
    db.prepare(
      `INSERT INTO exercises(id, organization_id, name, name_key, category, source, created_at, updated_at)
       VALUES ('ex-org-b', 'org-b', 'Exercício B', 'exercício b', 'Peito', 'ORGANIZATION', 'x', 'x')`,
    ),
  ]);
  await run("UPDATE users SET disabled_at = 'x' WHERE id = 'tech-off'");
  await run("UPDATE memberships SET revoked_at = 'x' WHERE user_id = 'tech-rev'");
  await run("UPDATE care_assignments SET revoked_at = 'x' WHERE professional_id = 'pro-ra'");
});
afterAll(async () => {
  await mf?.dispose();
});

describe("generating a proposal (ledger, rows, replay)", () => {
  it("records the proposal, its ledger, the deletable input, sessions, items, decision and event; the stored rows are the result", async () => {
    const d = await newDraft();
    const before = await contentVersion(d);
    const out = await generated(d);
    expect(out).toMatchObject({ version: 1, complete: true, replayed: false });
    const snap = await snapshot(d, out.proposalId);
    expect(snap.header).toMatchObject({ state: "OPEN", version: 1, baseContentVersion: before, complete: true, phasesGenerated: [1, 2, 3] });
    // 3×2 + 2×1 + 1×1 sessions, each with its items; the read-back result hashes to the stored output hash.
    expect(snap.result.occurrences).toHaveLength(9);
    expect(snap.result.occurrences.every((o) => o.items.length > 0)).toBe(true);
    expect(await outputHashOf(snap.result)).toBe(snap.header.outputHash);
    // Generation never touches the prescription: no row, content version unchanged.
    expect(await contentVersion(d)).toBe(before);
    expect(await count("SELECT COUNT(*) AS n FROM prescribed_exercises WHERE revision_id = ?1", d.revisionId)).toBe(0);
    const gen = await db.prepare("SELECT * FROM prescription_generations WHERE proposal_id = ?1").bind(out.proposalId).all<Record<string, unknown>>();
    expect(gen.results).toHaveLength(1);
    expect(gen.results[0]).toMatchObject({ scope: "FULL", engine_version: "2.0.0", rules_id: "gymgital-base", status: snap.header.status, output_hash: snap.header.outputHash });
    expect(String(gen.results[0].catalog_hash)).toMatch(/^[0-9a-f]{64}$/);
    const input = await db.prepare("SELECT student_id AS s, input_json AS j FROM prescription_generation_inputs WHERE generation_id = ?1").bind(gen.results[0].id).first<{ s: string; j: string }>();
    expect(input!.s).toBe("st-1");
    // Replay from the deletable input store reproduces the output hash.
    const stored = JSON.parse(input!.j) as { input: EngineInput; adapter: Pick<EngineResult, "assumptions" | "issues"> };
    expect(await sha256Hex(canonicalJson(withAdapter(generate(stored.input), stored.adapter)))).toBe(gen.results[0].output_hash);
    expect(await count("SELECT COUNT(*) AS n FROM proposal_decisions WHERE proposal_id = ?1 AND action = 'GENERATED'", out.proposalId)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM training_plan_events WHERE revision_id = ?1 AND action = 'PROPOSAL_GENERATED'", d.revisionId)).toBe(1);
    // No health free text in the append-only tables (the profile's injuries text is a marker).
    const ledger = await db.prepare("SELECT facts_json || scope_json || issue_codes_json AS t FROM prescription_generations").all<{ t: string }>();
    const decisions = await db.prepare("SELECT target_json || coalesce(change_json, '') AS t FROM proposal_decisions").all<{ t: string }>();
    for (const row of [...ledger.results, ...decisions.results]) expect(row.t).not.toContain("SEGREDO");
    expect(input!.j).not.toContain("SEGREDO");
    // The adapter's assumptions are in the stored result, each with a code the merger knows.
    const adapterCodes = new Set<string>(ADAPTER_ASSUMPTION_CODES);
    expect(snap.result.assumptions.some((a) => a.code === "HISTORY_WINDOW")).toBe(true);
    expect(stored.adapter.assumptions.every((a) => adapterCodes.has(a.code))).toBe(true);
    // view: one page (phase 1, week 2) and lastAnswers (the answers of the newest proposal of the plan).
    const page = await repo().view(d.planId, d.revisionId, out.proposalId, { phaseIndex: 1, week: 2 });
    expect(page!.occurrences.map((o) => `${o.phaseIndex}/${o.week}/${o.slot}`)).toEqual(["1/2/1", "1/2/2"]);
    expect((await repo().lastAnswers(d.planId))!.answers).toMatchObject({ equipmentCodes: ANSWERS.equipmentCodes });
  });

  it("asks the required questions instead of generating, and writes nothing", async () => {
    const d = await newDraft();
    const out = await service().generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: await contentVersion(d), answers: {} });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("questions");
    expect(out.questions!.filter((q) => q.required).map((q) => q.code)).toEqual(expect.arrayContaining(["STIMULUS", "EQUIPMENT"]));
    expect(await count("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", d.revisionId)).toBe(0);
  });

  it("generates the phases that fit one request and continues with the rest", async () => {
    const d = await newDraft();
    // Budget of one phase 1's work (6 sessions × 64 exercises): phase 1 alone, then 2 and 3 together.
    const small = service("tech-a", "org-a", 6 * 64);
    const out = await generated(d, ANSWERS, small);
    expect(out.complete).toBe(false);
    expect((await snapshot(d, out.proposalId)).header.phasesGenerated).toEqual([1]);
    // From a phase on needs every phase from there generated.
    expect(failure(await small.regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1), scope: { kind: "FROM_PHASE", phaseIndex: 1 } }))).toBe("incomplete");
    const next = ok(await small.continue(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1) }));
    expect(next).toMatchObject({ version: 2, complete: true });
    const snap = await snapshot(d, out.proposalId);
    expect(snap.header.phasesGenerated).toEqual([1, 2, 3]);
    expect(snap.result.occurrences).toHaveLength(9);
    expect(failure(await small.continue(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(2) }))).toBe("already_complete");
    expect(await count("SELECT COUNT(*) AS n FROM proposal_decisions WHERE proposal_id = ?1 AND action = 'CONTINUED'", out.proposalId)).toBe(1);
  });

  it("chunks rows by bytes, never splitting a row", () => {
    const rows = Array.from({ length: 10 }, (_, n) => ({ n, text: "x".repeat(100) }));
    const chunks = jsonChunks(rows, 300);
    expect(chunks.flatMap((c) => JSON.parse(c) as unknown[])).toEqual(rows);
    expect(chunks.every((c) => c.length <= 300 || (JSON.parse(c) as unknown[]).length === 1)).toBe(true);
  });
});

describe("topic 12: concurrency and idempotency", () => {
  it("the same key twice (one after the other, and at once) is one generation; another payload with it is refused", async () => {
    const d = await newDraft();
    const base = await contentVersion(d);
    const key = id("gen");
    const first = ok(await service().generate(d.planId, d.revisionId, { idempotencyKey: key, baseContentVersion: base, answers: ANSWERS }));
    const again = ok(await service().generate(d.planId, d.revisionId, { idempotencyKey: key, baseContentVersion: base, answers: ANSWERS }));
    expect(again).toMatchObject({ proposalId: first.proposalId, replayed: true });
    expect(failure(await service().generate(d.planId, d.revisionId, { idempotencyKey: key, baseContentVersion: base, answers: { ...ANSWERS, availableMinutes: 45 } }))).toBe("key_reused");
    expect(await count("SELECT COUNT(*) AS n FROM prescription_generations WHERE revision_id = ?1", d.revisionId)).toBe(1);

    const other = await newDraft();
    const otherBase = await contentVersion(other);
    const k2 = id("gen");
    const both = await Promise.all([1, 2].map(() => service().generate(other.planId, other.revisionId, { idempotencyKey: k2, baseContentVersion: otherBase, answers: ANSWERS })));
    expect(both.every((o) => o.ok)).toBe(true);
    expect(new Set(both.map((o) => (o.ok ? o.proposalId : "")))).toHaveProperty("size", 1);
    expect(both.filter((o) => o.ok && o.replayed)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", other.revisionId)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM proposal_decisions d JOIN prescription_proposals p ON p.id = d.proposal_id WHERE p.revision_id = ?1", other.revisionId)).toBe(1);
  });

  it("two different keys at once: one proposal, the other told one is open; a new key later is told the same", async () => {
    const d = await newDraft();
    const base = await contentVersion(d);
    const both = await Promise.all([id("gen"), id("gen")].map((k) => service().generate(d.planId, d.revisionId, { idempotencyKey: k, baseContentVersion: base, answers: ANSWERS })));
    expect(both.map(failure).sort()).toEqual(["ok", "open_exists"]);
    expect(failure(await service().generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: base, answers: ANSWERS }))).toBe("open_exists");
    expect(await count("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1 AND state = 'OPEN'", d.revisionId)).toBe(1);
  });

  it("a generation on an old content version is refused; so is the repository write when the draft changes in between", async () => {
    const d = await newDraft();
    const base = await contentVersion(d);
    await prescriptionFor(db, scope("tech-a")).add(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { customName: "Mobilidade" });
    const stale = await service().generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: base, answers: ANSWERS });
    expect(stale).toMatchObject({ ok: false, reason: "revision_changed", contentVersion: base + 1 });
    // The repository's own compare-and-set: a record built at `base` cannot land after the draft moved on.
    const result = generate({ ...(await import("./helpers/motor-fixtures")).baseInput() });
    const rec = {
      idempotencyKey: id("gen"), requestHash: "0".repeat(64), scope: "FULL" as const, scopeJson: {}, baseContentVersion: base,
      catalogHash: "0".repeat(64), inputHash: "0".repeat(64), facts: {}, studentId: "st-1", inputJson: null, parameters: {},
    };
    expect(await repo().recordGeneration(d.planId, d.revisionId, rec, result, NOW)).toEqual({ status: "revision_changed", contentVersion: base + 1 });
    expect(await count("SELECT COUNT(*) AS n FROM prescription_proposals WHERE revision_id = ?1", d.revisionId)).toBe(0);
  });

  it("compare-and-set on the version; a retried write id is saved once; a manual edit forces a rebase", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const snap = await snapshot(d, out.proposalId);
    const target = snap.result.occurrences[0];
    const regen = { proposalId: out.proposalId, scope: { kind: "OCCURRENCE" as const, phaseIndex: 1, week: target.week, slot: target.slot }, answers: { ...ANSWERS, excludedExerciseIds: [target.items[0].exerciseId!] } };
    const intent = { idempotencyKey: id("key"), ...cas(1) };
    const saved = ok(await service().regenerate(d.planId, d.revisionId, { ...regen, ...intent }));
    expect(saved).toMatchObject({ version: 2, replayed: false });
    // Same intent again (a retry after a lost answer): replayed, nothing written twice.
    expect(ok(await service().regenerate(d.planId, d.revisionId, { ...regen, ...intent }))).toMatchObject({ version: 2, replayed: true });
    // Same key, different payload: refused.
    expect(failure(await service().regenerate(d.planId, d.revisionId, { ...regen, ...intent, scope: { kind: "WEEK", phaseIndex: 1, week: 2 } }))).toBe("key_reused");
    // A new intent on the old version: conflict, with the current version.
    expect(await service().regenerate(d.planId, d.revisionId, { ...regen, idempotencyKey: id("key"), ...cas(1) })).toMatchObject({ ok: false, reason: "conflict", version: 2 });
    // Two new intents on the same version at once: exactly one lands.
    const race = await Promise.all([1, 2].map(() => service().lock(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(2), targets: [{ phaseIndex: 1, slotKey: snap.result.occurrences[1].items[1].slotKey }], locked: true })));
    expect(race.map(failure).sort()).toEqual(["conflict", "ok"]);
    expect(await count("SELECT COUNT(*) AS n FROM proposal_decisions WHERE proposal_id = ?1", out.proposalId)).toBe(3);
    expect(await count("SELECT COUNT(*) AS n FROM prescription_generations WHERE proposal_id = ?1", out.proposalId)).toBe(2);

    // The professional edits the draft by hand: the proposal is now on an old base and every engine run is refused...
    const rx = prescriptionFor(db, scope("tech-a"));
    expect((await rx.add(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { customName: "Alongamento do professor" })).status).toBe("saved");
    expect(failure(await service().regenerate(d.planId, d.revisionId, { ...regen, idempotencyKey: id("key"), ...cas(3) }))).toBe("revision_changed");
    // ...until a rebase brings the new row in as preserved and moves the base forward.
    const rebased = ok(await service().rebase(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(3) }));
    expect(rebased.version).toBe(4);
    const after = await snapshot(d, out.proposalId);
    expect(after.header.baseContentVersion).toBe(await contentVersion(d));
    const workoutA = after.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A");
    expect(workoutA.every((o) => o.items.some((i) => i.origin === "PRESERVED" && i.exerciseName === "Alongamento do professor"))).toBe(true);
    expect(after.result.occurrences.filter((o) => o.label === "B").every((o) => o.items.every((i) => i.origin !== "PRESERVED"))).toBe(true);
    expect(ok(await service().regenerate(d.planId, d.revisionId, { ...regen, idempotencyKey: id("key"), ...cas(4) })).version).toBe(5);
    // A preserved row cannot be locked: it is kept anyway.
    const preserved = workoutA[0].items.find((i) => i.origin === "PRESERVED")!;
    expect(failure(await service().lock(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(5), targets: [{ phaseIndex: 1, slotKey: preserved.slotKey }], locked: true }))).toBe("invalid_target");
  });

  it("a closed proposal refuses every change, and the database keeps its rows frozen", async () => {
    const d = await newDraft();
    const out = await generated(d);
    expect(ok(await service().discard(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(1) })).version).toBe(2);
    const snap = await snapshot(d, out.proposalId);
    expect(snap.header.state).toBe("DISCARDED");
    expect(failure(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(2), scope: { kind: "PHASE", phaseIndex: 1 } }))).toBe("closed");
    expect(failure(await service().lock(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(2), targets: [{ phaseIndex: 1, slotKey: snap.result.occurrences[0].items[0].slotKey }], locked: true }))).toBe("closed");
    expect(failure(await service().discard(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(2) }))).toBe("closed");
    await expect(run("UPDATE proposal_items SET position = position + 10 WHERE proposal_id = ?1", out.proposalId)).rejects.toThrow(/PROPOSAL_CLOSED/);
    await expect(run("DELETE FROM proposal_items WHERE proposal_id = ?1", out.proposalId)).rejects.toThrow(/PROPOSAL_CLOSED/);
    await expect(run("UPDATE prescription_proposals SET summary_json = '{}' WHERE id = ?1", out.proposalId)).rejects.toThrow(/PROPOSAL_CLOSED/);
    // A new proposal can be generated once the old one is closed.
    expect((await generated(d)).proposalId).not.toBe(out.proposalId);
    // History reads every proposal with its generations and decisions.
    const history = await repo().history(d.planId, d.revisionId);
    expect(history.proposals.map((p) => p.state)).toEqual(["DISCARDED", "OPEN"]);
    expect(history.proposals[0].decisions.map((x) => x.action)).toEqual(["GENERATED", "DISCARD"]);
    expect(history.proposals[0].generations[0]).toMatchObject({ scope: "FULL", inputStored: true });
  });

  it("marking the draft ready supersedes the open proposal; nothing more can be done on it", async () => {
    const d = await newDraft();
    const out = await generated(d);
    expect(await plansFor(db, scope("tech-a")).markReady(d.planId, d.revisionId, NOW)).toBe(true);
    expect((await repo().header(d.planId, d.revisionId, out.proposalId, "ANY"))!.state).toBe("SUPERSEDED");
    expect(failure(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(2), scope: { kind: "PHASE", phaseIndex: 1 } }))).toBe("not_found");
    expect(failure(await service().generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: await contentVersion(d), answers: ANSWERS }))).toBe("not_open");
  });
});

describe("topic 9: partial regeneration", () => {
  it("one session, one item, a week, a workout from a week on, a phase and from a phase on: only that scope changes", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const first = await picks(out.proposalId);
    const s0 = await snapshot(d, out.proposalId);
    // An exercise present in every session of workout A of phase 1.
    const shared = s0.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A").map((o) => o.items.map((i) => i.exerciseId));
    const common = shared[0].find((e) => shared.every((list) => list.includes(e)))!;
    const without = { ...ANSWERS, excludedExerciseIds: [common] };
    const keysOfA = [...first.keys()].filter((k) => first.get(k)!.exercises.includes(common));

    // OCCURRENCE: only phase 1, week 2 session of workout A (slot 1) is redone; every other stored row keeps its id.
    const occ = keysOfA.find((k) => k.startsWith("1/2/"))!;
    const [, w, s] = occ.split("/").map(Number);
    ok(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1), scope: { kind: "OCCURRENCE", phaseIndex: 1, week: w, slot: s }, answers: without }));
    let now = await picks(out.proposalId);
    expect(now.get(occ)!.exercises).not.toContain(common);
    for (const k of first.keys()) if (k !== occ) expect(now.get(k)!.ids).toEqual(first.get(k)!.ids);
    expect(await count("SELECT COUNT(*) AS n FROM prescription_generations WHERE proposal_id = ?1 AND scope = 'OCCURRENCE'", out.proposalId)).toBe(1);

    // ITEM: the engine picks another exercise for one item of one session; the rest of that session stays.
    const itemOcc = now.get("1/1/1")!;
    const itemSlot = (await snapshot(d, out.proposalId)).result.occurrences.find((o) => o.phaseIndex === 1 && o.week === 1 && o.slot === 1)!.items[2];
    ok(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(2), scope: { kind: "ITEM", phaseIndex: 1, week: 1, slot: 1, slotKey: itemSlot.slotKey } }));
    const afterItem = await picks(out.proposalId);
    expect(afterItem.get("1/1/1")!.exercises[2]).not.toBe(itemOcc.exercises[2]);
    expect(afterItem.get("1/1/1")!.exercises.slice(0, 2)).toEqual(itemOcc.exercises.slice(0, 2));
    for (const k of now.keys()) if (k !== "1/1/1") expect(afterItem.get(k)!.ids).toEqual(now.get(k)!.ids);
    now = afterItem;

    // WEEK 3 of phase 1: both sessions of week 3 redone, weeks 1–2 untouched.
    ok(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(3), scope: { kind: "WEEK", phaseIndex: 1, week: 3 }, answers: without }));
    let next = await picks(out.proposalId);
    for (const k of next.keys()) {
      if (k.startsWith("1/3/")) expect(next.get(k)!.exercises).not.toContain(common);
      else expect(next.get(k)!.ids).toEqual(now.get(k)!.ids);
    }
    now = next;

    // WORKOUT A from week 2 (the professional moves the exclusion back off): weeks ≥ 2 of A redone, B and week 1 untouched.
    ok(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(4), scope: { kind: "WORKOUT", phaseIndex: 1, label: "A", fromWeek: 2 }, answers: ANSWERS }));
    next = await picks(out.proposalId);
    const label = new Map((await snapshot(d, out.proposalId)).result.occurrences.map((o) => [`${o.phaseIndex}/${o.week}/${o.slot}`, o.label]));
    for (const k of next.keys()) {
      const [p, wk] = k.split("/").map(Number);
      if (p === 1 && wk >= 2 && label.get(k) === "A") expect(next.get(k)!.exercises).toContain(common);
      else if (!(p === 1 && wk >= 2 && label.get(k) === "A")) expect(next.get(k)!.ids).toEqual(now.get(k)!.ids);
    }
    now = next;

    // PHASE 2 with the exclusion of an exercise of phase 2: phases 1 and 3 untouched.
    const p2 = (await snapshot(d, out.proposalId)).result.occurrences.find((o) => o.phaseIndex === 2)!.items[0].exerciseId!;
    ok(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(5), scope: { kind: "PHASE", phaseIndex: 2 }, answers: { ...ANSWERS, excludedExerciseIds: [p2] } }));
    next = await picks(out.proposalId);
    for (const k of next.keys()) {
      if (k.startsWith("2/")) expect(next.get(k)!.exercises).not.toContain(p2);
      else expect(next.get(k)!.ids).toEqual(now.get(k)!.ids);
    }
    now = next;

    // FROM_PHASE 2 back to the original answers: phase 1 untouched, phases 2 and 3 equal the first generation's exercises.
    ok(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(6), scope: { kind: "FROM_PHASE", phaseIndex: 2 }, answers: ANSWERS }));
    next = await picks(out.proposalId);
    for (const k of next.keys()) {
      if (k.startsWith("1/")) expect(next.get(k)!.ids).toEqual(now.get(k)!.ids);
      else expect(next.get(k)!.exercises).toEqual(first.get(k)!.exercises);
    }
    const decisions = await db.prepare("SELECT action FROM proposal_decisions WHERE proposal_id = ?1 ORDER BY created_at, rowid").bind(out.proposalId).all<{ action: string }>();
    expect(decisions.results.map((x) => x.action)).toEqual([
      "GENERATED", "REGENERATE_OCCURRENCE", "REGENERATE_ITEM", "REGENERATE_WEEK", "REGENERATE_WORKOUT", "REGENERATE_PHASE", "REGENERATE_FROM_PHASE",
    ]);
    // Stored rows still equal the stored result after every partial write.
    const final = await snapshot(d, out.proposalId);
    expect(await outputHashOf(final.result)).toBe(final.header.outputHash);
    expect(final.header.version).toBe(7);
  });

  it("a locked item is kept by a regeneration; unlocking gives it back to the engine; scopes outside the structure are refused", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const s0 = await snapshot(d, out.proposalId);
    const held = s0.result.occurrences.find((o) => o.phaseIndex === 1 && o.label === "B")!.items[0];
    ok(await service().lock(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(1), targets: [{ phaseIndex: 1, slotKey: held.slotKey }], locked: true }));
    const lockedRows = await count("SELECT COUNT(*) AS n FROM proposal_items WHERE proposal_id = ?1 AND slot_key = ?2 AND origin = 'LOCKED'", out.proposalId, held.slotKey);
    expect(lockedRows).toBe(s0.result.occurrences.filter((o) => o.items.some((i) => i.slotKey === held.slotKey)).length);
    // Regenerate phase 1 excluding another exercise of workout B: the locked one stays, with the same dose.
    const other = s0.result.occurrences.find((o) => o.phaseIndex === 1 && o.label === "B")!.items[1].exerciseId!;
    ok(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(2), scope: { kind: "PHASE", phaseIndex: 1 }, answers: { ...ANSWERS, excludedExerciseIds: [other] } }));
    const s1 = await snapshot(d, out.proposalId);
    for (const o of s1.result.occurrences.filter((x) => x.phaseIndex === 1 && x.label === "B")) {
      const kept = o.items.find((i) => i.exerciseId === held.exerciseId)!;
      expect(kept.origin).toBe("LOCKED");
      expect(kept.display.doseText).toBe(held.display.doseText);
      expect(o.items.map((i) => i.exerciseId)).not.toContain(other);
    }
    ok(await service().lock(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(3), targets: [{ phaseIndex: 1, slotKey: held.slotKey }], locked: false }));
    expect(await count("SELECT COUNT(*) AS n FROM proposal_items WHERE proposal_id = ?1 AND origin = 'LOCKED'", out.proposalId)).toBe(0);
    expect(failure(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(4), scope: { kind: "OCCURRENCE", phaseIndex: 1, week: 9, slot: 1 } }))).toBe("invalid_target");
    expect(failure(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(4), scope: { kind: "PHASE", phaseIndex: 7 } }))).toBe("invalid_target");
    expect(failure(await service().lock(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(4), targets: [{ phaseIndex: 1, slotKey: "[1,\"Z\",\"nada\",0]" }], locked: true }))).toBe("invalid_target");
  });

  it("an alert decision is recorded for the next regeneration and shown on the alert", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const s0 = await snapshot(d, out.proposalId);
    // st-1 has no assessment: the screening alert is there.
    expect(s0.result.flags.map((f) => f.code)).toContain("SCREENING_NOT_DONE");
    ok(await service().acceptFlagDecision(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(1), flagCode: "SCREENING_NOT_DONE", decision: { kind: "ACKNOWLEDGE" } }));
    const s1 = await snapshot(d, out.proposalId);
    expect(s1.result.flags.find((f) => f.code === "SCREENING_NOT_DONE")!.decided).toEqual({ kind: "ACKNOWLEDGE" });
    expect(s1.header.parameters).toMatchObject({ acceptedFlagDecisions: [{ flagCode: "SCREENING_NOT_DONE", decision: { kind: "ACKNOWLEDGE" } }] });
    // The next regeneration keeps the decision (it is in the answers now).
    ok(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(2), scope: { kind: "PHASE", phaseIndex: 3 } }));
    expect((await snapshot(d, out.proposalId)).result.flags.find((f) => f.code === "SCREENING_NOT_DONE")!.decided).toEqual({ kind: "ACKNOWLEDGE" });
    expect(failure(await service().acceptFlagDecision(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(3), flagCode: "NAO_EXISTE", decision: { kind: "ACKNOWLEDGE" } }))).toBe("invalid_target");
    expect(failure(await service().acceptFlagDecision(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(3), flagCode: "SCREENING_NOT_DONE", decision: { kind: "EXCLUDE_EXERCISE", exerciseId: "ex-org-b" } }))).toBe("unknown_exercise");
  });
});

describe("topic 10: substitution", () => {
  it("in one session, from a week on, and in the whole phase; the professional's choice survives a regeneration", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const s0 = await snapshot(d, out.proposalId);
    const a = s0.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A");
    const item = a[0].items[0];
    const usedInA = new Set(a.flatMap((o) => o.items.map((i) => i.exerciseId)));
    // An eligible exercise of the same pattern family is what a professional would pick; any visible, unused one works here.
    const alternatives = item.alternatives.filter((x) => !usedInA.has(x));
    expect(alternatives.length).toBeGreaterThan(0);
    const chosen = alternatives[0];

    // One session (week 1 of workout A).
    ok(await service().substitute(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1), newExerciseId: chosen,
      target: { phaseIndex: 1, slotKey: item.slotKey, applies: { kind: "OCCURRENCE", week: a[0].week, slot: a[0].slot } } }));
    let s = await snapshot(d, out.proposalId);
    const inA = (week: number) => s.result.occurrences.find((o) => o.phaseIndex === 1 && o.label === "A" && o.week === week)!;
    const swapped = inA(1).items.find((i) => i.exerciseId === chosen)!;
    expect(swapped).toMatchObject({ origin: "SUBSTITUTED", substitutesSlotKey: item.slotKey, position: item.position });
    expect(swapped.trace.selection[0]).toMatchObject({ code: "PROFESSIONAL_SUBSTITUTION", basis: "PROFESSIONAL" });
    expect(inA(2).items.map((i) => i.exerciseId)).toContain(item.exerciseId);
    expect(inA(2).items.map((i) => i.exerciseId)).not.toContain(chosen);

    // From week 2 on (the original slot, still in weeks 2 and 3).
    ok(await service().substitute(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(2), newExerciseId: chosen,
      target: { phaseIndex: 1, slotKey: item.slotKey, applies: { kind: "FROM_WEEK", week: 2 } } }));
    s = await snapshot(d, out.proposalId);
    for (const wk of [1, 2, 3]) expect(inA(wk).items.map((i) => i.exerciseId)).toContain(chosen);
    expect(s.result.occurrences.filter((o) => o.label === "A").every((o) => !o.items.some((i) => i.slotKey === item.slotKey))).toBe(true);

    // The whole phase, on workout B.
    const b = s.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "B");
    const bItem = b[0].items[1];
    const usedInB = new Set(b.flatMap((o) => o.items.map((i) => i.exerciseId)));
    const bChoice = bItem.alternatives.find((x) => !usedInB.has(x))!;
    ok(await service().substitute(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(3), newExerciseId: bChoice,
      target: { phaseIndex: 1, slotKey: bItem.slotKey, applies: { kind: "PHASE" } } }));
    s = await snapshot(d, out.proposalId);
    expect(s.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "B").every((o) => o.items.some((i) => i.exerciseId === bChoice && i.origin === "SUBSTITUTED"))).toBe(true);

    // A regeneration of phase 1 keeps the professional's substitutions (dose recomputed with the current parameters).
    ok(await service().regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(4), scope: { kind: "PHASE", phaseIndex: 1 } }));
    s = await snapshot(d, out.proposalId);
    expect(s.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A").every((o) => o.items.some((i) => i.exerciseId === chosen && i.origin === "SUBSTITUTED"))).toBe(true);
    expect(s.result.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "B").every((o) => o.items.some((i) => i.exerciseId === bChoice && i.origin === "SUBSTITUTED"))).toBe(true);
    // Phases 2 and 3 never changed.
    for (const o of s.result.occurrences.filter((x) => x.phaseIndex > 1))
      expect(o.items.map((i) => i.exerciseId)).toEqual(s0.result.occurrences.find((x) => x.phaseIndex === o.phaseIndex && x.week === o.week && x.slot === o.slot)!.items.map((i) => i.exerciseId));
    expect(await count("SELECT COUNT(*) AS n FROM proposal_decisions WHERE proposal_id = ?1 AND action = 'SUBSTITUTE'", out.proposalId)).toBe(3);
  });

  it("refuses an exercise of another organization, an archived one, an unknown one, and an item that is not there", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const s0 = await snapshot(d, out.proposalId);
    const item = s0.result.occurrences[0].items[0];
    const target = { phaseIndex: 1, slotKey: item.slotKey, applies: { kind: "PHASE" as const } };
    await run(
      `INSERT INTO exercises(id, organization_id, name, name_key, category, source, archived_at, created_at, updated_at)
       VALUES ('ex-archived', 'org-a', 'Arquivado', 'arquivado', 'Peito', 'ORGANIZATION', 'x', 'x', 'x')`,
    );
    for (const newExerciseId of ["ex-org-b", "ex-archived", "nao-existe"])
      expect(failure(await service().substitute(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1), target, newExerciseId }))).toBe("unknown_exercise");
    const visible = item.alternatives[0];
    expect(failure(await service().substitute(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1), newExerciseId: visible,
      target: { phaseIndex: 1, slotKey: "[1,\"A\",\"nada\",0]", applies: { kind: "PHASE" } } }))).toBe("invalid_target");
    expect((await snapshot(d, out.proposalId)).header.version).toBe(1);
  });
});

describe("topic 13: isolation between organizations and access", () => {
  it("every read and every action answers not found without an active technical assignment in the organization", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const s0 = await snapshot(d, out.proposalId);
    const slotKey = s0.result.occurrences[0].items[0].slotKey;
    const outsiders: Array<[string, string]> = [
      ["tech-b", "org-b"], // other organization, with org-a's ids
      ["tech-b", "org-a"], // a forged organization id: no membership there
      ["tech-a2", "org-a"], // colleague without assignment
      ["owner-a", "org-a"], // owner without assignment: membership alone is not technical access
      ["commercial-a", "org-a"],
      ["tech-off", "org-a"], // disabled user
      ["tech-rev", "org-a"], // revoked membership
      ["tech-ra", "org-a"], // revoked assignment
      ["client-1", "org-a"], // the student's own login
    ];
    for (const [user, org] of outsiders) {
      const r = repo(user, org);
      expect(await r.open(d.planId, d.revisionId)).toBeNull();
      expect(await r.asEngineResult(d.planId, d.revisionId, out.proposalId)).toBeNull();
      expect(await r.view(d.planId, d.revisionId, out.proposalId, { phaseIndex: 1 })).toBeNull();
      expect(await r.header(d.planId, d.revisionId, out.proposalId, "ANY")).toBeNull();
      expect((await r.history(d.planId, d.revisionId)).proposals).toEqual([]);
      expect(await r.lastAnswers(d.planId)).toBeNull();
      const s = service(user, org);
      const reasons = [
        failure(await s.generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: 0, answers: ANSWERS })),
        failure(await s.continue(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1) })),
        failure(await s.regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1), scope: { kind: "PHASE", phaseIndex: 1 } })),
        failure(await s.substitute(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1), newExerciseId: "sys-001", target: { phaseIndex: 1, slotKey, applies: { kind: "PHASE" } } })),
        failure(await s.rebase(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(1) })),
        failure(await s.lock(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(1), targets: [{ phaseIndex: 1, slotKey }], locked: true })),
        failure(await s.acceptFlagDecision(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(1), flagCode: "SCREENING_NOT_DONE", decision: { kind: "ACKNOWLEDGE" } })),
        failure(await s.discard(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(1) })),
      ];
      expect([user, org, reasons]).toEqual([user, org, Array(8).fill("not_found")]);
    }
    // Nothing changed for the professional with access.
    const after = await snapshot(d, out.proposalId);
    expect(after.header).toMatchObject({ state: "OPEN", version: 1, outputHash: s0.header.outputHash });
    expect(await count("SELECT COUNT(*) AS n FROM proposal_decisions WHERE proposal_id = ?1", out.proposalId)).toBe(1);
    // Another organization's own draft: its professional generates there, and org-a cannot see it either.
    const theirs = (await plansFor(db, scope("tech-b", "org-b")).create("st-b", { title: "B", input: V2 as never }))!;
    const generatedB = ok(await service("tech-b", "org-b").generate(theirs.planId, theirs.revisionId, {
      idempotencyKey: id("gen"), baseContentVersion: await contentVersion(theirs), answers: ANSWERS,
    }));
    expect(await repo().asEngineResult(theirs.planId, theirs.revisionId, generatedB.proposalId)).toBeNull();
    // org-b's proposal never used org-a's exercises (its catalog is the system library and its own).
    const used = await db.prepare("SELECT DISTINCT exercise_id AS e FROM proposal_items WHERE proposal_id = ?1").bind(generatedB.proposalId).all<{ e: string }>();
    expect(used.results.every((r) => r.e.startsWith("sys-") || r.e === "ex-org-b")).toBe(true);
  });

  it("access revoked after a generation stops every action at once", async () => {
    const d = await newDraft();
    const out = await generated(d);
    await run("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a2')");
    const s = service("tech-a2");
    ok(await s.lock(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(1), targets: [{ phaseIndex: 1, slotKey: (await snapshot(d, out.proposalId)).result.occurrences[0].items[0].slotKey }], locked: true }));
    await run("UPDATE care_assignments SET revoked_at = 'x' WHERE professional_id = 'pro-a2'");
    expect(failure(await s.regenerate(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), ...cas(2), scope: { kind: "PHASE", phaseIndex: 1 } }))).toBe("not_found");
    expect(failure(await s.discard(d.planId, d.revisionId, { proposalId: out.proposalId, ...cas(2) }))).toBe("not_found");
    expect((await snapshot(d, out.proposalId)).header).toMatchObject({ state: "OPEN", version: 2 });
  });
});
