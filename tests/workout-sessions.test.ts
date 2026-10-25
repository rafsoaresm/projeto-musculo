import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executionFor, studentSessionsFor } from "@/db/workout-sessions";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { parseSession, parseLoadText } from "@/modules/execucao/contracts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration, triggers included. Identities are rows, as the server
// derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const FB = "Full Body";
const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 10, 0, 0) + minute * 60_000);
const NOW = new Date(Date.UTC(2026, 10, 12, 15, 0, 0)); // 12:00 in São Paulo
const TODAY = "2026-11-12";
const hoursAfter = (hours: number, from = NOW) => new Date(from.getTime() + hours * 3_600_000);

const planInput = {
  startDate: "2026-11-02",
  phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: FB, exercisesPerSession: 3 })),
};

/** A delivered plan with three Full Body exercises per phase. Returns the ids the student logs against. */
async function deliveredPlan(student = "st-1", owner = "tech-a") {
  const plans = plansFor(db, scope(owner));
  const rx = prescriptionFor(db, scope(owner));
  const created = (await plans.create(student, { title: `Plano ${crypto.randomUUID().slice(0, 6)}`, input: planInput }))!;
  for (let i = 0; i < 3; i++)
    await rx.add(created.planId, created.revisionId, { phaseIndex: 1, workoutLabel: FB }, { customName: `Exercício ${i + 1}` }, { sets: "3", reps: "10" });
  await rx.copyPhase(created.planId, created.revisionId, 1, 2);
  await rx.copyPhase(created.planId, created.revisionId, 1, 3);
  await plans.markReady(created.planId, created.revisionId);
  await plans.approve(created.planId, created.revisionId, { screeningNotRecorded: true }, at(1));
  await plans.deliver(created.planId, created.revisionId, at(2));
  const items = await rx.list(created.planId, created.revisionId);
  const phase1 = items.filter((item) => item.phaseIndex === 1).map((item) => item.id);
  const phase2 = items.filter((item) => item.phaseIndex === 2).map((item) => item.id);
  return { ...created, phase1, phase2 };
}

const log = (planId: string, exercises: unknown[], extra: Record<string, unknown> = {}) => ({
  planId, phaseIndex: 1, workoutLabel: FB, performedOn: TODAY, exercises, ...extra,
});
const done = (id: string, sets: Array<{ reps?: number; loadKg?: number }> = [{ reps: 10, loadKg: 20 }], extra: Record<string, unknown> = {}) => ({
  prescribedExerciseId: id, done: true, sets, ...extra,
});
const count = async (table: string, where = "1 = 1") =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())!.n;
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "workout-session-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "tech-a", "tech-a2", "commercial-a", "owner-b", "tech-b", "client-1", "client-1b", "client-2", "client-b", "client-off", "client-p", "client-q", "mgr-1"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    db.prepare("INSERT INTO users(id) VALUES ('owner-a'),('tech-a'),('tech-a2'),('commercial-a'),('owner-b'),('tech-b'),('client-1'),('client-1b'),('client-2'),('client-b'),('client-off'),('client-p'),('client-q'),('mgr-1')"),
    db.prepare("INSERT INTO platform_admins(user_id) VALUES ('mgr-1')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES
       ('org-a','owner-a','OWNER'),('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-b','owner-b','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner-a','org-a','owner-a','Owner A'),('pro-a','org-a','tech-a','Pro A'),
       ('pro-a2','org-a','tech-a2','Pro A2'),('pro-owner-b','org-b','owner-b','Owner B'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Student One'),('st-2','org-a','Student Two'),('st-b','org-b','Student B'),('st-off','org-a','Student Off'),('st-p','org-a','Student Progress'),('st-q','org-a','Student Own')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a2'),('org-a','st-off','pro-a'),('org-a','st-p','pro-a'),('org-a','st-q','pro-a'),('org-b','st-b','pro-b')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1'),('org-a','st-1','client-1b'),('org-a','st-2','client-2'),('org-b','st-b','client-b'),('org-a','st-off','client-off'),('org-a','st-p','client-p'),('org-a','st-q','client-q')"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("the contract of a log", () => {
  it("keeps only what the student did, noted or reported, and never invents a number", () => {
    const parsed = parseSession(
      log("p", [
        { prescribedExerciseId: "a", done: true, rir: 2, sets: [{ reps: 10, loadKg: 22.54 }, {}, { reps: 8 }] },
        { prescribedExerciseId: "b", done: false, rir: 3, sets: [{ reps: 5 }] },
        { prescribedExerciseId: "c", done: false, pain: true, notes: "  ombro  " },
        { prescribedExerciseId: "d" },
      ]),
      TODAY,
    );
    expect(parsed.exercises).toEqual([
      { prescribedExerciseId: "a", done: true, rir: 2, pain: false, notes: null, sets: [{ reps: 10, loadKg: 22.5 }, { reps: 8, loadKg: null }] },
      { prescribedExerciseId: "c", done: false, rir: null, pain: true, notes: "ombro", sets: [] },
    ]);
    expect(parsed.painReported).toBe(true);
    expect(parsed.effort).toBeNull();
  });

  it("refuses the future, old days, repeated exercises, impossible numbers and extra fields", () => {
    const bad = (value: unknown) => expect(() => parseSession(value, TODAY)).toThrow();
    bad(log("p", [], { performedOn: "2026-11-13" }));
    bad(log("p", [], { performedOn: "2026-10-28" }));
    expect(() => parseSession(log("p", [], { performedOn: "2026-10-29" }), TODAY)).not.toThrow();
    bad(log("p", [], { performedOn: "2026-02-30" }));
    bad(log("p", [done("a"), done("a")]));
    bad(log("p", [done("a", [{ reps: -1 }])]));
    bad(log("p", [done("a", [{ loadKg: 1001 }])]));
    bad(log("p", [done("a", [{ reps: 1.5 }])]));
    bad(log("p", [], { effort: 11 }));
    bad(log("p", [done("a", [], { rir: 11 })]));
    bad(log("p", [], { organizationId: "org-b" }));
    bad(log("p", [done("a", [], { studentId: "st-2" })]));
    bad(log("p", Array.from({ length: 13 }, () => ({ reps: 1 })).map((set) => done("a", [set])) ));
  });

  it("reads a load typed with a comma or a dot", () => {
    expect(parseLoadText("22,5")).toBe(22.5);
    expect(parseLoadText(" 22.5 ")).toBe(22.5);
    expect(parseLoadText("")).toBeNull();
    expect(parseLoadText("abc")).toBeNull();
    expect(parseLoadText("-3")).toBeNull();
    expect(parseLoadText("12345")).toBeNull();
  });
});

describe("the student logging a workout", () => {
  it("stores sets, effort and notes against the delivered exercises and changes nothing else", async () => {
    const plan = await deliveredPlan();
    const before = await db.prepare("SELECT state, updated_at AS u FROM plan_revisions WHERE id = ?1").bind(plan.revisionId).first();
    const student = studentSessionsFor(db, "client-1");
    const outcome = await student.save("st-1", log(plan.planId, [
      done(plan.phase1[0], [{ reps: 10, loadKg: 20 }, { reps: 9, loadKg: 20 }], { rir: 2 }),
      { prescribedExerciseId: plan.phase1[1], done: false, notes: "sem tempo" },
    ], { effort: 7, notes: "boa sessão" }), NOW);
    expect(outcome).toMatchObject({ status: "saved", created: true, painReported: false });
    if (outcome.status !== "saved") return;

    const saved = (await student.get(outcome.id, NOW))!;
    expect(saved).toMatchObject({
      planId: plan.planId, revisionId: plan.revisionId, phaseIndex: 1, workoutLabel: FB,
      performedOn: TODAY, effort: 7, notes: "boa sessão", painReported: false, acknowledged: false, editable: true,
    });
    expect(saved.exercises.map((e) => [e.name, e.done, e.rir, e.notes, e.sets])).toEqual([
      ["Exercício 1", true, 2, null, [{ setNumber: 1, reps: 10, loadKg: 20 }, { setNumber: 2, reps: 9, loadKg: 20 }]],
      ["Exercício 2", false, null, "sem tempo", []],
    ]);
    // The third exercise was not logged at all: it is not a row, and it is not "not done".
    expect(await count("session_exercises", `session_id = '${outcome.id}'`)).toBe(2);
    // The delivered revision is exactly what it was.
    expect(await db.prepare("SELECT state, updated_at AS u FROM plan_revisions WHERE id = ?1").bind(plan.revisionId).first()).toEqual(before);
    expect(await student.forWorkout("st-1", plan.planId, 1, FB, NOW)).toEqual([
      expect.objectContaining({ id: outcome.id, performedOn: TODAY, effort: 7, editable: true, acknowledged: false }),
    ]);
  });

  it("corrects the log of the same day inside the window, replacing what is under it", async () => {
    const plan = await deliveredPlan();
    const student = studentSessionsFor(db, "client-1");
    const first = await student.save("st-1", log(plan.planId, [done(plan.phase1[0], [{ reps: 10, loadKg: 20 }, { reps: 10, loadKg: 20 }])], { effort: 5 }), NOW);
    if (first.status !== "saved") throw new Error("expected saved");
    const second = await student.save("st-1", log(plan.planId, [done(plan.phase1[0], [{ reps: 12, loadKg: 25 }]), done(plan.phase1[2], [{ reps: 8 }])], { effort: 8 }), hoursAfter(5));
    expect(second).toMatchObject({ status: "saved", id: first.id, created: false });
    const saved = (await student.get(first.id, hoursAfter(5)))!;
    expect(saved.effort).toBe(8);
    expect(saved.exercises.map((e) => [e.name, e.sets.length])).toEqual([["Exercício 1", 1], ["Exercício 3", 1]]);
    expect(saved.exercises[0].sets).toEqual([{ setNumber: 1, reps: 12, loadKg: 25 }]);
    expect(await count("workout_sessions", `id = '${first.id}'`)).toBe(1);
    expect(await count("session_sets", `session_exercise_id IN (SELECT id FROM session_exercises WHERE session_id = '${first.id}')`)).toBe(2);
  });

  it("stops correcting a log after the window and keeps it as it was", async () => {
    const plan = await deliveredPlan();
    const student = studentSessionsFor(db, "client-1");
    const first = await student.save("st-1", log(plan.planId, [done(plan.phase1[0])], { effort: 4 }), NOW);
    if (first.status !== "saved") throw new Error("expected saved");
    const late = hoursAfter(25);
    expect(await student.save("st-1", log(plan.planId, [done(plan.phase1[0], [{ reps: 1, loadKg: 1 }])], { effort: 9 }), late)).toEqual({ status: "locked" });
    expect(await student.remove(first.id, late)).toEqual({ status: "locked" });
    expect((await student.get(first.id, late))!).toMatchObject({ editable: false, effort: 4 });
    // Inside the window it can still be removed, with everything under it.
    const other = await student.save("st-1", log(plan.planId, [done(plan.phase1[1])], { performedOn: "2026-11-11" }), NOW);
    if (other.status !== "saved") throw new Error("expected saved");
    expect(await student.remove(other.id, hoursAfter(2))).toEqual({ status: "removed" });
    expect(await student.get(other.id, NOW)).toBeNull();
    expect(await count("session_exercises", `session_id = '${other.id}'`)).toBe(0);
    expect(await student.remove(other.id, hoursAfter(2))).toEqual({ status: "not_found" });
  });

  it("keeps a report of pain: the session and what is under it are frozen, for the app and for the database", async () => {
    const plan = await deliveredPlan();
    const student = studentSessionsFor(db, "client-1");
    const outcome = await student.save("st-1", log(plan.planId, [
      done(plan.phase1[0], [{ reps: 6, loadKg: 40 }]),
      { prescribedExerciseId: plan.phase1[1], done: true, pain: true, notes: "dor no joelho", sets: [{ reps: 3, loadKg: 10 }] },
    ]), NOW);
    expect(outcome).toMatchObject({ status: "saved", painReported: true });
    if (outcome.status !== "saved") return;
    const saved = (await student.get(outcome.id, NOW))!;
    expect(saved).toMatchObject({ painReported: true, editable: false });
    expect(saved.exercises.map((e) => [e.name, e.pain])).toEqual([["Exercício 1", false], ["Exercício 2", true]]);

    // The application refuses to edit or delete it, inside the window too.
    expect(await student.save("st-1", log(plan.planId, [done(plan.phase1[0])]), hoursAfter(1))).toEqual({ status: "locked" });
    expect(await student.remove(outcome.id, hoursAfter(1))).toEqual({ status: "locked" });

    // And so does the database, whatever the application does.
    const exerciseId = (await db.prepare("SELECT id FROM session_exercises WHERE session_id = ?1 LIMIT 1").bind(outcome.id).first<{ id: string }>())!.id;
    const setId = (await db.prepare("SELECT id FROM session_sets WHERE session_exercise_id = ?1 LIMIT 1").bind(exerciseId).first<{ id: string }>())!.id;
    for (const [sql, binds] of [
      ["UPDATE workout_sessions SET effort = 1 WHERE id = ?1", [outcome.id]],
      ["UPDATE workout_sessions SET pain_reported = 0 WHERE id = ?1", [outcome.id]],
      ["UPDATE workout_sessions SET notes = NULL WHERE id = ?1", [outcome.id]],
      ["DELETE FROM workout_sessions WHERE id = ?1", [outcome.id]],
      ["UPDATE session_exercises SET pain = 0 WHERE id = ?1", [exerciseId]],
      ["UPDATE session_exercises SET notes = 'x' WHERE id = ?1", [exerciseId]],
      ["DELETE FROM session_exercises WHERE id = ?1", [exerciseId]],
      ["UPDATE session_sets SET load_kg = 1 WHERE id = ?1", [setId]],
      ["DELETE FROM session_sets WHERE id = ?1", [setId]],
      [`INSERT INTO session_sets (id, organization_id, session_exercise_id, set_number, reps) VALUES ('s-x', 'org-a', ?1, 9, 1)`, [exerciseId]],
      [`INSERT INTO session_exercises (id, organization_id, session_id, prescribed_exercise_id, exercise_name, position) VALUES ('e-x', 'org-a', ?1, ?2, 'x', 1)`, [outcome.id, plan.phase1[2]]],
    ] as Array<[string, unknown[]]>)
      await expect(run(sql, ...binds), sql).rejects.toThrow(/WORKOUT_SESSION_FROZEN/);
    expect((await student.get(outcome.id, NOW))!.exercises).toHaveLength(2);
  });

  it("flags pain given only for the whole session, without an exercise report", async () => {
    const plan = await deliveredPlan();
    const student = studentSessionsFor(db, "client-1");
    const outcome = await student.save("st-1", log(plan.planId, [done(plan.phase1[0])], { pain: true, notes: "tontura" }), NOW);
    expect(outcome).toMatchObject({ status: "saved", painReported: true });
    if (outcome.status === "saved") expect((await student.get(outcome.id, NOW))!.painReported).toBe(true);
  });

  it("refuses any other identity, plan, revision or exercise and writes nothing", async () => {
    const plan = await deliveredPlan();
    const other = await deliveredPlan("st-2", "tech-a2");
    const baseline = [await count("workout_sessions"), await count("session_exercises"), await count("session_sets")];
    const body = log(plan.planId, [done(plan.phase1[0])]);

    // A login not linked to the student, a login of another organization, a professional, a manager, nobody.
    for (const user of ["client-2", "client-b", "tech-a", "owner-a", "mgr-1", "stranger"])
      expect(await studentSessionsFor(db, user).save("st-1", body, NOW), user).toEqual({ status: "not_found" });
    // The right login for the wrong student, and a plan that belongs to another student.
    expect(await studentSessionsFor(db, "client-1").save("st-2", body, NOW)).toEqual({ status: "not_found" });
    expect(await studentSessionsFor(db, "client-2").save("st-2", body, NOW)).toEqual({ status: "not_found" });
    expect(await studentSessionsFor(db, "client-1").save("st-1", log(other.planId, [done(other.phase1[0])]), NOW)).toEqual({ status: "not_found" });
    // Exercises that are not part of this workout: another plan's, another phase's, invented.
    const student = studentSessionsFor(db, "client-1");
    expect(await student.save("st-1", log(plan.planId, [done(other.phase1[0])]), NOW)).toEqual({ status: "invalid" });
    expect(await student.save("st-1", log(plan.planId, [done(plan.phase2[0])]), NOW)).toEqual({ status: "invalid" });
    expect(await student.save("st-1", log(plan.planId, [done("invented")]), NOW)).toEqual({ status: "invalid" });
    // A workout or phase the plan does not have.
    expect(await student.save("st-1", { ...body, workoutLabel: "A" }, NOW)).toEqual({ status: "not_found" });
    expect(await student.save("st-1", { ...body, phaseIndex: 4 }, NOW)).toEqual({ status: "not_found" });
    expect([await count("workout_sessions"), await count("session_exercises"), await count("session_sets")]).toEqual(baseline);
  });

  it("refuses a revoked link and a disabled login, and hides what was already logged", async () => {
    const plan = await deliveredPlan("st-off");
    const student = studentSessionsFor(db, "client-off");
    const outcome = await student.save("st-off", log(plan.planId, [done(plan.phase1[0])]), NOW);
    if (outcome.status !== "saved") throw new Error("expected saved");
    await run("UPDATE student_access SET revoked_at = '2026-11-12T00:00:00.000Z' WHERE user_id = 'client-off'");
    expect(await student.get(outcome.id, NOW)).toBeNull();
    expect(await student.forWorkout("st-off", plan.planId, 1, FB, NOW)).toEqual([]);
    expect(await student.save("st-off", log(plan.planId, [done(plan.phase1[0])]), NOW)).toEqual({ status: "not_found" });
    expect(await student.remove(outcome.id, NOW)).toEqual({ status: "not_found" });
    await run("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-off'");
    expect(await student.get(outcome.id, NOW)).not.toBeNull();
    await run("UPDATE users SET disabled_at = '2026-11-12T00:00:00.000Z' WHERE id = 'client-off'");
    expect(await student.get(outcome.id, NOW)).toBeNull();
    expect(await student.save("st-off", log(plan.planId, [done(plan.phase1[0])]), NOW)).toEqual({ status: "not_found" });
    expect(await student.remove(outcome.id, NOW)).toEqual({ status: "not_found" });
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'client-off'");
  });

  it("does not let one login read, correct or delete the log of another student", async () => {
    const plan = await deliveredPlan();
    const outcome = await studentSessionsFor(db, "client-1").save("st-1", log(plan.planId, [done(plan.phase1[0])]), NOW);
    if (outcome.status !== "saved") throw new Error("expected saved");
    for (const user of ["client-2", "client-b", "tech-a", "stranger"]) {
      const intruder = studentSessionsFor(db, user);
      expect(await intruder.get(outcome.id, NOW), user).toBeNull();
      expect(await intruder.remove(outcome.id, NOW), user).toEqual({ status: "not_found" });
      expect(await intruder.forWorkout("st-1", plan.planId, 1, FB, NOW), user).toEqual([]);
    }
    expect(await studentSessionsFor(db, "client-1").get(outcome.id, NOW)).not.toBeNull();
    expect(() => studentSessionsFor(db, "  ")).toThrow("AUTHENTICATION_REQUIRED");
  });

  it("logs only against the newest delivered revision of the plan", async () => {
    const plan = await deliveredPlan();
    const plans = plansFor(db, scope("tech-a"));
    const rx = prescriptionFor(db, scope("tech-a"));
    const student = studentSessionsFor(db, "client-1");
    const first = await student.save("st-1", log(plan.planId, [done(plan.phase1[0])]), NOW);
    expect(first.status).toBe("saved");

    const next = (await plans.newRevisionFrom(plan.planId, plan.revisionId)) as { revisionId: string };
    // While the new revision is only a draft, the delivered one is still the one in use.
    expect((await student.save("st-1", log(plan.planId, [done(plan.phase1[0])], { performedOn: "2026-11-11" }), NOW)).status).toBe("saved");
    await plans.markReady(plan.planId, next.revisionId);
    await plans.approve(plan.planId, next.revisionId, { screeningNotRecorded: true }, at(20));
    await plans.deliver(plan.planId, next.revisionId, at(21));
    const newItems = (await rx.list(plan.planId, next.revisionId)).filter((item) => item.phaseIndex === 1).map((item) => item.id);
    // The old exercises belong to the old revision: no longer accepted.
    expect(await student.save("st-1", log(plan.planId, [done(plan.phase1[0])], { performedOn: "2026-11-10" }), NOW)).toEqual({ status: "invalid" });
    const onNew = await student.save("st-1", log(plan.planId, [done(newItems[0])], { performedOn: "2026-11-10" }), NOW);
    expect(onNew.status).toBe("saved");
    // What was logged on the old revision stays attached to it.
    const revisions = await db.prepare("SELECT DISTINCT revision_id AS r FROM workout_sessions WHERE student_id = 'st-1' AND revision_id IN (?1, ?2) ORDER BY 1").bind(plan.revisionId, next.revisionId).all<{ r: string }>();
    expect(revisions.results.map((row) => row.r).sort()).toEqual([plan.revisionId, next.revisionId].sort());
  });

  it("is refused by the database itself for a draft, for another student's revision and for a foreign exercise", async () => {
    const plan = await deliveredPlan();
    const other = await deliveredPlan("st-2", "tech-a2");
    const plans = plansFor(db, scope("tech-a"));
    const draft = (await plans.newRevisionFrom(plan.planId, plan.revisionId)) as { revisionId: string };
    const insertSession = (revision: string, student: string) =>
      run(
        `INSERT INTO workout_sessions (id, organization_id, student_id, revision_id, phase_index, workout_label, performed_on, logged_by_user_id, created_at, updated_at)
         VALUES (?1, 'org-a', ?2, ?3, 1, 'Full Body', '2026-11-12', 'client-1', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z')`,
        crypto.randomUUID(), student, revision,
      );
    await expect(insertSession(draft.revisionId, "st-1")).rejects.toThrow(/SESSION_REVISION_INVALID/);
    await expect(insertSession(other.revisionId, "st-1")).rejects.toThrow(/SESSION_REVISION_INVALID/);
    await insertSession(plan.revisionId, "st-1");

    const sessionId = (await db.prepare("SELECT id FROM workout_sessions WHERE revision_id = ?1 AND student_id = 'st-1' ORDER BY rowid DESC LIMIT 1").bind(plan.revisionId).first<{ id: string }>())!.id;
    await expect(
      run(`INSERT INTO session_exercises (id, organization_id, session_id, prescribed_exercise_id, exercise_name, position) VALUES ('e-foreign', 'org-a', ?1, ?2, 'x', 1)`, sessionId, other.phase1[0]),
    ).rejects.toThrow(/SESSION_EXERCISE_INVALID/);
    await expect(
      run(`INSERT INTO session_exercises (id, organization_id, session_id, prescribed_exercise_id, exercise_name, position) VALUES ('e-phase', 'org-a', ?1, ?2, 'x', 1)`, sessionId, plan.phase2[0]),
    ).rejects.toThrow(/SESSION_EXERCISE_INVALID/);

    // What a session is about never changes.
    for (const sql of [
      "UPDATE workout_sessions SET student_id = 'st-2' WHERE id = ?1",
      "UPDATE workout_sessions SET revision_id = '" + other.revisionId + "' WHERE id = ?1",
      "UPDATE workout_sessions SET performed_on = '2026-11-01' WHERE id = ?1",
      "UPDATE workout_sessions SET phase_index = 2 WHERE id = ?1",
      "UPDATE workout_sessions SET workout_label = 'B' WHERE id = ?1",
      "UPDATE workout_sessions SET logged_by_user_id = 'client-2' WHERE id = ?1",
      "UPDATE workout_sessions SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1",
    ])
      await expect(run(sql, sessionId), sql).rejects.toThrow(/WORKOUT_SESSION_IDENTITY_FROZEN/);
  });
});

describe("two logins of the same student", () => {
  it("both see the log but only the login that made it can correct or delete it", async () => {
    const plan = await deliveredPlan();
    const author = studentSessionsFor(db, "client-1");
    const other = studentSessionsFor(db, "client-1b");
    const outcome = await author.save("st-1", log(plan.planId, [done(plan.phase1[0])], { effort: 5 }), NOW);
    if (outcome.status !== "saved") throw new Error("expected saved");
    expect((await author.get(outcome.id, NOW))!.editable).toBe(true);
    expect((await other.get(outcome.id, NOW))!).toMatchObject({ effort: 5, editable: false });
    expect((await other.forWorkout("st-1", plan.planId, 1, FB, NOW))[0]).toMatchObject({ id: outcome.id, editable: false });
    expect(await other.save("st-1", log(plan.planId, [done(plan.phase1[0])], { effort: 1 }), NOW)).toEqual({ status: "locked" });
    expect(await other.remove(outcome.id, NOW)).toEqual({ status: "locked" });
    expect((await author.get(outcome.id, NOW))!.effort).toBe(5);
  });
});

describe("the professional reading the logs", () => {
  async function painfulLog(user = "client-1", student = "st-1", owner = "tech-a") {
    const plan = await deliveredPlan(student, owner);
    const outcome = await studentSessionsFor(db, user).save(student, log(plan.planId, [
      done(plan.phase1[0], [{ reps: 10, loadKg: 30 }, { reps: 8, loadKg: 30 }]),
      { prescribedExerciseId: plan.phase1[1], done: true, pain: true, notes: "dor lombar", sets: [{ reps: 4 }] },
    ], { effort: 9 }), NOW);
    if (outcome.status !== "saved") throw new Error("expected saved");
    return { plan, id: outcome.id };
  }

  it("lists and opens the logs with what was prescribed next to what was done", async () => {
    const { plan, id } = await painfulLog();
    const reader = executionFor(db, scope("tech-a"));
    const rows = await reader.list("st-1");
    expect(rows.find((row) => row.id === id)).toMatchObject({
      painReported: true, effort: 9, exercisesDone: 2, exercisesPlanned: 3, setsLogged: 3, acknowledgedAt: null, workoutLabel: FB, phaseIndex: 1,
    });
    const detail = (await reader.detail(id))!;
    expect(detail.studentId).toBe("st-1");
    expect(detail.exercises.map((e) => [e.name, e.planned.sets, e.planned.reps, e.sets.length])).toEqual([
      ["Exercício 1", "3", "10", 2],
      ["Exercício 2", "3", "10", 1],
    ]);
    expect(detail.notLogged).toEqual(["Exercício 3"]);
    expect(detail.exercises[1]).toMatchObject({ pain: true, notes: "dor lombar" });
    expect(plan.planId).toBeTruthy();
  });

  it("shows a report of pain as pending until a reading is recorded, and the reading freezes the log", async () => {
    const { id } = await painfulLog();
    const reader = executionFor(db, scope("tech-a"));
    expect((await reader.painPending()).map((row) => row.sessionId)).toContain(id);
    expect(await reader.acknowledge(id, "  Conversei com o aluno.  ", NOW)).toEqual({ status: "recorded" });
    expect((await reader.painPending()).map((row) => row.sessionId)).not.toContain(id);
    const detail = (await reader.detail(id))!;
    expect(detail.acknowledgedAt).toBe(NOW.toISOString());
    expect(detail.acknowledgements).toEqual([{ reviewerName: "Pro A", note: "Conversei com o aluno.", createdAt: NOW.toISOString() }]);
    // The reading is a trace of who and when, never of content.
    const audit = await db.prepare("SELECT actor_user_id AS actor, subject_id AS subject, organization_id AS org FROM access_audit_events WHERE action = 'WORKOUT_SESSION_READ' AND subject_id = ?1").bind(id).all();
    expect(audit.results).toEqual([{ actor: "tech-a", subject: id, org: "org-a" }]);
    // Readings are appended, never changed or removed.
    await expect(run("UPDATE session_acknowledgements SET note = 'x' WHERE session_id = ?1", id)).rejects.toThrow(/SESSION_ACKNOWLEDGEMENT_APPEND_ONLY/);
    await expect(run("DELETE FROM session_acknowledgements WHERE session_id = ?1", id)).rejects.toThrow(/SESSION_ACKNOWLEDGEMENT_APPEND_ONLY/);
    expect(await reader.acknowledge(id, "", hoursAfter(1))).toEqual({ status: "recorded" });
    expect((await reader.detail(id))!.acknowledgements).toHaveLength(2);
    await expect(reader.acknowledge(id, "x".repeat(501))).rejects.toThrow("ACKNOWLEDGEMENT_NOTE_TOO_LONG");
  });

  it("freezes even a log without pain once the professional has read it", async () => {
    const plan = await deliveredPlan();
    const student = studentSessionsFor(db, "client-1");
    const outcome = await student.save("st-1", log(plan.planId, [done(plan.phase1[0])], { effort: 3 }), NOW);
    if (outcome.status !== "saved") throw new Error("expected saved");
    expect((await student.get(outcome.id, NOW))!.editable).toBe(true);
    await executionFor(db, scope("tech-a")).acknowledge(outcome.id, null, hoursAfter(1));
    expect((await student.get(outcome.id, hoursAfter(2)))!).toMatchObject({ editable: false, acknowledged: true });
    expect(await student.save("st-1", log(plan.planId, [done(plan.phase1[0])], { effort: 9 }), hoursAfter(2))).toEqual({ status: "locked" });
    expect(await student.remove(outcome.id, hoursAfter(2))).toEqual({ status: "locked" });
    await expect(run("UPDATE workout_sessions SET effort = 1 WHERE id = ?1", outcome.id)).rejects.toThrow(/WORKOUT_SESSION_FROZEN/);
    await expect(run("DELETE FROM workout_sessions WHERE id = ?1", outcome.id)).rejects.toThrow(/WORKOUT_SESSION_FROZEN/);
  });

  it("reaches only the students of the professional's active technical assignments", async () => {
    const { id } = await painfulLog();
    const mine = executionFor(db, scope("tech-a"));
    expect(await mine.detail(id)).not.toBeNull();
    const refused: Array<[string, string]> = [
      ["tech-a2", "org-a"], ["owner-a", "org-a"], ["commercial-a", "org-a"], ["client-1", "org-a"],
      ["mgr-1", "org-a"], ["tech-b", "org-b"], ["tech-b", "org-a"], ["stranger", "org-a"],
    ];
    for (const [user, org] of refused) {
      const reader = executionFor(db, scope(user, org));
      expect(await reader.list("st-1"), user).toEqual([]);
      expect(await reader.detail(id), user).toBeNull();
      expect(await reader.acknowledge(id, "x", NOW), user).toEqual({ status: "not_found" });
      expect((await reader.painPending()).map((row) => row.sessionId), user).not.toContain(id);
    }
    expect(await count("session_acknowledgements", `session_id = '${id}'`)).toBe(0);
    expect(() => executionFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
    expect(() => executionFor(db, { userId: "tech-a", organizationId: " " })).toThrow("AUTHENTICATION_REQUIRED");
  });

  it("loses the logs the moment the assignment or the login is revoked", async () => {
    const { id } = await painfulLog("client-2", "st-2", "tech-a2");
    const reader = executionFor(db, scope("tech-a2"));
    expect(await reader.detail(id)).not.toBeNull();
    await run("UPDATE care_assignments SET revoked_at = '2026-11-12T00:00:00.000Z' WHERE student_id = 'st-2'");
    expect(await reader.detail(id)).toBeNull();
    expect(await reader.list("st-2")).toEqual([]);
    expect(await reader.acknowledge(id, "x", NOW)).toEqual({ status: "not_found" });
    await run("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-2'");
    await run("UPDATE users SET disabled_at = '2026-11-12T00:00:00.000Z' WHERE id = 'tech-a2'");
    expect(await reader.detail(id)).toBeNull();
    expect(await reader.painPending()).toEqual([]);
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a2'");
    expect(await reader.detail(id)).not.toBeNull();
  });
});

describe("the progress the professional reads", () => {
  const nowOn = (day: string) => new Date(`${day}T15:00:00.000Z`);
  /** Logs one workout of the plan on a day, for the student of this block. */
  async function logOn(planId: string, exerciseId: string, day: string, sets: Array<{ reps?: number; loadKg?: number }>) {
    const outcome = await studentSessionsFor(db, "client-p").save(
      "st-p",
      log(planId, [done(exerciseId, sets)], { performedOn: day }),
      nowOn(day),
    );
    if (outcome.status !== "saved") throw new Error(`expected saved, got ${outcome.status}`);
  }

  it("counts the logs of each week against the workouts foreseen and keeps the week in progress out of the missing ones", async () => {
    const plan = await deliveredPlan("st-p");
    await logOn(plan.planId, plan.phase1[0], "2026-11-10", [{ reps: 10, loadKg: 20 }, { reps: 8, loadKg: 22.5 }]);
    // The same day also has an exercise that was skipped, with a note: it is not a point of any series.
    const second = await studentSessionsFor(db, "client-p").save(
      "st-p",
      log(plan.planId, [done(plan.phase1[0], [{ reps: 10, loadKg: 25 }]), { prescribedExerciseId: plan.phase1[1], done: false, notes: "sem tempo", sets: [{ reps: 5, loadKg: 99 }] }], { performedOn: "2026-11-11" }),
      nowOn("2026-11-11"),
    );
    expect(second.status).toBe("saved");
    const reader = executionFor(db, scope("tech-a"));

    const during = await reader.progress("st-p", "2026-11-12");
    const cycle = during.cycles.find((item) => item.planId === plan.planId)!;
    // Delivered on 10 Nov: the week of 2 Nov was never the student's to miss.
    expect(cycle).toMatchObject({ revisionNumber: 1, deliveredOn: "2026-11-10", supersededOn: null, outside: 0 });
    expect(cycle.weeks.map((week) => [week.startDate, week.planned, week.recorded, week.inProgress])).toEqual([
      ["2026-11-09", 3, 2, true],
    ]);
    expect(cycle.closed).toEqual({ weeks: 0, planned: 0, recorded: 0, covered: 0 });

    const later = (await reader.progress("st-p", "2026-11-20")).cycles.find((item) => item.planId === plan.planId)!;
    expect(later.weeks.map((week) => [week.startDate, week.recorded, week.inProgress])).toEqual([
      ["2026-11-09", 2, false],
      ["2026-11-16", 0, true],
    ]);
    expect(later.closed).toEqual({ weeks: 1, planned: 3, recorded: 2, covered: 2 });
  });

  it("reads the heaviest set of each day per exercise, as typed", async () => {
    const reader = executionFor(db, scope("tech-a"));
    const { series } = await reader.progress("st-p", "2026-11-12");
    const squat = series.find((item) => item.name === "Exercício 1")!;
    expect(squat.points).toEqual([
      { performedOn: "2026-11-10", maxLoadKg: 22.5, repsAtMax: 8, sets: 2 },
      { performedOn: "2026-11-11", maxLoadKg: 25, repsAtMax: 10, sets: 1 },
    ]);
    expect(squat.numeric).toHaveLength(2);
    // Only what was done enters: a skipped exercise with a note has no point.
    expect(series.map((item) => item.name)).toEqual(["Exercício 1"]);
  });

  it("does not count the weeks of a replaced cycle as missed, and shows both cycles", async () => {
    const plans = plansFor(db, scope("tech-a"));
    const first = (await executionFor(db, scope("tech-a")).progress("st-p", "2026-11-12")).cycles[0];
    const next = (await plans.newRevisionFrom(first.planId, (await db.prepare("SELECT id FROM plan_revisions WHERE plan_id = ?1 AND revision_number = 1").bind(first.planId).first<{ id: string }>())!.id)) as { revisionId: string };
    await plans.markReady(first.planId, next.revisionId);
    await plans.approve(first.planId, next.revisionId, { screeningNotRecorded: true }, at(60 * 24 * 3));
    await plans.deliver(first.planId, next.revisionId, at(60 * 24 * 3 + 1));
    const cycles = (await executionFor(db, scope("tech-a")).progress("st-p", "2026-11-14")).cycles.filter((item) => item.planId === first.planId);
    expect(cycles.map((item) => item.revisionNumber)).toEqual([2, 1]);
    expect(cycles[1]).toMatchObject({ supersededOn: "2026-11-13" });
    expect(cycles[1].weeks.map((week) => [week.startDate, week.recorded, week.inProgress])).toEqual([["2026-11-09", 2, false]]);
    expect(cycles[1].closed.weeks).toBe(0);
    expect(cycles[0].weeks.map((week) => [week.startDate, week.recorded, week.inProgress])).toEqual([["2026-11-09", 0, true]]);
  });

  it("is empty for every identity without an active technical assignment, and after the assignment ends", async () => {
    const empty = { cycles: [], series: [] };
    for (const [user, org] of [
      ["tech-a2", "org-a"], ["owner-a", "org-a"], ["commercial-a", "org-a"], ["client-p", "org-a"],
      ["mgr-1", "org-a"], ["tech-b", "org-b"], ["tech-b", "org-a"], ["stranger", "org-a"],
    ])
      expect(await executionFor(db, scope(user, org)).progress("st-p", "2026-11-14"), user).toEqual(empty);
    const reader = executionFor(db, scope("tech-a"));
    expect((await reader.progress("st-p", "2026-11-14")).cycles.length).toBeGreaterThan(0);
    await run("UPDATE care_assignments SET revoked_at = '2026-11-12T00:00:00.000Z' WHERE student_id = 'st-p'");
    expect(await reader.progress("st-p", "2026-11-14")).toEqual(empty);
    await run("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-p'");
    await run("UPDATE users SET disabled_at = '2026-11-12T00:00:00.000Z' WHERE id = 'tech-a'");
    expect(await reader.progress("st-p", "2026-11-14")).toEqual(empty);
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'");
    // Another student's logs never enter this student's progress.
    expect((await reader.progress("st-1", "2026-11-14")).series.some((item) => item.points.some((point) => point.performedOn === "2026-11-10" && point.maxLoadKg === 22.5 && point.sets === 2))).toBe(false);
  });
});

describe("the student's own progress", () => {
  const nowOn = (day: string) => new Date(`${day}T15:00:00.000Z`);
  const empty = { cycles: [], series: [] };

  it("is the same facts the professional reads, through the student's own link", async () => {
    const plan = await deliveredPlan("st-q");
    const mine = studentSessionsFor(db, "client-q");
    for (const [day, sets] of [
      ["2026-11-10", [{ reps: 10, loadKg: 20 }, { reps: 8, loadKg: 22.5 }]],
      ["2026-11-11", [{ reps: 10, loadKg: 25 }]],
    ] as const) {
      const outcome = await mine.save("st-q", log(plan.planId, [done(plan.phase1[0], [...sets])], { performedOn: day }), nowOn(day));
      expect(outcome.status).toBe("saved");
    }
    const own = await mine.progress("st-q", "2026-11-12");
    expect(own).toEqual(await executionFor(db, scope("tech-a")).progress("st-q", "2026-11-12"));
    const cycle = own.cycles.find((item) => item.planId === plan.planId)!;
    expect(cycle.weeks.map((week) => [week.startDate, week.planned, week.recorded, week.inProgress])).toEqual([["2026-11-09", 3, 2, true]]);
    expect(own.series.find((item) => item.name === "Exercício 1")!.points.map((point) => point.maxLoadKg)).toEqual([22.5, 25]);
  });

  it("lists the latest logs, newest first, with whether a pain report or a reading closed them", async () => {
    const mine = studentSessionsFor(db, "client-q");
    const rows = await mine.recent("st-q", 10);
    expect(rows.map((row) => row.performedOn)).toEqual(["2026-11-11", "2026-11-10"]);
    expect(rows[0]).toMatchObject({ workoutLabel: FB, phaseIndex: 1, painReported: false, acknowledged: false });
    expect(await mine.recent("st-q", 1)).toHaveLength(1);
    await executionFor(db, scope("tech-a")).acknowledge(rows[1].id, null, nowOn("2026-11-12"));
    expect((await mine.recent("st-q", 10))[1]).toMatchObject({ performedOn: "2026-11-10", acknowledged: true });
  });

  it("is empty for any other login, other organization, professional or stranger, and never mixes students", async () => {
    for (const user of ["client-1", "client-p", "client-b", "tech-a", "owner-a", "mgr-1", "stranger"]) {
      const reader = studentSessionsFor(db, user);
      expect(await reader.progress("st-q", "2026-11-12"), user).toEqual(empty);
      expect(await reader.recent("st-q", 10), user).toEqual([]);
    }
    // The student of another login sees only their own.
    const other = await studentSessionsFor(db, "client-p").progress("st-p", "2026-11-12");
    expect(other.series.some((item) => item.points.some((point) => point.maxLoadKg === 22.5 && point.sets === 2 && point.performedOn === "2026-11-10"))).toBe(true);
    expect(await studentSessionsFor(db, "client-p").recent("st-q", 10)).toEqual([]);
  });

  it("stops the moment the link is revoked or the login is blocked", async () => {
    const mine = studentSessionsFor(db, "client-q");
    expect((await mine.progress("st-q", "2026-11-12")).cycles.length).toBeGreaterThan(0);
    await run("UPDATE student_access SET revoked_at = '2026-11-12T00:00:00.000Z' WHERE user_id = 'client-q'");
    expect(await mine.progress("st-q", "2026-11-12")).toEqual(empty);
    expect(await mine.recent("st-q", 10)).toEqual([]);
    await run("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-q'");
    await run("UPDATE users SET disabled_at = '2026-11-12T00:00:00.000Z' WHERE id = 'client-q'");
    expect(await mine.progress("st-q", "2026-11-12")).toEqual(empty);
    expect(await mine.recent("st-q", 10)).toEqual([]);
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'client-q'");
    expect((await mine.recent("st-q", 10)).length).toBe(2);
  });
});
