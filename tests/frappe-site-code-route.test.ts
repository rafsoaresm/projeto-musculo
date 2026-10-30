import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sitesFor } from "@/db/sites";
import { codeDocument, codePolicy } from "@/modules/frappe-site/code";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// The page of the new editor and the frames of its free code, called as the platform calls them (a Request and the route's params), on a real local D1
// with the real migrations. The Cloudflare context is the only thing replaced.
const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: state.env }) }));

import { GET as page } from "@/app/site/[slug]/[[...path]]/route";
import { GET as frame } from "@/app/site/[slug]/m/codigo/[page]/[n]/route";

let mf: Miniflare;
let db: D1Database;

const raw = (innerHTML: string, more: Record<string, unknown> = {}) => ({ blockId: crypto.randomUUID().slice(0, 8), originalElement: "__raw_html__", element: "div", innerHTML, ...more });
const body = (...children: unknown[]) => JSON.stringify([{ blockId: "root", originalElement: "body", element: "div", children }]);
const put = (org: string, name: string, data: Record<string, unknown>) =>
  db
    .prepare("INSERT OR REPLACE INTO builder_docs(organization_id, doctype, name, data, created_by, updated_by) VALUES (?1, 'Builder Page', ?2, ?3, 'user-a', 'user-a')")
    .bind(org, name, JSON.stringify({ doctype: "Builder Page", name, ...data }));
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();

const CALC = '<div id="calc"></div><script>document.getElementById("calc").textContent = String(6 * 7)</script>';
const get = (slug: string, name: string, n: string, headers: Record<string, string> = {}) =>
  frame(new Request(`https://example.test/site/${slug}/m/codigo/${name}/${n}`, { headers }), { params: Promise.resolve({ slug, page: name, n }) });
const open = (slug: string, path?: string[]) => page(new Request(`https://example.test/site/${slug}`), { params: Promise.resolve({ slug, path }) });

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "frappe-site-code-route-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  await db.batch([
    db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES ('user-a','A','a@example.test',0,0),('user-s','S','s@example.test',0,0),('user-b','B','b@example.test',0,0)"),
    db.prepare("INSERT INTO users(id) VALUES ('user-a'),('user-s'),('user-b')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      "INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES ('org-a','user-a','OWNER',NULL),('org-a','user-s','COMMERCIAL',NULL),('org-b','user-b','OWNER',NULL)",
    )
  ]);
  // The sites are made the way the app makes them (with the draft that goes with each).
  await sitesFor(db, { userId: "user-a", organizationId: "org-a" }).create({ slug: "marina-a", title: "Marina A" });
  await sitesFor(db, { userId: "user-b", organizationId: "org-b" }).create({ slug: "marina-b", title: "Marina B" });
  await db.batch([
    put("org-a", "home", {
      route: "home",
      published: 1,
      published_at: "2026-10-01T10:00:00Z",
      blocks: body(
        { blockId: "t", element: "p", innerHTML: "Calculadora" },
        raw(CALC, { baseStyles: { width: "300px", height: "120px" } }),
        raw('<svg viewBox="0 0 4 4"><path d="M0 0 L4 4"/></svg>'),
        raw('<script src="https://cdn.test/widget.js"></script><div id="w"></div>'),
        { blockId: "y", element: "iframe", attributes: { src: "https://www.youtube.com/embed/abc", allow: "autoplay; fullscreen" } },
      ),
      draft_blocks: body(raw("<p>RASCUNHO SECRETO</p><script>draft()</script>")),
    }),
    put("org-a", "so-rascunho", { route: "rascunho", published: 0, blocks: body(raw("<p>nunca publicado</p><script>nunca()</script>")), draft_blocks: body(raw("<p>x</p><script>x()</script>")) }),
    put("org-a", "dinamica", { route: "blog/:slug", published: 1, dynamic_route: 1, blocks: body(raw("<p>dinâmica</p><script>dinamica()</script>")) }),
    put("org-a", "componentes", { route: "componentes", published: 1, published_at: "2026-10-02T10:00:00Z", blocks: body({ blockId: "i", extendedFromComponent: "calc", element: "div", children: [{ blockId: "inner" }] }) }),
    put("org-b", "home", { route: "home", published: 1, published_at: "2026-10-01T10:00:00Z", blocks: body(raw("<p>DO OUTRO ESTÚDIO</p><script>outro()</script>")) }),
  ]);
  await db
    .prepare("INSERT INTO builder_docs(organization_id, doctype, name, data, created_by, updated_by) VALUES ('org-a', 'Builder Component', 'calc', ?1, 'user-a', 'user-a')")
    .bind(JSON.stringify({ doctype: "Builder Component", name: "calc", block: JSON.stringify({ blockId: "calc", element: "div", children: [raw("<b>do componente</b><script>componente()</script>", { blockId: "inner" })] }) }))
    .run();
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  state.env = { DB: db };
  await db.prepare("UPDATE sites SET code_external_open = 0").run();
});

describe("the page: free code is a frame, and the code is not in the page", () => {
  it("draws each block of code as a frame of the site itself, written from where the page is, and the page holds none of the code", async () => {
    const html = await (await open("marina-a")).text();
    const frames = [...html.matchAll(/<iframe src="([^"]+)"[^>]*>/g)].map((match) => match[1]);
    expect(frames).toEqual(["../site/marina-a/m/codigo/home/0", "../site/marina-a/m/codigo/home/1", "../site/marina-a/m/codigo/home/2"]);
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toMatch(/6 \* 7|getElementById|widget\.js|youtube|RASCUNHO/);
    expect(html).toContain("Calculadora");
    expect(html).toContain("<svg viewbox"); // the drawing is in the page
    const deeper = await (await open("marina-a", ["componentes"])).text();
    expect(deeper).toContain('<iframe src="../../site/marina-a/m/codigo/componentes/0"'); // from a page one level down
  });

  it("every frame of the page is served, with the code that the block holds, in the order of the page", async () => {
    expect(await (await get("marina-a", "home", "0")).text()).toBe(codeDocument(CALC));
    expect(await (await get("marina-a", "home", "1")).text()).toBe(codeDocument('<script src="https://cdn.test/widget.js"></script><div id="w"></div>'));
    const video = await (await get("marina-a", "home", "2")).text();
    expect(video).toContain('<iframe src="https://www.youtube.com/embed/abc"');
    expect(video).toContain('allow="autoplay; fullscreen"');
    expect(await (await get("marina-a", "componentes", "0")).text()).toContain("<b>do componente</b>");
  });
});

describe("the frame is walled in", () => {
  it("answers with a sandbox that has no origin of the site, nothing fetched from anywhere, and nothing that lets it be framed by another site", async () => {
    const answered = await get("marina-a", "home", "0");
    expect(answered.status).toBe(200);
    expect(answered.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(answered.headers.get("content-security-policy")).toBe(codePolicy(false));
    expect(answered.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(answered.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(answered.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(answered.headers.get("x-content-type-options")).toBe("nosniff");
    expect(answered.headers.get("referrer-policy")).toBe("no-referrer");
    expect(answered.headers.get("cache-control")).toBe("public, no-cache");
    expect(answered.headers.get("set-cookie")).toBeNull();
  });

  it("follows the switch of the site: closed by default, https: when the site opened the network, and the next request says so", async () => {
    const closed = await get("marina-a", "home", "1");
    expect(closed.headers.get("content-security-policy")).toBe(codePolicy(false));
    await db.prepare("UPDATE sites SET code_external_open = 1 WHERE slug = 'marina-a'").run();
    const opened = await get("marina-a", "home", "1");
    expect(opened.headers.get("content-security-policy")).toBe(codePolicy(true));
    expect(opened.headers.get("content-security-policy")).toContain("connect-src https:");
    expect(opened.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(opened.headers.get("etag")).not.toBe(closed.headers.get("etag"));
    // the other site's frames are not touched by it
    expect((await get("marina-b", "home", "0")).headers.get("content-security-policy")).toBe(codePolicy(false));
  });

  it("answers an unchanged frame with a small 304, and a changed one with the new code at the next request", async () => {
    const first = await get("marina-a", "home", "0");
    const etag = first.headers.get("etag")!;
    expect((await get("marina-a", "home", "0", { "if-none-match": etag })).status).toBe(304);
    const row = await one<{ data: string }>("SELECT data FROM builder_docs WHERE organization_id = 'org-a' AND name = 'componentes'");
    try {
      const edited = JSON.parse(row!.data) as { blocks: string };
      edited.blocks = body(raw("<p>NOVO CÓDIGO</p><script>novo()</script>"));
      await db.prepare("UPDATE builder_docs SET data = ?1 WHERE organization_id = 'org-a' AND name = 'componentes'").bind(JSON.stringify({ ...edited })).run();
      const next = await get("marina-a", "componentes", "0", { "if-none-match": (await get("marina-a", "componentes", "0")).headers.get("etag")! });
      expect(next.status).toBe(304);
      await db.prepare("UPDATE builder_docs SET data = json_set(data, '$.blocks', ?1) WHERE organization_id = 'org-a' AND name = 'componentes'").bind(body(raw("<p>OUTRO</p><script>outro()</script>"))).run();
      const changed = await get("marina-a", "componentes", "0", { "if-none-match": next.headers.get("etag")! });
      expect(changed.status).toBe(200);
      expect(await changed.text()).toContain("OUTRO");
    } finally {
      await db.prepare("UPDATE builder_docs SET data = ?1 WHERE organization_id = 'org-a' AND name = 'componentes'").bind(row!.data).run();
    }
  });
});

describe("what is served is what is published, of that site", () => {
  it("never serves a draft, a page that is not published, a dynamic page, another organization's page, or a position that is not a block of the page", async () => {
    const draft = await (await get("marina-a", "home", "0")).text();
    expect(draft).not.toMatch(/RASCUNHO|draft\(\)/);
    const nothing = [
      get("marina-a", "so-rascunho", "0"),
      get("marina-a", "dinamica", "0"),
      get("marina-a", "nao-existe", "0"),
      get("marina-a", "home", "3"),
      get("marina-a", "home", "9"),
      get("marina-a", "home", "x"),
      get("marina-a", "home", "007x"),
      get("marina-a", "home", "100"),
      get("marina-a", "home", "-1"),
      get("marina-a", "..%2Fhome", "0"),
      get("marina-a", "a%2Fb", "0"),
      get("marina-a", "%00", "0"),
      get("marina-a", "%E0%A4%A", "0"),
      get("marina-a", "x".repeat(141), "0"),
      get("nao-existe", "home", "0"),
      get("Nao%20E%20Endereco", "home", "0"),
    ];
    for (const answered of await Promise.all(nothing)) {
      expect(answered.status).toBe(404);
      expect(await answered.text()).toBe("Página não encontrada.");
      expect(answered.headers.get("cache-control")).toBe("no-store");
    }
    // the same page name in another organization is another page
    expect(await (await get("marina-b", "home", "0")).text()).toContain("DO OUTRO ESTÚDIO");
    expect(await (await get("marina-a", "home", "0")).text()).not.toContain("DO OUTRO ESTÚDIO");
    expect((await get("marina-b", "home", "1")).status).toBe(404);
  });
});

describe("the switch of the site for what the free code may reach", () => {
  const owner = () => sitesFor(db, { userId: "user-a", organizationId: "org-a" });
  it("is born closed, is opened and closed by the owner, and each change is in the audit trail once", async () => {
    expect((await owner().overview())?.code).toEqual({ externalOpen: false });
    expect(await owner().setCodeExternalOpen(true)).toEqual({ status: "saved", open: true });
    expect((await owner().overview())?.code).toEqual({ externalOpen: true });
    expect(await owner().setCodeExternalOpen(true)).toEqual({ status: "saved", open: true }); // already so: nothing more is written
    expect(await owner().setCodeExternalOpen(false)).toEqual({ status: "saved", open: false });
    const trail = await db.prepare("SELECT action FROM access_audit_events WHERE organization_id = 'org-a' AND action LIKE 'SITE_CODE_NETWORK_%' ORDER BY created_at, rowid").all<{ action: string }>();
    expect(trail.results.map((row) => row.action)).toEqual(["SITE_CODE_NETWORK_OPENED", "SITE_CODE_NETWORK_CLOSED"]);
  });

  it("is not for the commercial role (who reads the site), for a login of another organization, or for a site that does not exist", async () => {
    const commercial = sitesFor(db, { userId: "user-s", organizationId: "org-a" });
    expect(await commercial.setCodeExternalOpen(true)).toEqual({ status: "not_found" });
    const stranger = sitesFor(db, { userId: "user-b", organizationId: "org-a" });
    expect(await stranger.setCodeExternalOpen(true)).toEqual({ status: "not_found" });
    expect(await one("SELECT code_external_open AS open FROM sites WHERE slug = 'marina-a'")).toEqual({ open: 0 });
    // the other organization's own owner changes only its own site
    expect(await sitesFor(db, { userId: "user-b", organizationId: "org-b" }).setCodeExternalOpen(true)).toEqual({ status: "saved", open: true });
    expect(await one("SELECT slug FROM sites WHERE code_external_open = 1")).toEqual({ slug: "marina-b" });
    await db.prepare("UPDATE sites SET code_external_open = 0").run();
    expect(await sitesFor(db, { userId: "user-a", organizationId: "org-nenhuma" }).setCodeExternalOpen(true)).toEqual({ status: "not_found" });
  });
});
