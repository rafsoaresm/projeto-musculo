import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { studentTrainingFor } from "@/db/student-plan";
import { studentSessionsFor } from "@/db/workout-sessions";
import { studentExportFor } from "@/db/student-export";
import { readableExport } from "@/modules/pedidos/export-readable";
import { serializeExport } from "@/modules/pedidos/export";
import { planFingerprint, renderPlanPdf } from "@/modules/pdf/plan-pdf";
import { progressOf, workoutSlots } from "@/modules/prescricao/summary";
import { convertV1ToV2 } from "@/modules/training/periodization";
import type { PeriodizationInputV1, PeriodizationInputV2 } from "@/modules/training/contracts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Topic 3 (free structures) and topic 16 (legacy data) against a real local D1 with every migration: saving,
// prescribing on free labels, delivering and every reader of a delivered plan (portal data, PDF, execution,
// student copy). v1 rows written the 0.93 way keep working untouched.

let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 10, 0, 0) + minute * 60_000);
const NOW = new Date(Date.UTC(2026, 10, 12, 15, 0, 0));
const TODAY = "2026-11-12";

const V1: PeriodizationInputV1 = {
  startDate: "2026-11-02",
  phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: "ABC" as const, exercisesPerSession: 3 })),
};
const V2: PeriodizationInputV2 = {
  schemaVersion: 2,
  startDate: "2026-11-02",
  phases: [
    {
      name: "Adaptação",
      weeks: 2,
      sessionsPerWeek: 2,
      workouts: [
        { label: "Superior", name: "Empurrar e puxar", exerciseTarget: 2, focus: { note: "tronco", minutes: 45 } },
        { label: "Inferior", name: null, exerciseTarget: null, focus: null },
      ],
      rotation: null,
      trainingDays: [0, 3],
    },
    {
      name: null,
      weeks: 9,
      sessionsPerWeek: 5,
      workouts: [
        { label: "Superior", name: null, exerciseTarget: 1, focus: null },
        { label: "Corrida", name: "Intervalado", exerciseTarget: 1, focus: null },
      ],
      rotation: ["Superior", "Corrida", "Corrida"],
      trainingDays: null,
    },
  ],
};

async function newPlan(input: unknown, student = "st-1") {
  const created = await plansFor(db, scope("tech-a")).create(student, { title: `Plano ${crypto.randomUUID().slice(0, 6)}`, input });
  if (!created) throw new Error("plan refused");
  return created;
}
const storedInput = async (revisionId: string) =>
  (await db.prepare("SELECT input_json AS j, engine_version AS v FROM plan_revisions WHERE id = ?1").bind(revisionId).first<{ j: string; v: string }>())!;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "structure-v2-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["tech-a", "tech-b", "client-1"];
  await db.batch([
    ...people.map((id) =>
      db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?2,?3,0,0)").bind(id, `Nome ${id}`, `${id}@example.test`),
    ),
    ...people.map((id) => db.prepare("INSERT INTO users(id) VALUES (?1)").bind(id)),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL')"),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Aluno Um'),('st-2','org-a','Aluno Dois'),('st-b','org-b','Aluno B')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a'),('org-b','st-b','pro-b')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("legacy v1 plans (topic 16)", () => {
  it("stores a v1 input byte for byte as 0.93 did, and reads it back as v1", async () => {
    const plan = await newPlan(V1, "st-2");
    const row = await storedInput(plan.revisionId);
    expect(row.j).toBe(JSON.stringify(V1));
    expect(row.v).toBe("0.1.0");
    const found = (await plansFor(db, scope("tech-a")).findRevision(plan.planId, plan.revisionId))!;
    expect(found.revision.input).toEqual(V1);
    expect(found.revision.schedule.schemaVersion).toBe(1);
  });

  it("opens a revision row written directly with 0.93's JSON (no schemaVersion in the input)", async () => {
    const plan = await newPlan(V1, "st-2");
    // What 0.93 wrote, without going through the new code at all.
    const legacyInput = '{"startDate":"2026-11-02","phases":[{"weeks":3,"sessionsPerWeek":2,"split":"AB","exercisesPerSession":4},{"weeks":3,"sessionsPerWeek":2,"split":"AB","exercisesPerSession":4},{"weeks":3,"sessionsPerWeek":2,"split":"AB","exercisesPerSession":4}]}';
    const legacySchedule = JSON.stringify({
      schemaVersion: 1, engineVersion: "0.1.0", status: "DRAFT", startDate: "2026-11-02", endDate: "2027-01-03", totalWeeks: 9, totalSessions: 18,
      phases: [0, 1, 2].map((i) => ({ weeks: 3, sessionsPerWeek: 2, split: "AB", exercisesPerSession: 4, index: i + 1, startDate: "2026-11-02", endDate: "2026-11-22", microcycles: [] })),
    });
    await db.prepare("UPDATE plan_revisions SET input_json = ?1, schedule_json = ?2 WHERE id = ?3").bind(legacyInput, legacySchedule, plan.revisionId).run();
    const found = (await plansFor(db, scope("tech-a")).findRevision(plan.planId, plan.revisionId))!;
    expect(found.revision.input.phases).toHaveLength(3);
    expect(workoutSlots(found.revision.schedule).map((s) => s.label)).toEqual(["A", "B", "A", "B", "A", "B"]);
    const rx = prescriptionFor(db, scope("tech-a"));
    expect(await rx.add(plan.planId, plan.revisionId, { phaseIndex: 3, workoutLabel: "B" }, { customName: "Remada" }, {})).toMatchObject({ status: "saved" });
    expect(await rx.add(plan.planId, plan.revisionId, { phaseIndex: 3, workoutLabel: "C" }, { customName: "Remada" }, {})).toEqual({ status: "invalid_target" });
  });

  it("moves a v1 draft with exercises to v2 without losing a single exercise", async () => {
    const plan = await newPlan(V1, "st-2");
    const rx = prescriptionFor(db, scope("tech-a"));
    for (const [phaseIndex, workoutLabel] of [[1, "A"], [2, "C"], [3, "B"]] as const)
      await rx.add(plan.planId, plan.revisionId, { phaseIndex, workoutLabel }, { customName: `Ex ${phaseIndex}${workoutLabel}` }, { sets: "3" });
    const before = await rx.list(plan.planId, plan.revisionId);
    const plans = plansFor(db, scope("tech-a"));
    expect(await plans.saveDraft(plan.planId, plan.revisionId, convertV1ToV2(V1))).toBe(true);
    const found = (await plans.findRevision(plan.planId, plan.revisionId))!;
    expect(found.revision.schedule.schemaVersion).toBe(2);
    expect((await storedInput(plan.revisionId)).v).toBe("0.2.0");
    expect(await rx.list(plan.planId, plan.revisionId)).toEqual(before);
    // Renaming a workout that has exercises would orphan them: refused, as removing it always was.
    const renamed = convertV1ToV2(V1);
    renamed.phases[1].workouts[2].label = "Pernas";
    await expect(plans.saveDraft(plan.planId, plan.revisionId, renamed)).rejects.toThrow("PRESCRIPTION_WOULD_BE_LOST");
    renamed.phases[1].workouts[2].label = "C";
    renamed.phases[1].workouts[0].label = "Peito";
    renamed.phases[1].rotation = ["Peito", "B", "C"];
    expect(await plans.saveDraft(plan.planId, plan.revisionId, renamed)).toBe(true);
  });
});

describe("free structures in a saved plan (topic 3)", () => {
  it("saves a v2 structure, prescribes on free labels and counts targets per workout", async () => {
    const plan = await newPlan(V2);
    const plans = plansFor(db, scope("tech-a"));
    const found = (await plans.findRevision(plan.planId, plan.revisionId))!;
    expect(found.revision.input).toEqual(V2);
    expect(found.revision.totalWeeks).toBe(11);
    expect(found.revision.totalSessions).toBe(2 * 2 + 9 * 5);
    expect(found.revision.endDate).toBe("2027-01-17");
    const schedule = found.revision.schedule;
    if (schedule.schemaVersion !== 2) throw new Error("expected v2");
    expect(schedule.phases[0].microcycles[1].slots).toEqual([
      { slot: 1, label: "Superior", plannedDate: "2026-11-09" },
      { slot: 2, label: "Inferior", plannedDate: "2026-11-12" },
    ]);
    expect(schedule.phases[1].microcycles[0].sessions).toEqual(["Superior", "Corrida", "Corrida", "Superior", "Corrida"]);

    const rx = prescriptionFor(db, scope("tech-a"));
    expect(await rx.add(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "Superior" }, { customName: "Supino" }, { sets: "3", reps: "8-10" })).toMatchObject({ status: "saved" });
    expect(await rx.add(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "Inferior" }, { customName: "Agachamento" }, { sets: "4" })).toMatchObject({ status: "saved" });
    expect(await rx.add(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { customName: "X" }, {})).toEqual({ status: "invalid_target" });
    expect(await rx.add(plan.planId, plan.revisionId, { phaseIndex: 2, workoutLabel: "Inferior" }, { customName: "X" }, {})).toEqual({ status: "invalid_target" });
    // Copying works between free labels and across phases that share a label.
    expect(await rx.copyWorkout(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "Superior" }, { phaseIndex: 2, workoutLabel: "Superior" })).toMatchObject({ status: "saved" });
    expect(await rx.add(plan.planId, plan.revisionId, { phaseIndex: 2, workoutLabel: "Corrida" }, { customName: "Tiros de 400 m" }, { sets: "8", notes: "recuperação andando" })).toMatchObject({ status: "saved" });

    const items = await rx.list(plan.planId, plan.revisionId);
    expect(progressOf(schedule, items).map((p) => [p.phaseIndex, p.label, p.count, p.status])).toEqual([
      [1, "Superior", 1, "BELOW"],
      [1, "Inferior", 1, "NO_TARGET"],
      [2, "Superior", 1, "MET"],
      [2, "Corrida", 1, "MET"],
    ]);
    const overview = (await plans.overview(20)).find((row) => row.revisionId === plan.revisionId)!;
    expect([overview.workouts, overview.exercises, overview.below]).toEqual([4, 4, 1]);
  });

  it("refuses an invalid v2 structure on create and on save, leaving the draft as it was", async () => {
    const plans = plansFor(db, scope("tech-a"));
    const bad = structuredClone(V2);
    bad.phases[0].workouts[1].label = "Inferior|2";
    await expect(plans.create("st-1", { title: "Ruim", input: bad })).rejects.toThrow();
    const plan = await newPlan(V2);
    const before = await storedInput(plan.revisionId);
    const tooMany = structuredClone(V2);
    tooMany.phases[1].weeks = 200;
    await expect(plans.saveDraft(plan.planId, plan.revisionId, tooMany)).rejects.toThrow();
    expect(await storedInput(plan.revisionId)).toEqual(before);
  });

  it("delivers a v2 plan and every reader shows its names, labels and division", async () => {
    const plan = await newPlan(V2);
    const plans = plansFor(db, scope("tech-a"));
    const rx = prescriptionFor(db, scope("tech-a"));
    await rx.add(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "Superior" }, { customName: "Supino" }, { sets: "3", reps: "10" });
    await rx.add(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "Inferior" }, { customName: "Agachamento" }, { sets: "4", reps: "8" });
    await rx.add(plan.planId, plan.revisionId, { phaseIndex: 2, workoutLabel: "Corrida" }, { customName: "Tiros de 400 m" }, { sets: "8" });
    expect(await plans.markReady(plan.planId, plan.revisionId)).toBe(true);
    expect((await plans.approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, at(1))).status).toBe("approved");
    expect((await plans.deliver(plan.planId, plan.revisionId, at(2))).status).toBe("delivered");

    const seen = (await studentTrainingFor(db, "client-1", "st-1")).find((item) => item.planId === plan.planId)!;
    expect(seen.phases.map((p) => [p.index, p.name, p.split, p.weeks, p.sessionsPerWeek])).toEqual([
      [1, "Adaptação", "Superior / Inferior", 2, 2],
      [2, null, "Superior / Corrida", 9, 5],
    ]);
    expect(seen.phases[0].workouts.map((w) => [w.label, w.name, w.exercises.map((e) => e.name)])).toEqual([
      ["Superior", "Empurrar e puxar", ["Supino"]],
      ["Inferior", null, ["Agachamento"]],
    ]);
    expect(seen.phases[1].workouts.map((w) => [w.label, w.name, w.exercises.length])).toEqual([["Superior", null, 0], ["Corrida", "Intervalado", 1]]);
    // The focus note is the professional's own annotation: never part of what the student receives.
    expect(JSON.stringify(seen)).not.toContain("tronco");

    // PDF: renders with the names, and its fingerprint covers them.
    const bytes = await renderPlanPdf({ studentName: "Aluno Um", organizationName: "Studio A", plan: seen, generatedAt: NOW });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    const unnamed = { ...seen, phases: seen.phases.map((p) => ({ ...p, name: null, workouts: p.workouts.map((w) => ({ ...w, name: null })) })) };
    expect(await planFingerprint(seen)).not.toBe(await planFingerprint(unnamed));

    // Execution: the student logs the free label, and the weekly records read the v2 sessions.
    const sessions = studentSessionsFor(db, "client-1");
    const items = (await rx.list(plan.planId, plan.revisionId)).filter((item) => item.phaseIndex === 2 && item.workoutLabel === "Corrida");
    const saved = await sessions.save("st-1", {
      planId: plan.planId, phaseIndex: 2, workoutLabel: "Corrida", performedOn: TODAY,
      exercises: [{ prescribedExerciseId: items[0].id, done: true, sets: [{ reps: 8 }] }],
    }, NOW);
    expect(saved).toMatchObject({ status: "saved" });
    expect(await sessions.save("st-1", { planId: plan.planId, phaseIndex: 1, workoutLabel: "Corrida", performedOn: TODAY, exercises: [] }, NOW)).not.toMatchObject({ status: "saved" });
    const progress = await sessions.progress("st-1", TODAY);
    expect(progress.cycles.some((cycle) => cycle.planId === plan.planId)).toBe(true);

    // The student's copy (file and readable) carries the names.
    const copy = await studentExportFor(db, "client-1").generate(NOW);
    if (copy.status !== "generated") throw new Error(copy.status);
    const file = serializeExport(copy.document);
    const fases = copy.document.vinculos[0].treinoEntregue.find((item) => item.plano === seen.title)!.fases;
    expect(fases.map((fase) => [fase.divisao, (fase as { nome?: string }).nome])).toEqual([["Superior / Inferior", "Adaptação"], ["Superior / Corrida", undefined]]);
    expect(fases[0].treinos.map((t) => [t.treino, (t as { nome?: string }).nome])).toEqual([["Superior", "Empurrar e puxar"], ["Inferior", undefined]]);
    expect(file).not.toContain("tronco");
    const readable = JSON.stringify(readableExport(copy.source));
    expect(readable).toContain("Fase 1 (Adaptação)");
    expect(readable).toContain("Treino Superior · Empurrar e puxar");
    expect(readable).toContain("Treino Corrida · Intervalado");
  });

  it("keeps other organizations out of a v2 plan, as for v1", async () => {
    const plan = await newPlan(V2);
    expect(await plansFor(db, scope("tech-b", "org-b")).findRevision(plan.planId, plan.revisionId)).toBeNull();
    expect(await prescriptionFor(db, scope("tech-b", "org-b")).add(plan.planId, plan.revisionId, { phaseIndex: 1, workoutLabel: "Superior" }, { customName: "X" }, {})).toEqual({ status: "not_found" });
  });
});
