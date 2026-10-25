import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentPhotosFor } from "@/db/assessment-photos";
import { assessmentsFor } from "@/db/assessments";
import { recordAcceptance } from "@/db/consent";
import { profilesFor } from "@/db/student-profile";
import { MAX_PHOTO_BYTES } from "@/modules/avaliacoes/photos";
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
    await recordAcceptance(db, login, "STUDENT", { photosAuthorized: true }, joined);
  await recordAcceptance(db, "client-d", "STUDENT", { photosAuthorized: false }, joined);
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
  const started = await assessmentsFor(db, scope(user)).startDraft(student, when);
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
    const draft = (await assessmentsFor(db, scope("tech-a")).listForStudent("st-1")).find((a) => a.state === "DRAFT")!.id;
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

  it("does not accept a photo of a student under 18, and accepts an adult or an unknown age", async () => {
    const minor = await draftFor("st-minor", "tech-a", day(11));
    await profilesFor(db, scope("tech-a")).save("st-minor", { birthDate: "2015-03-10" }, day(11));
    const before = await objects();
    expect(await photos().put(minor, "ANTERIOR", jpeg(), day(11))).toEqual({ status: "minor" });
    expect(await objects()).toEqual(before);
    // The day they turn 18 counts: the age is read on the day of the upload.
    await profilesFor(db, scope("tech-a")).save("st-minor", { birthDate: "2008-11-11" }, day(11));
    expect(await photos().put(minor, "ANTERIOR", jpeg(), day(11))).toEqual({ status: "stored", replaced: false });
    await profilesFor(db, scope("tech-a")).save("st-minor", { birthDate: "2008-11-12" }, day(11));
    expect(await photos().put(minor, "POSTERIOR", jpeg(), day(11))).toEqual({ status: "minor" });
    // No birth date on file: the product cannot know, so it does not block.
    await profilesFor(db, scope("tech-a")).save("st-minor", {}, day(11));
    expect(await photos().put(minor, "POSTERIOR", jpeg(), day(11))).toEqual({ status: "stored", replaced: false });
  });
});

describe("the student's own authorization", () => {
  const latestAcceptance = async (login: string) =>
    (await db.prepare("SELECT id FROM consent_acceptances WHERE user_id = ?1 AND audience = 'STUDENT' ORDER BY accepted_at DESC, rowid DESC LIMIT 1").bind(login).first<{ id: string }>())!.id;
  const linked = async (assessmentId: string, view = "ANTERIOR") =>
    (await db.prepare("SELECT consent_acceptance_id AS id FROM assessment_photos WHERE assessment_id = ?1 AND view = ?2").bind(assessmentId, view).first<{ id: string | null }>())?.id;

  it("accepts nothing without it, whatever the professional says, and says why", async () => {
    const before = { objects: await objects(), rows: await rows() };
    const cases: Array<[string, string]> = [
      ["st-nologin", "NO_LOGIN"], // no one to have authorized
      ["st-pending", "NOT_ACCEPTED"], // has a login that has not accepted yet
      ["st-old", "OUTDATED"], // accepted an older version of the text
      ["st-declined", "DECLINED"], // accepted, but did not authorize the photos
    ];
    for (const [student, reason] of cases) {
      const draft = await draftFor(student, "tech-a", day(10));
      expect(await photos().put(draft, "ANTERIOR", jpeg(), day(10)), student).toEqual({ status: "consent_required", reason });
    }
    expect({ objects: await objects(), rows: await rows() }).toEqual(before);
  });

  it("stores the photo with the id of the acceptance that authorized it", async () => {
    const draft = await draftFor("st-race", "tech-a", day(10));
    expect(await photos().put(draft, "ANTERIOR", jpeg(), day(10))).toEqual({ status: "stored", replaced: false });
    expect(await linked(draft)).toBe(await latestAcceptance("client-r"));
    expect((await db.prepare("SELECT consent_confirmed_by_user_id AS who FROM assessment_photos WHERE assessment_id = ?1").bind(draft).first<{ who: string }>())!.who).toBe("tech-a");
  });

  it("follows the latest acceptance: withdrawing closes the photos and authorizing again reopens them", async () => {
    const draft = (await assessmentsFor(db, scope("tech-a")).listForStudent("st-race")).find((a) => a.state === "DRAFT")!.id;
    const first = await latestAcceptance("client-r");
    await recordAcceptance(db, "client-r", "STUDENT", { photosAuthorized: false }, day(11));
    expect(await photos().put(draft, "POSTERIOR", jpeg(), day(11))).toEqual({ status: "consent_required", reason: "DECLINED" });
    // What was stored while it stood is kept, and still readable, until someone decides otherwise.
    expect(await read(draft, "ANTERIOR")).not.toBeNull();
    await recordAcceptance(db, "client-r", "STUDENT", { photosAuthorized: true }, day(12));
    expect(await photos().put(draft, "POSTERIOR", jpeg(), day(12))).toEqual({ status: "stored", replaced: false });
    expect(await linked(draft, "POSTERIOR")).toBe(await latestAcceptance("client-r"));
    expect(await linked(draft, "POSTERIOR")).not.toBe(first);
  });

  it("ends with the student's access: a revoked login authorizes nothing", async () => {
    const draft = (await assessmentsFor(db, scope("tech-a")).listForStudent("st-race")).find((a) => a.state === "DRAFT")!.id;
    await db.prepare("UPDATE student_access SET revoked_at = '2026-12-01T00:00:00.000Z' WHERE student_id = 'st-race'").run();
    expect(await photos().put(draft, "LATERAL_LEFT", jpeg(), day(13))).toEqual({ status: "consent_required", reason: "NO_LOGIN" });
    await db.prepare("UPDATE student_access SET revoked_at = NULL WHERE student_id = 'st-race'").run();
    expect(await photos().put(draft, "LATERAL_LEFT", jpeg(), day(13))).toEqual({ status: "stored", replaced: false });
  });

  it("leaves no object behind when the student withdraws while the photo is being stored", async () => {
    const draft = (await assessmentsFor(db, scope("tech-a")).listForStudent("st-race")).find((a) => a.state === "DRAFT")!.id;
    const before = { objects: await objects(), rows: await rows(draft) };
    let raced = false;
    const racing = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (property !== "batch") return typeof value === "function" ? value.bind(target) : value;
        return async (statements: Parameters<D1Database["batch"]>[0]) => {
          if (!raced) {
            raced = true;
            await recordAcceptance(db, "client-r", "STUDENT", { photosAuthorized: false }, day(14));
          }
          return target.batch(statements);
        };
      },
    });
    const result = await assessmentPhotosFor(racing, bucket, scope("tech-a")).put(draft, "LATERAL_RIGHT", jpeg(), day(14));
    expect(raced).toBe(true);
    expect(result).toEqual({ status: "consent_required", reason: "DECLINED" });
    expect({ objects: await objects(), rows: await rows(draft) }).toEqual(before);
    await recordAcceptance(db, "client-r", "STUDENT", { photosAuthorized: true }, day(15));
  });

  it("is also required by the database: no row without an acceptance that authorizes photos", async () => {
    const draft = (await assessmentsFor(db, scope("tech-a")).listForStudent("st-race")).find((a) => a.state === "DRAFT")!.id;
    const insert = (acceptanceId: string | null) =>
      db
        .prepare(
          `INSERT INTO assessment_photos(id,organization_id,assessment_id,view,object_key,content_type,size_bytes,width,height,consent_confirmed_by_user_id,created_at,consent_acceptance_id)
           VALUES (?1,'org-a',?2,'ANTERIOR','assessments/org-a/x/direct-key-0000000000.jpg','image/jpeg',10,10,10,'tech-a','2026-11-15T00:00:00.000Z',?3)`,
        )
        .bind(crypto.randomUUID(), draft, acceptanceId)
        .run();
    // The anterior view is taken, so a missing refusal would show as a different error: use a free key and view.
    await db.prepare("DELETE FROM assessment_photos WHERE assessment_id = ?1 AND view = 'ANTERIOR'").bind(draft).run();
    await expect(insert(null)).rejects.toThrow(/PHOTO_AUTHORIZATION_REQUIRED/);
    await expect(insert("no-such-acceptance")).rejects.toThrow(/PHOTO_AUTHORIZATION_REQUIRED|FOREIGN KEY/);
    await expect(insert(await latestAcceptance("client-d"))).rejects.toThrow(/PHOTO_AUTHORIZATION_REQUIRED/);
    // A professional's acceptance is not a student's authorization.
    await recordAcceptance(db, "owner-a", "PROFESSIONAL", { photosAuthorized: false }, day(15));
    const professional = (await db.prepare("SELECT id FROM consent_acceptances WHERE user_id = 'owner-a'").first<{ id: string }>())!.id;
    await expect(insert(professional)).rejects.toThrow(/PHOTO_AUTHORIZATION_REQUIRED/);
    expect(await rows(draft).then((all) => all.filter((r) => r.view === "ANTERIOR"))).toEqual([]);
  });
});

describe("who can reach a photo", () => {
  it("is refused, reading and writing, to anyone without an active technical assignment", async () => {
    const draft = (await assessmentsFor(db, scope("tech-a")).listForStudent("st-1")).find((a) => a.state === "DRAFT")!.id;
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
    const draft = (await assessmentsFor(db, scope("tech-a")).listForStudent("st-1")).find((a) => a.state === "DRAFT")!.id;
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
    const draft = (await assessmentsFor(db, scope("tech-a")).listForStudent("st-1")).find((a) => a.state === "DRAFT")!.id;
    await assessmentsFor(db, scope("tech-a")).saveDraft(draft, { assessedOn: "2026-11-10", chestPain: true }, day(12));
    expect(await assessmentsFor(db, scope("tech-a")).record(draft, { screeningAsked: true }, day(12))).toMatchObject({ status: "recorded" });
    const before = { objects: await objects(), rows: await rows(draft) };
    expect(await photos().put(draft, "ANTERIOR", jpeg(), day(13))).toEqual({ status: "not_found" });
    expect(await photos().put(draft, "LATERAL_LEFT", jpeg(), day(13))).toEqual({ status: "not_found" });
    expect(await photos().remove(draft, "LATERAL_LEFT", day(13))).toEqual({ status: "not_found" });
    expect({ objects: await objects(), rows: await rows(draft) }).toEqual(before);
    expect(await read(draft, "LATERAL_LEFT")).not.toBeNull();
    const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
    await expect(run("DELETE FROM assessment_photos WHERE assessment_id = ?1", draft)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(run("UPDATE assessment_photos SET view = 'POSTERIOR' WHERE assessment_id = ?1", draft)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(
      run("INSERT INTO assessment_photos(id,organization_id,assessment_id,view,object_key,content_type,size_bytes,width,height,consent_confirmed_by_user_id,created_at,consent_acceptance_id) VALUES ('late','org-a',?1,'POSTERIOR','assessments/org-a/x/late-key-0000000000.jpg','image/jpeg',10,10,10,'tech-a','2026-11-13T00:00:00.000Z',(SELECT id FROM consent_acceptances WHERE user_id = 'client-1' LIMIT 1))", draft),
    ).rejects.toThrow(/ASSESSMENT_FROZEN/);
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
            await assessmentsFor(db, scope("tech-a2")).saveDraft(draft, { assessedOn: "2026-11-14" }, day(14));
            await assessmentsFor(db, scope("tech-a2")).record(draft, { screeningAsked: true }, day(14));
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
