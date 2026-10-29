import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leadsFor } from "@/db/leads";
import { receiveInquiry, siteInquiriesFor } from "@/db/site-inquiries";
import { publishedSiteBySlug, sitesFor } from "@/db/sites";
import { INQUIRIES_PER_SENDER_PER_HOUR, INQUIRIES_PER_SITE_PER_HOUR, INQUIRIES_WAITING_MAX, type InquiryValue } from "@/modules/meu-site/inquiries";
import type { SiteContent } from "@/modules/meu-site/contracts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration, triggers included. The public door has no identity at all (the organization is the site's);
// the organization's door repeats membership, role and active login in each statement.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId: string) => ({ userId, organizationId });
const T0 = new Date("2026-10-29T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const NOTICE = "https://example.test/aviso-de-privacidade";
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string, ...binds: unknown[]) => (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM (${sql})`, ...binds))!.c;
const value = (over: Partial<InquiryValue> = {}): InquiryValue => ({ name: "Ana Souza", email: "ana@example.test", phone: null, message: "Quero saber dos planos", page: "", ...over });
const send = (slug: string, over: Partial<InquiryValue> = {}, sender: string | null = null, minutes = 0) =>
  receiveInquiry(db, { slug, value: value(over), noticeUrl: NOTICE, sender }, at(minutes));

const complete = (): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks: [
    { id: "h1", type: "hero", eyebrow: "", heading: "Treino sob medida", subheading: "", buttonLabel: "Falar comigo", buttonChannel: "whatsapp" },
    { id: "f1", type: "contactForm", eyebrow: "", heading: "Escreva para mim", text: "", buttonLabel: "Enviar mensagem" },
  ],
});
/** A site of the organization, published, with the switch of the messages as asked. */
async function site(organizationId: string, ownerId: string, slug: string, options: { publish?: boolean; open?: boolean } = {}) {
  const repo = sitesFor(db, scope(ownerId, organizationId));
  expect(await repo.create({ slug, title: "Marina Treinos" }, at(-100))).toEqual({ status: "created" });
  const overview = (await repo.overview())!;
  const saved = await repo.saveDraft(complete(), overview.draft.revision, at(-99));
  if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
  if (options.publish !== false) {
    const published = await repo.publish(saved.revision, at(-98), { withWarnings: true });
    if (published.status !== "published") throw new Error(JSON.stringify(published));
  }
  if (options.open !== false) expect((await repo.setInquiriesOpen(true, at(-97))).status).toBe("saved");
  return repo;
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "site-inquiries-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "manager-a", "commercial-a", "tech-a", "owner-b", "owner-c", "owner-d", "owner-e", "owner-f", "owner-g", "blocked-a"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.filter((p) => p !== "blocked-a").map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO users(id, disabled_at) VALUES ('blocked-a', '2026-10-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','A'),('org-b','B'),('org-c','C'),('org-d','D'),('org-e','E'),('org-f','F'),('org-g','G')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','manager-a','MANAGER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),('org-a','tech-a','TECHNICAL',NULL),
       ('org-a','blocked-a','MANAGER',NULL),('org-b','owner-b','OWNER',NULL),('org-c','owner-c','OWNER',NULL),('org-d','owner-d','OWNER',NULL),
       ('org-e','owner-e','OWNER',NULL),('org-f','owner-f','OWNER',NULL),('org-g','owner-g','OWNER',NULL)`,
    ),
  ]);
  await site("org-a", "owner-a", "marina-a");
  await site("org-b", "owner-b", "studio-b");
});
afterAll(async () => {
  await mf?.dispose();
});

describe("the switch of the site", () => {
  it("is born closed, and the owner and a manager turn it on and off, with a line in the trail each time", async () => {
    const closed = await site("org-e", "owner-e", "estudio-e", { open: false });
    expect((await closed.overview())!.inquiries).toEqual({ open: false, waiting: 0 });
    expect((await closed.setInquiriesOpen(true, at(1))).status).toBe("saved");
    expect((await closed.overview())!.inquiries.open).toBe(true);
    expect((await closed.setInquiriesOpen(false, at(2))).status).toBe("saved");
    expect((await closed.overview())!.inquiries.open).toBe(false);
    const trail = await db.prepare("SELECT action FROM access_audit_events WHERE organization_id = 'org-e' AND action LIKE 'SITE_INQUIRIES_%' ORDER BY created_at").all<{ action: string }>();
    expect(trail.results.map((row) => row.action)).toEqual(["SITE_INQUIRIES_OPENED", "SITE_INQUIRIES_CLOSED"]);
  });
  it("does not write a line when it already was so, and is not for a commercial member, a technical one or a stranger", async () => {
    const before = await count("SELECT 1 FROM access_audit_events WHERE organization_id = 'org-a' AND action LIKE 'SITE_INQUIRIES_%'");
    expect((await sitesFor(db, scope("owner-a", "org-a")).setInquiriesOpen(true, at(3))).status).toBe("saved");
    expect(await count("SELECT 1 FROM access_audit_events WHERE organization_id = 'org-a' AND action LIKE 'SITE_INQUIRIES_%'")).toBe(before);
    for (const who of ["commercial-a", "tech-a", "blocked-a"]) {
      expect((await sitesFor(db, scope(who, "org-a")).setInquiriesOpen(false, at(4))).status, who).toBe("not_found");
    }
    // Someone of another organization asking for this one's site writes nothing there.
    expect((await sitesFor(db, scope("owner-b", "org-a")).setInquiriesOpen(false, at(4))).status).toBe("not_found");
    expect((await sitesFor(db, scope("owner-a", "org-a")).overview())!.inquiries.open).toBe(true);
  });
  it("is what the public reading says, read when the page is shown: closing it is immediate", async () => {
    const repo = sitesFor(db, scope("owner-a", "org-a"));
    expect((await publishedSiteBySlug(db, "marina-a"))!.inquiriesOpen).toBe(true);
    await repo.setInquiriesOpen(false, at(5));
    expect((await publishedSiteBySlug(db, "marina-a"))!.inquiriesOpen).toBe(false);
    await repo.setInquiriesOpen(true, at(6));
  });
  it("warns, when publishing, that a form on a site that does not receive messages is not seen", async () => {
    const repo = await site("org-f", "owner-f", "estudio-f", { publish: false, open: false });
    const draft = (await repo.overview())!.draft;
    const asked = await repo.publish(draft.revision, at(1));
    expect(asked.status).toBe("warnings");
    if (asked.status === "warnings") expect(asked.issues.some((issue) => /Formulário de contato.*desligado/.test(issue.message))).toBe(true);
    await repo.setInquiriesOpen(true, at(2));
    expect((await repo.publish(draft.revision, at(3))).status).toBe("published");
  });
});

describe("a message from the public page", () => {
  it("is written for the organization of the site the address names, with what was sent and the notice that stood beside the box", async () => {
    expect(await send("marina-a")).toEqual({ status: "received" });
    const row = await one<Record<string, unknown>>("SELECT * FROM site_inquiries WHERE organization_id = 'org-a'");
    expect(row).toMatchObject({ organization_id: "org-a", name: "Ana Souza", email: "ana@example.test", email_key: "ana@example.test", phone: null, phone_key: null, message: "Quero saber dos planos", notice_url: NOTICE, page: "" });
    expect(await count("SELECT 1 FROM site_inquiries WHERE organization_id = 'org-b'")).toBe(0);
    // Another site gets its own.
    expect(await send("studio-b", { name: "Bia Lima", email: null, phone: "(11) 91234-5678", message: null, page: "planos" })).toEqual({ status: "received" });
    expect(await one("SELECT organization_id, phone_key, message, page FROM site_inquiries WHERE name = 'Bia Lima'")).toMatchObject({ organization_id: "org-b", phone_key: "11912345678", message: null, page: "planos" });
  });
  it("is refused as closed when the address is not a site, the site is not public, or the site has not opened its switch (and nothing is written)", async () => {
    const before = await count("SELECT 1 FROM site_inquiries");
    expect(await send("nao-existe")).toEqual({ status: "closed" });
    expect(await send("Not A Slug!!")).toEqual({ status: "closed" });
    const unpublished = await site("org-d", "owner-d", "estudio-d", { publish: false, open: true });
    expect(await send("estudio-d")).toEqual({ status: "closed" });
    await unpublished.setInquiriesOpen(false, at(1));
    expect(await send("estudio-d")).toEqual({ status: "closed" });
    const repo = sitesFor(db, scope("owner-a", "org-a"));
    await repo.setInquiriesOpen(false, at(7));
    expect(await send("marina-a")).toEqual({ status: "closed" });
    await repo.setInquiriesOpen(true, at(8));
    expect(await count("SELECT 1 FROM site_inquiries")).toBe(before);
  });
  it(`takes ${INQUIRIES_PER_SENDER_PER_HOUR} an hour from one sender, then stops that sender and no one else, and takes it again after the hour`, async () => {
    const sender = "a".repeat(32);
    for (let n = 0; n < INQUIRIES_PER_SENDER_PER_HOUR; n++) expect(await send("marina-a", { name: `Pessoa ${n}` }, sender, 10 + n)).toEqual({ status: "received" });
    expect(await send("marina-a", { name: "Pessoa demais" }, sender, 16)).toEqual({ status: "limited" });
    expect(await one("SELECT 1 AS x FROM site_inquiries WHERE name = 'Pessoa demais'")).toBeNull();
    expect(await send("marina-a", { name: "Outra pessoa" }, "b".repeat(32), 16)).toEqual({ status: "received" });
    // Sixty-one minutes after the first of the five, the count looks only at the last four.
    expect(await send("marina-a", { name: "Depois da hora" }, sender, 71)).toEqual({ status: "received" });
  });
  it("empties the hash of an address once the hour it is counted over has passed, and keeps what the person wrote", async () => {
    await send("studio-b", { name: "Com endereço" }, "c".repeat(32), 100);
    expect((await one<{ ip_key: string | null }>("SELECT ip_key FROM site_inquiries WHERE name = 'Com endereço'"))!.ip_key).toBe("c".repeat(32));
    await send("studio-b", { name: "Depois" }, "d".repeat(32), 170);
    expect((await one<{ ip_key: string | null; name: string }>("SELECT ip_key, name FROM site_inquiries WHERE name = 'Com endereço'"))).toEqual({ ip_key: null, name: "Com endereço" });
    expect((await one<{ ip_key: string | null }>("SELECT ip_key FROM site_inquiries WHERE name = 'Depois'"))!.ip_key).toBe("d".repeat(32));
  });
  it(`takes ${INQUIRIES_PER_SITE_PER_HOUR} an hour for the whole site, whoever sends`, async () => {
    await site("org-c", "owner-c", "estudio-c");
    for (let n = 0; n < INQUIRIES_PER_SITE_PER_HOUR; n++) expect((await send("estudio-c", { name: `Visitante ${n}` }, n.toString(16).padStart(32, "0"), 200)).status).toBe("received");
    expect(await send("estudio-c", { name: "Mais um" }, "f".repeat(32), 201)).toEqual({ status: "limited" });
    expect(await send("estudio-c", { name: "Sem endereço" }, null, 201)).toEqual({ status: "limited" });
  });
  it(`stops when ${INQUIRIES_WAITING_MAX} are waiting, and takes again when some are handled`, async () => {
    await site("org-g", "owner-g", "estudio-g");
    const siteG = (await one<{ id: string }>("SELECT id FROM sites WHERE slug = 'estudio-g'"))!.id;
    await db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?3)
         INSERT INTO site_inquiries (id, organization_id, site_id, name, email, email_key, notice_url, created_at)
         SELECT 'bulk-' || i, 'org-g', ?1, 'Fulano ' || i, 'f' || i || '@example.test', 'f' || i || '@example.test', 'https://example.test/aviso', ?2 FROM n`,
      )
      .bind(siteG, "2026-10-01T00:00:00.000Z", INQUIRIES_WAITING_MAX)
      .run();
    expect(await send("estudio-g", { name: "Quinhentos e um" }, null, 400)).toEqual({ status: "limited" });
    expect(await siteInquiriesFor(db, scope("owner-g", "org-g")).discard("bulk-1", at(401))).toEqual({ status: "discarded" });
    expect(await send("estudio-g", { name: "Quinhentos e um" }, null, 402)).toEqual({ status: "received" });
  });
  it("is stopped by the database as well: an inquiry belongs to the organization of its site, and what was written is never edited", async () => {
    const siteA = (await one<{ id: string }>("SELECT id FROM sites WHERE slug = 'marina-a'"))!.id;
    await expect(
      db.prepare("INSERT INTO site_inquiries (id, organization_id, site_id, name, email, email_key, notice_url) VALUES ('x1','org-b',?1,'Ana','a@e.test','a@e.test','https://example.test/aviso')").bind(siteA).run(),
    ).rejects.toThrow();
    await expect(db.prepare("UPDATE site_inquiries SET name = 'Outro nome' WHERE name = 'Ana Souza'").run()).rejects.toThrow();
    await expect(db.prepare("UPDATE site_inquiries SET message = 'mudou' WHERE name = 'Ana Souza'").run()).rejects.toThrow();
    // Neither a contact-less message, nor one whose keys do not match, is accepted.
    await expect(
      db.prepare("INSERT INTO site_inquiries (id, organization_id, site_id, name, notice_url) VALUES ('x2','org-a',?1,'Ana','https://example.test/aviso')").bind(siteA).run(),
    ).rejects.toThrow();
  });
});

describe("the messages of the organization", () => {
  const owner = () => siteInquiriesFor(db, scope("owner-a", "org-a"));
  it("are read by the owner, a manager and a commercial member of that organization only", async () => {
    const mine = await owner().list();
    expect(mine.length).toBeGreaterThan(5);
    expect(mine.every((row) => !("ipKey" in row))).toBe(true);
    for (const who of ["manager-a", "commercial-a"]) expect((await siteInquiriesFor(db, scope(who, "org-a")).list()).length, who).toBe(mine.length);
    for (const who of ["tech-a", "blocked-a"]) expect(await siteInquiriesFor(db, scope(who, "org-a")).list(), who).toEqual([]);
    expect(await siteInquiriesFor(db, scope("owner-b", "org-a")).list()).toEqual([]);
    expect((await siteInquiriesFor(db, scope("owner-b", "org-b")).list()).every((row) => row.name !== "Ana Souza")).toBe(true);
    expect(await owner().count()).toBe(mine.length);
    expect(await siteInquiriesFor(db, scope("tech-a", "org-a")).count()).toBe(0);
  });
  it("say how many leads already have the same contact", async () => {
    const created = await leadsFor(db, scope("owner-a", "org-a")).create({ name: "Ana S.", email: "ANA@example.test", source: "INSTAGRAM" }, {}, at(300));
    expect(created.status).toBe("created");
    const ana = (await owner().list()).find((row) => row.name === "Ana Souza")!;
    expect(ana.sameContact).toBe(1);
    expect(await send("marina-a", { name: "Zeca", email: "zeca@example.test" }, null, 299)).toEqual({ status: "received" });
    expect((await owner().list()).find((row) => row.name === "Zeca")!.sameContact).toBe(0);
  });
  it("become a lead of origin Site with what the person wrote as the first note, once, and are deleted", async () => {
    const ana = (await owner().list()).find((row) => row.name === "Ana Souza")!;
    const done = await owner().convert(ana.id, at(310));
    expect(done.status).toBe("converted");
    if (done.status !== "converted") return;
    expect(await one("SELECT name, email, email_key, phone, source, stage, created_by, organization_id FROM leads WHERE id = ?1", done.leadId)).toEqual({
      name: "Ana Souza",
      email: "ana@example.test",
      email_key: "ana@example.test",
      phone: null,
      source: "SITE",
      stage: "NEW",
      created_by: "owner-a",
      organization_id: "org-a",
    });
    expect(await one("SELECT kind, note, actor_user_id FROM lead_events WHERE lead_id = ?1", done.leadId)).toEqual({ kind: "CREATED", note: "Quero saber dos planos", actor_user_id: "owner-a" });
    expect(await one("SELECT 1 AS x FROM site_inquiries WHERE id = ?1", ana.id)).toBeNull();
    expect(await one("SELECT action FROM access_audit_events WHERE subject_id = ?1", done.leadId)).toEqual({ action: "SITE_INQUIRY_CONVERTED" });
    // Doing it again (a double click, a second tab) finds nothing and creates nothing.
    const leadsBefore = await count("SELECT 1 FROM leads WHERE organization_id = 'org-a'");
    expect(await owner().convert(ana.id, at(311))).toEqual({ status: "not_found" });
    expect(await count("SELECT 1 FROM leads WHERE organization_id = 'org-a'")).toBe(leadsBefore);
    // The lead shows up in the list of leads with its origin.
    const listed = await leadsFor(db, scope("owner-a", "org-a")).list(null);
    expect(listed.find((row) => row.id === done.leadId)).toMatchObject({ source: "SITE", name: "Ana Souza" });
  });
  it("become a lead with no note when there was no message", async () => {
    const bia = (await siteInquiriesFor(db, scope("owner-b", "org-b")).list()).find((row) => row.name === "Bia Lima")!;
    const done = await siteInquiriesFor(db, scope("owner-b", "org-b")).convert(bia.id, at(312));
    expect(done.status).toBe("converted");
    if (done.status === "converted") expect(await one("SELECT note, kind FROM lead_events WHERE lead_id = ?1", done.leadId)).toEqual({ note: null, kind: "CREATED" });
  });
  it("are not turned into a lead, nor discarded, by anyone who does not work the leads or is of another organization", async () => {
    const target = (await owner().list()).find((row) => row.name === "Outra pessoa")!;
    const leadsBefore = await count("SELECT 1 FROM leads");
    for (const who of [scope("tech-a", "org-a"), scope("blocked-a", "org-a"), scope("owner-b", "org-a"), scope("owner-b", "org-b")]) {
      expect(await siteInquiriesFor(db, who).convert(target.id, at(320)), JSON.stringify(who)).toEqual({ status: "not_found" });
      expect(await siteInquiriesFor(db, who).discard(target.id, at(320)), JSON.stringify(who)).toEqual({ status: "not_found" });
    }
    expect(await count("SELECT 1 FROM leads")).toBe(leadsBefore);
    expect(await one("SELECT 1 AS x FROM site_inquiries WHERE id = ?1", target.id)).not.toBeNull();
  });
  it("are discarded for good by a commercial member too, with a line in the trail, and discarding twice does nothing", async () => {
    const target = (await owner().list()).find((row) => row.name === "Outra pessoa")!;
    const commercial = siteInquiriesFor(db, scope("commercial-a", "org-a"));
    expect(await commercial.discard(target.id, at(330))).toEqual({ status: "discarded" });
    expect(await one("SELECT 1 AS x FROM site_inquiries WHERE id = ?1", target.id)).toBeNull();
    expect(await one("SELECT action, actor_user_id FROM access_audit_events WHERE subject_id = ?1", target.id)).toEqual({ action: "SITE_INQUIRY_DISCARDED", actor_user_id: "commercial-a" });
    expect(await commercial.discard(target.id, at(331))).toEqual({ status: "not_found" });
    expect(await count("SELECT 1 FROM access_audit_events WHERE subject_id = ?1", target.id)).toBe(1);
  });
});

describe("a lead that came from the site", () => {
  it("keeps its origin when it is edited, and no other lead can be given that origin by hand", async () => {
    const repo = leadsFor(db, scope("owner-a", "org-a"));
    const fromSite = (await repo.list(null)).find((row) => row.source === "SITE")!;
    expect(await repo.update(fromSite.id, { name: "Ana Souza Lima", email: "ana@example.test", source: "SITE" }, at(340))).toEqual({ status: "saved" });
    expect((await repo.find(fromSite.id))!).toMatchObject({ name: "Ana Souza Lima", source: "SITE" });
    const manual = await repo.create({ name: "Caio Reis", phone: "(11) 98888-7777", source: "OUTRO" }, {}, at(341));
    if (manual.status !== "created") throw new Error("manual lead");
    expect(await repo.update(manual.id, { name: "Caio Reis", phone: "(11) 98888-7777", source: "SITE" }, at(342))).toEqual({ status: "not_found" });
    expect((await repo.find(manual.id))!.source).toBe("OUTRO");
    // And a lead may still leave "Site" for another origin if the person says so.
    expect(await repo.update(fromSite.id, { name: "Ana Souza Lima", email: "ana@example.test", source: "INDICACAO" }, at(343))).toEqual({ status: "saved" });
  });
});
