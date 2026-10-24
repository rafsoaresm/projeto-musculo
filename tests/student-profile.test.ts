import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profilesFor } from "@/db/student-profile";
import { ageOn, emptyProfile, parseProfile } from "@/modules/ficha/contracts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1. Identities are rows, as the server derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const today = new Date("2026-11-10T12:00:00Z");
const full = {
  birthDate: "1990-05-20", gender: "Feminino", email: "Maria@Exemplo.test", phone: "+55 (11) 91234-5678",
  heightCm: 168, weightKg: 64.34, bodyMeasuredOn: "2026-11-01", goal: "Hipertrofia", level: "Intermediário",
  daysPerWeek: 4, sessionMinutes: 60, location: "Academia do bairro", equipment: "Halteres e polia",
  experience: "3 anos de musculação", injuries: "Entorse de tornozelo em 2024", surgeries: "Nenhuma informada",
  pains: "Dor lombar ocasional", limitations: "Evitar impacto", medicationsConditions: "Nenhuma informada",
  relevantNotes: "Trabalha sentada", preferredExercises: "Agachamento", dislikedExercises: "Burpee",
  excludedExercises: "Salto em profundidade", professionalNotes: "Retomar com cautela",
};

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "profile-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "tech-a", "tech-a2", "commercial-a", "owner-b", "tech-b", "client-1", "mgr-1"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
    ),
    db.prepare("INSERT INTO users(id) VALUES ('owner-a'),('tech-a'),('tech-a2'),('commercial-a'),('owner-b'),('tech-b'),('client-1'),('mgr-1')"),
    db.prepare("INSERT INTO platform_admins(user_id) VALUES ('mgr-1')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES
       ('org-a','owner-a','OWNER'),('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-b','owner-b','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner-a','org-a','owner-a','Owner A'),('pro-a','org-a','tech-a','Pro A'),
       ('pro-a2','org-a','tech-a2','Pro A2'),('pro-owner-b','org-b','owner-b','Owner B'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Student One'),('st-2','org-a','Student Two'),('st-b','org-b','Student B')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a2'),('org-b','st-b','pro-b')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

const count = async () =>
  (await db.prepare("SELECT COUNT(*) AS n FROM student_profiles").first<{ n: number }>())!.n;

describe("saving and reading the file", () => {
  it("stores what the professional typed, normalized, and reads it back", async () => {
    const api = profilesFor(db, scope("tech-a"));
    expect(await api.get("st-1")).toBeNull();
    expect(await api.save("st-1", full, today)).toBe(true);
    const saved = await api.get("st-1");
    expect(saved).toMatchObject({
      studentId: "st-1", birthDate: "1990-05-20", gender: "Feminino", email: "maria@exemplo.test",
      heightCm: 168, weightKg: 64.3, goal: "Hipertrofia", level: "Intermediário", daysPerWeek: 4,
      sessionMinutes: 60, injuries: "Entorse de tornozelo em 2024", excludedExercises: "Salto em profundidade",
      updatedAt: today.toISOString(),
    });
    // Saving again replaces the file; an empty field is cleared, not kept.
    expect(await api.save("st-1", { goal: "Força" }, new Date("2026-11-11T12:00:00Z"))).toBe(true);
    expect(await api.get("st-1")).toMatchObject({ ...emptyProfile, studentId: "st-1", goal: "Força", updatedAt: "2026-11-11T12:00:00.000Z" });
    expect(await count()).toBe(1);
  });

  it("records who and when in the audit trail, never what", async () => {
    const api = profilesFor(db, scope("tech-a"));
    await api.save("st-1", { ...full, pains: "Segredo de saúde 123" }, today);
    const events = await db
      .prepare("SELECT organization_id AS org, actor_user_id AS actor, action, subject_id AS subject FROM access_audit_events WHERE action = 'STUDENT_PROFILE_SAVED'")
      .all<{ org: string; actor: string; action: string; subject: string }>();
    expect(events.results.length).toBeGreaterThanOrEqual(2);
    expect(events.results.every((e) => e.org === "org-a" && e.actor === "tech-a" && e.subject === "st-1")).toBe(true);
    expect(JSON.stringify(events.results)).not.toContain("Segredo");
  });
});

describe("who can reach the file", () => {
  it("is refused, reading and writing, to anyone without an active technical assignment", async () => {
    await profilesFor(db, scope("tech-a")).save("st-1", full, today);
    const before = await count();
    const events = async () =>
      (await db.prepare("SELECT COUNT(*) AS n FROM access_audit_events WHERE action = 'STUDENT_PROFILE_SAVED'").first<{ n: number }>())!.n;
    const eventsBefore = await events();
    for (const [user, org] of [
      ["tech-a2", "org-a"], // professional of another student
      ["owner-a", "org-a"], // owner without assignment
      ["commercial-a", "org-a"],
      ["client-1", "org-a"], // the student's own login
      ["mgr-1", "org-a"], // platform manager
      ["tech-b", "org-b"],
      ["tech-b", "org-a"],
      ["stranger", "org-a"],
    ]) {
      const api = profilesFor(db, scope(user, org));
      expect(await api.get("st-1"), `${user}/${org} get`).toBeNull();
      expect(await api.save("st-1", { goal: "Saúde e aptidão geral" }), `${user}/${org} save`).toBe(false);
      // tech-b really is the professional of st-b: everyone else is refused that student too.
      if (!(user === "tech-b" && org === "org-b"))
        expect(await api.save("st-b", { goal: "Saúde e aptidão geral" }), `${user}/${org} save other org`).toBe(false);
    }
    expect(await count()).toBe(before);
    expect(await events()).toBe(eventsBefore);
    expect((await profilesFor(db, scope("tech-a")).get("st-1"))?.goal).toBe("Hipertrofia");
  });

  it("keeps each student's file apart and ends with the assignment or the identity", async () => {
    const a = profilesFor(db, scope("tech-a"));
    const a2 = profilesFor(db, scope("tech-a2"));
    await a2.save("st-2", { goal: "Força", injuries: "Do outro aluno" }, today);
    expect((await a.get("st-2"))).toBeNull();
    expect((await a2.get("st-1"))).toBeNull();
    expect((await a2.get("st-2"))?.injuries).toBe("Do outro aluno");

    await db.prepare("UPDATE care_assignments SET revoked_at = '2026-11-12T00:00:00.000Z' WHERE student_id = 'st-1'").run();
    expect(await a.get("st-1")).toBeNull();
    expect(await a.save("st-1", { goal: "Saúde e aptidão geral" })).toBe(false);
    await db.prepare("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'").run();
    await db.prepare("UPDATE users SET disabled_at = '2026-11-12T00:00:00.000Z' WHERE id = 'tech-a'").run();
    expect(await a.get("st-1")).toBeNull();
    expect(await a.save("st-1", { goal: "Saúde e aptidão geral" })).toBe(false);
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'").run();
    expect(await a.get("st-1")).not.toBeNull();
  });
});

describe("what is accepted", () => {
  it("rejects values outside the allowed lists and the plausible ranges, and stores nothing", async () => {
    const api = profilesFor(db, scope("tech-a"));
    const before = await db.prepare("SELECT updated_at AS at FROM student_profiles WHERE student_id = 'st-1'").first<{ at: string }>();
    const bad: unknown[] = [
      { gender: "Outro gênero qualquer" }, { goal: "Perder tudo" }, { level: "Mestre" },
      { daysPerWeek: 0 }, { daysPerWeek: 8 }, { daysPerWeek: 2.5 }, { sessionMinutes: 5 }, { sessionMinutes: 301 },
      { heightCm: 49 }, { heightCm: 261 }, { weightKg: 9 }, { weightKg: 501 },
      { email: "sem-arroba" }, { phone: "abc" }, { phone: "123" },
      { birthDate: "2026-02-30" }, { birthDate: "2027-01-01" }, { birthDate: "1899-12-31" }, { birthDate: "20/05/1990" },
      { bodyMeasuredOn: "2030-01-01" },
      { injuries: "x".repeat(1001) }, { equipment: "x".repeat(501) }, { location: "x".repeat(121) },
      { organizationId: "org-b" }, { updatedByUserId: "tech-a2" },
    ];
    for (const raw of bad) {
      await expect(api.save("st-1", raw, today), JSON.stringify(raw).slice(0, 50)).rejects.toThrow();
    }
    expect(await db.prepare("SELECT updated_at AS at FROM student_profiles WHERE student_id = 'st-1'").first()).toEqual(before);
  });

  it("accepts every option the document lists and a full 1-7 week", async () => {
    for (const goal of ["Hipertrofia", "Força", "Condicionamento / emagrecimento", "Saúde e aptidão geral", "Performance esportiva", "Retorno ao treinamento"])
      expect(parseProfile({ goal }, today).goal).toBe(goal);
    for (const gender of ["Feminino", "Masculino", "Outro", "Prefere não informar"]) expect(parseProfile({ gender }, today).gender).toBe(gender);
    for (const level of ["Iniciante", "Intermediário", "Avançado"]) expect(parseProfile({ level }, today).level).toBe(level);
    for (const daysPerWeek of [1, 2, 3, 4, 5, 6, 7]) expect(parseProfile({ daysPerWeek }, today).daysPerWeek).toBe(daysPerWeek);
    expect(parseProfile({ email: "", phone: "", location: "  " }, today)).toMatchObject({ email: null, phone: null, location: null });
    expect(parseProfile({ bodyMeasuredOn: "2026-11-10" }, today).bodyMeasuredOn).toBe("2026-11-10");
  });

  it("computes age from the birth date, not from a stored age", () => {
    expect(ageOn("1990-05-20", "2026-05-19")).toBe(35);
    expect(ageOn("1990-05-20", "2026-05-20")).toBe(36);
    expect(ageOn("2010-11-11", "2026-11-10")).toBe(15);
    expect(ageOn("2008-11-10", "2026-11-10")).toBe(18);
  });
});
