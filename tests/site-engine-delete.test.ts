import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sitesFor } from "@/db/sites";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// The choice of the editor and the deletion of the whole site, on a real local D1 with the real migrations.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const sites = (who = "owner-a", org = "org-a") => sitesFor(db, scope(who, org));
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(`SELECT COUNT(*) AS c FROM (${sql})`).bind(...binds).first<{ c: number }>())!.c;
const sha = "0".repeat(64);

const publishedPage = (org: string, name: string, published = 1) =>
  db
    .prepare("INSERT INTO builder_docs(organization_id, doctype, name, data, created_by, updated_by) VALUES (?1, 'Builder Page', ?2, ?3, 'owner-a', 'owner-a')")
    .bind(org, name, JSON.stringify({ doctype: "Builder Page", name, page_title: name, route: name, published, published_at: "2026-10-01T10:00:00Z", blocks: "[]" }));

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "site-engine-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "commercial-a", "owner-b", "owner-c", "revoked-a"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B'),('org-c','Studio C')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),('org-b','owner-b','OWNER',NULL),('org-c','owner-c','OWNER',NULL),('org-a','revoked-a','MANAGER','2026-10-02T00:00:00.000Z')`,
    ),
  ]);
  expect(await sites("owner-b", "org-b").create({ slug: "studio-b", title: "Studio B" })).toEqual({ status: "created" });
  await db.batch([publishedPage("org-b", "home")]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("which editor a site is made in", () => {
  it("is the first one, until the owner chooses; a site can also be born in the new one", async () => {
    expect(await sites().create({ slug: "studio-a", title: "Studio A", engine: "frappe" })).toEqual({ status: "created" });
    expect((await sites().overview())?.site).toMatchObject({ slug: "studio-a", engine: "frappe" });
    expect((await sites("owner-b", "org-b").overview())?.site.engine).toBe("native");
    await expect(sites("owner-c", "org-c").create({ slug: "studio-c", title: "Studio C", engine: "other" })).rejects.toThrow();
    expect(await count("SELECT 1 FROM sites WHERE organization_id = 'org-c'")).toBe(0);
  });

  it("is changed to the new one only while one of its pages is published, and back to the first one at any time", async () => {
    expect(await sites("owner-b", "org-b").setEngine("frappe")).toEqual({ status: "changed", engine: "frappe" });
    expect((await sites("owner-b", "org-b").overview())?.site.engine).toBe("frappe");
    expect(await sites("owner-b", "org-b").setEngine("native")).toEqual({ status: "changed", engine: "native" });
    // org-a (born in the new editor) has no published page of it yet: the address would answer nothing, so the choice is refused, even when repeated
    await db.prepare("UPDATE sites SET engine = 'native' WHERE organization_id = 'org-a'").run();
    expect(await sites().setEngine("frappe")).toEqual({ status: "nothing_published" });
    await db.batch([publishedPage("org-a", "draft-page", 0)]);
    expect(await sites().setEngine("frappe")).toEqual({ status: "nothing_published" });
    await db.batch([publishedPage("org-a", "home")]);
    expect(await sites().setEngine("frappe")).toEqual({ status: "changed", engine: "frappe" });
    expect(await count("SELECT 1 FROM access_audit_events WHERE action = 'SITE_ENGINE_CHANGED' AND organization_id = 'org-a'")).toBeGreaterThanOrEqual(1);
  });

  it("is not changed by whoever may not write the site, and a page of another organization does not count", async () => {
    for (const who of ["commercial-a", "revoked-a"]) expect(await sites(who).setEngine("native"), who).toEqual({ status: "not_found" });
    expect((await sites().overview())?.site.engine).toBe("frappe");
    // org-c has a site made later and a published page only in org-b
    expect(await sites("owner-c", "org-c").create({ slug: "studio-c", title: "Studio C" })).toEqual({ status: "created" });
    expect(await sites("owner-c", "org-c").setEngine("frappe")).toEqual({ status: "nothing_published" });
  });

  it("is listed with the pages of the new editor: which are published and at what route", async () => {
    const overview = await sites().overview();
    expect(overview?.newEditor).toEqual({ published: [{ name: "home", route: "home", title: "home" }], pages: 2 });
    expect((await sites("owner-b", "org-b").overview())?.newEditor.pages).toBe(1);
  });
});

describe("deleting the whole site", () => {
  const addVersions = async (siteId: string, org: string) => {
    await db.batch([
      db.prepare("INSERT INTO site_releases(id, site_id, number, draft_revision, content, content_sha256, created_by) VALUES ('rel-1', ?1, 1, 1, '{}', ?2, 'owner-b')").bind(siteId, sha),
      db.prepare("INSERT INTO site_published(site_id, release_id, published_by) VALUES (?1, 'rel-1', 'owner-b')").bind(siteId),
      db.prepare("INSERT INTO site_assets(id, site_id, object_key, content_type, bytes, width, height, sha256, created_by) VALUES ('asset-1', ?1, 'sites/key/1.png', 'image/png', 10, 2, 2, ?2, 'owner-b')").bind(siteId, sha),
      db.prepare("INSERT INTO site_release_assets(release_id, asset_id, site_id) VALUES ('rel-1', 'asset-1', ?1)").bind(siteId),
      db
        .prepare("INSERT INTO builder_files(organization_id, id, object_key, file_name, content_type, bytes, width, height, sha256, created_by) VALUES (?1, ?2, 'sites/key/2.png', 'a.png', 'image/png', 10, 2, 2, ?3, 'owner-b')")
        .bind(org, crypto.randomUUID(), sha),
    ]);
  };

  it("needs the address typed again, the right to write the site and an empty inbox, and deletes nothing otherwise", async () => {
    const siteId = (await db.prepare("SELECT id FROM sites WHERE organization_id = 'org-b'").first<{ id: string }>())!.id;
    await addVersions(siteId, "org-b");
    expect(await sites("owner-b", "org-b").deleteSite("outro-endereco")).toEqual({ status: "confirmation_differs" });
    expect(await sites("owner-b", "org-b").deleteSite("")).toEqual({ status: "confirmation_differs" });
    expect(await sites("commercial-a", "org-b").deleteSite("studio-b")).toEqual({ status: "not_found" });
    await db
      .prepare("INSERT INTO site_inquiries(id, organization_id, site_id, name, email, email_key, notice_url) VALUES ('q1', 'org-b', ?1, 'Visitante', 'v@example.test', 'v@example.test', 'https://example.test/aviso')")
      .bind(siteId)
      .run();
    expect(await sites("owner-b", "org-b").deleteSite("studio-b")).toEqual({ status: "inquiries_waiting", count: 1 });
    expect(await count("SELECT 1 FROM sites WHERE id = ?", siteId)).toBe(1);
    expect(await count("SELECT 1 FROM site_releases WHERE site_id = ?", siteId)).toBe(1);
    await db.prepare("DELETE FROM site_inquiries WHERE id = 'q1'").run();
  });

  it("removes the site with everything of both editors, tells which objects to remove, leaves other organizations alone and can be started again", async () => {
    // org-a: a site of the new editor, with files and pages (and a first-editor draft behind it); org-b is the one with versions
    await db.prepare("INSERT INTO builder_files(organization_id, id, object_key, file_name, content_type, bytes, width, height, sha256, created_by) VALUES ('org-a', ?1, 'sites/org-a/editor/x.png', 'x.png', 'image/png', 1, 1, 1, ?2, 'owner-a')").bind(crypto.randomUUID(), sha).run();
    const before = {
      orgBDocs: await count("SELECT 1 FROM builder_docs WHERE organization_id = 'org-b'"),
      orgBFiles: await count("SELECT 1 FROM builder_files WHERE organization_id = 'org-b'"),
    };
    const result = await sites("owner-b", "org-b").deleteSite(" STUDIO-B ");
    expect(result.status).toBe("deleted");
    if (result.status !== "deleted") return;
    expect(result.objectKeys.sort()).toEqual(["sites/key/1.png", "sites/key/2.png"]);
    for (const table of ["sites", "site_drafts", "site_releases", "site_published", "site_assets", "site_release_assets", "builder_docs", "builder_files", "site_deletions"]) {
      const column = table === "sites" || table === "builder_docs" || table === "builder_files" ? "organization_id" : table === "site_deletions" ? "site_id" : "site_id";
      const where = table === "site_deletions" ? "" : column === "organization_id" ? " WHERE organization_id = 'org-b'" : " WHERE site_id IN (SELECT id FROM sites WHERE organization_id = 'org-b')";
      expect(await count(`SELECT 1 FROM ${table}${where}`), table).toBe(0);
    }
    expect(before.orgBDocs + before.orgBFiles).toBeGreaterThan(0);
    expect(await count("SELECT 1 FROM access_audit_events WHERE action = 'SITE_DELETED' AND organization_id = 'org-b'")).toBe(1);
    // the other organizations were not touched
    expect(await count("SELECT 1 FROM sites WHERE organization_id IN ('org-a','org-c')")).toBe(2);
    expect(await count("SELECT 1 FROM builder_docs WHERE organization_id = 'org-a'")).toBe(2);
    expect(await count("SELECT 1 FROM builder_files WHERE organization_id = 'org-a'")).toBe(1);
    // and it can be started again, with the same address
    expect(await sites("owner-b", "org-b").overview()).toBeNull();
    expect(await sites("owner-b", "org-b").create({ slug: "studio-b", title: "Studio B de novo", engine: "frappe" })).toEqual({ status: "created" });
  });

  it("does not lift what protects a version of a site that is not being deleted", async () => {
    const siteId = (await db.prepare("SELECT id FROM sites WHERE organization_id = 'org-c'").first<{ id: string }>())!.id;
    await db.batch([
      db.prepare("INSERT INTO site_releases(id, site_id, number, draft_revision, content, content_sha256, created_by) VALUES ('rel-c', ?1, 1, 1, '{}', ?2, 'owner-c')").bind(siteId, sha),
      db.prepare("INSERT INTO site_assets(id, site_id, object_key, content_type, bytes, width, height, sha256, created_by) VALUES ('asset-c', ?1, 'sites/key/c.png', 'image/png', 10, 2, 2, ?2, 'owner-c')").bind(siteId, sha),
      db.prepare("INSERT INTO site_release_assets(release_id, asset_id, site_id) VALUES ('rel-c', 'asset-c', ?1)").bind(siteId),
    ]);
    await expect(db.prepare("DELETE FROM site_releases WHERE id = 'rel-c'").run()).rejects.toThrow(/not deleted/);
    await expect(db.prepare("DELETE FROM site_release_assets WHERE release_id = 'rel-c'").run()).rejects.toThrow(/not deleted/);
    await expect(db.prepare("DELETE FROM site_assets WHERE id = 'asset-c'").run()).rejects.toThrow(/published version/);
    // a marker of another site does not open them
    await db.prepare("INSERT INTO site_deletions(site_id) VALUES ('someone-else')").run();
    await expect(db.prepare("DELETE FROM site_releases WHERE id = 'rel-c'").run()).rejects.toThrow(/not deleted/);
    await db.prepare("DELETE FROM site_deletions").run();
    expect(await count("SELECT 1 FROM site_releases WHERE id = 'rel-c'")).toBe(1);
  });
});
