import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountAccessFor } from "@/db/account-access";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration, triggers included. Sessions are rows, as the authentication
// library writes them; the person and the session making the request are what the server derives
// from the verified cookie.
let mf: Miniflare;
let db: D1Database;
const NOW = new Date("2026-10-27T12:00:00.000Z");
const HOUR = 3_600_000;
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";

async function session(id: string, userId: string, enteredAt: number, expiresAt = NOW.getTime() + 24 * HOUR, userAgent: string | null = CHROME) {
  await db
    .prepare(
      `INSERT INTO auth_session(id, token, user_id, expires_at, created_at, updated_at, ip_address, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, '203.0.113.7', ?6)`,
    )
    .bind(id, `token-of-${id}`, userId, expiresAt, enteredAt, userAgent)
    .run();
}
const trail = async (userId: string, action?: string) =>
  (
    await db
      .prepare(`SELECT action, actor_user_id AS actor, subject_id AS subject, organization_id AS org FROM access_audit_events
                WHERE actor_user_id = ?1 AND (?2 IS NULL OR action = ?2) ORDER BY created_at, id`)
      .bind(userId, action ?? null)
      .all<{ action: string; actor: string; subject: string; org: string | null }>()
  ).results;
const sessionsOf = async (userId: string) =>
  (await db.prepare("SELECT id FROM auth_session WHERE user_id = ? ORDER BY id").bind(userId).all<{ id: string }>()).results.map((r) => r.id);

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "account-access-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["ana", "bia", "blocked", "no-profile"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    db.prepare("INSERT INTO users(id) VALUES ('ana'),('bia')"),
    db.prepare("INSERT INTO users(id, disabled_at) VALUES ('blocked', '2026-10-01T00:00:00.000Z')"),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("the trail of sign-ins is written by the database", () => {
  it("leaves one line per session created: who and when, nothing about where or with what", async () => {
    await session("ana-s1", "ana", NOW.getTime() - 5 * HOUR);
    await session("ana-s2", "ana", NOW.getTime() - 3 * HOUR, undefined, IPHONE);
    const lines = await trail("ana", "SIGN_IN");
    expect(lines).toEqual([
      { action: "SIGN_IN", actor: "ana", subject: "ana", org: null },
      { action: "SIGN_IN", actor: "ana", subject: "ana", org: null },
    ]);
    const stored = JSON.stringify(
      (await db.prepare("SELECT * FROM access_audit_events WHERE actor_user_id = 'ana'").all()).results,
    );
    expect(stored).not.toContain("203.0.113.7");
    expect(stored).not.toContain("Chrome");
    expect(stored).not.toContain("token-of");
  });
  it("leaves none for a session made before the person has a profile in the tool, and does not fail the sign-up", async () => {
    await session("np-s1", "no-profile", NOW.getTime());
    expect(await trail("no-profile")).toEqual([]);
    expect(await sessionsOf("no-profile")).toEqual(["np-s1"]);
  });
  it("does not write a line when a session is only renewed", async () => {
    const before = (await trail("ana", "SIGN_IN")).length;
    await db.prepare("UPDATE auth_session SET updated_at = ?1, expires_at = expires_at + ?1 WHERE id = 'ana-s1'").bind(HOUR).run();
    expect((await trail("ana", "SIGN_IN")).length).toBe(before);
  });
});

describe("where the account is open", () => {
  it("lists only the person's own, still valid, newest first, with the current one marked", async () => {
    await session("ana-old", "ana", NOW.getTime() - 400 * HOUR, NOW.getTime() - 1000);
    await session("bia-s1", "bia", NOW.getTime() - HOUR);
    const devices = await accountAccessFor(db, "ana", "ana-s2").devices(NOW);
    expect(devices.map((d) => d.id)).toEqual(["ana-s2", "ana-s1"]);
    expect(devices.map((d) => d.isCurrent)).toEqual([true, false]);
    expect(devices.map((d) => d.label)).toEqual(["Safari em iPhone", "Chrome em Windows"]);
    expect(devices[0].enteredAt).toBe(new Date(NOW.getTime() - 3 * HOUR).toISOString());
  });
  it("hands out neither the token, nor the address, nor the raw header", async () => {
    const devices = await accountAccessFor(db, "ana", "ana-s1").devices(NOW);
    const text = JSON.stringify(devices);
    expect(text).not.toContain("token-of");
    expect(text).not.toContain("203.0.113.7");
    expect(text).not.toContain("Mozilla");
    expect(Object.keys(devices[0]).sort()).toEqual(["enteredAt", "expiresAt", "id", "isCurrent", "label"]);
  });
  it("reads the latest sign-ins of the person only, newest first, within the limit", async () => {
    const mine = await accountAccessFor(db, "ana", "ana-s1").recentSignIns(10);
    expect(mine).toHaveLength(3);
    expect([...mine].sort().reverse()).toEqual(mine);
    expect(await accountAccessFor(db, "ana", "ana-s1").recentSignIns(2)).toHaveLength(2);
    expect(await accountAccessFor(db, "bia", "bia-s1").recentSignIns(10)).toHaveLength(1);
    expect(await accountAccessFor(db, "no-profile", "np-s1").recentSignIns(10)).toEqual([]);
  });
  it("needs a verified person and session", () => {
    expect(() => accountAccessFor(db, "", "x")).toThrow();
    expect(() => accountAccessFor(db, "ana", "")).toThrow();
  });
});

describe("disconnecting one device", () => {
  it("removes that session, leaves the others, and writes one line saying who did it", async () => {
    await session("ana-s3", "ana", NOW.getTime() - HOUR);
    expect(await accountAccessFor(db, "ana", "ana-s2").disconnect("ana-s3", NOW)).toBe(true);
    expect(await sessionsOf("ana")).toEqual(["ana-old", "ana-s1", "ana-s2"]);
    expect(await trail("ana", "DEVICE_DISCONNECTED")).toEqual([
      { action: "DEVICE_DISCONNECTED", actor: "ana", subject: "ana", org: null },
    ]);
  });
  it("does not remove the session that is making the request, and writes nothing", async () => {
    expect(await accountAccessFor(db, "ana", "ana-s2").disconnect("ana-s2", NOW)).toBe(false);
    expect(await sessionsOf("ana")).toContain("ana-s2");
    expect((await trail("ana", "DEVICE_DISCONNECTED")).length).toBe(1);
  });
  it("does not remove somebody else's session, even knowing its id, and writes nothing", async () => {
    expect(await accountAccessFor(db, "ana", "ana-s2").disconnect("bia-s1", NOW)).toBe(false);
    expect(await accountAccessFor(db, "bia", "bia-s1").disconnect("ana-s1", NOW)).toBe(false);
    expect(await sessionsOf("bia")).toEqual(["bia-s1"]);
    expect(await sessionsOf("ana")).toContain("ana-s1");
    expect((await trail("bia", "DEVICE_DISCONNECTED")).length).toBe(0);
  });
  it("says no for a session that is already gone, and again for the same one", async () => {
    expect(await accountAccessFor(db, "ana", "ana-s2").disconnect("ana-s3", NOW)).toBe(false);
    expect(await accountAccessFor(db, "ana", "ana-s2").disconnect("nao-existe", NOW)).toBe(false);
    expect((await trail("ana", "DEVICE_DISCONNECTED")).length).toBe(1);
  });
  it("is refused to a blocked login", async () => {
    await session("blocked-s1", "blocked", NOW.getTime() - HOUR);
    await session("blocked-s2", "blocked", NOW.getTime() - 2 * HOUR);
    expect(await accountAccessFor(db, "blocked", "blocked-s1").disconnect("blocked-s2", NOW)).toBe(false);
    expect(await sessionsOf("blocked")).toEqual(["blocked-s1", "blocked-s2"]);
  });
});
