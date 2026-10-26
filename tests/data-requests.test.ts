import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { assessmentPhotosFor } from "@/db/assessment-photos";
import { assessmentsFor } from "@/db/assessments";
import { recordAcceptance } from "@/db/consent";
import { dataRequestsFor, studentRequestsFor } from "@/db/data-requests";
import { BASELINE_VERSION } from "@/modules/consentimento/terms";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 and R2 with the real migrations and triggers. Identities are rows, as the server
// derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
let bucket: R2Bucket;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const day = (n: number) => new Date(`2026-11-${String(n).padStart(2, "0")}T12:00:00Z`);
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());
const text = (value: string) => [...new TextEncoder().encode(value)];
const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const jpeg = () =>
  bytes(
    [0xff, 0xd8],
    segment(0xe0, [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    segment(0xc0, [8, 1, 0xe0, 2, 0x80, 1, 1, 0x11, 0]),
    segment(0xda, [1, 1, 0, 0, 63, 0]),
    [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9],
  );

const STUDENTS: Array<[student: string, login: string, professional: string]> = [
  ["st-1", "client-1", "pro-a"],
  ["st-2", "client-2", "pro-a2"],
  ["st-ph", "client-ph", "pro-a"],
  ["st-other", "client-other", "pro-a"],
  ["st-fail", "client-fail", "pro-a"],
  ["st-race", "client-race", "pro-a"],
];

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "request-tests" },
      r2Buckets: { PHOTOS: "request-tests-bucket" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  bucket = (await mf.getR2Bucket("PHOTOS")) as unknown as R2Bucket;
  await migrate(db, ALL_MIGRATIONS);
  const logins = [...STUDENTS.map(([, login]) => login), "client-b"];
  const staff = ["owner-a", "tech-a", "tech-a2", "commercial-a", "owner-b", "tech-b"];
  await db.batch([
    ...[...staff, ...logins].map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    ...[...staff, ...logins].map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
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
    ...STUDENTS.map(([student]) =>
      db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES (?1,'org-a',?1)").bind(student),
    ),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-b','org-b','Student B')"),
    ...STUDENTS.map(([student, , professional]) =>
      db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a',?1,?2)").bind(student, professional),
    ),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-b','st-b','pro-b')"),
    ...STUDENTS.map(([student, login]) =>
      db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a',?1,?2)").bind(student, login),
    ),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-b','st-b','client-b')"),
  ]);
  // The authorization for photos is the student's own, recorded when they joined.
  for (const [, login] of STUDENTS)
    await recordAcceptance(db, login, "STUDENT", { photosAuthorized: true, shownVersion: BASELINE_VERSION }, new Date("2026-11-01T12:00:00Z"));
});
afterAll(async () => {
  await mf.dispose();
});

const asStudent = (login: string) => studentRequestsFor(db, login);
const asPro = (user: string, org = "org-a", withBucket: R2Bucket | null = bucket) => dataRequestsFor(db, scope(user, org), withBucket);
const objects = async () => (await bucket.list()).objects.map((o) => o.key).sort();
const audit = async (action: string) =>
  (await db.prepare("SELECT actor_user_id AS actor, subject_id AS subject, organization_id AS org FROM access_audit_events WHERE action = ?1 ORDER BY rowid").bind(action).all<{ actor: string; subject: string; org: string }>()).results;
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const openRequest = async (login: string, student: string, kind: string, when = day(10), message?: string) => {
  const result = await asStudent(login).open(student, { kind, message }, when);
  if (result.status !== "opened") throw new Error(result.status);
  return result.id;
};

describe("the student's request", () => {
  it("is recorded with the student's own login, the organization from the link and a deadline of 15 days", async () => {
    const result = await asStudent("client-1").open("st-1", { kind: "ACCESS", message: "Quero a cópia." }, day(10));
    expect(result).toMatchObject({ status: "opened", dueAt: "2026-11-25T12:00:00.000Z" });
    const row = await db.prepare("SELECT organization_id AS org, student_id AS student, requested_by_user_id AS by, kind, message, created_at AS createdAt, due_at AS dueAt FROM data_subject_requests").first();
    expect(row).toEqual({
      org: "org-a", student: "st-1", by: "client-1", kind: "ACCESS", message: "Quero a cópia.",
      createdAt: "2026-11-10T12:00:00.000Z", dueAt: "2026-11-25T12:00:00.000Z",
    });
    expect(await audit("DATA_REQUEST_OPENED")).toEqual([{ actor: "client-1", subject: (result as { id: string }).id, org: "org-a" }]);
    const [mine] = await asStudent("client-1").list("st-1", day(11));
    expect(mine).toMatchObject({ kind: "ACCESS", outcome: null, outcomeNote: null, overdue: false });
  });

  it("is one open request of each kind at a time, and a different kind is a different request", async () => {
    expect(await asStudent("client-1").open("st-1", { kind: "ACCESS" }, day(11))).toEqual({ status: "already_open" });
    expect(await asStudent("client-1").open("st-1", { kind: "CORRECTION", message: "O telefone está errado." }, day(11))).toMatchObject({ status: "opened" });
    expect((await asStudent("client-1").list("st-1", day(11))).map((row) => row.kind).sort()).toEqual(["ACCESS", "CORRECTION"]);
    // Nothing was written for the refused one.
    expect((await db.prepare("SELECT COUNT(*) AS n FROM data_subject_requests WHERE student_id = 'st-1'").first<{ n: number }>())!.n).toBe(2);
    expect(await audit("DATA_REQUEST_OPENED")).toHaveLength(2);
  });

  it("refuses a malformed request and writes nothing", async () => {
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM data_subject_requests").first<{ n: number }>())!.n;
    await expect(asStudent("client-1").open("st-1", { kind: "OTHER" }, day(11))).rejects.toThrow(ZodError);
    await expect(asStudent("client-1").open("st-1", { kind: "ACCESS", organizationId: "org-b" }, day(11))).rejects.toThrow(ZodError);
    await expect(asStudent("client-1").open("st-1", { kind: "NOPE" }, day(11))).rejects.toThrow(ZodError);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM data_subject_requests").first<{ n: number }>())!.n).toBe(before);
  });

  it("can only be made, read and cancelled by the login linked to that student", async () => {
    // Another student's login, and a student of another organization, reach nothing of st-1.
    expect(await asStudent("client-2").open("st-1", { kind: "DATA_DELETION" }, day(11))).toEqual({ status: "not_found" });
    expect(await asStudent("client-b").open("st-1", { kind: "DATA_DELETION" }, day(11))).toEqual({ status: "not_found" });
    expect(await asStudent("client-2").list("st-1")).toEqual([]);
    expect(await asStudent("client-b").list("st-1")).toEqual([]);
    const [open] = await asStudent("client-1").list("st-1");
    expect(await asStudent("client-2").cancel(open.id, day(11))).toEqual({ status: "not_open" });
    expect(await asStudent("client-b").cancel(open.id, day(11))).toEqual({ status: "not_open" });
    expect((await asStudent("client-1").list("st-1")).filter((row) => row.outcome === null)).toHaveLength(2);
    expect(() => studentRequestsFor(db, " ")).toThrow("AUTHENTICATION_REQUIRED");
  });

  it("ends with the link or the identity", async () => {
    await run("UPDATE student_access SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE user_id = 'client-1'");
    expect(await asStudent("client-1").open("st-1", { kind: "OTHER", message: "x" }, day(12))).toEqual({ status: "not_found" });
    expect(await asStudent("client-1").list("st-1")).toEqual([]);
    await run("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-1'");
    await run("UPDATE users SET disabled_at = '2026-12-01T00:00:00.000Z' WHERE id = 'client-1'");
    expect(await asStudent("client-1").open("st-1", { kind: "OTHER", message: "x" }, day(12))).toEqual({ status: "not_found" });
    expect(await asStudent("client-1").list("st-1")).toEqual([]);
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'client-1'");
    expect(await asStudent("client-1").list("st-1")).toHaveLength(2);
  });

  it("can be withdrawn while open, once, and a new one can be made afterwards", async () => {
    const [correction] = (await asStudent("client-1").list("st-1")).filter((row) => row.kind === "CORRECTION");
    expect(await asStudent("client-1").cancel(correction.id, day(12))).toEqual({ status: "cancelled" });
    expect(await asStudent("client-1").cancel(correction.id, day(12))).toEqual({ status: "not_open" });
    const after = (await asStudent("client-1").list("st-1")).find((row) => row.id === correction.id)!;
    expect(after).toMatchObject({ outcome: "CANCELLED", outcomeNote: null, overdue: false });
    expect((await audit("DATA_REQUEST_CANCELLED")).map((e) => [e.actor, e.subject])).toEqual([["client-1", correction.id]]);
    // Open requests come first.
    expect((await asStudent("client-1").list("st-1")).map((row) => row.outcome)).toEqual([null, "CANCELLED"]);
    expect(await asStudent("client-1").open("st-1", { kind: "CORRECTION", message: "Agora é outro." }, day(12))).toMatchObject({ status: "opened" });
  });
});

describe("the professional's side", () => {
  it("shows only the open requests of the students under their own assignment, the nearest deadline first", async () => {
    await openRequest("client-2", "st-2", "ACCESS", day(9));
    const mine = await asPro("tech-a").pending(day(12));
    expect(mine.map((row) => [row.studentId, row.kind])).toEqual([
      ["st-1", "ACCESS"],
      ["st-1", "CORRECTION"],
    ]);
    expect(mine.every((row) => row.studentName === "st-1" && !row.overdue)).toBe(true);
    // Another professional of the same organization sees only theirs; the owner without assignment, none.
    expect((await asPro("tech-a2").pending(day(12))).map((row) => row.studentId)).toEqual(["st-2"]);
    expect(await asPro("owner-a").pending(day(12))).toEqual([]);
    expect(await asPro("commercial-a").pending(day(12))).toEqual([]);
    expect(await asPro("tech-b", "org-b").pending(day(12))).toEqual([]);
    // Naming another organization changes nothing: the organization is part of every query.
    expect(await asPro("tech-a", "org-b").pending(day(12))).toEqual([]);
  });

  it("marks a request as overdue only after its deadline", async () => {
    expect((await asPro("tech-a").pending(new Date("2026-11-25T12:00:00Z"))).some((row) => row.overdue)).toBe(false);
    const late = await asPro("tech-a").pending(new Date("2026-11-25T12:00:01Z"));
    expect(late.find((row) => row.kind === "ACCESS")?.overdue).toBe(true);
    expect((await asPro("tech-a").forStudent("st-1", new Date("2026-11-25T12:00:01Z"))).find((row) => row.kind === "ACCESS")?.overdue).toBe(true);
    expect(await asStudent("client-1").list("st-1", new Date("2026-11-25T12:00:01Z"))).toSatisfy((rows: Array<{ kind: string; overdue: boolean }>) => rows.find((row) => row.kind === "ACCESS")?.overdue === true);
  });

  it("reads the requests of one student only with the assignment over that student", async () => {
    expect((await asPro("tech-a").forStudent("st-1")).map((row) => row.kind).sort()).toEqual(["ACCESS", "CORRECTION", "CORRECTION"]);
    expect(await asPro("tech-a2").forStudent("st-1")).toEqual([]);
    expect(await asPro("owner-a").forStudent("st-1")).toEqual([]);
    expect(await asPro("tech-b", "org-b").forStudent("st-1")).toEqual([]);
    await run("UPDATE care_assignments SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE student_id = 'st-1'");
    expect(await asPro("tech-a").forStudent("st-1")).toEqual([]);
    expect(await asPro("tech-a").pending(day(12))).toEqual([]);
    await run("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'");
    await run("UPDATE users SET disabled_at = '2026-12-01T00:00:00.000Z' WHERE id = 'tech-a'");
    expect(await asPro("tech-a").pending(day(12))).toEqual([]);
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'");
    expect((await asPro("tech-a").forStudent("st-1")).length).toBeGreaterThan(0);
  });

  it("answers with the explanation the student will read, and a request is answered once", async () => {
    const [access] = (await asPro("tech-a").forStudent("st-1")).filter((row) => row.kind === "ACCESS");
    // A refusal or a partial answer without a reason writes nothing.
    await expect(asPro("tech-a").answer(access.id, { outcome: "DECLINED" }, day(13))).rejects.toThrow(ZodError);
    await expect(asPro("tech-a").answer(access.id, { outcome: "PARTIALLY_FULFILLED", note: " " }, day(13))).rejects.toThrow(ZodError);
    // Not the student's outcome, and not a field the form does not have.
    await expect(asPro("tech-a").answer(access.id, { outcome: "CANCELLED", note: "x" }, day(13))).rejects.toThrow(ZodError);
    expect((await asStudent("client-1").list("st-1")).find((row) => row.id === access.id)?.outcome).toBeNull();

    expect(await asPro("tech-a").answer(access.id, { outcome: "PARTIALLY_FULFILLED", note: "Enviei os dados de cadastro; o resto está congelado." }, day(13))).toEqual({ status: "answered" });
    const seen = (await asStudent("client-1").list("st-1")).find((row) => row.id === access.id)!;
    expect(seen).toMatchObject({ outcome: "PARTIALLY_FULFILLED", outcomeNote: "Enviei os dados de cadastro; o resto está congelado.", decidedAt: "2026-11-13T12:00:00.000Z", overdue: false });
    expect(await asPro("tech-a").answer(access.id, { outcome: "FULFILLED" }, day(14))).toEqual({ status: "not_found" });
    expect((await audit("DATA_REQUEST_ANSWERED")).map((e) => [e.actor, e.subject, e.org])).toEqual([["tech-a", access.id, "org-a"]]);
    // The student cannot cancel what was answered, and it is no longer in the professional's queue.
    expect(await asStudent("client-1").cancel(access.id, day(14))).toEqual({ status: "not_open" });
    expect((await asPro("tech-a").pending(day(14))).some((row) => row.id === access.id)).toBe(false);
    // After an answer, the student can ask again.
    expect(await asStudent("client-1").open("st-1", { kind: "ACCESS" }, day(15))).toMatchObject({ status: "opened" });
  });

  it("cannot be answered by anyone without the assignment, the student or another organization", async () => {
    const [open] = (await asPro("tech-a").pending(day(15))).filter((row) => row.kind === "CORRECTION");
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM data_subject_request_outcomes").first<{ n: number }>())!.n;
    for (const [user, org] of [["tech-a2", "org-a"], ["owner-a", "org-a"], ["commercial-a", "org-a"], ["tech-b", "org-b"], ["tech-b", "org-a"], ["tech-a", "org-b"]] as const)
      expect(await asPro(user, org).answer(open.id, { outcome: "FULFILLED" }, day(15)), `${user} in ${org}`).toEqual({ status: "not_found" });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM data_subject_request_outcomes").first<{ n: number }>())!.n).toBe(before);
  });
});

describe("the database does not rely on the application", () => {
  const insertOutcome = (requestId: string, outcome: string, by: string, note: string | null = "x") =>
    run("INSERT INTO data_subject_request_outcomes(request_id,organization_id,outcome,note,decided_by_user_id,created_at) VALUES (?1,'org-a',?2,?3,?4,'2026-11-16T00:00:00.000Z')", requestId, outcome, note, by);

  it("never edits or deletes a request or its outcome", async () => {
    const answered = (await db.prepare("SELECT request_id AS id FROM data_subject_request_outcomes LIMIT 1").first<{ id: string }>())!.id;
    await expect(run("UPDATE data_subject_requests SET kind = 'OTHER' WHERE id = ?1", answered)).rejects.toThrow(/REQUEST_APPEND_ONLY/);
    await expect(run("UPDATE data_subject_requests SET due_at = '2099-01-01T00:00:00.000Z' WHERE id = ?1", answered)).rejects.toThrow(/REQUEST_APPEND_ONLY/);
    await expect(run("DELETE FROM data_subject_requests WHERE id = ?1", answered)).rejects.toThrow(/REQUEST_APPEND_ONLY/);
    await expect(run("UPDATE data_subject_request_outcomes SET outcome = 'FULFILLED' WHERE request_id = ?1", answered)).rejects.toThrow(/REQUEST_APPEND_ONLY/);
    await expect(run("UPDATE data_subject_request_outcomes SET note = 'outra' WHERE request_id = ?1", answered)).rejects.toThrow(/REQUEST_APPEND_ONLY/);
    await expect(run("DELETE FROM data_subject_request_outcomes WHERE request_id = ?1", answered)).rejects.toThrow(/REQUEST_APPEND_ONLY/);
  });

  it("refuses a request from a login that is not linked to the student, or blocked", async () => {
    const insert = (login: string, student = "st-1", kind = "OTHER") =>
      run("INSERT INTO data_subject_requests(id,organization_id,student_id,requested_by_user_id,kind,message,created_at,due_at) VALUES (?1,'org-a',?2,?3,?4,'x','2026-11-16T00:00:00.000Z','2026-12-01T00:00:00.000Z')", crypto.randomUUID(), student, login, kind);
    await expect(insert("client-2")).rejects.toThrow(/REQUEST_LOGIN_INVALID/);
    await expect(insert("tech-a")).rejects.toThrow(/REQUEST_LOGIN_INVALID/);
    await run("UPDATE users SET disabled_at = '2026-12-01T00:00:00.000Z' WHERE id = 'client-1'");
    await expect(insert("client-1")).rejects.toThrow(/REQUEST_LOGIN_INVALID/);
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'client-1'");
    await insert("client-1", "st-1", "DATA_DELETION");
    await expect(insert("client-1", "st-1", "DATA_DELETION")).rejects.toThrow(/REQUEST_ALREADY_OPEN/);
    // A deadline that is not after the request is refused too.
    await expect(
      run("INSERT INTO data_subject_requests(id,organization_id,student_id,requested_by_user_id,kind,created_at,due_at) VALUES ('bad','org-a','st-1','client-1','ACCEPTANCE_WITHDRAWAL','2026-11-16T00:00:00.000Z','2026-11-16T00:00:00.000Z')"),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("lets only the student cancel and only a professional with the assignment answer", async () => {
    const [open] = (await asPro("tech-a").pending(day(16))).filter((row) => row.kind === "DATA_DELETION");
    // The student cannot answer their own request, nor can a professional cancel it.
    await expect(insertOutcome(open.id, "FULFILLED", "client-1")).rejects.toThrow(/REQUEST_OUTCOME_(WRONG_ACTOR|NOT_AUTHORIZED)/);
    await expect(insertOutcome(open.id, "DECLINED", "client-1")).rejects.toThrow(/REQUEST_OUTCOME_(WRONG_ACTOR|NOT_AUTHORIZED)/);
    await expect(insertOutcome(open.id, "CANCELLED", "tech-a", null)).rejects.toThrow(/REQUEST_OUTCOME_WRONG_ACTOR/);
    // A professional without the assignment, or from another organization, cannot answer either.
    await expect(insertOutcome(open.id, "FULFILLED", "tech-a2")).rejects.toThrow(/REQUEST_OUTCOME_NOT_AUTHORIZED/);
    await expect(insertOutcome(open.id, "FULFILLED", "owner-a")).rejects.toThrow(/REQUEST_OUTCOME_NOT_AUTHORIZED/);
    await expect(insertOutcome(open.id, "FULFILLED", "tech-b")).rejects.toThrow(/REQUEST_OUTCOME_NOT_AUTHORIZED/);
    // A refusal says why.
    await expect(insertOutcome(open.id, "DECLINED", "tech-a", null)).rejects.toThrow(/CHECK constraint/);
    // The requester's cancellation and the professional's answer are the valid ones.
    await insertOutcome(open.id, "FULFILLED", "tech-a");
    // And there is one outcome at most.
    await expect(insertOutcome(open.id, "DECLINED", "tech-a", "outra")).rejects.toThrow(/UNIQUE|PRIMARY/);
  });
});

describe("erasing the photos of a student on request", () => {
  const put = (assessment: string, view: string) =>
    assessmentPhotosFor(db, bucket, scope("tech-a")).put(assessment, view, jpeg(), day(10));
  const draftFor = async (student: string, when = day(10), user = "tech-a") => {
    const started = await assessmentsFor(db, scope(user)).startDraft(student, when);
    if (started.status !== "started") throw new Error(started.status);
    return started.id;
  };
  /** A recorded assessment of the student with one photo: frozen, like the ones that exist in real use. */
  const recordedWithPhoto = async (student: string, view: string, when: Date) => {
    const id = await draftFor(student, when);
    expect(await put(id, view)).toEqual({ status: "stored", replaced: false });
    expect(await assessmentsFor(db, scope("tech-a")).record(id, { screeningAsked: true }, when)).toMatchObject({ status: "recorded" });
    return id;
  };
  const photoRows = async (student: string) =>
    (await db.prepare(`SELECT p.id, p.view, p.assessment_id AS assessment, p.object_key AS key FROM assessment_photos p JOIN assessments a ON a.id = p.assessment_id WHERE a.student_id = ?1 ORDER BY p.created_at, p.view`).bind(student).all<{ id: string; view: string; assessment: string; key: string }>()).results;
  let recorded = "";
  let draft = "";
  let otherDraft = "";

  beforeAll(async () => {
    recorded = await draftFor("st-ph", day(10));
    expect(await put(recorded, "ANTERIOR")).toEqual({ status: "stored", replaced: false });
    expect(await put(recorded, "LATERAL_LEFT")).toEqual({ status: "stored", replaced: false });
    await assessmentsFor(db, scope("tech-a")).saveDraft(recorded, { assessedOn: "2026-11-10" }, day(10));
    expect(await assessmentsFor(db, scope("tech-a")).record(recorded, { screeningAsked: true }, day(10))).toMatchObject({ status: "recorded" });
    draft = await draftFor("st-ph", day(20));
    expect(await put(draft, "POSTERIOR")).toEqual({ status: "stored", replaced: false });
    otherDraft = await draftFor("st-other", day(10));
    expect(await put(otherDraft, "ANTERIOR")).toEqual({ status: "stored", replaced: false });
  });

  it("refuses an erasure that no request of the student asked for, whatever the application says", async () => {
    const [photo] = await photoRows("st-ph");
    const tombstone = (requestId: string, user = "tech-a", photoId = photo.id, assessment = photo.assessment, view = photo.view) =>
      run("INSERT INTO photo_erasures(photo_id,organization_id,assessment_id,view,request_id,erased_by_user_id,erased_at) VALUES (?1,'org-a',?2,?3,?4,?5,'2026-11-21T00:00:00.000Z')", photoId, assessment, view, requestId, user);
    // No request at all, or one that is not about the photos.
    await expect(tombstone("missing")).rejects.toThrow();
    const access = await openRequest("client-ph", "st-ph", "ACCESS", day(21));
    await expect(tombstone(access)).rejects.toThrow(/PHOTO_ERASURE_NEEDS_REQUEST/);
    // A request of another student, even for photos.
    const others = await openRequest("client-other", "st-other", "PHOTOS_DELETION", day(21));
    await expect(tombstone(others)).rejects.toThrow(/PHOTO_ERASURE_NEEDS_REQUEST/);
    // The right request, but not by someone with the assignment.
    const mine = await openRequest("client-ph", "st-ph", "PHOTOS_DELETION", day(21));
    await expect(tombstone(mine, "tech-a2")).rejects.toThrow(/PHOTO_ERASURE_NOT_AUTHORIZED/);
    await expect(tombstone(mine, "owner-a")).rejects.toThrow(/PHOTO_ERASURE_NOT_AUTHORIZED/);
    await expect(tombstone(mine, "client-ph")).rejects.toThrow(/PHOTO_ERASURE_NOT_AUTHORIZED/);
    // A photo that does not exist.
    await expect(tombstone(mine, "tech-a", "no-such-photo")).rejects.toThrow(/PHOTO_ERASURE_NO_PHOTO/);
    await expect(tombstone(mine, "tech-a", photo.id, photo.assessment, "POSTERIOR")).rejects.toThrow(/PHOTO_ERASURE_NO_PHOTO/);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM photo_erasures").first<{ n: number }>())!.n).toBe(0);
    // The request cannot be closed as fulfilled while a photo is still stored.
    await expect(
      run("INSERT INTO data_subject_request_outcomes(request_id,organization_id,outcome,note,decided_by_user_id,created_at) VALUES (?1,'org-a','FULFILLED','feito','tech-a','2026-11-21T00:00:00.000Z')", mine),
    ).rejects.toThrow(/PHOTOS_STILL_STORED/);
    // The same for the application's own answer: it must erase, not just say so.
    expect(await asPro("tech-a").answer(mine, { outcome: "FULFILLED", note: "feito" }, day(21))).toEqual({ status: "use_erasure" });
    expect(await asPro("tech-a").answer(mine, { outcome: "PARTIALLY_FULFILLED", note: "parte" }, day(21))).toEqual({ status: "use_erasure" });
  });

  it("cannot be done by a professional without the assignment, with another kind of request or without the storage", async () => {
    const mine = (await asPro("tech-a").pending(day(21))).find((row) => row.studentId === "st-ph" && row.kind === "PHOTOS_DELETION")!;
    const access = (await asPro("tech-a").pending(day(21))).find((row) => row.studentId === "st-ph" && row.kind === "ACCESS")!;
    const before = await objects();
    expect(await asPro("tech-a2").erasePhotos(mine.id, day(21))).toEqual({ status: "not_found" });
    expect(await asPro("owner-a").erasePhotos(mine.id, day(21))).toEqual({ status: "not_found" });
    expect(await asPro("tech-b", "org-b").erasePhotos(mine.id, day(21))).toEqual({ status: "not_found" });
    expect(await asPro("tech-a").erasePhotos(access.id, day(21))).toEqual({ status: "not_found" });
    expect(await asPro("tech-a", "org-a", null).erasePhotos(mine.id, day(21))).toEqual({ status: "storage_unavailable" });
    expect(await objects()).toEqual(before);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM photo_erasures").first<{ n: number }>())!.n).toBe(0);
  });

  it("removes the files, keeps the frozen rows with a record, deletes the draft's, and closes the request", async () => {
    const mine = (await asPro("tech-a").pending(day(21))).find((row) => row.studentId === "st-ph" && row.kind === "PHOTOS_DELETION")!;
    const before = await photoRows("st-ph");
    expect(before).toHaveLength(3);
    const otherKeys = (await photoRows("st-other")).map((row) => row.key);
    expect(await asPro("tech-a").photosStored("st-ph")).toBe(3);
    expect(await asPro("tech-a2").photosStored("st-ph")).toBe(0);

    expect(await asPro("tech-a").erasePhotos(mine.id, day(22))).toEqual({ status: "erased", count: 3 });

    // The bytes are gone from the storage; the other student's photo is untouched.
    const left = await objects();
    for (const row of before) expect(left).not.toContain(row.key);
    expect(left).toEqual(otherKeys);
    // The frozen photos keep their rows (the freeze is intact); the draft's row was deleted.
    const rows = await photoRows("st-ph");
    expect(rows.map((row) => [row.assessment, row.view])).toEqual([[recorded, "ANTERIOR"], [recorded, "LATERAL_LEFT"]]);
    const tombstones = (await db.prepare("SELECT photo_id AS id, assessment_id AS assessment, view, request_id AS request, erased_by_user_id AS by, erased_at AS at FROM photo_erasures ORDER BY view").all<{ id: string; assessment: string; view: string; request: string; by: string; at: string }>()).results;
    expect(tombstones.map((t) => [t.assessment, t.view, t.request, t.by, t.at])).toEqual([
      [recorded, "ANTERIOR", mine.id, "tech-a", "2026-11-22T12:00:00.000Z"],
      [recorded, "LATERAL_LEFT", mine.id, "tech-a", "2026-11-22T12:00:00.000Z"],
      [draft, "POSTERIOR", mine.id, "tech-a", "2026-11-22T12:00:00.000Z"],
    ]);
    await expect(run("DELETE FROM assessment_photos WHERE assessment_id = ?1", recorded)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(run("UPDATE assessment_photos SET width = 1 WHERE assessment_id = ?1", recorded)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    // The request is closed with a note that the student reads, and the professional's queue is clear.
    const seen = (await asStudent("client-ph").list("st-ph")).find((row) => row.id === mine.id)!;
    expect(seen).toMatchObject({ outcome: "FULFILLED", outcomeNote: "3 fotos apagadas do armazenamento." });
    expect((await asPro("tech-a").pending(day(22))).some((row) => row.id === mine.id)).toBe(false);
    expect((await audit("DATA_REQUEST_ANSWERED")).some((e) => e.subject === mine.id && e.actor === "tech-a")).toBe(true);
    // Doing it again is not possible, and the student cannot take it back.
    expect(await asPro("tech-a").erasePhotos(mine.id, day(23))).toEqual({ status: "not_found" });
    expect(await asStudent("client-ph").cancel(mine.id, day(23))).toEqual({ status: "not_open" });
  });

  it("never serves or lists an erased photo as stored, and says when it was erased", async () => {
    const photos = assessmentPhotosFor(db, bucket, scope("tech-a"));
    expect(await photos.read(recorded, "ANTERIOR")).toBeNull();
    expect(await photos.read(recorded, "LATERAL_LEFT")).toBeNull();
    expect((await photos.list(recorded)).map((p) => [p.view, p.erasedAt])).toEqual([
      ["ANTERIOR", "2026-11-22T12:00:00.000Z"],
      ["LATERAL_LEFT", "2026-11-22T12:00:00.000Z"],
    ]);
    const detail = (await assessmentsFor(db, scope("tech-a")).get(recorded))!;
    expect(detail.photos.map((p) => [p.view, p.erasedAt])).toEqual([
      ["ANTERIOR", "2026-11-22T12:00:00.000Z"],
      ["LATERAL_LEFT", "2026-11-22T12:00:00.000Z"],
    ]);
    const history = await assessmentsFor(db, scope("tech-a")).history("st-ph");
    expect(history.find((h) => h.id === recorded)?.photos.every((p) => p.erasedAt !== null)).toBe(true);
    expect((await assessmentsFor(db, scope("tech-a")).get(draft))!.photos).toEqual([]);
    // The other student's photo is still stored and served.
    expect((await assessmentsFor(db, scope("tech-a")).get(otherDraft))!.photos.map((p) => p.erasedAt)).toEqual([null]);
    expect(await assessmentPhotosFor(db, bucket, scope("tech-a")).read(otherDraft, "ANTERIOR")).not.toBeNull();
    // What was erased is never changed afterwards.
    await expect(run("UPDATE photo_erasures SET erased_at = '2030-01-01T00:00:00.000Z'")).rejects.toThrow(/PHOTO_ERASURE_APPEND_ONLY/);
    await expect(run("DELETE FROM photo_erasures")).rejects.toThrow(/PHOTO_ERASURE_APPEND_ONLY/);
  });

  it("can be tried again after a failure, without redoing what was erased, and the request stays open meanwhile", async () => {
    await recordedWithPhoto("st-fail", "ANTERIOR", day(10));
    const draftId = await draftFor("st-fail", day(11));
    expect(await put(draftId, "ANTERIOR")).toEqual({ status: "stored", replaced: false });
    const id = await openRequest("client-fail", "st-fail", "PHOTOS_DELETION", day(24));
    let calls = 0;
    const flaky = new Proxy(bucket, {
      get(target, property) {
        if (property === "delete")
          return async (key: string | string[]) => {
            calls += 1;
            if (calls === 2) throw new Error("storage hiccup");
            return target.delete(key);
          };
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(asPro("tech-a", "org-a", flaky).erasePhotos(id, day(24))).rejects.toThrow("storage hiccup");
    // One is erased and recorded; the other is still there; the request is still open.
    expect((await db.prepare("SELECT COUNT(*) AS n FROM photo_erasures WHERE request_id = ?1").bind(id).first<{ n: number }>())!.n).toBe(1);
    expect(await asPro("tech-a").photosStored("st-fail")).toBe(1);
    expect((await asStudent("client-fail").list("st-fail"))[0].outcome).toBeNull();
    // Trying again finishes the work and reports the total under the request.
    expect(await asPro("tech-a").erasePhotos(id, day(25))).toEqual({ status: "erased", count: 2 });
    expect(await asPro("tech-a").photosStored("st-fail")).toBe(0);
    expect((await asStudent("client-fail").list("st-fail"))[0]).toMatchObject({ outcome: "FULFILLED", outcomeNote: "2 fotos apagadas do armazenamento." });
  });

  it("leaves the request open when a photo arrives while the others are being erased", async () => {
    await recordedWithPhoto("st-race", "ANTERIOR", day(10));
    const draftId = await draftFor("st-race", day(11));
    const id = await openRequest("client-race", "st-race", "PHOTOS_DELETION", day(24));
    let added = false;
    const racing = new Proxy(bucket, {
      get(target, property) {
        if (property === "delete")
          return async (key: string | string[]) => {
            await target.delete(key);
            if (!added) {
              added = true;
              await put(draftId, "POSTERIOR");
            }
          };
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await asPro("tech-a", "org-a", racing).erasePhotos(id, day(24))).toEqual({ status: "photos_remain" });
    expect((await asStudent("client-race").list("st-race"))[0].outcome).toBeNull();
    expect(await asPro("tech-a").photosStored("st-race")).toBe(1);
    // A new attempt takes the new photo too.
    expect(await asPro("tech-a").erasePhotos(id, day(25))).toEqual({ status: "erased", count: 2 });
  });

  it("can be refused with the reason, which the student reads, leaving the photos as they are", async () => {
    // The request this student opened earlier, to check that no other student's request could erase photos.
    const id = (await asPro("tech-a").pending(day(26))).find((row) => row.studentId === "st-other" && row.kind === "PHOTOS_DELETION")!.id;
    const before = await objects();
    await expect(asPro("tech-a").answer(id, { outcome: "DECLINED" }, day(26))).rejects.toThrow(ZodError);
    expect(await asPro("tech-a").answer(id, { outcome: "DECLINED", note: "A avaliação precisa ser guardada por 5 anos." }, day(26))).toEqual({ status: "answered" });
    expect(await objects()).toEqual(before);
    expect((await asStudent("client-other").list("st-other")).find((row) => row.id === id)).toMatchObject({
      outcome: "DECLINED",
      outcomeNote: "A avaliação precisa ser guardada por 5 anos.",
    });
    expect(await asPro("tech-a").photosStored("st-other")).toBe(1);
  });

  it("closes as fulfilled when the student had no photo stored", async () => {
    const id = await openRequest("client-2", "st-2", "PHOTOS_DELETION", day(26));
    expect(await asPro("tech-a2").erasePhotos(id, day(26))).toEqual({ status: "erased", count: 0 });
    expect((await asStudent("client-2").list("st-2")).find((row) => row.id === id)).toMatchObject({
      outcome: "FULFILLED",
      outcomeNote: "Nenhuma foto estava guardada.",
    });
  });
});
