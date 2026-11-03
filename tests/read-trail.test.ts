import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { READ_DEDUP_MINUTES, readsOfOwnData, readsOfStudent, recordStudentRead, type StudentReadKind } from "@/db/student-reads";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Slice 0.88 on a real local D1 with every migration (0038 included): the trail of reads of a student's data by professionals. Identities
// are rows, as the server derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const T0 = new Date("2026-11-03T15:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const ctx = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const rows = async () =>
  (await db.prepare("SELECT organization_id AS org, student_id AS student, actor_user_id AS actor, kind FROM student_data_reads ORDER BY created_at, rowid").all<{ org: string; student: string; actor: string; kind: string }>()).results;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "read-trail-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "manager-a", "manager-far", "tech-a", "tech-a2", "revoked-a", "tech-b", "client-1", "client-2", "client-gone"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','manager-a','MANAGER',NULL),('org-a','manager-far','MANAGER',NULL),
       ('org-a','tech-a','TECHNICAL',NULL),('org-a','tech-a2','TECHNICAL',NULL),('org-a','revoked-a','TECHNICAL','2026-11-01T00:00:00.000Z'),
       ('org-b','tech-b','TECHNICAL',NULL)`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner','org-a','owner-a','Dona A'),('pro-manager','org-a','manager-a','Gestora A'),('pro-far','org-a','manager-far','Longe A'),
       ('pro-a','org-a','tech-a','Pro A'),('pro-a2','org-a','tech-a2','Pro A2'),('pro-rev','org-a','revoked-a','Saiu A'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare(
      `INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Student One'),
       ('st-2','org-a','Student Two'),('st-b','org-b','Student B')`,
    ),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-1','pro-owner'),
       ('org-a','st-1','pro-manager'),('org-a','st-1','pro-rev'),('org-a','st-2','pro-a2'),('org-b','st-b','pro-b')`,
    ),
    db.prepare(
      `INSERT INTO student_access(organization_id,student_id,user_id,revoked_at) VALUES
       ('org-a','st-1','client-1',NULL),('org-a','st-2','client-2',NULL),('org-a','st-1','client-gone','2026-11-01T00:00:00.000Z')`,
    ),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("recording a read", () => {
  it("writes one line per open: who, which student, what kind, never the content", async () => {
    expect(await recordStudentRead(db, ctx("tech-a"), "st-1", "STUDENT_RECORD", T0)).toBe(true);
    expect(await recordStudentRead(db, ctx("tech-a"), "st-1", "ASSESSMENT", minutes(1))).toBe(true);
    expect(await rows()).toEqual([
      { org: "org-a", student: "st-1", actor: "tech-a", kind: "STUDENT_RECORD" },
      { org: "org-a", student: "st-1", actor: "tech-a", kind: "ASSESSMENT" },
    ]);
    const columns = (await db.prepare("SELECT name FROM pragma_table_info('student_data_reads') ORDER BY cid").all<{ name: string }>()).results.map((c) => c.name);
    expect(columns).toEqual(["id", "organization_id", "student_id", "actor_user_id", "kind", "created_at"]);
  });

  it(`does not repeat the same person, student and kind within ${READ_DEDUP_MINUTES} minutes, and does after`, async () => {
    expect(await recordStudentRead(db, ctx("tech-a"), "st-1", "STUDENT_RECORD", minutes(READ_DEDUP_MINUTES - 1))).toBe(false);
    expect(await recordStudentRead(db, ctx("tech-a"), "st-1", "STUDENT_RECORD", minutes(READ_DEDUP_MINUTES + 1))).toBe(true);
    // Another kind, or another person, is its own line.
    expect(await recordStudentRead(db, ctx("tech-a"), "st-1", "PHOTOS", minutes(READ_DEDUP_MINUTES + 1))).toBe(true);
    expect(await recordStudentRead(db, ctx("owner-a"), "st-1", "STUDENT_RECORD", minutes(READ_DEDUP_MINUTES + 1))).toBe(true);
    expect((await rows()).length).toBe(5);
  });

  it("writes nothing without technical access: other organization, no assignment, revoked membership, a context of another tenant", async () => {
    const before = (await rows()).length;
    const refused: Array<[string, string, string]> = [
      ["tech-a2", "org-a", "st-1"],
      ["manager-far", "org-a", "st-1"],
      ["revoked-a", "org-a", "st-1"],
      ["tech-b", "org-b", "st-1"],
      ["tech-b", "org-a", "st-1"],
      ["tech-a", "org-b", "st-b"],
      ["client-1", "org-a", "st-1"],
      ["tech-a", "org-a", "missing"],
    ];
    for (const [user, org, student] of refused) {
      expect(await recordStudentRead(db, ctx(user, org), student, "STUDENT_RECORD", minutes(30)), `${user}/${org}/${student}`).toBe(false);
    }
    expect(await recordStudentRead(db, ctx("tech-a"), "st-1", "NOT_A_KIND" as StudentReadKind, minutes(30))).toBe(false);
    expect((await rows()).length).toBe(before);
    await expect(recordStudentRead(db, null, "st-1", "STUDENT_RECORD")).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });

  it("refuses at the database a kind it does not know and a student of another organization", async () => {
    await expect(
      db.prepare("INSERT INTO student_data_reads VALUES ('x','org-a','st-1','tech-a','CONTENT','2026-11-03T00:00:00.000Z')").run(),
    ).rejects.toThrow();
    await expect(
      db.prepare("INSERT INTO student_data_reads VALUES ('y','org-b','st-1','tech-b','PHOTOS','2026-11-03T00:00:00.000Z')").run(),
    ).rejects.toThrow();
  });
});

describe("who sees the trail", () => {
  it("the OWNER and the MANAGER who reach the student, newest first, with the professional's name", async () => {
    for (const user of ["owner-a", "manager-a"]) {
      const list = await readsOfStudent(db, ctx(user), "st-1");
      expect(list).toHaveLength(5);
      expect(list.map((read) => read.at)).toEqual([...list.map((read) => read.at)].sort().reverse());
      expect(list.map((read) => read.kind).sort()).toEqual(["ASSESSMENT", "PHOTOS", "STUDENT_RECORD", "STUDENT_RECORD", "STUDENT_RECORD"]);
      expect(new Set(list.map((read) => read.professionalName))).toEqual(new Set(["Pro A", "Dona A"]));
      expect(list[list.length - 1]).toEqual({ kind: "STUDENT_RECORD", at: T0.toISOString(), professionalName: "Pro A" });
    }
  });

  it("nobody else: a technical professional, a manager without reach, another organization, a revoked member", async () => {
    for (const [user, org] of [
      ["tech-a", "org-a"],
      ["manager-far", "org-a"],
      ["revoked-a", "org-a"],
      ["tech-b", "org-b"],
      ["owner-a", "org-b"],
      ["client-1", "org-a"],
    ]) {
      expect(await readsOfStudent(db, ctx(user, org), "st-1"), `${user}/${org}`).toEqual([]);
    }
  });

  it("the student, for the students linked to their own login only, with the organization's name", async () => {
    const own = await readsOfOwnData(db, "client-1");
    expect(own).toHaveLength(5);
    expect(new Set(own.map((read) => `${read.organizationName}/${read.studentId}`))).toEqual(new Set(["Studio A/st-1"]));
    expect(await readsOfOwnData(db, "client-2")).toEqual([]);
    // A revoked link sees nothing; a professional's login is not a student's link.
    expect(await readsOfOwnData(db, "client-gone")).toEqual([]);
    expect(await readsOfOwnData(db, "tech-a")).toEqual([]);
    await expect(readsOfOwnData(db, "")).rejects.toThrow();
  });
});
