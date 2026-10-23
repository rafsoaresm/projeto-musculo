import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "@/modules/auth/factory";
import { handleAuthRequest } from "@/modules/auth/http";
import { provisionWorkspace, workspaceFor } from "@/db/workspaces";
import { createStudent } from "@/db/create-student";
import { studentsFor } from "@/db/students";

let mf: Miniflare;
let db: D1Database;
let auth: ReturnType<typeof createAuth>;
const origin = "https://trainer.example.test";
const password = "a-long-local-test-password";
let sequence = 0;
async function request(
  path: string,
  body?: object,
  cookie?: string,
  requestOrigin = origin,
) {
  return handleAuthRequest(
    auth,
    new Request(`${origin}/treinador/api/auth/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: requestOrigin,
        "cf-connecting-ip": `192.0.2.${(++sequence % 250) + 1}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
async function account() {
  const email = `${crypto.randomUUID()}@example.test`;
  const response = await request("sign-up/email", {
    email,
    password,
    name: "Profissional Teste",
  });
  expect(response.status).toBe(200);
  const data = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  expect(cookie).toContain("trainer.session_token");
  return { id: data.user.id, cookie, email };
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "identity-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  for (const file of [
    "0001_foundation.sql",
    "0002_identity_and_onboarding.sql",
  ]) {
    const sql = await readFile(
      new URL(`../migrations/${file}`, import.meta.url),
      "utf8",
    );
    await db.batch(
      sql
        .replace(/^--.*$/gm, "")
        .split(";")
        .filter((s) => s.trim())
        .map((s) => db.prepare(s)),
    );
  }
  auth = createAuth(db, {
    origin,
    secret: crypto.randomUUID() + crypto.randomUUID(),
    basePath: "/treinador",
  });
});
afterAll(async () => {
  await mf?.dispose();
});

describe("Real authentication and atomic native SQLite onboarding", () => {
  it("hashes passwords, issues scoped secure HttpOnly cookies and validates a session", async () => {
    const response = await request("sign-up/email", {
      email: "cookies@example.test",
      password,
      name: "Teste",
    });
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.includes("session_token"))!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/treinador");
    expect(cookie).toContain("SameSite=Lax");
    const stored = await db
      .prepare("SELECT password FROM auth_account LIMIT 1")
      .first<{ password: string }>();
    expect(stored?.password).not.toBe(password);
    const session = await (
      await request("get-session", undefined, cookie.split(";")[0])
    ).json();
    expect(session.user.email).toBe("cookies@example.test");
  });
  it("rejects wrong passwords and forged cookies", async () => {
    const user = await account();
    expect(
      (
        await request("sign-in/email", {
          email: user.email,
          password: "wrong-password",
        })
      ).status,
    ).toBe(401);
    expect(
      await (
        await request(
          "get-session",
          undefined,
          "__Secure-trainer.session_token=forged",
        )
      ).json(),
    ).toBeNull();
  });
  it("expires sessions against database time and rejects a replay after logout", async () => {
    const user = await account();
    await db
      .prepare("UPDATE auth_session SET expires_at = ? WHERE user_id = ?")
      .bind(Date.now() - 1000, user.id)
      .run();
    expect(
      await (await request("get-session", undefined, user.cookie)).json(),
    ).toBeNull();
    const another = await account();
    expect((await request("sign-out", {}, another.cookie)).status).toBe(200);
    expect(
      await (await request("get-session", undefined, another.cookie)).json(),
    ).toBeNull();
  });
  it("rejects cross-origin credential submission", async () => {
    const response = await request(
      "sign-in/email",
      { email: "no@example.test", password },
      undefined,
      "https://evil.example.test",
    );
    expect(response.status).toBe(403);
  });
  it("requires Origin and rejects unsupported endpoints and methods", async () => {
    const url = `${origin}/treinador/api/auth/sign-in/email`;
    expect(
      (
        await handleAuthRequest(
          auth,
          new Request(url, { method: "POST", body: "{}" }),
        )
      ).status,
    ).toBe(403);
    expect((await handleAuthRequest(auth, new Request(url))).status).toBe(405);
    expect((await request("update-user", { name: "Changed" })).status).toBe(
      404,
    );
  });
  it("rejects oversized auth bodies before invoking the authentication library", async () => {
    const response = await request("sign-up/email", {
      name: "x".repeat(17000),
      email: "large@example.test",
      password,
    });
    expect(response.status).toBe(413);
  });
  it("accepts an allowlisted route endpoint when Next strips the mount prefix", async () => {
    const response = await handleAuthRequest(
      auth,
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "cf-connecting-ip": "203.0.113.11",
        },
        body: JSON.stringify({
          name: "Mounted account",
          email: "mount@example.test",
          password,
        }),
      }),
      "sign-up/email",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Path=/treinador");
  });
  it("limits repeated password attempts using SQLite state", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const response = await handleAuthRequest(
        auth,
        new Request(`${origin}/treinador/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            "cf-connecting-ip": "198.51.100.10",
          },
          body: JSON.stringify({ email: "missing@example.test", password }),
        }),
      );
      last = response.status;
    }
    expect(last).toBe(429);
  });
  it("provisions one workspace and audits only once on replay", async () => {
    const user = await account();
    const input = { name: "Espaço A", professionalName: "Profissional A" };
    const a = await provisionWorkspace(db, user.id, input);
    expect(await provisionWorkspace(db, user.id, input)).toEqual(a);
    expect(await workspaceFor(db, user.id)).toEqual(a);
    const count = await db
      .prepare("SELECT count(*) AS n FROM audit_events WHERE actor_user_id = ?")
      .bind(user.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
  it("keeps concurrent onboarding atomic with no orphan organization", async () => {
    const user = await account();
    const before = await db
      .prepare("SELECT count(*) AS n FROM organizations")
      .first<{ n: number }>();
    await Promise.allSettled(
      [1, 2].map(() =>
        provisionWorkspace(db, user.id, {
          name: "Concorrente",
          professionalName: "Responsável",
        }),
      ),
    );
    const after = await db
      .prepare("SELECT count(*) AS n FROM organizations")
      .first<{ n: number }>();
    expect(after!.n - before!.n).toBe(1);
  });
  it("creates students with assignment and audit, rejects tenant spoofing", async () => {
    const a = await account();
    const b = await account();
    const orgA = await provisionWorkspace(db, a.id, {
      name: "Espaço A",
      professionalName: "Pro A",
    });
    const orgB = await provisionWorkspace(db, b.id, {
      name: "Espaço B",
      professionalName: "Pro B",
    });
    const scopeA = { userId: a.id, organizationId: orgA.id };
    const student = await createStudent(db, scopeA, { displayName: "Aluno A" });
    expect(await studentsFor(db, scopeA).findById(student)).toMatchObject({
      displayName: "Aluno A",
    });
    expect(
      await studentsFor(db, { userId: b.id, organizationId: orgB.id }).findById(
        student,
      ),
    ).toBeNull();
    await expect(
      createStudent(
        db,
        { userId: a.id, organizationId: orgB.id },
        { displayName: "Invasão" },
      ),
    ).rejects.toThrow("FORBIDDEN");
    const audit = await db
      .prepare("SELECT action FROM audit_events WHERE subject_id = ?")
      .bind(student)
      .first();
    expect(audit).toEqual({ action: "STUDENT_CREATED" });
  });
  it.each(["FINANCE", "COMMERCIAL"])(
    "denies student creation to %s even with a professional row",
    async (role) => {
      const user = await account();
      const org = await provisionWorkspace(db, user.id, {
        name: "Espaço",
        professionalName: "Nome",
      });
      await db
        .prepare("UPDATE memberships SET role = ? WHERE user_id = ?")
        .bind(role, user.id)
        .run();
      await expect(
        createStudent(
          db,
          { userId: user.id, organizationId: org.id },
          { displayName: "Aluno" },
        ),
      ).rejects.toThrow("FORBIDDEN");
    },
  );
  it("immediately applies membership revocation and identity blocking to writes", async () => {
    const user = await account();
    const org = await provisionWorkspace(db, user.id, {
      name: "Espaço",
      professionalName: "Nome",
    });
    const scope = { userId: user.id, organizationId: org.id };
    await db
      .prepare("UPDATE memberships SET revoked_at = 'now' WHERE user_id = ?")
      .bind(user.id)
      .run();
    expect(await workspaceFor(db, user.id)).toBeNull();
    await expect(
      createStudent(db, scope, { displayName: "Aluno" }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      provisionWorkspace(db, user.id, {
        name: "Outro espaço",
        professionalName: "Nome",
      }),
    ).rejects.toThrow();
    await db
      .prepare("UPDATE memberships SET revoked_at = NULL WHERE user_id = ?")
      .bind(user.id)
      .run();
    await db
      .prepare("UPDATE users SET disabled_at = 'now' WHERE id = ?")
      .bind(user.id)
      .run();
    await expect(
      createStudent(db, scope, { displayName: "Aluno" }),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("rolls back a student and assignment when its audit insert fails", async () => {
    const user = await account();
    const org = await provisionWorkspace(db, user.id, {
      name: "Espaço",
      professionalName: "Nome",
    });
    await db
      .prepare(
        "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'STUDENT_CREATED' BEGIN SELECT RAISE(ABORT,'audit failure'); END",
      )
      .run();
    await expect(
      createStudent(
        db,
        { userId: user.id, organizationId: org.id },
        { displayName: "Rollback" },
      ),
    ).rejects.toThrow();
    await db.prepare("DROP TRIGGER fail_audit").run();
    expect(
      await studentsFor(db, { userId: user.id, organizationId: org.id }).list(),
    ).toEqual([]);
  });
});
