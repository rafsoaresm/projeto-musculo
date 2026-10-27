import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { createAuth } from "@/modules/auth/factory";
import { platformFor } from "@/db/platform";
import { AUTH_ENDPOINTS, handleAuthRequest } from "@/modules/auth/http";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";
import { base32Decode, secretOf, totpCode } from "./helpers/totp";

// Real Better Auth on real local D1 with the real migrations. The second step is exercised through the
// same boundary the browser uses (`handleAuthRequest`), and the codes are computed by a second
// implementation of the standard, not by the library under test.
let mf: Miniflare;
let db: D1Database;
let auth: ReturnType<typeof createAuth>;
const origin = "https://trainer.example.test";
const password = "a-long-local-test-password";
let sequence = 0;
const email = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;

async function request(path: string, body?: object, options: { cookie?: string; ip?: string; method?: string } = {}) {
  return handleAuthRequest(
    auth,
    new Request(`${origin}/treinador/api/auth/${path}`, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "cf-connecting-ip": options.ip ?? `192.0.2.${(++sequence % 250) + 1}`,
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
/** The cookies the browser would hold after a response, merged over the ones it already had. */
function jar(previous: string, response: Response): string {
  const held = new Map(previous.split("; ").filter(Boolean).map((pair) => [pair.split("=")[0], pair] as const));
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0];
    const [name, value] = [pair.split("=")[0], pair.slice(pair.indexOf("=") + 1)];
    if (value === "" || /max-age=0/i.test(header)) held.delete(name);
    else held.set(name, pair);
  }
  return [...held.values()].join("; ");
}
const json = async <T>(response: Response) => (await response.json()) as T;

async function signUp(label: string) {
  const address = email(label);
  const response = await request("sign-up/email", { email: address, password, name: "Pessoa Teste" });
  expect(response.status).toBe(200);
  const { user } = await json<{ user: { id: string } }>(response);
  // The domain row a signed-in person has, so the trail can name them.
  await db.prepare("INSERT INTO users(id) VALUES (?1)").bind(user.id).run();
  return { id: user.id, address, cookie: jar("", response) };
}
async function signIn(address: string, cookie = "") {
  const response = await request("sign-in/email", { email: address, password }, { cookie });
  return { response, cookie: jar(cookie, response), body: await json<{ twoFactorRedirect?: boolean; twoFactorMethods?: string[]; user?: { id: string } }>(response.clone()) };
}
/** Starts the setup and confirms it with a code: the account now has the second step. */
async function turnOn(person: { address: string; cookie: string }) {
  const enabled = await request("two-factor/enable", { password }, { cookie: person.cookie });
  expect(enabled.status).toBe(200);
  const setup = await json<{ totpURI: string; backupCodes: string[] }>(enabled);
  const secret = secretOf(setup.totpURI);
  const confirmed = await request("two-factor/verify-totp", { code: totpCode(secret) }, { cookie: person.cookie });
  expect(confirmed.status).toBe(200);
  return { secret, backupCodes: setup.backupCodes, cookie: jar(person.cookie, confirmed) };
}
const flag = async (id: string) => (await db.prepare("SELECT two_factor_enabled AS on_ FROM auth_user WHERE id = ?1").bind(id).first<{ on_: number }>())!.on_;
const trail = async (id: string) =>
  (await db.prepare("SELECT action, actor_user_id AS actor, subject_id AS subject FROM access_audit_events WHERE subject_id = ?1 AND action LIKE 'TWO_FACTOR%' ORDER BY created_at, rowid").bind(id).all<{ action: string; actor: string; subject: string }>()).results;
const sessions = async (id: string) => (await db.prepare("SELECT COUNT(*) AS n FROM auth_session WHERE user_id = ?1").bind(id).first<{ n: number }>())!.n;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "two-factor-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  auth = createAuth(db, { origin, secret: crypto.randomUUID() + crypto.randomUUID(), basePath: "/treinador" });
});
afterAll(async () => {
  await mf?.dispose();
});

describe("the helper that computes the codes", () => {
  it("agrees with the library's own implementation of the standard", async () => {
    const raw = "0123456789abcdefghijklmnopqrstuv";
    const base32 = new URL(createOTP(raw).url("Teste", "a@example.test")).searchParams.get("secret")!;
    expect(base32Decode(base32).toString("utf8")).toBe(raw);
    for (const at of [Date.UTC(2026, 10, 1, 12, 0, 0), Date.UTC(2026, 10, 1, 12, 0, 29), Date.UTC(2026, 10, 1, 12, 0, 30), Date.now()]) {
      const library = await createOTP(raw, { digits: 6, period: 30 }).hotp(Math.floor(at / 1000 / 30));
      expect(totpCode(base32, at)).toBe(library);
    }
    // RFC 6238, appendix B (SHA-1, "12345678901234567890"): the standard's own value at T = 59 s.
    const rfc = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpCode(rfc, 59_000, 30, 8)).toBe("94287082");
  });
});

describe("the doors that are open", () => {
  it("lists exactly the five routes of the second step the screens use", () => {
    const routes = [...AUTH_ENDPOINTS].filter((path) => path.startsWith("two-factor/")).sort();
    expect(routes).toEqual([
      "two-factor/disable",
      "two-factor/enable",
      "two-factor/generate-backup-codes",
      "two-factor/verify-backup-code",
      "two-factor/verify-totp",
    ]);
  });

  it("keeps the others closed: no code by e-mail or phone, no second reading of the secret", async () => {
    const person = await signUp("closed");
    for (const path of ["two-factor/send-otp", "two-factor/verify-otp", "two-factor/get-totp-uri", "two-factor/view-backup-codes", "totp/generate", "two-factor/generate-totp"]) {
      expect((await request(path, { password }, { cookie: person.cookie })).status, path).toBe(404);
    }
  });
});

describe("turning it on", () => {
  it("needs the session and the password, hands out ten recovery codes once, and counts only after a right code", async () => {
    const person = await signUp("on");
    expect((await request("two-factor/enable", { password })).status).toBe(401);
    expect((await request("two-factor/enable", { password: "not-the-password-at-all" }, { cookie: person.cookie })).status).toBe(400);
    expect(await flag(person.id)).toBe(0);

    const enabled = await request("two-factor/enable", { password }, { cookie: person.cookie });
    expect(enabled.status).toBe(200);
    const setup = await json<{ method: string; totpURI: string; backupCodes: string[] }>(enabled);
    expect(setup.method).toBe("totp");
    expect(setup.backupCodes).toHaveLength(10);
    expect(new Set(setup.backupCodes).size).toBe(10);
    expect(setup.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(new URL(setup.totpURI).searchParams.get("issuer")).toBe("Trainer Prescription");
    // Started is not on: the account still signs in with the password alone.
    expect(await flag(person.id)).toBe(0);
    expect((await signIn(person.address)).body.twoFactorRedirect).toBeUndefined();

    // A wrong code does not turn it on; the right one does, and the trail says so.
    const secret = secretOf(setup.totpURI);
    const wrong = String((Number(totpCode(secret)) + 1) % 1_000_000).padStart(6, "0");
    expect((await request("two-factor/verify-totp", { code: wrong }, { cookie: person.cookie })).status).toBe(401);
    expect(await flag(person.id)).toBe(0);
    expect((await request("two-factor/verify-totp", { code: totpCode(secret) }, { cookie: person.cookie })).status).toBe(200);
    expect(await flag(person.id)).toBe(1);
    expect(await trail(person.id)).toEqual([{ action: "TWO_FACTOR_ENABLED", actor: person.id, subject: person.id }]);
  });

  it("stores the secret and the recovery codes encrypted, never as the person saw them", async () => {
    const person = await signUp("stored");
    const enabled = await json<{ totpURI: string; backupCodes: string[] }>(await request("two-factor/enable", { password }, { cookie: person.cookie }));
    const row = (await db.prepare("SELECT secret, backup_codes AS codes FROM auth_two_factor WHERE user_id = ?1").bind(person.id).first<{ secret: string; codes: string }>())!;
    const base32 = secretOf(enabled.totpURI);
    expect(row.secret).not.toContain(base32);
    expect(row.secret).not.toContain(base32Decode(base32).toString("utf8"));
    for (const code of enabled.backupCodes) expect(row.codes).not.toContain(code);
  });
});

describe("signing in with it on", () => {
  it("gives no session after the password alone, and one after the right code", async () => {
    const person = await signUp("signin");
    const on = await turnOn(person);
    // Another browser.
    const first = await signIn(person.address);
    expect(first.response.status).toBe(200);
    expect(first.body.twoFactorRedirect).toBe(true);
    expect(first.body.twoFactorMethods).toEqual(["totp"]);
    expect(first.body.user).toBeUndefined();
    // The challenge is the only cookie it holds; there is no session cookie.
    expect(first.cookie).toContain("two_factor");
    expect(first.cookie).not.toContain("session_token");
    const before = await sessions(person.id);
    expect((await request("get-session", undefined, { cookie: first.cookie })).status).toBe(200);
    const asked = await request("get-session", undefined, { cookie: first.cookie });
    expect(await asked.text()).toMatch(/^(null)?$/);

    const verified = await request("two-factor/verify-totp", { code: totpCode(on.secret) }, { cookie: first.cookie });
    expect(verified.status).toBe(200);
    const cookie = jar(first.cookie, verified);
    expect(cookie).toContain("session_token");
    expect(cookie).not.toContain("two_factor=");
    const session = await json<{ user: { id: string } } | null>(await request("get-session", undefined, { cookie }));
    expect(session?.user.id).toBe(person.id);
    expect(await sessions(person.id)).toBe(before + 1);
  });

  it("refuses a wrong code, a code without the challenge, and a code that was already used", async () => {
    const person = await signUp("wrong");
    const on = await turnOn(person);
    const first = await signIn(person.address);
    const wrong = String((Number(totpCode(on.secret)) + 1) % 1_000_000).padStart(6, "0");
    const refused = await request("two-factor/verify-totp", { code: wrong }, { cookie: first.cookie });
    expect(refused.status).toBe(401);
    expect(jar(first.cookie, refused)).not.toContain("session_token");
    // Without the challenge cookie the right code is worth nothing.
    expect((await request("two-factor/verify-totp", { code: totpCode(on.secret) })).status).toBe(401);
    // The challenge still stands and takes the right code.
    expect((await request("two-factor/verify-totp", { code: totpCode(on.secret) }, { cookie: first.cookie })).status).toBe(200);
    // A challenge is used once: the same cookie cannot sign in a second time.
    expect((await request("two-factor/verify-totp", { code: totpCode(on.secret) }, { cookie: first.cookie })).status).toBe(401);
  });

  it("ends the challenge after a few wrong codes and then locks the account for a while", async () => {
    const person = await signUp("lock");
    const on = await turnOn(person);
    const wrong = String((Number(totpCode(on.secret)) + 7) % 1_000_000).padStart(6, "0");
    // Every request comes from its own address, so the per-address limiter is out of the way and what
    // answers is the account's own budget: ten wrong codes in a row, over any number of challenges.
    let lockedBy = "";
    let challengesEnded = 0;
    for (let round = 0; round < 8 && !lockedBy; round++) {
      const challenge = await signIn(person.address, "");
      for (let attempt = 0; attempt < 6 && !lockedBy; attempt++) {
        const response = await request("two-factor/verify-totp", { code: wrong }, { cookie: challenge.cookie, ip: `203.0.113.${(round * 10 + attempt) % 250}` });
        const body = await json<{ code?: string }>(response);
        if (response.status === 429 && body.code === "ACCOUNT_TEMPORARILY_LOCKED") lockedBy = body.code;
        else if (response.status === 400) {
          challengesEnded++;
          break;
        } else expect(response.status).toBe(401);
      }
    }
    // A challenge gives up after a few wrong codes, and the account locks after ten.
    expect(challengesEnded).toBeGreaterThan(0);
    expect(lockedBy).toBe("ACCOUNT_TEMPORARILY_LOCKED");
    // Locked means the right code does not work either, for now, and no session comes out of it.
    const challenge = await signIn(person.address, "");
    const locked = await request("two-factor/verify-totp", { code: totpCode(on.secret) }, { cookie: challenge.cookie, ip: "203.0.113.251" });
    expect(locked.status).toBe(429);
    expect(jar(challenge.cookie, locked)).not.toContain("session_token");
    const row = (await db.prepare("SELECT failed_verification_count AS failed, locked_until AS until FROM auth_two_factor WHERE user_id = ?1").bind(person.id).first<{ failed: number; until: number }>())!;
    expect(row.failed).toBeGreaterThanOrEqual(10);
    expect(row.until).toBeGreaterThan(Date.now());
    // It lets go after fifteen minutes: the same account, a quarter of an hour later, with the right code.
    await db.prepare("UPDATE auth_two_factor SET locked_until = ?2 WHERE user_id = ?1").bind(person.id, Date.now() - 1000).run();
    const later = await signIn(person.address, "");
    expect((await request("two-factor/verify-totp", { code: totpCode(on.secret) }, { cookie: later.cookie, ip: "203.0.113.252" })).status).toBe(200);
  });
});

describe("the recovery codes", () => {
  it("each works once, signs in, and is gone afterwards", async () => {
    const person = await signUp("backup");
    const on = await turnOn(person);
    const code = on.backupCodes[0];
    const first = await signIn(person.address);
    const used = await request("two-factor/verify-backup-code", { code }, { cookie: first.cookie });
    expect(used.status).toBe(200);
    expect(jar(first.cookie, used)).toContain("session_token");
    const second = await signIn(person.address);
    expect((await request("two-factor/verify-backup-code", { code }, { cookie: second.cookie })).status).toBe(401);
    // Another one still works.
    const third = await signIn(person.address);
    expect((await request("two-factor/verify-backup-code", { code: on.backupCodes[1] }, { cookie: third.cookie })).status).toBe(200);
  });

  it("are renewed with the password, which retires every old one", async () => {
    const person = await signUp("renew");
    const on = await turnOn(person);
    expect((await request("two-factor/generate-backup-codes", { password: "not-the-password-at-all" }, { cookie: on.cookie })).status).toBe(400);
    const renewed = await request("two-factor/generate-backup-codes", { password }, { cookie: on.cookie });
    expect(renewed.status).toBe(200);
    const { backupCodes } = await json<{ backupCodes: string[] }>(renewed);
    expect(backupCodes).toHaveLength(10);
    const challenge = await signIn(person.address);
    expect((await request("two-factor/verify-backup-code", { code: on.backupCodes[2] }, { cookie: challenge.cookie })).status).toBe(401);
    const again = await signIn(person.address);
    expect((await request("two-factor/verify-backup-code", { code: backupCodes[0] }, { cookie: again.cookie })).status).toBe(200);
  });
});

describe("turning it off", () => {
  it("needs the password, removes the secrets, ends the challenge for the next sign-in and leaves a trail", async () => {
    const person = await signUp("off");
    const on = await turnOn(person);
    expect((await request("two-factor/disable", { password: "not-the-password-at-all" }, { cookie: on.cookie })).status).toBe(400);
    expect(await flag(person.id)).toBe(1);
    const disabled = await request("two-factor/disable", { password }, { cookie: on.cookie });
    expect(disabled.status).toBe(200);
    expect(await flag(person.id)).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM auth_two_factor WHERE user_id = ?1").bind(person.id).first<{ n: number }>())!.n).toBe(0);
    expect((await signIn(person.address)).body.twoFactorRedirect).toBeUndefined();
    expect((await trail(person.id)).map((row) => row.action)).toEqual(["TWO_FACTOR_ENABLED", "TWO_FACTOR_DISABLED"]);
  });

  it("needs a session of the person: nobody else's code or session turns it off", async () => {
    const owner = await signUp("owner");
    const other = await signUp("other");
    await turnOn(owner);
    expect((await request("two-factor/disable", { password })).status).toBe(401);
    // Another account's session with the right password (its own) does not touch the first account.
    await request("two-factor/disable", { password }, { cookie: other.cookie });
    expect(await flag(owner.id)).toBe(1);
  });
});

describe("a manager resets the second step of someone who lost the phone and the codes", () => {
  const manager = (id: string) => platformFor(db, { userId: id });
  async function grant(id: string, options: { admin?: boolean; member?: boolean } = {}) {
    if (options.admin) await db.prepare("INSERT INTO platform_admins(user_id) VALUES (?1)").bind(id).run();
    if (options.member) {
      await db.prepare("INSERT OR IGNORE INTO organizations(id,name) VALUES ('org-r','Studio R')").run();
      await db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-r',?1,'OWNER')").bind(id).run();
    }
  }
  const secrets = async (id: string) => (await db.prepare("SELECT COUNT(*) AS n FROM auth_two_factor WHERE user_id = ?1").bind(id).first<{ n: number }>())!.n;
  const resetTrail = async (subject: string) =>
    (await db.prepare("SELECT actor_user_id AS actor, action FROM access_audit_events WHERE subject_id = ?1 AND action = 'PLATFORM_TWO_FACTOR_RESET'").bind(subject).all<{ actor: string; action: string }>()).results;

  it("turns it off, deletes the secrets, ends every session and leaves two lines: the person's state and who did it", async () => {
    const boss = await signUp("boss");
    await grant(boss.id, { admin: true });
    const member = await signUp("member");
    await grant(member.id, { member: true });
    const on = await turnOn(member);
    // Two more sessions, from other places, each one through the code.
    for (let place = 0; place < 2; place++) {
      const challenge = await signIn(member.address);
      expect((await request("two-factor/verify-totp", { code: totpCode(on.secret) }, { cookie: challenge.cookie })).status).toBe(200);
    }
    expect(await sessions(member.id)).toBeGreaterThan(2);

    expect(await manager(boss.id).resetTwoFactor(member.id)).toBe(true);
    expect(await flag(member.id)).toBe(0);
    expect(await secrets(member.id)).toBe(0);
    expect(await sessions(member.id)).toBe(0);
    expect(await resetTrail(member.id)).toEqual([{ actor: boss.id, action: "PLATFORM_TWO_FACTOR_RESET" }]);
    expect((await trail(member.id)).map((row) => row.action)).toEqual(["TWO_FACTOR_ENABLED", "TWO_FACTOR_DISABLED"]);
    // The old session no longer works, and the person comes back with the password alone.
    const gone = await request("get-session", undefined, { cookie: on.cookie });
    expect(await gone.text()).toMatch(/^(null)?$/);
    const back = await signIn(member.address);
    expect(back.body.twoFactorRedirect).toBeUndefined();
    expect(back.cookie).toContain("session_token");
    // And may start the second step again, with a new secret.
    const again = await turnOn({ address: member.address, cookie: back.cookie });
    expect(again.secret).not.toBe(on.secret);
  });

  it("works for another manager, and nothing is written for the one who asked", async () => {
    const boss = await signUp("boss2");
    const peer = await signUp("peer");
    await grant(boss.id, { admin: true });
    await grant(peer.id, { admin: true });
    await turnOn(peer);
    expect(await manager(boss.id).resetTwoFactor(peer.id)).toBe(true);
    expect(await flag(peer.id)).toBe(0);
    expect(await resetTrail(peer.id)).toHaveLength(1);
  });

  it("refuses oneself, a person who belongs to no organization, a person without the second step, and writes nothing", async () => {
    const boss = await signUp("boss3");
    await grant(boss.id, { admin: true });
    await turnOn(boss);
    const student = await signUp("student");
    await turnOn(student); // somehow on, but belongs to no organization and is no manager
    const plain = await signUp("plain");
    await grant(plain.id, { member: true });

    expect(await manager(boss.id).resetTwoFactor(boss.id)).toBe(false);
    expect(await flag(boss.id)).toBe(1);
    expect(await manager(boss.id).resetTwoFactor(student.id)).toBe(false);
    expect(await flag(student.id)).toBe(1);
    expect(await secrets(student.id)).toBe(1);
    expect(await sessions(student.id)).toBeGreaterThan(0);
    // Not turned on: nothing to reset, and no line saying it was.
    expect(await manager(boss.id).resetTwoFactor(plain.id)).toBe(false);
    expect(await resetTrail(plain.id)).toHaveLength(0);
    expect(await resetTrail(boss.id)).toHaveLength(0);
    expect(await resetTrail(student.id)).toHaveLength(0);
  });

  it("refuses everyone who is not an active manager, and leaves the person signed in", async () => {
    const victim = await signUp("victim");
    await grant(victim.id, { member: true });
    await turnOn(victim);
    const colleague = await signUp("colleague");
    await grant(colleague.id, { member: true });
    const former = await signUp("former");
    await grant(former.id, { admin: true });
    await db.prepare("UPDATE platform_admins SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?1").bind(former.id).run();
    const blocked = await signUp("blockedboss");
    await grant(blocked.id, { admin: true });
    await db.prepare("UPDATE users SET disabled_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1").bind(blocked.id).run();

    const sessionsBefore = await sessions(victim.id);
    for (const who of [colleague.id, former.id, blocked.id, victim.id, "nobody"]) {
      expect(await manager(who).resetTwoFactor(victim.id), who).toBe(false);
    }
    expect(await flag(victim.id)).toBe(1);
    expect(await secrets(victim.id)).toBe(1);
    expect(await sessions(victim.id)).toBe(sessionsBefore);
    expect(await resetTrail(victim.id)).toHaveLength(0);
  });
});
