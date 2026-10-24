import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { exercisesFor } from "@/db/exercises";
import { studentTrainingFor } from "@/db/student-plan";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration, triggers included. Identities are rows, as the server
// derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const FB = "Full Body";
const input = (target = 3) => ({
  startDate: "2026-11-02",
  phases: Array.from({ length: 3 }, () => ({
    weeks: 4, sessionsPerWeek: 3, split: FB, exercisesPerSession: target,
  })),
});
const slot = (phaseIndex: number) => ({ phaseIndex, workoutLabel: FB });
const at = (minute: number) => new Date(`2026-11-10T10:${String(minute).padStart(2, "0")}:00Z`);

/** A plan whose three Full Body workouts all have `count` exercises. */
async function newPlan(student = "st-1", count = 3, target = 3, owner = "tech-a") {
  const plans = plansFor(db, scope(owner));
  const rx = prescriptionFor(db, scope(owner));
  const created = (await plans.create(student, { title: `Plano ${crypto.randomUUID().slice(0, 6)}`, input: input(target) }))!;
  for (let i = 0; i < count; i++)
    await rx.add(created.planId, created.revisionId, slot(1), { customName: `Exercício ${i + 1}` }, { sets: "3", reps: "10" });
  if (count > 0) {
    await rx.copyPhase(created.planId, created.revisionId, 1, 2);
    await rx.copyPhase(created.planId, created.revisionId, 1, 3);
  }
  return created;
}
const stateOf = async (revisionId: string) =>
  (await db.prepare("SELECT state, approved_at AS approvedAt, approved_by_user_id AS approvedBy, approval_screening AS screening, delivered_at AS deliveredAt, delivered_by_user_id AS deliveredBy FROM plan_revisions WHERE id = ?1").bind(revisionId).first<{
    state: string; approvedAt: string | null; approvedBy: string | null; screening: string | null; deliveredAt: string | null; deliveredBy: string | null;
  }>())!;
/** Whether the client sees this plan, whatever other plans the student already has. */
const clientSees = async (planId: string, user = "client-1", student = "st-1") =>
  (await studentTrainingFor(db, user, student)).some((p) => p.planId === planId);
async function deliverable(student = "st-1") {
  const plan = await newPlan(student);
  const plans = plansFor(db, scope("tech-a"));
  await plans.markReady(plan.planId, plan.revisionId);
  await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, at(1));
  await plans.deliver(plan.planId, plan.revisionId, at(2));
  return plan;
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "approval-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "tech-a", "tech-a2", "commercial-a", "owner-b", "tech-b", "client-1", "client-2", "mgr-1"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    db.prepare("INSERT INTO users(id) VALUES ('owner-a'),('tech-a'),('tech-a2'),('commercial-a'),('owner-b'),('tech-b'),('client-1'),('client-2'),('mgr-1')"),
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
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Student One'),('st-2','org-a','Student Two'),('st-b','org-b','Student B')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a2'),('org-b','st-b','pro-b')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1'),('org-a','st-2','client-2')"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("the database itself refuses to change a revision that left DRAFT", () => {
  it("keeps content, prescription and history frozen even for a direct write", async () => {
    const plan = await newPlan();
    const plans = plansFor(db, scope("tech-a"));
    const rx = prescriptionFor(db, scope("tech-a"));
    const itemId = (await rx.list(plan.planId, plan.revisionId))[0].id;
    const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();

    // While it is a draft, content changes normally.
    await run("UPDATE plan_revisions SET total_weeks = 12 WHERE id = ?1", plan.revisionId);
    expect(await plans.markReady(plan.planId, plan.revisionId)).toBe(true);

    for (const sql of [
      "UPDATE plan_revisions SET input_json = '{}' WHERE id = ?1",
      "UPDATE plan_revisions SET schedule_json = '{}' WHERE id = ?1",
      "UPDATE plan_revisions SET start_date = '2030-01-01' WHERE id = ?1",
      "UPDATE plan_revisions SET total_sessions = 1 WHERE id = ?1",
      "UPDATE plan_revisions SET revision_number = 9 WHERE id = ?1",
      "DELETE FROM plan_revisions WHERE id = ?1",
    ])
      await expect(run(sql, plan.revisionId), sql).rejects.toThrow(/PLAN_REVISION_FROZEN/);

    await expect(
      run(
        `INSERT INTO prescribed_exercises (id, organization_id, revision_id, phase_index, workout_label, position, name, created_by_user_id)
         VALUES ('x1', 'org-a', ?1, 1, 'Full Body', 99, 'Intruso', 'tech-a')`,
        plan.revisionId,
      ),
    ).rejects.toThrow(/PLAN_REVISION_FROZEN/);
    await expect(run("UPDATE prescribed_exercises SET name = 'Trocado' WHERE id = ?1", itemId)).rejects.toThrow(/PLAN_REVISION_FROZEN/);
    await expect(run("DELETE FROM prescribed_exercises WHERE id = ?1", itemId)).rejects.toThrow(/PLAN_REVISION_FROZEN/);

    // States only move forward, one step at a time.
    for (const state of ["DRAFT", "DELIVERED", "ARCHIVED"])
      await expect(run("UPDATE plan_revisions SET state = ?2 WHERE id = ?1", plan.revisionId, state), state).rejects.toThrow(/PLAN_REVISION_STATE_INVALID/);
    expect((await stateOf(plan.revisionId)).state).toBe("READY");

    await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, at(3));
    await expect(run("UPDATE plan_revisions SET state = 'READY' WHERE id = ?1", plan.revisionId)).rejects.toThrow(/PLAN_REVISION_STATE_INVALID/);
    await expect(run("UPDATE plan_revisions SET approved_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1", plan.revisionId)).rejects.toThrow(/PLAN_REVISION_FROZEN/);
    await expect(run("UPDATE plan_revisions SET approved_by_user_id = 'tech-a2' WHERE id = ?1", plan.revisionId)).rejects.toThrow(/PLAN_REVISION_FROZEN/);
    await plans.deliver(plan.planId, plan.revisionId, at(4));
    await expect(run("UPDATE plan_revisions SET state = 'APPROVED' WHERE id = ?1", plan.revisionId)).rejects.toThrow(/PLAN_REVISION_STATE_INVALID/);
    await expect(run("UPDATE plan_revisions SET delivered_at = NULL WHERE id = ?1", plan.revisionId)).rejects.toThrow(/PLAN_REVISION_FROZEN/);
    await expect(run("UPDATE prescribed_exercises SET sets = '99' WHERE id = ?1", itemId)).rejects.toThrow(/PLAN_REVISION_FROZEN/);
    expect(await stateOf(plan.revisionId)).toMatchObject({ state: "DELIVERED", approvedBy: "tech-a", deliveredBy: "tech-a" });
  });
});

describe("approving and delivering", () => {
  it("approves only a READY revision with every workout at its target and a recorded acknowledgement", async () => {
    const plans = plansFor(db, scope("tech-a"));
    const rx = prescriptionFor(db, scope("tech-a"));
    const plan = await newPlan("st-1", 2); // 2 of 3 in each of the three workouts
    // A draft is not approvable.
    expect((await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true })).status).toBe("not_found");
    await plans.markReady(plan.planId, plan.revisionId);
    // Below the target: a pending item that is never filled in, and nothing is written.
    expect(await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true })).toEqual({ status: "below_target", below: 3 });
    expect((await stateOf(plan.revisionId)).state).toBe("READY");

    // The fix is a new revision where the professional completes the exercises.
    const next = (await plans.newRevisionFrom(plan.planId, plan.revisionId)) as { revisionId: string };
    for (const phase of [1, 2, 3]) await rx.add(plan.planId, next.revisionId, slot(phase), { customName: `Extra ${phase}` });
    await plans.markReady(plan.planId, next.revisionId);
    // The acknowledgement about the missing screening is required.
    expect(await plans.approve(plan.planId, next.revisionId, { screeningNotRecorded: false })).toEqual({ status: "screening_acknowledgement_required" });
    expect((await stateOf(next.revisionId)).state).toBe("READY");
    expect(await plans.approve(plan.planId, next.revisionId, { screeningNotRecorded: true }, at(5))).toEqual({ status: "approved" });
    expect(await stateOf(next.revisionId)).toEqual({
      state: "APPROVED", approvedAt: at(5).toISOString(), approvedBy: "tech-a", screening: "NOT_RECORDED", deliveredAt: null, deliveredBy: null,
    });
    // Approving twice does nothing, and an approved revision is not yet delivered.
    expect((await plans.approve(plan.planId, next.revisionId, { screeningNotRecorded: true })).status).toBe("not_found");
    expect(await clientSees(plan.planId)).toBe(false);
    expect(await plans.deliver(plan.planId, plan.revisionId, at(6))).toBe(false); // the READY one is not approved
    expect(await plans.deliver(plan.planId, next.revisionId, at(6))).toBe(true);
    expect(await clientSees(plan.planId)).toBe(true);
    expect(await plans.deliver(plan.planId, next.revisionId, at(7))).toBe(false);
    expect((await stateOf(next.revisionId)).deliveredAt).toBe(at(6).toISOString());
  });

  it("lets a workout sit above its target and records the whole trail without content", async () => {
    const plans = plansFor(db, scope("tech-a"));
    const plan = await newPlan("st-1", 4, 3); // 4 exercises against a target of 3
    await plans.markReady(plan.planId, plan.revisionId);
    expect((await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true })).status).toBe("approved");
    await plans.deliver(plan.planId, plan.revisionId);
    const events = await db
      .prepare("SELECT action FROM training_plan_events WHERE plan_id = ?1 ORDER BY created_at, rowid")
      .bind(plan.planId)
      .all<{ action: string }>();
    expect(events.results.map((e) => e.action).filter((a) => a !== "PRESCRIPTION_EDITED")).toEqual(["PLAN_CREATED", "MARKED_READY", "APPROVED", "DELIVERED"]);
  });

  it("is refused for anyone without active technical access and changes nothing", async () => {
    const plan = await newPlan();
    const plans = plansFor(db, scope("tech-a"));
    await plans.markReady(plan.planId, plan.revisionId);
    for (const [user, org] of [["tech-a2", "org-a"], ["owner-a", "org-a"], ["commercial-a", "org-a"], ["client-1", "org-a"], ["mgr-1", "org-a"], ["tech-b", "org-b"], ["tech-b", "org-a"], ["stranger", "org-a"]]) {
      const other = plansFor(db, scope(user, org));
      expect((await other.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true })).status, user).toBe("not_found");
      expect(await other.deliver(plan.planId, plan.revisionId), user).toBe(false);
    }
    expect((await stateOf(plan.revisionId)).state).toBe("READY");
    await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true });
    for (const user of ["tech-a2", "owner-a", "commercial-a", "client-1", "mgr-1"])
      expect(await plansFor(db, scope(user)).deliver(plan.planId, plan.revisionId), user).toBe(false);
    expect((await stateOf(plan.revisionId)).state).toBe("APPROVED");
  });

  it("keeps a delivered revision intact when a new revision is made from it", async () => {
    const plan = await deliverable();
    const plans = plansFor(db, scope("tech-a"));
    const before = await plans.findRevision(plan.planId, plan.revisionId);
    const next = (await plans.newRevisionFrom(plan.planId, plan.revisionId)) as { revisionId: string; status: string };
    expect(next.status).toBe("created");
    expect(await stateOf(next.revisionId)).toMatchObject({ state: "DRAFT", approvedAt: null, deliveredAt: null, screening: null });
    await prescriptionFor(db, scope("tech-a")).add(plan.planId, next.revisionId, slot(1), { customName: "Só na nova" });
    expect(await plans.findRevision(plan.planId, plan.revisionId)).toEqual(before);
    expect((await stateOf(plan.revisionId)).state).toBe("DELIVERED");
  });
});

describe("what the client sees", () => {
  it("shows only delivered revisions, to the linked login, without anything private", async () => {
    const library = exercisesFor(db, scope("tech-a"));
    const own = (await library.create({ name: "Meu exercício", category: "Core", notes: "segredo da organização" })) as { id: string };
    const plan = await newPlan("st-1", 0);
    const rx = prescriptionFor(db, scope("tech-a"));
    await rx.add(plan.planId, plan.revisionId, slot(1), { exerciseId: own.id }, { sets: "3", reps: "8-12", restSeconds: 60, notes: "para o aluno" });
    await rx.add(plan.planId, plan.revisionId, slot(1), { exerciseId: "sys-001" });
    await rx.add(plan.planId, plan.revisionId, slot(1), { customName: "Terceiro" });
    for (const phase of [2, 3]) await rx.copyPhase(plan.planId, plan.revisionId, 1, phase);
    const plans = plansFor(db, scope("tech-a"));

    // Draft, READY and APPROVED are invisible to the client.
    expect(await clientSees(plan.planId)).toBe(false);
    await plans.markReady(plan.planId, plan.revisionId);
    expect(await clientSees(plan.planId)).toBe(false);
    await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, at(10));
    expect(await clientSees(plan.planId)).toBe(false);
    await plans.deliver(plan.planId, plan.revisionId, at(11));

    const seen = await studentTrainingFor(db, "client-1", "st-1");
    const mine = seen.find((p) => p.planId === plan.planId)!;
    expect(mine).toMatchObject({ revisionNumber: 1, deliveredAt: at(11).toISOString() });
    expect(mine.phases).toHaveLength(3);
    expect(mine.phases[0].workouts[0].label).toBe(FB);
    expect(mine.phases[0].workouts[0].exercises.map((e) => e.name)).toEqual(["Meu exercício", "Agachamento goblet", "Terceiro"]);
    expect(mine.phases[0].workouts[0].exercises[0]).toMatchObject({ sets: "3", reps: "8-12", restSeconds: 60, notes: "para o aluno" });
    expect(mine.phases[2].workouts[0].exercises).toHaveLength(3);
    // Nothing private or internal travels with it.
    const text = JSON.stringify(mine);
    for (const secret of ["segredo da organização", "tech-a", "org-a", "created_by", "organization", "approved", "screening"])
      expect(text, secret).not.toContain(secret);

    // Editing the library afterwards changes nothing the client was given.
    await library.update(own.id, { name: "Outro nome", category: "Core" });
    expect((await studentTrainingFor(db, "client-1", "st-1")).find((p) => p.planId === plan.planId)?.phases[0].workouts[0].exercises[0].name).toBe("Meu exercício");

    // A new draft or a READY revision never replaces what was delivered.
    const next = (await plans.newRevisionFrom(plan.planId, plan.revisionId)) as { revisionId: string };
    await rx.add(plan.planId, next.revisionId, slot(1), { customName: "Rascunho novo" });
    await plans.markReady(plan.planId, next.revisionId);
    expect((await studentTrainingFor(db, "client-1", "st-1")).find((p) => p.planId === plan.planId)).toMatchObject({ revisionNumber: 1 });
    // Delivering the new one replaces it, and the client sees the newest delivered.
    await plans.approve(plan.planId, next.revisionId, { screeningNotRecorded: true }, at(12));
    await plans.deliver(plan.planId, next.revisionId, at(13));
    const latest = (await studentTrainingFor(db, "client-1", "st-1")).find((p) => p.planId === plan.planId)!;
    expect(latest.revisionNumber).toBe(2);
    expect(latest.phases[0].workouts[0].exercises.map((e) => e.name)).toContain("Rascunho novo");
  });

  it("is closed to everyone but the linked login, and ends with the access", async () => {
    const plan = await deliverable("st-1");
    expect((await studentTrainingFor(db, "client-1", "st-1")).some((p) => p.planId === plan.planId)).toBe(true);
    // Another client, the professional, the owner, the manager and strangers get nothing.
    for (const user of ["client-2", "tech-a", "tech-a2", "owner-a", "commercial-a", "mgr-1", "tech-b", "stranger"])
      expect(await studentTrainingFor(db, user, "st-1"), user).toEqual([]);
    // A client cannot ask for another student's plan by id.
    expect(await studentTrainingFor(db, "client-1", "st-2")).toEqual([]);
    expect(await studentTrainingFor(db, "client-1", "st-b")).toEqual([]);
    expect(await studentTrainingFor(db, "", "st-1")).toEqual([]);

    await db.prepare("UPDATE student_access SET revoked_at = '2026-11-20T00:00:00.000Z' WHERE user_id = 'client-1'").run();
    expect(await studentTrainingFor(db, "client-1", "st-1")).toEqual([]);
    await db.prepare("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-1'").run();
    await db.prepare("UPDATE users SET disabled_at = '2026-11-20T00:00:00.000Z' WHERE id = 'client-1'").run();
    expect(await studentTrainingFor(db, "client-1", "st-1")).toEqual([]);
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = 'client-1'").run();
    expect((await studentTrainingFor(db, "client-1", "st-1")).length).toBeGreaterThan(0);
  });
});
