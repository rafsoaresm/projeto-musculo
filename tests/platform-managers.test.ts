import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/db/crypto";
import { dataRequestsFor, studentRequestsFor } from "@/db/data-requests";
import {
  acceptManagerInvite,
  isPlatformAdmin,
  MANAGER_INVITE_HOURS,
  normalizeInviteLabel,
  platformFor,
  previewManagerInvite,
} from "@/db/platform";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with the real migrations and triggers. Identities are rows, as the server derives
// them from a verified session.
let mf: Miniflare;
let db: D1Database;
const at = (hours: number, base = "2026-11-10T12:00:00Z") => new Date(new Date(base).getTime() + hours * 3_600_000);
const NOW = at(0);
const manager = (userId: string) => platformFor(db, { userId });
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const audit = async (action: string) =>
  (await db.prepare("SELECT actor_user_id AS actor, subject_id AS subject, organization_id AS org FROM access_audit_events WHERE action = ?1 ORDER BY rowid").bind(action).all<{ actor: string; subject: string; org: string | null }>()).results;
const inviteRow = async (id: string) =>
  db.prepare("SELECT * FROM platform_admin_invites WHERE id = ?1").bind(id).first<Record<string, unknown>>();
const idOf = async (token: string) =>
  (await db.prepare("SELECT id FROM platform_admin_invites WHERE token_hash = ?1").bind(await sha256Hex(token)).first<{ id: string }>())!.id;

const PEOPLE = ["m1", "m2", "m3", "m4", "pro-a", "client-a", "stranger", "blocked"];

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "manager-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  await db.batch([
    ...PEOPLE.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?2,?3,0,0)").bind(id, `Nome ${id}`, `${id}@example.test`)),
    // m2, m3, m4 and the stranger have not finished joining the tool: they have no row in `users` yet.
    ...["m1", "pro-a", "client-a", "blocked"].map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("UPDATE users SET disabled_at = '2026-11-01T00:00:00.000Z' WHERE id = 'blocked'"),
    db.prepare("INSERT INTO platform_admins(user_id, created_at) VALUES ('m1', '2026-10-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','pro-a','OWNER')"),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a-p','org-a','pro-a','Pro A')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-a','org-a','Aluno Confidencial')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-a','pro-a-p')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-a','client-a')"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("the label of an invitation", () => {
  it("is one short line or nothing", () => {
    expect(normalizeInviteLabel("  Marina   da   gestão ")).toBe("Marina da gestão");
    expect(normalizeInviteLabel("")).toBeNull();
    expect(normalizeInviteLabel("   ")).toBeNull();
    expect(normalizeInviteLabel(undefined)).toBeNull();
    expect(normalizeInviteLabel(42)).toBeNull();
    expect(normalizeInviteLabel("x".repeat(80))).toHaveLength(80);
    expect(() => normalizeInviteLabel("x".repeat(81))).toThrow("INVITE_LABEL_TOO_LONG");
    expect(normalizeInviteLabel("linha 1\nlinha 2")).toBe("linha 1 linha 2");
  });
});

describe("issuing an invitation", () => {
  it("shows the link once and keeps only its hash, with the deadline and the trail", async () => {
    const { token, expiresAt } = await manager("m1").inviteManager("  Para a Marina ", NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(at(MANAGER_INVITE_HOURS).toISOString());
    const id = await idOf(token);
    const row = (await inviteRow(id))!;
    expect(row).toMatchObject({
      token_hash: await sha256Hex(token),
      created_by_user_id: "m1",
      label: "Para a Marina",
      created_at: NOW.toISOString(),
      expires_at: expiresAt,
      accepted_at: null,
      revoked_at: null,
    });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await audit("PLATFORM_ADMIN_INVITED")).toEqual([{ actor: "m1", subject: id, org: null }]);
    // The list never carries the link.
    const listed = await manager("m1").listManagerInvites(10, at(1));
    expect(listed).toEqual([
      { id, label: "Para a Marina", createdByEmail: "m1@example.test", createdAt: NOW.toISOString(), expiresAt, status: "OPEN", acceptedByEmail: null },
    ]);
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  it("is possible only for an active manager", async () => {
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM platform_admin_invites").first<{ n: number }>())!.n;
    for (const person of ["m2", "pro-a", "client-a", "stranger", "blocked"])
      await expect(manager(person).inviteManager("x", NOW), person).rejects.toThrow("PLATFORM_ACCESS_REQUIRED");
    await expect(manager("m1").inviteManager("x".repeat(81), NOW)).rejects.toThrow("INVITE_LABEL_TOO_LONG");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM platform_admin_invites").first<{ n: number }>())!.n).toBe(before);
    // Nobody but a manager reads the list, the managers or the invitations.
    await expect(manager("m2").listManagers()).resolves.toEqual([]);
    await expect(manager("m2").listManagerInvites()).resolves.toEqual([]);
    expect(() => platformFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
  });
});

describe("opening and accepting the link", () => {
  it("shows who invited, and nothing else, for a link that is open", async () => {
    const { token } = await manager("m1").inviteManager("Para o m2", NOW);
    expect(await previewManagerInvite(db, token, at(1))).toEqual({ issuerName: "Nome m1", expiresAt: at(MANAGER_INVITE_HOURS).toISOString() });
    // The same null for a malformed link and for one that never existed.
    expect(await previewManagerInvite(db, "short", at(1))).toBeNull();
    expect(await previewManagerInvite(db, 42, at(1))).toBeNull();
    expect(await previewManagerInvite(db, "A".repeat(43), at(1))).toBeNull();
    expect(await previewManagerInvite(db, token, at(MANAGER_INVITE_HOURS + 1))).toBeNull();
  });

  it("makes the person who accepts a manager, from the link and not from the e-mail, once", async () => {
    const { token } = await manager("m1").inviteManager("Para a m2", NOW);
    expect(await isPlatformAdmin(db, "m2")).toBe(false);
    // A person who has not finished joining the tool is created in `users` by the acceptance itself.
    expect(await acceptManagerInvite(db, { userId: "m2", token, now: at(2) })).toBe("accepted");
    expect(await isPlatformAdmin(db, "m2")).toBe(true);
    expect((await audit("PLATFORM_ADMIN_GRANTED")).map((e) => [e.actor, e.subject, e.org])).toEqual([["m2", "m2", null]]);
    const id = await idOf(token);
    expect(await inviteRow(id)).toMatchObject({ accepted_by_user_id: "m2", accepted_at: at(2).toISOString() });
    // The link is spent: nobody can use it again, and nobody sees it as open.
    expect(await acceptManagerInvite(db, { userId: "m3", token, now: at(3) })).toBe("unavailable");
    expect(await isPlatformAdmin(db, "m3")).toBe(false);
    expect(await previewManagerInvite(db, token, at(3))).toBeNull();
    const listed = await manager("m1").listManagerInvites(10, at(3));
    expect(listed.find((row) => row.id === id)).toMatchObject({ status: "USED", acceptedByEmail: "m2@example.test" });
  });

  it("is refused for everything that is not an open link and an active person", async () => {
    const open = await manager("m1").inviteManager("Para testes", NOW);
    // Never issued, malformed, expired.
    expect(await acceptManagerInvite(db, { userId: "m3", token: "A".repeat(43), now: at(1) })).toBe("unavailable");
    expect(await acceptManagerInvite(db, { userId: "m3", token: "not a token", now: at(1) })).toBe("unavailable");
    expect(await acceptManagerInvite(db, { userId: "m3", token: open.token, now: at(MANAGER_INVITE_HOURS) })).toBe("unavailable");
    expect(await acceptManagerInvite(db, { userId: "m3", token: open.token, now: at(MANAGER_INVITE_HOURS + 5) })).toBe("unavailable");
    // No person at all, or one that does not exist.
    expect(await acceptManagerInvite(db, { userId: "", token: open.token, now: at(1) })).toBe("unavailable");
    expect(await acceptManagerInvite(db, { userId: "nobody", token: open.token, now: at(1) })).toBe("unavailable");
    // A blocked identity does not become a manager.
    expect(await acceptManagerInvite(db, { userId: "blocked", token: open.token, now: at(1) })).toBe("unavailable");
    expect(await isPlatformAdmin(db, "blocked")).toBe(false);
    // Someone who already is a manager does not spend the link: it stays open for who it was meant for.
    expect(await acceptManagerInvite(db, { userId: "m2", token: open.token, now: at(1) })).toBe("unavailable");
    expect(await previewManagerInvite(db, open.token, at(1))).not.toBeNull();
    // After all that, the link still works for a real person.
    expect(await acceptManagerInvite(db, { userId: "m3", token: open.token, now: at(1) })).toBe("accepted");
    expect(await isPlatformAdmin(db, "m3")).toBe(true);
  });

  it("is cancelled by a manager, and then it dies", async () => {
    const { token } = await manager("m1").inviteManager("Vai ser cancelado", NOW);
    const id = await idOf(token);
    expect(await manager("m2").revokeManagerInvite(id, at(1))).toBe(true);
    expect(await manager("m2").revokeManagerInvite(id, at(1))).toBe(false);
    expect(await previewManagerInvite(db, token, at(1))).toBeNull();
    expect(await acceptManagerInvite(db, { userId: "m4", token, now: at(1) })).toBe("unavailable");
    expect((await manager("m1").listManagerInvites(30, at(1))).find((row) => row.id === id)?.status).toBe("REVOKED");
    expect((await audit("PLATFORM_ADMIN_INVITE_REVOKED")).at(-1)).toEqual({ actor: "m2", subject: id, org: null });
    // Not by anyone who is not a manager.
    const another = await manager("m1").inviteManager("Outro", NOW);
    expect(await manager("pro-a").revokeManagerInvite(await idOf(another.token), at(1))).toBe(false);
    expect(await manager("stranger").revokeManagerInvite(await idOf(another.token), at(1))).toBe(false);
    expect(await previewManagerInvite(db, another.token, at(1))).not.toBeNull();
  });
});

describe("ending a manager's access", () => {
  it("is immediate, never your own, and never leaves the platform without one", async () => {
    expect((await manager("m1").listManagers()).map((row) => [row.userId, row.revoked, row.self])).toEqual([
      ["m1", false, true],
      // In the order they became managers: m3 accepted before m2 on the clock of these tests.
      ["m3", false, false],
      ["m2", false, false],
    ]);
    // Your own is refused, and so is anyone's who is not a manager.
    expect(await manager("m1").revokeManager("m1", at(5))).toBe(false);
    expect(await manager("pro-a").revokeManager("m2", at(5))).toBe(false);
    expect(await manager("stranger").revokeManager("m1", at(5))).toBe(false);
    expect(await manager("m1").revokeManager("stranger", at(5))).toBe(false);
    expect(await isPlatformAdmin(db, "m2")).toBe(true);

    expect(await manager("m1").revokeManager("m2", at(5))).toBe(true);
    expect(await manager("m1").revokeManager("m2", at(5))).toBe(false);
    // The very next question of the platform says no, and what they read says nothing.
    expect(await isPlatformAdmin(db, "m2")).toBe(false);
    await expect(manager("m2").summary()).rejects.toThrow("PLATFORM_ACCESS_REQUIRED");
    await expect(manager("m2").listOrganizations()).resolves.toEqual([]);
    expect((await audit("PLATFORM_ADMIN_REVOKED")).map((e) => [e.actor, e.subject])).toEqual([["m1", "m2"]]);
    const rows = await manager("m1").listManagers();
    expect(rows.map((row) => [row.userId, row.revoked])).toEqual([["m1", false], ["m3", false], ["m2", true]]);
    expect(rows.find((row) => row.userId === "m2")?.invitedByEmail).toBe("m1@example.test");
    expect(rows.find((row) => row.userId === "m1")?.invitedByEmail).toBeNull();
  });

  it("cannot be done to each other at the same moment: one of them is always left", async () => {
    await Promise.all([manager("m1").revokeManager("m3", at(6)), manager("m3").revokeManager("m1", at(6))]);
    const active = (await db.prepare("SELECT user_id AS id FROM platform_admins WHERE revoked_at IS NULL").all<{ id: string }>()).results;
    expect(active).toHaveLength(1);
    // Put the other back for what follows: a manager invites them.
    const survivor = active[0].id;
    const lost = survivor === "m1" ? "m3" : "m1";
    const { token } = await manager(survivor).inviteManager("De volta", at(6));
    expect(await acceptManagerInvite(db, { userId: lost, token, now: at(7) })).toBe("accepted");
    // A returning manager is active again and the date shown is when they came back.
    const returned = (await manager(survivor).listManagers()).find((row) => row.userId === lost)!;
    expect(returned).toMatchObject({ revoked: false });
    expect(returned.since).toBe(at(7).toISOString());
    expect((await db.prepare("SELECT COUNT(*) AS n FROM platform_admins WHERE revoked_at IS NULL").first<{ n: number }>())!.n).toBe(2);
  });

  it("makes the invitations of a former manager worthless", async () => {
    const { token } = await manager("m1").inviteManager("Emitido por m1", at(8));
    const id = await idOf(token);
    // m3 is revoked by m1; m3's own invitation is the one that dies.
    const fromM3 = await manager("m3").inviteManager("Emitido por m3", at(8));
    const m3Id = await idOf(fromM3.token);
    expect(await manager("m1").revokeManager("m3", at(9))).toBe(true);
    expect(await previewManagerInvite(db, fromM3.token, at(9))).toBeNull();
    expect(await acceptManagerInvite(db, { userId: "m4", token: fromM3.token, now: at(9) })).toBe("unavailable");
    expect(await isPlatformAdmin(db, "m4")).toBe(false);
    const listed = await manager("m1").listManagerInvites(50, at(9));
    expect(listed.find((row) => row.id === m3Id)?.status).toBe("LAPSED");
    expect(listed.find((row) => row.id === id)?.status).toBe("OPEN");
    // Revoking a manager stops what they could do and does not touch anyone's students: nothing to touch.
    expect(await previewManagerInvite(db, token, at(9))).not.toBeNull();
  });
});

describe("the database does not rely on the application", () => {
  it("refuses an invitation from someone who is not a manager", async () => {
    const insert = (by: string) =>
      run("INSERT INTO platform_admin_invites(id, token_hash, created_by_user_id, created_at, expires_at) VALUES (?1, ?2, ?3, '2026-11-10T12:00:00.000Z', '2026-11-12T12:00:00.000Z')", crypto.randomUUID(), "a".repeat(64) + "", by);
    await expect(insert("pro-a")).rejects.toThrow(/PLATFORM_INVITE_MANAGER_REQUIRED/);
    await expect(insert("blocked")).rejects.toThrow(/PLATFORM_INVITE_MANAGER_REQUIRED/);
    await expect(insert("m3")).rejects.toThrow(/PLATFORM_INVITE_MANAGER_REQUIRED/);
    await expect(
      run("INSERT INTO platform_admin_invites(id, token_hash, created_by_user_id, created_at, expires_at) VALUES ('short', 'abc', 'm1', '2026-11-10T12:00:00.000Z', '2026-11-12T12:00:00.000Z')"),
    ).rejects.toThrow(/CHECK constraint/);
    await expect(
      run("INSERT INTO platform_admin_invites(id, token_hash, created_by_user_id, created_at, expires_at) VALUES ('late', ?1, 'm1', '2026-11-10T12:00:00.000Z', '2026-11-10T11:00:00.000Z')", "b".repeat(64)),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("never changes what an invitation is, after it ended, or by deleting it", async () => {
    const open = await manager("m1").inviteManager("Congelar", at(10));
    const id = await idOf(open.token);
    await expect(run("UPDATE platform_admin_invites SET token_hash = ?2 WHERE id = ?1", id, "c".repeat(64))).rejects.toThrow(/PLATFORM_INVITE_FROZEN/);
    await expect(run("UPDATE platform_admin_invites SET expires_at = '2099-01-01T00:00:00.000Z' WHERE id = ?1", id)).rejects.toThrow(/PLATFORM_INVITE_FROZEN/);
    await expect(run("UPDATE platform_admin_invites SET created_by_user_id = 'm2' WHERE id = ?1", id)).rejects.toThrow(/PLATFORM_INVITE_FROZEN/);
    await expect(run("UPDATE platform_admin_invites SET label = 'outro' WHERE id = ?1", id)).rejects.toThrow(/PLATFORM_INVITE_FROZEN/);
    await expect(run("DELETE FROM platform_admin_invites WHERE id = ?1", id)).rejects.toThrow(/PLATFORM_INVITE_APPEND_ONLY/);
    // A link accepted after its deadline, or issued by someone who stopped being a manager, is refused by the database too.
    await expect(run("UPDATE platform_admin_invites SET accepted_at = '2026-12-31T00:00:00.000Z', accepted_by_user_id = 'm4' WHERE id = ?1", id)).rejects.toThrow(/PLATFORM_INVITE_NOT_OPEN/);
    // Only a manager cancels.
    await expect(run("UPDATE platform_admin_invites SET revoked_at = '2026-11-10T13:00:00.000Z', revoked_by_user_id = 'pro-a' WHERE id = ?1", id)).rejects.toThrow(/PLATFORM_INVITE_MANAGER_REQUIRED/);
    // Accepted and cancelled at once is not a state.
    await expect(
      run("UPDATE platform_admin_invites SET accepted_at = '2026-11-10T13:00:00.000Z', accepted_by_user_id = 'm4', revoked_at = '2026-11-10T13:00:00.000Z', revoked_by_user_id = 'm1' WHERE id = ?1", id),
    ).rejects.toThrow(/CHECK constraint/);
    // Once ended, it is frozen.
    expect(await manager("m1").revokeManagerInvite(id, at(10))).toBe(true);
    await expect(run("UPDATE platform_admin_invites SET revoked_by_user_id = 'm2' WHERE id = ?1", id)).rejects.toThrow(/PLATFORM_INVITE_FROZEN/);
    expect((await inviteRow(id))!.revoked_by_user_id).toBe("m1");
  });
});

describe("requests of the data subjects, seen by the manager as counts", () => {
  it("counts the open ones and those past the deadline, per organization, and nothing more", async () => {
    const asked = new Date("2026-11-01T12:00:00Z");
    const overdue = await studentRequestsFor(db, "client-a").open("st-a", { kind: "ACCESS", message: "Segredo do aluno" }, asked);
    const recent = await studentRequestsFor(db, "client-a").open("st-a", { kind: "PHOTOS_DELETION" }, new Date("2026-11-12T12:00:00Z"));
    const answered = await studentRequestsFor(db, "client-a").open("st-a", { kind: "DATA_DELETION" }, asked);
    if (overdue.status !== "opened" || recent.status !== "opened" || answered.status !== "opened") throw new Error("setup");
    expect(await dataRequestsFor(db, { userId: "pro-a", organizationId: "org-a" }).answer(answered.id, { outcome: "DECLINED", note: "Registro a manter." }, new Date("2026-11-05T12:00:00Z"))).toEqual({ status: "answered" });

    // The deadline of the first is 16/11; of the second 27/11.
    const onTheTenth = await manager("m1").summary(new Date("2026-11-10T12:00:00Z"));
    expect(onTheTenth).toMatchObject({ requestsOpen: 2, requestsOverdue: 0 });
    const later = new Date("2026-11-20T12:00:00Z");
    expect(await manager("m1").summary(later)).toMatchObject({ requestsOpen: 2, requestsOverdue: 1 });
    const orgs = await manager("m1").listOrganizations(10, later);
    expect(orgs.find((row) => row.id === "org-a")).toMatchObject({ requestsOpen: 2, requestsOverdue: 1 });
    expect(orgs.find((row) => row.id === "org-b")).toMatchObject({ requestsOpen: 0, requestsOverdue: 0 });
    expect((await manager("m1").findOrganization("org-a", later))!.organization).toMatchObject({ requestsOpen: 2, requestsOverdue: 1 });
    // Counts only: not who asked, not what, not the student.
    expect(JSON.stringify([onTheTenth, orgs, await manager("m1").findOrganization("org-a", later)])).not.toMatch(/Segredo do aluno|Aluno Confidencial|client-a|st-a/);
    // And only for a manager.
    await expect(manager("pro-a").summary(later)).rejects.toThrow("PLATFORM_ACCESS_REQUIRED");
    expect(await manager("pro-a").listOrganizations(10, later)).toEqual([]);
    expect(await manager("pro-a").findOrganization("org-a", later)).toBeNull();
  });
});
