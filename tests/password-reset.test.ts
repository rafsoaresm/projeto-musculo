import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "@/modules/auth/factory";
import { handleAuthRequest } from "@/modules/auth/http";
import { createEmailService, MAX_PER_ADDRESS_PER_HOUR, MAX_PER_HOUR } from "@/modules/email/service";
import type { SesSettings } from "@/modules/email/config";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real Better Auth on real local D1 with the real migrations. The e-mail goes through the local
// "capture" transport, which keeps the text, so the test opens the link as a person would.
let mf: Miniflare;
let db: D1Database;
let auth: ReturnType<typeof createAuth>;
let closed: ReturnType<typeof createAuth>;
let clock = new Date("2026-11-01T10:00:00Z");
const origin = "https://trainer.example.test";
const password = "a-long-local-test-password";
const next = "another-long-local-password";
let sequence = 0;

async function request(instance: ReturnType<typeof createAuth>, path: string, body?: object, options: { cookie?: string; ip?: string } = {}) {
  return handleAuthRequest(
    instance,
    new Request(`${origin}/treinador/api/auth/${path}`, {
      method: body ? "POST" : "GET",
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
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
async function signUp(email: string) {
  const response = await request(auth, "sign-up/email", { email, password, name: "Pessoa Teste" });
  expect(response.status).toBe(200);
  return { id: ((await response.json()) as { user: { id: string } }).user.id, cookie: cookieOf(response) };
}
const messages = async (recipient: string) =>
  (await db.prepare("SELECT status, provider, error_code AS error, captured_text AS text, provider_message_id AS providerId FROM email_messages WHERE recipient = ?1 ORDER BY rowid").bind(recipient).all<{ status: string; provider: string; error: string | null; text: string | null; providerId: string | null }>()).results;
const tokenIn = (text: string) => decodeURIComponent(text.match(/redefinir-senha#token=([^\s]+)/)![1]);
const email = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "reset-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const sender = createEmailService(db, { transport: "capture", from: "capture@127.0.0.1.invalid" }, { now: () => clock });
  auth = createAuth(db, { origin, secret, basePath: "/treinador", email: sender });
  closed = createAuth(db, { origin, secret, basePath: "/treinador" });
});
afterAll(async () => {
  await mf?.dispose();
});

describe("without e-mail configured the recovery does not exist", () => {
  it("answers 404 to both endpoints and to the library's own callback, and sign-in still works", async () => {
    const address = email("closed");
    expect((await request(closed, "sign-up/email", { email: address, password, name: "Pessoa" })).status).toBe(200);
    expect((await request(closed, "request-password-reset", { email: address })).status).toBe(404);
    expect((await request(closed, "reset-password", { newPassword: next, token: "x".repeat(24) })).status).toBe(404);
    expect((await request(closed, "reset-password/abc?callbackURL=/")).status).toBe(404);
    expect((await request(closed, "sign-in/email", { email: address, password })).status).toBe(200);
    expect(await messages(address)).toEqual([]);
  });

  it("keeps the library's GET callback closed even when it is configured: the link goes to our own page", async () => {
    expect((await request(auth, "reset-password/abc?callbackURL=/entrar")).status).toBe(404);
  });
});

describe("asking for the link", () => {
  it("answers the same for an address with an account and one without, and only sends to the first", async () => {
    const known = email("known");
    await signUp(known);
    const withAccount = await request(auth, "request-password-reset", { email: known });
    const without = await request(auth, "request-password-reset", { email: email("nobody") });
    expect(withAccount.status).toBe(200);
    expect(without.status).toBe(withAccount.status);
    expect(await without.json()).toEqual(await withAccount.json());
    const sent = await messages(known);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ status: "SENT", provider: "capture", error: null });
    // The token is in the fragment: a browser does not send it to a server, so it is in no log.
    expect(sent[0].text).toContain(`${origin}/treinador/redefinir-senha#token=`);
    expect(sent[0].text).not.toContain("?token=");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM email_messages WHERE recipient LIKE 'nobody-%'").first<{ n: number }>())!.n).toBe(0);
    // A malformed address is a plain 400, not a reason to send anything.
    expect((await request(auth, "request-password-reset", { email: "not-an-address" })).status).toBe(400);
  });

  it("is limited per IP address, so one source cannot hammer the form", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await request(auth, "request-password-reset", { email: email("rate") }, { ip: "198.51.100.77" })).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });
});

describe("setting the new password", () => {
  it("works with the e-mailed link once, ends every session and records it", async () => {
    const address = email("reset");
    const person = await signUp(address);
    // A person who finished joining has a row in `users`, which is what the trail refers to.
    await db.prepare("INSERT INTO users(id) VALUES (?1)").bind(person.id).run();
    const second = await request(auth, "sign-in/email", { email: address, password });
    const secondCookie = cookieOf(second);
    expect(((await (await request(auth, "get-session", undefined, { cookie: person.cookie })).json()) as { user?: { id: string } } | null)?.user?.id).toBe(person.id);

    await request(auth, "request-password-reset", { email: address });
    const token = tokenIn((await messages(address))[0].text!);

    // Too short, and a token that was never issued: nothing changes.
    expect((await request(auth, "reset-password", { newPassword: "short", token })).status).toBe(400);
    expect((await request(auth, "reset-password", { newPassword: next, token: "a".repeat(24) })).status).toBe(400);
    expect((await request(auth, "sign-in/email", { email: address, password })).status).toBe(200);

    expect((await request(auth, "reset-password", { newPassword: next, token })).status).toBe(200);
    // Old password and old sessions are gone; the new password opens the account.
    expect((await request(auth, "sign-in/email", { email: address, password })).status).toBe(401);
    expect((await request(auth, "sign-in/email", { email: address, password: next })).status).toBe(200);
    for (const cookie of [person.cookie, secondCookie]) {
      const session = (await (await request(auth, "get-session", undefined, { cookie })).json()) as { user?: unknown } | null;
      expect(session?.user ?? null).toBeNull();
    }
    // The link cannot be used again.
    expect((await request(auth, "reset-password", { newPassword: "a-third-long-password", token })).status).toBe(400);
    expect((await request(auth, "sign-in/email", { email: address, password: "a-third-long-password" })).status).toBe(401);
    // And the event is in the trail, without the token.
    const trail = await db.prepare("SELECT organization_id AS org, actor_user_id AS actor, subject_id AS subject FROM access_audit_events WHERE action = 'PASSWORD_RESET_COMPLETED'").all<{ org: string | null; actor: string; subject: string }>();
    expect(trail.results).toEqual([{ org: null, actor: person.id, subject: person.id }]);
  });

  it("works for someone who signed up and has not finished joining, without a line in the trail", async () => {
    const address = email("unjoined");
    const person = await signUp(address);
    await request(auth, "request-password-reset", { email: address });
    const token = tokenIn((await messages(address))[0].text!);
    expect((await request(auth, "reset-password", { newPassword: next, token })).status).toBe(200);
    expect((await request(auth, "sign-in/email", { email: address, password: next })).status).toBe(200);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM access_audit_events WHERE subject_id = ?1").bind(person.id).first<{ n: number }>())!.n).toBe(0);
  });

  it("does not accept a link that expired", async () => {
    const address = email("expired");
    await signUp(address);
    await request(auth, "request-password-reset", { email: address });
    const token = tokenIn((await messages(address))[0].text!);
    await db.prepare("UPDATE auth_verification SET expires_at = ?1 WHERE identifier = ?2").bind(Date.now() - 1000, `reset-password:${token}`).run();
    expect((await request(auth, "reset-password", { newPassword: next, token })).status).toBe(400);
    expect((await request(auth, "sign-in/email", { email: address, password })).status).toBe(200);
  });

  it("is limited too, so a link cannot be guessed", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await request(auth, "reset-password", { newPassword: next, token: `guess-${i}`.padEnd(24, "x") }, { ip: "198.51.100.88" })).status);
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429, 429]);
  });
});

describe("the limit on the e-mail sent", () => {
  it("holds back the fourth e-mail to one address in an hour, and lets it through after the hour", async () => {
    const address = email("limited");
    await signUp(address);
    clock = new Date("2026-11-02T10:00:00Z");
    for (let i = 0; i < MAX_PER_ADDRESS_PER_HOUR + 2; i += 1) {
      expect((await request(auth, "request-password-reset", { email: address })).status).toBe(200);
      clock = new Date(clock.getTime() + 60_000);
    }
    expect((await messages(address)).map((row) => row.status)).toEqual(["SENT", "SENT", "SENT", "THROTTLED", "THROTTLED"]);
    // The held-back ones have no text: nothing was sent and nothing is kept.
    expect((await messages(address)).slice(3).every((row) => row.text === null)).toBe(true);
    clock = new Date("2026-11-02T11:30:00Z");
    expect((await request(auth, "request-password-reset", { email: address })).status).toBe(200);
    expect((await messages(address)).at(-1)?.status).toBe("SENT");
  });

  it("counts the address in lower case, however it is typed", async () => {
    const address = email("mixed");
    await signUp(address);
    clock = new Date("2026-11-03T10:00:00Z");
    for (const typed of [address.toUpperCase(), address, address.toUpperCase(), address]) {
      await request(auth, "request-password-reset", { email: typed });
      clock = new Date(clock.getTime() + 1000);
    }
    expect((await messages(address)).map((row) => row.status)).toEqual(["SENT", "SENT", "SENT", "THROTTLED"]);
  });

  it("holds back everything once the hour's total is reached, so a flood of addresses cannot spend the quota", async () => {
    clock = new Date("2026-11-04T10:00:00Z");
    const stamp = new Date(clock.getTime() - 60_000).toISOString();
    await db.batch(
      Array.from({ length: MAX_PER_HOUR }, (_, i) =>
        db.prepare("INSERT INTO email_messages (id, kind, recipient, status, provider, created_at) VALUES (?1, 'PASSWORD_RESET', ?2, 'SENT', 'ses', ?3)").bind(crypto.randomUUID(), `bulk-${i}@example.test`, stamp),
      ),
    );
    const address = email("flood");
    await signUp(address);
    expect((await request(auth, "request-password-reset", { email: address })).status).toBe(200);
    expect((await messages(address)).map((row) => row.status)).toEqual(["THROTTLED"]);
  });

  it("cannot be passed by requests made at the same moment", async () => {
    clock = new Date("2026-11-05T10:00:00Z");
    const address = email("parallel");
    const service = createEmailService(db, { transport: "capture", from: "capture@127.0.0.1.invalid" }, { now: () => clock });
    await Promise.all(Array.from({ length: 8 }, () => service.sendPasswordReset({ to: address, link: `${origin}/redefinir-senha#token=x` })));
    const rows = await messages(address);
    expect(rows.filter((row) => row.status === "SENT")).toHaveLength(MAX_PER_ADDRESS_PER_HOUR);
    expect(rows.filter((row) => row.status === "THROTTLED")).toHaveLength(8 - MAX_PER_ADDRESS_PER_HOUR);
  });
});

describe("through the real provider's transport", () => {
  const ses: SesSettings = {
    transport: "ses",
    region: "sa-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "a-secret-that-must-never-leave-the-worker-0123456789",
    from: "nao-responda@example.test",
  };

  it("records the provider's id and never the link, the token or the text", async () => {
    const address = email("ses");
    let body = "";
    const service = createEmailService(db, ses, {
      now: () => new Date("2026-11-06T10:00:00Z"),
      fetcher: (async (_url: string, init: RequestInit) => {
        body = init.body as string;
        return Response.json({ MessageId: "0100-real-looking-id" });
      }) as unknown as typeof fetch,
    });
    await service.sendPasswordReset({ to: address.toUpperCase(), link: `${origin}/redefinir-senha#token=SECRET-TOKEN` });
    const [row] = await messages(address);
    expect(row).toEqual({ status: "SENT", provider: "ses", error: null, text: null, providerId: "0100-real-looking-id" });
    expect(JSON.parse(body).Destination.ToAddresses).toEqual([address]);
    expect(body).toContain("SECRET-TOKEN");
    const everything = JSON.stringify((await db.prepare("SELECT * FROM email_messages WHERE recipient = ?1").bind(address).all()).results);
    expect(everything).not.toContain("SECRET-TOKEN");
    expect(everything).not.toContain(ses.secretAccessKey);
  });

  it("records a failure by its code, swallows it, and the person sees the same answer", async () => {
    const address = email("sesfail");
    const failing = createEmailService(db, ses, {
      now: () => new Date("2026-11-06T11:00:00Z"),
      fetcher: (async () => new Response("{}", { status: 400, headers: { "x-amzn-errortype": "MessageRejected" } })) as unknown as typeof fetch,
    });
    await expect(failing.sendPasswordReset({ to: address, link: `${origin}/redefinir-senha#token=t` })).resolves.toBeUndefined();
    expect(await messages(address)).toEqual([{ status: "FAILED", provider: "ses", error: "SES_400_MessageRejected", text: null, providerId: null }]);
    // A failure still counts toward the limit, so a broken provider is not hammered either.
    for (let i = 0; i < 4; i += 1) await failing.sendPasswordReset({ to: address, link: `${origin}/redefinir-senha#token=t` });
    expect((await messages(address)).map((row) => row.status)).toEqual(["FAILED", "FAILED", "FAILED", "THROTTLED", "THROTTLED"]);
  });

  it("is refused by the database when a text is kept for a provider that is not the local capture", async () => {
    await expect(
      db.prepare("INSERT INTO email_messages (id, kind, recipient, status, provider, captured_text, created_at) VALUES ('x', 'PASSWORD_RESET', 'a@example.test', 'SENT', 'ses', 'link', '2026-11-06T00:00:00.000Z')").run(),
    ).rejects.toThrow(/CHECK constraint/);
    await expect(
      db.prepare("INSERT INTO email_messages (id, kind, recipient, status, provider, created_at) VALUES ('y', 'PASSWORD_RESET', 'Upper@Example.test', 'SENT', 'ses', '2026-11-06T00:00:00.000Z')").run(),
    ).rejects.toThrow(/CHECK constraint/);
  });
});
