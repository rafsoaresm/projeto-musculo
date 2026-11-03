import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leadsFor } from "@/db/leads";
import { siteInquiriesFor } from "@/db/site-inquiries";
import { sitesFor } from "@/db/sites";
import type { SiteContent } from "@/modules/meu-site/contracts";
import { INQUIRIES_PER_SENDER_PER_HOUR } from "@/modules/meu-site/inquiries";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// The form before WhatsApp (0.66), called as the platform calls it. The Cloudflare context is the only thing replaced (the real local D1 and
// the environment the test chooses).
const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: state.env }) }));

import { POST } from "@/app/s/[slug]/m/whatsapp/route";

let mf: Miniflare;
let db: D1Database;
const NOTICE = "https://example.test/aviso-de-privacidade";
const OPEN = { PUBLIC_FORMS_ENABLED: "true", PRIVACY_NOTICE_URL: NOTICE, AUTH_SECRET: "segredo-de-teste-com-mais-de-32-caracteres" };
const MESSAGE = "Olá! Gostaria de conhecer seus treinos.";
const WA = `https://wa.me/5511912345678?text=${encodeURIComponent(MESSAGE)}`;
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string) => (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM (${sql})`))!.c;
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const GOOD = { nome: "Ana Souza", celular: "(11) 98765-4321", objetivo: "Ganhar força" };
const post = (slug: string, fields: Record<string, string> | string, headers: Record<string, string> = {}) =>
  POST(
    new Request(`https://example.test/s/${slug}/m/whatsapp`, {
      method: "POST",
      body: typeof fields === "string" ? fields : new URLSearchParams(fields).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    }),
    params(slug),
  );

const content = (cta: SiteContent["whatsappCta"] | null = { message: MESSAGE, askFirst: true, askGoal: true }, whatsapp = "(11) 91234-5678"): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp, email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks: [{ id: "h1", type: "hero", eyebrow: "", heading: "Treino sob medida", subheading: "", buttonLabel: "Falar no WhatsApp", buttonChannel: "whatsapp" }],
  ...(cta ? { whatsappCta: cta } : {}),
});
const repo = () => sitesFor(db, { userId: "owner-a", organizationId: "org-a" });
/** Publishes `next` as the site's version. */
async function publish(next: SiteContent) {
  const draft = (await repo().overview())!.draft;
  const saved = await repo().saveDraft(next, draft.revision);
  if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
  const published = await repo().publish(saved.revision, new Date(), { withWarnings: true });
  if (published.status !== "published") throw new Error(JSON.stringify(published));
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "site-whatsapp-route-tests" },
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
  await repo().create({ slug: "marina-a", title: "Marina Treinos" });
  await publish(content());
  await repo().setInquiriesOpen(true);
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

describe("the form before WhatsApp, open unless the environment or the site closes it", () => {
  it("is there with no variable at all (a neutral value is kept in place of the notice)", async () => {
    state.env = { DB: db, AUTH_SECRET: OPEN.AUTH_SECRET };
    expect((await post("marina-a", GOOD)).status).toBe(303);
    expect(await one("SELECT notice_url FROM site_inquiries")).toEqual({ notice_url: "sem-aviso" });
    await db.prepare("DELETE FROM site_inquiries").run();
  });
  it("is not there when the environment closed the public forms on purpose, or the site has its switch off: the same 404, nothing written", async () => {
    for (const closed of [{ PUBLIC_FORMS_ENABLED: "false" }, { PUBLIC_FORMS_ENABLED: "false", PRIVACY_NOTICE_URL: NOTICE }]) {
      state.env = { DB: db, AUTH_SECRET: OPEN.AUTH_SECRET, ...closed };
      const answered = await post("marina-a", GOOD);
      expect(answered.status, JSON.stringify(closed)).toBe(404);
      expect(await answered.text()).toBe("Página não encontrada.");
    }
    state.env = { DB: db, ...OPEN };
    await db.prepare("UPDATE sites SET inquiries_open = 0").run();
    expect((await post("marina-a", GOOD)).status).toBe(404);
    expect((await post("nao-existe", GOOD)).status).toBe(404);
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });
  it("is not there when the published site does not ask for it, or has no number to send to (the draft does not count)", async () => {
    try {
      await publish(content({ message: MESSAGE, askFirst: false, askGoal: false }));
      expect((await post("marina-a", GOOD)).status).toBe(404);
      await publish(content(null));
      expect((await post("marina-a", GOOD)).status).toBe(404);
      await publish(content(null, ""));
      expect((await post("marina-a", GOOD)).status).toBe(404);
      await publish(content({ message: MESSAGE, askFirst: true, askGoal: true }, "123"));
      expect((await post("marina-a", GOOD)).status).toBe(404);
      // A draft that asks, over a published version that does not: the published one decides.
      await publish(content({ message: MESSAGE, askFirst: false, askGoal: false }));
      const draft = (await repo().overview())!.draft;
      expect((await repo().saveDraft(content(), draft.revision)).status).toBe("saved");
      expect((await post("marina-a", GOOD)).status).toBe(404);
      expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
    } finally {
      await publish(content());
    }
  });
});

describe("sending it", () => {
  it("keeps the name, the mobile and the goal as a message of the WhatsApp form, and only then sends the visitor to WhatsApp in the same tab", async () => {
    const answered = await post("marina-a", { ...GOOD, pagina: "" });
    expect(answered.status).toBe(303);
    expect(answered.headers.get("location")).toBe(WA);
    expect(answered.headers.get("cache-control")).toBe("no-store");
    expect(await one("SELECT organization_id, name, email, phone, phone_key, message, via, notice_url FROM site_inquiries")).toEqual({
      organization_id: "org-a",
      name: "Ana Souza",
      email: null,
      phone: "(11) 98765-4321",
      phone_key: "11987654321",
      message: "Ganhar força",
      via: "WHATSAPP",
      notice_url: NOTICE,
    });
  });
  it("never puts what the visitor wrote in the WhatsApp address: the message is the professional's own", async () => {
    const location = (await post("marina-a", GOOD)).headers.get("location")!;
    expect(location).not.toMatch(/Ana|Souza|98765|for%C3%A7a/);
  });
  it("does not read the goal when the site does not ask it", async () => {
    try {
      await publish(content({ message: MESSAGE, askFirst: true, askGoal: false }));
      expect((await post("marina-a", GOOD)).status).toBe(303);
      expect(await one("SELECT message FROM site_inquiries")).toEqual({ message: null });
    } finally {
      await publish(content());
    }
  });
  it("goes to WhatsApp without a message when the site has none", async () => {
    try {
      await publish(content({ message: "", askFirst: true, askGoal: true }));
      expect((await post("marina-a", GOOD)).headers.get("location")).toBe("https://wa.me/5511912345678");
    } finally {
      await publish(content());
    }
  });
  it("answers a mistake with a page that says what to fix, does not keep anything and does not open WhatsApp", async () => {
    for (const [fields, problem] of [
      [{ ...GOOD, nome: "A" }, /nome/],
      [{ ...GOOD, celular: "(11) 3456-7890" }, /celular/],
      [{ ...GOOD, celular: "" }, /celular/],
      [{ ...GOOD, objetivo: "x".repeat(161) }, /objetivo/],
    ] as const) {
      const answered = await post("marina-a", fields);
      expect(answered.status).toBe(400);
      expect(answered.headers.get("location")).toBeNull();
      expect(await answered.text()).toMatch(problem);
    }
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });
  it("sends a program that fills the bait on as if it had worked, and keeps nothing", async () => {
    const answered = await post("marina-a", { ...GOOD, empresa_extra: "spam" });
    expect(answered.status).toBe(303);
    expect(answered.headers.get("location")).toBe(WA);
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });
  it("does not open WhatsApp when the message could not be kept (the limits of the inbox)", async () => {
    for (let n = 0; n < INQUIRIES_PER_SENDER_PER_HOUR; n++) expect((await post("marina-a", GOOD, { "cf-connecting-ip": "203.0.113.9" })).status).toBe(303);
    const answered = await post("marina-a", GOOD, { "cf-connecting-ip": "203.0.113.9" });
    expect(answered.status).toBe(429);
    expect(answered.headers.get("location")).toBeNull();
    const page = await answered.text();
    expect(page).toMatch(/não foram guardados/);
    // The visitor may still go, by choice, and with the professional's message only.
    expect(page).toContain(`<a href="${WA.replace(/&/g, "&amp;")}" rel="noopener noreferrer">Falar no WhatsApp mesmo assim</a>`);
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(INQUIRIES_PER_SENDER_PER_HOUR);
  });
  it("refuses a body that is not a form, or too large", async () => {
    expect((await post("marina-a", JSON.stringify(GOOD), { "content-type": "application/json" })).status).toBe(415);
    expect((await post("marina-a", `nome=${"a".repeat(9000)}`)).status).toBe(413);
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(0);
  });
  it("does not take the organization or the number from what the visitor sent", async () => {
    const answered = await post("marina-a", { ...GOOD, organization_id: "org-b", whatsapp: "5599999999999", numero: "5599999999999" });
    expect(answered.headers.get("location")).toBe(WA);
    expect(await one("SELECT organization_id FROM site_inquiries")).toEqual({ organization_id: "org-a" });
  });
});

describe("in the inbox", () => {
  it("says it came from the WhatsApp form, and the lead made from it keeps the goal as its first note", async () => {
    await post("marina-a", GOOD);
    const inbox = siteInquiriesFor(db, { userId: "owner-a", organizationId: "org-a" });
    const [entry] = await inbox.list();
    expect(entry).toMatchObject({ name: "Ana Souza", phone: "(11) 98765-4321", email: null, message: "Ganhar força", via: "WHATSAPP" });
    const converted = await inbox.convert(entry!.id);
    expect(converted.status).toBe("converted");
    if (converted.status !== "converted") return;
    expect(await one("SELECT note FROM lead_events WHERE lead_id = ?", converted.leadId)).toEqual({ note: "Objetivo (formulário do WhatsApp): Ganhar força" });
    expect((await leadsFor(db, { userId: "owner-a", organizationId: "org-a" }).list()).find((lead) => lead.id === converted.leadId)?.source).toBe("SITE");
  });
  it("keeps the contact form's messages as they were", async () => {
    expect(await one("SELECT dflt_value FROM pragma_table_info('site_inquiries') WHERE name = 'via'")).toEqual({ dflt_value: "'FORM'" });
  });
});
