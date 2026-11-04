import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentsFor } from "@/db/assessments";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";
import { ALL_NO } from "./helpers/screening";
import { legacyAssessments } from "./helpers/legacy-assessments";

// The model of the physical assessment, version 2 (migration 0033), on a real local D1: the earlier body fat kept as a result of unknown
// method, the sections of a draft of the new format saved one by one against a revision, and everything frozen once recorded.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const day = (n: number) => new Date(`2026-11-${String(n).padStart(2, "0")}T12:00:00Z`);
const BEFORE_0033 = ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf("0033_assessment_v2.sql"));
const one = <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const fails = async (sql: string, ...binds: unknown[]) => {
  try {
    await db.prepare(sql).bind(...binds).run();
    return "";
  } catch (error) {
    return String(error);
  }
};

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "assessment-v2-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  // Up to 0032, an assessment of the earlier format recorded with a typed body fat; then 0033.
  await migrate(db, BEFORE_0033);
  await db.batch([
    ...["tech-a", "tech-b"].map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare("INSERT INTO users(id) VALUES ('tech-a'),('tech-b')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL')"),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-2','org-a','Two'),('st-b','org-b','B')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a'),('org-b','st-b','pro-b')"),
    db.prepare("INSERT INTO student_profiles(student_id,organization_id,birth_date,gender,height_cm,weight_kg,goal,updated_by_user_id) VALUES ('st-1','org-a','1999-03-04','Masculino',171,69.1,'Hipertrofia','tech-a')"),
  ]);
  // Written as the app of 0.67 wrote it (the repository of now already knows the columns of 0033).
  await db.batch([
    db.prepare(
      `INSERT INTO assessments (id,organization_id,student_id,assessed_on,kind,state,risk_status,created_by_user_id,screening_answered)
       VALUES ('old-1','org-a','st-2','2026-11-01','INITIAL','DRAFT','CLEAR','tech-a','[]')`,
    ),
    db.prepare(
      `INSERT INTO assessment_metrics (id,organization_id,assessment_id,metric_type,name,value_text,value_number,unit,position)
       VALUES ('m1','org-a','old-1','BODY_FAT','Gordura corporal','18,5',18.5,'%',1),('m2','org-a','old-1','WAIST','Cintura','80',80,'cm',2)`,
    ),
    db.prepare("UPDATE assessments SET state = 'RECORDED', recorded_at = ?1, recorded_by_user_id = 'tech-a' WHERE id = 'old-1'").bind(day(1).toISOString()),
  ]);
  await migrate(db, ["0033_assessment_v2.sql"]);
  // And the ones after it (the repository of now also knows the columns of 0036).
  await migrate(db, ALL_MIGRATIONS.slice(ALL_MIGRATIONS.indexOf("0033_assessment_v2.sql") + 1));
});
afterAll(async () => {
  await mf?.dispose();
});

const a = () => assessmentsFor(db, scope("tech-a"));

describe("the earlier format", () => {
  it("keeps the body fat typed before 0033 as a result whose method nobody knows, and does not touch the assessment", async () => {
    const rows = await db.prepare("SELECT code, value, unit, method, formula_version AS formulaVersion, flags FROM assessment_results").all();
    expect(rows.results).toEqual([{ code: "body_fat_percent", value: 18.5, unit: "%", method: "legacy_formula_unknown", formulaVersion: null, flags: '["legacy_formula_unknown"]' }]);
    expect(await one("SELECT format_version AS f, revision AS r, student_snapshot AS s FROM assessments WHERE student_id = 'st-2'")).toEqual({ f: null, r: 1, s: null });
  });
  it("does the same for an assessment of the earlier format recorded after 0033 (as the application did until 0.73), once", async () => {
    const api = legacyAssessments(db, scope("tech-a"));
    const started = await api.startDraft("st-2", day(3));
    if (started.status !== "started") throw new Error(started.status);
    await api.saveDraft(started.id, { ...ALL_NO, assessedOn: "2026-11-03", metrics: [{ metricType: "BODY_FAT", value: "17" }, { metricType: "BODY_FAT", value: "16" }] }, day(3));
    expect((await api.record(started.id, { screeningAsked: true }, day(3))).status).toBe("recorded");
    expect(await one("SELECT value, method FROM assessment_results WHERE assessment_id = ?1", started.id)).toEqual({ value: 17, method: "legacy_formula_unknown" });
  });
});

describe("a draft of the Avaliação Física (the only one that can be started)", () => {
  let id = "";
  it("starts with a snapshot of the student's data (never the gender) and revision 1", async () => {
    const started = await a().startDraft("st-1", day(4));
    expect(started.status).toBe("started");
    if (started.status !== "started") return;
    id = started.id;
    const row = await one<{ f: number; r: number; s: string }>("SELECT format_version AS f, revision AS r, student_snapshot AS s FROM assessments WHERE id = ?1", id);
    expect(row).toMatchObject({ f: 2, r: 1 });
    expect(JSON.parse(row!.s)).toEqual({ birthDate: "1999-03-04", heightCm: 171, weightKg: 69.1, goal: "Hipertrofia" });
    expect(row!.s).not.toContain("Masculino");
    expect(await a().sections(id)).toEqual({ revision: 1, formatVersion: 2, sections: [], template: null, enabled: null });
  });
  it("reads the snapshot back for the screen (never the gender), only inside the organization, and none for the earlier format", async () => {
    expect(await a().studentSnapshot(id)).toEqual({ birthDate: "1999-03-04", heightCm: 171, weightKg: 69.1, goal: "Hipertrofia" });
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).studentSnapshot(id)).toBeNull();
    expect(await a().studentSnapshot("old-1")).toBeNull();
  });
  it("says the format of the open draft when one is asked for again (one draft per student, of either format)", async () => {
    expect(await a().startDraft("st-1", day(4))).toEqual({ status: "draft_open", id, formatVersion: 2 });
  });
  it("saves a module against the revision read, and refuses a save from an older revision without changing anything", async () => {
    const saved = await a().saveSection(id, { module: "composition", status: "IN_PROGRESS", payload: { protocol: "jackson_pollock_7" }, revision: 1 }, day(4));
    expect(saved).toEqual({ status: "saved", revision: 2 });
    const stale = await a().saveSection(id, { module: "composition", status: "DONE", payload: { protocol: "faulkner_4" }, revision: 1 }, day(4));
    expect(stale).toEqual({ status: "conflict", revision: 2 });
    const read = await a().sections(id);
    expect(read?.revision).toBe(2);
    expect(read?.sections).toEqual([{ module: "composition", status: "IN_PROGRESS", payload: { protocol: "jackson_pollock_7" }, updatedAt: day(4).toISOString() }]);
    expect(await a().saveSection(id, { module: "screening", status: "IN_PROGRESS", payload: { parq: {} }, revision: 2 }, day(4))).toEqual({ status: "saved", revision: 3 });
  });
  it("refuses an unknown module, a bad status or a payload too large, and is not reached from another organization", async () => {
    expect(await a().saveSection(id, { module: "x" as never, status: "DONE", payload: {}, revision: 3 })).toEqual({ status: "invalid" });
    expect(await a().saveSection(id, { module: "tests", status: "OK" as never, payload: {}, revision: 3 })).toEqual({ status: "invalid" });
    expect(await a().saveSection(id, { module: "tests", status: "DONE", payload: { text: "x".repeat(70_000) }, revision: 3 })).toEqual({ status: "invalid" });
    const other = assessmentsFor(db, scope("tech-b", "org-b"));
    expect(await other.sections(id)).toBeNull();
    expect(await other.saveSection(id, { module: "tests", status: "DONE", payload: {}, revision: 3 })).toEqual({ status: "not_found" });
    expect((await a().sections(id))?.revision).toBe(3);
  });
  it("is discarded with its sections (only by its organization, never a recorded one), and the student can start another", async () => {
    const other = assessmentsFor(db, scope("tech-b", "org-b"));
    expect(await other.discardDraft(id)).toEqual({ status: "not_found" });
    const earlier = await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-2' AND state = 'RECORDED' LIMIT 1");
    expect(await a().discardDraft(earlier!.id)).toEqual({ status: "not_found" });
    expect(await a().discardDraft(id)).toEqual({ status: "discarded" });
    expect(await one("SELECT count(*) AS n FROM assessment_sections WHERE assessment_id = ?1", id)).toEqual({ n: 0 });
    expect(await one("SELECT count(*) AS n FROM assessments WHERE id = ?1", id)).toEqual({ n: 0 });
    expect(await one("SELECT count(*) AS n FROM access_audit_events WHERE action = 'ASSESSMENT_DRAFT_DISCARDED' AND subject_id = ?1", id)).toEqual({ n: 1 });
    expect(await a().discardDraft(id)).toEqual({ status: "not_found" });
    const again = await a().startDraft("st-1", day(5));
    expect(again.status).toBe("started");
    if (again.status === "started") id = again.id;
  });
  it("is not where a section of the earlier format goes", async () => {
    const earlier = await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-2' AND state = 'RECORDED' LIMIT 1");
    expect(await a().saveSection(earlier!.id, { module: "tests", status: "DONE", payload: {}, revision: 1 })).toEqual({ status: "not_found" });
  });
});

describe("an open draft of the earlier format (it can no longer be filled nor recorded: decision of 03/11/2026)", () => {
  it("is what a start returns while it is open, and is discarded with its metrics and findings, so the Avaliação Física can start", async () => {
    const legacy = legacyAssessments(db, scope("tech-a"));
    const old = await legacy.startDraft("st-2", day(6));
    if (old.status !== "started") throw new Error(old.status);
    await legacy.saveDraft(old.id, { ...ALL_NO, assessedOn: "2026-11-06", metrics: [{ metricType: "WAIST", value: "80" }], posture: { findings: ["LATERAL.KYPHOSIS"] } }, day(6));
    // One draft per student: the start goes to the open one and says it is of the earlier format.
    expect(await a().startDraft("st-2", day(6))).toEqual({ status: "draft_open", id: old.id, formatVersion: null });
    expect((await a().listForStudent("st-2")).find((x) => x.id === old.id)).toMatchObject({ state: "DRAFT", formatVersion: null });
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).discardDraft(old.id)).toEqual({ status: "not_found" });
    expect(await a().discardDraft(old.id)).toEqual({ status: "discarded" });
    for (const table of ["assessments WHERE id", "assessment_metrics WHERE assessment_id", "assessment_findings WHERE assessment_id"])
      expect(await one(`SELECT count(*) AS n FROM ${table} = ?1`, old.id), table).toEqual({ n: 0 });
    const next = await a().startDraft("st-2", day(6));
    expect(next.status).toBe("started");
    if (next.status !== "started") return;
    expect(await one("SELECT format_version AS f, kind FROM assessments WHERE id = ?1", next.id)).toEqual({ f: 2, kind: "REASSESSMENT" });
    expect(await a().discardDraft(next.id)).toEqual({ status: "discarded" });
  });
});

describe("what the database refuses by itself", () => {
  it("freezes the sections, the results and the new columns (and screening_answered) once the assessment is recorded", async () => {
    const recorded = await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-2' AND state = 'RECORDED' LIMIT 1");
    const rid = recorded!.id;
    expect(await fails("UPDATE assessments SET screening_answered = '[]' WHERE id = ?1", rid)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("UPDATE assessments SET revision = 9 WHERE id = ?1", rid)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("UPDATE assessments SET student_snapshot = '{}' WHERE id = ?1", rid)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("INSERT INTO assessment_sections VALUES (?1,'org-a','tests','DONE','{}','x','tech-a')", rid)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("UPDATE assessment_results SET value = 1 WHERE assessment_id = ?1", rid)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("DELETE FROM assessment_results WHERE assessment_id = ?1", rid)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("INSERT INTO assessment_results (id,assessment_id,organization_id,code,method,created_at) VALUES ('r1',?1,'org-a','bmi','x','x')", rid)).toContain("ASSESSMENT_FROZEN");
  });
  it("does not let a section or a result of one organization point to an assessment of another", async () => {
    const draft = await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-1' AND state = 'DRAFT'");
    expect(await fails("INSERT INTO assessment_sections VALUES (?1,'org-b','tests','DONE','{}','x','tech-b')", draft!.id)).not.toBe("");
    expect(await fails("INSERT INTO assessment_results (id,assessment_id,organization_id,code,method,created_at) VALUES ('r2',?1,'org-b','bmi','x','x')", draft!.id)).not.toBe("");
  });
  it("takes an amendment only of a recorded assessment of the same student, with a reason, and never changes what it amends", async () => {
    const recorded = await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-2' AND state = 'RECORDED' LIMIT 1");
    const insert = (id: string, student: string, amends: string | null, reason: string | null) =>
      fails(
        `INSERT INTO assessments (id,organization_id,student_id,assessed_on,kind,state,risk_status,created_by_user_id,amends_assessment_id,amend_reason)
         VALUES (?1,'org-a',?2,'2026-11-05','REASSESSMENT','DRAFT','CLEAR','tech-a',?3,?4)`,
        id, student, amends, reason,
      );
    expect(await insert("x1", "st-2", recorded!.id, null)).toContain("ASSESSMENT_AMEND_INVALID");
    expect(await insert("x2", "st-2", null, "um motivo")).toContain("ASSESSMENT_AMEND_INVALID");
    expect(await insert("x3", "st-1", recorded!.id, "outro aluno")).toContain("ASSESSMENT_AMEND_INVALID");
    expect(await insert("x4", "st-2", recorded!.id, "peso digitado errado")).toBe("");
    expect(await fails("UPDATE assessments SET amends_assessment_id = NULL, amend_reason = NULL WHERE id = 'x4'")).toContain("ASSESSMENT_AMEND_INVALID");
    expect(await one("SELECT state FROM assessments WHERE id = ?1", recorded!.id)).toEqual({ state: "RECORDED" });
  });
});

describe("the date of a new assessment", () => {
  it("is the day in Brazil, not in UTC: started at 21:30 in São Paulo (00:30 UTC of the next day), it is still that evening's date", async () => {
    await db.batch([
      db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-3','org-a','Three')"),
      db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-3','pro-a')"),
    ]);
    const started = await a().startDraft("st-3", new Date("2026-11-04T00:30:00Z"));
    expect(started.status).toBe("started");
    if (started.status !== "started") return;
    expect(await one("SELECT assessed_on AS d FROM assessments WHERE id = ?1", started.id)).toEqual({ d: "2026-11-03" });
  });
});
