import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leadsFor } from "@/db/leads";
import { servicesFor } from "@/db/services";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration, triggers included. Identities are rows, as the server derives them
// from a verified session; the repositories repeat membership and active login in each statement.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const T0 = new Date("2026-10-27T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
let n = 0;
const lead = (overrides: Record<string, unknown> = {}) => ({
  name: `Pessoa ${++n}`,
  email: `pessoa${n}@example.test`,
  source: "INSTAGRAM",
  ...overrides,
});
const owner = () => leadsFor(db, scope("owner-a"));
async function newLead(overrides: Record<string, unknown> = {}, who = "owner-a") {
  const outcome = await leadsFor(db, scope(who)).create(lead(overrides), {}, at(0));
  if (outcome.status !== "created") throw new Error(`lead not created: ${JSON.stringify(outcome)}`);
  return outcome.id;
}
async function wonLead(overrides: Record<string, unknown> = {}) {
  const id = await newLead(overrides);
  expect((await owner().moveTo(id, "NEW", { to: "WON" }, at(60))).status).toBe("moved");
  return id;
}
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string, ...binds: unknown[]) => (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM (${sql})`, ...binds))!.c;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "leads-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "manager-a", "commercial-a", "commercial-pro", "tech-a", "finance-a", "owner-b", "outsider", "blocked-a", "revoked-a"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    db.prepare(`INSERT INTO users(id) VALUES ${people.filter((p) => p !== "blocked-a").map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO users(id, disabled_at) VALUES ('blocked-a', '2026-10-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','manager-a','MANAGER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),
       ('org-a','tech-a','TECHNICAL',NULL),('org-a','finance-a','FINANCE',NULL),('org-b','owner-b','OWNER',NULL),('org-a','commercial-pro','COMMERCIAL',NULL),
       ('org-a','blocked-a','COMMERCIAL',NULL),('org-a','revoked-a','COMMERCIAL','2026-10-02T00:00:00.000Z')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-a','org-a','owner-a','Owner A'),('pro-m','org-a','manager-a','Manager A'),
       ('pro-t','org-a','tech-a','Tech A'),('pro-b','org-b','owner-b','Owner B'),('pro-c','org-a','commercial-pro','Commercial Pro')`,
    ),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("who works the leads of an organization", () => {
  it("lets the owner, a manager and a commercial member create and read them, and nobody else", async () => {
    for (const who of ["owner-a", "manager-a", "commercial-a"]) {
      const id = await newLead({}, who);
      expect((await leadsFor(db, scope(who)).find(id))?.id).toBe(id);
    }
    const id = await newLead();
    for (const who of ["tech-a", "finance-a", "outsider", "blocked-a", "revoked-a"]) {
      const repo = leadsFor(db, scope(who));
      expect((await repo.create(lead(), {}, at(1))).status).toBe("forbidden");
      expect(await repo.find(id)).toBeNull();
      expect(await repo.list()).toEqual([]);
      expect(await repo.timeline(id)).toEqual([]);
      expect(await repo.addNote(id, { note: "oi" })).toBe(false);
    }
  });
  it("keeps one organization's leads out of another's, even knowing the id", async () => {
    const id = await newLead();
    const other = leadsFor(db, scope("owner-b", "org-b"));
    expect(await other.find(id)).toBeNull();
    expect(await other.list()).toEqual([]);
    expect((await other.moveTo(id, "NEW", { to: "CONTACT" })).status).toBe("not_found");
    expect(await other.remove(id)).toBe(false);
    expect((await owner().find(id))?.stage).toBe("NEW");
    // Somebody of organization A cannot pass organization B in the context either: the membership is checked.
    expect(await leadsFor(db, scope("owner-b", "org-a")).list()).toEqual([]);
  });
  it("needs a verified context", () => {
    expect(() => leadsFor(db, null)).toThrow();
  });
});

describe("creating a lead", () => {
  it("stores what was typed, the keys to find duplicates, the origin and one line in the timeline", async () => {
    const id = await newLead({ name: "  Ana   Souza ", email: "Ana.Souza@Example.TEST", phone: "(11) 91234-5678", note: "Veio pelo story" });
    const row = await owner().find(id);
    expect(row).toMatchObject({ name: "Ana Souza", email: "Ana.Souza@Example.TEST", phone: "(11) 91234-5678", source: "INSTAGRAM", stage: "NEW", studentId: null });
    const keys = await one<{ e: string; p: string }>("SELECT email_key AS e, phone_key AS p FROM leads WHERE id = ?", id);
    expect(keys).toEqual({ e: "ana.souza@example.test", p: "11912345678" });
    const timeline = await owner().timeline(id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ kind: "CREATED", note: "Veio pelo story", actorName: "owner-a" });
  });
  it("asks before saving a person who is already in the list, by e-mail or by phone, and saves on confirmation", async () => {
    const first = await newLead({ name: "Beatriz", email: "bia@example.test", phone: "11 98888-7777" });
    const sameMail = await owner().create(lead({ name: "Outra Bia", email: " BIA@example.test " }), {}, at(2));
    expect(sameMail).toMatchObject({ status: "duplicates", matches: [{ id: first, name: "Beatriz", stage: "NEW" }] });
    const samePhone = await owner().create(lead({ name: "Bia de novo", email: undefined, phone: "+55 (11) 98888 7777" }), {}, at(3));
    expect(samePhone.status).toBe("duplicates");
    const before = await count("SELECT 1 FROM leads WHERE name IN ('Outra Bia','Bia de novo')");
    expect(before).toBe(0);
    const confirmed = await owner().create(lead({ name: "Outra Bia", email: "bia@example.test" }), { confirmDuplicates: true }, at(4));
    expect(confirmed.status).toBe("created");
  });
  it("finds duplicates only inside the organization", async () => {
    await leadsFor(db, scope("owner-b", "org-b")).create(lead({ name: "Carla B", email: "carla@example.test" }), {}, at(5));
    const outcome = await owner().create(lead({ name: "Carla A", email: "carla@example.test" }), {}, at(6));
    expect(outcome.status).toBe("created");
  });
  it("accepts a service of the organization that is on offer, and refuses another one", async () => {
    const services = servicesFor(db, scope("owner-a"));
    const online = await services.create({ name: "Consultoria online (lead)", delivery: "ONLINE" }, at(7));
    const old = await services.create({ name: "Pacote antigo (lead)", delivery: "IN_PERSON" }, at(7));
    if (online.status !== "saved" || old.status !== "saved") throw new Error("service not saved");
    await services.setActive(old.id, false, at(8));
    const foreign = await servicesFor(db, scope("owner-b", "org-b")).create({ name: "Serviço da B", delivery: "ONLINE" }, at(8));
    if (foreign.status !== "saved") throw new Error("service not saved");
    expect((await owner().create(lead({ serviceId: online.id }), {}, at(9))).status).toBe("created");
    expect((await owner().create(lead({ serviceId: old.id }), {}, at(9))).status).toBe("invalid_service");
    expect((await owner().create(lead({ serviceId: foreign.id }), {}, at(9))).status).toBe("invalid_service");
    expect((await owner().create(lead({ serviceId: "nao-existe" }), {}, at(9))).status).toBe("invalid_service");
  });
  it("is stopped by the database as well: a service of another organization cannot be written under a direct statement", async () => {
    const foreign = (await one<{ id: string }>("SELECT id FROM service_offerings WHERE organization_id = 'org-b' LIMIT 1"))!.id;
    await expect(
      db
        .prepare(
          `INSERT INTO leads(id, organization_id, name, email, email_key, source, service_id, created_by)
           VALUES ('x-cross', 'org-a', 'Cruzado', 'x@example.test', 'x@example.test', 'OUTRO', ?, 'owner-a')`,
        )
        .bind(foreign)
        .run(),
    ).rejects.toThrow();
  });
});

describe("working a lead along the funnel", () => {
  it("records each move with where it came from and went to, and brings the lead to the top of the list", async () => {
    const id = await newLead();
    expect(await owner().moveTo(id, "NEW", { to: "CONTACT", note: "Respondeu o direct" }, at(20))).toEqual({ status: "moved" });
    expect(await owner().moveTo(id, "CONTACT", { to: "PROPOSAL" }, at(30))).toEqual({ status: "moved" });
    const timeline = await owner().timeline(id);
    expect(timeline.map((e) => [e.kind, e.fromStage, e.toStage, e.note])).toEqual([
      ["STAGE", "CONTACT", "PROPOSAL", null],
      ["STAGE", "NEW", "CONTACT", "Respondeu o direct"],
      ["CREATED", null, null, null],
    ]);
    expect((await owner().find(id))?.stage).toBe("PROPOSAL");
    expect((await owner().list("PROPOSAL")).map((l) => l.id)).toContain(id);
    expect((await owner().list("NEW")).map((l) => l.id)).not.toContain(id);
  });
  it("counts the leads of each stage", async () => {
    const counts = await owner().counts();
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(await count("SELECT 1 FROM leads WHERE organization_id = 'org-a'"));
    expect(counts.PROPOSAL).toBeGreaterThan(0);
  });
  it("asks for a reason to lose a lead, keeps it, and forgets it when the lead is reopened", async () => {
    const id = await newLead();
    await expect(owner().moveTo(id, "NEW", { to: "LOST" }, at(40))).rejects.toThrow();
    expect(await owner().moveTo(id, "NEW", { to: "LOST", lostReason: "PRICE", note: "Achou caro" }, at(41))).toEqual({ status: "moved" });
    expect(await owner().find(id)).toMatchObject({ stage: "LOST", lostReason: "PRICE" });
    expect(await owner().moveTo(id, "LOST", { to: "CONTACT" }, at(42))).toEqual({ status: "moved" });
    expect(await owner().find(id)).toMatchObject({ stage: "CONTACT", lostReason: null });
    const events = await owner().timeline(id);
    expect(events.find((e) => e.toStage === "LOST")).toMatchObject({ lostReason: "PRICE", note: "Achou caro" });
  });
  it("changes nothing when someone moved the lead in the meantime, and says where it is", async () => {
    const id = await newLead();
    await owner().moveTo(id, "NEW", { to: "CONTACT" }, at(50));
    const stale = await leadsFor(db, scope("commercial-a")).moveTo(id, "NEW", { to: "PROPOSAL" }, at(51));
    expect(stale).toEqual({ status: "conflict", current: "CONTACT" });
    expect((await owner().find(id))?.stage).toBe("CONTACT");
    expect(await count("SELECT 1 FROM lead_events WHERE lead_id = ?", id)).toBe(2);
  });
  it("does nothing, and writes nothing, for the stage it already is in", async () => {
    const id = await newLead();
    expect(await owner().moveTo(id, "NEW", { to: "NEW" }, at(52))).toEqual({ status: "unchanged" });
    expect(await count("SELECT 1 FROM lead_events WHERE lead_id = ?", id)).toBe(1);
  });
  it("lets only those who work leads move one", async () => {
    const id = await newLead();
    for (const who of ["tech-a", "finance-a", "outsider", "blocked-a", "revoked-a"]) {
      expect((await leadsFor(db, scope(who)).moveTo(id, "NEW", { to: "WON" }, at(53))).status).toBe("not_found");
    }
    expect((await owner().find(id))?.stage).toBe("NEW");
    expect(await count("SELECT 1 FROM lead_events WHERE lead_id = ?", id)).toBe(1);
  });
  it("appends notes to the timeline, newest first, and brings the lead up the list", async () => {
    const id = await newLead();
    const other = await newLead();
    expect(await owner().addNote(id, { note: "Ligar amanhã\nde manhã" }, at(60))).toBe(true);
    const notes = (await owner().timeline(id)).filter((e) => e.kind === "NOTE");
    expect(notes[0].note).toBe("Ligar amanhã\nde manhã");
    const order = (await owner().list()).map((l) => l.id);
    expect(order.indexOf(id)).toBeLessThan(order.indexOf(other));
    await expect(owner().addNote(id, { note: "   " }, at(61))).rejects.toThrow();
  });
  it("edits the contact and the origin, leaves a line without the content, and refuses a lead of another organization", async () => {
    const id = await newLead({ name: "Daniel", email: "dani@example.test" });
    expect(await owner().update(id, { name: "Daniel Lima", phone: "11 97777-6666", source: "WHATSAPP" }, at(70))).toEqual({ status: "saved" });
    expect(await owner().find(id)).toMatchObject({ name: "Daniel Lima", email: null, phone: "11 97777-6666", source: "WHATSAPP" });
    expect(await one("SELECT email_key AS e, phone_key AS p FROM leads WHERE id = ?", id)).toEqual({ e: null, p: "11977776666" });
    const edited = (await owner().timeline(id)).find((e) => e.kind === "EDITED");
    expect(edited).toMatchObject({ note: null, fromStage: null, toStage: null });
    expect((await leadsFor(db, scope("owner-b", "org-b")).update(id, { name: "Invadido", email: "i@example.test", source: "OUTRO" })).status).toBe("not_found");
    expect((await owner().find(id))?.name).toBe("Daniel Lima");
  });
  it("lets a lead keep a service that was taken off offer, but not pick one that is off offer", async () => {
    const services = servicesFor(db, scope("owner-a"));
    const a = await services.create({ name: "Serviço que sai", delivery: "ONLINE" }, at(71));
    const b = await services.create({ name: "Serviço que já saiu", delivery: "ONLINE" }, at(71));
    if (a.status !== "saved" || b.status !== "saved") throw new Error("service not saved");
    const id = await newLead({ serviceId: a.id });
    await services.setActive(a.id, false, at(72));
    await services.setActive(b.id, false, at(72));
    expect(await owner().update(id, { name: "Mesmo serviço", email: "m@example.test", source: "OUTRO", serviceId: a.id }, at(73))).toEqual({ status: "saved" });
    expect((await owner().update(id, { name: "Outro serviço", email: "m@example.test", source: "OUTRO", serviceId: b.id }, at(74))).status).toBe("invalid_service");
    expect((await owner().find(id))?.serviceName).toBe("Serviço que sai");
  });
});

describe("what the database refuses on its own", () => {
  it("refuses a lost lead without a reason, a reason without a lost lead, and a lead nobody can reach", async () => {
    const insert = (cols: string, vals: string) =>
      db.prepare(`INSERT INTO leads(id, organization_id, name, source, created_by, ${cols}) VALUES ('d-${++n}', 'org-a', 'Direto', 'OUTRO', 'owner-a', ${vals})`).run();
    await expect(insert("email, email_key, stage", "'a@example.test','a@example.test','LOST'")).rejects.toThrow();
    await expect(insert("email, email_key, lost_reason", "'a@example.test','a@example.test','PRICE'")).rejects.toThrow();
    await expect(insert("stage", "'NEW'")).rejects.toThrow();
    await expect(insert("email, email_key", "'a@example.test', NULL")).rejects.toThrow();
    await expect(insert("phone, phone_key", "'11 9999-0000', '123'")).rejects.toThrow();
    await expect(insert("email, email_key, stage, lost_reason", "'a@example.test','a@example.test','LOST','BORED'")).rejects.toThrow();
  });
  it("keeps the timeline of a lead only added to", async () => {
    const id = await newLead();
    const event = (await one<{ id: string }>("SELECT id FROM lead_events WHERE lead_id = ?", id))!.id;
    await expect(db.prepare("UPDATE lead_events SET note = 'reescrito' WHERE id = ?").bind(event).run()).rejects.toThrow();
    await expect(db.prepare("DELETE FROM lead_events WHERE id = ?").bind(event).run()).rejects.toThrow();
    expect(await count("SELECT 1 FROM lead_events WHERE id = ?", event)).toBe(1);
  });
});

describe("deleting a lead", () => {
  it("is for the owner and a manager, takes the timeline along and leaves a line with no name", async () => {
    const id = await newLead({ name: "Nome Que Some", email: "some@example.test" });
    await owner().addNote(id, { note: "nota" }, at(80));
    expect(await leadsFor(db, scope("commercial-a")).remove(id, at(81))).toBe(false);
    expect(await owner().find(id)).not.toBeNull();
    expect(await leadsFor(db, scope("manager-a")).remove(id, at(82))).toBe(true);
    expect(await owner().find(id)).toBeNull();
    expect(await count("SELECT 1 FROM lead_events WHERE lead_id = ?", id)).toBe(0);
    const line = await one<{ action: string; actor: string; subject: string; org: string }>(
      "SELECT action, actor_user_id AS actor, subject_id AS subject, organization_id AS org FROM access_audit_events WHERE subject_id = ?",
      id,
    );
    expect(line).toEqual({ action: "LEAD_DELETED", actor: "manager-a", subject: id, org: "org-a" });
    const trail = JSON.stringify((await db.prepare("SELECT * FROM access_audit_events WHERE subject_id = ?").bind(id).all()).results);
    expect(trail).not.toContain("Nome Que Some");
    expect(trail).not.toContain("some@example.test");
  });
  it("says no for a lead that is not there, of another organization, or already deleted, and writes nothing", async () => {
    const before = await count("SELECT 1 FROM access_audit_events WHERE action = 'LEAD_DELETED'");
    expect(await owner().remove("nao-existe")).toBe(false);
    const id = await newLead();
    expect(await leadsFor(db, scope("owner-b", "org-b")).remove(id)).toBe(false);
    expect(await count("SELECT 1 FROM access_audit_events WHERE action = 'LEAD_DELETED'")).toBe(before);
  });
});

describe("turning a won lead into a student", () => {
  it("creates the student, links it to the owner who converted, freezes the lead and records it", async () => {
    const id = await wonLead({ name: "Elisa Campos" });
    const outcome = await owner().convert(id, { mode: "create" }, at(100));
    if (outcome.status !== "converted") throw new Error(JSON.stringify(outcome));
    const student = await one<{ name: string; org: string }>("SELECT display_name AS name, organization_id AS org FROM students WHERE id = ?", outcome.studentId);
    expect(student).toEqual({ name: "Elisa Campos", org: "org-a" });
    expect(await count("SELECT 1 FROM care_assignments WHERE student_id = ? AND professional_id = 'pro-a' AND revoked_at IS NULL", outcome.studentId)).toBe(1);
    expect(await count("SELECT 1 FROM audit_events WHERE subject_id = ? AND action = 'STUDENT_CREATED'", outcome.studentId)).toBe(1);
    expect((await owner().find(id))?.studentId).toBe(outcome.studentId);
    expect((await owner().timeline(id))[0]).toMatchObject({ kind: "CONVERTED" });
    // The lead keeps its origin and history after becoming a student.
    expect(await owner().find(id)).toMatchObject({ source: "INSTAGRAM", stage: "WON" });
  });
  it("is idempotent: a second attempt, even at the same time, creates no second student", async () => {
    const id = await wonLead({ name: "Fabio Dias" });
    const [first, second] = await Promise.all([owner().convert(id, { mode: "create" }, at(110)), leadsFor(db, scope("manager-a")).convert(id, { mode: "create" }, at(110))]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["already", "converted"]);
    expect(await count("SELECT 1 FROM students WHERE display_name = 'Fabio Dias'")).toBe(1);
    const again = await owner().convert(id, { mode: "create" }, at(111));
    expect(again.status).toBe("already");
    expect(await count("SELECT 1 FROM lead_events WHERE lead_id = ? AND kind = 'CONVERTED'", id)).toBe(1);
  });
  it("only converts a lead that was won", async () => {
    const id = await newLead({ name: "Gabi Prado" });
    expect((await owner().convert(id, { mode: "create" }, at(120))).status).toBe("not_won");
    expect(await count("SELECT 1 FROM students WHERE display_name = 'Gabi Prado'")).toBe(0);
    await owner().moveTo(id, "NEW", { to: "LOST", lostReason: "NOT_NOW" }, at(121));
    expect((await owner().convert(id, { mode: "create" }, at(122))).status).toBe("not_won");
  });
  it("is not done by a commercial member, who cannot create students, and leaves nothing behind", async () => {
    const id = await wonLead({ name: "Hugo Reis" });
    const outcome = await leadsFor(db, scope("commercial-a")).convert(id, { mode: "create" }, at(130));
    expect(outcome.status).toBe("forbidden");
    expect(await count("SELECT 1 FROM students WHERE display_name = 'Hugo Reis'")).toBe(0);
    expect((await owner().find(id))?.studentId).toBeNull();
    expect((await leadsFor(db, scope("tech-a")).convert(id, { mode: "create" }, at(131))).status).toBe("not_found");
    // A commercial member who also has a professional record is still commercial: the role decides, not the record.
    expect((await leadsFor(db, scope("commercial-pro")).convert(id, { mode: "create" }, at(132))).status).toBe("forbidden");
    expect(await count("SELECT 1 FROM students WHERE display_name = 'Hugo Reis'")).toBe(0);
  });
  it("links a student the person already looks after, when found by e-mail, phone or name", async () => {
    await db.batch([
      db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-mine','org-a','Irene Souza'),('st-other','org-a','Irene Souza'),('st-phone','org-a','Joao Telefone'),('st-mail','org-a','Outro Nome')"),
      db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-mine','pro-a'),('org-a','st-other','pro-t'),('org-a','st-phone','pro-a'),('org-a','st-mail','pro-a')"),
      db.prepare("INSERT INTO student_profiles(student_id,organization_id,email,phone,updated_by_user_id) VALUES ('st-phone','org-a',NULL,'(11) 95555-4444','owner-a'),('st-mail','org-a','IRENE@example.test',NULL,'owner-a')"),
    ]);
    const id = await wonLead({ name: "Irene Souza", email: "irene@example.test", phone: "11955554444" });
    const matches = await owner().studentMatches(id);
    const byId = Object.fromEntries(matches.map((m) => [m.id, m.reasons]));
    expect(byId).toEqual({ "st-mine": ["name"], "st-phone": ["phone"], "st-mail": ["email"] });
    // st-other is somebody else's student: no technical access, so it is not even suggested.
    expect(byId["st-other"]).toBeUndefined();
    expect(await owner().convert(id, { mode: "link", studentId: "st-other" }, at(140))).toEqual({ status: "forbidden" });
    expect((await owner().find(id))?.studentId).toBeNull();
    expect(await owner().convert(id, { mode: "link", studentId: "st-mail" }, at(141))).toEqual({ status: "converted", studentId: "st-mail" });
    expect(await count("SELECT 1 FROM students WHERE display_name = 'Irene Souza'")).toBe(2);
  });
  it("does not link two leads to one student, nor a student of another organization", async () => {
    const id = await wonLead({ name: "Julia Nunes" });
    expect(await owner().convert(id, { mode: "link", studentId: "st-mail" }, at(150))).toEqual({ status: "student_taken" });
    await db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-b','org-b','Aluno da B')").run();
    await db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-b','st-b','pro-b')").run();
    expect(await owner().convert(id, { mode: "link", studentId: "st-b" }, at(151))).toEqual({ status: "forbidden" });
    expect((await owner().find(id))?.studentId).toBeNull();
  });
  it("stops the database from linking a lead that was not won, or two leads to one student, under a direct statement", async () => {
    const id = await newLead();
    await expect(db.prepare("UPDATE leads SET student_id = 'st-mine' WHERE id = ?").bind(id).run()).rejects.toThrow();
    const a = await wonLead();
    const b = await wonLead();
    await db.prepare("UPDATE leads SET student_id = 'st-phone' WHERE id = ?").bind(a).run();
    await expect(db.prepare("UPDATE leads SET student_id = 'st-phone' WHERE id = ?").bind(b).run()).rejects.toThrow();
  });
  it("freezes a converted lead: no edit, no move, no deletion, not even by a direct statement; notes still go on", async () => {
    const id = await wonLead({ name: "Karen Melo" });
    const done = await owner().convert(id, { mode: "create" }, at(160));
    if (done.status !== "converted") throw new Error("not converted");
    expect((await owner().update(id, { name: "Karen Outra", email: "k@example.test", source: "OUTRO" }, at(161))).status).toBe("converted");
    expect((await owner().moveTo(id, "WON", { to: "LOST", lostReason: "OTHER" }, at(162))).status).toBe("converted");
    expect(await owner().remove(id, at(163))).toBe(false);
    await expect(db.prepare("UPDATE leads SET name = 'Karen Direta' WHERE id = ?").bind(id).run()).rejects.toThrow();
    await expect(db.prepare("DELETE FROM leads WHERE id = ?").bind(id).run()).rejects.toThrow();
    expect(await owner().addNote(id, { note: "Primeira avaliação marcada" }, at(164))).toBe(true);
    expect((await owner().find(id))?.name).toBe("Karen Melo");
    expect(await owner().studentMatches(id)).toEqual([]);
  });
});

describe("the services on offer", () => {
  it("are read by the owner, a manager and a commercial member, written by the owner and a manager only", async () => {
    const created = await servicesFor(db, scope("manager-a")).create({ name: "Acompanhamento presencial", description: "Duas vezes por semana", delivery: "IN_PERSON" }, at(200));
    if (created.status !== "saved") throw new Error("not saved");
    for (const who of ["owner-a", "manager-a", "commercial-a"]) {
      expect((await servicesFor(db, scope(who)).list()).some((s) => s.id === created.id)).toBe(true);
    }
    for (const who of ["tech-a", "finance-a", "outsider", "blocked-a", "revoked-a"]) {
      expect(await servicesFor(db, scope(who)).list()).toEqual([]);
    }
    expect(await servicesFor(db, scope("commercial-a")).create({ name: "Serviço do comercial", delivery: "ONLINE" }, at(201))).toEqual({ status: "forbidden" });
    expect(await servicesFor(db, scope("commercial-a")).update(created.id, { name: "Reescrito", delivery: "ONLINE" }, at(202))).toEqual({ status: "forbidden" });
    expect(await servicesFor(db, scope("commercial-a")).setActive(created.id, false, at(203))).toEqual({ status: "forbidden" });
    expect((await servicesFor(db, scope("owner-a")).list()).find((s) => s.id === created.id)).toMatchObject({ name: "Acompanhamento presencial", active: true });
  });
  it("do not repeat a name, ignoring case and spaces, and a service is not visible to another organization", async () => {
    const repo = servicesFor(db, scope("owner-a"));
    expect(await repo.create({ name: " acompanhamento   PRESENCIAL ", delivery: "ONLINE" }, at(210))).toEqual({ status: "duplicate_name" });
    const other = await servicesFor(db, scope("owner-b", "org-b")).create({ name: "Acompanhamento presencial", delivery: "IN_PERSON" }, at(211));
    expect(other.status).toBe("saved");
    const mine = (await repo.list()).find((s) => s.name === "Acompanhamento presencial")!;
    expect(await servicesFor(db, scope("owner-b", "org-b")).update(mine.id, { name: "Invadido", delivery: "ONLINE" }, at(212))).toEqual({ status: "not_found" });
    expect(await servicesFor(db, scope("owner-b", "org-b")).setActive(mine.id, false, at(213))).toEqual({ status: "not_found" });
    expect((await repo.list()).find((s) => s.id === mine.id)?.active).toBe(true);
  });
  it("change, leave the offer and come back, and say how many leads chose each", async () => {
    const repo = servicesFor(db, scope("owner-a"));
    const created = await repo.create({ name: "Avaliação física", delivery: "HYBRID" }, at(220));
    if (created.status !== "saved") throw new Error("not saved");
    await newLead({ serviceId: created.id });
    await newLead({ serviceId: created.id });
    expect(await repo.update(created.id, { name: "Avaliação física completa", description: "Com relatório", delivery: "IN_PERSON" }, at(221))).toEqual({ status: "saved", id: created.id });
    expect(await repo.setActive(created.id, false, at(222))).toEqual({ status: "saved", id: created.id });
    const row = (await repo.list()).find((s) => s.id === created.id)!;
    expect(row).toMatchObject({ name: "Avaliação física completa", description: "Com relatório", delivery: "IN_PERSON", active: false, leads: 2 });
    expect((await repo.list(false)).some((s) => s.id === created.id)).toBe(false);
    expect(await repo.setActive(created.id, true, at(223))).toEqual({ status: "saved", id: created.id });
    expect(await repo.update("nao-existe", { name: "X Y", delivery: "ONLINE" }, at(224))).toEqual({ status: "not_found" });
  });
});
