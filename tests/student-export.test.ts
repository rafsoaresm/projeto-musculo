import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPORT_GENERATED, studentExportFor } from "@/db/student-export";
import { studentSessionsFor } from "@/db/workout-sessions";
import { studentCheckinsFor } from "@/db/student-checkins";
import { studentRequestsFor } from "@/db/data-requests";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import {
  EXPORTS_PER_HOUR,
  EXPORT_CHECKIN_LIMIT,
  EXPORT_FORMAT,
  exportFileName,
  serializeExport,
  type StudentDataExport,
} from "@/modules/pedidos/export";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 with every migration, triggers included. Identities are rows, as the server derives
// them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const FB = "Full Body";
const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 10, 0, 0) + minute * 60_000);
const NOW = new Date(Date.UTC(2026, 10, 12, 15, 0, 0)); // 12:00 in São Paulo
const TODAY = "2026-11-12";
const hoursAfter = (hours: number, from = NOW) => new Date(from.getTime() + hours * 3_600_000);
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const SHA = "a".repeat(64);
const SECRET = "ANOTACAO-DO-PROFISSIONAL";

/** The copy of a login, which must be generated. */
async function copyOf(login: string, now = NOW): Promise<StudentDataExport> {
  const outcome = await studentExportFor(db, login).generate(now);
  if (outcome.status !== "generated") throw new Error(`expected a copy, got ${outcome.status}`);
  return outcome.document;
}
const everything = (document: StudentDataExport) => serializeExport(document);

/** Approves and delivers a revision, and stops the test if the workflow refused a step. */
async function approveAndDeliver(plans: ReturnType<typeof plansFor>, planId: string, revisionId: string, minute: number) {
  const approved = await plans.approve(planId, revisionId, { screeningNotRecorded: true }, at(minute));
  const delivered = await plans.deliver(planId, revisionId, at(minute + 1));
  if (approved.status !== "approved" || delivered.status !== "delivered")
    throw new Error(`the workflow stopped: ${JSON.stringify([approved, delivered])}`);
}

async function deliveredPlan(student: string, owner = "tech-a", title = "Plano de força", organization = "org-a") {
  const plans = plansFor(db, scope(owner, organization));
  const rx = prescriptionFor(db, scope(owner, organization));
  const created = (await plans.create(student, {
    title,
    input: { startDate: "2026-11-02", phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: FB, exercisesPerSession: 3 })) },
  }))!;
  for (let i = 0; i < 3; i++)
    await rx.add(created.planId, created.revisionId, { phaseIndex: 1, workoutLabel: FB }, { customName: `Exercício ${i + 1}` }, { sets: "3", reps: "10", notes: `Nota ${i + 1}` });
  await rx.copyPhase(created.planId, created.revisionId, 1, 2);
  await rx.copyPhase(created.planId, created.revisionId, 1, 3);
  await plans.markReady(created.planId, created.revisionId);
  await approveAndDeliver(plans, created.planId, created.revisionId, 1);
  const items = await rx.list(created.planId, created.revisionId);
  return { ...created, phase1: items.filter((item) => item.phaseIndex === 1).map((item) => item.id) };
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "student-export-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "tech-a", "owner-b", "tech-b", "client-1", "client-2", "client-b", "client-big", "client-off", "client-none"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?2,?3,0,0)").bind(id, `Nome ${id}`, `${id}@example.test`),
    ),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES
       ('org-a','owner-a','OWNER'),('org-a','tech-a','TECHNICAL'),('org-b','owner-b','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES
       ('pro-owner-a','org-a','owner-a','Owner A'),('pro-a','org-a','tech-a','Pro A'),
       ('pro-owner-b','org-b','owner-b','Owner B'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare(
      `INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Aluno Um'),('st-2','org-a','Aluno Dois'),
       ('st-b','org-b','Aluno B'),('st-b1','org-b','Aluno Um na B'),('st-big','org-a','Aluno Grande'),('st-off','org-a','Aluno Fora')`,
    ),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),
       ('org-a','st-2','pro-a'),('org-b','st-b','pro-b'),('org-b','st-b1','pro-b'),('org-a','st-big','pro-a'),('org-a','st-off','pro-a')`,
    ),
    db.prepare(
      `INSERT INTO student_access(organization_id,student_id,user_id) VALUES
       ('org-a','st-1','client-1'),('org-b','st-b1','client-1'),('org-a','st-2','client-2'),('org-b','st-b','client-b'),
       ('org-a','st-big','client-big'),('org-a','st-off','client-off')`,
    ),
    // The professional's own record of the first student, which is never part of the copy.
    db.prepare(
      `INSERT INTO student_profiles(student_id, organization_id, injuries, professional_notes, updated_by_user_id)
       VALUES ('st-1','org-a',?1,?1,'tech-a')`,
    ).bind(`${SECRET}-ficha`),
    db.prepare(
      `INSERT INTO consent_acceptances(id,user_id,audience,terms_version,terms_sha256,photos_authorized,accepted_at)
       VALUES ('c1','client-1','STUDENT','v1',?1,0,'2026-11-01T10:00:00.000Z'),
              ('c2','client-1','STUDENT','v1',?1,1,'2026-11-05T10:00:00.000Z'),
              ('c3','client-2','STUDENT','v1',?1,1,'2026-11-02T10:00:00.000Z'),
              ('c4','owner-a','PROFESSIONAL','v1',?1,0,'2026-11-02T10:00:00.000Z')`,
    ).bind(SHA),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("the file name and the shape", () => {
  it("names the file with the day in Brazil, not the day in UTC", () => {
    expect(exportFileName(new Date("2026-10-27T01:30:00Z"))).toBe("meus-dados-2026-10-26.json");
    expect(exportFileName(new Date("2026-10-27T03:00:00Z"))).toBe("meus-dados-2026-10-27.json");
  });
});

describe("what a student's copy holds", () => {
  it("carries what the student sees: account, acceptances, check-ins, logged workouts, delivered plan and requests", async () => {
    const plan = await deliveredPlan("st-1");
    const sessions = studentSessionsFor(db, "client-1");
    const logged = await sessions.save(
      "st-1",
      {
        planId: plan.planId,
        phaseIndex: 1,
        workoutLabel: FB,
        performedOn: TODAY,
        effort: 7,
        notes: "boa sessão",
        exercises: [
          { prescribedExerciseId: plan.phase1[0], done: true, rir: 2, sets: [{ reps: 10, loadKg: 20 }, { reps: 9, loadKg: 22.5 }] },
          { prescribedExerciseId: plan.phase1[1], done: false, notes: "sem tempo" },
        ],
      },
      NOW,
    );
    if (logged.status !== "saved") throw new Error(`expected saved: ${JSON.stringify(logged)}`);
    expect(await studentCheckinsFor(db, "client-1").save("st-1", { effort: 6, recovery: 3, discomfort: true, discomfortNotes: "ombro", notes: "cansada" }, NOW)).toMatchObject({ status: "saved" });
    expect(await studentRequestsFor(db, "client-1").open("st-1", { kind: "CORRECTION", message: "meu nome está errado" }, NOW)).toMatchObject({ status: "opened" });

    const document = await copyOf("client-1");
    expect(document.formato).toBe(EXPORT_FORMAT);
    expect(document.geradoEm).toBe(NOW.toISOString());
    expect(document.conta).toEqual({ nome: "Nome client-1", email: "client-1@example.test" });
    expect(document.aceites).toEqual([
      { versaoDosTermos: "v1", sha256DoTexto: SHA, fotosAutorizadas: false, aceitoEm: "2026-11-01T10:00:00.000Z" },
      { versaoDosTermos: "v1", sha256DoTexto: SHA, fotosAutorizadas: true, aceitoEm: "2026-11-05T10:00:00.000Z" },
    ]);

    // Two links, in the order the portal lists them; each says whose it is.
    expect(document.vinculos.map((link) => [link.organizacao, link.aluno])).toEqual([
      ["Studio A", "Aluno Um"],
      ["Studio B", "Aluno Um na B"],
    ]);
    const first = document.vinculos[0];
    expect(first.profissional).toBe("Pro A");
    expect(first.checkIns).toEqual({
      cortado: false,
      registros: [
        {
          dia: TODAY,
          esforco: 6,
          recuperacao: 3,
          desconforto: true,
          anotacoesDoDesconforto: "ombro",
          observacoes: "cansada",
          registradoEm: NOW.toISOString(),
          lidoPeloProfissional: false,
        },
      ],
    });
    expect(first.treinosRegistrados.cortado).toBe(false);
    expect(first.treinosRegistrados.registros).toEqual([
      {
        dia: TODAY,
        plano: "Plano de força",
        fase: 1,
        treino: FB,
        esforco: 7,
        dorRegistrada: false,
        observacoes: "boa sessão",
        registradoEm: NOW.toISOString(),
        lidoPeloProfissional: false,
        exercicios: [
          {
            nome: "Exercício 1",
            feito: true,
            repeticoesEmReserva: 2,
            dor: false,
            observacoes: null,
            series: [
              { numero: 1, repeticoes: 10, cargaKg: 20 },
              { numero: 2, repeticoes: 9, cargaKg: 22.5 },
            ],
          },
          { nome: "Exercício 2", feito: false, repeticoesEmReserva: null, dor: false, observacoes: "sem tempo", series: [] },
        ],
      },
    ]);
    expect(first.treinoEntregue).toHaveLength(1);
    expect(first.treinoEntregue[0]).toMatchObject({ plano: "Plano de força", revisao: 1, entreguePor: "Pro A" });
    expect(first.treinoEntregue[0].fases).toHaveLength(3);
    expect(first.treinoEntregue[0].fases[0].treinos[0].exercicios.map((item) => [item.nome, item.series, item.repeticoes, item.observacoes])).toEqual([
      ["Exercício 1", "3", "10", "Nota 1"],
      ["Exercício 2", "3", "10", "Nota 2"],
      ["Exercício 3", "3", "10", "Nota 3"],
    ]);
    expect(first.pedidosSobreMeusDados.registros).toEqual([
      expect.objectContaining({ tipo: "Corrigir um dado meu", mensagem: "meu nome está errado", situacao: "Em andamento", respostaDoProfissional: null, respondidoEm: null }),
    ]);

    // The other link has nothing of its own yet, and says so with empty lists, not with the first one's.
    expect(document.vinculos[1].checkIns.registros).toEqual([]);
    expect(document.vinculos[1].treinosRegistrados.registros).toEqual([]);
    expect(document.vinculos[1].treinoEntregue).toEqual([]);
    expect(document.vinculos[1].pedidosSobreMeusDados.registros).toEqual([]);
  });

  it("says what a request ended in, as the student reads it", async () => {
    const requests = studentRequestsFor(db, "client-2");
    const opened = await requests.open("st-2", { kind: "ACCESS", message: null }, NOW);
    if (opened.status !== "opened") throw new Error("expected opened");
    await run(
      `INSERT INTO data_subject_request_outcomes (request_id, organization_id, outcome, note, decided_by_user_id, created_at)
       VALUES (?1, 'org-a', 'PARTIALLY_FULFILLED', 'Enviei por e-mail.', 'tech-a', ?2)`,
      opened.id,
      hoursAfter(2).toISOString(),
    );
    const second = await requests.open("st-2", { kind: "OTHER", message: "pergunta" }, hoursAfter(1));
    if (second.status !== "opened") throw new Error("expected opened");
    await requests.cancel(second.id, hoursAfter(2));
    const registros = (await copyOf("client-2", hoursAfter(3))).vinculos[0].pedidosSobreMeusDados.registros;
    expect(registros.map((item) => [item.tipo, item.situacao, item.respostaDoProfissional])).toEqual([
      ["Outro pedido sobre os meus dados", "Cancelado por você", null],
      ["Receber uma cópia dos meus dados", "Atendido em parte", "Enviei por e-mail."],
    ]);
  });

  it("does not carry the professional's record, notes, photos, identifiers or other people", async () => {
    // The professional reads the student's entries and writes notes: those are theirs, not the student's copy.
    const session = (await db.prepare("SELECT id FROM workout_sessions WHERE student_id = 'st-1'").first<{ id: string }>())!;
    const checkin = (await db.prepare("SELECT id FROM student_checkins WHERE student_id = 'st-1'").first<{ id: string }>())!;
    await run("INSERT INTO session_acknowledgements(id, organization_id, session_id, user_id, note, created_at) VALUES ('ack-s','org-a',?1,'tech-a',?2,?3)", session.id, `${SECRET}-sessao`, NOW.toISOString());
    await run("INSERT INTO checkin_acknowledgements(id, organization_id, checkin_id, user_id, note, created_at) VALUES ('ack-c','org-a',?1,'tech-a',?2,?3)", checkin.id, `${SECRET}-checkin`, NOW.toISOString());

    const document = await copyOf("client-1", hoursAfter(8));
    const text = everything(document);
    // That they were read is said; what was written about them is not.
    expect(document.vinculos[0].checkIns.registros[0].lidoPeloProfissional).toBe(true);
    expect(document.vinculos[0].treinosRegistrados.registros[0].lidoPeloProfissional).toBe(true);
    expect(text).not.toContain(SECRET);
    // No internal identifier: nothing in the file points at a row.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    // Nothing of other students or of the professional's logins.
    for (const stranger of ["Aluno Dois", "Aluno B", "Aluno Grande", "client-2", "client-b", "owner-a", "tech-a"]) expect(text).not.toContain(stranger);
    expect(Object.keys(document).sort()).toEqual(["aceites", "conta", "formato", "geradoEm", "sobreEsteArquivo", "vinculos"]);
    expect(document.sobreEsteArquivo.naoIncluido.join(" ")).toMatch(/ficha e as avaliações/);
  });

  it("holds only the newest delivered revision of a plan, never a draft, as the student sees it", async () => {
    const plans = plansFor(db, scope("tech-a"));
    const rx = prescriptionFor(db, scope("tech-a"));
    const plan = await deliveredPlan("st-2", "tech-a", "Plano do aluno dois");
    const second = (await plans.newRevisionFrom(plan.planId, plan.revisionId, at(10))) as { revisionId: string };
    await rx.add(plan.planId, second.revisionId, { phaseIndex: 1, workoutLabel: FB }, { customName: "Exercício da revisão 2" }, { sets: "4", reps: "8" });
    await plans.markReady(plan.planId, second.revisionId);
    await approveAndDeliver(plans, plan.planId, second.revisionId, 11);
    const draft = (await plans.newRevisionFrom(plan.planId, second.revisionId, at(13))) as { revisionId: string };
    await rx.add(plan.planId, draft.revisionId, { phaseIndex: 1, workoutLabel: FB }, { customName: "RASCUNHO-NAO-ENTREGUE" }, { sets: "1", reps: "1" });

    const document = await copyOf("client-2", hoursAfter(4));
    const delivered = document.vinculos[0].treinoEntregue;
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ plano: "Plano do aluno dois", revisao: 2 });
    const names = delivered[0].fases[0].treinos[0].exercicios.map((item) => item.nome);
    expect(names).toContain("Exercício da revisão 2");
    expect(everything(document)).not.toContain("RASCUNHO-NAO-ENTREGUE");
  });
});

describe("whose copy it is", () => {
  it("never reaches a student the login is not linked to, whatever the other data holds", async () => {
    await studentCheckinsFor(db, "client-b").save("st-b", { effort: 9, notes: "EU-SOU-DA-OUTRA-ORGANIZACAO" }, hoursAfter(5));
    await studentCheckinsFor(db, "client-2").save("st-2", { effort: 2, notes: "EU-SOU-DO-ALUNO-DOIS" }, hoursAfter(5));
    const foreign = await deliveredPlan("st-b", "tech-b", "PLANO-DA-OUTRA-ORGANIZACAO", "org-b");
    await studentSessionsFor(db, "client-b").save(
      "st-b",
      { planId: foreign.planId, phaseIndex: 1, workoutLabel: FB, performedOn: TODAY, exercises: [{ prescribedExerciseId: foreign.phase1[0], done: true, sets: [{ reps: 5, loadKg: 99 }] }], notes: "SESSAO-DA-OUTRA-ORGANIZACAO" },
      hoursAfter(5),
    );
    await studentRequestsFor(db, "client-b").open("st-b", { kind: "OTHER", message: "PEDIDO-DA-OUTRA-ORGANIZACAO" }, hoursAfter(5));
    const text = everything(await copyOf("client-1", hoursAfter(9)));
    for (const marker of ["EU-SOU-DA-OUTRA-ORGANIZACAO", "EU-SOU-DO-ALUNO-DOIS", "PLANO-DA-OUTRA-ORGANIZACAO", "SESSAO-DA-OUTRA-ORGANIZACAO", "PEDIDO-DA-OUTRA-ORGANIZACAO"])
      expect(text).not.toContain(marker);
    const other = everything(await copyOf("client-b", hoursAfter(9)));
    for (const marker of ["EU-SOU-DA-OUTRA-ORGANIZACAO", "PLANO-DA-OUTRA-ORGANIZACAO", "SESSAO-DA-OUTRA-ORGANIZACAO", "PEDIDO-DA-OUTRA-ORGANIZACAO"])
      expect(other).toContain(marker);
    expect(other).not.toContain("cansada");
  });

  it("drops a link that was revoked and refuses a blocked login or one with no link", async () => {
    await run("UPDATE student_access SET revoked_at = ?1 WHERE student_id = 'st-b1' AND user_id = 'client-1'", NOW.toISOString());
    const document = await copyOf("client-1", hoursAfter(10));
    expect(document.vinculos.map((link) => link.aluno)).toEqual(["Aluno Um"]);

    await run("UPDATE users SET disabled_at = ?1 WHERE id = 'client-off'", NOW.toISOString());
    expect(await studentExportFor(db, "client-off").generate(hoursAfter(10))).toEqual({ status: "not_found" });
    expect(await studentExportFor(db, "client-none").generate(hoursAfter(10))).toEqual({ status: "not_found" });
    // A refusal leaves no trail of a copy that was never made.
    expect(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE actor_user_id IN ('client-off','client-none') AND action = ?1", EXPORT_GENERATED)).toBe(0);
    expect(() => studentExportFor(db, " ")).toThrow("AUTHENTICATION_REQUIRED");
  });
});

describe("the trail and the limit", () => {
  it("records who and when for each link, never the content", async () => {
    await run("DELETE FROM access_audit_events WHERE actor_user_id = 'client-b'");
    const before = await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE actor_user_id = 'client-b' AND action = ?1", EXPORT_GENERATED);
    await copyOf("client-b", hoursAfter(20));
    const rows = (await db
      .prepare("SELECT organization_id AS org, subject_id AS subject, created_at AS at FROM access_audit_events WHERE actor_user_id = 'client-b' AND action = ?1")
      .bind(EXPORT_GENERATED)
      .all<{ org: string; subject: string; at: string }>()).results;
    expect(before).toBe(0);
    expect(rows).toEqual([{ org: "org-b", subject: "st-b", at: hoursAfter(20).toISOString() }]);
  });

  it("writes one row per link, and a generation with two links counts once", async () => {
    await run("UPDATE student_access SET revoked_at = NULL WHERE student_id = 'st-b1' AND user_id = 'client-1'");
    await run("DELETE FROM access_audit_events WHERE actor_user_id = 'client-1' AND action = ?1", EXPORT_GENERATED);
    const start = hoursAfter(100);
    for (let n = 0; n < EXPORTS_PER_HOUR; n++) await copyOf("client-1", new Date(start.getTime() + n * 60_000));
    expect(await count("SELECT COUNT(*) AS n FROM access_audit_events WHERE actor_user_id = 'client-1' AND action = ?1", EXPORT_GENERATED)).toBe(2 * EXPORTS_PER_HOUR);
    expect(await count("SELECT COUNT(DISTINCT created_at) AS n FROM access_audit_events WHERE actor_user_id = 'client-1' AND action = ?1", EXPORT_GENERATED)).toBe(EXPORTS_PER_HOUR);
  });

  it("refuses the next one within the hour, writing and reading nothing, and lets the hour pass", async () => {
    const start = hoursAfter(100);
    const rows = () => count("SELECT COUNT(*) AS n FROM access_audit_events WHERE actor_user_id = 'client-1' AND action = ?1", EXPORT_GENERATED);
    const before = await rows();
    const tooSoon = new Date(start.getTime() + 30 * 60_000);
    expect(await studentExportFor(db, "client-1").generate(tooSoon)).toEqual({ status: "rate_limited" });
    expect(await rows()).toBe(before);

    // The first of them leaves the window an hour after it was made.
    const later = new Date(start.getTime() + 61 * 60_000);
    expect((await studentExportFor(db, "client-1").generate(later)).status).toBe("generated");
    expect(await rows()).toBe(before + 2);
  });

  it("counts each login on its own", async () => {
    const start = hoursAfter(200);
    for (let n = 0; n < EXPORTS_PER_HOUR; n++) await copyOf("client-2", new Date(start.getTime() + n * 1000));
    expect(await studentExportFor(db, "client-2").generate(new Date(start.getTime() + 10_000))).toEqual({ status: "rate_limited" });
    expect((await studentExportFor(db, "client-b").generate(new Date(start.getTime() + 10_000))).status).toBe("generated");
  });
});

describe("a very long history", () => {
  it("is cut at the limit and says so, newest first, instead of pretending to be whole", async () => {
    // One check-in more than the limit, one per day, written straight into the table.
    await run(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
       INSERT INTO student_checkins(id, organization_id, student_id, checked_on, effort, logged_by_user_id, created_at, updated_at)
       SELECT 'big-' || i, 'org-a', 'st-big', date('2000-01-01', '+' || i || ' days'), 5, 'client-big',
         '2026-11-12T15:00:00.000Z', '2026-11-12T15:00:00.000Z' FROM n`,
      EXPORT_CHECKIN_LIMIT,
    );
    expect(await count("SELECT COUNT(*) AS n FROM student_checkins WHERE student_id = 'st-big'")).toBe(EXPORT_CHECKIN_LIMIT + 1);
    const { checkIns } = (await copyOf("client-big", hoursAfter(300))).vinculos[0];
    expect(checkIns.cortado).toBe(true);
    expect(checkIns.registros).toHaveLength(EXPORT_CHECKIN_LIMIT);
    // The newest are kept; the oldest is the one left out.
    expect(checkIns.registros[0].dia > checkIns.registros.at(-1)!.dia).toBe(true);
    expect(checkIns.registros.some((item) => item.dia === "2000-01-01")).toBe(false);

    // One entry fewer and nothing is cut.
    await run("DELETE FROM student_checkins WHERE id = 'big-0'");
    const whole = (await copyOf("client-big", hoursAfter(310))).vinculos[0].checkIns;
    expect(whole.cortado).toBe(false);
    expect(whole.registros).toHaveLength(EXPORT_CHECKIN_LIMIT);
  });
});
