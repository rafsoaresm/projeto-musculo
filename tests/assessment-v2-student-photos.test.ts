import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentsFor } from "@/db/assessments";
import { assessmentPhotosFor } from "@/db/assessment-photos";
import { assessmentReportsFor, studentAssessmentsFor } from "@/db/assessment-reports";
import { renderAssessmentPdf } from "@/modules/pdf/assessment-pdf";
import { assessmentReport, reportFingerprint } from "@/modules/avaliacoes/v2/report";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Slice 0.86 (PENDENCIAS B50; user's decision of 03/11/2026: "o aluno pode ver as próprias fotos"): the student reads the posture photos of
// their own recorded Avaliações Físicas, read only, through the same gate as the student's report (active link, login not blocked, same
// organization, recorded, new format). Real local D1 and R2 with the real migrations and triggers.
let mf: Miniflare;
let db: D1Database;
let bucket: R2Bucket;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
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
const PARQ_CODES = ["heart_condition", "chest_pain_activity", "chest_pain_month", "dizziness", "bone_joint", "blood_pressure_medication", "other_reason"] as const;
const noParq = { parq: { answers: Object.fromEntries(PARQ_CODES.map((code) => [code, "no"])) } };

let recorded = "";
let draft = "";
let foreign = "";

async function readAll(found: { body: unknown } | null) {
  return found ? new Uint8Array(await new Response(found.body as BodyInit).arrayBuffer()) : null;
}
async function record(organizationId: string, user: string, student: string, at: string, views: string[]) {
  const api = assessmentsFor(db, scope(user, organizationId));
  const started = await api.startDraft(student, new Date(at));
  if (started.status !== "started") throw new Error(started.status);
  for (const view of views) expect((await assessmentPhotosFor(db, bucket, scope(user, organizationId)).put(started.id, view, jpeg(), new Date(at))).status).toBe("stored");
  const revision = (await api.sections(started.id))!.revision;
  const saved = await api.saveSection(started.id, { module: "screening", status: "IN_PROGRESS", payload: noParq, revision });
  if (saved.status !== "saved") throw new Error(saved.status);
  expect(await api.finalize(started.id, saved.revision, new Date(at))).toEqual({ status: "recorded" });
  return started.id;
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "student-photos-tests" },
      r2Buckets: { PHOTOS: "student-photos-bucket" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  bucket = (await mf.getR2Bucket("PHOTOS")) as unknown as R2Bucket;
  await migrate(db, ALL_MIGRATIONS);
  const people = ["tech-a", "tech-b", "client-1", "client-2", "client-b"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL')"),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-2','org-a','Two'),('st-b','org-b','B')"),
    db.prepare(
      "INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a'),('org-b','st-b','pro-b')",
    ),
    db.prepare(
      "INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1'),('org-a','st-2','client-2'),('org-b','st-b','client-b')",
    ),
  ]);
  recorded = await record("org-a", "tech-a", "st-1", "2026-11-03T15:00:00Z", ["LATERAL_LEFT", "ANTERIOR", "POSTERIOR"]);
  // The professional erases one after the record: the frozen row stays, the bytes go.
  expect(await assessmentPhotosFor(db, bucket, scope("tech-a")).remove(recorded, "POSTERIOR", new Date("2026-11-04T12:00:00Z"))).toEqual({ status: "erased" });
  // A draft of the same student with a photo, and a recorded one of another organization.
  const started = await assessmentsFor(db, scope("tech-a")).startDraft("st-1", new Date("2026-11-05T12:00:00Z"));
  if (started.status !== "started") throw new Error(started.status);
  draft = started.id;
  expect((await assessmentPhotosFor(db, bucket, scope("tech-a")).put(draft, "ANTERIOR", jpeg())).status).toBe("stored");
  foreign = await record("org-b", "tech-b", "st-b", "2026-11-03T16:00:00Z", ["ANTERIOR"]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("the student's own posture photos (0.86)", () => {
  it("the linked student reads the index (erased ones with their date) and the image of each stored photo of their recorded assessment", async () => {
    const mine = studentAssessmentsFor(db, "client-1", "st-1");
    const source = await mine.source(recorded);
    expect(source!.photos).toEqual([
      { view: "ANTERIOR", createdAt: "2026-11-03T15:00:00.000Z", erasedAt: null },
      { view: "LATERAL_LEFT", createdAt: "2026-11-03T15:00:00.000Z", erasedAt: null },
      { view: "POSTERIOR", createdAt: "2026-11-03T15:00:00.000Z", erasedAt: "2026-11-04T12:00:00.000Z" },
    ]);
    // Without the storage there are no bytes; the storage keys never leave the repository.
    expect(source!.photoImages).toBeUndefined();
    expect(JSON.stringify(source)).not.toContain("assessments/org-a/");
    const image = await readAll(await mine.photo(bucket, recorded, "LATERAL_LEFT"));
    expect(Buffer.from(image!).subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(await readAll(await mine.photo(bucket, recorded, "ANTERIOR"))).not.toBeNull();
    // A storage that fails to answer is "unavailable" (the route answers 503), not a bare error.
    const failing = { get: async () => { throw new Error("network"); } } as unknown as R2Bucket;
    await expect(mine.photo(failing, recorded, "LATERAL_LEFT")).rejects.toThrow("PHOTO_STORAGE_UNAVAILABLE");
  });

  it("refuses an erased photo, an unknown view, a draft, another student, another organization, a revoked link and a blocked login", async () => {
    const mine = studentAssessmentsFor(db, "client-1", "st-1");
    expect(await mine.photo(bucket, recorded, "POSTERIOR")).toBeNull();
    expect(await mine.photo(bucket, recorded, "LATERAL_RIGHT")).toBeNull();
    expect(await mine.photo(bucket, recorded, "TOP")).toBeNull();
    expect(await mine.photo(bucket, draft, "ANTERIOR")).toBeNull();
    expect(await mine.source(draft)).toBeNull();
    // Another student of the same organization, by their own login or by asking with this student's id.
    expect(await studentAssessmentsFor(db, "client-2", "st-1").photo(bucket, recorded, "ANTERIOR")).toBeNull();
    expect(await studentAssessmentsFor(db, "client-2", "st-2").photo(bucket, recorded, "ANTERIOR")).toBeNull();
    expect(await studentAssessmentsFor(db, "client-1", "st-2").photo(bucket, recorded, "ANTERIOR")).toBeNull();
    // Another organization: their own login cannot reach org-a, and client-1 cannot reach org-b's.
    expect(await studentAssessmentsFor(db, "client-b", "st-1").photo(bucket, recorded, "ANTERIOR")).toBeNull();
    expect(await studentAssessmentsFor(db, "client-b", "st-b").photo(bucket, recorded, "ANTERIOR")).toBeNull();
    expect(await studentAssessmentsFor(db, "client-1", "st-1").photo(bucket, foreign, "ANTERIOR")).toBeNull();
    expect(await readAll(await studentAssessmentsFor(db, "client-b", "st-b").photo(bucket, foreign, "ANTERIOR"))).not.toBeNull();
    // The professional's login is not a student's link.
    expect(await studentAssessmentsFor(db, "tech-a", "st-1").photo(bucket, recorded, "ANTERIOR")).toBeNull();
    expect(await studentAssessmentsFor(db, "", "st-1").photo(bucket, recorded, "ANTERIOR")).toBeNull();
    // A revoked link and a blocked login read nothing.
    await db.prepare("UPDATE student_access SET revoked_at = '2026-11-06T00:00:00Z' WHERE user_id = 'client-1'").run();
    expect(await mine.photo(bucket, recorded, "ANTERIOR")).toBeNull();
    await db.prepare("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-1'").run();
    await db.prepare("UPDATE users SET disabled_at = '2026-11-06T00:00:00Z' WHERE id = 'client-1'").run();
    expect(await mine.photo(bucket, recorded, "ANTERIOR")).toBeNull();
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = 'client-1'").run();
    expect(await mine.photo(bucket, recorded, "ANTERIOR")).not.toBeNull();
  });

  it("puts the stored photos in the PDF of both, an erased one as its date, and the same record keeps its version", async () => {
    const pro = await assessmentReportsFor(db, scope("tech-a")).source("st-1", recorded, bucket);
    const mine = await studentAssessmentsFor(db, "client-1", "st-1").source(recorded, bucket);
    expect(Object.keys(pro!.photoImages!).sort()).toEqual(["ANTERIOR", "LATERAL_LEFT"]);
    expect(Object.keys(mine!.photoImages!).sort()).toEqual(["ANTERIOR", "LATERAL_LEFT"]);
    const section = assessmentReport(mine!).sections.find((item) => item.title === "Fotos da postura");
    expect(section?.blocks.at(-1)).toEqual({
      kind: "photos",
      items: [
        { view: "LATERAL_LEFT", label: "Lateral esquerda", erasedOn: null },
        { view: "POSTERIOR", label: "Posterior", erasedOn: "04/11/2026" },
        { view: "ANTERIOR", label: "Anterior", erasedOn: null },
      ],
    });
    const pdf = await renderAssessmentPdf({ ...mine!, generatedAt: new Date("2026-11-06T12:00:00Z") });
    const raw = Buffer.from(pdf).toString("latin1");
    expect(raw.match(/\/Subtype \/Image/g)?.length).toBe(2);
    expect(raw).toContain("/DCTDecode");
    const doc = await PDFDocument.load(pdf);
    const proDoc = await PDFDocument.load(await renderAssessmentPdf({ ...pro!, generatedAt: new Date("2026-11-06T12:00:00Z") }));
    expect(proDoc.getKeywords()).toBe(doc.getKeywords());
    // A photo whose bytes did not come (storage off) is said, never left blank; the version does not depend on the bytes.
    const without = await renderAssessmentPdf({ ...mine!, photoImages: undefined, generatedAt: new Date("2026-11-06T12:00:00Z") });
    expect(Buffer.from(without).toString("latin1")).not.toContain("/Subtype /Image");
    expect((await PDFDocument.load(without)).getKeywords()).toBe(doc.getKeywords());
    // Erasing another photo later does not change the version of the record.
    const before = await reportFingerprint(mine!);
    expect(await reportFingerprint({ ...mine!, photos: mine!.photos!.map((photo) => ({ ...photo, erasedAt: "2026-11-07T12:00:00.000Z" })) })).toBe(before);
    // Any record, with photos or without, keeps the version it had before 0.86 (photos were stored from 0.83 on, before the PDF showed them).
    const bare = { ...mine!, photos: undefined, photoImages: undefined };
    expect(await reportFingerprint({ ...bare, photos: [] })).toBe(await reportFingerprint(bare));
    expect(before).toBe(await reportFingerprint(bare));
    expect(assessmentReport({ ...bare, photos: [] }).sections.some((item) => item.title === "Fotos da postura")).toBe(false);
  });
});
