import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "@/modules/auth/factory";
import { handleAuthRequest } from "@/modules/auth/http";
import { identifierHash, recentSignInFailures } from "@/db/sign-in-failures";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";
import { secretOf, totpCode } from "./helpers/totp";

// Slice 0.88: failed sign-ins, through the real library on real local D1 and the same boundary the browser uses. Each request comes from
// its own address so the library's rate limit stays out of the way.
let mf: Miniflare;
let db: D1Database;
let auth: ReturnType<typeof createAuth>;
const origin = "https://trainer.example.test";
const secret = crypto.randomUUID() + crypto.randomUUID();
const password = "a-long-local-test-password";
let sequence = 0;
const email = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;

async function request(path: string, body: object, cookie = "") {
  return handleAuthRequest(
    auth,
    new Request(`${origin}/treinador/api/auth/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "cf-connecting-ip": `198.51.100.${(++sequence % 250) + 1}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
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
async function signUp(label: string, profile = true) {
  const address = email(label);
  const response = await request("sign-up/email", { email: address, password, name: "Pessoa Teste" });
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as { user: { id: string } };
  if (profile) await db.prepare("INSERT INTO users(id) VALUES (?1)").bind(user.id).run();
  return { id: user.id, address, cookie: jar("", response) };
}
const all = async () =>
  (await db.prepare("SELECT user_id AS userId, identifier_hash AS hash, reason FROM sign_in_failures ORDER BY created_at, rowid").all<{ userId: string | null; hash: string | null; reason: string }>()).results;
const of = async (userId: string) => (await all()).filter((row) => row.userId === userId).map((row) => row.reason);

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "sign-in-failures-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  auth = createAuth(db, { origin, secret, basePath: "/treinador" });
});
afterAll(async () => {
  await mf?.dispose();
});

describe("a wrong password", () => {
  it("names the person when the address is theirs, and the person reads it in Minha conta", async () => {
    const person = await signUp("known");
    expect((await request("sign-in/email", { email: person.address, password: "not-the-password-at-all" })).status).toBe(401);
    expect((await request("sign-in/email", { email: person.address.toUpperCase(), password: "still-not-the-password" })).status).toBe(401);
    expect(await of(person.id)).toEqual(["PASSWORD", "PASSWORD"]);
    const mine = await recentSignInFailures(db, person.id);
    expect(mine.map((row) => row.reason)).toEqual(["PASSWORD", "PASSWORD"]);
    expect(mine[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // A right password adds nothing.
    expect((await request("sign-in/email", { email: person.address, password })).status).toBe(200);
    expect(await of(person.id)).toHaveLength(2);
  });

  it("keeps only a keyed hash of an address with no account, or with no profile in the tool yet", async () => {
    const before = (await all()).length;
    const nobody = email("nobody");
    expect((await request("sign-in/email", { email: nobody, password: "whatever-password-here" })).status).toBe(401);
    const halfway = await signUp("halfway", false);
    expect((await request("sign-in/email", { email: halfway.address, password: "whatever-password-here" })).status).toBe(401);
    const added = (await all()).slice(before);
    expect(added).toEqual([
      { userId: null, hash: await identifierHash(secret, nobody), reason: "PASSWORD" },
      { userId: null, hash: await identifierHash(secret, halfway.address), reason: "PASSWORD" },
    ]);
    // The hash depends on the server's secret: the same address under another secret is another value.
    expect(await identifierHash("another-secret-of-at-least-32-characters", nobody)).not.toBe(added[0].hash);
    const stored = JSON.stringify((await db.prepare("SELECT * FROM sign_in_failures").all()).results);
    expect(stored).not.toContain("@example.test");
    expect(stored).not.toContain("whatever-password");
    expect(stored).not.toContain("198.51.100.");
  });
});

describe("a wrong code of the second step", () => {
  it("names the person who passed the password, for the authenticator and for a recovery code; a right code adds nothing", async () => {
    const person = await signUp("second");
    const enabled = await request("two-factor/enable", { password }, person.cookie);
    const setup = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
    const key = secretOf(setup.totpURI);
    // A wrong code while turning it on, already signed in, is not a sign-in.
    expect((await request("two-factor/verify-totp", { code: "000000" }, person.cookie)).status).toBe(401);
    expect((await request("two-factor/verify-totp", { code: totpCode(key) }, person.cookie)).status).toBe(200);
    expect(await of(person.id)).toEqual([]);

    const first = await request("sign-in/email", { email: person.address, password });
    const pending = jar("", first);
    expect(((await first.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    const wrong = totpCode(key) === "123456" ? "654321" : "123456";
    expect((await request("two-factor/verify-totp", { code: wrong }, pending)).status).toBe(401);
    expect((await request("two-factor/verify-backup-code", { code: "not-a-code" }, pending)).status).toBe(401);
    expect(await of(person.id)).toEqual(["SECOND_STEP_CODE", "SECOND_STEP_CODE"]);
    expect((await request("two-factor/verify-totp", { code: totpCode(key) }, pending)).status).toBe(200);
    expect(await of(person.id)).toHaveLength(2);
  });

  it("records a code tried while the library keeps the second step locked after many wrong ones", async () => {
    const person = await signUp("locked");
    const enabled = await request("two-factor/enable", { password }, person.cookie);
    const key = secretOf(((await enabled.json()) as { totpURI: string }).totpURI);
    expect((await request("two-factor/verify-totp", { code: totpCode(key) }, person.cookie)).status).toBe(200);
    const wrong = () => (totpCode(key) === "123456" ? "654321" : "123456");
    const statuses: number[] = [];
    for (let challenge = 0; challenge < 3; challenge++) {
      const pending = jar("", await request("sign-in/email", { email: person.address, password }));
      for (let attempt = 0; attempt < 4; attempt++) statuses.push((await request("two-factor/verify-totp", { code: wrong() }, pending)).status);
    }
    expect(statuses).toContain(429);
    const reasons = await of(person.id);
    expect(reasons.filter((reason) => reason === "SECOND_STEP_CODE").length).toBe(statuses.filter((status) => status === 401).length);
    expect(reasons.filter((reason) => reason === "SECOND_STEP_LOCKED").length).toBe(statuses.filter((status) => status === 429).length);
  });

  it("ties nothing to a pending sign-in left in the browser when the code is checked for a signed-in session", async () => {
    // Shared browser: A passes the password and stops at the code screen; B signs in on the same browser and types a wrong code while
    // turning the second step on. The library checks B's code and ignores A's cookie; no line may name A (or B).
    const first = await signUp("left-pending");
    const enabledA = await request("two-factor/enable", { password }, first.cookie);
    const keyA = secretOf(((await enabledA.json()) as { totpURI: string }).totpURI);
    expect((await request("two-factor/verify-totp", { code: totpCode(keyA) }, first.cookie)).status).toBe(200);
    const pendingA = jar("", await request("sign-in/email", { email: first.address, password }));
    const second = await signUp("same-browser");
    const shared = jar(pendingA, await request("sign-in/email", { email: second.address, password }));
    expect(shared).toContain("two_factor");
    const enabledB = await request("two-factor/enable", { password }, shared);
    const keyB = secretOf(((await enabledB.json()) as { totpURI: string }).totpURI);
    const wrong = totpCode(keyB) === "123456" ? "654321" : "123456";
    expect((await request("two-factor/verify-totp", { code: wrong }, shared)).status).toBe(401);
    expect(await of(first.id)).toEqual([]);
    expect(await of(second.id)).toEqual([]);
  });

  it("without the cookie of a pending sign-in, records nothing", async () => {
    const before = (await all()).length;
    expect((await request("two-factor/verify-totp", { code: "123456" })).status).toBe(401);
    expect((await all()).length).toBe(before);
  });
});

describe("the database", () => {
  it("refuses a row with neither person nor hash, or a reason it does not know", async () => {
    await expect(db.prepare("INSERT INTO sign_in_failures VALUES ('a', NULL, NULL, 'PASSWORD', '2026-11-03T00:00:00.000Z')").run()).rejects.toThrow();
    await expect(
      db.prepare(`INSERT INTO sign_in_failures VALUES ('b', NULL, '${"0".repeat(64)}', 'WRONG_SOMETHING', '2026-11-03T00:00:00.000Z')`).run(),
    ).rejects.toThrow();
    await expect(db.prepare("INSERT INTO sign_in_failures VALUES ('c', NULL, 'short', 'PASSWORD', '2026-11-03T00:00:00.000Z')").run()).rejects.toThrow();
  });
});
