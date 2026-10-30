import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { receiveInquiry } from "@/db/site-inquiries";
import { formsOnTheAir } from "@/modules/meu-site/new-editor-forms";
import { INQUIRIES_PER_SENDER_PER_HOUR, type InquiryValue } from "@/modules/meu-site/inquiries";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// The page of the new editor and its form, called as the platform calls them: a Request and the route's params. The Cloudflare context is the only
// thing replaced (it gives the real local D1 and the environment the test chooses); everything else is the code that runs in production.
const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: state.env }) }));

import { GET as page } from "@/app/site/[slug]/[[...path]]/route";
import { POST } from "@/app/site/[slug]/m/contato/route";
import { GET as thanks } from "@/app/site/[slug]/m/enviado/route";

let mf: Miniflare;
let db: D1Database;
const NOTICE = "https://example.test/aviso-de-privacidade";
const OPEN = { PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: NOTICE, AUTH_SECRET: "segredo-de-teste-com-mais-de-32-caracteres" };
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string) => (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM (${sql})`))!.c;

const node = (element: string, attributes: Record<string, string> = {}, more: Record<string, unknown> = {}) => ({ blockId: crypto.randomUUID().slice(0, 8), element, attributes, ...more });
const body = (...children: unknown[]) => JSON.stringify([{ blockId: "root", originalElement: "body", element: "div", baseStyles: { display: "flex" }, children }]);
const contactForm = (...extra: unknown[]) =>
  node("form", {}, {
    blockId: "contact-form",
    children: [
      node("input", { type: "text", placeholder: "Seu nome" }),
      node("input", { type: "email", placeholder: "E-mail" }),
      node("input", { type: "tel", placeholder: "WhatsApp" }),
      node("select", { "aria-label": "Objetivo" }, { children: [node("option", {}, { innerHTML: "Emagrecer" }), node("option", {}, { innerHTML: "Ganhar massa" })] }),
      node("textarea", { placeholder: "Mensagem" }),
      ...extra,
      node("button", {}, { innerHTML: "Enviar" }),
    ],
  });
const put = (org: string, name: string, data: Record<string, unknown>) =>
  db
    .prepare("INSERT OR REPLACE INTO builder_docs(organization_id, doctype, name, data, created_by, updated_by) VALUES (?1, 'Builder Page', ?2, ?3, 'user-a', 'user-a')")
    .bind(org, name, JSON.stringify({ doctype: "Builder Page", name, ...data }));

const params = (slug: string, path?: string[]) => ({ params: Promise.resolve({ slug, path }) });
const open = (slug: string, path?: string[]) => page(new Request(`https://example.test/site/${slug}${path ? `/${path.join("/")}` : ""}`), params(slug, path));
const post = (slug: string, fields: Record<string, string> | string, headers: Record<string, string> = {}) =>
  POST(
    new Request(`https://example.test/site/${slug}/m/contato`, {
      method: "POST",
      body: typeof fields === "string" ? fields : new URLSearchParams(fields).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    }),
    params(slug),
  );
const hiddenOf = (html: string, name: string) => new RegExp(`<input type="hidden" name="${name}" value="([^"]*)">`).exec(html)?.[1] ?? "";
const nameOf = (html: string, hint: string) => new RegExp(`<[a-z]+ [^>]*(?:placeholder|aria-label)="${hint}"[^>]*name="(f\\d+)"|<[a-z]+ [^>]*name="(f\\d+)"[^>]*(?:placeholder|aria-label)="${hint}"`).exec(html)?.slice(1).find(Boolean) ?? "";

/** What a visitor's browser sends from the page as drawn now: the fields it shows with what they were given, and the hidden ones the page carries. */
async function fromPage(slug: string, path: string[] | undefined, values: Record<string, string>) {
  const html = await (await open(slug, path)).text();
  const sent: Record<string, string> = { pagina: hiddenOf(html, "pagina"), formulario: hiddenOf(html, "formulario"), versao: hiddenOf(html, "versao"), aceite: "on" };
  for (const [hint, value] of Object.entries(values)) {
    const field = nameOf(html, hint);
    if (!field) throw new Error(`no field ${hint} in ${html.slice(0, 400)}`);
    sent[field] = value;
  }
  return { html, sent };
}
const GOOD = { "Seu nome": "Ana Souza", "E-mail": "ana@example.test", Objetivo: "1", Mensagem: "Quero saber dos planos" };

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "frappe-site-form-route-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  await db.batch([
    db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES ('user-a','A','a@example.test',0,0)"),
    db.prepare("INSERT INTO users(id) VALUES ('user-a')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B'),('org-c','Studio C'),('org-d','Studio D')"),
    db.prepare(
      "INSERT INTO sites(id, organization_id, slug, created_by, inquiries_open) VALUES ('site-a','org-a','marina-a','user-a',1),('site-b','org-b','marina-b','user-a',1),('site-c','org-c','marina-c','user-a',1),('site-d','org-d','marina-d','user-a',1)",
    ),
    put("org-a", "contato", { route: "contato", published: 1, published_at: "2026-10-01T10:00:00Z", blocks: body(node("h1", {}, { innerHTML: "Fale comigo" }), contactForm()), draft_blocks: body(contactForm(node("input", { placeholder: "Segredo", required: "" }))) }),
    put("org-a", "newsletter", { route: "servicos/boletim", published: 1, published_at: "2026-10-02T10:00:00Z", blocks: body(node("form", {}, { blockId: "news", children: [node("input", { type: "email", placeholder: "E-mail" }), node("button", {}, { innerHTML: "Assinar" })] })) }),
    put("org-a", "home", { route: "home", published: 1, published_at: "2026-10-03T10:00:00Z", blocks: body(node("p", {}, { innerHTML: "Início" })) }),
    put("org-b", "contato", { route: "contato", published: 1, published_at: "2026-10-01T10:00:00Z", blocks: body(contactForm()) }),
    // org-c: a draft only, then a dynamic page only (neither is a public site).
    put("org-c", "rascunho", { route: "contato", published: 0, blocks: body(contactForm()) }),
    put("org-d", "dinamica", { route: "blog/:slug", published: 1, dynamic_route: 1, blocks: body(contactForm()) }),
  ]);
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

describe("the form of a page of the new editor is drawn only where the environment and the site both opened it", () => {
  it("closed by the environment, or by the site: the page is there and the form is not, and the page changes with it", async () => {
    const opened = await (await open("marina-a", ["contato"])).text();
    expect(opened).toContain('<form method="post" action="../../site/marina-a/m/contato">');
    expect(opened).toContain('name="aceite"');
    state.env = { DB: db, AUTH_SECRET: OPEN.AUTH_SECRET };
    const closedByEnvironment = await (await open("marina-a", ["contato"])).text();
    expect(closedByEnvironment).toContain("Fale comigo");
    expect(closedByEnvironment).not.toMatch(/<form|<input|<textarea|aceite/);
    state.env = { DB: db, ...OPEN };
    await db.prepare("UPDATE sites SET inquiries_open = 0 WHERE slug = 'marina-a'").run();
    const closedBySite = await (await open("marina-a", ["contato"])).text();
    expect(closedBySite).toBe(closedByEnvironment);
    // The environment's word can also come from the variables of the dashboard.
    state.env = { DB: db, AUTH_SECRET: OPEN.AUTH_SECRET };
    process.env.PUBLIC_FORMS_ENABLED = "true";
    process.env.PRIVACY_NOTICE_URL = NOTICE;
    await db.prepare("UPDATE sites SET inquiries_open = 1 WHERE slug = 'marina-a'").run();
    expect(await (await open("marina-a", ["contato"])).text()).toContain('name="aceite"');
  });

  it("the address it sends to leads out of the page from where the page is, under any mount path", async () => {
    const home = await (await open("marina-a")).text();
    expect(home).not.toContain("<form"); // the home page has no form
    const deep = await (await open("marina-a", ["servicos", "boletim"])).text();
    expect(deep).not.toContain("<form"); // a form that cannot receive is not drawn
    const { html } = await fromPage("marina-a", ["contato"], {});
    expect(html).toContain('action="../../site/marina-a/m/contato"');
  });
});

describe("sending the form of a page", () => {
  it("is read against the published form: stores a message of the organization of the site, with the lines of the fields the person drew", async () => {
    const { sent } = await fromPage("marina-a", ["contato"], GOOD);
    const answered = await post("marina-a", { ...sent, organization_id: "org-b", site_id: "x" });
    expect(answered.status).toBe(303);
    expect(answered.headers.get("location")).toBe("./enviado?pagina=contato");
    expect(answered.headers.get("cache-control")).toBe("no-store");
    expect(await one("SELECT organization_id, name, email, phone, message, page, notice_url FROM site_inquiries")).toEqual({
      organization_id: "org-a",
      name: "Ana Souza",
      email: "ana@example.test",
      phone: null,
      message: "Quero saber dos planos\n\nObjetivo: Ganhar massa",
      page: "contato",
      notice_url: NOTICE,
    });
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(1);
  });

  it("reads the PUBLISHED form: a field only in the draft is not asked, and an edit that is not published changes nothing for the visitor", async () => {
    const { sent } = await fromPage("marina-a", ["contato"], GOOD);
    expect(Object.keys(sent)).not.toContain("Segredo");
    expect((await post("marina-a", sent)).status).toBe(303);
  });

  it("a page that changed after the visitor opened it is not guessed at: nothing is kept, and the visitor is told to reload", async () => {
    const { sent } = await fromPage("marina-a", ["contato"], GOOD);
    const row = await one<{ data: string }>("SELECT data FROM builder_docs WHERE organization_id = 'org-a' AND name = 'contato'");
    const original = row!.data;
    const edited = JSON.parse(original) as { blocks: string };
    edited.blocks = edited.blocks.replace("Seu nome", "Como você se chama");
    await db.prepare("UPDATE builder_docs SET data = ?1 WHERE organization_id = 'org-a' AND name = 'contato'").bind(JSON.stringify(edited)).run();
    try {
      const answered = await post("marina-a", sent);
      expect(answered.status).toBe(409);
      expect(await answered.text()).toContain("A página mudou");
    } finally {
      await db.prepare("UPDATE builder_docs SET data = ?1 WHERE organization_id = 'org-a' AND name = 'contato'").bind(original).run();
    }
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });

  it("says which field is wrong, in a page, and keeps nothing", async () => {
    const { sent } = await fromPage("marina-a", ["contato"], GOOD);
    const bad = await post("marina-a", { ...sent, [nameOf(await (await open("marina-a", ["contato"])).text(), "E-mail")]: "ana@" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Escreva um e-mail válido em “E-mail”.");
    const noConsent = await post("marina-a", { ...sent, aceite: "" });
    expect(noConsent.status).toBe(400);
    expect(await noConsent.text()).toContain("Marque que leu o aviso de privacidade para enviar.");
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });

  it("a program that fills the bait is thanked and nothing is kept, even before the page is looked at", async () => {
    const { sent } = await fromPage("marina-a", ["contato"], GOOD);
    for (const fields of [{ ...sent, empresa_extra: "x" }, { empresa_extra: "x" }, { ...sent, empresa_extra: "x", formulario: "nao-existe" }]) {
      const answered = await post("marina-a", fields);
      expect(answered.status).toBe(303);
      expect(answered.headers.get("location")).toBe("./enviado");
    }
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });

  it("a form the page does not have, a form that cannot receive, a page that is not published and a site that is not there answer the same or say the page changed", async () => {
    const { sent } = await fromPage("marina-a", ["contato"], GOOD);
    expect((await post("marina-a", { ...sent, formulario: "outro" })).status).toBe(409);
    // The newsletter has no name field: it is not drawn, so only a program sends it.
    expect((await post("marina-a", { ...sent, pagina: "servicos/boletim", formulario: "news" })).status).toBe(404);
    expect((await post("marina-a", { ...sent, pagina: "nao-existe" })).status).toBe(404);
    expect((await post("marina-a", { ...sent, pagina: "../contato" })).status).toBe(404);
    expect((await post("marina-a", { ...sent, pagina: "Contato/" })).status).toBe(404);
    expect((await post("nao-existe", sent)).status).toBe(404);
    expect((await post("Nao%20E%20Endereco", sent)).status).toBe(404);
    expect((await post("marina-c", { ...sent, pagina: "contato" })).status).toBe(404); // org-c: the page is a draft
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });

  it("one organization's form cannot be sent through another's address, and the same names in two sites stay apart", async () => {
    const a = await fromPage("marina-a", ["contato"], GOOD);
    const b = await fromPage("marina-b", ["contato"], GOOD);
    expect((await post("marina-b", b.sent)).status).toBe(303);
    expect(await one("SELECT organization_id FROM site_inquiries")).toEqual({ organization_id: "org-b" });
    expect((await post("marina-a", a.sent)).status).toBe(303);
    expect(await count("SELECT 1 FROM site_inquiries WHERE organization_id = 'org-a'")).toBe(1);
  });

  it("is closed, with nothing written and the same 404 as an unknown address, when the environment or the site did not open it", async () => {
    const { sent } = await fromPage("marina-a", ["contato"], GOOD);
    for (const closed of [{}, { PUBLIC_FORMS_ENABLED: "false" }, { PUBLIC_FORMS_ENABLED: "true" }, { PRIVACY_NOTICE_URL: NOTICE }, { PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: "http://example.test/aviso" }]) {
      state.env = { DB: db, AUTH_SECRET: OPEN.AUTH_SECRET, ...closed };
      const answered = await post("marina-a", sent);
      expect(answered.status, JSON.stringify(closed)).toBe(404);
      expect(await answered.text()).toBe("Página não encontrada.");
    }
    state.env = { DB: db, ...OPEN };
    await db.prepare("UPDATE sites SET inquiries_open = 0").run();
    expect((await post("marina-a", sent)).status).toBe(404);
    // A closed site says nothing about its form, not even that a field is wrong or that the page changed.
    expect((await post("marina-a", { ...sent, f1: "A" })).status).toBe(404);
    expect((await post("marina-a", { ...sent, versao: "0".repeat(14) })).status).toBe(404);
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });

  it("refuses what is not a form (type) and what is too large, before reading it", async () => {
    expect((await post("marina-a", "{}", { "content-type": "application/json" })).status).toBe(415);
    expect((await post("marina-a", "x".repeat(17_000))).status).toBe(413);
    expect((await post("marina-a", "a=1", { "content-length": "99999" })).status).toBe(413);
  });

  it("limits how often one sender writes, and how many wait, the way the first form does", async () => {
    const { sent } = await fromPage("marina-a", ["contato"], GOOD);
    for (let i = 0; i < INQUIRIES_PER_SENDER_PER_HOUR; i += 1) expect((await post("marina-a", sent, { "cf-connecting-ip": "203.0.113.9" })).status).toBe(303);
    const limited = await post("marina-a", sent, { "cf-connecting-ip": "203.0.113.9" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");
    expect((await post("marina-a", sent, { "cf-connecting-ip": "203.0.113.10" })).status).toBe(303);
  });
});

describe("a site is public for its messages when the new editor has a page on the air", () => {
  const value: InquiryValue = { name: "Ana", email: "ana@example.test", phone: null, message: null, page: "contato" };
  it("only a published page that is not dynamic counts, and only the pages of the organization of the site", async () => {
    const receive = (slug: string) => receiveInquiry(db, { slug, value, noticeUrl: NOTICE, sender: null });
    expect(await receive("marina-a")).toEqual({ status: "received" });
    expect(await receive("marina-c")).toEqual({ status: "closed" }); // a draft only, while other organizations have pages on the air
    expect(await receive("marina-d")).toEqual({ status: "closed" }); // a dynamic page only
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(1);
  });
  it("takes the page off and the site stops receiving; puts it back and it receives again", async () => {
    const { sent } = await fromPage("marina-a", ["contato"], GOOD);
    await db.prepare("UPDATE builder_docs SET data = json_set(data, '$.published', 0) WHERE organization_id = 'org-a'").run();
    expect((await post("marina-a", sent)).status).toBe(404);
    await db.prepare("UPDATE builder_docs SET data = json_set(data, '$.published', 1) WHERE organization_id = 'org-a'").run();
    expect((await post("marina-a", sent)).status).toBe(303);
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(1);
  });
});

describe("the panel of Meu Site tells what each form on the air can do", () => {
  it("reads the published pages as a visitor and the submission read them: ready, or what is missing", async () => {
    const pages = [
      { name: "contato", route: "contato", title: "Contato" },
      { name: "newsletter", route: "servicos/boletim", title: "Boletim" },
      { name: "home", route: "home", title: "Início" },
      { name: "nao-existe", route: "x", title: "Fantasma" },
    ];
    expect(await formsOnTheAir(db, "marina-a", pages)).toEqual({
      forms: [
        { route: "contato", title: "Contato", summary: "nome, e-mail, telefone, mensagem e um outro campo", problems: [], ignored: [] },
        { route: "servicos/boletim", title: "Boletim", summary: "e-mail", problems: ["Falta o campo do nome: um campo de texto."], ignored: [] },
      ],
      skipped: 0,
    });
    // The page asked for is the page read, not the one its route would pick, and what is another organization's is not read at all.
    expect((await formsOnTheAir(db, "marina-a", [{ name: "home", route: "", title: "Início" }])).forms).toEqual([]);
    expect((await formsOnTheAir(db, "marina-b", [{ name: "newsletter", route: "servicos/boletim", title: "x" }])).forms).toEqual([]);
    const many = Array.from({ length: 25 }, () => pages[2]!);
    expect((await formsOnTheAir(db, "marina-a", many)).skipped).toBe(5);
    // Each page read draws its forms: past twenty pages the panel stops reading, and says how many it did not.
    const withForms = await formsOnTheAir(db, "marina-a", Array.from({ length: 25 }, () => pages[0]!));
    expect(withForms.forms).toHaveLength(20);
    expect(withForms.skipped).toBe(5);
    // The name is the page: a route that would be the home page's is not read in its place.
    const byName = await formsOnTheAir(db, "marina-a", [{ name: "newsletter", route: "", title: "Boletim" }]);
    expect(byName.forms).toHaveLength(1);
    expect(byName.forms[0]!.summary).toBe("e-mail");
  });
});

describe("the page that thanks the visitor", () => {
  const thank = (slug: string, query = "") => thanks(new Request(`https://example.test/site/${slug}/m/enviado${query}`), params(slug));
  it("says it was sent, with a way back by a relative address, and nothing is promised", async () => {
    const answered = await thank("marina-a", "?pagina=servicos/boletim");
    expect(answered.status).toBe(200);
    expect(answered.headers.get("cache-control")).toBe("no-store");
    const html = await answered.text();
    expect(html).toContain("Mensagem enviada");
    expect(html).toContain('href="../servicos/boletim"');
    expect(await (await thank("marina-a")).text()).toContain('href="../"');
  });
  it("takes nothing but a page of the site for the way back, and is the same 404 for an address with no page on the air", async () => {
    for (const asked of ["?pagina=https://evil.test", "?pagina=//evil.test", "?pagina=../x", "?pagina=javascript:alert(1)", `?pagina=${"a".repeat(41)}`]) {
      expect(await (await thank("marina-a", asked)).text(), asked).toContain('href="../"');
    }
    for (const slug of ["marina-c", "nao-existe", "Nao%20E"]) expect((await thank(slug)).status, slug).toBe(404);
  });
});
