import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentsFor } from "@/db/assessments";
import { planDocumentsFor, recordPdfDownload } from "@/db/plan-documents";
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
const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 10, 0, 0) + minute * 60_000);

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
    expect(await plans.deliver(plan.planId, plan.revisionId, at(6))).toEqual({ status: "not_found" }); // the READY one is not approved
    expect(await plans.deliver(plan.planId, next.revisionId, at(6))).toEqual({ status: "delivered" });
    expect(await clientSees(plan.planId)).toBe(true);
    expect(await plans.deliver(plan.planId, next.revisionId, at(7))).toEqual({ status: "not_found" });
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
      expect(await other.deliver(plan.planId, plan.revisionId), user).toEqual({ status: "not_found" });
    }
    expect((await stateOf(plan.revisionId)).state).toBe("READY");
    await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true });
    for (const user of ["tech-a2", "owner-a", "commercial-a", "client-1", "mgr-1"])
      expect(await plansFor(db, scope(user)).deliver(plan.planId, plan.revisionId), user).toEqual({ status: "not_found" });
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

describe("the screening standing behind an approval", () => {
  const owner = "tech-a2"; // professional of st-2
  const api = () => assessmentsFor(db, scope(owner));
  const approvedRow = async (revisionId: string) =>
    (await db.prepare("SELECT approval_screening AS screening, approval_assessment_id AS assessmentId FROM plan_revisions WHERE id = ?1").bind(revisionId).first<{ screening: string | null; assessmentId: string | null }>())!;
  // The assessment date is the day of `input.assessedOn`; later days are newer assessments.
  async function assess(input: { assessedOn: string } & Record<string, unknown>) {
    const when = new Date(`${input.assessedOn}T12:00:00Z`);
    const started = await api().startDraft("st-2", when);
    if (started.status !== "started") throw new Error(started.status);
    await api().saveDraft(started.id, input, when);
    await api().record(started.id, { screeningAsked: true }, when);
    return started.id;
  }
  async function readyPlan() {
    const plan = await newPlan("st-2", 3, 3, owner);
    await plansFor(db, scope(owner)).markReady(plan.planId, plan.revisionId);
    return plan;
  }

  it("blocks approval and delivery on an alert nobody reviewed, and says why", async () => {
    const plans = plansFor(db, scope(owner));
    const plan = await readyPlan();
    const alert = await assess({ assessedOn: "2026-10-01", chestPain: true });
    expect(await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, at(21))).toEqual({ status: "review_required", assessedOn: "2026-10-01" });
    expect((await stateOf(plan.revisionId)).state).toBe("READY");

    // A review with a basis releases the block. It never turns the alert into 'clear'.
    expect(await api().addReview(alert, "Atestado médico recebido", at(22))).toBe(true);
    expect(await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: false }, at(23))).toEqual({ status: "approved" });
    expect(await approvedRow(plan.revisionId)).toEqual({ screening: "REVIEW_REQUIRED_REVIEWED", assessmentId: alert });
    expect((await api().get(alert))?.riskStatus).toBe("REVIEW_REQUIRED");
    expect(await plans.deliver(plan.planId, plan.revisionId, at(24))).toEqual({ status: "delivered" });
  });

  it("records a clear assessment as such, without asking for the acknowledgement", async () => {
    const plans = plansFor(db, scope(owner));
    const plan = await readyPlan();
    const clear = await assess({ assessedOn: "2026-10-02" });
    expect(await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: false }, at(31))).toEqual({ status: "approved" });
    expect(await approvedRow(plan.revisionId)).toEqual({ screening: "CLEAR", assessmentId: clear });
    expect(await plans.deliver(plan.planId, plan.revisionId, at(32))).toEqual({ status: "delivered" });
  });

  it("holds delivery when an alert is recorded after the approval, until it is reviewed", async () => {
    const plans = plansFor(db, scope(owner));
    const plan = await readyPlan();
    expect((await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: false }, at(40))).status).toBe("approved");
    const approvedWith = await approvedRow(plan.revisionId); // CLEAR from the previous test
    expect(approvedWith.screening).toBe("CLEAR");
    const alert = await assess({ assessedOn: "2026-10-03", dizzinessFainting: true });
    expect(await plans.deliver(plan.planId, plan.revisionId, at(42))).toEqual({ status: "review_required", assessedOn: "2026-10-03" });
    expect((await stateOf(plan.revisionId)).state).toBe("APPROVED");
    expect(await clientSees(plan.planId, "client-2", "st-2")).toBe(false);
    await api().addReview(alert, "Aluno avaliado por cardiologista", at(43));
    expect(await plans.deliver(plan.planId, plan.revisionId, at(44))).toEqual({ status: "delivered" });
    // What approval recorded is not rewritten by the later assessment.
    expect(await approvedRow(plan.revisionId)).toEqual(approvedWith);
  });

  it("follows the newest assessment: a later clear one ends the block, a later alert starts it", async () => {
    const plans = plansFor(db, scope(owner));
    const plan = await readyPlan();
    await assess({ assessedOn: "2026-10-04", recentSurgery: true });
    expect((await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, at(51))).status).toBe("review_required");
    const clear = await assess({ assessedOn: "2026-10-05" });
    expect((await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: false }, at(53))).status).toBe("approved");
    expect((await approvedRow(plan.revisionId)).assessmentId).toBe(clear);
  });

  it("does not let a stale reading approve: the update re-checks the newest assessment itself", async () => {
    const plan = await readyPlan();
    // An alert gets recorded between the repository reading the standing and writing the approval.
    let injected = false;
    const racing = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (property !== "batch") return typeof value === "function" ? value.bind(target) : value;
        return async (statements: Parameters<D1Database["batch"]>[0]) => {
          if (!injected) {
            injected = true;
            await assess({ assessedOn: "2026-10-06", exertionPain: true });
          }
          return target.batch(statements);
        };
      },
    });
    const result = await plansFor(racing, scope(owner)).approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, at(61));
    expect(injected).toBe(true);
    // The newer alert was not part of what the professional saw, so nothing was approved.
    expect(result).toEqual({ status: "screening_changed" });
    expect((await stateOf(plan.revisionId)).state).toBe("READY");
    // Read again, the same situation is a plain block.
    expect(await plansFor(db, scope(owner)).approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, at(62))).toEqual({ status: "review_required", assessedOn: "2026-10-06" });
  });

  it("freezes the recorded standing of an approval against direct SQL", async () => {
    const plans = plansFor(db, scope(owner));
    const plan = await readyPlan();
    // st-2 now has an unreviewed alert from the previous test: review it first.
    const standing = (await api().standing("st-2"))!;
    if (!standing.reviewed) await api().addReview(standing.assessmentId, "Revisado", at(70));
    expect((await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: false }, at(71))).status).toBe("approved");
    await expect(db.prepare("UPDATE plan_revisions SET approval_screening = 'CLEAR' WHERE id = ?1").bind(plan.revisionId).run()).rejects.toThrow(/PLAN_REVISION_FROZEN/);
    await expect(db.prepare("UPDATE plan_revisions SET approval_assessment_id = NULL WHERE id = ?1").bind(plan.revisionId).run()).rejects.toThrow(/PLAN_REVISION_FROZEN/);
  });
});

describe("the delivered revision as a document", () => {
  it("is available to the professional only once delivered, and for any delivered revision", async () => {
    const plans = plansFor(db, scope("tech-a"));
    const docs = planDocumentsFor(db, scope("tech-a"));
    const plan = await newPlan();
    // Draft, ready and approved have not been handed to the student: no file for them.
    expect(await docs.delivered(plan.planId, plan.revisionId)).toBeNull();
    await plans.markReady(plan.planId, plan.revisionId);
    expect(await docs.delivered(plan.planId, plan.revisionId)).toBeNull();
    await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, at(80));
    expect(await docs.delivered(plan.planId, plan.revisionId)).toBeNull();
    await plans.deliver(plan.planId, plan.revisionId, at(81));

    const first = (await docs.delivered(plan.planId, plan.revisionId))!;
    expect(first).toMatchObject({ studentId: "st-1", studentName: "Student One", organizationName: "Studio A" });
    expect(first.plan).toMatchObject({ planId: plan.planId, revisionId: plan.revisionId, revisionNumber: 1, deliveredBy: "Pro A", deliveredAt: at(81).toISOString() });
    expect(first.plan.phases).toHaveLength(3);
    expect(first.plan.phases[0].workouts[0].exercises.map((e) => e.name)).toEqual(["Exercício 1", "Exercício 2", "Exercício 3"]);

    // A newer delivered revision supersedes it for the student, but the older one stays readable
    // and identical: it is the history.
    const next = (await plans.newRevisionFrom(plan.planId, plan.revisionId)) as { revisionId: string };
    await prescriptionFor(db, scope("tech-a")).add(plan.planId, next.revisionId, slot(1), { customName: "Só na segunda" });
    await plans.markReady(plan.planId, next.revisionId);
    await plans.approve(plan.planId, next.revisionId, { screeningNotRecorded: true }, at(82));
    await plans.deliver(plan.planId, next.revisionId, at(83));
    expect(await docs.delivered(plan.planId, plan.revisionId)).toEqual(first);
    const second = (await docs.delivered(plan.planId, next.revisionId))!;
    expect(second.plan.revisionNumber).toBe(2);
    expect(second.plan.phases[0].workouts[0].exercises.map((e) => e.name)).toContain("Só na segunda");
    expect(first.plan.phases[0].workouts[0].exercises.map((e) => e.name)).not.toContain("Só na segunda");
  });

  it("is refused to anyone without an active technical assignment, and ends with it", async () => {
    const plan = await deliverable();
    const reach = (user: string, org = "org-a") => planDocumentsFor(db, scope(user, org)).delivered(plan.planId, plan.revisionId);
    for (const [user, org] of [["tech-a2", "org-a"], ["owner-a", "org-a"], ["commercial-a", "org-a"], ["client-1", "org-a"], ["mgr-1", "org-a"], ["tech-b", "org-b"], ["tech-b", "org-a"], ["stranger", "org-a"]])
      expect(await reach(user, org), `${user}/${org}`).toBeNull();
    expect(await reach("tech-a")).not.toBeNull();
    // The plan and revision ids alone do not select another organization's data.
    expect(await planDocumentsFor(db, scope("tech-b", "org-b")).delivered(plan.planId, "nope")).toBeNull();

    await db.prepare("UPDATE care_assignments SET revoked_at = '2026-11-30T00:00:00.000Z' WHERE student_id = 'st-1'").run();
    expect(await reach("tech-a")).toBeNull();
    await db.prepare("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'").run();
    await db.prepare("UPDATE users SET disabled_at = '2026-11-30T00:00:00.000Z' WHERE id = 'tech-a'").run();
    expect(await reach("tech-a")).toBeNull();
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'").run();
    expect(await reach("tech-a")).not.toBeNull();
  });

  it("records who downloaded which revision and when, never the content", async () => {
    const plan = await deliverable();
    await recordPdfDownload(db, { organizationId: "org-a", actorUserId: "client-1", revisionId: plan.revisionId }, at(90));
    const row = await db
      .prepare("SELECT organization_id AS org, actor_user_id AS actor, action, subject_id AS subject, created_at AS at FROM access_audit_events WHERE action = 'PLAN_PDF_DOWNLOADED' AND subject_id = ?1")
      .bind(plan.revisionId)
      .first<{ org: string; actor: string; action: string; subject: string; at: string }>();
    expect(row).toEqual({ org: "org-a", actor: "client-1", action: "PLAN_PDF_DOWNLOADED", subject: plan.revisionId, at: at(90).toISOString() });
  });
});
