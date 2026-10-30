import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sitesFor } from "@/db/sites";
import { contentOnTheAir, PANEL_PAGES_MAX } from "@/modules/meu-site/new-editor-forms";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration. The switch of the free code is the site's own (owner and manager write it; it is read at each request of a frame),
// and the panel reads the pages on the air the way the public page does.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId: string) => ({ userId, organizationId });
const T0 = new Date("2026-10-30T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string, ...binds: unknown[]) => (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM (${sql})`, ...binds))!.c;

const raw = (innerHTML: string) => ({ blockId: crypto.randomUUID().slice(0, 8), originalElement: "__raw_html__", element: "div", innerHTML });
const body = (...children: unknown[]) => JSON.stringify([{ blockId: "root", originalElement: "body", element: "div", children }]);
const put = (org: string, name: string, data: Record<string, unknown>) =>
  db
    .prepare("INSERT OR REPLACE INTO builder_docs(organization_id, doctype, name, data, created_by, updated_by) VALUES (?1, 'Builder Page', ?2, ?3, 'owner-a', 'owner-a')")
    .bind(org, name, JSON.stringify({ doctype: "Builder Page", name, published_at: "2026-10-01T10:00:00Z", ...data }));
const page = (name: string, route: string, title = name) => ({ name, route, title });

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "site-code-network-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "manager-a", "commercial-a", "tech-a", "owner-b", "blocked-a"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.filter((p) => p !== "blocked-a").map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO users(id, disabled_at) VALUES ('blocked-a', '2026-10-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','A'),('org-b','B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','manager-a','MANAGER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),('org-a','tech-a','TECHNICAL',NULL),
       ('org-a','blocked-a','MANAGER',NULL),('org-b','owner-b','OWNER',NULL)`,
    ),
  ]);
  expect(await sitesFor(db, scope("owner-a", "org-a")).create({ slug: "marina-a", title: "Marina A" }, at(-10))).toEqual({ status: "created" });
  expect(await sitesFor(db, scope("owner-b", "org-b")).create({ slug: "studio-b", title: "Studio B" }, at(-10))).toEqual({ status: "created" });
});
afterAll(async () => {
  await mf?.dispose();
});

describe("the switch of what the free code may reach outside the site", () => {
  it("is born closed, and the owner and a manager turn it on and off, with a line in the trail each time", async () => {
    expect((await sitesFor(db, scope("owner-b", "org-b")).overview())!.code).toEqual({ externalOpen: false });
    const repo = sitesFor(db, scope("owner-b", "org-b"));
    expect(await repo.setCodeExternalOpen(true, at(1))).toEqual({ status: "saved", open: true });
    expect((await repo.overview())!.code.externalOpen).toBe(true);
    expect(await repo.setCodeExternalOpen(false, at(2))).toEqual({ status: "saved", open: false });
    expect((await repo.overview())!.code.externalOpen).toBe(false);
    const trail = await db.prepare("SELECT action FROM access_audit_events WHERE organization_id = 'org-b' AND action LIKE 'SITE_CODE_NETWORK_%' ORDER BY created_at, rowid").all<{ action: string }>();
    expect(trail.results.map((row) => row.action)).toEqual(["SITE_CODE_NETWORK_OPENED", "SITE_CODE_NETWORK_CLOSED"]);
    expect(await sitesFor(db, scope("manager-a", "org-a")).setCodeExternalOpen(true, at(3))).toEqual({ status: "saved", open: true });
    expect((await sitesFor(db, scope("owner-a", "org-a")).overview())!.code.externalOpen).toBe(true);
    expect(await sitesFor(db, scope("owner-a", "org-a")).setCodeExternalOpen(false, at(4))).toEqual({ status: "saved", open: false });
  });

  it("does not write a line when it already was so, and is not for a commercial member, a technical one, a blocked login or a stranger", async () => {
    const trail = () => count("SELECT 1 FROM access_audit_events WHERE organization_id = 'org-a' AND action LIKE 'SITE_CODE_NETWORK_%'");
    const before = await trail();
    expect((await sitesFor(db, scope("owner-a", "org-a")).setCodeExternalOpen(false, at(5))).status).toBe("saved");
    expect(await trail()).toBe(before);
    for (const who of ["commercial-a", "tech-a", "blocked-a"]) {
      expect((await sitesFor(db, scope(who, "org-a")).setCodeExternalOpen(true, at(6))).status, who).toBe("not_found");
    }
    // Someone of another organization asking for this one's site writes nothing there.
    expect((await sitesFor(db, scope("owner-b", "org-a")).setCodeExternalOpen(true, at(6))).status).toBe("not_found");
    expect((await sitesFor(db, scope("owner-a", "org-a")).overview())!.code.externalOpen).toBe(false);
    expect(await trail()).toBe(before);
  });

  it("is a switch of the site only: it does not touch the switch of the messages or the other site", async () => {
    const repo = sitesFor(db, scope("owner-a", "org-a"));
    await repo.setInquiriesOpen(true, at(7));
    await repo.setCodeExternalOpen(true, at(8));
    expect((await repo.overview())!.inquiries.open).toBe(true);
    expect((await sitesFor(db, scope("owner-b", "org-b")).overview())!.code.externalOpen).toBe(false);
    await repo.setCodeExternalOpen(false, at(9));
    await repo.setInquiriesOpen(false, at(9));
  });
});

describe("what the panel says of the pages on the air", () => {
  it("counts the blocks of free code of each page, and which of them ask for something outside; text and drawings are not code", async () => {
    await db.batch([
      put("org-a", "home", {
        route: "home",
        published: 1,
        blocks: body(
          { blockId: "t", element: "p", innerHTML: "Texto" },
          raw('<div id="a"></div><script>run()</script>'),
          raw('<script src="https://cdn.test/x.js"></script>'),
          raw('<svg viewBox="0 0 4 4"><path d="M0 0"/></svg>'),
          raw("<p>—Aldous <b>Huxley</b>,</p>"),
          { blockId: "y", element: "iframe", attributes: { src: "https://www.youtube.com/embed/abc" } },
        ),
      }),
      put("org-a", "sobre", { route: "sobre", published: 1, blocks: body({ blockId: "t", element: "p", innerHTML: "Só texto" }, raw("<p>marcado</p>")) }),
      put("org-a", "rascunho", { route: "rascunho", published: 0, blocks: body(raw("<script>x()</script>")) }),
      put("org-b", "home", { route: "home", published: 1, blocks: body(raw("<script>do-outro()</script>")) }),
    ]);
    const read = await contentOnTheAir(db, "marina-a", [page("home", "home", "Início"), page("sobre", "sobre"), page("rascunho", "rascunho"), page("fantasma", "nao-existe")]);
    // the title is the one the panel was given (the page's name in the editor), not the address
    expect(read.code).toEqual([{ route: "home", title: "Início", blocks: 3, external: 2 }]);
    expect(read.forms).toEqual([]);
    expect(read.skipped).toBe(0);
  });

  it("reads only the pages of that site: a page of another organization with the same name is not read, and the drafts of a page are not what is counted", async () => {
    const mine = await contentOnTheAir(db, "marina-a", [page("home", "home")]);
    const theirs = await contentOnTheAir(db, "studio-b", [page("home", "home")]);
    expect(mine.code).toEqual([{ route: "home", title: "home", blocks: 3, external: 2 }]);
    expect(theirs.code).toEqual([{ route: "home", title: "home", blocks: 1, external: 0 }]);
    await db.prepare("UPDATE builder_docs SET data = json_set(data, '$.draft_blocks', ?1) WHERE organization_id = 'org-a' AND name = 'home'").bind(body(raw("<script>rascunho()</script>"), raw("<script>outro()</script>"))).run();
    expect((await contentOnTheAir(db, "marina-a", [page("home", "home")])).code[0]).toEqual({ route: "home", title: "home", blocks: 3, external: 2 });
  });

  it(`reads at most ${PANEL_PAGES_MAX} pages and says how many were left`, async () => {
    // the page after the twentieth has code, and is on the air: it is not read
    await put("org-a", `p${PANEL_PAGES_MAX}`, { route: `p${PANEL_PAGES_MAX}`, published: 1, blocks: body(raw("<script>depois()</script>")) }).run();
    const pages = Array.from({ length: PANEL_PAGES_MAX + 3 }, (_value, index) => page(`p${index}`, `p${index}`));
    const read = await contentOnTheAir(db, "marina-a", pages);
    expect(read.skipped).toBe(3);
    expect(read.code).toEqual([]);
    expect((await contentOnTheAir(db, "marina-a", [page(`p${PANEL_PAGES_MAX}`, `p${PANEL_PAGES_MAX}`)])).code).toHaveLength(1); // read when it is within the limit
  });
});
