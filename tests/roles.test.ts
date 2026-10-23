import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { studentsFor } from "@/db/students";
import {
  activatePlatformAdmin,
  isPlatformAdmin,
  platformFor,
} from "@/db/platform";
import {
  acceptStudentInvite,
  INVITE_TTL_MS,
  portalLinksFor,
  previewStudentInvite,
  studentAccessFor,
} from "@/db/student-access";
import { hadStudentAccess, surfacesFor } from "@/db/surfaces";

// Real local D1. Identities are rows, as the server derives them from a session.
let mf: Miniflare;
let db: D1Database;
const SETUP_TOKEN = "setup-token-for-tests-only-0123456789abcdef";
const scope = (userId: string, organizationId = "org-a") => ({
  userId,
  organizationId,
});
const ids = [
  "mgr-1",
  "mgr-2",
  "owner-a",
  "tech-a",
  "tech-a2",
  "commercial-a",
  "owner-b",
  "tech-b",
  "client-1",
  "client-2",
  "stranger",
];

async function migrate(database: D1Database) {
  for (const file of [
    "0001_foundation.sql",
    "0002_identity_and_onboarding.sql",
    "0003_roles_and_access.sql",
  ]) {
    const sql = await readFile(
      new URL(`../migrations/${file}`, import.meta.url),
      "utf8",
    );
    await database.batch(
      sql
        .replace(/^--.*$/gm, "")
        .split(";")
        .filter((statement) => statement.trim())
        .map((statement) => database.prepare(statement)),
    );
  }
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "roles-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db);
  await db.batch([
    ...ids.map((id) =>
      db
        .prepare(
          "INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)",
        )
        .bind(id, `${id}@example.test`),
    ),
    // Domain identities exist only for people who onboarded; managers and
    // clients get their row on activation / invitation acceptance.
    db.prepare(
      "INSERT INTO users(id) VALUES ('owner-a'),('tech-a'),('tech-a2'),('commercial-a'),('owner-b'),('tech-b')",
    ),
    db.prepare(
      "INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')",
    ),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES
       ('org-a','owner-a','OWNER'),('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-b','owner-b','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner-a','org-a','owner-a','Owner A'),('pro-a','org-a','tech-a','Pro A'),
       ('pro-a2','org-a','tech-a2','Pro A2'),('pro-owner-b','org-b','owner-b','Owner B'),
       ('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare(
      `INSERT INTO students(id,organization_id,display_name) VALUES
       ('st-1','org-a','Secret Student One'),('st-2','org-a','Secret Student Two'),
       ('st-b','org-b','Secret Student B')`,
    ),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES
       ('org-a','st-1','pro-a'),('org-a','st-2','pro-a2'),('org-b','st-b','pro-b')`,
    ),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("platform manager bootstrap", () => {
  it("stays unavailable without a long configured token", async () => {
    for (const configured of [undefined, "", "too-short"]) {
      expect(
        await activatePlatformAdmin(db, {
          userId: "mgr-1",
          supplied: "anything",
          configured,
        }),
      ).toBe("unavailable");
    }
    expect(await isPlatformAdmin(db, "mgr-1")).toBe(false);
  });
  it("rejects a wrong or empty token and grants nothing", async () => {
    for (const supplied of ["", "wrong", SETUP_TOKEN.slice(1)]) {
      expect(
        await activatePlatformAdmin(db, {
          userId: "mgr-1",
          supplied,
          configured: SETUP_TOKEN,
        }),
      ).toBe("invalid_token");
    }
    expect(await isPlatformAdmin(db, "mgr-1")).toBe(false);
  });
  it("is not unlocked by an e-mail address or by an organization role", async () => {
    // An owner of an organization is not a manager of the platform.
    expect(await isPlatformAdmin(db, "owner-a")).toBe(false);
    expect(await surfacesFor(db, "owner-a")).toEqual(["profissional"]);
  });
  it("activates exactly one manager, even under concurrency", async () => {
    const results = await Promise.all(
      ["mgr-1", "mgr-2"].map((userId) =>
        activatePlatformAdmin(db, {
          userId,
          supplied: SETUP_TOKEN,
          configured: SETUP_TOKEN,
        }),
      ),
    );
    expect(results.filter((r) => r === "activated")).toHaveLength(1);
    expect(results.filter((r) => r === "already_configured")).toHaveLength(1);
    const admins = await db
      .prepare("SELECT user_id FROM platform_admins WHERE revoked_at IS NULL")
      .all<{ user_id: string }>();
    expect(admins.results).toHaveLength(1);
    const audit = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM access_audit_events WHERE action = 'PLATFORM_ADMIN_ACTIVATED'",
      )
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });
  it("keeps the token inert after the first manager exists", async () => {
    const admin = (
      await db
        .prepare("SELECT user_id FROM platform_admins")
        .first<{ user_id: string }>()
    )?.user_id as string;
    const other = admin === "mgr-1" ? "mgr-2" : "mgr-1";
    expect(
      await activatePlatformAdmin(db, {
        userId: other,
        supplied: SETUP_TOKEN,
        configured: SETUP_TOKEN,
      }),
    ).toBe("already_configured");
    expect(await isPlatformAdmin(db, other)).toBe(false);
  });
});

describe("platform manager scope", () => {
  const manager = async () =>
    (
      await db
        .prepare("SELECT user_id FROM platform_admins WHERE revoked_at IS NULL")
        .first<{ user_id: string }>()
    )?.user_id as string;

  it("refuses every query to identities that are not managers", async () => {
    for (const userId of ["owner-a", "tech-a", "client-1", "stranger", "mgr-x"]) {
      const repo = platformFor(db, { userId });
      await expect(repo.summary()).rejects.toThrow("PLATFORM_ACCESS_REQUIRED");
      expect(await repo.listOrganizations()).toEqual([]);
      expect(await repo.findOrganization("org-a")).toBeNull();
      expect(await repo.listAudit()).toEqual([]);
      await expect(
        repo.setMemberBlocked("org-a", "tech-a", true),
      ).rejects.toThrow("PLATFORM_ACTION_FORBIDDEN");
    }
    expect(
      (await db.prepare("SELECT disabled_at FROM users WHERE id = 'tech-a'").first<{
        disabled_at: string | null;
      }>())?.disabled_at,
    ).toBeNull();
  });
  it("requires a verified identity", () => {
    expect(() => platformFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
    expect(() => platformFor(db, { userId: " " })).toThrow(
      "AUTHENTICATION_REQUIRED",
    );
  });
  it("sees organizations and aggregate counts, never student records", async () => {
    const repo = platformFor(db, { userId: await manager() });
    const summary = await repo.summary();
    expect(summary).toMatchObject({
      organizations: 2,
      professionals: 5,
      students: 3,
      portalAccesses: 0,
    });
    const organizations = await repo.listOrganizations();
    expect(organizations.map((o) => o.name).sort()).toEqual([
      "Studio A",
      "Studio B",
    ]);
    const studio = organizations.find((o) => o.id === "org-a");
    expect(studio).toMatchObject({
      ownerName: "Owner A",
      ownerEmail: "owner-a@example.test",
      students: 2,
    });
    const detail = await repo.findOrganization("org-a");
    expect(detail?.members.map((m) => m.userId).sort()).toEqual([
      "commercial-a",
      "owner-a",
      "tech-a",
      "tech-a2",
    ]);
    const everything = JSON.stringify([summary, organizations, detail]);
    expect(everything).not.toContain("Secret Student");
  });
  it("has no technical access to students through any organization", async () => {
    const userId = await manager();
    for (const organizationId of ["org-a", "org-b"]) {
      expect(await studentsFor(db, scope(userId, organizationId)).list()).toEqual(
        [],
      );
      expect(
        await studentsFor(db, scope(userId, organizationId)).findById("st-1"),
      ).toBeNull();
    }
    await expect(
      studentAccessFor(db, scope(userId)).createInvite("st-1"),
    ).rejects.toThrow("STUDENT_INVITE_FORBIDDEN");
  });
  it("blocks and unblocks a professional identity with audit, immediately", async () => {
    const actor = await manager();
    const repo = platformFor(db, { userId: actor });
    expect(await studentsFor(db, scope("tech-a")).list()).toHaveLength(1);
    await repo.setMemberBlocked("org-a", "tech-a", true);
    expect(await studentsFor(db, scope("tech-a")).list()).toEqual([]);
    expect(await surfacesFor(db, "tech-a")).toEqual([]);
    const detail = await repo.findOrganization("org-a");
    expect(detail?.members.find((m) => m.userId === "tech-a")?.blocked).toBe(
      true,
    );
    expect(detail?.organization.blockedMembers).toBe(1);
    await expect(repo.setMemberBlocked("org-a", "tech-a", true)).rejects.toThrow(
      "PLATFORM_ACTION_FORBIDDEN",
    );
    await repo.setMemberBlocked("org-a", "tech-a", false);
    expect(await studentsFor(db, scope("tech-a")).list()).toHaveLength(1);
    const audit = await repo.listAudit();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["USER_BLOCKED", "USER_UNBLOCKED"]),
    );
    expect(
      audit.find((a) => a.action === "USER_BLOCKED")?.subjectEmail,
    ).toBe("tech-a@example.test");
  });
  it("cannot block itself, another manager, or someone outside the organization", async () => {
    const actor = await manager();
    const repo = platformFor(db, { userId: actor });
    await expect(repo.setMemberBlocked("org-a", actor, true)).rejects.toThrow();
    // tech-b belongs to org-b only.
    await expect(repo.setMemberBlocked("org-a", "tech-b", true)).rejects.toThrow(
      "PLATFORM_ACTION_FORBIDDEN",
    );
    await expect(repo.setMemberBlocked("org-a", "client-1", true)).rejects.toThrow();
    // Make the other identity a member and a (second) manager row: still protected.
    await db.batch([
      db.prepare(
        "INSERT OR IGNORE INTO users(id) VALUES ('mgr-1'),('mgr-2')",
      ),
      db.prepare(
        "INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','mgr-1','MANAGER'),('org-a','mgr-2','MANAGER')",
      ),
    ]);
    try {
      const other = actor === "mgr-1" ? "mgr-2" : "mgr-1";
      await db
        .prepare("INSERT INTO platform_admins(user_id) VALUES (?1)")
        .bind(other)
        .run();
      await expect(repo.setMemberBlocked("org-a", other, true)).rejects.toThrow(
        "PLATFORM_ACTION_FORBIDDEN",
      );
    } finally {
      await db.batch([
        db.prepare("DELETE FROM platform_admins WHERE user_id <> ?1").bind(actor),
        db.prepare(
          "DELETE FROM memberships WHERE user_id IN ('mgr-1','mgr-2')",
        ),
      ]);
    }
  });
  it("loses access as soon as the manager is revoked or blocked", async () => {
    const actor = await manager();
    const repo = platformFor(db, { userId: actor });
    await db
      .prepare("UPDATE platform_admins SET revoked_at = '2026-10-23T00:00:00Z'")
      .run();
    try {
      await expect(repo.summary()).rejects.toThrow("PLATFORM_ACCESS_REQUIRED");
      expect(await surfacesFor(db, actor)).toEqual([]);
    } finally {
      await db.prepare("UPDATE platform_admins SET revoked_at = NULL").run();
    }
    await db
      .prepare("UPDATE users SET disabled_at = '2026-10-23T00:00:00Z' WHERE id = ?1")
      .bind(actor)
      .run();
    try {
      expect(await repo.listOrganizations()).toEqual([]);
    } finally {
      await db
        .prepare("UPDATE users SET disabled_at = NULL WHERE id = ?1")
        .bind(actor)
        .run();
    }
  });
  it("lists only platform actions in the platform audit", async () => {
    const repo = platformFor(db, { userId: await manager() });
    await db
      .prepare(
        "INSERT INTO access_audit_events(id,organization_id,actor_user_id,action,subject_id) VALUES ('x','org-a','tech-a','STUDENT_INVITE_CREATED','invite')",
      )
      .run();
    const actions = (await repo.listAudit()).map((a) => a.action);
    expect(actions).not.toContain("STUDENT_INVITE_CREATED");
    expect(actions).toContain("PLATFORM_ADMIN_ACTIVATED");
  });
});

describe("client invitation and portal access", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const invite = (userId: string, studentId = "st-1", organizationId = "org-a") =>
    studentAccessFor(db, scope(userId, organizationId)).createInvite(
      studentId,
      now,
    );

  it("lets only the assigned technical professional create an invitation", async () => {
    // Owner without assignment, other professional, commercial role, other tenant.
    for (const [userId, org] of [
      ["owner-a", "org-a"],
      ["tech-a2", "org-a"],
      ["commercial-a", "org-a"],
      ["tech-b", "org-b"],
      ["tech-b", "org-a"],
      ["client-1", "org-a"],
    ]) {
      await expect(invite(userId, "st-1", org)).rejects.toThrow(
        "STUDENT_INVITE_FORBIDDEN",
      );
    }
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM student_invites").first<{
        n: number;
      }>())?.n,
    ).toBe(0);
    // Wrong tenant for an existing student id.
    await expect(invite("tech-b", "st-1", "org-b")).rejects.toThrow(
      "STUDENT_INVITE_FORBIDDEN",
    );
  });
  it("stores only a hash and returns the raw token once", async () => {
    const { token, expiresAt } = await invite("tech-a");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(new Date(now.getTime() + INVITE_TTL_MS).toISOString());
    const stored = await db
      .prepare("SELECT token_hash FROM student_invites")
      .all<{ token_hash: string }>();
    expect(stored.results).toHaveLength(1);
    expect(stored.results[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.results[0].token_hash).not.toContain(token);
    expect(await previewStudentInvite(db, token, now)).toEqual({
      organizationName: "Studio A",
      professionalName: "Pro A",
    });
    // The preview reveals no student data.
    expect(JSON.stringify(await previewStudentInvite(db, token, now))).not.toContain(
      "Secret",
    );
  });
  it("reports pending, then replaces the pending link with a new one", async () => {
    const repo = studentAccessFor(db, scope("tech-a"));
    const first = (await db.prepare("SELECT token_hash FROM student_invites").first<{
      token_hash: string;
    }>())!.token_hash;
    expect((await repo.statusOf("st-1", now))?.access).toBe("INVITED");
    expect((await repo.statuses(now)).map((s) => s.access)).toEqual(["INVITED"]);
    const second = await repo.createInvite("st-1", now);
    const valid = await db
      .prepare(
        "SELECT token_hash FROM student_invites WHERE revoked_at IS NULL AND accepted_at IS NULL",
      )
      .all<{ token_hash: string }>();
    expect(valid.results).toHaveLength(1);
    expect(valid.results[0].token_hash).not.toBe(first);
    expect(await previewStudentInvite(db, second.token, now)).not.toBeNull();
  });
  it("rejects malformed, unknown and expired tokens", async () => {
    for (const token of ["", "short", "x".repeat(43), 42, null, undefined]) {
      expect(await previewStudentInvite(db, token, now)).toBeNull();
      expect(await acceptStudentInvite(db, "client-1", token, now)).toBeNull();
    }
    const { token } = await studentAccessFor(db, scope("tech-a")).createInvite(
      "st-1",
      now,
    );
    const later = new Date(now.getTime() + INVITE_TTL_MS + 1000);
    expect(await previewStudentInvite(db, token, later)).toBeNull();
    expect(await acceptStudentInvite(db, "client-1", token, later)).toBeNull();
    expect(await portalLinksFor(db, "client-1")).toEqual([]);
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM student_access").first<{
        n: number;
      }>())?.n,
    ).toBe(0);
  });
  it("accepts once, links one login, and never again", async () => {
    const { token } = await studentAccessFor(db, scope("tech-a")).createInvite(
      "st-1",
      now,
    );
    expect(await surfacesFor(db, "client-1")).toEqual([]);
    const accepted = await acceptStudentInvite(db, "client-1", token, now);
    expect(accepted).toEqual({ organizationId: "org-a", studentId: "st-1" });
    expect(await surfacesFor(db, "client-1")).toEqual(["aluno"]);
    // Replay, by the same login or another one.
    expect(await acceptStudentInvite(db, "client-1", token, now)).toBeNull();
    expect(await acceptStudentInvite(db, "client-2", token, now)).toBeNull();
    expect(await previewStudentInvite(db, token, now)).toBeNull();
    expect(await surfacesFor(db, "client-2")).toEqual([]);
    const links = await portalLinksFor(db, "client-1");
    expect(links).toEqual([
      expect.objectContaining({
        studentId: "st-1",
        studentName: "Secret Student One",
        organizationName: "Studio A",
        professionalName: "Pro A",
      }),
    ]);
    expect(await portalLinksFor(db, "client-2")).toEqual([]);
  });
  it("shows the client only the own record, in the own organization", async () => {
    expect(
      (await studentsFor(db, scope("client-1")).list()).map((s) => s.id),
    ).toEqual(["st-1"]);
    expect(await studentsFor(db, scope("client-1")).findById("st-2")).toBeNull();
    expect(await studentsFor(db, scope("client-1", "org-b")).list()).toEqual([]);
    // A client is not a professional: no invitation, no revocation.
    await expect(
      studentAccessFor(db, scope("client-1")).createInvite("st-1", now),
    ).rejects.toThrow("STUDENT_INVITE_FORBIDDEN");
    expect(
      await studentAccessFor(db, scope("client-1")).revoke("st-1", now),
    ).toBe(0);
    expect(await portalLinksFor(db, "client-1")).toHaveLength(1);
  });
  it("reports the active state and blocks a second link while active", async () => {
    const repo = studentAccessFor(db, scope("tech-a"));
    expect(await repo.statusOf("st-1", now)).toMatchObject({
      access: "ACTIVE",
    });
    await expect(repo.createInvite("st-1", now)).rejects.toThrow(
      "STUDENT_INVITE_FORBIDDEN",
    );
    // A different professional sees nothing about this student.
    expect(
      await studentAccessFor(db, scope("tech-a2")).statusOf("st-1", now),
    ).toBeNull();
  });
  it("does not let a stranger revoke, and revokes for the assigned professional", async () => {
    expect(
      await studentAccessFor(db, scope("tech-a2")).revoke("st-1", now),
    ).toBe(0);
    expect(
      await studentAccessFor(db, scope("tech-b", "org-b")).revoke("st-1", now),
    ).toBe(0);
    expect(await portalLinksFor(db, "client-1")).toHaveLength(1);
    expect(
      await studentAccessFor(db, scope("tech-a")).revoke("st-1", now),
    ).toBe(1);
    expect(await portalLinksFor(db, "client-1")).toEqual([]);
    expect(await studentsFor(db, scope("client-1")).list()).toEqual([]);
    expect(await surfacesFor(db, "client-1")).toEqual([]);
  });
  it("allows a fresh invitation after revocation and reactivates the same login", async () => {
    const repo = studentAccessFor(db, scope("tech-a"));
    const { token } = await repo.createInvite("st-1", now);
    expect(await acceptStudentInvite(db, "client-1", token, now)).not.toBeNull();
    expect(await portalLinksFor(db, "client-1")).toHaveLength(1);
    await repo.revoke("st-1", now);
  });
  it("revokes a pending invitation too", async () => {
    const repo = studentAccessFor(db, scope("tech-a"));
    const { token } = await repo.createInvite("st-1", now);
    await repo.revoke("st-1", now);
    expect(await previewStudentInvite(db, token, now)).toBeNull();
    expect(await acceptStudentInvite(db, "client-2", token, now)).toBeNull();
    expect((await repo.statusOf("st-1", now))?.access).toBe("NONE");
  });
  it("refuses a second login while another one is active", async () => {
    const repo = studentAccessFor(db, scope("tech-a"));
    const { token } = await repo.createInvite("st-1", now);
    await db.prepare("INSERT OR IGNORE INTO users(id) VALUES ('client-2')").run();
    await db
      .prepare(
        "INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-2')",
      )
      .run();
    try {
      expect(await acceptStudentInvite(db, "client-1", token, now)).toBeNull();
      expect(await previewStudentInvite(db, token, now)).not.toBeNull();
    } finally {
      await db
        .prepare("DELETE FROM student_access WHERE user_id = 'client-2'")
        .run();
      await repo.revoke("st-1", now);
    }
  });
  it("lets only one of two simultaneous acceptances win", async () => {
    const { token } = await studentAccessFor(db, scope("tech-a")).createInvite(
      "st-1",
      now,
    );
    const results = await Promise.all([
      acceptStudentInvite(db, "client-1", token, now),
      acceptStudentInvite(db, "client-2", token, now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const active = await db
      .prepare(
        "SELECT user_id FROM student_access WHERE student_id = 'st-1' AND revoked_at IS NULL",
      )
      .all();
    expect(active.results).toHaveLength(1);
    await studentAccessFor(db, scope("tech-a")).revoke("st-1", now);
  });
  it("does not accept for a blocked identity", async () => {
    const { token } = await studentAccessFor(db, scope("tech-a")).createInvite(
      "st-1",
      now,
    );
    await db
      .prepare("INSERT OR IGNORE INTO users(id,disabled_at) VALUES ('client-2','2026-10-01T00:00:00Z')")
      .run();
    await db
      .prepare("UPDATE users SET disabled_at = '2026-10-01T00:00:00Z' WHERE id = 'client-2'")
      .run();
    try {
      expect(await acceptStudentInvite(db, "client-2", token, now)).toBeNull();
      expect(await previewStudentInvite(db, token, now)).not.toBeNull();
    } finally {
      await db
        .prepare("UPDATE users SET disabled_at = NULL WHERE id = 'client-2'")
        .run();
      await studentAccessFor(db, scope("tech-a")).revoke("st-1", now);
    }
  });
  it("allows a client to hold two organizations without mixing them", async () => {
    const { token } = await studentAccessFor(db, scope("tech-b", "org-b")).createInvite(
      "st-b",
      now,
    );
    const first = await studentAccessFor(db, scope("tech-a")).createInvite("st-1", now);
    await acceptStudentInvite(db, "client-1", first.token, now);
    await acceptStudentInvite(db, "client-1", token, now);
    const links = await portalLinksFor(db, "client-1");
    expect(links.map((l) => l.organizationName).sort()).toEqual([
      "Studio A",
      "Studio B",
    ]);
    expect(
      (await studentsFor(db, scope("client-1")).list()).map((s) => s.id),
    ).toEqual(["st-1"]);
    expect(
      (await studentsFor(db, scope("client-1", "org-b")).list()).map((s) => s.id),
    ).toEqual(["st-b"]);
  });
  it("records invitation events for the organization", async () => {
    const events = await db
      .prepare(
        "SELECT action FROM access_audit_events WHERE action LIKE 'STUDENT_%' ORDER BY created_at",
      )
      .all<{ action: string }>();
    const actions = new Set(events.results.map((e) => e.action));
    expect(actions).toEqual(
      new Set([
        "STUDENT_INVITE_CREATED",
        "STUDENT_INVITE_ACCEPTED",
        "STUDENT_ACCESS_REVOKED",
      ]),
    );
  });
});

describe("area resolution", () => {
  it("combines areas for an identity with more than one role", async () => {
    expect(await surfacesFor(db, "tech-b")).toEqual(["profissional"]);
    expect(await surfacesFor(db, "client-1")).toEqual(["aluno"]);
    expect(await surfacesFor(db, "stranger")).toEqual([]);
    expect(await surfacesFor(db, "")).toEqual([]);
    // Manager + professional on the same login.
    const actor = (
      await db
        .prepare("SELECT user_id FROM platform_admins WHERE revoked_at IS NULL")
        .first<{ user_id: string }>()
    )?.user_id as string;
    await db
      .prepare(
        "INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-b',?1,'MANAGER')",
      )
      .bind(actor)
      .run();
    try {
      expect(await surfacesFor(db, actor)).toEqual(["gestor", "profissional"]);
    } finally {
      await db
        .prepare("DELETE FROM memberships WHERE user_id = ?1")
        .bind(actor)
        .run();
    }
  });
  it("tells a revoked client apart from a brand-new login", async () => {
    expect(await hadStudentAccess(db, "stranger")).toBe(false);
    expect(await hadStudentAccess(db, "")).toBe(false);
    expect(await hadStudentAccess(db, "client-1")).toBe(false);
    await db
      .prepare(
        "UPDATE student_access SET revoked_at = '2026-10-23T00:00:00Z' WHERE user_id = 'client-1'",
      )
      .run();
    try {
      expect(await hadStudentAccess(db, "client-1")).toBe(true);
      expect(await surfacesFor(db, "client-1")).toEqual([]);
    } finally {
      await db
        .prepare("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-1'")
        .run();
    }
  });
  it("revoking a membership removes the professional area", async () => {
    await db
      .prepare(
        "UPDATE memberships SET revoked_at = '2026-10-23T00:00:00Z' WHERE user_id = 'tech-b'",
      )
      .run();
    try {
      expect(await surfacesFor(db, "tech-b")).toEqual([]);
    } finally {
      await db
        .prepare("UPDATE memberships SET revoked_at = NULL WHERE user_id = 'tech-b'")
        .run();
    }
  });
});
