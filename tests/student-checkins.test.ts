import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { CHECKIN_READ, checkinsFor, studentCheckinsFor } from "@/db/student-checkins";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with the real migrations and triggers. Identities are rows, as the server derives them
// from a verified session. "12:00 in Brazil" is 15:00Z, so a day is unambiguous in every test.
let mf: Miniflare;
let db: D1Database;
const noon = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T15:00:00Z`);
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const pro = (user = "tech-a", org = "org-a") => checkinsFor(db, scope(user, org));
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "checkin-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "tech-a", "tech-a2", "commercial-a", "owner-b", "tech-b", "client-1", "client-2", "client-b", "mgr-1"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
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
    db.prepare(
      `INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Student One'),
       ('st-3','org-a','Student Three'),('st-2','org-a','Student Two'),('st-b','org-b','Student B')`,
    ),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),
       ('org-a','st-3','pro-a'),('org-a','st-2','pro-a2'),('org-b','st-b','pro-b')`,
    ),
    db.prepare(
      `INSERT INTO student_access(organization_id,student_id,user_id) VALUES
       ('org-a','st-1','client-1'),('org-a','st-2','client-2'),('org-b','st-b','client-b')`,
    ),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

const mine = (login = "client-1") => studentCheckinsFor(db, login);
const checkinOf = async (student: string, day: string) =>
  (await db.prepare("SELECT id FROM student_checkins WHERE student_id = ?1 AND checked_on = ?2").bind(student, day).first<{ id: string }>())?.id ?? null;

describe("the student's own check-in", () => {
  it("saves today's, corrects it the same day, and refuses an empty or out-of-scale one", async () => {
    const first = await mine().save("st-1", { effort: 6, recovery: 3, notes: "pernas pesadas" }, noon(10));
    expect(first).toMatchObject({ status: "saved", created: true, discomfort: false });
    const [row] = await mine().recent("st-1", 14, noon(10));
    expect(row).toMatchObject({ checkedOn: "2026-11-10", effort: 6, recovery: 3, discomfort: false, discomfortNotes: null, notes: "pernas pesadas", acknowledgedAt: null, editable: true });

    // The same day it is corrected, not duplicated.
    const again = await mine().save("st-1", { effort: 8, recovery: 2, notes: null }, noon(10));
    expect(again).toMatchObject({ status: "saved", created: false });
    expect((first as { id: string }).id).toBe((again as { id: string }).id);
    expect(await count("SELECT COUNT(*) AS n FROM student_checkins WHERE student_id = 'st-1'")).toBe(1);
    expect((await mine().recent("st-1", 14, noon(10)))[0]).toMatchObject({ effort: 8, recovery: 2, notes: null });

    // What is refused leaves the check-in as it was.
    await expect(mine().save("st-1", {}, noon(10))).rejects.toThrow(ZodError);
    await expect(mine().save("st-1", { effort: 11 }, noon(10))).rejects.toThrow(ZodError);
    await expect(mine().save("st-1", { effort: 3, studentId: "st-2" }, noon(10))).rejects.toThrow(ZodError);
    expect((await mine().recent("st-1", 14, noon(10)))[0]).toMatchObject({ effort: 8, recovery: 2 });
  });

  it("keeps a report of discomfort as it was said: no correction, no deletion, and the database agrees", async () => {
    const saved = await mine().save("st-1", { discomfort: true, discomfortNotes: "ombro direito", effort: 4 }, noon(11));
    expect(saved).toMatchObject({ status: "saved", created: true, discomfort: true });
    const id = (saved as { id: string }).id;
    expect((await mine().recent("st-1", 14, noon(11)))[0]).toMatchObject({ discomfort: true, discomfortNotes: "ombro direito", editable: false });

    expect(await mine().save("st-1", { effort: 2 }, noon(11))).toEqual({ status: "locked" });
    expect(await mine().remove(id, noon(11))).toEqual({ status: "locked" });
    await expect(run("UPDATE student_checkins SET effort = 1 WHERE id = ?1", id)).rejects.toThrow(/CHECKIN_FROZEN/);
    await expect(run("UPDATE student_checkins SET discomfort_reported = 0, discomfort_notes = NULL WHERE id = ?1", id)).rejects.toThrow(/CHECKIN_FROZEN/);
    await expect(run("DELETE FROM student_checkins WHERE id = ?1", id)).rejects.toThrow(/CHECKIN_FROZEN/);
    expect((await mine().recent("st-1", 14, noon(11)))[0]).toMatchObject({ effort: 4, discomfortNotes: "ombro direito" });
  });

  it("drops notes about a discomfort that is not reported, and the database refuses them", async () => {
    await mine().save("st-1", { effort: 5, discomfort: false, discomfortNotes: "não deveria ficar" }, noon(12));
    expect((await mine().recent("st-1", 14, noon(12)))[0]).toMatchObject({ discomfort: false, discomfortNotes: null });
    const id = (await checkinOf("st-1", "2026-11-12"))!;
    await expect(run("UPDATE student_checkins SET discomfort_notes = 'x' WHERE id = ?1", id)).rejects.toThrow();
  });

  it("can be corrected or deleted only on the day it was made", async () => {
    const id = (await checkinOf("st-1", "2026-11-12"))!;
    // The next day the old one is closed to correction, and the new day is a new check-in.
    expect((await mine().recent("st-1", 14, noon(13))).find((row) => row.id === id)).toMatchObject({ editable: false });
    expect(await mine().remove(id, noon(13))).toEqual({ status: "locked" });
    expect(await mine().save("st-1", { effort: 1 }, noon(13))).toMatchObject({ status: "saved", created: true });
    expect(await checkinOf("st-1", "2026-11-12")).toBe(id);
    // The day itself, a check-in without a report can be deleted, and then made again.
    const today = (await checkinOf("st-1", "2026-11-13"))!;
    expect(await mine().remove(today, noon(13))).toEqual({ status: "removed" });
    expect(await checkinOf("st-1", "2026-11-13")).toBeNull();
    expect(await mine().remove(today, noon(13))).toEqual({ status: "not_found" });
    expect(await mine().save("st-1", { effort: 9 }, noon(13))).toMatchObject({ status: "saved", created: true });
  });

  it("uses the calendar day of Brazil: 02:00Z is still the evening before", async () => {
    const lateNight = new Date("2026-11-15T02:00:00Z"); // 23:00 on the 14th in Brazil
    await mine().save("st-1", { effort: 2 }, lateNight);
    expect(await checkinOf("st-1", "2026-11-14")).not.toBeNull();
    expect(await checkinOf("st-1", "2026-11-15")).toBeNull();
  });

  it("reaches nothing but the check-ins of the students the login is linked to", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM student_checkins");
    // Another student's login cannot write to, read or delete someone else's.
    expect(await mine("client-2").save("st-1", { effort: 1 }, noon(16))).toEqual({ status: "not_found" });
    expect(await mine("client-b").save("st-1", { effort: 1 }, noon(16))).toEqual({ status: "not_found" });
    expect(await mine("client-2").recent("st-1", 14, noon(16))).toEqual([]);
    const someone = (await checkinOf("st-1", "2026-11-13"))!;
    expect(await mine("client-2").remove(someone, noon(13))).toEqual({ status: "not_found" });
    // Not even the professional's identity, nor an unknown one, writes as a student.
    expect(await mine("tech-a").save("st-1", { effort: 1 }, noon(16))).toEqual({ status: "not_found" });
    expect(await mine("stranger").save("st-1", { effort: 1 }, noon(16))).toEqual({ status: "not_found" });
    expect(() => studentCheckinsFor(db, " ")).toThrow("AUTHENTICATION_REQUIRED");
    expect(await count("SELECT COUNT(*) AS n FROM student_checkins")).toBe(before);

    // A revoked link and a blocked login stop reading and writing at once, and come back with the link.
    await run("UPDATE student_access SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE user_id = 'client-1'");
    expect(await mine().recent("st-1", 14, noon(16))).toEqual([]);
    expect(await mine().save("st-1", { effort: 1 }, noon(16))).toEqual({ status: "not_found" });
    await run("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-1'");
    await run("UPDATE users SET disabled_at = '2026-12-01T00:00:00.000Z' WHERE id = 'client-1'");
    expect(await mine().recent("st-1", 14, noon(16))).toEqual([]);
    expect(await mine().save("st-1", { effort: 1 }, noon(16))).toEqual({ status: "not_found" });
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'client-1'");
    expect((await mine().recent("st-1", 14, noon(16))).length).toBeGreaterThan(0);
  });

  it("is refused by the database too when the login is not linked to the student", async () => {
    const insert = (student: string, login: string) =>
      run(
        `INSERT INTO student_checkins(id,organization_id,student_id,checked_on,logged_by_user_id,notes,created_at,updated_at)
         VALUES (?1,'org-a',?2,'2026-11-20',?3,'direct','2026-11-20T00:00:00.000Z','2026-11-20T00:00:00.000Z')`,
        crypto.randomUUID(), student, login,
      );
    await expect(insert("st-1", "client-2")).rejects.toThrow(/CHECKIN_LOGIN_INVALID/);
    await expect(insert("st-1", "tech-a")).rejects.toThrow(/CHECKIN_LOGIN_INVALID/);
    await run("UPDATE student_access SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE user_id = 'client-2'");
    await expect(insert("st-2", "client-2")).rejects.toThrow(/CHECKIN_LOGIN_INVALID/);
    await run("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-2'");
    await insert("st-2", "client-2");
    await run("DELETE FROM student_checkins WHERE notes = 'direct'");
  });

  it("never changes what a check-in is about", async () => {
    const id = (await checkinOf("st-1", "2026-11-13"))!;
    for (const change of ["student_id = 'st-3'", "checked_on = '2026-11-01'", "logged_by_user_id = 'client-2'", "organization_id = 'org-b'", "created_at = '2020-01-01T00:00:00.000Z'"])
      await expect(run(`UPDATE student_checkins SET ${change} WHERE id = ?1`, id), change).rejects.toThrow(/CHECKIN_IDENTITY_FROZEN/);
  });
});

describe("the professional's reading", () => {
  it("is open only to a professional with an active technical assignment over the student", async () => {
    const before = {
      acknowledgements: await count("SELECT COUNT(*) AS n FROM checkin_acknowledgements"),
      audit: await count("SELECT COUNT(*) AS n FROM access_audit_events"),
    };
    const id = (await checkinOf("st-1", "2026-11-13"))!;
    expect((await pro().list("st-1")).length).toBeGreaterThan(0);
    for (const [user, org] of [["tech-a2", "org-a"], ["owner-a", "org-a"], ["commercial-a", "org-a"], ["client-1", "org-a"], ["mgr-1", "org-a"], ["tech-b", "org-b"], ["tech-b", "org-a"], ["stranger", "org-a"]]) {
      const api = pro(user, org);
      expect(await api.list("st-1"), `${user}/${org} list`).toEqual([]);
      expect(await api.pending(), `${user}/${org} pending`).toSatisfy((rows: Array<{ studentId: string }>) => rows.every((row) => row.studentId !== "st-1"));
      expect(await api.acknowledge(id, "tentando"), `${user}/${org} acknowledge`).toEqual({ status: "not_found" });
    }
    expect(() => checkinsFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
    expect({
      acknowledgements: await count("SELECT COUNT(*) AS n FROM checkin_acknowledgements"),
      audit: await count("SELECT COUNT(*) AS n FROM access_audit_events"),
    }).toEqual(before);

    // The assignment and the identity end the access.
    await run("UPDATE care_assignments SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE student_id = 'st-1'");
    expect(await pro().list("st-1")).toEqual([]);
    await run("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'");
    await run("UPDATE users SET disabled_at = '2026-12-01T00:00:00.000Z' WHERE id = 'tech-a'");
    expect(await pro().list("st-1")).toEqual([]);
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'");
    expect((await pro().list("st-1")).length).toBeGreaterThan(0);
  });

  it("lists the unread ones with a report of discomfort first, then the newest, and drops what was read", async () => {
    await mine("client-2").save("st-2", { effort: 2 }, noon(17));
    const pending = await pro().pending();
    const order = pending.map((row) => `${row.discomfort ? "D" : "-"}${row.checkedOn}`);
    // st-1 only (st-2 belongs to another professional): the discomfort of the 11th comes before every newer one.
    expect(order[0]).toBe("D2026-11-11");
    expect(order.slice(1)).toEqual([...order.slice(1)].sort().reverse());
    expect(order.slice(1).every((entry) => entry.startsWith("-"))).toBe(true);
    expect(pending.every((row) => row.studentId === "st-1")).toBe(true);
    expect(pending[0].studentName).toBe("Student One");
    // The other professional sees only their own student's.
    expect((await pro("tech-a2").pending()).map((row) => row.studentId)).toEqual(["st-2"]);
  });

  it("records who read it and when, adds an audit line, closes the check-in for the student and appends, never changes", async () => {
    const id = (await checkinOf("st-1", "2026-11-13"))!;
    expect((await mine().recent("st-1", 14, noon(13))).find((row) => row.id === id)).toMatchObject({ editable: true, acknowledgedAt: null });
    expect(await pro().acknowledge(id, "  Vamos conversar no treino.  ", noon(13))).toEqual({ status: "recorded" });
    const reading = await db.prepare("SELECT user_id AS user, note, created_at AS at FROM checkin_acknowledgements WHERE checkin_id = ?1").bind(id).first<{ user: string; note: string; at: string }>();
    expect(reading).toEqual({ user: "tech-a", note: "Vamos conversar no treino.", at: noon(13).toISOString() });
    const audit = await db.prepare("SELECT actor_user_id AS actor, subject_id AS subject FROM access_audit_events WHERE action = ?1").bind(CHECKIN_READ).all<{ actor: string; subject: string }>();
    expect(audit.results).toEqual([{ actor: "tech-a", subject: id }]);
    expect(JSON.stringify(audit.results)).not.toContain("Vamos conversar");

    // The student sees that it was read, can no longer correct or delete it, and does not see the note.
    const seen = (await mine().recent("st-1", 14, noon(13))).find((row) => row.id === id)!;
    expect(seen).toMatchObject({ editable: false, acknowledgedAt: noon(13).toISOString() });
    expect(JSON.stringify(seen)).not.toContain("Vamos conversar");
    expect(await mine().save("st-1", { effort: 1 }, noon(13))).toEqual({ status: "locked" });
    expect(await mine().remove(id, noon(13))).toEqual({ status: "locked" });
    await expect(run("UPDATE student_checkins SET effort = 1 WHERE id = ?1", id)).rejects.toThrow(/CHECKIN_FROZEN/);
    await expect(run("DELETE FROM student_checkins WHERE id = ?1", id)).rejects.toThrow(/CHECKIN_FROZEN/);

    // The first reading is the one the student sees; a second one adds a line and moves nothing.
    expect(await pro().acknowledge(id, "", noon(14))).toEqual({ status: "recorded" });
    expect(await count("SELECT COUNT(*) AS n FROM checkin_acknowledgements WHERE checkin_id = ?1", id)).toBe(2);
    expect((await pro().list("st-1")).find((row) => row.id === id)!.acknowledgedAt).toBe(noon(13).toISOString());
    // It leaves the unread list, and the log itself cannot be rewritten.
    expect((await pro().pending()).some((row) => row.checkinId === id)).toBe(false);
    await expect(run("UPDATE checkin_acknowledgements SET note = 'x' WHERE checkin_id = ?1", id)).rejects.toThrow(/CHECKIN_ACKNOWLEDGEMENT_APPEND_ONLY/);
    await expect(run("DELETE FROM checkin_acknowledgements WHERE checkin_id = ?1", id)).rejects.toThrow(/CHECKIN_ACKNOWLEDGEMENT_APPEND_ONLY/);
  });

  it("refuses a note over 500 characters and writes nothing", async () => {
    const id = (await checkinOf("st-1", "2026-11-10"))!;
    const before = await count("SELECT COUNT(*) AS n FROM checkin_acknowledgements");
    await expect(pro().acknowledge(id, "x".repeat(501))).rejects.toThrow("ACKNOWLEDGEMENT_NOTE_TOO_LONG");
    expect(await count("SELECT COUNT(*) AS n FROM checkin_acknowledgements")).toBe(before);
  });
});
