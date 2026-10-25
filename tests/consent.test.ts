import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasCurrentAcceptance, latestAcceptance, recordAcceptance, studentConsentFor } from "@/db/consent";
import { TERMS_VERSION, termsHash } from "@/modules/consentimento/terms";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const NOW = new Date("2026-11-12T15:00:00.000Z");
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
const rows = async (user: string, audience?: string) =>
  (
    await db
      .prepare(`SELECT COUNT(*) AS n FROM consent_acceptances WHERE user_id = ?1 AND (?2 IS NULL OR audience = ?2)`)
      .bind(user, audience ?? null)
      .first<{ n: number }>()
  )!.n;
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const insert = (user: string, audience: string, version: string, sha: string, photos: number, at: string) =>
  run(
    `INSERT INTO consent_acceptances (id, user_id, audience, terms_version, terms_sha256, photos_authorized, accepted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    crypto.randomUUID(), user, audience, version, sha, photos, at,
  );

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "consent-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "tech-a", "tech-a2", "owner-b", "tech-b", "login-1", "login-2", "login-off", "mgr-1", "blocked"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    db.prepare("INSERT INTO users(id) VALUES ('owner-a'),('tech-a'),('tech-a2'),('owner-b'),('tech-b'),('login-1'),('login-2'),('login-off'),('mgr-1'),('blocked')"),
    db.prepare("UPDATE users SET disabled_at = '2026-11-01T00:00:00.000Z' WHERE id = 'blocked'"),
    db.prepare("INSERT INTO platform_admins(user_id) VALUES ('mgr-1')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES
       ('org-a','owner-a','OWNER'),('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),
       ('org-b','owner-b','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner-a','org-a','owner-a','Owner A'),('pro-a','org-a','tech-a','Pro A'),('pro-a2','org-a','tech-a2','Pro A2'),
       ('pro-owner-b','org-b','owner-b','Owner B'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare(
      "INSERT INTO students(id,organization_id,display_name) VALUES ('st-none','org-a','No login'),('st-1','org-a','Student One'),('st-2','org-a','Student Two'),('st-off','org-a','Student Off'),('st-b','org-b','Student B')",
    ),
    db.prepare(
      "INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-none','pro-a'),('org-a','st-1','pro-a'),('org-a','st-2','pro-a'),('org-a','st-off','pro-a'),('org-b','st-b','pro-b')",
    ),
    db.prepare(
      "INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','login-1'),('org-a','st-2','login-2'),('org-a','st-off','login-off')",
    ),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("recording the acceptance", () => {
  it("records it once, with the version and the hash of the exact words, and asking again changes nothing", async () => {
    expect(await recordAcceptance(db, "login-1", "STUDENT", { photosAuthorized: true }, NOW)).toEqual({ status: "accepted" });
    expect(await recordAcceptance(db, "login-1", "STUDENT", { photosAuthorized: true }, later(1))).toEqual({ status: "already" });
    expect(await rows("login-1")).toBe(1);
    expect(await latestAcceptance(db, "login-1", "STUDENT")).toEqual({
      version: TERMS_VERSION,
      sha256: await termsHash("STUDENT"),
      photosAuthorized: true,
      acceptedAt: NOW.toISOString(),
    });
    expect(await hasCurrentAcceptance(db, "login-1", "STUDENT")).toBe(true);
  });

  it("keeps the log: a different choice is a new row and the latest row is the state", async () => {
    expect(await recordAcceptance(db, "login-1", "STUDENT", { photosAuthorized: false }, later(2))).toEqual({ status: "accepted" });
    expect((await latestAcceptance(db, "login-1", "STUDENT"))!.photosAuthorized).toBe(false);
    expect(await recordAcceptance(db, "login-1", "STUDENT", { photosAuthorized: true }, later(3))).toEqual({ status: "accepted" });
    expect((await latestAcceptance(db, "login-1", "STUDENT"))!.photosAuthorized).toBe(true);
    expect(await rows("login-1")).toBe(3);
  });

  it("keeps the audiences apart", async () => {
    expect(await hasCurrentAcceptance(db, "login-1", "PROFESSIONAL")).toBe(false);
    expect(await recordAcceptance(db, "owner-a", "PROFESSIONAL", { photosAuthorized: false }, NOW)).toEqual({ status: "accepted" });
    expect(await hasCurrentAcceptance(db, "owner-a", "PROFESSIONAL")).toBe(true);
    expect(await hasCurrentAcceptance(db, "owner-a", "STUDENT")).toBe(false);
  });

  it("stores the photos choice only for a student, whatever was asked", async () => {
    await recordAcceptance(db, "tech-a", "PROFESSIONAL", { photosAuthorized: true }, NOW);
    expect((await latestAcceptance(db, "tech-a", "PROFESSIONAL"))!.photosAuthorized).toBe(false);
    // The database says the same for a direct write.
    await expect(insert("tech-a2", "PROFESSIONAL", TERMS_VERSION, "a".repeat(64), 1, NOW.toISOString())).rejects.toThrow();
  });

  it("is not current when it is of another version or of other words, until the person accepts again", async () => {
    const sha = await termsHash("STUDENT");
    await insert("login-2", "STUDENT", "2020-01-01-antiga", sha, 0, NOW.toISOString());
    expect(await hasCurrentAcceptance(db, "login-2", "STUDENT")).toBe(false);
    await insert("login-2", "STUDENT", TERMS_VERSION, "b".repeat(64), 0, later(1).toISOString());
    expect(await hasCurrentAcceptance(db, "login-2", "STUDENT")).toBe(false);
    expect(await recordAcceptance(db, "login-2", "STUDENT", { photosAuthorized: false }, later(2))).toEqual({ status: "accepted" });
    expect(await hasCurrentAcceptance(db, "login-2", "STUDENT")).toBe(true);
  });

  it("accepts a person who has an account but no row of their own yet, and refuses one with no account", async () => {
    await db.batch([
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES ('fresh','fresh','fresh@example.test',0,0)"),
    ]);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'fresh'").first<{ n: number }>())!.n).toBe(0);
    expect(await recordAcceptance(db, "fresh", "PROFESSIONAL", { photosAuthorized: false }, NOW)).toEqual({ status: "accepted" });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'fresh'").first<{ n: number }>())!.n).toBe(1);
    expect(await hasCurrentAcceptance(db, "fresh", "PROFESSIONAL")).toBe(true);
    // No account, no acceptance: nothing is invented for an id that is not a verified login.
    expect(await recordAcceptance(db, "ghost", "STUDENT", { photosAuthorized: false }, NOW)).toEqual({ status: "refused" });
    expect(await rows("ghost")).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'ghost'").first<{ n: number }>())!.n).toBe(0);
  });

  it("refuses a blocked login, a blank one, and never reads a stranger as accepted", async () => {
    expect(await recordAcceptance(db, "blocked", "STUDENT", { photosAuthorized: false }, NOW)).toEqual({ status: "refused" });
    expect(await rows("blocked")).toBe(0);
    for (const blank of ["", "  "]) {
      expect(await recordAcceptance(db, blank, "STUDENT", { photosAuthorized: false }, NOW)).toEqual({ status: "refused" });
      expect(await hasCurrentAcceptance(db, blank, "STUDENT")).toBe(false);
    }
    expect(await hasCurrentAcceptance(db, "stranger", "STUDENT")).toBe(false);
  });

  it("only grows, and rejects malformed rows", async () => {
    await expect(run("UPDATE consent_acceptances SET photos_authorized = 0 WHERE user_id = 'login-1'")).rejects.toThrow(/CONSENT_APPEND_ONLY/);
    await expect(run("DELETE FROM consent_acceptances WHERE user_id = 'login-1'")).rejects.toThrow(/CONSENT_APPEND_ONLY/);
    const ok = "c".repeat(64);
    await expect(insert("login-off", "OTHER", TERMS_VERSION, ok, 0, NOW.toISOString())).rejects.toThrow();
    await expect(insert("login-off", "STUDENT", TERMS_VERSION, "short", 0, NOW.toISOString())).rejects.toThrow();
    await expect(insert("login-off", "STUDENT", TERMS_VERSION, "G".repeat(64), 0, NOW.toISOString())).rejects.toThrow();
    await expect(insert("login-off", "STUDENT", "", ok, 0, NOW.toISOString())).rejects.toThrow();
    await expect(insert("login-off", "STUDENT", TERMS_VERSION, ok, 2, NOW.toISOString())).rejects.toThrow();
    await expect(insert("nobody", "STUDENT", TERMS_VERSION, ok, 0, NOW.toISOString())).rejects.toThrow();
  });
});

describe("what the professional may know of the student's acceptance", () => {
  it("is nothing for anyone without an active technical assignment over the student", async () => {
    for (const [user, org] of [
      ["tech-a2", "org-a"], ["owner-a", "org-a"], ["login-1", "org-a"], ["mgr-1", "org-a"],
      ["tech-b", "org-b"], ["tech-b", "org-a"], ["stranger", "org-a"],
    ])
      expect(await studentConsentFor(db, scope(user, org), "st-1"), user).toBeNull();
    expect(await studentConsentFor(db, scope("tech-a", "org-b"), "st-1")).toBeNull();
    await expect(studentConsentFor(db, null, "st-1")).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });

  it("tells a student with no login from one who has not accepted from one who has", async () => {
    const pro = scope("tech-a");
    expect(await studentConsentFor(db, pro, "st-none")).toEqual({
      hasLogin: false, accepted: false, current: false, photosAuthorized: false, acceptedAt: null,
    });
    // st-off has a login that never accepted.
    expect(await studentConsentFor(db, pro, "st-off")).toMatchObject({ hasLogin: true, accepted: false, current: false });
    // st-1 accepted, with the photos, in the version in force.
    expect(await studentConsentFor(db, pro, "st-1")).toEqual({
      hasLogin: true, accepted: true, current: true, photosAuthorized: true, acceptedAt: later(3).toISOString(),
    });
  });

  it("reads an older version as not current, and loses the login with the link", async () => {
    const pro = scope("tech-a");
    await insert("login-off", "STUDENT", "2020-01-01-antiga", "d".repeat(64), 1, NOW.toISOString());
    expect(await studentConsentFor(db, pro, "st-off")).toMatchObject({ accepted: true, current: false, photosAuthorized: true });
    await run("UPDATE student_access SET revoked_at = '2026-11-12T00:00:00.000Z' WHERE user_id = 'login-off'");
    expect(await studentConsentFor(db, pro, "st-off")).toMatchObject({ hasLogin: false, accepted: false });
    await run("UPDATE care_assignments SET revoked_at = '2026-11-12T00:00:00.000Z' WHERE student_id = 'st-1'");
    expect(await studentConsentFor(db, pro, "st-1")).toBeNull();
  });
});
