import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builderDocsFor } from "@/db/builder-docs";
import type { Doc } from "@/modules/frappe-editor/doc-query";
import { DOCTYPES } from "@/modules/frappe-editor/protocol";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with the real migrations. Identities are rows, as the server derives them from a verified session; the repository
// repeats membership, role and active login in each statement.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const docs = (who = "owner-a", org = "org-a") => builderDocsFor(db, scope(who, org), () => new Date("2026-10-30T12:00:00.000Z"));
const page = (name: string, rest: Record<string, unknown> = {}): Doc => ({ doctype: "Builder Page", name, page_title: name, ...rest });
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(`SELECT COUNT(*) AS c FROM (${sql})`).bind(...binds).first<{ c: number }>())!.c;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "builder-docs-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "manager-a", "commercial-a", "tech-a", "owner-b", "outsider", "blocked-a", "revoked-a"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.filter((p) => p !== "blocked-a").map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO users(id, disabled_at) VALUES ('blocked-a', '2026-10-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','manager-a','MANAGER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),
       ('org-a','tech-a','TECHNICAL',NULL),('org-b','owner-b','OWNER',NULL),
       ('org-a','blocked-a','MANAGER',NULL),('org-a','revoked-a','MANAGER','2026-10-02T00:00:00.000Z')`,
    ),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("who may keep documents of the editor", () => {
  it("lets the owner and the manager write and read, and nobody else", async () => {
    expect(await docs("owner-a").insert(page("by-owner"))).toBe("ok");
    expect(await docs("manager-a").insert(page("by-manager"))).toBe("ok");
    for (const who of ["commercial-a", "tech-a", "outsider", "blocked-a", "revoked-a"]) {
      expect(await docs(who).insert(page(`by-${who}`)), who).toBe("forbidden");
      expect(await docs(who).list("Builder Page"), who).toEqual([]);
      expect(await docs(who).get("Builder Page", "by-owner"), who).toBeNull();
      expect(await docs(who).replace(page("by-owner", { page_title: "stolen" })), who).toBe("forbidden");
      expect(await docs(who).remove("Builder Page", "by-owner"), who).toBe("forbidden");
      expect(await docs(who).rename("Builder Page", "by-owner", "by-thief"), who).toBe("forbidden");
    }
    expect((await docs("owner-a").get("Builder Page", "by-owner"))?.page_title).toBe("by-owner");
    expect(await count("SELECT 1 FROM builder_docs WHERE name LIKE 'by-%'")).toBe(2);
  });
  it("does not create a context out of nothing", () => {
    expect(() => builderDocsFor(db, null)).toThrow("AUTHENTICATION_REQUIRED");
    expect(() => builderDocsFor(db, { userId: "", organizationId: "org-a" })).toThrow("AUTHENTICATION_REQUIRED");
  });
});

describe("the organizations", () => {
  it("keep their documents apart: the same name in two organizations is two documents, and neither sees the other", async () => {
    expect(await docs("owner-a").insert(page("home", { page_title: "A" }))).toBe("ok");
    expect(await docs("owner-b", "org-b").insert(page("home", { page_title: "B" }))).toBe("ok");
    expect((await docs("owner-a").get("Builder Page", "home"))?.page_title).toBe("A");
    expect((await docs("owner-b", "org-b").get("Builder Page", "home"))?.page_title).toBe("B");
    expect((await docs("owner-b", "org-b").list("Builder Page")).map((entry) => entry.name)).toEqual(["home"]);
    await docs("owner-b", "org-b").replace(page("home", { page_title: "B2" }));
    expect((await docs("owner-a").get("Builder Page", "home"))?.page_title).toBe("A");
  });
  it("cannot be reached with the session of another organization", async () => {
    // A person of org-b who claims org-a: the membership predicate of the statement finds no membership.
    expect(await docs("owner-b", "org-a").insert(page("intruder"))).toBe("forbidden");
    expect(await docs("owner-b", "org-a").list("Builder Page")).toEqual([]);
    expect(await docs("owner-b", "org-a").remove("Builder Page", "home")).toBe("forbidden");
    expect((await docs("owner-a").get("Builder Page", "home"))?.page_title).toBe("A");
    expect(await docs("owner-b", "org-b").remove("Builder Page", "by-owner")).toBe("not_found");
  });
  it("keep their own count: one organization full of pages does not stop the other", async () => {
    const store = docs("owner-b", "org-b");
    for (let index = 0; index < DOCTYPES["Builder Component"]; index++) expect(await store.insert({ doctype: "Builder Component", name: `c${index}` })).toBe("ok");
    expect(await store.insert({ doctype: "Builder Component", name: "one-more" })).toBe("limit");
    expect(await docs("owner-a").insert({ doctype: "Builder Component", name: "fits" })).toBe("ok");
  });
});

describe("a document", () => {
  it("is stored as it is given, listed by its type, and found by its name", async () => {
    const doc = page("rich", { draft_blocks: '[{"blockId":"root"}]', nested: { a: [1, 2, { b: "ç" }] } });
    expect(await docs().insert(doc)).toBe("ok");
    expect(await docs().get("Builder Page", "rich")).toEqual(doc);
    expect((await docs().list("Builder Page")).map((entry) => entry.name)).toContain("rich");
    expect((await docs().list("Builder Component")).map((entry) => entry.name)).not.toContain("rich");
    expect(await docs().get("Builder Component", "rich")).toBeNull();
    const row = await db.prepare("SELECT created_by, updated_by, created_at FROM builder_docs WHERE organization_id = 'org-a' AND name = 'rich'").first<{ created_by: string; updated_by: string; created_at: string }>();
    expect(row).toEqual({ created_by: "owner-a", updated_by: "owner-a", created_at: "2026-10-30T12:00:00.000Z" });
  });
  it("is not created twice, and a name is free again once it is deleted", async () => {
    expect(await docs().insert(page("twice"))).toBe("ok");
    expect(await docs().insert(page("twice"))).toBe("exists");
    expect(await docs().remove("Builder Page", "twice")).toBe("ok");
    expect(await docs().remove("Builder Page", "twice")).toBe("not_found");
    expect(await docs().insert(page("twice"))).toBe("ok");
  });
  it("is replaced as a whole by whoever edits, and who did it is written down", async () => {
    expect(await docs("owner-a").insert(page("shared", { page_title: "v1" }))).toBe("ok");
    expect(await docs("manager-a").replace(page("shared", { page_title: "v2" }))).toBe("ok");
    expect((await docs().get("Builder Page", "shared"))?.page_title).toBe("v2");
    expect((await db.prepare("SELECT created_by, updated_by FROM builder_docs WHERE name = 'shared'").first())).toEqual({ created_by: "owner-a", updated_by: "manager-a" });
    expect(await docs().replace(page("never-made"))).toBe("not_found");
  });
  it("is renamed to a free name, with its name inside the document changed too, and not to a name that is taken", async () => {
    expect(await docs().insert(page("old-name"))).toBe("ok");
    expect(await docs().insert(page("taken"))).toBe("ok");
    expect(await docs().rename("Builder Page", "old-name", "taken")).toBe("exists");
    expect(await docs().rename("Builder Page", "nope", "free")).toBe("not_found");
    expect(await docs().rename("Builder Page", "old-name", "new-name")).toBe("ok");
    expect((await docs().get("Builder Page", "new-name"))?.name).toBe("new-name");
    expect(await docs().get("Builder Page", "old-name")).toBeNull();
    expect(await docs().rename("Builder Page", "new-name", "new-name")).toBe("ok");
    // The same name in another organization is not "taken".
    expect(await docs("owner-b", "org-b").insert(page("elsewhere"))).toBe("ok");
    expect(await docs().insert(page("here"))).toBe("ok");
    expect(await docs().rename("Builder Page", "here", "elsewhere")).toBe("ok");
  });
  it("is of a type the database knows, with a name and a size the database accepts", async () => {
    expect(await docs().insert({ doctype: "User", name: "x" })).toBe("forbidden");
    await expect(db.prepare("INSERT INTO builder_docs (organization_id, doctype, name, data, created_by, updated_by) VALUES ('org-a','User','x','{}','owner-a','owner-a')").run()).rejects.toThrow();
    await expect(db.prepare("INSERT INTO builder_docs (organization_id, doctype, name, data, created_by, updated_by) VALUES ('org-a','Builder Page','','{}','owner-a','owner-a')").run()).rejects.toThrow();
    await expect(db.prepare("INSERT INTO builder_docs (organization_id, doctype, name, data, created_by, updated_by) VALUES ('org-a','Builder Page','bad','not json','owner-a','owner-a')").run()).rejects.toThrow();
    await expect(
      db.prepare("INSERT INTO builder_docs (organization_id, doctype, name, data, created_by, updated_by) VALUES ('org-a','Builder Page','huge',?,'owner-a','owner-a')").bind(JSON.stringify({ x: "y".repeat(1_500_001) })).run(),
    ).rejects.toThrow();
    await expect(db.prepare("INSERT INTO builder_docs (organization_id, doctype, name, data, created_by, updated_by) VALUES ('org-none','Builder Page','x','{}','owner-a','owner-a')").run()).rejects.toThrow();
  });
});
