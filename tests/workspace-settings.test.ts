import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { PROFESSIONAL_RENAMED, WORKSPACE_RENAMED, workspaceSettingsFor } from "@/db/workspace-settings";
import { NAME_MAX, parseName } from "@/modules/configuracoes/contracts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration. Identities are rows, as the server derives them from a session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const settings = (user: string, org = "org-a") => workspaceSettingsFor(db, scope(user, org));
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const one = async <T>(sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<T>())!;
const trail = async (action: string) =>
  (
    await db
      .prepare("SELECT organization_id AS org, actor_user_id AS actor, subject_id AS subject, created_at AS at FROM access_audit_events WHERE action = ?1 ORDER BY created_at, rowid")
      .bind(action)
      .all<{ org: string; actor: string; subject: string; at: string }>()
  ).results;
const workspaceName = async (org = "org-a") => (await one<{ name: string }>("SELECT name FROM organizations WHERE id = ?1", org)).name;
const displayName = async (user: string, org = "org-a") =>
  (await one<{ name: string }>("SELECT display_name AS name FROM professionals WHERE organization_id = ?1 AND user_id = ?2", org, user)).name;
const NOW = new Date("2026-11-12T15:00:00Z");

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "workspace-settings-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "tech-a", "commercial-a", "gone-a", "blocked-a", "owner-b", "owner-off"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?2,?3,0,0)").bind(id, `Conta ${id}`, `${id}@example.test`)),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','tech-a','TECHNICAL',NULL),('org-a','commercial-a','COMMERCIAL',NULL),
       ('org-a','gone-a','TECHNICAL','2026-11-01T00:00:00Z'),('org-a','blocked-a','TECHNICAL',NULL),
       ('org-b','owner-b','OWNER',NULL),('org-a','owner-off','OWNER','2026-11-02T00:00:00Z')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner-a','org-a','owner-a','Dona A'),('pro-tech-a','org-a','tech-a','Tecnica A'),
       ('pro-gone-a','org-a','gone-a','Ex A'),('pro-blocked-a','org-a','blocked-a','Bloqueada A'),
       ('pro-owner-b','org-b','owner-b','Dono B'),('pro-owner-off','org-a','owner-off','Dona Revogada')`,
    ),
    db.prepare("UPDATE users SET disabled_at = '2026-11-03T00:00:00Z' WHERE id = 'blocked-a'"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("the contract of a name", () => {
  it("collapses inner spaces and keeps plain text of 2 to 160 characters", () => {
    expect(parseName({ name: "  Estúdio   Força  Viva " })).toBe("Estúdio Força Viva");
    expect(parseName({ name: "Ana" })).toBe("Ana");
    expect(parseName({ name: "x".repeat(NAME_MAX) })).toHaveLength(NAME_MAX);
  });
  it("refuses empty, too short, too long, invisible characters, line breaks and extra fields", () => {
    for (const bad of ["", "  ", "A", "x".repeat(NAME_MAX + 1), "Nome​invisível", "Nome‮oculto", "tab\tou\u0000nulo", 42, null])
      expect(() => parseName({ name: bad }), String(bad)).toThrow(ZodError);
    expect(() => parseName({ name: "Nome certo", organizationId: "org-b" })).toThrow(ZodError);
    // A line break is whitespace: it collapses into a space instead of splitting the name in two lines.
    expect(parseName({ name: "Primeira\nSegunda" })).toBe("Primeira Segunda");
  });
});

describe("reading the settings", () => {
  it("shows the owner their workspace, name and who has access, and only that workspace", async () => {
    const view = (await settings("owner-a").read())!;
    expect(view).toMatchObject({ workspaceName: "Studio A", role: "OWNER", canRenameWorkspace: true, displayName: "Dona A" });
    // Revoked and blocked people are not listed; nobody of the other workspace is.
    expect(view.members).toEqual([
      expect.objectContaining({ name: "Dona A", role: "OWNER", isYou: true }),
      expect.objectContaining({ name: "Tecnica A", role: "TECHNICAL", isYou: false }),
      // A member without a professional record is named by their account.
      expect.objectContaining({ name: "Conta commercial-a", role: "COMMERCIAL", isYou: false }),
    ]);
    expect(JSON.stringify(view)).not.toMatch(/Studio B|Dono B|owner-b|Ex A|Bloqueada|Revogada|@example/);
  });

  it("tells a technical member they cannot rename the workspace, and a commercial one they have no display name", async () => {
    expect(await settings("tech-a").read()).toMatchObject({ role: "TECHNICAL", canRenameWorkspace: false, displayName: "Tecnica A" });
    expect(await settings("commercial-a").read()).toMatchObject({ role: "COMMERCIAL", canRenameWorkspace: false, displayName: null });
  });

  it("reads nothing for a revoked or blocked member, for another workspace or without a session", async () => {
    expect(await settings("gone-a").read()).toBeNull();
    expect(await settings("owner-off").read()).toBeNull();
    expect(await settings("blocked-a").read()).toBeNull();
    // A real member of another workspace asking about this one.
    expect(await settings("owner-b", "org-a").read()).toBeNull();
    expect(() => workspaceSettingsFor(db, null)).toThrow();
  });
});

describe("renaming the workspace", () => {
  it("lets the owner do it, leaves a trail of who and when (never the names) and changes nothing else", async () => {
    const before = await one<{ id: string; created_at: string; timezone: string }>("SELECT id, created_at, timezone FROM organizations WHERE id = 'org-a'");
    expect(await settings("owner-a").renameWorkspace({ name: "  Studio   Alfa " }, NOW)).toEqual({ status: "renamed" });
    expect(await workspaceName()).toBe("Studio Alfa");
    expect(await one("SELECT id, created_at, timezone FROM organizations WHERE id = 'org-a'")).toEqual(before);
    expect(await trail(WORKSPACE_RENAMED)).toEqual([{ org: "org-a", actor: "owner-a", subject: "org-a", at: NOW.toISOString() }]);
    expect(JSON.stringify(await trail(WORKSPACE_RENAMED))).not.toMatch(/Alfa|Studio/);
    // The other workspace is untouched.
    expect(await workspaceName("org-b")).toBe("Studio B");
  });

  it("does nothing, and leaves no trail, when the name is the same", async () => {
    expect(await settings("owner-a").renameWorkspace({ name: "Studio Alfa" }, NOW)).toEqual({ status: "unchanged" });
    expect(await settings("owner-a").renameWorkspace({ name: " Studio  Alfa  " }, NOW)).toEqual({ status: "unchanged" });
    expect(await trail(WORKSPACE_RENAMED)).toHaveLength(1);
  });

  it("refuses everyone who is not the owner, and writes nothing for them", async () => {
    for (const who of ["tech-a", "commercial-a", "gone-a", "owner-off", "blocked-a"])
      expect(await settings(who).renameWorkspace({ name: "Tomei o espaço" }, NOW), who).toEqual({ status: "forbidden" });
    // The owner of another workspace names a workspace that is not theirs: their own session says org-b.
    expect(await settings("owner-b", "org-a").renameWorkspace({ name: "Tomei o espaço" }, NOW)).toEqual({ status: "forbidden" });
    expect(await workspaceName()).toBe("Studio Alfa");
    expect(await trail(WORKSPACE_RENAMED)).toHaveLength(1);
  });

  it("is refused by the statement itself when access changes between the read and the write", async () => {
    // The repository reads first, for a clear answer; the write repeats the gate, which is what holds.
    // A database that changes the access right before the write simulates the race.
    const racing = (change: string, ...binds: unknown[]) =>
      ({
        prepare: db.prepare.bind(db),
        batch: async (statements: unknown[]) => {
          await run(change, ...binds);
          return db.batch(statements as never);
        },
      }) as unknown as D1Database;
    const asOwnerB = (database: D1Database) => workspaceSettingsFor(database, scope("owner-b", "org-b"));
    const untouched = async () => {
      expect(await workspaceName("org-b")).toBe("Studio B");
      expect(await trail(WORKSPACE_RENAMED)).toHaveLength(1);
    };

    expect(await asOwnerB(racing("UPDATE users SET disabled_at = '2026-11-04T00:00:00Z' WHERE id = 'owner-b'")).renameWorkspace({ name: "Bloqueado renomeando" }, NOW)).toEqual({ status: "forbidden" });
    await untouched();
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'owner-b'");

    expect(await asOwnerB(racing("UPDATE memberships SET revoked_at = '2026-11-04T00:00:00Z' WHERE organization_id = 'org-b' AND user_id = 'owner-b'")).renameWorkspace({ name: "Revogado renomeando" }, NOW)).toEqual({ status: "forbidden" });
    await untouched();
    await run("UPDATE memberships SET revoked_at = NULL WHERE organization_id = 'org-b' AND user_id = 'owner-b'");

    expect(await asOwnerB(racing("UPDATE memberships SET role = 'TECHNICAL' WHERE organization_id = 'org-b' AND user_id = 'owner-b'")).renameWorkspace({ name: "Rebaixado renomeando" }, NOW)).toEqual({ status: "forbidden" });
    await untouched();
    await run("UPDATE memberships SET role = 'OWNER' WHERE organization_id = 'org-b' AND user_id = 'owner-b'");

    // The same for one's own display name.
    expect(await asOwnerB(racing("UPDATE users SET disabled_at = '2026-11-04T00:00:00Z' WHERE id = 'owner-b'")).renameSelf({ name: "Bloqueado se renomeando" }, NOW)).toEqual({ status: "forbidden" });
    expect(await displayName("owner-b", "org-b")).toBe("Dono B");
    expect(await trail(PROFESSIONAL_RENAMED)).toHaveLength(0);
    await run("UPDATE users SET disabled_at = NULL WHERE id = 'owner-b'");
  });

  it("refuses a name that is not plain text before touching anything", async () => {
    await expect(settings("owner-a").renameWorkspace({ name: "A" })).rejects.toThrow(ZodError);
    await expect(settings("owner-a").renameWorkspace({ name: "Nome​oculto" })).rejects.toThrow(ZodError);
    await expect(settings("owner-a").renameWorkspace({ name: "Certo", organizationId: "org-b" })).rejects.toThrow(ZodError);
    expect(await workspaceName()).toBe("Studio Alfa");
  });
});

describe("renaming oneself", () => {
  it("lets each professional change only their own display name, with a trail", async () => {
    expect(await settings("tech-a").renameSelf({ name: "Técnica   Alfa" }, NOW)).toEqual({ status: "renamed" });
    expect(await displayName("tech-a")).toBe("Técnica Alfa");
    // Nobody else's changed.
    expect(await displayName("owner-a")).toBe("Dona A");
    expect(await displayName("owner-b", "org-b")).toBe("Dono B");
    expect(await trail(PROFESSIONAL_RENAMED)).toEqual([{ org: "org-a", actor: "tech-a", subject: "pro-tech-a", at: NOW.toISOString() }]);
  });

  it("does nothing for the same name, a member with no professional record, or a person without access", async () => {
    expect(await settings("tech-a").renameSelf({ name: "Técnica Alfa" }, NOW)).toEqual({ status: "unchanged" });
    for (const who of ["commercial-a", "gone-a", "owner-off", "blocked-a"])
      expect(await settings(who).renameSelf({ name: "Outro nome" }, NOW), who).toEqual({ status: "forbidden" });
    expect(await settings("owner-b", "org-a").renameSelf({ name: "Outro nome" }, NOW)).toEqual({ status: "forbidden" });
    expect(await trail(PROFESSIONAL_RENAMED)).toHaveLength(1);
    for (const user of ["owner-a", "gone-a", "blocked-a", "owner-off"]) expect(await displayName(user)).not.toBe("Outro nome");
  });

  it("changes how a delivery names its professional, never the delivered revision itself", async () => {
    // The name is read where it is shown; the prescription does not carry a copy of it.
    const columns = (await db.prepare("PRAGMA table_info(plan_revisions)").all<{ name: string }>()).results.map((row) => row.name);
    expect(columns).not.toContain("delivered_by_name");
    expect(columns).toContain("delivered_by_user_id");
  });
});
