import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { planDocumentsFor } from "@/db/plan-documents";
import { studentTrainingFor } from "@/db/student-plan";
import { assessmentsFor } from "@/db/assessments";
import { NAME_HISTORY_LIMIT, workspaceSettingsFor } from "@/db/workspace-settings";
import { deliveredByText } from "@/modules/configuracoes/delivered-by";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Slice 0.90 on a real local D1: the names of who delivered (a plan revision) or recorded (an assessment) are written at that moment and
// never follow a later rename; the renames themselves are kept as a history. The database is first built up to 0038, with a delivery and a
// record made then, so the backfill of 0039 is exercised as production will run it. Identities are rows, as the server derives them.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const FB = "Full Body";
const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 10, 0, 0) + minute * 60_000);
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const BEFORE_0039 = ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf("0039_delivery_names.sql"));

async function delivered(student = "st-1", owner = "tech-a", minute = 0, raw = false, broughtName?: string) {
  const plans = plansFor(db, scope(owner));
  const rx = prescriptionFor(db, scope(owner));
  const created = (await plans.create(student, {
    title: `Plano ${crypto.randomUUID().slice(0, 6)}`,
    input: {
      startDate: "2026-11-02",
      phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: FB, exercisesPerSession: 3 })),
    },
  }))!;
  if (raw) {
    // Before 0041 the prescription of now also writes per-session doses (tables not there yet): rows as the application of then
    // wrote them, three per phase.
    for (let phase = 1; phase <= 3; phase++)
      for (let i = 0; i < 3; i++)
        await run(
          `INSERT INTO prescribed_exercises (id, organization_id, revision_id, phase_index, workout_label, position, name, sets, reps,
             origin, created_by_user_id, created_at, updated_at)
           VALUES (?1, 'org-a', ?2, ?3, ?4, ?5, ?6, '3', '10', 'PROFESSIONAL', ?7, 'x', 'x')`,
          crypto.randomUUID(), created.revisionId, phase, FB, i + 1, `Exercício ${i + 1}`, owner,
        );
  } else {
    for (let i = 0; i < 3; i++)
      await rx.add(created.planId, created.revisionId, { phaseIndex: 1, workoutLabel: FB }, { customName: `Exercício ${i + 1}` }, { sets: "3", reps: "10" });
    await rx.copyPhase(created.planId, created.revisionId, 1, 2);
    await rx.copyPhase(created.planId, created.revisionId, 1, 3);
  }
  if (raw) {
    // markReady of now also closes automatic proposals (0042, not there yet before 0039): READY as the application of then wrote it.
    await run("UPDATE plan_revisions SET state = 'READY', ready_at = ?2 WHERE id = ?1", created.revisionId, at(minute).toISOString());
  } else expect(await plans.markReady(created.planId, created.revisionId)).toBe(true);
  if (raw) {
    // Before 0039 the application of now cannot read the revision (its columns do not exist yet): approved and delivered as the
    // application of then wrote it.
    await run(
      "UPDATE plan_revisions SET state = 'APPROVED', approved_at = ?2, approved_by_user_id = ?3, approval_screening = 'NOT_RECORDED' WHERE id = ?1",
      created.revisionId, at(minute + 1).toISOString(), owner,
    );
    if (broughtName !== undefined) {
      // A direct write that delivers and brings its own name in the same statement.
      await run(
        "UPDATE plan_revisions SET state = 'DELIVERED', delivered_at = ?2, delivered_by_user_id = ?3, delivered_by_name = ?4 WHERE id = ?1",
        created.revisionId, at(minute + 2).toISOString(), owner, broughtName,
      );
      return created;
    }
    await run(
      "UPDATE plan_revisions SET state = 'DELIVERED', delivered_at = ?2, delivered_by_user_id = ?3 WHERE id = ?1",
      created.revisionId, at(minute + 2).toISOString(), owner,
    );
    return created;
  }
  await plans.approve(created.planId, created.revisionId, { screeningNotRecorded: true }, at(minute + 1));
  expect(await plans.deliver(created.planId, created.revisionId, at(minute + 2))).toEqual({ status: "delivered" });
  return created;
}
/** An assessment of the earlier format recorded by a direct write, as the earlier application did. */
async function recorded(id: string, by = "tech-a", student = "st-1") {
  await run(
    `INSERT INTO assessments (id,organization_id,student_id,assessed_on,kind,state,risk_status,created_by_user_id,screening_answered)
     VALUES (?1,'org-a',?2,'2026-11-01','INITIAL','DRAFT','CLEAR',?3,'[]')`,
    id,
    student,
    by,
  );
  await run("UPDATE assessments SET state = 'RECORDED', recorded_at = ?2, recorded_by_user_id = ?3 WHERE id = ?1", id, at(5).toISOString(), by);
}
const namesOf = async (revisionId: string) =>
  (await db
    .prepare("SELECT delivered_by_name AS byName, delivered_organization_name AS orgName FROM plan_revisions WHERE id = ?1")
    .bind(revisionId)
    .first<{ byName: string | null; orgName: string | null }>())!;
const assessmentNames = async (id: string) =>
  (await db
    .prepare("SELECT recorded_by_name AS byName, recorded_organization_name AS orgName FROM assessments WHERE id = ?1")
    .bind(id)
    .first<{ byName: string | null; orgName: string | null }>())!;

let early: { planId: string; revisionId: string };

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "delivery-names-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, BEFORE_0039);
  const people = ["owner-a", "tech-a", "tech-a2", "commercial-a", "owner-b", "tech-b", "client-1"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES
       ('org-a','owner-a','OWNER'),('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),('org-a','commercial-a','COMMERCIAL'),
       ('org-b','owner-b','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner-a','org-a','owner-a','Dona A'),('pro-a','org-a','tech-a','Pro A'),('pro-a2','org-a','tech-a2','Pro A2'),
       ('pro-owner-b','org-b','owner-b','Dono B'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Aluno Um'),('st-b','org-b','Aluno B')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-b','st-b','pro-b')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
  ]);
  // Before 0039: a delivery and a record, then renames that the old code read live. The name at the moment is lost; 0039 takes the current one.
  early = await delivered("st-1", "tech-a", 0, true);
  await recorded("early-1");
  await run("UPDATE organizations SET name = 'Studio A antes' WHERE id = 'org-a'");
  await run("UPDATE professionals SET display_name = 'Pro A antes' WHERE user_id = 'tech-a'");
  await migrate(db, ALL_MIGRATIONS.slice(ALL_MIGRATIONS.indexOf("0039_delivery_names.sql")));
});
afterAll(async () => {
  await mf?.dispose();
});

describe("migration 0039", () => {
  it("fills the names of earlier deliveries and records from the names as they are when it runs", async () => {
    expect(await namesOf(early.revisionId)).toEqual({ byName: "Pro A antes", orgName: "Studio A antes" });
    expect(await assessmentNames("early-1")).toEqual({ byName: "Pro A antes", orgName: "Studio A antes" });
    // No history is invented for the renames made before it.
    expect((await db.prepare("SELECT COUNT(*) AS n FROM name_history").first<{ n: number }>())!.n).toBe(0);
  });
});

describe("names written at the moment of the delivery", () => {
  it("keeps the names of a delivery after the workspace and the professional are renamed, wherever it is read", async () => {
    const plan = await delivered("st-1", "tech-a", 10);
    expect(await namesOf(plan.revisionId)).toEqual({ byName: "Pro A antes", orgName: "Studio A antes" });
    expect(await workspaceSettingsFor(db, scope("owner-a")).renameWorkspace({ name: "Studio A novo" }, at(20))).toEqual({ status: "renamed" });
    expect(await workspaceSettingsFor(db, scope("tech-a")).renameSelf({ name: "Pro A novo" }, at(21))).toEqual({ status: "renamed" });

    const detail = (await plansFor(db, scope("tech-a")).findRevision(plan.planId, plan.revisionId))!;
    expect(detail.revision).toMatchObject({ deliveredByName: "Pro A antes", deliveredOrganizationName: "Studio A antes" });
    const student = (await studentTrainingFor(db, "client-1", "st-1")).find((item) => item.planId === plan.planId)!;
    expect(student).toMatchObject({ deliveredBy: "Pro A antes", deliveredOrganizationName: "Studio A antes" });
    const document = (await planDocumentsFor(db, scope("tech-a")).delivered(plan.planId, plan.revisionId))!;
    expect(document.plan).toMatchObject({ deliveredBy: "Pro A antes", deliveredOrganizationName: "Studio A antes" });

    // A delivery made after the renames carries the new names.
    const later = await delivered("st-1", "tech-a", 30);
    expect(await namesOf(later.revisionId)).toEqual({ byName: "Pro A novo", orgName: "Studio A novo" });
    // A revision that was never delivered names nobody.
    const draft = await plansFor(db, scope("tech-a")).newRevisionFrom(later.planId, later.revisionId);
    expect(draft.status).toBe("created");
    if (draft.status === "created") expect(await namesOf(draft.revisionId)).toEqual({ byName: null, orgName: null });
  });

  it("keeps who recorded an assessment and the workspace after renames", async () => {
    await recorded("rec-1");
    expect(await assessmentNames("rec-1")).toEqual({ byName: "Pro A novo", orgName: "Studio A novo" });
    expect(await workspaceSettingsFor(db, scope("tech-a")).renameSelf({ name: "Pro A terceiro" }, at(40))).toEqual({ status: "renamed" });
    const detail = (await assessmentsFor(db, scope("tech-a")).get("rec-1"))!;
    expect(detail).toMatchObject({ recordedByName: "Pro A novo", recordedOrganizationName: "Studio A novo" });
    // A draft has no names yet.
    await run(
      `INSERT INTO assessments (id,organization_id,student_id,assessed_on,kind,state,risk_status,created_by_user_id,screening_answered)
       VALUES ('draft-1','org-a','st-1','2026-11-02','REASSESSMENT','DRAFT','CLEAR','tech-a','[]')`,
    );
    expect(await assessmentNames("draft-1")).toEqual({ byName: null, orgName: null });
    await expect(run("UPDATE assessments SET recorded_by_name = 'Inventado' WHERE id = 'draft-1'")).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await run("DELETE FROM assessments WHERE id = 'draft-1'");
  });

  it("leaves the name empty, never invented, when whoever delivered had no professional record", async () => {
    await recorded("rec-commercial", "commercial-a");
    expect(await assessmentNames("rec-commercial")).toEqual({ byName: null, orgName: "Studio A novo" });
  });

  it("refuses to change the names once written, even by a direct write", async () => {
    for (const sql of [
      "UPDATE plan_revisions SET delivered_by_name = 'Outro' WHERE id = ?1",
      "UPDATE plan_revisions SET delivered_organization_name = 'Outro' WHERE id = ?1",
      "UPDATE plan_revisions SET delivered_by_name = NULL WHERE id = ?1",
    ])
      await expect(run(sql, early.revisionId), sql).rejects.toThrow(/PLAN_REVISION_FROZEN/);
    for (const sql of [
      "UPDATE assessments SET recorded_by_name = 'Outro' WHERE id = ?1",
      "UPDATE assessments SET recorded_organization_name = NULL WHERE id = ?1",
    ])
      await expect(run(sql, "early-1"), sql).rejects.toThrow(/ASSESSMENT_FROZEN/);
    // Even a delivery whose professional had no name cannot be given one afterwards.
    await expect(run("UPDATE assessments SET recorded_by_name = 'Inventado' WHERE id = 'rec-commercial'")).rejects.toThrow(/ASSESSMENT_FROZEN/);
    expect(await namesOf(early.revisionId)).toEqual({ byName: "Pro A antes", orgName: "Studio A antes" });
  });

  it("refuses a delivery, a record or an insert that brings its own names", async () => {
    await expect(delivered("st-1", "tech-a", 70, true, "Inventado")).rejects.toThrow(/PLAN_REVISION_FROZEN/);
    await run(
      `INSERT INTO assessments (id,organization_id,student_id,assessed_on,kind,state,risk_status,created_by_user_id,screening_answered)
       VALUES ('draft-2','org-a','st-1','2026-11-03','REASSESSMENT','DRAFT','CLEAR','tech-a','[]')`,
    );
    for (const sql of [
      "UPDATE assessments SET state = 'RECORDED', recorded_at = ?2, recorded_by_user_id = 'tech-a', recorded_by_name = 'Inventado' WHERE id = ?1",
      "UPDATE assessments SET state = 'RECORDED', recorded_at = ?2, recorded_by_user_id = 'tech-a', recorded_organization_name = 'Outro' WHERE id = ?1",
    ])
      await expect(run(sql, "draft-2", at(71).toISOString()), sql).rejects.toThrow(/ASSESSMENT_FROZEN/);
    expect(await assessmentNames("draft-2")).toEqual({ byName: null, orgName: null });
    await run("DELETE FROM assessments WHERE id = 'draft-2'");
    await expect(
      run(
        `INSERT INTO assessments (id,organization_id,student_id,assessed_on,kind,state,risk_status,created_by_user_id,screening_answered,
           recorded_at,recorded_by_user_id,recorded_by_name)
         VALUES ('ins-1','org-a','st-1','2026-11-03','REASSESSMENT','RECORDED','CLEAR','tech-a','[]',?1,'tech-a','Inventado')`,
        at(72).toISOString(),
      ),
    ).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(
      run(
        `INSERT INTO plan_revisions (id, organization_id, plan_id, revision_number, state, input_json, schedule_json, engine_version,
             start_date, end_date, total_weeks, total_sessions, created_by_user_id, created_at, updated_at, delivered_organization_name)
           SELECT 'ins-rev', organization_id, plan_id, 99, 'DRAFT', input_json, schedule_json, engine_version, start_date, end_date,
             total_weeks, total_sessions, created_by_user_id, created_at, updated_at, 'Outro'
           FROM plan_revisions WHERE id = ?1`,
        early.revisionId,
      ),
    ).rejects.toThrow(/PLAN_REVISION_FROZEN/);
  });
});

describe("history of names", () => {
  it("keeps every rename with the name before, the name after, who and when; never changed or deleted", async () => {
    const rows = (
      await db
        .prepare(
          `SELECT organization_id AS org, subject, subject_user_id AS who, previous_name AS before, new_name AS after,
             changed_by_user_id AS by, changed_at AS at FROM name_history ORDER BY changed_at, rowid`,
        )
        .all()
    ).results;
    expect(rows).toEqual([
      { org: "org-a", subject: "ORGANIZATION", who: null, before: "Studio A antes", after: "Studio A novo", by: "owner-a", at: at(20).toISOString() },
      { org: "org-a", subject: "PROFESSIONAL", who: "tech-a", before: "Pro A antes", after: "Pro A novo", by: "tech-a", at: at(21).toISOString() },
      { org: "org-a", subject: "PROFESSIONAL", who: "tech-a", before: "Pro A novo", after: "Pro A terceiro", by: "tech-a", at: at(40).toISOString() },
    ]);
    await expect(run("UPDATE name_history SET previous_name = 'x'")).rejects.toThrow(/NAME_HISTORY_FROZEN/);
    await expect(run("DELETE FROM name_history")).rejects.toThrow(/NAME_HISTORY_FROZEN/);
  });

  it("writes no history for a refused or unchanged rename", async () => {
    const count = async () => (await db.prepare("SELECT COUNT(*) AS n FROM name_history").first<{ n: number }>())!.n;
    const before = await count();
    expect(await workspaceSettingsFor(db, scope("tech-a")).renameWorkspace({ name: "Tomado" }, at(50))).toEqual({ status: "forbidden" });
    expect(await workspaceSettingsFor(db, scope("owner-b", "org-a")).renameWorkspace({ name: "Tomado" }, at(50))).toEqual({ status: "forbidden" });
    expect(await workspaceSettingsFor(db, scope("commercial-a")).renameSelf({ name: "Comercial" }, at(50))).toEqual({ status: "forbidden" });
    expect(await workspaceSettingsFor(db, scope("tech-a")).renameSelf({ name: "Pro A terceiro" }, at(50))).toEqual({ status: "unchanged" });
    expect(await count()).toBe(before);
  });

  it("shows the workspace's history to its members and each professional only their own, never another workspace's", async () => {
    const mine = (await workspaceSettingsFor(db, scope("tech-a")).read())!;
    expect(mine.workspaceNames).toEqual([{ previousName: "Studio A antes", newName: "Studio A novo", changedAt: at(20).toISOString() }]);
    expect(mine.myNames).toEqual([
      { previousName: "Pro A novo", newName: "Pro A terceiro", changedAt: at(40).toISOString() },
      { previousName: "Pro A antes", newName: "Pro A novo", changedAt: at(21).toISOString() },
    ]);
    const colleague = (await workspaceSettingsFor(db, scope("tech-a2")).read())!;
    expect(colleague.workspaceNames).toHaveLength(1);
    expect(colleague.myNames).toEqual([]);
    const other = (await workspaceSettingsFor(db, scope("owner-b", "org-b")).read())!;
    expect(other.workspaceNames).toEqual([]);
    expect(other.myNames).toEqual([]);
    // Someone outside the workspace reads nothing at all.
    expect(await workspaceSettingsFor(db, scope("owner-b", "org-a")).read()).toBeNull();
  });

  it("limits each list on its own and says when one was cut", async () => {
    const stamp = (i: number) => at(100 + i).toISOString();
    for (let i = 0; i <= NAME_HISTORY_LIMIT; i++)
      await run(
        `INSERT INTO name_history (id, organization_id, subject, subject_user_id, previous_name, new_name, changed_by_user_id, changed_at)
         VALUES (?1, 'org-b', 'ORGANIZATION', NULL, ?2, ?3, 'owner-b', ?4)`,
        `org-b-${i}`, `Espaço ${i}`, `Espaço ${i + 1}`, stamp(i + 1),
      );
    await run(
      `INSERT INTO name_history (id, organization_id, subject, subject_user_id, previous_name, new_name, changed_by_user_id, changed_at)
       VALUES ('owner-b-self', 'org-b', 'PROFESSIONAL', 'owner-b', 'Dono B antes', 'Dono B', 'owner-b', ?1)`,
      stamp(0),
    );
    const view = (await workspaceSettingsFor(db, scope("owner-b", "org-b")).read())!;
    expect(view.workspaceNames).toHaveLength(NAME_HISTORY_LIMIT);
    expect(view.workspaceNames[0]!.newName).toBe(`Espaço ${NAME_HISTORY_LIMIT + 1}`);
    expect(view.workspaceNamesTruncated).toBe(true);
    // The oldest change of all, behind more than the limit of workspace renames, is still listed as the person's own.
    expect(view.myNames).toEqual([{ previousName: "Dono B antes", newName: "Dono B", changedAt: stamp(0) }]);
    expect(view.myNamesTruncated).toBe(false);
  });
});

describe("deliveredByText", () => {
  it("says what is known and leaves out what is not", () => {
    expect(deliveredByText("Ana", "Estúdio X")).toBe(" por Ana (Estúdio X)");
    expect(deliveredByText("Ana", null)).toBe(" por Ana");
    expect(deliveredByText(null, "Estúdio X")).toBe(" (Estúdio X)");
    expect(deliveredByText("  ", undefined)).toBe("");
  });
});
