import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { createAuth } from "@/modules/auth/factory";
import { handleAuthRequest } from "@/modules/auth/http";
import { isPlatformAdmin } from "@/db/platform";
import {
  MANAGER_RECOVERY_ATTEMPTS,
  MANAGER_RECOVERY_WINDOW_SECONDS,
  recoverLastManagerPassword,
  recoverLastManagerTwoFactor,
  type ManagerPasswordRecoveryInput,
  type ManagerRecoveryInput,
} from "@/db/manager-recovery";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";
import { secretOf, totpCode } from "./helpers/totp";

// The last manager without the phone and the codes (slice 0.89, PENDENCIAS B16/B2). Real Better Auth on real local D1 with
// the real migrations: the accounts, the passwords and the second step are made by the library, and the recovery checks the
// password with the library's own hash check. Its own database: "the only active manager" is a fact about the whole platform.
let mf: Miniflare;
let db: D1Database;
let auth: ReturnType<typeof createAuth>;
const origin = "https://trainer.example.test";
const password = "a-long-local-test-password";
const token = "t".repeat(16) + crypto.randomUUID();
let sequence = 0;
const email = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;
const address = () => `198.51.100.${(++sequence % 250) + 1}`;

async function request(path: string, body?: object, cookie = "") {
  return handleAuthRequest(
    auth,
    new Request(`${origin}/api/auth/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "cf-connecting-ip": address(),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
const cookiesOf = (response: Response, previous = "") =>
  [previous, ...response.headers.getSetCookie().map((header) => header.split(";")[0])].filter(Boolean).join("; ");

async function person(label: string, options: { manager?: boolean; secondStep?: boolean } = {}) {
  const mail = email(label);
  const signedUp = await request("sign-up/email", { email: mail, password, name: `Pessoa ${label}` });
  expect(signedUp.status).toBe(200);
  const { user } = (await signedUp.json()) as { user: { id: string } };
  await db.prepare("INSERT INTO users(id) VALUES (?1)").bind(user.id).run();
  if (options.manager) await db.prepare("INSERT INTO platform_admins(user_id) VALUES (?1)").bind(user.id).run();
  let secret = "";
  if (options.secondStep) {
    const cookie = cookiesOf(signedUp);
    const enabled = await request("two-factor/enable", { password }, cookie);
    secret = secretOf(((await enabled.json()) as { totpURI: string }).totpURI);
    expect((await request("two-factor/verify-totp", { code: totpCode(secret) }, cookie)).status).toBe(200);
  }
  return { id: user.id, email: mail, secret };
}
const recover = (input: Partial<ManagerRecoveryInput>) =>
  recoverLastManagerTwoFactor(db, {
    email: "",
    password,
    supplied: token,
    configured: token,
    address: address(),
    verifyPassword,
    ...input,
  });
const state = async (id: string) => ({
  flag: (await db.prepare("SELECT two_factor_enabled AS v FROM auth_user WHERE id = ?1").bind(id).first<{ v: number }>())!.v,
  secrets: (await db.prepare("SELECT COUNT(*) AS n FROM auth_two_factor WHERE user_id = ?1").bind(id).first<{ n: number }>())!.n,
  sessions: (await db.prepare("SELECT COUNT(*) AS n FROM auth_session WHERE user_id = ?1").bind(id).first<{ n: number }>())!.n,
});
const recoveredTrail = async (id: string) =>
  (
    await db
      .prepare("SELECT actor_user_id AS actor, subject_id AS subject FROM access_audit_events WHERE subject_id = ?1 AND action = 'PLATFORM_TWO_FACTOR_RECOVERED'")
      .bind(id)
      .all<{ actor: string; subject: string }>()
  ).results;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "manager-recovery-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  auth = createAuth(db, { origin, secret: crypto.randomUUID() + crypto.randomUUID(), basePath: "" });
});
afterAll(async () => {
  await mf?.dispose();
});
// Every scenario starts with no active manager on the platform; each makes the ones it needs.
beforeEach(async () => {
  await db.prepare("UPDATE platform_admins SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE revoked_at IS NULL").run();
});

describe("the last manager recovers with the environment secret", () => {
  it("turns off only the second step, ends every session, keeps the role and the password, and leaves a line", async () => {
    const last = await person("last", { manager: true, secondStep: true });
    // The library gave no session after the password: the code screen is where the person is stuck.
    const stuck = await request("sign-in/email", { email: last.email, password });
    expect(((await stuck.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    expect((await state(last.id)).sessions).toBeGreaterThan(0); // the one from the sign-up

    expect(await recover({ email: `  ${last.email.toUpperCase()} ` })).toBe("reset");
    expect(await state(last.id)).toEqual({ flag: 0, secrets: 0, sessions: 0 });
    expect(await recoveredTrail(last.id)).toEqual([{ actor: last.id, subject: last.id }]);
    const disabled = await db
      .prepare("SELECT COUNT(*) AS n FROM access_audit_events WHERE subject_id = ?1 AND action = 'TWO_FACTOR_DISABLED'")
      .bind(last.id)
      .first<{ n: number }>();
    expect(disabled!.n).toBe(1);
    expect(await isPlatformAdmin(db, last.id)).toBe(true);

    // Back with the same password alone, straight to a session.
    const back = await request("sign-in/email", { email: last.email, password });
    expect(back.status).toBe(200);
    expect(((await back.clone().json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeUndefined();
    expect(cookiesOf(back)).toContain("session_token");

    // Nothing left to reset: a second try changes nothing and writes nothing.
    expect(await recover({ email: last.email })).toBe("not_applicable");
    expect(await recoveredTrail(last.id)).toHaveLength(1);
  });

  it("is refused while another active manager exists, who can reset it in Gestor > Gestores", async () => {
    const stuck = await person("stuck", { manager: true, secondStep: true });
    const peer = await person("peer", { manager: true });
    expect(await recover({ email: stuck.email })).toBe("other_manager");
    expect(await state(stuck.id)).toMatchObject({ flag: 1, secrets: 1 });
    expect(await recoveredTrail(stuck.id)).toHaveLength(0);

    // A blocked or ended manager does not count as someone who could do it.
    await db.prepare("UPDATE users SET disabled_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1").bind(peer.id).run();
    expect(await recover({ email: stuck.email })).toBe("reset");
    expect((await state(stuck.id)).flag).toBe(0);
  });

  it("refuses an account that is not an active manager with the second step on, and writes nothing", async () => {
    const professional = await person("pro", { secondStep: true });
    await db.prepare("INSERT OR IGNORE INTO organizations(id,name) VALUES ('org-m','Studio M')").run();
    await db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-m',?1,'OWNER')").bind(professional.id).run();
    expect(await recover({ email: professional.email })).toBe("not_applicable");
    expect((await state(professional.id)).flag).toBe(1);

    const ended = await person("ended", { manager: true, secondStep: true });
    await db.prepare("UPDATE platform_admins SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?1").bind(ended.id).run();
    expect(await recover({ email: ended.email })).toBe("not_applicable");
    expect((await state(ended.id)).flag).toBe(1);

    const blocked = await person("blocked", { manager: true, secondStep: true });
    await db.prepare("UPDATE users SET disabled_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1").bind(blocked.id).run();
    expect(await recover({ email: blocked.email })).toBe("not_applicable");
    expect((await state(blocked.id)).flag).toBe(1);
    await db.prepare("UPDATE platform_admins SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?1").bind(blocked.id).run();

    const plain = await person("plain", { manager: true });
    expect(await recover({ email: plain.email })).toBe("not_applicable");
    for (const who of [professional, ended, blocked, plain]) expect(await recoveredTrail(who.id)).toHaveLength(0);
  });

  it("needs the secret, the right password of that account, and a configured secret", async () => {
    const last = await person("guarded", { manager: true, secondStep: true });
    expect(await recover({ email: last.email, configured: undefined })).toBe("unavailable");
    expect(await recover({ email: last.email, configured: "short", supplied: "short" })).toBe("unavailable");
    expect(await recover({ email: last.email, supplied: "x".repeat(40) })).toBe("invalid_token");
    expect(await recover({ email: last.email, supplied: undefined })).toBe("invalid_token");
    expect(await recover({ email: last.email, password: "not-the-password-of-it" })).toBe("invalid_credentials");
    expect(await recover({ email: email("nobody") })).toBe("invalid_credentials");
    expect(await recover({ email: last.email, password: 42 })).toBe("invalid_credentials");
    expect(await state(last.id)).toMatchObject({ flag: 1, secrets: 1 });
    expect(await recoveredTrail(last.id)).toHaveLength(0);
  });

  it("counts every attempt per address, even with the right secret, and lets the address try again after the window", async () => {
    const last = await person("limited", { manager: true, secondStep: true });
    const from = address();
    const now = new Date("2026-11-03T12:00:00.000Z");
    for (let attempt = 0; attempt < MANAGER_RECOVERY_ATTEMPTS; attempt++)
      expect(await recover({ email: last.email, supplied: "y".repeat(40), address: from, now })).toBe("invalid_token");
    expect(await recover({ email: last.email, address: from, now })).toBe("rate_limited");
    expect((await state(last.id)).flag).toBe(1);
    // Without the edge's address, everyone shares one bucket rather than going unlimited.
    for (let attempt = 0; attempt < MANAGER_RECOVERY_ATTEMPTS; attempt++)
      await recover({ email: last.email, supplied: "y".repeat(40), address: null, now });
    expect(await recover({ email: last.email, address: null, now })).toBe("rate_limited");

    const later = new Date(now.getTime() + MANAGER_RECOVERY_WINDOW_SECONDS * 1000);
    expect(await recover({ email: last.email, address: from, now: later })).toBe("reset");
  });
});

// The last manager forgot the PASSWORD (slice 0.101.1): same secret, same "only active manager" rule, a new password.
const freshPassword = "another-long-local-password";
const recoverPassword = (input: Partial<ManagerPasswordRecoveryInput>) =>
  recoverLastManagerPassword(db, {
    email: "",
    newPassword: freshPassword,
    confirmation: freshPassword,
    supplied: token,
    configured: token,
    address: address(),
    hashPassword,
    ...input,
  });
const passwordTrail = async (id: string) =>
  (
    await db
      .prepare("SELECT actor_user_id AS actor, subject_id AS subject FROM access_audit_events WHERE subject_id = ?1 AND action = 'PLATFORM_PASSWORD_RECOVERED'")
      .bind(id)
      .all<{ actor: string; subject: string }>()
  ).results;
const signIn = (mail: string, pass: string) => request("sign-in/email", { email: mail, password: pass });

describe("the last manager sets a new password with the environment secret", () => {
  it("changes only the password: the old one stops working, the new one signs in, sessions end, role and e-mail stay, a line is left", async () => {
    const last = await person("forgot", { manager: true });
    expect((await signIn(last.email, password)).status).toBe(200);
    expect((await state(last.id)).sessions).toBeGreaterThan(0);

    expect(await recoverPassword({ email: `  ${last.email.toUpperCase()} ` })).toBe("reset");
    expect((await state(last.id)).sessions).toBe(0);
    expect(await passwordTrail(last.id)).toEqual([{ actor: last.id, subject: last.id }]);
    expect(await isPlatformAdmin(db, last.id)).toBe(true);
    const mail = await db.prepare("SELECT email FROM auth_user WHERE id = ?1").bind(last.id).first<{ email: string }>();
    expect(mail!.email).toBe(last.email);

    expect((await signIn(last.email, password)).status).not.toBe(200);
    const back = await signIn(last.email, freshPassword);
    expect(back.status).toBe(200);
    expect(cookiesOf(back)).toContain("session_token");
  });

  it("leaves the second step as it was: a manager with the app still needs the code after the new password", async () => {
    const last = await person("forgot-2fa", { manager: true, secondStep: true });
    expect(await recoverPassword({ email: last.email })).toBe("reset");
    expect((await state(last.id)).flag).toBe(1);
    const back = await signIn(last.email, freshPassword);
    expect(((await back.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  });

  it("is refused while another active manager exists, and works once that one is blocked", async () => {
    const stuck = await person("stuck-pw", { manager: true });
    const peer = await person("peer-pw", { manager: true });
    expect(await recoverPassword({ email: stuck.email })).toBe("other_manager");
    expect((await signIn(stuck.email, password)).status).toBe(200);
    expect(await passwordTrail(stuck.id)).toHaveLength(0);

    await db.prepare("UPDATE users SET disabled_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1").bind(peer.id).run();
    expect(await recoverPassword({ email: stuck.email })).toBe("reset");
  });

  it("refuses anyone who is not an active manager, and an unknown e-mail, and writes nothing", async () => {
    const professional = await person("pro-pw");
    await db.prepare("INSERT OR IGNORE INTO organizations(id,name) VALUES ('org-pw','Studio PW')").run();
    await db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-pw',?1,'OWNER')").bind(professional.id).run();
    expect(await recoverPassword({ email: professional.email })).toBe("not_applicable");
    expect((await signIn(professional.email, password)).status).toBe(200);

    const ended = await person("ended-pw", { manager: true });
    await db.prepare("UPDATE platform_admins SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?1").bind(ended.id).run();
    expect(await recoverPassword({ email: ended.email })).toBe("not_applicable");

    const blocked = await person("blocked-pw", { manager: true });
    await db.prepare("UPDATE users SET disabled_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1").bind(blocked.id).run();
    expect(await recoverPassword({ email: blocked.email })).toBe("not_applicable");
    await db.prepare("UPDATE platform_admins SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?1").bind(blocked.id).run();

    expect(await recoverPassword({ email: email("nobody-pw") })).toBe("not_applicable");
    for (const who of [professional, ended, blocked]) expect(await passwordTrail(who.id)).toHaveLength(0);
  });

  it("needs the secret, a configured secret, and a valid new password typed twice", async () => {
    const last = await person("guarded-pw", { manager: true });
    expect(await recoverPassword({ email: last.email, configured: undefined })).toBe("unavailable");
    expect(await recoverPassword({ email: last.email, configured: "short", supplied: "short" })).toBe("unavailable");
    expect(await recoverPassword({ email: last.email, supplied: "x".repeat(40) })).toBe("invalid_token");
    expect(await recoverPassword({ email: last.email, supplied: undefined })).toBe("invalid_token");
    expect(await recoverPassword({ email: "" })).toBe("invalid_input");
    expect(await recoverPassword({ email: last.email, newPassword: "short", confirmation: "short" })).toBe("invalid_input");
    expect(await recoverPassword({ email: last.email, newPassword: "x".repeat(129), confirmation: "x".repeat(129) })).toBe("invalid_input");
    expect(await recoverPassword({ email: last.email, confirmation: "a-different-long-password" })).toBe("invalid_input");
    expect(await recoverPassword({ email: last.email, newPassword: 42, confirmation: 42 })).toBe("invalid_input");
    expect((await signIn(last.email, password)).status).toBe(200);
    expect(await passwordTrail(last.id)).toHaveLength(0);
  });

  it("counts every attempt per address in its own bucket, apart from the second-step recovery", async () => {
    const last = await person("limited-pw", { manager: true });
    const from = address();
    const now = new Date("2026-11-07T12:00:00.000Z");
    for (let attempt = 0; attempt < MANAGER_RECOVERY_ATTEMPTS; attempt++)
      expect(await recoverPassword({ email: last.email, supplied: "y".repeat(40), address: from, now })).toBe("invalid_token");
    expect(await recoverPassword({ email: last.email, address: from, now })).toBe("rate_limited");
    // The second-step recovery from the same address is a different bucket.
    expect(await recover({ email: last.email, supplied: "y".repeat(40), address: from, now })).toBe("invalid_token");

    const later = new Date(now.getTime() + MANAGER_RECOVERY_WINDOW_SECONDS * 1000);
    expect(await recoverPassword({ email: last.email, address: from, now: later })).toBe("reset");
  });
});
