import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicBuilderPage } from "@/db/builder-public";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// The public reading of the pages of the embedded editor, on a real local D1 with the real migrations: no session, an address and a route.
let mf: Miniflare;
let db: D1Database;

const put = (org: string, doctype: string, name: string, data: Record<string, unknown>) =>
  db
    .prepare("INSERT INTO builder_docs(organization_id, doctype, name, data, created_by, updated_by) VALUES (?1, ?2, ?3, ?4, 'user-a', 'user-a')")
    .bind(org, doctype, name, JSON.stringify({ doctype, name, ...data }));
const tree = (text: string, extra: Record<string, unknown> = {}) => JSON.stringify([{ blockId: "r", originalElement: "body", element: "div", children: [{ blockId: "t", element: "p", innerHTML: text, ...extra }] }]);

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "builder-public-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  await db.batch([
    db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES ('user-a','A','a@example.test',0,0)"),
    db.prepare("INSERT INTO users(id) VALUES ('user-a')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B'),('org-c','Studio C'),('org-d','Studio D')"),
    db.prepare("INSERT INTO sites(id, organization_id, slug, created_by) VALUES ('site-a','org-a','studio-a','user-a'),('site-b','org-b','studio-b','user-a'),('site-d','org-d','studio-d','user-a')"),
    // org-a: a home page and a page that is only a draft, a published one under a nested route, a dynamic one, a component with a nested one.
    put("org-a", "Builder Page", "home", { route: "home", published: 1, published_at: "2026-10-01T10:00:00Z", page_title: "Início", blocks: tree("publicado"), draft_blocks: tree("RASCUNHO SECRETO") }),
    put("org-a", "Builder Page", "draft-only", { route: "rascunho", published: 0, blocks: tree("nunca publicado"), draft_blocks: tree("x") }),
    put("org-a", "Builder Page", "nested", { route: "/servicos/personal/", published: 1, published_at: "2026-10-02T10:00:00Z", blocks: tree("serviço"), client_scripts: [{ builder_script: "estilo" }, { builder_script: "comportamento" }, { builder_script: "ausente" }] }),
    put("org-a", "Builder Page", "dynamic", { route: "blog/:slug", published: 1, dynamic_route: 1, blocks: tree("dinâmica") }),
    put("org-a", "Builder Page", "uses-components", {
      route: "componentes",
      published: 1,
      published_at: "2026-10-03T10:00:00Z",
      blocks: JSON.stringify([{ blockId: "r", originalElement: "body", children: [{ blockId: "i", extendedFromComponent: "card" }] }]),
    }),
    put("org-a", "Builder Component", "card", { block: JSON.stringify({ blockId: "card", element: "div", children: [{ blockId: "n", extendedFromComponent: "badge", innerHTML: "x" }] }) }),
    put("org-a", "Builder Component", "badge", { block: JSON.stringify({ blockId: "badge", element: "span", innerHTML: "selo" }) }),
    put("org-a", "Builder Component", "unused", { block: JSON.stringify({ blockId: "u", element: "div" }) }),
    put("org-a", "Builder Token", "brand", { value: "#0a5", dark_value: "#3c8" }),
    put("org-a", "Builder Token", "empty", { value: "" }),
    put("org-a", "Builder Settings", "Builder Settings", { home_page: "servicos/personal", favicon: "/s/studio-a/m/x" }),
    put("org-a", "Builder Client Script", "estilo", { script_type: "CSS", script: ".a { color: red }" }),
    put("org-a", "Builder Client Script", "comportamento", { script_type: "JavaScript", script: "alert(1)" }),
    // org-b has the same names and routes, with other content.
    put("org-b", "Builder Page", "home", { route: "home", published: 1, published_at: "2026-10-01T10:00:00Z", blocks: tree("do outro estúdio") }),
    put("org-b", "Builder Token", "brand", { value: "#f00" }),
    // org-d: an unpublished page that would be the home page, and a published one; org-b has a page with the NAME of one of org-a's, under another route.
    put("org-d", "Builder Page", "home", { route: "home", published: 0, blocks: tree("não publicada") }),
    put("org-d", "Builder Page", "sobre", { route: "sobre", published: 1, published_at: "2026-10-05T10:00:00Z", blocks: tree("sobre do d") }),
    put("org-b", "Builder Page", "nested", { route: "outro", published: 1, published_at: "2026-10-06T10:00:00Z", blocks: tree("do b") }),
    // org-c has a page but no site (no address to be reached by).
    put("org-c", "Builder Page", "home", { route: "home", published: 1, blocks: tree("sem endereço") }),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("the public reading of a published page", () => {
  it("answers the page of the route, from the published blocks only: the draft never leaves the database", async () => {
    const found = await publicBuilderPage(db, "studio-a", "servicos/personal");
    expect(found?.page.name).toBe("nested");
    expect(JSON.stringify(found)).not.toContain("RASCUNHO SECRETO");
    const other = await publicBuilderPage(db, "studio-a", "componentes");
    expect(other?.page.name).toBe("uses-components");
    const home = await publicBuilderPage(db, "studio-a", "home");
    expect(home?.page.name).toBe("home");
    expect(home?.page).not.toHaveProperty("draft_blocks");
    expect(JSON.stringify(home?.blocks)).toContain("publicado");
    expect(JSON.stringify(home?.blocks)).not.toContain("RASCUNHO");
  });

  it("picks the home page from the settings of the editor", async () => {
    const found = await publicBuilderPage(db, "studio-a", "");
    expect(found?.page.name).toBe("nested");
    expect(found?.route).toBe("servicos/personal");
  });

  it("does not show a page that is not published, a page with a dynamic route or a route that does not exist", async () => {
    expect(await publicBuilderPage(db, "studio-a", "rascunho")).toBeNull();
    expect(await publicBuilderPage(db, "studio-a", "blog/:slug")).toBeNull();
    expect(await publicBuilderPage(db, "studio-a", "blog/qualquer")).toBeNull();
    expect(await publicBuilderPage(db, "studio-a", "nao-existe")).toBeNull();
  });

  it("is not reached by another address: each site has its own pages, tokens and settings", async () => {
    const b = await publicBuilderPage(db, "studio-b", "home");
    expect(JSON.stringify(b?.blocks)).toContain("do outro estúdio");
    expect(b?.tokens).toEqual([{ name: "brand", value: "#f00", darkValue: null }]);
    expect(b?.settings).toEqual({});
    expect(await publicBuilderPage(db, "studio-b", "servicos/personal")).toBeNull();
    expect(await publicBuilderPage(db, "studio-b", "componentes")).toBeNull();
    const a = await publicBuilderPage(db, "studio-a", "home");
    expect(JSON.stringify(a)).not.toContain("outro estúdio");
  });

  it("does not let a page that is not published, or a page of another organization, take part in choosing the page", async () => {
    // the home address is the published page, not the draft that has the route of a home page
    expect((await publicBuilderPage(db, "studio-d", ""))?.page.name).toBe("sobre");
    expect(await publicBuilderPage(db, "studio-d", "home")).toBeNull();
    // a route of another organization is nothing here, even where this one has a page of the same name
    expect(await publicBuilderPage(db, "studio-b", "servicos/personal")).toBeNull();
    expect((await publicBuilderPage(db, "studio-b", "outro"))?.page.name).toBe("nested");
    expect(JSON.stringify((await publicBuilderPage(db, "studio-b", "outro"))?.blocks)).toContain("do b");
  });

  it("answers nothing for an address that is not one, that does not exist or that has no site", async () => {
    for (const slug of ["", "A", "../studio-a", "studio--a", "x".repeat(41), "nao-existe", "studio-c"]) expect(await publicBuilderPage(db, slug, ""), slug).toBeNull();
    expect((await publicBuilderPage(db, "STUDIO-A", "home"))?.page.name).toBe("home");
  });

  it("brings the components the page uses, and the ones those are made of, and no other", async () => {
    const found = await publicBuilderPage(db, "studio-a", "componentes");
    expect([...found!.components.keys()].sort()).toEqual(["badge", "card"]);
    expect(JSON.stringify(found!.components.get("badge"))).toContain("selo");
  });

  it("brings the variables and the settings, and of the scripts only the style sheets", async () => {
    const found = await publicBuilderPage(db, "studio-a", "servicos/personal");
    expect(found!.tokens).toEqual([{ name: "brand", value: "#0a5", darkValue: "#3c8" }]);
    expect(found!.settings.home_page).toBe("servicos/personal");
    expect(found!.styles).toEqual([".a { color: red }"]);
  });

  it("returns nothing of the organization: not its id, its name or who made the page", async () => {
    const text = JSON.stringify(await publicBuilderPage(db, "studio-a", "home"));
    expect(text).not.toMatch(/org-a|Studio A|user-a|created_by|updated_by/);
  });

  it("stops being public when the editor unpublishes the page, at the next reading", async () => {
    expect(await publicBuilderPage(db, "studio-a", "home")).not.toBeNull();
    await db.prepare("UPDATE builder_docs SET data = json_set(data, '$.published', 0) WHERE organization_id = 'org-a' AND name = 'home'").run();
    expect(await publicBuilderPage(db, "studio-a", "home")).toBeNull();
    await db.prepare("UPDATE builder_docs SET data = json_set(data, '$.published', 1) WHERE organization_id = 'org-a' AND name = 'home'").run();
    expect(await publicBuilderPage(db, "studio-a", "home")).not.toBeNull();
  });
});
