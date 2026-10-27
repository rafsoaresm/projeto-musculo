import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishedSiteBySlug, sitesFor } from "@/db/sites";
import { servicesFor } from "@/db/services";
import { sha256Hex } from "@/db/crypto";
import { emptyBlock, type SiteContent } from "@/modules/meu-site/contracts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration, triggers included. Identities are rows, as the server derives them
// from a verified session; the repository repeats membership, role and active login in each statement.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const T0 = new Date("2026-10-27T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const owner = () => sitesFor(db, scope("owner-a"));
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string, ...binds: unknown[]) => (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM (${sql})`, ...binds))!.c;

/** A page that can be published once the contact is there. */
const complete = (overrides: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 1,
  title: "Marina Treinos",
  description: "Treino com acompanhamento",
  contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" },
  blocks: [
    { id: "h1", type: "hero", heading: "Treino sob medida", subheading: "", buttonLabel: "Falar comigo", buttonChannel: "whatsapp" },
    { id: "t1", type: "text", heading: "Sobre", text: "Texto <b>com marcação</b>" },
  ],
  ...overrides,
});
async function readyDraft(who = "owner-a", content: SiteContent = complete()) {
  const repo = sitesFor(db, scope(who));
  const overview = await repo.overview();
  if (!overview) throw new Error("no site");
  const saved = await repo.saveDraft(content, overview.draft.revision, at(1));
  if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
  return saved.revision;
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "sites-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "manager-a", "commercial-a", "tech-a", "finance-a", "owner-b", "outsider", "blocked-a", "revoked-a", "commercial-c"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    db.prepare(`INSERT INTO users(id) VALUES ${people.filter((p) => p !== "blocked-a").map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO users(id, disabled_at) VALUES ('blocked-a', '2026-10-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B'),('org-c','Studio C')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','manager-a','MANAGER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),
       ('org-a','tech-a','TECHNICAL',NULL),('org-a','finance-a','FINANCE',NULL),('org-b','owner-b','OWNER',NULL),
       ('org-a','blocked-a','MANAGER',NULL),('org-a','revoked-a','MANAGER','2026-10-02T00:00:00.000Z'),('org-c','commercial-c','COMMERCIAL',NULL)`,
    ),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("creating the site", () => {
  it("starts the site of the owner with the name as title, a highlight and a call to contact, and a line in the trail", async () => {
    expect(await owner().overview()).toBeNull();
    expect(await owner().create({ slug: "Marina-Treinos", title: "Marina Treinos" }, at(0))).toEqual({ status: "created" });
    const overview = (await owner().overview())!;
    expect(overview.site.slug).toBe("marina-treinos");
    expect(overview.draft.revision).toBe(1);
    expect(overview.draft.content).toMatchObject({ title: "Marina Treinos", blocks: [{ type: "hero", heading: "Marina Treinos" }, { type: "cta" }] });
    expect(overview.live).toBeNull();
    expect(overview.releases).toEqual([]);
    const line = await one<{ action: string; actor: string; org: string }>(
      "SELECT action, actor_user_id AS actor, organization_id AS org FROM access_audit_events WHERE action = 'SITE_CREATED'",
    );
    expect(line).toEqual({ action: "SITE_CREATED", actor: "owner-a", org: "org-a" });
  });
  it("is one site per organization, and an address is taken by one organization only", async () => {
    expect(await owner().create({ slug: "outro-endereco", title: "Outra" }, at(1))).toEqual({ status: "exists" });
    expect(await sitesFor(db, scope("owner-b", "org-b")).create({ slug: "marina-treinos", title: "Marina B" }, at(1))).toEqual({ status: "slug_taken" });
    expect(await count("SELECT 1 FROM sites WHERE organization_id = 'org-b'")).toBe(0);
    expect(await sitesFor(db, scope("owner-b", "org-b")).create({ slug: "studio-b", title: "Studio B" }, at(2))).toEqual({ status: "created" });
  });
  it("refuses an address that is reserved or badly made, and a title that is too short", async () => {
    const repo = sitesFor(db, scope("commercial-c", "org-c"));
    for (const slug of ["gestor", "ab", "mari--na", "-x-", "com espaço", "API"]) await expect(repo.create({ slug, title: "Titulo" })).rejects.toThrow();
    await expect(repo.create({ slug: "valido", title: "A" })).rejects.toThrow();
  });
  it("is for the owner and a manager: a commercial member, a technical one and a stranger do not create it", async () => {
    for (const [who, org] of [["commercial-c", "org-c"], ["tech-a", "org-a"], ["outsider", "org-c"], ["finance-a", "org-a"]] as const) {
      const outcome = await sitesFor(db, scope(who, org)).create({ slug: `site-${who}`, title: "Tentativa" });
      expect(["forbidden", "exists"], who).toContain(outcome.status);
    }
    expect(await count("SELECT 1 FROM sites WHERE organization_id = 'org-c'")).toBe(0);
    expect(await count("SELECT 1 FROM sites WHERE slug LIKE 'site-%'")).toBe(0);
  });
});

describe("who sees and edits the draft", () => {
  it("lets the owner, a manager and a commercial member read it, and nobody else", async () => {
    for (const who of ["owner-a", "manager-a", "commercial-a"]) expect((await sitesFor(db, scope(who)).overview())?.site.slug, who).toBe("marina-treinos");
    for (const who of ["tech-a", "finance-a", "outsider", "blocked-a", "revoked-a"]) {
      expect(await sitesFor(db, scope(who)).overview(), who).toBeNull();
      expect(await sitesFor(db, scope(who)).preview(), who).toBeNull();
    }
    expect(await sitesFor(db, scope("owner-b", "org-b")).overview().then((o) => o?.site.slug)).toBe("studio-b");
  });
  it("lets only the owner and a manager write, and leaves the draft alone for the others", async () => {
    const before = (await owner().overview())!;
    for (const who of ["commercial-a", "tech-a", "blocked-a", "revoked-a"]) {
      const repo = sitesFor(db, scope(who));
      expect((await repo.saveDraft(complete(), before.draft.revision, at(3))).status, who).not.toBe("saved");
      expect(await repo.unpublish(at(3)), who).toBe(false);
    }
    expect((await owner().overview())!.draft.revision).toBe(before.draft.revision);
    expect((await sitesFor(db, scope("manager-a")).saveDraft(complete(), before.draft.revision, at(4))).status).toBe("saved");
  });
  it("does not let one organization touch the site of another", async () => {
    const mine = (await owner().overview())!;
    const other = sitesFor(db, scope("owner-b", "org-b"));
    const theirs = (await other.overview())!;
    expect(theirs.site.slug).toBe("studio-b");
    expect((await other.saveDraft(complete({ title: "Invadido" }), theirs.draft.revision, at(5))).status).toBe("saved");
    expect((await owner().overview())!.draft.content.title).toBe(mine.draft.content.title);
    // Naming the release of another organization is "not found", not a way in.
    expect((await other.restore("nao-existe", theirs.draft.revision + 1, at(6))).status).toBe("not_found");
  });
});

describe("saving the draft", () => {
  it("goes up by one revision per save and takes an incomplete draft", async () => {
    const before = (await owner().overview())!;
    const incomplete = complete({ title: "", blocks: [emptyBlock("hero"), emptyBlock("services"), emptyBlock("faq")] });
    expect(await owner().saveDraft(incomplete, before.draft.revision, at(10))).toEqual({ status: "saved", revision: before.draft.revision + 1 });
    const after = (await owner().overview())!;
    expect(after.draft.revision).toBe(before.draft.revision + 1);
    expect(after.draft.content.title).toBe("");
    expect(after.draft.content.blocks).toHaveLength(3);
  });
  it("writes nothing when the draft is not the revision the person saw, and says so", async () => {
    const before = (await owner().overview())!;
    expect(await owner().saveDraft(complete({ title: "Texto de quem chegou tarde" }), before.draft.revision - 1, at(11))).toEqual({ status: "conflict" });
    expect(await owner().saveDraft(complete({ title: "Texto adiantado" }), before.draft.revision + 1, at(11))).toEqual({ status: "conflict" });
    const after = (await owner().overview())!;
    expect(after.draft.revision).toBe(before.draft.revision);
    expect(after.draft.content.title).toBe(before.draft.content.title);
  });
  it("refuses a document that is not one: another field, too many blocks, repeated identifiers", async () => {
    const revision = (await owner().overview())!.draft.revision;
    await expect(owner().saveDraft({ ...complete(), html: "<b>x</b>" }, revision, at(12))).rejects.toThrow();
    await expect(owner().saveDraft(complete({ blocks: Array.from({ length: 21 }, (_, i) => ({ ...(emptyBlock("text") as object), id: `b${i}` })) as never }), revision, at(12))).rejects.toThrow();
    await expect(owner().saveDraft(complete({ blocks: [{ ...(emptyBlock("text") as object), id: "x" }, { ...(emptyBlock("text") as object), id: "x" }] as never }), revision, at(12))).rejects.toThrow();
    expect((await owner().overview())!.draft.revision).toBe(revision);
  });
  it("is stopped by the database as well: the revision cannot skip or go back under a direct statement", async () => {
    const siteId = (await owner().overview())!.site.id;
    await expect(db.prepare("UPDATE site_drafts SET revision = revision + 5 WHERE site_id = ?").bind(siteId).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE site_drafts SET revision = revision WHERE site_id = ?").bind(siteId).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE site_drafts SET content = 'not json', revision = revision + 1 WHERE site_id = ?").bind(siteId).run()).rejects.toThrow();
  });
});

describe("publishing", () => {
  it("says what is missing and publishes nothing", async () => {
    const revision = await readyDraft("owner-a", complete({ contact: { whatsapp: "", email: "", instagram: "" } }));
    const outcome = await owner().publish(revision, at(20));
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") expect(outcome.issues[0].message).toContain("WhatsApp");
    expect(await count("SELECT 1 FROM site_releases")).toBe(0);
    expect(await count("SELECT 1 FROM site_published")).toBe(0);
    expect(await publishedSiteBySlug(db, "marina-treinos")).toBeNull();
  });
  it("makes release 1 public, moves the pointer in the same step, and leaves the draft where it was", async () => {
    const revision = await readyDraft();
    expect(await owner().publish(revision, at(21))).toEqual({ status: "published", number: 1 });
    const overview = (await owner().overview())!;
    expect(overview.live).toMatchObject({ number: 1, draftRevision: revision });
    expect(overview.draft.revision).toBe(revision);
    expect(overview.releases).toMatchObject([{ number: 1, live: true, createdByName: "owner-a", draftRevision: revision }]);
    const publicSite = (await publishedSiteBySlug(db, "marina-treinos"))!;
    expect(publicSite.number).toBe(1);
    expect(publicSite.content.title).toBe("Marina Treinos");
    // The markup typed in a text stays what it is: text.
    expect((publicSite.content.blocks[1] as { text: string }).text).toBe("Texto <b>com marcação</b>");
    const hash = (await one<{ h: string; c: string }>("SELECT content_sha256 AS h, content AS c FROM site_releases WHERE number = 1"))!;
    expect(hash.h).toBe(await sha256Hex(hash.c));
    const line = await one<{ subject: string }>("SELECT subject_id AS subject FROM access_audit_events WHERE action = 'SITE_PUBLISHED'");
    expect(line!.subject).toBe((await one<{ id: string }>("SELECT id FROM site_releases WHERE number = 1"))!.id);
  });
  it("does not change what is public when the draft changes, only when the next release is made", async () => {
    const overview = (await owner().overview())!;
    const edited = await owner().saveDraft(complete({ title: "Título novo, ainda não publicado" }), overview.draft.revision, at(30));
    if (edited.status !== "saved") throw new Error("not saved");
    expect((await publishedSiteBySlug(db, "marina-treinos"))!.content.title).toBe("Marina Treinos");
    const after = (await owner().overview())!;
    expect(after.draft.revision).toBeGreaterThan(after.live!.draftRevision);
    expect(await owner().publish(edited.revision, at(31))).toEqual({ status: "published", number: 2 });
    expect((await publishedSiteBySlug(db, "marina-treinos"))!.content.title).toBe("Título novo, ainda não publicado");
    expect((await owner().overview())!.releases.map((r) => [r.number, r.live])).toEqual([[2, true], [1, false]]);
  });
  it("refuses to publish a draft that is not the revision the person saw, and publishes nothing", async () => {
    const revision = (await owner().overview())!.draft.revision;
    expect(await owner().publish(revision - 1, at(32))).toEqual({ status: "conflict" });
    expect(await count("SELECT 1 FROM site_releases")).toBe(2);
  });
  it("is for the owner and a manager only", async () => {
    const revision = (await owner().overview())!.draft.revision;
    for (const who of ["commercial-a", "tech-a", "blocked-a", "revoked-a"]) {
      expect((await sitesFor(db, scope(who)).publish(revision, at(33))).status, who).not.toBe("published");
    }
    expect(await count("SELECT 1 FROM site_releases")).toBe(2);
    expect((await sitesFor(db, scope("manager-a")).publish(revision, at(34))).status).toBe("published");
  });
  it("makes two publications that arrive together become two releases in order, never two with one number", async () => {
    const revision = (await owner().overview())!.draft.revision;
    const [a, b] = await Promise.all([owner().publish(revision, at(40)), sitesFor(db, scope("manager-a")).publish(revision, at(40))]);
    const numbers = [a, b].flatMap((o) => (o.status === "published" ? [o.number] : [])).sort();
    expect(numbers.length).toBeGreaterThan(0);
    const all = (await db.prepare("SELECT number FROM site_releases ORDER BY number").all<{ number: number }>()).results.map((r) => r.number);
    expect(all).toEqual(all.map((_, i) => i + 1));
    expect((await owner().overview())!.live!.number).toBe(all[all.length - 1]);
  });
});

describe("a publication that is being prepared while the draft changes", () => {
  it("never makes a release that says it came from a revision whose text it does not have", async () => {
    const titles = new Map<number, string>();
    for (let round = 0; round < 4; round += 1) {
      const current = (await owner().overview())!;
      const base = await owner().saveDraft(complete({ title: `Base ${round}` }), current.draft.revision, at(90 + round));
      if (base.status !== "saved") throw new Error("not saved");
      titles.set(base.revision, `Base ${round}`);
      // The publication reads the draft, and the draft is saved again before the publication writes.
      const [published, changed] = await Promise.all([
        owner().publish(base.revision, at(95 + round)),
        owner().saveDraft(complete({ title: `Mudado ${round}` }), base.revision, at(95 + round)),
      ]);
      if (changed.status === "saved") titles.set(changed.revision, `Mudado ${round}`);
      expect(["published", "conflict"]).toContain(published.status);
    }
    const releases = (await db.prepare("SELECT draft_revision AS revision, content FROM site_releases").all<{ revision: number; content: string }>()).results;
    for (const release of releases) {
      const known = titles.get(release.revision);
      if (known) expect(JSON.parse(release.content).title, `revision ${release.revision}`).toBe(known);
    }
  });
});

describe("the services shown on the page", () => {
  it("are written into the release as they are when it is made, and a later change does not reach what is public", async () => {
    const services = servicesFor(db, scope("owner-a"));
    const created = await services.create({ name: "Consultoria online", description: "Plano mensal", delivery: "ONLINE" }, at(50));
    if (created.status !== "saved") throw new Error("not saved");
    const draft = complete({
      blocks: [...complete().blocks, { id: "s1", type: "services", heading: "O que ofereço", intro: "", serviceIds: [created.id] }],
    });
    const revision = await readyDraft("owner-a", draft);
    const outcome = await owner().publish(revision, at(51));
    expect(outcome.status).toBe("published");
    const block = (await publishedSiteBySlug(db, "marina-treinos"))!.content.blocks.find((b) => b.type === "services") as { items: unknown[]; serviceIds: string[] };
    expect(block.items).toEqual([{ name: "Consultoria online", description: "Plano mensal", delivery: "ONLINE" }]);
    await services.update(created.id, { name: "Nome mudado depois", delivery: "HYBRID" }, at(52));
    const still = (await publishedSiteBySlug(db, "marina-treinos"))!.content.blocks.find((b) => b.type === "services") as { items: Array<{ name: string }> };
    expect(still.items[0].name).toBe("Consultoria online");
    // The draft does not carry the resolved services; the preview resolves them now.
    expect(((await owner().overview())!.draft.content.blocks.find((b) => b.type === "services") as { items?: unknown }).items).toBeUndefined();
    const preview = (await owner().preview())!.content.blocks.find((b) => b.type === "services") as { items: Array<{ name: string }> };
    expect(preview.items[0].name).toBe("Nome mudado depois");
  });
  it("stop a publication when one of them left the offer or is not the organization's", async () => {
    const [{ id }] = (await servicesFor(db, scope("owner-a")).list()).filter((s) => s.name === "Nome mudado depois");
    await servicesFor(db, scope("owner-a")).setActive(id, false, at(53));
    const outcome = await owner().publish((await owner().overview())!.draft.revision, at(54));
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") expect(outcome.issues.some((i) => i.message.includes("saiu da oferta"))).toBe(true);
    const foreign = await servicesFor(db, scope("owner-b", "org-b")).create({ name: "Serviço da B", delivery: "ONLINE" }, at(55));
    if (foreign.status !== "saved") throw new Error("not saved");
    const revision = (await owner().overview())!.draft.revision;
    const saved = await owner().saveDraft(complete({ blocks: [{ id: "s1", type: "services", heading: "S", intro: "", serviceIds: [foreign.id] }] }), revision, at(56));
    if (saved.status !== "saved") throw new Error("not saved");
    expect((await owner().publish(saved.revision, at(57))).status).toBe("invalid");
  });
});

describe("what the database refuses on its own", () => {
  it("keeps a release as it was made: no edit, no deletion, no number out of order, no pointer to another site's release", async () => {
    const release = (await one<{ id: string; site: string }>("SELECT id, site_id AS site FROM site_releases ORDER BY number LIMIT 1"))!;
    await expect(db.prepare("UPDATE site_releases SET content = '{}' WHERE id = ?").bind(release.id).run()).rejects.toThrow();
    await expect(db.prepare("DELETE FROM site_releases WHERE id = ?").bind(release.id).run()).rejects.toThrow();
    await expect(
      db
        .prepare("INSERT INTO site_releases(id,site_id,number,draft_revision,content,content_sha256,created_by) VALUES ('r-gap',?,99,1,'{}',?,'owner-a')")
        .bind(release.site, "a".repeat(64))
        .run(),
    ).rejects.toThrow();
    const otherSite = (await one<{ id: string }>("SELECT id FROM sites WHERE organization_id = 'org-b'"))!.id;
    await expect(
      db.prepare("INSERT INTO site_published(site_id, release_id, published_by) VALUES (?, ?, 'owner-b')").bind(otherSite, release.id).run(),
    ).rejects.toThrow();
  });
  it("has no public page without a row in the pointer table, whatever the releases say", async () => {
    expect(await publishedSiteBySlug(db, "studio-b")).toBeNull();
    expect(await count("SELECT 1 FROM site_published WHERE site_id = (SELECT id FROM sites WHERE organization_id = 'org-b')")).toBe(0);
  });
});

describe("reading the public page", () => {
  it("answers the same for an unknown address, a malformed one and a page that is not public", async () => {
    expect(await publishedSiteBySlug(db, "nao-existe")).toBeNull();
    for (const bad of ["", "../etc/passwd", "marina treinos", "a", "x".repeat(60), "marina-treinos/../x", "' OR 1=1 --", "%2e%2e"]) expect(await publishedSiteBySlug(db, bad), bad).toBeNull();
    expect(await publishedSiteBySlug(db, "studio-b")).toBeNull();
  });
  it("finds the page whatever the case of the address, and returns nothing of the organization", async () => {
    const found = (await publishedSiteBySlug(db, "MARINA-Treinos"))!;
    expect(Object.keys(found).sort()).toEqual(["content", "number", "publishedAt", "slug"]);
    expect(JSON.stringify(found)).not.toContain("org-a");
    expect(JSON.stringify(found)).not.toContain("owner-a");
  });
});

describe("the address", () => {
  it("can change while the page is not public, not while it is, and not to an address that is taken", async () => {
    const repo = sitesFor(db, scope("owner-b", "org-b"));
    expect(await repo.changeSlug("studio-b-novo", at(60))).toEqual({ status: "changed" });
    expect(await repo.changeSlug("marina-treinos", at(61))).toEqual({ status: "slug_taken" });
    await expect(repo.changeSlug("gestor", at(62))).rejects.toThrow();
    expect((await repo.overview())!.site.slug).toBe("studio-b-novo");
    expect(await owner().changeSlug("outro-nome", at(63))).toEqual({ status: "public" });
    expect((await owner().overview())!.site.slug).toBe("marina-treinos");
    await expect(db.prepare("UPDATE sites SET slug = 'outro-nome' WHERE organization_id = 'org-a'").run()).rejects.toThrow();
  });
});

describe("taking the page offline and bringing a version back", () => {
  it("takes it offline for the owner and a manager, keeps the releases, and a new publication continues the numbers", async () => {
    expect(await sitesFor(db, scope("commercial-a")).unpublish(at(70))).toBe(false);
    const before = await count("SELECT 1 FROM site_releases");
    expect(await sitesFor(db, scope("manager-a")).unpublish(at(71))).toBe(true);
    expect(await publishedSiteBySlug(db, "marina-treinos")).toBeNull();
    expect((await owner().overview())!.live).toBeNull();
    expect(await count("SELECT 1 FROM site_releases")).toBe(before);
    expect(await owner().unpublish(at(72))).toBe(false);
    const revision = (await owner().overview())!.draft.revision;
    const saved = await owner().saveDraft(complete(), revision, at(73));
    if (saved.status !== "saved") throw new Error("not saved");
    const outcome = await owner().publish(saved.revision, at(74));
    expect(outcome).toEqual({ status: "published", number: before + 1 });
    expect(await publishedSiteBySlug(db, "marina-treinos")).not.toBeNull();
    for (const action of ["SITE_UNPUBLISHED", "SITE_PUBLISHED", "SITE_CREATED"]) expect(await count("SELECT 1 FROM access_audit_events WHERE action = ?", action), action).toBeGreaterThan(0);
  });
  it("brings an earlier release back as the draft, without the resolved services, and changes nothing public", async () => {
    const withServices = (await db.prepare("SELECT id, number FROM site_releases WHERE content LIKE '%\"items\"%' ORDER BY number LIMIT 1").first<{ id: string; number: number }>())!;
    const revision = (await owner().overview())!.draft.revision;
    const liveBefore = (await owner().overview())!.live!.number;
    expect(await owner().restore(withServices.id, revision, at(80))).toEqual({ status: "restored", revision: revision + 1 });
    const draft = (await owner().overview())!.draft;
    expect(draft.revision).toBe(revision + 1);
    const services = draft.content.blocks.find((b) => b.type === "services") as { serviceIds: string[]; items?: unknown };
    expect(services.serviceIds).toHaveLength(1);
    expect(services.items).toBeUndefined();
    expect((await owner().overview())!.live!.number).toBe(liveBefore);
    expect(await owner().restore(withServices.id, revision, at(81))).toEqual({ status: "conflict" });
    expect((await sitesFor(db, scope("commercial-a")).restore(withServices.id, revision + 1, at(82))).status).toBe("conflict");
    expect((await owner().restore("nao-existe", revision + 1, at(83))).status).toBe("not_found");
  });
});
