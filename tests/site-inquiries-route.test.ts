import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sitesFor } from "@/db/sites";
import type { SiteContent } from "@/modules/meu-site/contracts";
import { INQUIRY_BODY_MAX_BYTES, INQUIRIES_PER_SENDER_PER_HOUR } from "@/modules/meu-site/inquiries";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// The routes of the public form, called as the platform calls them: a Request and the route's params. The Cloudflare context is the only thing
// replaced (it gives the real local D1 and the environment the test chooses); everything else is the code that runs in production.
const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: state.env }) }));

import { POST } from "@/app/s/[slug]/m/contato/route";
import { GET as thanks } from "@/app/s/[slug]/m/enviado/route";

let mf: Miniflare;
let db: D1Database;
const NOTICE = "https://example.test/aviso-de-privacidade";
const OPEN = { PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: NOTICE, AUTH_SECRET: "segredo-de-teste-com-mais-de-32-caracteres" };
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string) => (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM (${sql})`))!.c;
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const GOOD = { nome: "Ana Souza", contato: "ana@example.test", mensagem: "Quero saber dos planos", aceite: "on" };
const post = (slug: string, fields: Record<string, string> | string, headers: Record<string, string> = {}) =>
  POST(
    new Request(`https://example.test/s/${slug}/m/contato`, {
      method: "POST",
      body: typeof fields === "string" ? fields : new URLSearchParams(fields).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    }),
    params(slug),
  );

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

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "site-inquiries-route-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  await db.batch([
    db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES ('owner-a','owner-a','o@example.test',0,0)"),
    db.prepare("INSERT INTO users(id) VALUES ('owner-a')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','A')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES ('org-a','owner-a','OWNER',NULL)"),
  ]);
  const repo = sitesFor(db, { userId: "owner-a", organizationId: "org-a" });
  await repo.create({ slug: "marina-a", title: "Marina Treinos" });
  const draft = (await repo.overview())!.draft;
  const saved = await repo.saveDraft(content(), draft.revision);
  if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
  const published = await repo.publish(saved.revision, new Date(), { withWarnings: true });
  if (published.status !== "published") throw new Error(JSON.stringify(published));
  await repo.setInquiriesOpen(true);
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  state.env = { DB: db, ...OPEN };
  delete process.env.PUBLIC_FORMS_ENABLED;
  delete process.env.PRIVACY_NOTICE_URL;
  await db.prepare("DELETE FROM site_inquiries").run();
  await db.prepare("UPDATE sites SET inquiries_open = 1").run();
});

describe("the form of a public page, closed by default", () => {
  it("is not there when the environment did not open it, whatever the site chose: the same 404 as an unknown address, and nothing is written", async () => {
    for (const closed of [{}, { PUBLIC_FORMS_ENABLED: "false" }, { PUBLIC_FORMS_ENABLED: "true" }, { PRIVACY_NOTICE_URL: NOTICE }, { PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: "http://example.test/aviso" }]) {
      state.env = { DB: db, AUTH_SECRET: OPEN.AUTH_SECRET, ...closed };
      const answered = await post("marina-a", GOOD);
      expect(answered.status, JSON.stringify(closed)).toBe(404);
      expect(await answered.text()).toBe("Página não encontrada.");
    }
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });
  it("takes the switch from the variables of the dashboard when the Worker does not declare them", async () => {
    state.env = { DB: db, AUTH_SECRET: OPEN.AUTH_SECRET };
    process.env.PUBLIC_FORMS_ENABLED = "true";
    process.env.PRIVACY_NOTICE_URL = NOTICE;
    expect((await post("marina-a", GOOD)).status).toBe(303);
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(1);
  });
  it("is closed too when the site has not turned on its own switch, the site is unknown or it is not an address", async () => {
    await db.prepare("UPDATE sites SET inquiries_open = 0").run();
    expect((await post("marina-a", GOOD)).status).toBe(404);
    expect((await post("nao-existe", GOOD)).status).toBe(404);
    expect((await post("Nao%20E%20Endereco", GOOD)).status).toBe(404);
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });
});

describe("sending the form", () => {
  it("stores the message and sends the visitor to the thank-you page by a relative address, so the mount path of the platform is not in the code", async () => {
    const answered = await post("marina-a", { ...GOOD, pagina: "planos" });
    expect(answered.status).toBe(303);
    expect(answered.headers.get("location")).toBe("./enviado?pagina=planos");
    expect(answered.headers.get("cache-control")).toBe("no-store");
    expect(await one("SELECT organization_id, name, email, message, page, notice_url FROM site_inquiries")).toEqual({
      organization_id: "org-a",
      name: "Ana Souza",
      email: "ana@example.test",
      message: "Quero saber dos planos",
      page: "planos",
      notice_url: NOTICE,
    });
    expect((await post("marina-a", GOOD)).headers.get("location")).toBe("./enviado");
  });
  it("does not take the organization, the site or anything else from what the visitor sent", async () => {
    await post("marina-a", { ...GOOD, organization_id: "org-b", site_id: "x", organizationId: "org-b" });
    expect(await one("SELECT organization_id FROM site_inquiries")).toEqual({ organization_id: "org-a" });
  });
  it("counts the sender by a hash of the address that Cloudflare gives, and not at all when there is no address or no secret", async () => {
    await post("marina-a", GOOD, { "cf-connecting-ip": "203.0.113.7" });
    const hash = (await one<{ ip_key: string }>("SELECT ip_key FROM site_inquiries"))!.ip_key;
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain("203");
    await db.prepare("DELETE FROM site_inquiries").run();
    await post("marina-a", GOOD);
    expect((await one<{ ip_key: string | null }>("SELECT ip_key FROM site_inquiries"))!.ip_key).toBeNull();
    await db.prepare("DELETE FROM site_inquiries").run();
    state.env = { DB: db, PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: NOTICE };
    await post("marina-a", GOOD, { "cf-connecting-ip": "203.0.113.7" });
    expect((await one<{ ip_key: string | null }>("SELECT ip_key FROM site_inquiries"))!.ip_key).toBeNull();
  });
  it("thanks a program that fills the bait field, so it learns nothing, and keeps nothing", async () => {
    const answered = await post("marina-a", { ...GOOD, empresa_extra: "http://spam.example" });
    expect(answered.status).toBe(303);
    expect(answered.headers.get("location")).toBe("./enviado");
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });
  it("says what to fix, in a page, for each field, and keeps nothing", async () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ ...GOOD, nome: "A" }, /nome/i],
      [{ ...GOOD, contato: "abc" }, /e-mail ou um telefone/],
      [{ ...GOOD, mensagem: "x".repeat(1001) }, /1000 letras/],
      [{ ...GOOD, aceite: "" }, /aviso de privacidade/],
    ];
    for (const [fields, said] of cases) {
      const answered = await post("marina-a", fields);
      expect(answered.status, JSON.stringify(fields)).toBe(400);
      expect(answered.headers.get("content-type")).toMatch(/text\/html/);
      const html = await answered.text();
      expect(html).toMatch(said);
      // The way back is the site (two levels up), never a script, and the page says how to correct without losing what was written.
      expect(html).toContain('href="../../marina-a"');
      expect(html).not.toContain("javascript:");
      expect(html).toContain("botão Voltar do navegador");
    }
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });
  it("accepts only what the form sends: a form body, of the size of a form", async () => {
    const json = await POST(new Request("https://example.test/s/marina-a/m/contato", { method: "POST", body: JSON.stringify(GOOD), headers: { "content-type": "application/json" } }), params("marina-a"));
    expect(json.status).toBe(415);
    expect(await json.text()).toContain('href="../../marina-a"');
    const multipart = await POST(new Request("https://example.test/s/marina-a/m/contato", { method: "POST", body: "x", headers: { "content-type": "multipart/form-data; boundary=x" } }), params("marina-a"));
    expect(multipart.status).toBe(415);
    const large = await post("marina-a", `nome=Ana&contato=a@e.test&mensagem=${"x".repeat(INQUIRY_BODY_MAX_BYTES)}&aceite=on`);
    expect(large.status).toBe(413);
    expect(await large.text()).toContain('href="../../marina-a"');
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });
  it("stops one sender after a few in an hour, with the time to wait said, and takes the others", async () => {
    for (let n = 0; n < INQUIRIES_PER_SENDER_PER_HOUR; n++) expect((await post("marina-a", GOOD, { "cf-connecting-ip": "203.0.113.9" })).status).toBe(303);
    const limited = await post("marina-a", GOOD, { "cf-connecting-ip": "203.0.113.9" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");
    const limitedHtml = await limited.text();
    expect(limitedHtml).toMatch(/mais tarde/);
    expect(limitedHtml).toContain('href="../../marina-a"');
    expect((await post("marina-a", GOOD, { "cf-connecting-ip": "203.0.113.10" })).status).toBe(303);
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(INQUIRIES_PER_SENDER_PER_HOUR + 1);
  });
  it("is not a page to read: a GET to the address of the form is not allowed", async () => {
    const methods = await import("@/app/s/[slug]/m/contato/route");
    expect("GET" in methods).toBe(false);
  });
});

describe("the thank-you page", () => {
  const get = (slug: string, query = "") => thanks(new Request(`https://example.test/s/${slug}/m/enviado${query}`), params(slug));
  it("says only that the message was sent, with a link back to the page it came from (two levels up, so the mount path comes along)", async () => {
    const answered = await get("marina-a", "?pagina=planos");
    expect(answered.status).toBe(200);
    const html = await answered.text();
    expect(html).toContain("Mensagem enviada");
    expect(html).toContain('href="../../marina-a/planos"');
    expect(html).not.toMatch(/em até|em \d+ horas|garant/i);
    expect(answered.headers.get("cache-control")).toBe("no-store");
    expect(answered.headers.get("x-robots-tag")).toBe("noindex");
  });
  it("goes back to the home page when the page is not one, and does not echo what it is given", async () => {
    for (const query of ["", "?pagina=", "?pagina=m", "?pagina=%3Cscript%3E", "?pagina=../../x", "?pagina=a--b"]) {
      const html = await (await get("marina-a", query)).text();
      expect(html, query).toContain('href="../../marina-a"');
      expect(html, query).not.toContain("<script>");
    }
  });
  it("is the same 404 as the rest of the site for an address that is not a published site, and does not depend on the switches", async () => {
    expect((await get("nao-existe")).status).toBe(404);
    await db.prepare("UPDATE sites SET inquiries_open = 0").run();
    state.env = { DB: db };
    expect((await get("marina-a")).status).toBe(200);
  });
});
