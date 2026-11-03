import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentPhotosFor } from "@/db/assessment-photos";
import { recordAcceptance } from "@/db/consent";
import { BASELINE_VERSION } from "@/modules/consentimento/terms";
import { profilesFor } from "@/db/student-profile";
import { MAX_PHOTO_BYTES } from "@/modules/avaliacoes/photos";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";
import { withLegacy } from "./helpers/legacy-assessments";
import { ALL_NO } from "./helpers/screening";

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
const jpeg = (extra: number[][] = []) =>
  bytes(
    [0xff, 0xd8],
    segment(0xe0, [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...extra,
    segment(0xc0, [8, 1, 0xe0, 2, 0x80, 1, 1, 0x11, 0]),
    segment(0xda, [1, 1, 0, 0, 63, 0]),
    [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9],
  );
const dirty = () => jpeg([segment(0xe1, [...text("Exif\0\0"), ...text("GPSLatitude -23.55 iPhone")])]);
const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "photo-tests" },
      r2Buckets: { PHOTOS: "photo-tests-bucket" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  bucket = (await mf.getR2Bucket("PHOTOS")) as unknown as R2Bucket;
  await migrate(db, ALL_MIGRATIONS);
  const logins = ["client-2", "client-m", "client-p", "client-d", "client-o", "client-r"];
  const people = ["owner-a", "tech-a", "tech-a2", "commercial-a", "owner-b", "tech-b", "client-1", "mgr-1", ...logins];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    db.prepare("INSERT INTO users(id) VALUES ('owner-a'),('tech-a'),('tech-a2'),('commercial-a'),('owner-b'),('tech-b'),('client-1'),('mgr-1')"),
    ...logins.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
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
       ('st-2','org-a','Student Two'),('st-minor','org-a','Student Minor'),('st-b','org-b','Student B'),
       ('st-nologin','org-a','No Login'),('st-pending','org-a','Pending'),('st-declined','org-a','Declined'),
       ('st-old','org-a','Old Terms'),('st-race','org-a','Race')`,
    ),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),
       ('org-a','st-2','pro-a2'),('org-a','st-minor','pro-a'),('org-b','st-b','pro-b'),('org-a','st-nologin','pro-a'),
       ('org-a','st-pending','pro-a'),('org-a','st-declined','pro-a'),('org-a','st-old','pro-a'),('org-a','st-race','pro-a')`,
    ),
    db.prepare(
      `INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1'),
       ('org-a','st-2','client-2'),('org-a','st-minor','client-m'),('org-a','st-pending','client-p'),
       ('org-a','st-declined','client-d'),('org-a','st-old','client-o'),('org-a','st-race','client-r')`,
    ),
  ]);
  // What each student did when they joined: the authorization is theirs, recorded before any photo.
  const joined = new Date("2026-11-01T12:00:00Z");
  for (const login of ["client-1", "client-2", "client-m", "client-r"])
    await recordAcceptance(db, login, "STUDENT", { photosAuthorized: true, shownVersion: BASELINE_VERSION }, joined);
  await recordAcceptance(db, "client-d", "STUDENT", { photosAuthorized: false, shownVersion: BASELINE_VERSION }, joined);
  await db
    .prepare(
      `INSERT INTO consent_acceptances(id,user_id,audience,terms_version,terms_sha256,photos_authorized,accepted_at)
       VALUES ('old-acceptance','client-o','STUDENT','2026-01-01-rascunho-0',?1,1,'2026-01-01T12:00:00.000Z')`,
    )
    .bind("a".repeat(64))
    .run();
});
afterAll(async () => {
  await mf.dispose();
});

const photos = (user = "tech-a", org = "org-a") => assessmentPhotosFor(db, bucket, scope(user, org));
const objects = async () => (await bucket.list()).objects.map((o) => o.key).sort();
const rows = async (assessmentId?: string) =>
  (await db.prepare(`SELECT view, object_key AS key, size_bytes AS size FROM assessment_photos ${assessmentId ? "WHERE assessment_id = ?1" : ""} ORDER BY view`).bind(...(assessmentId ? [assessmentId] : [])).all<{ view: string; key: string; size: number }>()).results;
async function draftFor(student: string, user: string, when: Date) {
  const started = await withLegacy(db, scope(user)).startDraft(student, when);
  if (started.status !== "started") throw new Error(started.status);
  return started.id;
}
const read = async (assessmentId: string, view: string, user = "tech-a") => {
  const found = await photos(user).read(assessmentId, view);
  return found ? { studentId: found.studentId, bytes: new Uint8Array(await new Response(found.body as unknown as BodyInit).arrayBuffer()) } : null;
};

describe("storing, replacing, reading and removing a photo", () => {
  it("keeps the bytes in the private storage and only the index in the database, without metadata", async () => {
    const draft = await draftFor("st-1", "tech-a", day(10));
    expect(await photos().put(draft, "ANTERIOR", dirty(), day(10))).toEqual({ status: "stored", replaced: false });
    const [row] = await rows(draft);
    expect(row.key).toMatch(new RegExp(`^assessments/org-a/${draft}/[0-9a-f-]{36}\\.jpg$`));
    expect(await objects()).toEqual([row.key]);
    // What was stored is the cleaned file: no EXIF, no GPS, same picture.
    const stored = (await read(draft, "ANTERIOR"))!;
    expect(stored.studentId).toBe("st-1");
    expect(Buffer.from(stored.bytes).includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(Buffer.from(stored.bytes).includes(Buffer.from("JFIF"))).toBe(true);
    expect(row.size).toBe(stored.bytes.length);
    expect((await photos().list(draft)).map((p) => [p.view, p.width, p.height])).toEqual([["ANTERIOR", 640, 480]]);

    // Replacing swaps the object: the old one is gone, there is still one photo for the view.
    const before = row.key;
    expect(await photos().put(draft, "ANTERIOR", jpeg(), day(10))).toEqual({ status: "stored", replaced: true });
    const [after] = await rows(draft);
    expect(after.key).not.toBe(before);
    expect(await objects()).toEqual([after.key]);

    // Another view is another photo.
    expect(await photos().put(draft, "LATERAL_LEFT", jpeg(), day(10))).toEqual({ status: "stored", replaced: false });
    expect((await photos().list(draft)).map((p) => p.view)).toEqual(["ANTERIOR", "LATERAL_LEFT"]);

    // Removing drops the object and the row.
    expect(await photos().remove(draft, "ANTERIOR", day(10))).toEqual({ status: "removed" });
    expect(await photos().remove(draft, "ANTERIOR", day(10))).toEqual({ status: "not_found" });
    expect((await photos().list(draft)).map((p) => p.view)).toEqual(["LATERAL_LEFT"]);
    expect(await objects()).toHaveLength(1);
    expect(await read(draft, "ANTERIOR")).toBeNull();

    // Who, what and when are in the trail; the image and the key are not.
    const events = await db.prepare("SELECT action, actor_user_id AS actor, subject_id AS subject FROM access_audit_events WHERE action LIKE 'ASSESSMENT_PHOTO_%' ORDER BY rowid").all<{ action: string; actor: string; subject: string }>();
    expect(events.results.map((e) => e.action)).toEqual(["ASSESSMENT_PHOTO_ADDED", "ASSESSMENT_PHOTO_ADDED", "ASSESSMENT_PHOTO_ADDED", "ASSESSMENT_PHOTO_REMOVED"]);
    expect(events.results.every((e) => e.actor === "tech-a" && e.subject === draft)).toBe(true);
    expect(JSON.stringify(events.results)).not.toMatch(/assessments\/|jpg/);
  });

  it("refuses what is not a usable photo, in any view, and stores nothing", async () => {
    const draft = (await withLegacy(db, scope("tech-a")).listForStudent("st-1")).find((a) => a.state === "DRAFT")!.id;
    const before = { objects: await objects(), rows: await rows() };
    const reason = async (body: Uint8Array, view = "POSTERIOR") => {
      const result = await photos().put(draft, view, body, day(10));
      return result.status === "invalid" ? result.reason : result.status;
    };
    expect(await reason(png)).toBe("NOT_JPEG");
    expect(await reason(bytes(text("<script>alert(1)</script>")))).toBe("NOT_JPEG");
    expect(await reason(new Uint8Array(MAX_PHOTO_BYTES + 1))).toBe("TOO_LARGE");
    expect(await reason(jpeg().slice(0, 20))).toBe("TRUNCATED");
    expect(await reason(jpeg(), "TOP")).toBe("VIEW");
    expect(await reason(jpeg(), "../ANTERIOR")).toBe("VIEW");
    expect({ objects: await objects(), rows: await rows() }).toEqual(before);
  });

  it("accepts a photo of a student under 18 like any other (migration 0035: no age lock)", async () => {
    const minor = await draftFor("st-minor", "tech-a", day(11));
    await profilesFor(db, scope("tech-a")).save("st-minor", { birthDate: "2015-03-10" }, day(11));
    expect(await photos().put(minor, "ANTERIOR", jpeg(), day(11))).toEqual({ status: "stored", replaced: false });
    await profilesFor(db, scope("tech-a")).save("st-minor", {}, day(11));
    expect(await photos().put(minor, "POSTERIOR", jpeg(), day(11))).toEqual({ status: "stored", replaced: false });
  });
});

describe("no authorization of the student is needed (migration 0035)", () => {
  const linked = async (assessmentId: string, view = "ANTERIOR") =>
    (await db.prepare("SELECT consent_acceptance_id AS id FROM assessment_photos WHERE assessment_id = ?1 AND view = ?2").bind(assessmentId, view).first<{ id: string | null }>())?.id;

  it("stores the photo whatever the student did or did not accept, and links no acceptance to it", async () => {
    // No login, a login that has not accepted, an acceptance of an older text, a refusal of the photos.
    for (const student of ["st-nologin", "st-pending", "st-old", "st-declined"]) {
      const draft = await draftFor(student, "tech-a", day(10));
      expect(await photos().put(draft, "ANTERIOR", jpeg(), day(10)), student).toEqual({ status: "stored", replaced: false });
      expect(await linked(draft), student).toBeNull();
    }
  });

  it("keeps who uploaded it", async () => {
    const draft = await draftFor("st-race", "tech-a", day(10));
    expect(await photos().put(draft, "ANTERIOR", jpeg(), day(10))).toEqual({ status: "stored", replaced: false });
    expect((await db.prepare("SELECT consent_confirmed_by_user_id AS who FROM assessment_photos WHERE assessment_id = ?1").bind(draft).first<{ who: string }>())!.who).toBe("tech-a");
  });

  it("does not follow the student's acceptance or access: a withdrawal or a revoked login changes nothing", async () => {
    const draft = (await withLegacy(db, scope("tech-a")).listForStudent("st-race")).find((a) => a.state === "DRAFT")!.id;
    await recordAcceptance(db, "client-r", "STUDENT", { photosAuthorized: false, shownVersion: BASELINE_VERSION }, day(11));
    expect(await photos().put(draft, "POSTERIOR", jpeg(), day(11))).toEqual({ status: "stored", replaced: false });
    await db.prepare("UPDATE student_access SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE student_id = 'st-race'").run();
    expect(await photos().put(draft, "LATERAL_LEFT", jpeg(), day(13))).toEqual({ status: "stored", replaced: false });
    await db.prepare("UPDATE student_access SET revoked_at = NULL WHERE student_id = 'st-race'").run();
  });

  it("is not required by the database either: a row with no acceptance is accepted", async () => {
    const draft = (await withLegacy(db, scope("tech-a")).listForStudent("st-race")).find((a) => a.state === "DRAFT")!.id;
    await db.prepare("DELETE FROM assessment_photos WHERE assessment_id = ?1 AND view = 'ANTERIOR'").bind(draft).run();
    await db
      .prepare(
        `INSERT INTO assessment_photos(id,organization_id,assessment_id,view,object_key,content_type,size_bytes,width,height,consent_confirmed_by_user_id,created_at,consent_acceptance_id)
         VALUES (?1,'org-a',?2,'ANTERIOR','assessments/org-a/x/direct-key-0000000000.jpg','image/jpeg',10,10,10,'tech-a','2026-11-15T00:00:00.000Z',NULL)`,
      )
      .bind(crypto.randomUUID(), draft)
      .run();
    expect((await rows(draft)).filter((r) => r.view === "ANTERIOR")).toHaveLength(1);
  });
});

describe("who can reach a photo", () => {
  it("is refused, reading and writing, to anyone without an active technical assignment", async () => {
    const draft = (await withLegacy(db, scope("tech-a")).listForStudent("st-1")).find((a) => a.state === "DRAFT")!.id;
    const before = { objects: await objects(), rows: await rows(), audit: (await db.prepare("SELECT COUNT(*) AS n FROM access_audit_events").first<{ n: number }>())!.n };
    for (const [user, org] of [["tech-a2", "org-a"], ["owner-a", "org-a"], ["commercial-a", "org-a"], ["client-1", "org-a"], ["mgr-1", "org-a"], ["tech-b", "org-b"], ["tech-b", "org-a"], ["stranger", "org-a"]]) {
      const api = photos(user, org);
      expect(await api.list(draft), `${user}/${org} list`).toEqual([]);
      expect(await api.read(draft, "LATERAL_LEFT"), `${user}/${org} read`).toBeNull();
      expect(await api.put(draft, "ANTERIOR", jpeg(), day(12)), `${user}/${org} put`).toEqual({ status: "not_found" });
      expect(await api.remove(draft, "LATERAL_LEFT", day(12)), `${user}/${org} remove`).toEqual({ status: "not_found" });
    }
    expect({ objects: await objects(), rows: await rows(), audit: (await db.prepare("SELECT COUNT(*) AS n FROM access_audit_events").first<{ n: number }>())!.n }).toEqual(before);
    expect((await photos().list(draft)).map((p) => p.view)).toEqual(["LATERAL_LEFT"]);
  });

  it("ends with the assignment or the identity", async () => {
    const draft = (await withLegacy(db, scope("tech-a")).listForStudent("st-1")).find((a) => a.state === "DRAFT")!.id;
    await db.prepare("UPDATE care_assignments SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE student_id = 'st-1'").run();
    expect(await photos().list(draft)).toEqual([]);
    expect(await photos().read(draft, "LATERAL_LEFT")).toBeNull();
    await db.prepare("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'").run();
    await db.prepare("UPDATE users SET disabled_at = '2026-12-01T00:00:00.000Z' WHERE id = 'tech-a'").run();
    expect(await photos().read(draft, "LATERAL_LEFT")).toBeNull();
    expect(await photos().put(draft, "POSTERIOR", jpeg(), day(12))).toEqual({ status: "not_found" });
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'").run();
    expect(await photos().read(draft, "LATERAL_LEFT")).not.toBeNull();
  });
});

describe("a recorded assessment keeps its photos", () => {
  it("freezes them with the assessment, in the code and in the database, and still serves them", async () => {
    const draft = (await withLegacy(db, scope("tech-a")).listForStudent("st-1")).find((a) => a.state === "DRAFT")!.id;
    await withLegacy(db, scope("tech-a")).saveDraft(draft, { ...ALL_NO, assessedOn: "2026-11-10", chestPain: true }, day(12));
    expect(await withLegacy(db, scope("tech-a")).record(draft, { screeningAsked: true }, day(12))).toMatchObject({ status: "recorded" });
    const before = { objects: await objects(), rows: await rows(draft) };
    expect(await photos().put(draft, "ANTERIOR", jpeg(), day(13))).toEqual({ status: "not_found" });
    expect(await photos().put(draft, "LATERAL_LEFT", jpeg(), day(13))).toEqual({ status: "not_found" });
    expect({ objects: await objects(), rows: await rows(draft) }).toEqual(before);
    expect(await read(draft, "LATERAL_LEFT")).not.toBeNull();
    // Nobody without the assignment erases it.
    expect(await photos("tech-a2").remove(draft, "LATERAL_LEFT", day(13))).toEqual({ status: "not_found" });
    const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
    await expect(run("DELETE FROM assessment_photos WHERE assessment_id = ?1", draft)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(run("UPDATE assessment_photos SET view = 'POSTERIOR' WHERE assessment_id = ?1", draft)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(
      run("INSERT INTO assessment_photos(id,organization_id,assessment_id,view,object_key,content_type,size_bytes,width,height,consent_confirmed_by_user_id,created_at,consent_acceptance_id) VALUES ('late','org-a',?1,'POSTERIOR','assessments/org-a/x/late-key-0000000000.jpg','image/jpeg',10,10,10,'tech-a','2026-11-13T00:00:00.000Z',(SELECT id FROM consent_acceptances WHERE user_id = 'client-1' LIMIT 1))", draft),
    ).rejects.toThrow(/ASSESSMENT_FROZEN/);
    // The professional erases it without any request of the student (migration 0035): the file goes, the frozen row stays, and the photo is
    // shown as erased.
    const [frozen] = (await rows(draft)).filter((r) => r.view === "LATERAL_LEFT");
    expect(await photos().remove(draft, "LATERAL_LEFT", day(14))).toEqual({ status: "erased" });
    expect(await objects()).not.toContain(frozen.key);
    expect((await rows(draft)).map((r) => r.view)).toContain("LATERAL_LEFT");
    expect(await read(draft, "LATERAL_LEFT")).toBeNull();
    expect((await photos().list(draft)).find((p) => p.view === "LATERAL_LEFT")?.erasedAt).toBe(day(14).toISOString());
    expect(await db.prepare("SELECT request_id AS request, erased_by_user_id AS who FROM photo_erasures WHERE assessment_id = ?1").bind(draft).first()).toEqual({ request: null, who: "tech-a" });
    expect(await photos().remove(draft, "LATERAL_LEFT", day(14))).toEqual({ status: "not_found" });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = 'ASSESSMENT_PHOTO_ERASED' AND subject_id = ?1").bind(draft).first<{ n: number }>())!.n).toBe(1);
  });

  it("leaves no object behind when the assessment is recorded while the photo is being stored", async () => {
    const draft = await draftFor("st-2", "tech-a2", day(14));
    const before = await objects();
    let raced = false;
    const racing = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (property !== "batch") return typeof value === "function" ? value.bind(target) : value;
        return async (statements: Parameters<D1Database["batch"]>[0]) => {
          if (!raced) {
            raced = true;
            await withLegacy(db, scope("tech-a2")).saveDraft(draft, { ...ALL_NO, assessedOn: "2026-11-14" }, day(14));
            await withLegacy(db, scope("tech-a2")).record(draft, { screeningAsked: true }, day(14));
          }
          return target.batch(statements);
        };
      },
    });
    const result = await assessmentPhotosFor(racing, bucket, scope("tech-a2")).put(draft, "ANTERIOR", jpeg(), day(14));
    expect(raced).toBe(true);
    expect(result).toEqual({ status: "not_found" });
    expect(await objects()).toEqual(before);
    expect(await rows(draft)).toEqual([]);
  });
});

describe("discarding an open draft that has photos (decision of 03/11/2026: a draft of the earlier format can only be discarded)", () => {
  it("is refused while a photo is stored; once the photos are removed from the storage the draft goes, and nothing is left behind", async () => {
    const draft = await draftFor("st-1", "tech-a", day(20));
    expect(await photos().put(draft, "ANTERIOR", jpeg(), day(20))).toEqual({ status: "stored", replaced: false });
    const [stored] = await rows(draft);
    const repo = withLegacy(db, scope("tech-a"));
    expect(await withLegacy(db, scope("tech-a2")).discardDraft(draft)).toEqual({ status: "not_found" });
    expect(await repo.discardDraft(draft)).toEqual({ status: "photos_left" });
    expect((await repo.get(draft))?.state).toBe("DRAFT");
    // What the action does: remove each photo of the draft (object and row), then discard.
    for (const photo of await photos().list(draft)) expect(await photos().remove(draft, photo.view, day(20))).toEqual({ status: "removed" });
    expect(await repo.discardDraft(draft)).toEqual({ status: "discarded" });
    expect(await objects()).not.toContain(stored.key);
    expect(await rows(draft)).toEqual([]);
    expect(await repo.get(draft)).toBeNull();
  });

  it("goes even when a photo of it was erased on a request of the student (its erasure row references the draft)", async () => {
    const draft = await draftFor("st-1", "tech-a", day(21));
    expect(await photos().put(draft, "LATERAL_LEFT", jpeg(), day(21))).toEqual({ status: "stored", replaced: false });
    const [stored] = await rows(draft);
    const photoId = await db.prepare("SELECT id FROM assessment_photos WHERE assessment_id = ?1").bind(draft).first<string>("id");
    // What erasing on a request does to a draft's photo (data-requests): the bytes go, the erasure is recorded, the draft's photo row goes.
    await bucket.delete(stored.key);
    await db.batch([
      db
        .prepare(
          `INSERT INTO photo_erasures (photo_id, organization_id, assessment_id, view, request_id, erased_by_user_id, erased_at)
           SELECT p.id, p.organization_id, p.assessment_id, p.view, NULL, 'tech-a', ?2 FROM assessment_photos p WHERE p.id = ?1`,
        )
        .bind(photoId, day(21).toISOString()),
      db.prepare("DELETE FROM assessment_photos WHERE id = ?1").bind(photoId),
    ]);
    const repo = withLegacy(db, scope("tech-a"));
    expect(await withLegacy(db, scope("tech-a2")).discardDraft(draft)).toEqual({ status: "not_found" });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_erasures WHERE assessment_id = ?1").bind(draft).first("n")).toBe(1);
    expect(await repo.discardDraft(draft, day(21))).toEqual({ status: "discarded" });
    expect(await repo.get(draft)).toBeNull();
    expect(await db.prepare("SELECT COUNT(*) AS n FROM photo_erasures WHERE assessment_id = ?1").bind(draft).first("n")).toBe(0);
  });
});
