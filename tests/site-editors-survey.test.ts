import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasContentInBoth, platformFor } from "@/db/platform";
import { sitesFor } from "@/db/sites";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration. The survey of decision D1 (handoff V4): which editor each site shows and where it has content, read by
// a platform manager only, as counts.
let mf: Miniflare;
let db: D1Database;
const T0 = new Date("2026-11-01T12:00:00.000Z");
const scope = (userId: string, organizationId: string) => ({ userId, organizationId });
const page = (org: string, name: string, published: boolean) =>
  db
    .prepare("INSERT INTO builder_docs(organization_id, doctype, name, data, created_by, updated_by) VALUES (?1, 'Builder Page', ?2, ?3, ?4, ?4)")
    .bind(org, name, JSON.stringify({ doctype: "Builder Page", name, published: published ? 1 : 0 }), `owner-${org.slice(-1)}`);

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "site-editors-survey-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["manager", "owner-a", "owner-b", "owner-c", "owner-d"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO platform_admins(user_id, created_at) VALUES ('manager', '2026-10-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Ana'),('org-b','Bia'),('org-c','Caio'),('org-d','Duda')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','owner-a','OWNER'),('org-b','owner-b','OWNER'),('org-c','owner-c','OWNER'),('org-d','owner-d','OWNER')"),
  ]);
  // A: guided only, saved twice. B: advanced only. C: both (guided saved, two advanced pages, one published). D: just created.
  for (const [org, slug, engine] of [["org-a", "ana", "native"], ["org-b", "bia", "frappe"], ["org-c", "caio", "native"], ["org-d", "duda", "native"]] as const)
    expect(await sitesFor(db, scope(`owner-${org.slice(-1)}`, org)).create({ slug, title: slug, engine }, T0)).toEqual({ status: "created" });
  const bump = (slug: string) => db.prepare("UPDATE site_drafts SET revision = revision + 1 WHERE site_id = (SELECT id FROM sites WHERE slug = ?1)").bind(slug);
  await db.batch([bump("ana"), bump("ana"), bump("caio"), page("org-b", "home", true), page("org-c", "home", true), page("org-c", "sobre", false)]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("the survey of the editors of the sites", () => {
  it("lists every site with what its main address shows and the counts of each editor, and points out the ones with content in both", async () => {
    const rows = await platformFor(db, { userId: "manager" }).listSiteEditors();
    expect(rows.map((row) => [row.organizationName, row.slug, row.engine, row.guidedSaves, row.guidedReleases, row.guidedLive, row.advancedPages, row.advancedPublished])).toEqual([
      ["Ana", "ana", "native", 3, 0, false, 0, 0],
      ["Bia", "bia", "frappe", 1, 0, false, 1, 1],
      ["Caio", "caio", "native", 2, 0, false, 2, 1],
      ["Duda", "duda", "native", 1, 0, false, 0, 0],
    ]);
    expect(rows.filter(hasContentInBoth).map((row) => row.slug)).toEqual(["caio"]);
  });

  it("answers nothing to anyone who is not a platform manager", async () => {
    expect(await platformFor(db, { userId: "owner-a" }).listSiteEditors()).toEqual([]);
  });
});
