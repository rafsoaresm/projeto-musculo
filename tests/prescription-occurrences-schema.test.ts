import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import type { PeriodizationInputV1, PeriodizationInputV2 } from "@/modules/training/contracts";
import { buildPeriodization } from "@/modules/training/periodization";
import { ALL_MIGRATIONS, migrate, splitStatements } from "./helpers/migrate";

// Motor S3: migrations 0041 (prescription per occurrence), 0042 (proposals) and 0043 (execution per occurrence) against a real local D1.
// Covers the file rules (statement split), every new trigger, the content_version counter, the event/changes() contract of the existing
// batches, markReady closing an open proposal, newRevisionFrom copying provenance and occurrences, and legacy rows untouched by the
// migrations (topic 16). Nothing here writes a proposal through a repository: that is S6; rows are written raw to test the schema.

const NEW_MIGRATIONS = [
  "0041_prescription_occurrences.sql",
  "0042_prescription_proposals.sql",
  "0043_execution_occurrences.sql",
];
const BEFORE_0041 = ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf(NEW_MIGRATIONS[0]));

let mf: Miniflare;
let db: D1Database;
let legacy: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const stamp = "2026-11-04T10:00:00.000Z";
const H = "a".repeat(64);
let counter = 0;
const uid = (prefix = "id") => `${prefix}-${(++counter).toString().padStart(6, "0")}-${crypto.randomUUID().slice(0, 8)}`;
const writeId = () => `write-${crypto.randomUUID()}`;
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const first = <T>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const all = async <T>(sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<T>()).results;
const version = async (revisionId: string) =>
  (await first<{ v: number }>("SELECT content_version AS v FROM plan_revisions WHERE id = ?1", revisionId))!.v;
const refused = async (promise: Promise<unknown>, message: string | RegExp) => {
  await expect(promise).rejects.toThrow(message);
};

const V1: PeriodizationInputV1 = {
  startDate: "2026-11-02",
  phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: "AB" as const, exercisesPerSession: 3 })),
};
const V2: PeriodizationInputV2 = {
  schemaVersion: 2,
  startDate: "2026-11-02",
  phases: [
    {
      name: "Base",
      weeks: 2,
      sessionsPerWeek: 2,
      workouts: [
        { label: "A", name: null, exerciseTarget: 2, focus: null },
        { label: "B", name: null, exerciseTarget: 2, focus: null },
      ],
      rotation: null,
      trainingDays: [0, 3],
    },
  ],
};

async function newPlan(input: unknown = V1, student = "st-1", user = "tech-a") {
  const created = await plansFor(db, scope(user)).create(student, { title: `Plano ${crypto.randomUUID().slice(0, 6)}`, input });
  if (!created) throw new Error("plan refused");
  return created;
}
async function addRaw(planId: string, revisionId: string, phase: number, label: string, name: string) {
  const outcome = await prescriptionFor(db, scope("tech-a")).add(planId, revisionId, { phaseIndex: phase, workoutLabel: label }, { customName: name }, { sets: "3", reps: "10" });
  if (outcome.status !== "saved") throw new Error(`add refused: ${outcome.status}`);
  return outcome.id;
}
async function occurrence(revisionId: string, phase: number, week: number, slot: number, label: string, org = "org-a") {
  const id = uid("occ");
  await run(
    `INSERT INTO plan_session_occurrences (id, organization_id, revision_id, phase_index, week_index, slot_index, workout_label,
       week_start, planned_date, created_by_user_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '2026-11-02', '2026-11-02', 'tech-a', ?8, ?8)`,
    id, org, revisionId, phase, week, slot, label, stamp,
  );
  return id;
}
async function dose(revisionId: string, prescribedExerciseId: string, occurrenceId: string, included = 1, org = "org-a") {
  const id = uid("dose");
  await run(
    `INSERT INTO prescribed_exercise_occurrences (id, organization_id, revision_id, prescribed_exercise_id, occurrence_id, included,
       sets, reps, dose_text, origin, created_by_user_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, '3', '10', '3 × 10', 'SYSTEM', 'tech-a', ?7, ?7)`,
    id, org, revisionId, prescribedExerciseId, occurrenceId, included, stamp,
  );
  return id;
}
async function proposal(planId: string, revisionId: string, over: { id?: string; org?: string; state?: string } = {}) {
  const id = over.id ?? uid("prop");
  await run(
    `INSERT INTO prescription_proposals (id, organization_id, plan_id, revision_id, last_write_id, base_content_version, engine_version,
       rules_id, rules_version, parameters_json, status, validation, phases_generated, summary_json, output_hash, created_by_user_id,
       created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, '2.0.0', 'gymgital-base', '2026.11.1', '{}', 'SUCCEEDED', 'PASSED', '[1]', '{}', ?6, 'tech-a', ?7, ?7)`,
    id, over.org ?? "org-a", planId, revisionId, writeId(), H, stamp,
  );
  return id;
}
async function proposalOccurrence(proposalId: string, week = 1, slot = 1, label = "A") {
  const id = uid("pocc");
  await run(
    `INSERT INTO proposal_occurrences (id, organization_id, proposal_id, phase_index, week_index, slot_index, workout_label, week_start,
       generation_id) VALUES (?1, 'org-a', ?2, 1, ?3, ?4, ?5, '2026-11-02', 'gen-x')`,
    id, proposalId, week, slot, label,
  );
  return id;
}
async function proposalItem(proposalId: string, occurrenceId: string, over: { origin?: string; existing?: string | null; slotKey?: string } = {}) {
  const id = uid("item");
  await run(
    `INSERT INTO proposal_items (id, organization_id, proposal_id, proposal_occurrence_id, slot_key, position, exercise_name, trace_json,
       alternatives_json, metadata_trust, origin, existing_prescribed_exercise_id, generation_id)
     VALUES (?1, 'org-a', ?2, ?3, ?4, 1, 'Agachamento', '{}', '[]', 'REVIEWED', ?5, ?6, 'gen-x')`,
    id, proposalId, occurrenceId, over.slotKey ?? `slot-${id}`, over.origin ?? "ENGINE", over.existing ?? null,
  );
  return id;
}
async function deliver(planId: string, revisionId: string) {
  const plans = plansFor(db, scope("tech-a"));
  expect(await plans.markReady(planId, revisionId)).toBe(true);
  expect(await plans.approve(planId, revisionId, { screeningNotRecorded: true })).toEqual({ status: "approved" });
  expect(await plans.deliver(planId, revisionId)).toEqual({ status: "delivered" });
}
async function session(revisionId: string, label: string, occurrenceId: string | null, performedOn: string) {
  const id = uid("ws");
  await run(
    `INSERT INTO workout_sessions (id, organization_id, student_id, revision_id, phase_index, workout_label, performed_on, occurrence_id,
       logged_by_user_id, created_at, updated_at)
     VALUES (?1, 'org-a', 'st-1', ?2, 1, ?3, ?4, ?5, 'client-1', ?6, ?6)`,
    id, revisionId, label, performedOn, occurrenceId, stamp,
  );
  return id;
}

async function seedPeople(target: D1Database) {
  const people = ["tech-a", "tech-b", "client-1"];
  await target.batch([
    ...people.map((id) =>
      target.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?2,?3,0,0)").bind(id, `Nome ${id}`, `${id}@example.test`),
    ),
    ...people.map((id) => target.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    target.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    target.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL')"),
    target.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B')"),
    target.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Aluno Um'),('st-b','org-b','Aluno B')"),
    target.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-b','st-b','pro-b')"),
    target.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
  ]);
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "prescription-occurrences-tests", LEGACY: "prescription-occurrences-legacy" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  legacy = await mf.getD1Database("LEGACY");
  await migrate(db, ALL_MIGRATIONS);
  await seedPeople(db);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("migration files (design §3.1)", () => {
  const text = (file: string) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");

  it("are contiguous after 0040, and the health route names the newest migration", () => {
    const at = ALL_MIGRATIONS.indexOf("0040_result_classifications.sql");
    expect(ALL_MIGRATIONS.slice(at, at + 4)).toEqual(["0040_result_classifications.sql", ...NEW_MIGRATIONS]);
    const route = readFileSync(new URL("../src/app/api/health/route.ts", import.meta.url), "utf8");
    expect(route).toContain(`.bind("${ALL_MIGRATIONS.at(-1)!.replace(/\.sql$/, "")}")`);
  });

  it.each([
    ["0041_prescription_occurrences.sql", 34, { "ALTER TABLE": 8, "CREATE INDEX": 5, "CREATE TABLE": 2, "CREATE TRIGGER": 18 }],
    ["0042_prescription_proposals.sql", 38, { "CREATE TABLE": 7, "CREATE INDEX": 5, "CREATE UNIQUE": 1, "CREATE TRIGGER": 24 }],
    ["0043_execution_occurrences.sql", 11, { "ALTER TABLE": 5, "CREATE INDEX": 1, "CREATE TRIGGER": 4 }],
  ])("%s splits into exactly its statements", (file, count, kinds) => {
    const sql = text(file);
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(count);
    // Independent count: every statement starts at column 0 with one of these words.
    expect(sql.split("\n").filter((line) => /^(CREATE|ALTER|INSERT|UPDATE|DROP) /.test(line))).toHaveLength(count);
    const seen: Record<string, number> = {};
    for (const statement of statements.slice(0, -1)) {
      const kind = statement.split(/\s+/).slice(0, 2).join(" ");
      seen[kind] = (seen[kind] ?? 0) + 1;
    }
    expect(seen).toEqual(kinds);
    expect(statements.at(-1)).toBe(`INSERT INTO app_schema_versions(version) VALUES ('${file.replace(/\.sql$/, "")}')`);
    // No comment after a `;` (the splitter would glue statements) and no INSERT OR IGNORE (it hides CHECK failures).
    expect(sql.split("\n").filter((line) => /;\s*--/.test(line))).toEqual([]);
    expect(sql).not.toMatch(/INSERT\s+OR\s+IGNORE/i);
  });
});

describe("content_version (0041)", () => {
  it("starts at 0 on TEMPLATE, and a save with the same bytes is not a change, while the event is still recorded", async () => {
    const plan = await newPlan();
    const plans = plansFor(db, scope("tech-a"));
    const found = (await plans.findRevision(plan.planId, plan.revisionId))!;
    expect(found.revision).toMatchObject({ contentVersion: 0, prescriptionModel: "TEMPLATE" });
    expect(await plans.saveDraft(plan.planId, plan.revisionId, V1)).toBe(true);
    expect(await version(plan.revisionId)).toBe(0);
    const events = await all<{ action: string }>("SELECT action FROM training_plan_events WHERE revision_id = ?1", plan.revisionId);
    expect(events.map((e) => e.action).sort()).toEqual(["DRAFT_SAVED", "PLAN_CREATED"]);
    expect(await plans.saveDraft(plan.planId, plan.revisionId, { ...V1, startDate: "2026-11-09" })).toBe(true);
    expect(await version(plan.revisionId)).toBe(1);
    const listed = (await plans.listForStudent("st-1")).find((p) => p.id === plan.planId)!;
    expect(listed.revisions[0]).toMatchObject({ contentVersion: 1, prescriptionModel: "TEMPLATE" });
  });

  it("moves with every content change of the prescription, and not when nothing changed", async () => {
    const plan = await newPlan();
    const rx = prescriptionFor(db, scope("tech-a"));
    const a = await addRaw(plan.planId, plan.revisionId, 1, "A", "Agachamento");
    expect(await version(plan.revisionId)).toBe(1);
    const b = await addRaw(plan.planId, plan.revisionId, 1, "A", "Remada");
    expect(await version(plan.revisionId)).toBe(2);
    expect(await rx.update(plan.planId, plan.revisionId, a, { sets: "3", reps: "10" })).toBe(true);
    expect(await version(plan.revisionId)).toBe(2);
    expect(await rx.update(plan.planId, plan.revisionId, a, { sets: "4", reps: "10" })).toBe(true);
    expect(await version(plan.revisionId)).toBe(3);
    await run("UPDATE prescribed_exercises SET updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?1", a);
    expect(await version(plan.revisionId)).toBe(3);
    const edits = async () =>
      (await all<{ action: string }>("SELECT action FROM training_plan_events WHERE revision_id = ?1 AND action = 'PRESCRIPTION_EDITED'", plan.revisionId)).length;
    const editsBefore = await edits();
    // The current order again is not a change: no bump, no event, still accepted.
    expect(await rx.reorder(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "A" }, [a, b])).toBe(true);
    expect(await version(plan.revisionId)).toBe(3);
    expect(await edits()).toBe(editsBefore);
    expect(await rx.reorder(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "A" }, [b, a])).toBe(true);
    const afterReorder = await version(plan.revisionId);
    expect(afterReorder).toBeGreaterThan(3);
    expect(await edits()).toBe(editsBefore + 1);
    const order = await all<{ id: string }>("SELECT id FROM prescribed_exercises WHERE revision_id = ?1 ORDER BY position", plan.revisionId);
    expect(order.map((row) => row.id)).toEqual([b, a]);
    expect(await rx.remove(plan.planId, plan.revisionId, b)).toBe(true);
    expect(await version(plan.revisionId)).toBe(afterReorder + 1);
  });

  it("is frozen past DRAFT, never goes back, and the model moves only TEMPLATE to OCCURRENCE", async () => {
    const plan = await newPlan();
    await refused(run("UPDATE plan_revisions SET content_version = -1 WHERE id = ?1", plan.revisionId), "PLAN_REVISION_VERSION_INVALID");
    await run("UPDATE plan_revisions SET content_version = 5 WHERE id = ?1", plan.revisionId);
    await refused(run("UPDATE plan_revisions SET content_version = 4 WHERE id = ?1", plan.revisionId), "PLAN_REVISION_VERSION_INVALID");
    await refused(run("UPDATE plan_revisions SET prescription_model = 'OTHER' WHERE id = ?1", plan.revisionId), "CHECK constraint failed");
    await run("UPDATE plan_revisions SET prescription_model = 'OCCURRENCE' WHERE id = ?1", plan.revisionId);
    await refused(run("UPDATE plan_revisions SET prescription_model = 'TEMPLATE' WHERE id = ?1", plan.revisionId), "PLAN_REVISION_MODEL_INVALID");
    const other = await newPlan();
    expect(await plansFor(db, scope("tech-a")).markReady(other.planId, other.revisionId)).toBe(true);
    await refused(run("UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = ?1", other.revisionId), "PLAN_REVISION_FROZEN");
    await refused(run("UPDATE plan_revisions SET prescription_model = 'OCCURRENCE' WHERE id = ?1", other.revisionId), "PLAN_REVISION_FROZEN");
  });

  it("keeps where a row came from: provenance is written once", async () => {
    const plan = await newPlan();
    const a = await addRaw(plan.planId, plan.revisionId, 1, "A", "Agachamento");
    await refused(run("UPDATE prescribed_exercises SET application_id = 'app-x' WHERE id = ?1", a), "PRESCRIBED_EXERCISE_PROVENANCE_FROZEN");
    await refused(run("UPDATE prescribed_exercises SET copied_from_id = 'x' WHERE id = ?1", a), "PRESCRIBED_EXERCISE_PROVENANCE_FROZEN");
    await refused(run("UPDATE prescribed_exercises SET source_slot_key = 'slot-x' WHERE id = ?1", a), "PRESCRIBED_EXERCISE_PROVENANCE_FROZEN");
    await refused(run("UPDATE prescribed_exercises SET substitutes_prescribed_exercise_id = 'pe-x' WHERE id = ?1", a), "PRESCRIBED_EXERCISE_PROVENANCE_FROZEN");
    // Writing the same (NULL) value is not a change.
    await run("UPDATE prescribed_exercises SET source_slot_key = NULL, substitutes_prescribed_exercise_id = NULL WHERE id = ?1", a);
    await refused(run("UPDATE prescribed_exercises SET dose_json = 'not json' WHERE id = ?1", a), "CHECK constraint failed");
    await run("UPDATE prescribed_exercises SET dose_json = '{\"metric\":\"REPS\"}', dose_text = '3 × 10' WHERE id = ?1", a);
  });
});

describe("D1 change counts with the new triggers", () => {
  it("meta.changes counts trigger rows, SQL changes() does not: events and copy counts read changes()", async () => {
    const plan = await newPlan();
    const [inserted, direct] = await db.batch([
      db.prepare(
        `INSERT INTO prescribed_exercises (id, organization_id, revision_id, phase_index, workout_label, position, name, created_by_user_id)
         VALUES (?1, 'org-a', ?2, 1, 'A', 1, 'Supino', 'tech-a')`,
      ).bind(uid("pe"), plan.revisionId),
      db.prepare("SELECT changes() AS n"),
    ]);
    // The row itself plus the content_version bump of 0041: D1 reports both.
    expect(inserted.meta.changes).toBe(2);
    expect(direct.results).toEqual([{ n: 1 }]);
    // copyPhase / copyWorkout report the rows they copied, and still record their event.
    const rx = prescriptionFor(db, scope("tech-a"));
    await addRaw(plan.planId, plan.revisionId, 1, "A", "Remada");
    await addRaw(plan.planId, plan.revisionId, 1, "B", "Terra");
    expect(await rx.copyPhase(plan.planId, plan.revisionId, 1, 2)).toEqual({ status: "saved", copied: 3, skipped: [] });
    expect(await rx.copyWorkout(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { phaseIndex: 3, workoutLabel: "B" })).toEqual({ status: "saved", count: 2 });
    const edits = await first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM training_plan_events WHERE revision_id = ?1 AND action = 'PRESCRIPTION_EDITED'",
      plan.revisionId,
    );
    // Two adds and the two copies (the raw insert above records nothing).
    expect(edits!.n).toBe(4);
  });
});

describe("session occurrences (0041)", () => {
  it("ties each dose to one exercise and one occurrence of the same workout, revision and organization", async () => {
    const plan = await newPlan(V2);
    const a = await addRaw(plan.planId, plan.revisionId, 1, "A", "Agachamento");
    const occA = await occurrence(plan.revisionId, 1, 1, 1, "A");
    const occB = await occurrence(plan.revisionId, 1, 1, 2, "B");
    await dose(plan.revisionId, a, occA);
    await refused(dose(plan.revisionId, a, occA), "UNIQUE constraint failed");
    await refused(dose(plan.revisionId, a, occB), "OCCURRENCE_ITEM_INVALID");
    await refused(occurrence(plan.revisionId, 1, 1, 1, "A"), "UNIQUE constraint failed");
    // Another organization cannot hang a dose or an occurrence on this revision.
    await refused(occurrence(plan.revisionId, 1, 2, 1, "A", "org-b"), "FOREIGN KEY constraint failed");
    await refused(dose(plan.revisionId, a, occA, 1, "org-b"), "OCCURRENCE_ITEM_INVALID");
    // Identity and label never change; dates may, while DRAFT.
    await refused(run("UPDATE plan_session_occurrences SET workout_label = 'B' WHERE id = ?1", occA), "PLAN_REVISION_FROZEN");
    await refused(run("UPDATE plan_session_occurrences SET week_index = 9 WHERE id = ?1", occA), "PLAN_REVISION_FROZEN");
    await run("UPDATE plan_session_occurrences SET planned_date = '2026-11-03' WHERE id = ?1", occA);
    await refused(run("UPDATE prescribed_exercise_occurrences SET occurrence_id = ?1 WHERE prescribed_exercise_id = ?2", occB, a), "OCCURRENCE_ITEM_INVALID");
    // Children first.
    await refused(run("DELETE FROM plan_session_occurrences WHERE id = ?1", occA), "OCCURRENCE_ITEMS_FIRST");
    await refused(run("DELETE FROM prescribed_exercises WHERE id = ?1", a), "OCCURRENCE_ITEMS_FIRST");
    expect(await prescriptionFor(db, scope("tech-a")).remove(plan.planId, plan.revisionId, a).catch((e: unknown) => String(e))).toContain("OCCURRENCE_ITEMS_FIRST");
    await run("DELETE FROM prescribed_exercise_occurrences WHERE prescribed_exercise_id = ?1", a);
    await run("DELETE FROM plan_session_occurrences WHERE id = ?1", occA);
    // The occurrence tables have no bump triggers: the repository bumps once per batch (S7).
    const before = await version(plan.revisionId);
    await occurrence(plan.revisionId, 1, 2, 2, "B");
    expect(await version(plan.revisionId)).toBe(before);
  });

  it("freezes occurrences and doses once the revision leaves DRAFT", async () => {
    const plan = await newPlan(V2);
    const a = await addRaw(plan.planId, plan.revisionId, 1, "A", "Agachamento");
    const occ = await occurrence(plan.revisionId, 1, 1, 1, "A");
    const x = await dose(plan.revisionId, a, occ);
    const empty = await occurrence(plan.revisionId, 1, 1, 2, "B");
    expect(await plansFor(db, scope("tech-a")).markReady(plan.planId, plan.revisionId)).toBe(true);
    await refused(occurrence(plan.revisionId, 1, 2, 1, "A"), "PLAN_REVISION_FROZEN");
    await refused(run("UPDATE plan_session_occurrences SET planned_date = '2026-11-03' WHERE id = ?1", occ), "PLAN_REVISION_FROZEN");
    await refused(run("DELETE FROM plan_session_occurrences WHERE id = ?1", empty), "PLAN_REVISION_FROZEN");
    await refused(run("UPDATE prescribed_exercise_occurrences SET sets = '5' WHERE id = ?1", x), "PLAN_REVISION_FROZEN");
    await refused(run("DELETE FROM prescribed_exercise_occurrences WHERE id = ?1", x), "PLAN_REVISION_FROZEN");
    const occ2 = (await all<{ id: string }>("SELECT id FROM plan_session_occurrences WHERE revision_id = ?1", plan.revisionId))[0]!.id;
    await refused(dose(plan.revisionId, a, occ2), "PLAN_REVISION_FROZEN");
  });
});

describe("proposals (0042)", () => {
  it("opens only on a DRAFT of the same plan, one OPEN per revision, and versions step one at a time", async () => {
    const plan = await newPlan(V2);
    const other = await newPlan(V2);
    await refused(proposal(other.planId, plan.revisionId), "PLAN_REVISION_FROZEN");
    await refused(proposal(plan.planId, plan.revisionId, { org: "org-b" }), "PLAN_REVISION_FROZEN");
    const p = await proposal(plan.planId, plan.revisionId);
    await refused(proposal(plan.planId, plan.revisionId), "UNIQUE constraint failed");
    await refused(run("UPDATE prescription_proposals SET version = 3 WHERE id = ?1", p), "PROPOSAL_VERSION_INVALID");
    await run("UPDATE prescription_proposals SET version = version + 1, last_write_id = ?2 WHERE id = ?1", p, writeId());
    await run("UPDATE prescription_proposals SET version = version + 1, base_content_version = 4 WHERE id = ?1", p);
    await refused(run("UPDATE prescription_proposals SET version = version + 1, base_content_version = 3 WHERE id = ?1", p), "PROPOSAL_VERSION_INVALID");
    await refused(run("UPDATE prescription_proposals SET plan_id = ?2 WHERE id = ?1", p, other.planId), "PROPOSAL_IDENTITY_FROZEN");
    await refused(run("UPDATE prescription_proposals SET last_write_id = 'short' WHERE id = ?1", p), "CHECK constraint failed");
    // state_forward on its own (an OPEN proposal, so closed_frozen does not apply): it runs before the CHECK.
    await refused(run("UPDATE prescription_proposals SET state = 'REOPENED' WHERE id = ?1", p), "PROPOSAL_STATE_INVALID");
    await refused(run("DELETE FROM prescription_proposals WHERE id = ?1", p), "PROPOSAL_APPEND_ONLY");
    await run("UPDATE prescription_proposals SET state = 'APPLIED', version = version + 1, closed_at = ?2 WHERE id = ?1", p, stamp);
    await refused(run("UPDATE prescription_proposals SET state = 'OPEN' WHERE id = ?1", p), /PROPOSAL_(CLOSED|STATE_INVALID)/);
    // A closed proposal never changes, and a new one can open on the same revision.
    await refused(run("UPDATE prescription_proposals SET summary_json = '[]' WHERE id = ?1", p), "PROPOSAL_CLOSED");
    await proposal(plan.planId, plan.revisionId);
  });

  it("keeps its occurrences and items inside one proposal, writable only while OPEN", async () => {
    const plan = await newPlan(V2);
    const p = await proposal(plan.planId, plan.revisionId);
    const occ = await proposalOccurrence(p);
    const item = await proposalItem(p, occ);
    await proposalItem(p, occ, { origin: "SUBSTITUTED" });
    await proposalItem(p, occ, { origin: "LOCKED" });
    await refused(proposalItem(p, occ, { origin: "PRESERVED" }), "CHECK constraint failed");
    await refused(proposalItem(p, occ, { origin: "ENGINE", existing: "pe-x" }), "CHECK constraint failed");
    await proposalItem(p, occ, { origin: "PRESERVED", existing: "pe-x" });
    const slotKey = (await first<{ k: string }>("SELECT slot_key AS k FROM proposal_items WHERE id = ?1", item))!.k;
    await refused(proposalItem(p, occ, { slotKey }), "UNIQUE constraint failed");
    // An item must name an occurrence of its own proposal.
    const plan2 = await newPlan(V2);
    const p2 = await proposal(plan2.planId, plan2.revisionId);
    await refused(proposalItem(p2, occ), "PROPOSAL_ITEM_INVALID");
    await refused(run("UPDATE proposal_items SET proposal_occurrence_id = 'x' WHERE id = ?1", item), "PROPOSAL_CLOSED");
    await refused(run("DELETE FROM proposal_occurrences WHERE id = ?1", occ), "PROPOSAL_CLOSED");
    await run("UPDATE proposal_items SET origin = 'LOCKED' WHERE id = ?1", item);
    await refused(run("UPDATE proposal_occurrences SET workout_label = 'B' WHERE id = ?1", occ), "PROPOSAL_CLOSED");
    await run("UPDATE proposal_occurrences SET estimated_minutes = 52.5, duration_complete = 1 WHERE id = ?1", occ);
    await run("UPDATE prescription_proposals SET state = 'DISCARDED', version = version + 1 WHERE id = ?1", p);
    await refused(proposalOccurrence(p, 2), "PROPOSAL_CLOSED");
    await refused(proposalItem(p, occ), "PROPOSAL_CLOSED");
    await refused(run("UPDATE proposal_items SET position = 2 WHERE id = ?1", item), "PROPOSAL_CLOSED");
    await refused(run("DELETE FROM proposal_items WHERE id = ?1", item), "PROPOSAL_CLOSED");
  });

  it("appends generations, decisions and applications; the input of a generation is deletable, never rewritten", async () => {
    const plan = await newPlan(V2);
    const p = await proposal(plan.planId, plan.revisionId);
    const generation = (key: string, proposalId = p, planId = plan.planId) =>
      run(
        `INSERT INTO prescription_generations (id, organization_id, plan_id, revision_id, proposal_id, idempotency_key, request_hash, scope,
           scope_json, base_content_version, engine_version, rules_id, rules_version, vocabulary_version, catalog_hash, input_hash,
           output_hash, facts_json, status, validation, issue_codes_json, requested_by_user_id, created_at)
         VALUES (?1, 'org-a', ?2, ?3, ?4, ?5, ?6, 'FULL', '{}', 0, '2.0.0', 'gymgital-base', '2026.11.1', 'v1', ?6, ?6, ?6, '{}',
           'SUCCEEDED', 'PASSED', '[]', 'tech-a', ?7)`,
        `gen-${key}`, planId, plan.revisionId, proposalId, `key-${key}-0000000000`, H, stamp,
      );
    await generation("one");
    await refused(
      run(
        `INSERT INTO prescription_generations SELECT 'gen-dup', organization_id, plan_id, revision_id, proposal_id, idempotency_key, request_hash,
           scope, scope_json, base_content_version, base_proposal_version, engine_version, rules_id, rules_version, vocabulary_version,
           catalog_hash, input_hash, output_hash, facts_json, status, validation, issue_codes_json, requested_by_user_id, created_at
         FROM prescription_generations WHERE id = 'gen-one'`,
      ),
      "UNIQUE constraint failed",
    );
    const other = await newPlan(V2);
    await refused(generation("two", p, other.planId), "PROPOSAL_ITEM_INVALID");
    await refused(run("UPDATE prescription_generations SET status = 'INFEASIBLE' WHERE id = 'gen-one'"), "GENERATION_APPEND_ONLY");
    await refused(run("DELETE FROM prescription_generations WHERE id = 'gen-one'"), "GENERATION_APPEND_ONLY");
    const input = (student: string, org = "org-a") =>
      run(
        "INSERT INTO prescription_generation_inputs (generation_id, organization_id, student_id, input_json, created_at) VALUES ('gen-one', ?1, ?2, '{}', ?3)",
        org, student, stamp,
      );
    // The input belongs to the student of the plan, so the deletion by student_id reaches it.
    await refused(input("st-b"), "GENERATION_INPUT_STUDENT_INVALID");
    await refused(input("st-other"), "GENERATION_INPUT_STUDENT_INVALID");
    await refused(input("st-b", "org-b"), "GENERATION_INPUT_STUDENT_INVALID");
    await input("st-1");
    await refused(run("UPDATE prescription_generation_inputs SET input_json = '[]' WHERE generation_id = 'gen-one'"), "GENERATION_APPEND_ONLY");
    await run("DELETE FROM prescription_generation_inputs WHERE generation_id = 'gen-one'");
    expect(await first("SELECT id FROM prescription_generations WHERE id = 'gen-one'")).not.toBeNull();

    const decision = (action: string, write = writeId()) =>
      run(
        `INSERT INTO proposal_decisions (id, organization_id, proposal_id, actor_user_id, action, write_id, target_json, proposal_version_after, created_at)
         VALUES (?1, 'org-a', ?2, 'tech-a', ?3, ?4, '{}', 1, ?5)`,
        uid("dec"), p, action, write, stamp,
      );
    const w = writeId();
    await decision("GENERATED", w);
    await refused(decision("LOCK", w), "UNIQUE constraint failed");
    await refused(decision("APPROVE"), "CHECK constraint failed");
    await refused(run("UPDATE proposal_decisions SET reason = 'x' WHERE proposal_id = ?1", p), "DECISION_APPEND_ONLY");
    await refused(run("DELETE FROM proposal_decisions WHERE proposal_id = ?1", p), "DECISION_APPEND_ONLY");

    const application = (id: string, revisionId = plan.revisionId, proposalId = p) =>
      run(
        `INSERT INTO prescription_applications (id, organization_id, plan_id, revision_id, proposal_id, proposal_version, base_content_version,
           idempotency_key, request_hash, conflict_mode, applied_by_user_id, created_at)
         VALUES (?1, 'org-a', ?2, ?3, ?4, 1, 0, ?5, ?6, 'PRESERVE', 'tech-a', ?7)`,
        id, plan.planId, revisionId, proposalId, `key-${id}-000000000000`, H, stamp,
      );
    await refused(application("app-wrong", other.revisionId), "PLAN_REVISION_FROZEN");
    await application("app-one");
    await refused(application("app-two"), "UNIQUE constraint failed");
    await refused(run("UPDATE prescription_applications SET conflict_mode = 'REPLACE_CONFIRMED' WHERE id = 'app-one'"), "APPLICATION_APPEND_ONLY");
    await refused(run("DELETE FROM prescription_applications WHERE id = 'app-one'"), "APPLICATION_APPEND_ONLY");
    // Past DRAFT nothing is applied.
    await run("UPDATE prescription_proposals SET state = 'DISCARDED', version = version + 1 WHERE id = ?1", p);
    expect(await plansFor(db, scope("tech-a")).markReady(plan.planId, plan.revisionId)).toBe(true);
    await refused(proposal(plan.planId, plan.revisionId), "PLAN_REVISION_FROZEN");
  });

  it("markReady supersedes the open proposal in the same batch, with its decision and event, and only its own", async () => {
    const plan = await newPlan(V2);
    const plans = plansFor(db, scope("tech-a"));
    const p = await proposal(plan.planId, plan.revisionId);
    const untouched = await newPlan(V2);
    const keep = await proposal(untouched.planId, untouched.revisionId);
    // Someone of another organization cannot close it.
    expect(await plansFor(db, scope("tech-b", "org-b")).markReady(plan.planId, plan.revisionId)).toBe(false);
    expect((await first<{ s: string }>("SELECT state AS s FROM prescription_proposals WHERE id = ?1", p))!.s).toBe("OPEN");
    expect(await plans.markReady(plan.planId, plan.revisionId)).toBe(true);
    const closed = (await first<{ state: string; version: number; by: string; at: string | null }>(
      "SELECT state, version, closed_by_user_id AS by, closed_at AS at FROM prescription_proposals WHERE id = ?1",
      p,
    ))!;
    expect(closed).toMatchObject({ state: "SUPERSEDED", version: 2, by: "tech-a" });
    expect(closed.at).not.toBeNull();
    expect(await all("SELECT action, proposal_version_after AS v FROM proposal_decisions WHERE proposal_id = ?1", p)).toEqual([
      { action: "SUPERSEDED", v: 2 },
    ]);
    const events = await all<{ action: string }>("SELECT action FROM training_plan_events WHERE revision_id = ?1 ORDER BY action", plan.revisionId);
    expect(events.map((e) => e.action)).toEqual(["MARKED_READY", "PLAN_CREATED", "PROPOSAL_SUPERSEDED"]);
    expect((await first<{ s: string }>("SELECT state AS s FROM prescription_proposals WHERE id = ?1", keep))!.s).toBe("OPEN");
    // Without an open proposal nothing else is written.
    const bare = await newPlan(V2);
    expect(await plans.markReady(bare.planId, bare.revisionId)).toBe(true);
    const bareEvents = await all<{ action: string }>("SELECT action FROM training_plan_events WHERE revision_id = ?1 ORDER BY action", bare.revisionId);
    expect(bareEvents.map((e) => e.action)).toEqual(["MARKED_READY", "PLAN_CREATED"]);
    // A second markReady changes nothing.
    expect(await plans.markReady(plan.planId, plan.revisionId)).toBe(false);
    expect(await all("SELECT id FROM proposal_decisions WHERE proposal_id = ?1", p)).toHaveLength(1);
  });
});

describe("execution per occurrence (0043)", () => {
  it("leaves TEMPLATE logs as they were and refuses an occurrence on them", async () => {
    const plan = await newPlan(V2);
    await addRaw(plan.planId, plan.revisionId, 1, "A", "Agachamento");
    // A real occurrence of the same workout on a TEMPLATE revision (written before the model moved, or without it) is still refused.
    const occ = await occurrence(plan.revisionId, 1, 1, 1, "A");
    await deliver(plan.planId, plan.revisionId);
    await session(plan.revisionId, "A", null, "2026-11-02");
    await refused(session(plan.revisionId, "A", occ, "2026-11-03"), "SESSION_OCCURRENCE_INVALID");
    await refused(session(plan.revisionId, "A", "occ-none", "2026-11-04"), "SESSION_OCCURRENCE_INVALID");
  });

  it("requires the occurrence of the same workout on OCCURRENCE revisions, and only its included exercises", async () => {
    const plan = await newPlan(V2);
    const a = await addRaw(plan.planId, plan.revisionId, 1, "A", "Agachamento");
    const a2 = await addRaw(plan.planId, plan.revisionId, 1, "A", "Afundo");
    const occA = await occurrence(plan.revisionId, 1, 1, 1, "A");
    const occA2 = await occurrence(plan.revisionId, 1, 2, 1, "A");
    const occB = await occurrence(plan.revisionId, 1, 1, 2, "B");
    await dose(plan.revisionId, a, occA);
    await dose(plan.revisionId, a2, occA, 0);
    await dose(plan.revisionId, a, occA2);
    await run("UPDATE plan_revisions SET prescription_model = 'OCCURRENCE' WHERE id = ?1", plan.revisionId);
    await deliver(plan.planId, plan.revisionId);
    await refused(session(plan.revisionId, "A", null, "2026-11-02"), "SESSION_OCCURRENCE_INVALID");
    await refused(session(plan.revisionId, "A", occB, "2026-11-02"), "SESSION_OCCURRENCE_INVALID");
    const ws = await session(plan.revisionId, "A", occA, "2026-11-02");
    // The same occurrence may be logged again on another day (Q5); the same workout on the same day may not (0012).
    await session(plan.revisionId, "A", occA, "2026-11-04");
    await refused(session(plan.revisionId, "A", occA2, "2026-11-02"), "UNIQUE constraint failed");
    const exercise = (prescribedExerciseId: string) =>
      run(
        "INSERT INTO session_exercises (id, organization_id, session_id, prescribed_exercise_id, exercise_name, position) VALUES (?1, 'org-a', ?2, ?3, 'X', 1)",
        uid("se"), ws, prescribedExerciseId,
      );
    await refused(exercise(a2), "SESSION_EXERCISE_INVALID");
    await exercise(a);
    await refused(run("UPDATE workout_sessions SET occurrence_id = ?2 WHERE id = ?1", ws, occA2), "WORKOUT_SESSION_IDENTITY_FROZEN");
    const se = (await first<{ id: string }>("SELECT id FROM session_exercises WHERE session_id = ?1", ws))!.id;
    const set = (n: number, columns: string, values: string) =>
      run(`INSERT INTO session_sets (id, organization_id, session_exercise_id, set_number, ${columns}) VALUES (?1, 'org-a', ?2, ${n}, ${values})`, uid("set"), se);
    await set(1, "reps, load_kg, rir, load_basis", "10, 40, 2, 'PER_HAND'");
    await set(2, "duration_seconds, distance_meters", "600, 1500.5");
    await set(3, "reps", "8");
    await refused(set(4, "rir", "11"), "CHECK constraint failed");
    await refused(set(4, "load_basis", "'KG'"), "CHECK constraint failed");
    await refused(set(4, "distance_meters", "-1"), "CHECK constraint failed");
    const third = await first("SELECT rir, duration_seconds AS d, distance_meters AS m, load_basis AS b FROM session_sets WHERE session_exercise_id = ?1 AND set_number = 3", se);
    expect(third).toEqual({ rir: null, d: null, m: null, b: null });
  });
});

describe("newRevisionFrom (S3: ids made in code, provenance kept)", () => {
  it("copies a TEMPLATE revision under new ids, each row pointing at its source, with its origin", async () => {
    const plan = await newPlan();
    const a = await addRaw(plan.planId, plan.revisionId, 1, "A", "Agachamento");
    await run("UPDATE prescribed_exercises SET origin = 'SYSTEM' WHERE id = ?1", a);
    await addRaw(plan.planId, plan.revisionId, 2, "B", "Remada");
    await deliver(plan.planId, plan.revisionId);
    const plans = plansFor(db, scope("tech-a"));
    const copy = await plans.newRevisionFrom(plan.planId, plan.revisionId);
    expect(copy.status).toBe("created");
    if (copy.status !== "created") return;
    expect(await plans.newRevisionFrom(plan.planId, plan.revisionId)).toEqual({ status: "draft_open" });
    const rows = await all<{ id: string; from: string; origin: string; name: string }>(
      "SELECT id, copied_from_id AS \"from\", origin, name FROM prescribed_exercises WHERE revision_id = ?1 ORDER BY name",
      copy.revisionId,
    );
    const sources = await all<{ id: string; origin: string; name: string }>(
      "SELECT id, origin, name FROM prescribed_exercises WHERE revision_id = ?1 ORDER BY name",
      plan.revisionId,
    );
    expect(rows.map((r) => [r.name, r.origin, r.from])).toEqual(sources.map((s) => [s.name, s.origin, s.id]));
    expect(rows.every((r) => !sources.some((s) => s.id === r.id))).toBe(true);
    const found = (await plans.findRevision(plan.planId, copy.revisionId))!;
    expect(found.revision.prescriptionModel).toBe("TEMPLATE");
    expect(found.revision.contentVersion).toBe(2);
    expect(await all("SELECT id FROM plan_session_occurrences WHERE revision_id = ?1", copy.revisionId)).toEqual([]);
    // Another organization copies nothing.
    expect(await plansFor(db, scope("tech-b", "org-b")).newRevisionFrom(plan.planId, plan.revisionId)).toEqual({ status: "not_found" });
  });

  it("copies an OCCURRENCE revision: model, provenance, substitution remapped, occurrences and doses; no proposal", async () => {
    const plan = await newPlan(V2);
    const a = await addRaw(plan.planId, plan.revisionId, 1, "A", "Agachamento");
    const sub = uid("pe");
    await run(
      `INSERT INTO prescribed_exercises (id, organization_id, revision_id, phase_index, workout_label, position, name, origin, dose_json,
         dose_text, application_id, source_slot_key, substitutes_prescribed_exercise_id, created_by_user_id)
       VALUES (?1, 'org-a', ?2, 1, 'A', 5, 'Leg press', 'SYSTEM', '{"metric":"REPS"}', '3 × 12', 'app-1', 'slot-1', ?3, 'tech-a')`,
      sub, plan.revisionId, a,
    );
    const occ1 = await occurrence(plan.revisionId, 1, 1, 1, "A");
    const occ2 = await occurrence(plan.revisionId, 1, 2, 1, "A");
    await occurrence(plan.revisionId, 1, 1, 2, "B");
    await dose(plan.revisionId, a, occ1);
    await dose(plan.revisionId, a, occ2, 0);
    await dose(plan.revisionId, sub, occ2);
    await run("UPDATE plan_revisions SET prescription_model = 'OCCURRENCE' WHERE id = ?1", plan.revisionId);
    const open = await proposal(plan.planId, plan.revisionId);
    await run("UPDATE prescription_proposals SET state = 'DISCARDED', version = version + 1 WHERE id = ?1", open);
    await deliver(plan.planId, plan.revisionId);
    const sourceBefore = await all("SELECT * FROM prescribed_exercise_occurrences WHERE revision_id = ?1 ORDER BY id", plan.revisionId);

    const copy = await plansFor(db, scope("tech-a")).newRevisionFrom(plan.planId, plan.revisionId);
    if (copy.status !== "created") throw new Error(copy.status);
    const pe = await all<{ id: string; from: string; app: string | null; slot: string | null; subs: string | null; dose: string | null; text: string | null; origin: string }>(
      `SELECT id, copied_from_id AS "from", application_id AS app, source_slot_key AS slot, substitutes_prescribed_exercise_id AS subs,
         dose_json AS dose, dose_text AS text, origin FROM prescribed_exercises WHERE revision_id = ?1`,
      copy.revisionId,
    );
    const copyOf = (sourceId: string) => pe.find((row) => row.from === sourceId)!;
    expect(copyOf(sub)).toMatchObject({ app: "app-1", slot: "slot-1", subs: copyOf(a).id, dose: '{"metric":"REPS"}', text: "3 × 12", origin: "SYSTEM" });
    expect(copyOf(a).subs).toBeNull();
    const occurrences = await all<{ id: string; key: string; date: string }>(
      `SELECT id, phase_index || '/' || week_index || '/' || slot_index || '/' || workout_label AS key, planned_date AS date
       FROM plan_session_occurrences WHERE revision_id = ?1 ORDER BY key`,
      copy.revisionId,
    );
    expect(occurrences.map((o) => o.key)).toEqual(["1/1/1/A", "1/1/2/B", "1/2/1/A"]);
    const doses = await all<{ pe: string; key: string; included: number }>(
      `SELECT x.prescribed_exercise_id AS pe, o.week_index || '/' || o.slot_index AS key, x.included
       FROM prescribed_exercise_occurrences x JOIN plan_session_occurrences o ON o.id = x.occurrence_id
       WHERE x.revision_id = ?1 ORDER BY key, pe`,
      copy.revisionId,
    );
    expect(doses).toEqual(
      [
        { pe: copyOf(a).id, key: "1/1", included: 1 },
        { pe: copyOf(a).id, key: "2/1", included: 0 },
        { pe: copyOf(sub).id, key: "2/1", included: 1 },
      ].sort((x, y) => x.key.localeCompare(y.key) || x.pe.localeCompare(y.pe)),
    );
    const found = (await plansFor(db, scope("tech-a")).findRevision(plan.planId, copy.revisionId))!;
    expect(found.revision.prescriptionModel).toBe("OCCURRENCE");
    expect(await all("SELECT id FROM prescription_proposals WHERE revision_id = ?1", copy.revisionId)).toEqual([]);
    // The source is untouched.
    expect(await all("SELECT * FROM prescribed_exercise_occurrences WHERE revision_id = ?1 ORDER BY id", plan.revisionId)).toEqual(sourceBefore);
  });
});

describe("legacy rows (topic 16): 0041–0043 change nothing that exists", () => {
  const tables = ["plan_revisions", "prescribed_exercises", "training_plan_events", "workout_sessions", "session_exercises", "session_sets"];
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(tables.map(async (t) => [t, (await legacy.prepare(`SELECT * FROM ${t} ORDER BY id`).all<Record<string, unknown>>()).results])),
    ) as Record<string, Record<string, unknown>[]>;

  it("keeps every row and column byte for byte, with the new columns at their defaults", async () => {
    await migrate(legacy, BEFORE_0041);
    await seedPeople(legacy);
    const exec = (sql: string, ...binds: unknown[]) => legacy.prepare(sql).bind(...binds).run();
    // What 0.93 wrote: one delivered revision with a log, and a draft copied from it.
    const input = JSON.stringify(V1);
    const schedule = JSON.stringify(buildPeriodization(V1));
    await exec("INSERT INTO training_plans (id, organization_id, student_id, title, created_by_user_id) VALUES ('lp', 'org-a', 'st-1', 'Legado', 'tech-a')");
    await exec(
      `INSERT INTO plan_revisions (id, organization_id, plan_id, revision_number, state, input_json, schedule_json, engine_version, start_date,
         end_date, total_weeks, total_sessions, created_by_user_id) VALUES ('lr1', 'org-a', 'lp', 1, 'DRAFT', ?1, ?2, '0.1.0', '2026-11-02',
         '2027-01-24', 12, 36, 'tech-a')`,
      input, schedule,
    );
    for (const [id, label, pos] of [["lpe1", "A", 1], ["lpe2", "A", 2], ["lpe3", "B", 1]] as const)
      await exec(
        `INSERT INTO prescribed_exercises (id, organization_id, revision_id, phase_index, workout_label, position, name, sets, reps, rest_seconds,
           rir_min, rir_max, notes, created_by_user_id) VALUES (?1, 'org-a', 'lr1', 1, ?2, ?3, ?4, '3', '8-12', 90, 1, 3, 'Controle', 'tech-a')`,
        id, label, pos, `Exercício ${id}`,
      );
    await exec("INSERT INTO training_plan_events (id, organization_id, plan_id, revision_id, actor_user_id, action) VALUES ('le1', 'org-a', 'lp', 'lr1', 'tech-a', 'PLAN_CREATED')");
    await exec("UPDATE plan_revisions SET state = 'READY', ready_at = '2026-11-03T10:00:00.000Z' WHERE id = 'lr1'");
    await exec("UPDATE plan_revisions SET state = 'APPROVED', approved_at = '2026-11-03T11:00:00.000Z', approved_by_user_id = 'tech-a', approval_screening = 'NOT_RECORDED' WHERE id = 'lr1'");
    await exec("UPDATE plan_revisions SET state = 'DELIVERED', delivered_at = '2026-11-03T12:00:00.000Z', delivered_by_user_id = 'tech-a' WHERE id = 'lr1'");
    await exec(
      `INSERT INTO workout_sessions (id, organization_id, student_id, revision_id, phase_index, workout_label, performed_on, effort, logged_by_user_id,
         created_at, updated_at) VALUES ('lws', 'org-a', 'st-1', 'lr1', 1, 'A', '2026-11-04', 7, 'client-1', '2026-11-04T10:00:00.000Z', '2026-11-04T10:00:00.000Z')`,
    );
    await exec("INSERT INTO session_exercises (id, organization_id, session_id, prescribed_exercise_id, exercise_name, position, rir) VALUES ('lse', 'org-a', 'lws', 'lpe1', 'Exercício lpe1', 1, 2)");
    await exec("INSERT INTO session_sets (id, organization_id, session_exercise_id, set_number, reps, load_kg) VALUES ('lss1', 'org-a', 'lse', 1, 10, 42.5), ('lss2', 'org-a', 'lse', 2, 9, NULL)");
    await exec(
      `INSERT INTO plan_revisions (id, organization_id, plan_id, revision_number, state, input_json, schedule_json, engine_version, start_date,
         end_date, total_weeks, total_sessions, based_on_revision_id, created_by_user_id) VALUES ('lr2', 'org-a', 'lp', 2, 'DRAFT', ?1, ?2, '0.1.0',
         '2026-11-02', '2027-01-24', 12, 36, 'lr1', 'tech-a')`,
      input, schedule,
    );
    await exec(
      `INSERT INTO prescribed_exercises (id, organization_id, revision_id, phase_index, workout_label, position, name, origin, created_by_user_id)
       VALUES ('lpe4', 'org-a', 'lr2', 1, 'A', 1, 'Copiado', 'PROFESSIONAL', 'tech-a')`,
    );
    const before = await snapshot();
    expect(before.session_sets).toHaveLength(2);

    await migrate(legacy, NEW_MIGRATIONS);
    const after = await snapshot();
    const added: Record<string, Record<string, unknown>> = {
      plan_revisions: { content_version: 0, prescription_model: "TEMPLATE" },
      prescribed_exercises: { dose_json: null, dose_text: null, application_id: null, source_slot_key: null, copied_from_id: null, substitutes_prescribed_exercise_id: null },
      training_plan_events: {},
      workout_sessions: { occurrence_id: null },
      session_exercises: {},
      session_sets: { rir: null, duration_seconds: null, distance_meters: null, load_basis: null },
    };
    for (const table of tables) expect(after[table], table).toEqual(before[table]!.map((row) => ({ ...row, ...added[table] })));

    // The delivered legacy revision stays frozen, now also its counter and model; the draft keeps working with the new code.
    await expect(legacy.prepare("UPDATE plan_revisions SET content_version = 1 WHERE id = 'lr1'").run()).rejects.toThrow("PLAN_REVISION_FROZEN");
    await expect(legacy.prepare("UPDATE prescribed_exercises SET sets = '4' WHERE id = 'lpe1'").run()).rejects.toThrow("PLAN_REVISION_FROZEN");
    const plans = plansFor(legacy, scope("tech-a"));
    const delivered = (await plans.findRevision("lp", "lr1"))!;
    expect(delivered.revision).toMatchObject({ state: "DELIVERED", contentVersion: 0, prescriptionModel: "TEMPLATE" });
    expect(delivered.revision.input).toEqual(V1);
    const rx = prescriptionFor(legacy, scope("tech-a"));
    expect(await rx.add("lp", "lr2", { phaseIndex: 1, workoutLabel: "B" }, { customName: "Novo" }, {})).toMatchObject({ status: "saved" });
    expect((await plans.findRevision("lp", "lr2"))!.revision.contentVersion).toBe(1);
    // The legacy log still takes sets, without any of the new fields.
    await legacy.prepare("INSERT INTO session_sets (id, organization_id, session_exercise_id, set_number, reps) VALUES ('lss3', 'org-a', 'lse', 3, 8)").run();
  });
});
