import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { publishedSiteBySlug, sitesFor } from "@/db/sites";
import { publicTrackingBySlug, siteTrackingFor, SITE_TRACKING_CHANGED } from "@/db/site-tracking";
import { PUBLIC_CSP } from "@/modules/frappe-site/document";
import type { SiteContent } from "@/modules/meu-site/contracts";
import { PublicSitePage } from "@/modules/meu-site/public-site";
import { EMPTY_TRACKING, readTracking, type TrackingSettings } from "@/modules/meu-site/tracking";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// The tagging of the site (Meu Site 0.71) on a real local D1 with every migration: who reads and writes it, the trail, the public reading, and the
// routes that use it, called as the platform calls them (only the Cloudflare context is replaced: it gives the D1 and the environment).
const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: state.env }) }));

import { GET as script } from "@/app/s/[slug]/m/rastreio/route";
import { POST as guidedPost } from "@/app/s/[slug]/m/contato/route";
import { GET as guidedThanks } from "@/app/s/[slug]/m/enviado/route";
import { GET as frappePage } from "@/app/site/[slug]/[[...path]]/route";
import { POST as frappePost } from "@/app/site/[slug]/m/contato/route";
import { GET as frappeThanks } from "@/app/site/[slug]/m/enviado/route";

let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId: string) => ({ userId, organizationId });
const NOTICE = "https://example.test/aviso-de-privacidade";
const OPEN = { PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: NOTICE, AUTH_SECRET: "segredo-de-teste-com-mais-de-32-caracteres" };
const T0 = new Date("2026-11-02T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const trail = async (org: string) =>
  (await db.prepare("SELECT action, actor_user_id AS actor FROM access_audit_events WHERE organization_id = ? AND action = ? ORDER BY created_at, rowid").bind(org, SITE_TRACKING_CHANGED).all<{ action: string; actor: string }>()).results;

const settings = (input: Record<string, string>): TrackingSettings => {
  const read = readTracking(input);
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.value;
};
const FULL = { ga4: "G-AB12CD34EF", adsId: "AW-123456789", adsLabelLead: "LeadLabel1", adsLabelContact: "Contato_22", meta: "123456789012345", leadValue: "150", privacyUrl: "https://marina.com.br/privacidade", count_form: "on", count_whatsapp: "on" };

const content = (): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks: [
    { id: "h1", type: "hero", eyebrow: "", heading: "Treino sob medida", subheading: "", buttonLabel: "Falar comigo", buttonChannel: "whatsapp" },
    { id: "f1", type: "contactForm", eyebrow: "", heading: "Escreva para mim", text: "", buttonLabel: "Enviar mensagem" },
  ],
  pages: [{ id: "p1", slug: "planos", title: "Planos", description: "", blocks: [{ id: "t1", type: "paragraph", text: "Planos" }] }],
});

// A page of the advanced editor with a form (the same shape as tests/frappe-site-form-route.test.ts).
const node = (element: string, attributes: Record<string, string> = {}, more: Record<string, unknown> = {}) => ({ blockId: crypto.randomUUID().slice(0, 8), element, attributes, ...more });
const body = (...children: unknown[]) => JSON.stringify([{ blockId: "root", originalElement: "body", element: "div", baseStyles: { display: "flex" }, children }]);
const contactForm = () =>
  node("form", {}, {
    blockId: "contact-form",
    children: [node("input", { type: "text", placeholder: "Seu nome" }), node("input", { type: "email", placeholder: "E-mail" }), node("textarea", { placeholder: "Mensagem" }), node("button", {}, { innerHTML: "Enviar" })],
  });
const hiddenOf = (html: string, name: string) => new RegExp(`<input type="hidden" name="${name}" value="([^"]*)">`).exec(html)?.[1] ?? "";
const nameOf = (html: string, hint: string) => new RegExp(`<[a-z]+ [^>]*placeholder="${hint}"[^>]*name="(f\\d+)"|<[a-z]+ [^>]*name="(f\\d+)"[^>]*placeholder="${hint}"`).exec(html)?.slice(1).find(Boolean) ?? "";

const params = <P extends Record<string, unknown>>(value: P) => ({ params: Promise.resolve(value) });
const form = (url: string, fields: Record<string, string>) =>
  new Request(url, { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
const openFrappe = (slug: string, path?: string[], headers: Record<string, string> = {}) =>
  frappePage(new Request(`https://example.test/site/${slug}${path ? `/${path.join("/")}` : ""}`, { headers }), params({ slug, path }));
const getScript = (slug: string, headers: Record<string, string> = {}) => script(new Request(`https://example.test/s/${slug}/m/rastreio`, { headers }), params({ slug }));

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "site-tracking-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "manager-a", "commercial-a", "tech-a", "owner-b", "blocked-a", "owner-f"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.filter((p) => p !== "blocked-a").map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO users(id, disabled_at) VALUES ('blocked-a', '2026-10-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','A'),('org-b','B'),('org-f','F'),('org-n','N')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','manager-a','MANAGER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),('org-a','tech-a','TECHNICAL',NULL),
       ('org-a','blocked-a','MANAGER',NULL),('org-b','owner-b','OWNER',NULL),('org-f','owner-f','OWNER',NULL),('org-n','owner-b','OWNER','2026-10-01T00:00:00.000Z')`,
    ),
  ]);
  const repo = sitesFor(db, scope("owner-a", "org-a"));
  expect(await repo.create({ slug: "marina-a", title: "Marina Treinos" }, at(-10))).toEqual({ status: "created" });
  const draft = (await repo.overview())!.draft;
  const saved = await repo.saveDraft(content(), draft.revision);
  if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
  const published = await repo.publish(saved.revision, at(-9), { withWarnings: true });
  if (published.status !== "published") throw new Error(JSON.stringify(published));
  await repo.setInquiriesOpen(true);
  expect(await sitesFor(db, scope("owner-b", "org-b")).create({ slug: "studio-b", title: "Studio B" }, at(-10))).toEqual({ status: "created" });
  // The advanced editor's site: a page with a form, and a home page.
  await db.batch([
    db.prepare("INSERT INTO sites(id, organization_id, slug, created_by, inquiries_open, engine) VALUES ('site-f','org-f','frappe-f','owner-f',1,'frappe')"),
    ...[
      ["contato", { route: "contato", published: 1, published_at: "2026-10-01T10:00:00Z", blocks: body(node("h1", {}, { innerHTML: "Fale comigo" }), contactForm()) }],
      ["home", { route: "home", published: 1, published_at: "2026-10-03T10:00:00Z", blocks: body(node("a", { href: "https://wa.me/5511912345678" }, { innerHTML: "WhatsApp" })) }],
    ].map(([name, data]) =>
      db
        .prepare("INSERT INTO builder_docs(organization_id, doctype, name, data, created_by, updated_by) VALUES ('org-f', 'Builder Page', ?1, ?2, 'owner-f', 'owner-f')")
        .bind(name, JSON.stringify({ doctype: "Builder Page", name, ...(data as object) })),
    ),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(() => {
  state.env = { DB: db, ...OPEN };
});

describe("migration 0034", () => {
  it("is recorded, and the table refuses what the application would never write", async () => {
    expect(await one("SELECT version FROM app_schema_versions WHERE version = '0034_site_tracking'")).toEqual({ version: "0034_site_tracking" });
    const insert = (column: string, value: unknown) =>
      db.prepare(`INSERT INTO site_tracking (organization_id, ${column}, updated_by_user_id) VALUES ('org-n', ?1, 'owner-b')`).bind(value).run();
    for (const [column, value] of [
      ["ga4_id", "UA-12345-1"],
      ["ga4_id", "G-ab12cd34"],
      ["ga4_id", "GTM-ABC1234"],
      ["ads_id", "AW-12ab5678901"],
      ["ads_id", "G-1234567890"],
      ["meta_pixel_id", "12345abc901234"],
      ["meta_pixel_id", "123"],
      ["lead_value_cents", -1],
      ["count_form", 2],
      ["privacy_url", "http://marina.com.br/privacidade"],
      ["privacy_url", "javascript:alert(1)//aaaaaaaaaa"],
      ["privacy_url", 'https://a.com/"><script>'],
    ] as const) {
      await expect(insert(column, value), `${column}=${value}`).rejects.toThrow();
    }
    // A label needs its account.
    await expect(db.prepare("INSERT INTO site_tracking (organization_id, ads_label_lead, updated_by_user_id) VALUES ('org-n', 'LeadLabel1', 'owner-b')").run()).rejects.toThrow();
    expect(await one("SELECT COUNT(*) AS c FROM site_tracking")).toEqual({ c: 0 });
  });
});

describe("who reads and writes the tagging of the site", () => {
  it("is off by default; the owner and a manager save it, each change with a line in the trail, none when nothing changed", async () => {
    expect(await siteTrackingFor(db, scope("owner-a", "org-a")).read()).toEqual({ settings: EMPTY_TRACKING, updatedAt: null });
    expect(await publicTrackingBySlug(db, "marina-a")).toBeNull();
    expect(await siteTrackingFor(db, scope("owner-a", "org-a")).save(settings({ ga4: "G-AB12CD34EF", count_form: "on" }), at(1))).toEqual({ status: "saved", changed: true });
    expect(await siteTrackingFor(db, scope("manager-a", "org-a")).save(settings(FULL), at(2))).toEqual({ status: "saved", changed: true });
    expect(await siteTrackingFor(db, scope("owner-a", "org-a")).save(settings(FULL), at(3))).toEqual({ status: "saved", changed: false });
    expect(await trail("org-a")).toEqual([
      { action: SITE_TRACKING_CHANGED, actor: "owner-a" },
      { action: SITE_TRACKING_CHANGED, actor: "manager-a" },
    ]);
    const read = await siteTrackingFor(db, scope("commercial-a", "org-a")).read();
    expect(read).toEqual({ settings: settings(FULL), updatedAt: at(2).toISOString() });
    expect(await one("SELECT updated_by_user_id AS who FROM site_tracking WHERE organization_id = 'org-a'")).toEqual({ who: "manager-a" });
  });

  it("is read by a commercial member, written by nobody else, and never reaches another organization", async () => {
    const before = await one<{ ga4: string }>("SELECT ga4_id AS ga4, updated_at FROM site_tracking WHERE organization_id = 'org-a'");
    for (const who of ["commercial-a", "tech-a", "blocked-a"]) {
      expect(await siteTrackingFor(db, scope(who, "org-a")).save(settings({ ga4: "G-ZZZZZZZZ" }), at(4)), who).toEqual({ status: "not_found" });
    }
    expect(await siteTrackingFor(db, scope("tech-a", "org-a")).read()).toBeNull();
    expect(await siteTrackingFor(db, scope("blocked-a", "org-a")).read()).toBeNull();
    // The owner of another organization, naming this one: nothing is read or written here.
    expect(await siteTrackingFor(db, scope("owner-b", "org-a")).read()).toBeNull();
    expect(await siteTrackingFor(db, scope("owner-b", "org-a")).save(settings({ ga4: "G-ZZZZZZZZ" }), at(4))).toEqual({ status: "not_found" });
    // A revoked membership (owner-b in org-n) and an organization with no site write nothing either.
    expect(await siteTrackingFor(db, scope("owner-b", "org-n")).save(settings({ ga4: "G-ZZZZZZZZ" }), at(4))).toEqual({ status: "not_found" });
    expect(await one("SELECT ga4_id AS ga4, updated_at FROM site_tracking WHERE organization_id = 'org-a'")).toEqual(before);
    expect(await one("SELECT COUNT(*) AS c FROM site_tracking WHERE organization_id <> 'org-a'")).toEqual({ c: 0 });
    expect((await siteTrackingFor(db, scope("owner-b", "org-b")).read())!.settings).toEqual(EMPTY_TRACKING);
    expect(await trail("org-a")).toHaveLength(2);
  });

  it("is read publicly by the address only, with nothing of the organization, and only while a tool is on", async () => {
    expect(await publicTrackingBySlug(db, "marina-a")).toEqual(settings(FULL));
    expect(await publicTrackingBySlug(db, "studio-b")).toBeNull();
    expect(await publicTrackingBySlug(db, "nao-existe")).toBeNull();
    expect(await publicTrackingBySlug(db, "Nao E Endereco")).toBeNull();
    // Only the counting and the notice left: no tool, nothing public.
    await siteTrackingFor(db, scope("owner-b", "org-b")).save(settings({ privacyUrl: "https://studio.com.br/privacidade", count_form: "on" }), at(5));
    expect(await publicTrackingBySlug(db, "studio-b")).toBeNull();
  });

  it("goes with the site when the site is deleted", async () => {
    const repo = sitesFor(db, scope("owner-b", "org-b"));
    expect((await repo.deleteSite("studio-b")).status).toBe("deleted");
    expect(await one("SELECT COUNT(*) AS c FROM site_tracking WHERE organization_id = 'org-b'")).toEqual({ c: 0 });
  });
});

describe("the script route", () => {
  it("answers the script of that site only: JavaScript, not sniffed, revalidated, with its settings and nothing of another site", async () => {
    const answered = await getScript("marina-a");
    expect(answered.status).toBe(200);
    expect(answered.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(answered.headers.get("x-content-type-options")).toBe("nosniff");
    expect(answered.headers.get("cache-control")).toBe("public, no-cache");
    const text = await answered.text();
    expect(text).toContain('"site":"marina-a"');
    expect(text).toContain('"ga4":"G-AB12CD34EF"');
    expect(text).toContain('"ads":{"id":"AW-123456789","lead":"LeadLabel1","contact":"Contato_22"}');
    expect(text).toContain('"meta":"123456789012345"');
    expect(text).toContain('"value":150');
    expect(text).not.toMatch(/org-a|owner-a|manager-a|Marina Treinos/);
    const etag = answered.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const again = await getScript("marina-a", { "if-none-match": etag });
    expect(again.status).toBe(304);
  });
  it("is the same 404 for an unknown address and for a site without a tool on", async () => {
    for (const slug of ["nao-existe", "frappe-f", "Nao%20E"]) {
      const answered = await getScript(slug);
      expect(answered.status, slug).toBe(404);
      expect(answered.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await answered.text()).toBe("Não encontrado.");
    }
  });
});

describe("the pages of the advanced editor", () => {
  it("keep their document and their strict policy exactly while the site has no tool on, and load the script with a policy of the tools when it has", async () => {
    const before = await openFrappe("frappe-f", ["contato"]);
    const html = await before.text();
    expect(before.headers.get("content-security-policy")).toBe(PUBLIC_CSP);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("rastreio");

    await siteTrackingFor(db, scope("owner-f", "org-f")).save(settings({ ga4: "G-AB12CD34EF", meta: "123456789012345", count_form: "on" }), at(10));
    const after = await openFrappe("frappe-f", ["contato"]);
    const tracked = await after.text();
    const csp = after.headers.get("content-security-policy")!;
    expect(csp).toContain("script-src 'self' https://www.googletagmanager.com https://connect.facebook.net");
    expect(csp).not.toContain("googleadservices");
    // The page is the same document with one script element more: the site's own, relative to the page (any mount path), deferred.
    expect(tracked).toContain('<script src="../../s/frappe-f/m/rastreio" defer></script>');
    expect(tracked.replace('\n<script src="../../s/frappe-f/m/rastreio" defer></script>', "")).toBe(html);
    // From the home page (one level less deep) the address goes one level less up.
    expect(await (await openFrappe("frappe-f")).text()).toContain('<script src="../s/frappe-f/m/rastreio" defer></script>');
    // A different set of tools changes the policy, so the digest changes too (a 304 never keeps an old policy).
    const etag = after.headers.get("etag")!;
    expect((await openFrappe("frappe-f", ["contato"], { "if-none-match": etag })).status).toBe(304);
    await siteTrackingFor(db, scope("owner-f", "org-f")).save(settings({ ga4: "G-AB12CD34EF", count_form: "on" }), at(11));
    expect((await openFrappe("frappe-f", ["contato"], { "if-none-match": etag })).status).toBe(200);
  });
});

describe("the conversion of the contact form", () => {
  const frappeSend = async () => {
    const page = await (await openFrappe("frappe-f", ["contato"])).text();
    const fields = { pagina: hiddenOf(page, "pagina"), formulario: hiddenOf(page, "formulario"), versao: hiddenOf(page, "versao"), aceite: "on", [nameOf(page, "Seu nome")]: "Ana Souza", [nameOf(page, "E-mail")]: "ana@example.test" };
    return (extra: Record<string, string> = {}) => frappePost(form("https://example.test/site/frappe-f/m/contato", { ...fields, ...extra }), params({ slug: "frappe-f" }));
  };
  const guidedSend = (extra: Record<string, string> = {}) =>
    guidedPost(form("https://example.test/s/marina-a/m/contato", { nome: "Ana Souza", contato: "ana@example.test", aceite: "on", ...extra }), params({ slug: "marina-a" }));

  it("carries a one-time id in the address of the thank-you page only when the message was accepted on a site with a tool on (guided editor)", async () => {
    const first = await guidedSend({ pagina: "planos" });
    expect(first.status).toBe(303);
    const location = first.headers.get("location")!;
    expect(location).toMatch(/^\.\/enviado\?pagina=planos&envio=[0-9a-f]{32}$/);
    const second = (await guidedSend()).headers.get("location")!;
    expect(second).toMatch(/^\.\/enviado\?envio=[0-9a-f]{32}$/);
    expect(second.slice(-32)).not.toBe(location.slice(-32));
    // The bait, a refused field, a site without tagging: no id.
    expect((await guidedSend({ empresa_extra: "http://spam.example" })).headers.get("location")).toBe("./enviado");
    expect((await guidedSend({ contato: "não é contato" })).status).toBe(400);
    await siteTrackingFor(db, scope("owner-a", "org-a")).save(settings({}), at(20));
    expect((await guidedSend()).headers.get("location")).toBe("./enviado");
    await siteTrackingFor(db, scope("owner-a", "org-a")).save(settings(FULL), at(21));
  });

  it("does the same for a page of the advanced editor", async () => {
    const send = await frappeSend();
    const accepted = await send();
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("location")).toMatch(/^\.\/enviado\?pagina=contato&envio=[0-9a-f]{32}$/);
    expect((await send({ empresa_extra: "x" })).headers.get("location")).toBe("./enviado");
  });

  it("the thank-you pages load the script with a policy of their own on a site with tagging, and stay as they were without it", async () => {
    const guided = await guidedThanks(new Request("https://example.test/s/marina-a/m/enviado?envio=0123456789abcdef0123456789abcdef"), params({ slug: "marina-a" }));
    const html = await guided.text();
    expect(html).toContain('<script src="./rastreio" defer data-pagina="enviado"></script>');
    expect(guided.headers.get("content-security-policy")).toContain("script-src 'self' https://www.googletagmanager.com");
    expect(guided.headers.get("content-security-policy")).toContain("style-src 'unsafe-inline'");
    const frappe = await frappeThanks(new Request("https://example.test/site/frappe-f/m/enviado?pagina=contato"), params({ slug: "frappe-f" }));
    expect(await frappe.text()).toContain('<script src="../../../s/frappe-f/m/rastreio" defer data-pagina="enviado"></script>');
    expect(frappe.headers.get("content-security-policy")).toContain("script-src 'self'");
    // Without a tool on: no script, no policy (as before 0.71).
    await siteTrackingFor(db, scope("owner-f", "org-f")).save(settings({}), at(30));
    const plain = await frappeThanks(new Request("https://example.test/site/frappe-f/m/enviado"), params({ slug: "frappe-f" }));
    expect(await plain.text()).not.toContain("<script");
    expect(plain.headers.get("content-security-policy")).toBeNull();
    expect(plain.headers.get("cache-control")).toBe("no-store");
    expect((await openFrappe("frappe-f", ["contato"])).headers.get("content-security-policy")).toBe(PUBLIC_CSP);
  });
});

describe("the pages of the guided editor", () => {
  it("are the same markup without tagging, and load the site's script, relative to the page, with it", async () => {
    const site = (await publishedSiteBySlug(db, "marina-a"))!;
    const gate = { open: true as const, noticeUrl: NOTICE };
    const render = (pageId: string, tracking?: boolean) => renderToStaticMarkup(createElement(PublicSitePage, { site, pageId, gate, ...(tracking === undefined ? {} : { tracking }) }));
    for (const pageId of ["home", "p1"]) {
      expect(render(pageId, false)).toBe(render(pageId));
      expect(render(pageId)).not.toMatch(/rastreio|<script/);
    }
    expect(render("home", true)).toContain('<script src="./marina-a/m/rastreio" defer="">');
    expect(render("p1", true)).toContain('<script src="./m/rastreio" defer="">');
    expect(render("home", true).replace('<script src="./marina-a/m/rastreio" defer=""></script>', "")).toBe(render("home"));
  });
});
