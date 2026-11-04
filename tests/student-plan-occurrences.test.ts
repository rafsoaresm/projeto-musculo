import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { assembleDelivered, studentTrainingFor, type DeliveredRevisionRow, type StudentTrainingPlan } from "@/db/student-plan";
import { planDocumentsFor } from "@/db/plan-documents";
import { executionFor, studentSessionsFor, distinctOccurrences } from "@/db/workout-sessions";
import { studentExportFor } from "@/db/student-export";
import { readableExport } from "@/modules/pedidos/export-readable";
import { OCCURRENCE_WORKOUTS_NOTE } from "@/modules/pedidos/export";
import { proposalService, type ProposalOutcome, type ApplyServiceOutcome } from "@/modules/prescricao/automatica/service";
import type { GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import { planFingerprint, renderPlanPdf } from "@/modules/pdf/plan-pdf";
import { StudentTraining } from "@/modules/portal/student-training";
import { findSession, progressionOf, selectedWeek } from "@/modules/portal/weeks";
import { describeDose, storedDoseText } from "@/modules/prescricao/describe";
import { basisWithoutValues, conflictMessage, extraSetFields } from "@/modules/execucao/contracts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Motor S8 on a real local D1 (Miniflare/workerd, migrations 0001–0045): the readers of a delivered revision written session by
// session (OCCURRENCE) next to the readers of revisions with one dose per phase (TEMPLATE, every revision before 0041). Topics 15
// (visualização pelo aluno) and 16 (compatibilidade com os dados legados). The OCCURRENCE revision is produced by the real path:
// generate → apply → per-session edits → ready → approve → deliver.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const GEN_NOW = new Date("2026-11-20T15:00:00Z");
/** 03/12/2026 in Brazil: week 2 of the first phase. */
const NOW = new Date("2026-12-03T15:00:00Z");
const TODAY = "2026-12-03";
const rx = () => prescriptionFor(db, scope("tech-a"));
const plans = () => plansFor(db, scope("tech-a"));
const all = async <T,>(sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<T>()).results;
const one = async <T,>(sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<T>())!;

const V2 = {
  schemaVersion: 2,
  startDate: "2026-11-23",
  phases: [
    { name: "Base", weeks: 3, sessionsPerWeek: 2, workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 }], trainingDays: [0, 3] },
    { name: "Força", weeks: 2, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 3 }] },
  ],
};
const ANSWERS: GenerationAnswersInput = {
  stimulusByPhase: [
    { phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" },
    { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" },
  ],
  equipmentCodes: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE", "PULL_UP_BAR"],
};
const V1 = { startDate: "2026-11-23", phases: Array.from({ length: 3 }, () => ({ weeks: 3, sessionsPerWeek: 2, split: "AB", exercisesPerSession: 3 })) };

interface Fixture {
  occurrence: { planId: string; revisionId: string };
  template: { planId: string; revisionId: string };
  /** Week 2, session 1 of workout A (edited dose) and its first exercise. */
  edited: { occurrenceId: string; exerciseId: string; doseText: string };
  /** An exercise left out of week 3, session 1. */
  leftOut: { occurrenceId: string; exerciseId: string };
}
let fx: Fixture;
let occurrencePlan: StudentTrainingPlan;
let templatePlan: StudentTrainingPlan;

function ok<T extends ProposalOutcome | ApplyServiceOutcome>(outcome: T): Extract<T, { ok: true }> {
  if (!outcome.ok) throw new Error(`${outcome.reason}: ${outcome.message}`);
  return outcome as Extract<T, { ok: true }>;
}

async function deliveredOccurrencePlan(): Promise<Fixture["occurrence"] & Pick<Fixture, "edited" | "leftOut">> {
  const created = await plans().create("st-1", { title: "Plano por sessão", input: V2 as never });
  if (!created) throw new Error("plan");
  const service = proposalService(db, scope("tech-a"), { now: () => GEN_NOW });
  const cv = await one<{ n: number }>("SELECT content_version AS n FROM plan_revisions WHERE id = ?1", created.revisionId);
  const generated = ok(await service.generate(created.planId, created.revisionId, { idempotencyKey: "gen-s8-0001-0000-0000-000000000000", baseContentVersion: cv.n, answers: ANSWERS }));
  ok(
    await service.apply(created.planId, created.revisionId, {
      proposalId: generated.proposalId, idempotencyKey: "apply-s8-0001-0000-0000-000000000000", expectedVersion: generated.version,
      conflictMode: "PRESERVE", confirmedWorkouts: [], confirmInfeasible: false,
    }),
  );
  // The professional edits one session only, and leaves one exercise out of another session.
  const week2 = (await rx().occurrences(created.planId, created.revisionId, { phaseIndex: 1, week: 2 })).find((o) => o.label === "A")!;
  const target = week2.items.find((item) => item.included)!;
  expect(await rx().updateOccurrence(created.planId, created.revisionId, [target.id], { sets: "5", reps: "5", notes: "Semana pesada" })).toMatchObject({ status: "saved" });
  const week3 = (await rx().occurrences(created.planId, created.revisionId, { phaseIndex: 1, week: 3 })).find((o) => o.label === "A")!;
  const out = week3.items.filter((item) => item.included)[1];
  expect(await rx().setIncluded(created.planId, created.revisionId, [out.id], false)).toMatchObject({ status: "saved" });
  expect(await plans().markReady(created.planId, created.revisionId)).toBe(true);
  expect((await plans().approve(created.planId, created.revisionId, { screeningNotRecorded: true })).status).toBe("approved");
  expect((await plans().deliver(created.planId, created.revisionId)).status).toBe("delivered");
  const edited = await one<{ text: string | null; sets: string; reps: string; loadInstruction: string | null; cadence: string | null; restSeconds: number | null; restText: string | null; rirMin: number | null; rirMax: number | null }>(
    `SELECT dose_text AS text, sets, reps, load_instruction AS loadInstruction, cadence, rest_seconds AS restSeconds, rest_text AS restText,
       rir_min AS rirMin, rir_max AS rirMax FROM prescribed_exercise_occurrences WHERE id = ?1`,
    target.id,
  );
  return {
    ...created,
    edited: { occurrenceId: week2.id, exerciseId: target.prescribedExerciseId, doseText: edited.text ?? describeDose(edited) },
    leftOut: { occurrenceId: week3.id, exerciseId: out.prescribedExerciseId },
  };
}

async function deliveredTemplatePlan() {
  const created = await plans().create("st-1", { title: "Plano antigo", input: V1 as never });
  if (!created) throw new Error("plan");
  for (const [label, sets] of [["A", "3"], ["A", "4"], ["B", "2"]] as const)
    expect((await rx().add(created.planId, created.revisionId, { phaseIndex: 1, workoutLabel: label }, { exerciseId: label === "A" ? (sets === "3" ? "sys-001" : "sys-002") : "sys-003" }, { sets, reps: "10", restSeconds: 60, notes: "Devagar" })).status).toBe("saved");
  expect(await plans().markReady(created.planId, created.revisionId)).toBe(true);
  expect((await plans().approve(created.planId, created.revisionId, { screeningNotRecorded: true })).status).toBe("approved");
  expect((await plans().deliver(created.planId, created.revisionId)).status).toBe("delivered");
  return created;
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "student-plan-occurrences-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["tech-a", "tech-b", "client-1", "client-2"];
  await db.batch([
    ...people.map((p) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(p, `${p}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL')"),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-b','org-b','B')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-b','st-b','pro-b')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1'),('org-b','st-b','client-2')"),
    db.prepare(
      `INSERT INTO student_profiles(student_id,organization_id,goal,level,days_per_week,session_minutes,updated_by_user_id)
       VALUES ('st-1','org-a','Hipertrofia','Intermediário',3,60,'tech-a')`,
    ),
  ]);
  const occurrence = await deliveredOccurrencePlan();
  const template = await deliveredTemplatePlan();
  fx = { occurrence: { planId: occurrence.planId, revisionId: occurrence.revisionId }, template, edited: occurrence.edited, leftOut: occurrence.leftOut };
  const read = await studentTrainingFor(db, "client-1", "st-1");
  occurrencePlan = read.find((p) => p.planId === fx.occurrence.planId)!;
  templatePlan = read.find((p) => p.planId === fx.template.planId)!;
}, 120_000);
afterAll(async () => {
  await mf?.dispose();
});

describe("topic 15: the student sees the delivered prescription week by week", () => {
  it("reads every session of every week with the stored doses, the edited week and the left-out exercise as delivered", async () => {
    expect(occurrencePlan.prescriptionModel).toBe("OCCURRENCE");
    const stored = await all<{ id: string; phase_index: number; week_index: number; slot_index: number; workout_label: string; planned_date: string | null }>(
      "SELECT * FROM plan_session_occurrences WHERE revision_id = ?1 ORDER BY phase_index, week_index, slot_index",
      fx.occurrence.revisionId,
    );
    const sessions = occurrencePlan.phases.flatMap((phase) =>
      (phase.weeksDetail ?? []).flatMap((week) => week.sessions.map((s) => ({ phase: phase.index, ...s, weekOk: s.week === week.index }))),
    );
    expect(sessions.map((s) => [s.phase, s.week, s.slot, s.label, s.plannedDate])).toEqual(
      stored.map((o) => [o.phase_index, o.week_index, o.slot_index, o.workout_label, o.planned_date]),
    );
    expect(sessions.every((s) => s.weekOk)).toBe(true);
    expect(occurrencePlan.phases.map((p) => p.weeksDetail!.length)).toEqual([3, 2]);
    // Each session holds exactly its included doses, in the exercises' order, with the stored text.
    const included = await all<{ occurrence_id: string; prescribed_exercise_id: string; dose_text: string | null; sets: string | null; reps: string | null; notes: string | null }>(
      `SELECT x.occurrence_id, x.prescribed_exercise_id, x.dose_text, x.sets, x.reps, x.notes FROM prescribed_exercise_occurrences x
       JOIN prescribed_exercises pe ON pe.id = x.prescribed_exercise_id WHERE x.revision_id = ?1 AND x.included = 1 ORDER BY x.occurrence_id, pe.position`,
      fx.occurrence.revisionId,
    );
    for (const session of sessions) {
      const mine = included.filter((x) => x.occurrence_id === session.id);
      expect(session.exercises.map((e) => [e.id, e.doseText ?? null, e.sets, e.reps, e.notes])).toEqual(
        mine.map((x) => [x.prescribed_exercise_id, x.dose_text, x.sets, x.reps, x.notes]),
      );
      expect(session.exercises.length).toBeGreaterThan(0);
    }
    const edited = findSession(occurrencePlan, fx.edited.occurrenceId)!;
    const editedExercise = edited.session.exercises.find((e) => e.id === fx.edited.exerciseId)!;
    expect([editedExercise.sets, editedExercise.reps, editedExercise.notes]).toEqual(["5", "5", "Semana pesada"]);
    expect(storedDoseText(editedExercise)).toBe(fx.edited.doseText);
    // The engine's dose of the same exercise in week 1 is a different, stored text.
    const week1 = occurrencePlan.phases[0].weeksDetail![0].sessions.find((s) => s.label === "A")!;
    expect(storedDoseText(week1.exercises.find((e) => e.id === fx.edited.exerciseId)!)).not.toBe(fx.edited.doseText);
    expect(findSession(occurrencePlan, fx.leftOut.occurrenceId)!.session.exercises.some((e) => e.id === fx.leftOut.exerciseId)).toBe(false);
    // "Dose da primeira sessão": the workouts list every exercise that appears in a session, with its first dose.
    const workoutA = occurrencePlan.phases[0].workouts.find((w) => w.label === "A")!;
    expect(new Set(workoutA.exercises.map((e) => e.id))).toEqual(new Set(sessions.filter((s) => s.phase === 1 && s.label === "A").flatMap((s) => s.exercises.map((e) => e.id))));
  });

  it("never hands the trace, the structured dose or the proposal item to the student", async () => {
    const text = JSON.stringify(occurrencePlan);
    for (const forbidden of ["trace", "Trace", "doseJson", "dose_json", "sourceProposalItemId", "source_proposal_item_id", "HEURISTIC", "basis"])
      expect(text, forbidden).not.toContain(forbidden);
    const items = await all<{ id: string }>("SELECT id FROM proposal_items LIMIT 50");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(text).not.toContain(item.id);
    // Only the metric code of a structured dose is read, to offer the matching optional fields in the log.
    const metrics = new Set(occurrencePlan.phases.flatMap((p) => p.weeksDetail!.flatMap((w) => w.sessions.flatMap((s) => s.exercises.map((e) => e.metric ?? null)))));
    expect([...metrics].every((m) => m === null || ["REPS", "TIME", "DISTANCE", "INTERVALS", "CONTINUOUS"].includes(m))).toBe(true);
  });

  it("chooses the week of today, follows the address, and shows the progression of each workout across the weeks", () => {
    expect(selectedWeek(occurrencePlan, TODAY)).toEqual({ phase: 1, week: 2 });
    expect(selectedWeek(occurrencePlan, TODAY, { phase: 2, week: 2 })).toEqual({ phase: 2, week: 2 });
    expect(selectedWeek(occurrencePlan, TODAY, { phase: 1, week: 9 })).toEqual({ phase: 1, week: 2 });
    expect(selectedWeek(occurrencePlan, "2026-11-01")).toEqual({ phase: 1, week: 1 });
    expect(selectedWeek(occurrencePlan, "2027-06-01")).toEqual({ phase: 2, week: 2 });
    expect(selectedWeek(templatePlan, TODAY)).toBeNull();
    const weeks = occurrencePlan.phases[0].weeksDetail!;
    const rows = progressionOf(weeks, "A");
    const edited = rows.find((r) => r.exerciseId === fx.edited.exerciseId)!;
    expect(edited.cells).toHaveLength(3);
    expect(edited.cells[1]).toContain(fx.edited.doseText);
    expect(edited.cells[0]).not.toBe(edited.cells[1]);
    expect(rows.find((r) => r.exerciseId === fx.leftOut.exerciseId)!.cells[2].split(" / ")).toHaveLength(1);
  });

  it("renders weeks as links, the sessions of the chosen week with their doses and a log link per session; no basis or alert", () => {
    const html = renderToStaticMarkup(
      createElement(StudentTraining, { plan: occurrencePlan, today: TODAY, logBase: "/aluno/treino/registrar/st-1/" + fx.occurrence.planId }),
    );
    expect(html).toContain(`?plano=${fx.occurrence.planId}&amp;fase=1&amp;semana=3`);
    expect(html).toMatch(/aria-current="page"[^>]*>Semana 2</);
    expect(html).toContain(`?ocorrencia=${fx.edited.occurrenceId}`);
    expect(html).toContain("Registrar esta sessão");
    expect(html).toContain("Semana 2, sessão 1");
    expect(html).toContain(fx.edited.doseText.replace(/&/g, "&amp;"));
    expect(html).toContain("Progressão nesta fase");
    for (const forbidden of ["Heurística", "Por quê", "Inferido", "Proposta automática"]) expect(html).not.toContain(forbidden);
    // Another week from the address.
    const week3 = renderToStaticMarkup(createElement(StudentTraining, { plan: occurrencePlan, today: TODAY, asked: { phase: 1, week: 3 } }));
    expect(week3).toMatch(/aria-current="page"[^>]*>Semana 3</);
    expect(week3).toContain("Semana 3, sessão 1");
  });

  it("the professional's PDF source and the student's read are the same delivered content; the PDF prints every week", async () => {
    const source = await planDocumentsFor(db, scope("tech-a")).delivered(fx.occurrence.planId, fx.occurrence.revisionId);
    expect(source!.plan).toEqual(occurrencePlan);
    expect(await planDocumentsFor(db, scope("tech-b", "org-b")).delivered(fx.occurrence.planId, fx.occurrence.revisionId)).toBeNull();
    const first = await planFingerprint(occurrencePlan);
    expect(await planFingerprint(source!.plan)).toBe(first);
    // A "v2" fingerprint: the same content read as TEMPLATE fingerprints differently.
    expect(await planFingerprint({ ...occurrencePlan, prescriptionModel: "TEMPLATE" })).not.toBe(first);
    const bytes = await renderPlanPdf({ studentName: "One", organizationName: "Studio A", plan: occurrencePlan, generatedAt: NOW });
    const doc = await PDFDocument.load(bytes);
    let text = "";
    for (const page of doc.getPages()) {
      const contents = page.node.Contents();
      const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
      for (const stream of streams) {
        if (!(stream instanceof PDFRawStream)) continue;
        const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
        for (const match of operators.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text += Buffer.from(match[1], "hex").toString("latin1") + "\n";
      }
    }
    for (const week of ["Semana 1", "Semana 2", "Semana 3"]) expect(text).toContain(week);
    expect(text).toContain("Sessão 1 · Treino A");
    expect(text).toContain("Semana pesada");
    expect(text).not.toContain("HEURISTIC");
  });
});

describe("topic 15: the student logs a session of the week", () => {
  const sessionOf = (occurrenceId: string) => findSession(occurrencePlan, occurrenceId)!;
  const log = (occurrenceId: string | null, performedOn: string, extra: Record<string, unknown> = {}) => {
    const found = occurrenceId ? sessionOf(occurrenceId) : null;
    const exercise = found?.session.exercises[0];
    return {
      planId: fx.occurrence.planId,
      ...(occurrenceId ? { occurrenceId } : {}),
      phaseIndex: found?.phase.index ?? 1,
      workoutLabel: found?.session.label ?? "A",
      performedOn,
      exercises: exercise
        ? [{ prescribedExerciseId: exercise.id, done: true, sets: [{ reps: 8, loadKg: 40, rir: 2, loadBasis: "TOTAL" }, { reps: 7, loadKg: 40, durationSeconds: 45 }] }]
        : [],
      ...extra,
    };
  };

  it("saves against the session, refuses a log without one, of another workout or with an exercise left out of it", async () => {
    const student = studentSessionsFor(db, "client-1");
    expect(await student.save("st-1", log(null, "2026-12-01"), NOW)).toEqual({ status: "invalid" });
    // A session of workout B named under workout A.
    const b = occurrencePlan.phases[0].weeksDetail![1].sessions.find((s) => s.label === "B")!;
    expect(await student.save("st-1", { ...log(b.id, "2026-12-01"), workoutLabel: "A" }, NOW)).toEqual({ status: "invalid" });
    // An exercise left out of that session.
    expect(
      await student.save("st-1", { ...log(fx.leftOut.occurrenceId, "2026-12-01"), exercises: [{ prescribedExerciseId: fx.leftOut.exerciseId, done: true }] }, NOW),
    ).toEqual({ status: "invalid" });
    // A session of another revision.
    expect(await student.save("st-1", log("not-a-session", "2026-12-01"), NOW)).toEqual({ status: "invalid" });
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM workout_sessions")).toEqual({ n: 0 });

    const saved = await student.save("st-1", log(fx.edited.occurrenceId, "2026-12-01"), NOW);
    expect(saved).toMatchObject({ status: "saved", created: true });
    const id = (saved as { id: string }).id;
    expect(await one<{ o: string }>("SELECT occurrence_id AS o FROM workout_sessions WHERE id = ?1", id)).toEqual({ o: fx.edited.occurrenceId });
    const read = await student.get(id, NOW);
    expect(read!.occurrenceId).toBe(fx.edited.occurrenceId);
    expect(read!.exercises[0].sets).toEqual([
      { setNumber: 1, reps: 8, loadKg: 40, rir: 2, loadBasis: "TOTAL" },
      { setNumber: 2, reps: 7, loadKg: 40, durationSeconds: 45 },
    ]);
    // Correcting the same session the same day replaces it.
    expect(await student.save("st-1", { ...log(fx.edited.occurrenceId, "2026-12-01"), effort: 7 }, NOW)).toMatchObject({ status: "saved", created: false, id });
  });

  it("another session of the same workout the same day is a conflict; the same session on another day counts once", async () => {
    const student = studentSessionsFor(db, "client-1");
    const otherA = occurrencePlan.phases[0].weeksDetail![0].sessions.find((s) => s.label === "A")!;
    expect(await student.save("st-1", log(otherA.id, "2026-12-01"), NOW)).toEqual({ status: "conflict", reason: "other_occurrence" });
    expect(await student.save("st-1", log(fx.edited.occurrenceId, "2026-12-02"), NOW)).toMatchObject({ status: "saved", created: true });
    expect(await one<{ n: number }>("SELECT COUNT(*) AS n FROM workout_sessions WHERE occurrence_id = ?1", fx.edited.occurrenceId)).toEqual({ n: 2 });
    const progress = await executionFor(db, scope("tech-a")).progress("st-1", TODAY);
    const cycle = progress.cycles.find((c) => c.planId === fx.occurrence.planId)!;
    const week2 = cycle.weeks.find((w) => w.startDate === "2026-11-30")!;
    expect(week2.recorded).toBe(1);
    expect((await student.progress("st-1", TODAY)).cycles.find((c) => c.planId === fx.occurrence.planId)!.weeks.find((w) => w.startDate === "2026-11-30")!.recorded).toBe(1);
    // Pure rule: TEMPLATE logs (no session) are all kept.
    expect(
      distinctOccurrences([
        { occurrenceId: null, performedOn: "2026-12-01" },
        { occurrenceId: null, performedOn: "2026-12-01" },
        { occurrenceId: "x", performedOn: "2026-12-02" },
        { occurrenceId: "x", performedOn: "2026-12-01" },
      ]),
    ).toEqual([
      { occurrenceId: null, performedOn: "2026-12-01" },
      { occurrenceId: null, performedOn: "2026-12-01" },
      { occurrenceId: "x", performedOn: "2026-12-01" },
    ]);
  });

  it("the professional reads what that session foresaw, with its week and session", async () => {
    const id = (await one<{ id: string }>("SELECT id FROM workout_sessions WHERE occurrence_id = ?1 AND performed_on = '2026-12-01'", fx.edited.occurrenceId)).id;
    const detail = await executionFor(db, scope("tech-a")).detail(id);
    expect(detail!.occurrence).toMatchObject({ week: 2, slot: 1 });
    const session = sessionOf(fx.edited.occurrenceId).session;
    expect(detail!.exercisesPlanned).toBe(session.exercises.length);
    const planned = detail!.exercises.find((e) => e.prescribedExerciseId === fx.edited.exerciseId)!.planned;
    expect([planned.sets, planned.reps]).toEqual(["5", "5"]);
    expect(storedDoseText(planned)).toBe(fx.edited.doseText);
    expect(await executionFor(db, scope("tech-b", "org-b")).detail(id)).toBeNull();
    const list = await executionFor(db, scope("tech-a")).list("st-1");
    expect(list.find((row) => row.id === id)!.exercisesPlanned).toBe(session.exercises.length);
  });

  it("offers optional per-set fields by the stored metric only for sessions of the week", () => {
    expect(extraSetFields(false, "REPS")).toEqual([]);
    expect(extraSetFields(true, null)).toEqual(["rir", "loadBasis"]);
    expect(extraSetFields(true, "TIME")).toEqual(["durationSeconds", "rir"]);
    expect(extraSetFields(true, "INTERVALS")).toEqual(["durationSeconds", "distanceMeters"]);
  });

  it("the copy of the data carries the delivered weeks, the session of each log and the optional set fields; no trace", async () => {
    const outcome = await studentExportFor(db, "client-1").generate(NOW);
    if (outcome.status !== "generated") throw new Error(outcome.status);
    const text = JSON.stringify(outcome.document);
    for (const forbidden of ["trace", "doseJson", "dose_json", "HEURISTIC", fx.edited.occurrenceId]) expect(text, forbidden).not.toContain(forbidden);
    const link = outcome.document.vinculos[0];
    const delivered = link.treinoEntregue.find((p) => p.plano === "Plano por sessão")!;
    const phase1 = delivered.fases[0] as { semanasDoTreino?: Array<{ semana: number; sessoes: Array<{ sessao: number; treino: string; exercicios: Array<{ nome: string; dose?: string | null; series: string | null }> }> }> };
    expect(phase1.semanasDoTreino).toHaveLength(3);
    // `treinos` of a phase written session by session says its dose is one session's (design §5.2).
    expect((delivered.fases[0] as { notaDosTreinos?: string }).notaDosTreinos).toBe(OCCURRENCE_WORKOUTS_NOTE);
    const week2A = phase1.semanasDoTreino![1].sessoes.find((s) => s.treino === "A")!;
    expect(week2A.exercicios.some((e) => e.series === "5" && e.dose === fx.edited.doseText)).toBe(true);
    const logged = link.treinosRegistrados.registros.filter((r) => r.plano === "Plano por sessão") as Array<{ semana?: number; sessao?: number; exercicios: Array<{ series: Array<Record<string, unknown>> }> }>;
    expect(logged.length).toBe(2);
    expect(logged.every((r) => r.semana === 2 && r.sessao === 1)).toBe(true);
    expect(logged[0].exercicios[0].series[0]).toEqual({ numero: 1, repeticoes: 8, cargaKg: 40, repeticoesEmReserva: 2, cargaContadaComo: "TOTAL" });
    expect(logged[0].exercicios[0].series[1]).toEqual({ numero: 2, repeticoes: 7, cargaKg: 40, duracaoSegundos: 45 });
    // The readable copy names the weeks and the session of each log.
    const readable = JSON.stringify(readableExport(outcome.source));
    expect(readable).toContain("Semana 2, sessão 1");
    expect(readable).toContain("semana 2, sessão 1");
    expect(readable).toContain("RIR 2");
  });
});

describe("topic 16: revisions with one dose per phase read exactly as before", () => {
  it("TEMPLATE plans keep their shape: base rows, no weeks, no stored text key, the same fingerprint", async () => {
    expect(templatePlan.prescriptionModel).toBe("TEMPLATE");
    const base = await all<{ id: string; workout_label: string; name: string; sets: string; reps: string; rest_seconds: number; notes: string }>(
      "SELECT * FROM prescribed_exercises WHERE revision_id = ?1 ORDER BY workout_label, position",
      fx.template.revisionId,
    );
    const phase = templatePlan.phases[0];
    expect(phase.weeksDetail).toBeUndefined();
    expect(phase.workouts.flatMap((w) => w.exercises.map((e) => [w.label, e.id, e.name, e.sets, e.reps, e.restSeconds, e.notes]))).toEqual(
      base.map((r) => [r.workout_label, r.id, r.name, r.sets, r.reps, r.rest_seconds, r.notes]),
    );
    for (const exercise of phase.workouts.flatMap((w) => w.exercises)) {
      expect(Object.keys(exercise).sort()).toEqual(
        ["cadence", "id", "loadInstruction", "name", "notes", "reps", "restSeconds", "restText", "rirMax", "rirMin", "sets", "videoStatus", "videoUrl"].sort(),
      );
      expect(storedDoseText(exercise)).toBe(describeDose(exercise));
    }
    // The fingerprint of a TEMPLATE plan does not depend on the new field.
    const withoutModel: StudentTrainingPlan = { ...templatePlan };
    delete withoutModel.prescriptionModel;
    expect(await planFingerprint(withoutModel)).toBe(await planFingerprint(templatePlan));
    const html = renderToStaticMarkup(createElement(StudentTraining, { plan: templatePlan, today: TODAY, logBase: "/x" }));
    expect(html).not.toContain("Semana 1");
    expect(html).toContain("Registrar este treino");
  });

  it("mixed revisions in one read: each by its own model", async () => {
    const rows = await all<DeliveredRevisionRow>(
      `SELECT p.id AS planId, p.title, r.id AS revisionId, r.organization_id AS organizationId, r.revision_number AS revisionNumber,
         r.delivered_at AS deliveredAt, r.delivered_by_name AS deliveredBy, r.delivered_organization_name AS deliveredOrganizationName,
         r.start_date AS startDate, r.end_date AS endDate, r.schedule_json AS scheduleJson, r.prescription_model AS prescriptionModel
       FROM plan_revisions r JOIN training_plans p ON p.id = r.plan_id WHERE r.state = 'DELIVERED' ORDER BY p.title`,
    );
    const mixed = await assembleDelivered(db, rows);
    expect(mixed.map((p) => p.prescriptionModel)).toEqual(["TEMPLATE", "OCCURRENCE"]);
    expect(mixed.find((p) => p.planId === fx.template.planId)).toEqual(templatePlan);
    expect(mixed.find((p) => p.planId === fx.occurrence.planId)).toEqual(occurrencePlan);
    // A row with the wrong organization reads no session (each session is matched on its organization too).
    const [foreign] = await assembleDelivered(db, [{ ...rows.find((r) => r.planId === fx.occurrence.planId)!, organizationId: "org-b" }]);
    expect(foreign.phases.every((p) => p.weeksDetail!.every((w) => w.sessions.length === 0))).toBe(true);
  });

  it("TEMPLATE logs: no session is named; naming one is refused; progress and detail read as before", async () => {
    const student = studentSessionsFor(db, "client-1");
    const exercise = templatePlan.phases[0].workouts[0].exercises[0];
    const payload = { planId: fx.template.planId, phaseIndex: 1, workoutLabel: "A", performedOn: "2026-12-01", exercises: [{ prescribedExerciseId: exercise.id, done: true, sets: [{ reps: 10, loadKg: 20 }] }] };
    expect(await student.save("st-1", { ...payload, occurrenceId: fx.edited.occurrenceId }, NOW)).toEqual({ status: "invalid" });
    const saved = await student.save("st-1", payload, NOW);
    expect(saved).toMatchObject({ status: "saved", created: true });
    const id = (saved as { id: string }).id;
    const read = await student.get(id, NOW);
    expect(read!.occurrenceId).toBeNull();
    expect(read!.exercises[0].sets).toEqual([{ setNumber: 1, reps: 10, loadKg: 20 }]);
    const detail = await executionFor(db, scope("tech-a")).detail(id);
    expect(detail!.occurrence).toBeNull();
    expect(detail!.exercisesPlanned).toBe(2);
    expect(detail!.exercises[0].planned).not.toHaveProperty("doseText");
    // The student's form for a TEMPLATE plan offers no optional set field.
    expect(extraSetFields(templatePlan.prescriptionModel === "OCCURRENCE", null)).toEqual([]);
    const outcome = await studentExportFor(db, "client-1").generate(new Date(NOW.getTime() + 2 * 3_600_000));
    if (outcome.status !== "generated") throw new Error(outcome.status);
    const delivered = outcome.document.vinculos[0].treinoEntregue.find((p) => p.plano === "Plano antigo")!;
    expect(Object.keys(delivered.fases[0]).sort()).toEqual(["divisao", "fase", "fim", "inicio", "semanas", "sessoesPorSemana", "treinos"].sort());
    expect(Object.keys(delivered.fases[0].treinos[0].exercicios[0])).not.toContain("dose");
    const templateLog = outcome.document.vinculos[0].treinosRegistrados.registros.find((r) => r.plano === "Plano antigo")!;
    expect(Object.keys(templateLog)).not.toContain("semana");
    expect(templateLog.exercicios[0].series[0]).toEqual({ numero: 1, repeticoes: 10, cargaKg: 20 });
  });
});

describe("topic 15: revocation closes every reader and the log of a revision written session by session", () => {
  // Runs last: it revokes and restores links on the shared fixture.
  const logPayload = () => {
    const session = findSession(occurrencePlan, fx.edited.occurrenceId)!.session;
    return {
      planId: fx.occurrence.planId,
      occurrenceId: fx.edited.occurrenceId,
      phaseIndex: 1,
      workoutLabel: session.label,
      performedOn: "2026-12-03",
      exercises: [{ prescribedExerciseId: session.exercises[0].id, done: true, sets: [{ reps: 6, loadKg: 50 }] }],
    };
  };
  const logs = async () => (await one<{ n: number }>("SELECT COUNT(*) AS n FROM workout_sessions WHERE occurrence_id = ?1", fx.edited.occurrenceId)).n;
  const loggedId = async () =>
    (await one<{ id: string }>("SELECT id FROM workout_sessions WHERE occurrence_id = ?1 AND performed_on = '2026-12-01'", fx.edited.occurrenceId)).id;

  for (const [what, revoke, restore] of [
    ["revoked student access", "UPDATE student_access SET revoked_at = '2026-12-02T00:00:00.000Z' WHERE user_id = 'client-1'", "UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-1'"],
    ["disabled student user", "UPDATE users SET disabled_at = '2026-12-02T00:00:00.000Z' WHERE id = 'client-1'", "UPDATE users SET disabled_at = NULL WHERE id = 'client-1'"],
  ] as const)
    it(`${what}: no weeks, no sessions, no log and no copy of the plan`, async () => {
      const before = await logs();
      await db.prepare(revoke).run();
      try {
        expect(await studentTrainingFor(db, "client-1", "st-1")).toEqual([]);
        expect((await studentSessionsFor(db, "client-1").save("st-1", logPayload(), NOW)).status).not.toBe("saved");
        expect(await logs()).toBe(before);
        const outcome = await studentExportFor(db, "client-1").generate(new Date(NOW.getTime() + 6 * 3_600_000));
        if (outcome.status === "generated") expect(JSON.stringify(outcome.document)).not.toContain("Plano por sessão");
      } finally {
        await db.prepare(restore).run();
      }
      expect((await studentTrainingFor(db, "client-1", "st-1")).some((p) => p.planId === fx.occurrence.planId)).toBe(true);
    });

  for (const [what, revoke, restore] of [
    ["revoked care assignment", "UPDATE care_assignments SET revoked_at = '2026-12-02T00:00:00.000Z' WHERE student_id = 'st-1'", "UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'"],
    ["disabled professional", "UPDATE users SET disabled_at = '2026-12-02T00:00:00.000Z' WHERE id = 'tech-a'", "UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'"],
  ] as const)
    it(`${what}: the professional reads no PDF source, no log detail and no session's planned dose`, async () => {
      const id = await loggedId();
      await db.prepare(revoke).run();
      try {
        expect(await planDocumentsFor(db, scope("tech-a")).delivered(fx.occurrence.planId, fx.occurrence.revisionId)).toBeNull();
        expect(await executionFor(db, scope("tech-a")).detail(id)).toBeNull();
        expect(await executionFor(db, scope("tech-a")).list("st-1")).toEqual([]);
      } finally {
        await db.prepare(restore).run();
      }
      expect(await executionFor(db, scope("tech-a")).detail(id)).not.toBeNull();
    });
});

describe("the student's form and messages for a session of the week", () => {
  it("names the other session in a conflict, since reloading does not clear it", () => {
    expect(conflictMessage("other_occurrence")).toBe("Já existe um registro deste treino nesta data para outra sessão.");
    expect(conflictMessage()).toBe("Já existe um registro deste treino nesta data. Recarregue a página.");
  });

  it("a set with only how the load was counted is asked about, never dropped silently", () => {
    const blank = { reps: null, loadKg: null, rir: null, durationSeconds: null, distanceMeters: null, loadBasis: null };
    expect(basisWithoutValues({ ...blank, loadBasis: "BODYWEIGHT" })).toBe(true);
    expect(basisWithoutValues({ ...blank, loadBasis: "BODYWEIGHT", reps: 12 })).toBe(false);
    expect(basisWithoutValues(blank)).toBe(false);
  });
});
