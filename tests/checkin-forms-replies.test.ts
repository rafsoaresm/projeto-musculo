import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { CHECKIN_FORM_CHANGED, CHECKIN_REPLY, checkinsFor, studentCheckinsFor } from "@/db/student-checkins";
import { DEFAULT_CHECKIN_FORM } from "@/modules/checkin/contracts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Slice 0.87 on a real local D1 with every migration (0037 included): what the check-in asks (per student, versioned), check-ins of
// previous days within the window of the workout log, and the professional's replies. Identities are rows, as the server derives
// them from a verified session. "12:00 in Brazil" is 15:00Z, so a day is unambiguous in every test.
let mf: Miniflare;
let db: D1Database;
const noon = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T15:00:00Z`);
const pro = (user = "tech-a", org = "org-a") => checkinsFor(db, { userId: user, organizationId: org });
const mine = (login = "client-1") => studentCheckinsFor(db, login);
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const checkinOf = async (student: string, day: string) =>
  (await db.prepare("SELECT id FROM student_checkins WHERE student_id = ?1 AND checked_on = ?2").bind(student, day).first<{ id: string }>())?.id ?? null;
const outsiders: Array<[string, string]> = [
  ["tech-a2", "org-a"],
  ["owner-a", "org-a"],
  ["commercial-a", "org-a"],
  ["client-1", "org-a"],
  ["tech-b", "org-b"],
  ["tech-b", "org-a"],
  ["stranger", "org-a"],
];

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "checkin-forms-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "tech-a", "tech-a2", "commercial-a", "tech-b", "client-1", "client-2", "client-b"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES
       ('org-a','owner-a','OWNER'),('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner-a','org-a','owner-a','Owner A'),('pro-a','org-a','tech-a','Pro A'),
       ('pro-a2','org-a','tech-a2','Pro A2'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare(
      `INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Student One'),
       ('st-2','org-a','Student Two'),('st-b','org-b','Student B')`,
    ),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),
       ('org-a','st-2','pro-a2'),('org-b','st-b','pro-b')`,
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

describe("what the check-in asks", () => {
  it("is the default until the professional saves a version, and only a professional with reach reads or saves it", async () => {
    expect(await pro().form("st-1")).toEqual({ id: null, version: null, createdAt: null, form: DEFAULT_CHECKIN_FORM });
    expect((await mine().currentForm("st-1")).form).toEqual(DEFAULT_CHECKIN_FORM);
    const payload = { askEffort: false, askRecovery: true, askNotes: true, questions: [{ text: "Como dormiu?" }] };
    for (const [user, org] of outsiders) {
      expect(await pro(user, org).form("st-1"), `${user}/${org}`).toBeNull();
      expect(await pro(user, org).saveForm("st-1", payload, noon(1)), `${user}/${org}`).toEqual({ status: "not_found" });
    }
    expect(await count("SELECT COUNT(*) AS n FROM checkin_form_versions")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = ?1", CHECKIN_FORM_CHANGED)).toBe(0);
  });

  it("is saved as a new version, a save that changes nothing writes nothing, and a malformed one is refused", async () => {
    const payload = { askEffort: false, askRecovery: true, askNotes: true, questions: [{ text: "Como dormiu?" }] };
    expect(await pro().saveForm("st-1", payload, noon(1))).toEqual({ status: "saved", version: 1 });
    const v1 = (await pro().form("st-1"))!;
    expect(v1).toMatchObject({ version: 1, form: { askEffort: false, askRecovery: true, askNotes: true } });
    expect(v1.form.questions).toEqual([{ id: expect.stringMatching(/^[a-z0-9-]+$/), text: "Como dormiu?" }]);
    // The student reads the same version through their own link; another student's login reads only the default.
    expect((await mine().currentForm("st-1")).version).toBe(1);
    expect((await mine("client-2").currentForm("st-1")).form).toEqual(DEFAULT_CHECKIN_FORM);
    expect(await pro().saveForm("st-1", { ...payload, questions: v1.form.questions }, noon(1))).toEqual({ status: "unchanged" });
    await expect(pro().saveForm("st-1", { ...payload, questions: [{ text: " " }] }, noon(1))).rejects.toThrow(ZodError);
    expect(await count("SELECT COUNT(*) AS n FROM checkin_form_versions")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = ?1 AND subject_id = 'st-1'", CHECKIN_FORM_CHANGED)).toBe(1);
    // A version is never changed nor deleted.
    await expect(run("UPDATE checkin_form_versions SET ask_effort = 1 WHERE id = ?1", v1.id)).rejects.toThrow(/CHECKIN_FORM_APPEND_ONLY/);
    await expect(run("DELETE FROM checkin_form_versions WHERE id = ?1", v1.id)).rejects.toThrow(/CHECKIN_FORM_APPEND_ONLY/);
  });

  it("freezes on each check-in: a check-in keeps the questions it was answered with after the professional changes them", async () => {
    const v1 = (await pro().form("st-1"))!;
    const sleep = v1.form.questions[0].id;
    const saved = await mine().save(
      "st-1",
      { effort: 9, recovery: 4, notes: "ok", answers: [{ questionId: sleep, answer: "Mal, acordei duas vezes." }] },
      noon(2),
    );
    expect(saved).toMatchObject({ status: "saved", created: true });
    const [first] = await mine().recent("st-1", 30, noon(2));
    // Effort was not asked in version 1, so it was not kept: empty, never 0.
    expect(first).toMatchObject({ effort: null, recovery: 4, notes: "ok", formVersion: 1 });
    expect(first.answers).toEqual([{ questionId: sleep, answer: "Mal, acordei duas vezes." }]);

    // Version 2: effort back, the question replaced by another.
    expect(
      await pro().saveForm("st-1", { askEffort: true, askRecovery: false, askNotes: false, questions: [{ text: "Treinou em jejum?" }] }, noon(3)),
    ).toEqual({ status: "saved", version: 2 });
    const old = (await pro().list("st-1")).find((row) => row.id === first.id)!;
    expect(old.formVersion).toBe(1);
    expect(old.form).toEqual(v1.form);
    expect(old.answers).toEqual([{ questionId: sleep, answer: "Mal, acordei duas vezes." }]);

    // A new check-in is asked with version 2; an answer to a question of version 1 is not kept.
    const v2 = (await pro().form("st-1"))!;
    await mine().save(
      "st-1",
      { effort: 0, recovery: 5, notes: "x", answers: [{ questionId: sleep, answer: "antiga" }, { questionId: v2.form.questions[0].id, answer: "Sim" }] },
      noon(3),
    );
    const latest = (await mine().recent("st-1", 30, noon(3)))[0];
    expect(latest).toMatchObject({ checkedOn: "2026-11-03", effort: 0, recovery: null, notes: null, formVersion: 2 });
    expect(latest.answers).toEqual([{ questionId: v2.form.questions[0].id, answer: "Sim" }]);
    // The version of a check-in never changes, and it must be one of its own student.
    await expect(run("UPDATE student_checkins SET form_version_id = ?2 WHERE id = ?1", latest.id, v1.id)).rejects.toThrow(/CHECKIN_IDENTITY_FROZEN/);
    await expect(
      run(
        `INSERT INTO student_checkins(id,organization_id,student_id,checked_on,logged_by_user_id,notes,created_at,updated_at,form_version_id)
         VALUES ('direct','org-a','st-2','2026-11-03','client-2','x','2026-11-03T15:00:00.000Z','2026-11-03T15:00:00.000Z',?1)`,
        v1.id,
      ),
    ).rejects.toThrow(/CHECKIN_FORM_INVALID/);
  });
});

describe("a check-in of a previous day", () => {
  it("is accepted within the window of the workout log (14 days), never the future nor before it", async () => {
    expect(await mine().save("st-1", { checkedOn: "2026-11-01", discomfort: false, recovery: null, answers: [], effort: 3 }, noon(15))).toMatchObject({ status: "saved", created: true });
    expect(await checkinOf("st-1", "2026-11-01")).not.toBeNull();
    expect(await mine().save("st-1", { checkedOn: "2026-10-31", effort: 3 }, noon(15))).toEqual({ status: "out_of_range" });
    expect(await mine().save("st-1", { checkedOn: "2026-11-16", effort: 3 }, noon(15))).toEqual({ status: "out_of_range" });
    expect(await mine().save("st-1", { checkedOn: "ontem", effort: 3 }, noon(15))).toEqual({ status: "out_of_range" });
    expect(await mine().save("st-1", { checkedOn: 5, effort: 3 }, noon(15))).toEqual({ status: "out_of_range" });
    expect(await checkinOf("st-1", "2026-10-31")).toBeNull();
  });

  it("can be corrected or deleted on the day it was made, not on the day it is about, and one per day still holds", async () => {
    expect(await mine().save("st-1", { checkedOn: "2026-11-06", effort: 2 }, noon(15))).toMatchObject({ status: "saved", created: true });
    const id = (await checkinOf("st-1", "2026-11-06"))!;
    expect((await mine().recent("st-1", 30, noon(15))).find((row) => row.id === id)).toMatchObject({ editable: true, checkedOn: "2026-11-06" });
    expect(await mine().save("st-1", { checkedOn: "2026-11-06", effort: 4 }, noon(15))).toMatchObject({ status: "saved", created: false, id });
    // A day that already has a check-in made on another day is closed.
    expect(await mine().save("st-1", { checkedOn: "2026-11-02", effort: 1 }, noon(15))).toEqual({ status: "locked" });
    // The next day the backdated one is closed too.
    expect((await mine().recent("st-1", 30, noon(16))).find((row) => row.id === id)).toMatchObject({ editable: false, effort: 4 });
    expect(await mine().save("st-1", { checkedOn: "2026-11-06", effort: 5 }, noon(16))).toEqual({ status: "locked" });
    expect(await mine().remove(id, noon(16))).toEqual({ status: "locked" });
    expect(await count("SELECT COUNT(*) AS n FROM student_checkins WHERE student_id = 'st-1' AND checked_on = '2026-11-06'")).toBe(1);
    // A backdated one made today can be deleted today.
    expect(await mine().save("st-1", { checkedOn: "2026-11-07", effort: 2 }, noon(16))).toMatchObject({ status: "saved", created: true });
    expect(await mine().remove((await checkinOf("st-1", "2026-11-07"))!, noon(16))).toEqual({ status: "removed" });
  });

  it("is written only for a student the login is linked to", async () => {
    for (const login of ["client-2", "client-b", "tech-a"])
      expect(await mine(login).save("st-1", { checkedOn: "2026-11-05", effort: 1 }, noon(15)), login).toEqual({ status: "not_found" });
    expect(await checkinOf("st-1", "2026-11-05")).toBeNull();
  });
});

describe("the professional's reply", () => {
  it("is open only to a professional with reach, and writes nothing otherwise", async () => {
    const id = (await checkinOf("st-1", "2026-11-02"))!;
    for (const [user, org] of outsiders)
      expect(await pro(user, org).reply(id, "Oi", noon(16)), `${user}/${org}`).toEqual({ status: "not_found" });
    expect(await count("SELECT COUNT(*) AS n FROM checkin_replies")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = ?1", CHECKIN_REPLY)).toBe(0);
    await expect(pro().reply(id, "   ", noon(16))).rejects.toThrow("REPLY_EMPTY");
    await expect(pro().reply(id, "x".repeat(1001), noon(16))).rejects.toThrow("REPLY_TOO_LONG");
  });

  it("is recorded with author and time, registers the reading once, closes the check-in and is shown to the student as new", async () => {
    const id = (await checkinOf("st-1", "2026-11-03"))!;
    expect((await mine().recent("st-1", 30, noon(3))).find((row) => row.id === id)).toMatchObject({ editable: true, replies: [] });
    expect(await pro().reply(id, "  Boa! Vamos manter.  ", noon(3))).toMatchObject({ status: "recorded" });
    expect(await pro().reply(id, "E durma mais.", new Date("2026-11-03T16:00:00Z"))).toMatchObject({ status: "recorded" });
    expect(await count("SELECT COUNT(*) AS n FROM checkin_acknowledgements WHERE checkin_id = ?1", id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = ?1 AND subject_id = ?2", CHECKIN_REPLY, id)).toBe(2);
    expect(JSON.stringify(await db.prepare("SELECT * FROM access_audit_events").all())).not.toContain("Vamos manter");

    const row = (await mine().recent("st-1", 30, noon(3))).find((item) => item.id === id)!;
    expect(row).toMatchObject({ editable: false, newReply: true, acknowledgedAt: noon(3).toISOString() });
    expect(row.replies.map(({ authorName, body, createdAt }) => ({ authorName, body, createdAt }))).toEqual([
      { authorName: "Pro A", body: "Boa! Vamos manter.", createdAt: noon(3).toISOString() },
      { authorName: "Pro A", body: "E durma mais.", createdAt: "2026-11-03T16:00:00.000Z" },
    ]);
    expect((await pro().list("st-1")).find((item) => item.id === id)!.replies).toHaveLength(2);
    // Closed for the student, and the database agrees.
    expect(await mine().save("st-1", { effort: 1 }, noon(3))).toEqual({ status: "locked" });
    expect(await mine().remove(id, noon(3))).toEqual({ status: "locked" });
    await expect(run("UPDATE student_checkins SET effort = 1 WHERE id = ?1", id)).rejects.toThrow(/CHECKIN_FROZEN/);
    await expect(run("UPDATE checkin_replies SET body = 'x' WHERE checkin_id = ?1", id)).rejects.toThrow(/CHECKIN_REPLY_APPEND_ONLY/);
    await expect(run("DELETE FROM checkin_replies WHERE checkin_id = ?1", id)).rejects.toThrow(/CHECKIN_REPLY_APPEND_ONLY/);
  });

  it("is new for the student until they see it, and only for the student's own login", async () => {
    expect(await mine().unseenReplies("st-1")).toBe(2);
    expect(await mine("client-2").unseenReplies("st-1")).toBe(0);
    expect(await mine("client-2").recent("st-1", 30, noon(3))).toEqual([]);
    // Another login marking "seen" for a student it is not linked to writes nothing.
    await mine("client-2").markRepliesSeen("st-1", noon(20));
    expect(await count("SELECT COUNT(*) AS n FROM checkin_reply_seen")).toBe(0);

    await mine().markRepliesSeen("st-1", new Date("2026-11-03T17:00:00Z"));
    expect(await mine().unseenReplies("st-1")).toBe(0);
    expect((await mine().recent("st-1", 30, noon(3))).every((row) => !row.newReply)).toBe(true);
    // An older "seen" never moves the marker back.
    await mine().markRepliesSeen("st-1", noon(1));
    expect(await mine().unseenReplies("st-1")).toBe(0);
    // A later reply is new again.
    const id = (await checkinOf("st-1", "2026-11-02"))!;
    await pro().reply(id, "Como está hoje?", noon(18));
    expect(await mine().unseenReplies("st-1")).toBe(1);
    expect((await mine().recent("st-1", 30, noon(18))).find((row) => row.id === id)).toMatchObject({ newReply: true });
    // "Seen" is up to the newest reply the page showed: a reply that arrives after the render stays new.
    await pro().reply(id, "E o sono?", noon(19));
    await mine().markRepliesSeen("st-1", noon(20), noon(18).toISOString());
    expect(await mine().unseenReplies("st-1")).toBe(1);
    // Never later than now, and a malformed time counts as now.
    await mine().markRepliesSeen("st-1", noon(18), "2099-01-01T00:00:00.000Z");
    expect(await mine().unseenReplies("st-1")).toBe(1);
    await mine().markRepliesSeen("st-1", noon(20), "ontem");
    expect(await mine().unseenReplies("st-1")).toBe(0);
    // A revoked link reads nothing.
    await run("UPDATE student_access SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE user_id = 'client-1'");
    expect(await mine().unseenReplies("st-1")).toBe(0);
    expect(await mine().recent("st-1", 30, noon(18))).toEqual([]);
    await run("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-1'");
  });

  it("ends with the assignment", async () => {
    const id = (await checkinOf("st-1", "2026-11-02"))!;
    await run("UPDATE care_assignments SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE student_id = 'st-1'");
    expect(await pro().reply(id, "Oi", noon(19))).toEqual({ status: "not_found" });
    expect(await pro().list("st-1")).toEqual([]);
    expect(await pro().form("st-1")).toBeNull();
    await run("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'");
  });
});

describe("questions changed while a screen was open", () => {
  const ownPro = () => pro("tech-a2");
  const student = () => mine("client-2");
  it("refuses a stale editor instead of silently undoing another professional's version", async () => {
    const base = { askEffort: true, askRecovery: true, askNotes: true };
    // Both editors opened on the default (no version yet).
    expect(await ownPro().saveForm("st-2", { ...base, questions: [{ text: "Dormiu bem?" }] }, noon(10), null)).toEqual({
      status: "saved",
      version: 1,
    });
    expect(await ownPro().saveForm("st-2", { ...base, askEffort: false, questions: [] }, noon(10), null)).toEqual({
      status: "conflict",
    });
    // The same draft as the current version is not a conflict: nothing would be lost.
    const v1 = (await ownPro().form("st-2"))!;
    expect(await ownPro().saveForm("st-2", { ...base, questions: v1.form.questions }, noon(10), null)).toEqual({ status: "unchanged" });
    expect(await ownPro().saveForm("st-2", { ...base, askEffort: false, questions: v1.form.questions }, noon(10), 1)).toEqual({
      status: "saved",
      version: 2,
    });
    expect(await count("SELECT COUNT(*) AS n FROM checkin_form_versions WHERE student_id = 'st-2'")).toBe(2);
  });

  it("refuses the student's check-in answered with another version, writing nothing and dropping nothing", async () => {
    const v2 = (await student().currentForm("st-2"))!;
    const question = v2.form.questions[0].id;
    const answer = { answers: [{ questionId: question, answer: "Sim" }] };
    expect(await student().save("st-2", { ...answer, formVersion: 1 }, noon(10))).toEqual({ status: "form_changed" });
    expect(await student().save("st-2", { ...answer, formVersion: null }, noon(10))).toEqual({ status: "form_changed" });
    expect(await checkinOf("st-2", "2026-11-10")).toBeNull();
    expect(await student().save("st-2", { ...answer, formVersion: 2 }, noon(10))).toMatchObject({ status: "saved", created: true });
    const [row] = await student().recent("st-2", 30, noon(10));
    expect(row).toMatchObject({ checkedOn: "2026-11-10", formVersion: 2, answers: [{ questionId: question, answer: "Sim" }] });
    // A correction is read against the check-in's own version.
    expect(await student().save("st-2", { ...answer, formVersion: 1 }, noon(10))).toEqual({ status: "form_changed" });
    expect(await student().save("st-2", { ...answer, notes: "x", formVersion: 2 }, noon(10))).toMatchObject({
      status: "saved",
      created: false,
    });
  });
});
