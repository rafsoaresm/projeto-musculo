import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import type { GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import { proposalService, type ApplyPayload, type ApplyServiceOutcome, type ProposalOutcome } from "@/modules/prescricao/automatica/service";
import { occurrenceCounts, pairOccurrences, scheduleOccurrences } from "@/modules/prescricao/occurrences";
import { buildPeriodization } from "@/modules/training/periodization";
import { structureFacts } from "@/modules/prescricao/automatica/facts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Motor S7 on a real local D1 (Miniflare/workerd, migrations 0001–0045): applying a proposal to its DRAFT revision and editing the
// prescription per session afterwards. Topics 11 (preservação de edições manuais), 12 (concorrência e idempotência), 14 (revisões
// aprovadas e entregues) and 16 (compatibilidade com os dados legados). Identities are rows, as the server derives them from a
// verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const NOW = new Date("2026-11-20T15:00:00Z");
const service = (userId = "tech-a", organizationId = "org-a", workUnitsPerRequest?: number) =>
  proposalService(db, scope(userId, organizationId), { now: () => NOW, ...(workUnitsPerRequest ? { workUnitsPerRequest } : {}) });
const rx = (userId = "tech-a", organizationId = "org-a") => prescriptionFor(db, scope(userId, organizationId));
const plans = (userId = "tech-a", organizationId = "org-a") => plansFor(db, scope(userId, organizationId));
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const all = async <T,>(sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<T>()).results;
let seq = 0;
const id = (label: string) => `${label}-${String(++seq).padStart(4, "0")}-0000-0000-000000000000`.slice(0, 40);

const V2 = {
  schemaVersion: 2, startDate: "2026-11-23",
  phases: [
    { name: "Base", weeks: 3, sessionsPerWeek: 2, workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: 3 }], trainingDays: [0, 3] },
    { name: "Força", weeks: 2, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 3 }] },
    { name: "Pico", weeks: 1, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 2 }] },
  ],
};
const withBaseWeeks = (weeks: number) => ({ ...V2, phases: [{ ...V2.phases[0], weeks }, ...V2.phases.slice(1)] });
const ANSWERS: GenerationAnswersInput = {
  stimulusByPhase: [
    { phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" },
    { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" },
    { phaseIndex: 3, value: "STRENGTH", basis: "PROFESSIONAL" },
  ],
  equipmentCodes: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE", "PULL_UP_BAR"],
};

function ok(outcome: ProposalOutcome) {
  if (!outcome.ok) throw new Error(`${outcome.reason}: ${outcome.message}`);
  return outcome;
}
function applied(outcome: ApplyServiceOutcome) {
  if (!outcome.ok) throw new Error(`${outcome.reason}: ${outcome.message}`);
  return outcome;
}
const reason = (outcome: ApplyServiceOutcome | ProposalOutcome) => (outcome.ok ? "ok" : outcome.reason);

interface Draft {
  planId: string;
  revisionId: string;
}
async function newDraft(input: unknown = V2, student = "st-1"): Promise<Draft> {
  const created = await plans().create(student, { title: "Plano aplicado", input: input as never });
  if (!created) throw new Error("plan");
  return created;
}
const contentVersion = (d: Draft) => count("SELECT content_version AS n FROM plan_revisions WHERE id = ?1", d.revisionId);
async function generated(d: Draft, answers: GenerationAnswersInput = ANSWERS, who = service()) {
  return ok(await who.generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: await contentVersion(d), answers }));
}
const applyPayload = (proposalId: string, version: number, extra: Partial<ApplyPayload> = {}): ApplyPayload => ({
  proposalId, idempotencyKey: id("apply"), expectedVersion: version, conflictMode: "PRESERVE", confirmedWorkouts: [], confirmInfeasible: false, ...extra,
});
async function generatedAndApplied(d: Draft) {
  const out = await generated(d);
  const result = applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version)));
  return { proposalId: out.proposalId, applicationId: result.applicationId, counts: result.counts };
}
interface PeRow {
  id: string;
  phase_index: number;
  workout_label: string;
  position: number;
  exercise_id: string | null;
  name: string;
  sets: string | null;
  reps: string | null;
  origin: string;
  dose_json: string | null;
  dose_text: string | null;
  application_id: string | null;
  source_slot_key: string | null;
  copied_from_id: string | null;
  substitutes_prescribed_exercise_id: string | null;
}
const rows = (d: Draft) => all<PeRow>("SELECT * FROM prescribed_exercises WHERE revision_id = ?1 ORDER BY phase_index, workout_label, position", d.revisionId);
interface DoseRow {
  id: string;
  prescribed_exercise_id: string;
  occurrence_id: string;
  included: number;
  sets: string | null;
  reps: string | null;
  notes: string | null;
  dose_json: string | null;
  dose_text: string | null;
  trace_json: string | null;
  origin: string;
  week_index: number;
  slot_index: number;
  phase_index: number;
  workout_label: string;
}
const doses = (d: Draft) =>
  all<DoseRow>(
    `SELECT x.*, o.week_index, o.slot_index, o.phase_index, o.workout_label FROM prescribed_exercise_occurrences x
     JOIN plan_session_occurrences o ON o.id = x.occurrence_id WHERE x.revision_id = ?1 ORDER BY o.phase_index, o.week_index, o.slot_index`,
    d.revisionId,
  );
const sessions = (d: Draft) =>
  all<{ id: string; phase_index: number; week_index: number; slot_index: number; workout_label: string; week_start: string; planned_date: string | null }>(
    "SELECT * FROM plan_session_occurrences WHERE revision_id = ?1 ORDER BY phase_index, week_index, slot_index",
    d.revisionId,
  );
const events = (d: Draft, action: string) => count("SELECT COUNT(*) AS n FROM training_plan_events WHERE revision_id = ?1 AND action = ?2", d.revisionId, action);

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "prescription-apply-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["tech-a", "tech-a2", "commercial-a", "tech-b", "client-1", "owner-a"];
  await db.batch([
    ...people.map((p) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(p, `${p}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-a','owner-a','OWNER'),('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),
       ('pro-a2','org-a','tech-a2','Pro A2'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-b','org-b','B')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-b','st-b','pro-b')"),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
    db.prepare(
      `INSERT INTO student_profiles(student_id,organization_id,goal,level,days_per_week,session_minutes,updated_by_user_id)
       VALUES ('st-1','org-a','Hipertrofia','Intermediário',3,60,'tech-a')`,
    ),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("pure helpers of the occurrence model", () => {
  it("lists every session of the saved schedule with the dates the student sees (v2 and v1)", () => {
    const v2 = buildPeriodization(V2);
    const list = scheduleOccurrences(v2);
    expect(list).toHaveLength(9);
    // Same sessions and dates the adapter gives the engine.
    const fromAdapter = structureFacts(v2).phases.flatMap((p) => p.occurrences.map((o) => ({ phaseIndex: p.index, ...o })));
    expect(list.map((o) => [o.phaseIndex, o.week, o.slot, o.label, o.weekStart, o.plannedDate])).toEqual(
      fromAdapter.map((o) => [o.phaseIndex, o.week, o.slot, o.label, o.weekStart, o.plannedDate]),
    );
    const v1 = buildPeriodization({ startDate: "2026-11-02", phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: "Full Body", exercisesPerSession: 3 })) });
    const legacy = scheduleOccurrences(v1);
    expect(legacy).toHaveLength(36);
    expect(legacy.every((o) => o.plannedDate === null && o.label === "Full Body")).toBe(true);
  });

  it("pairs sessions week by week only when both workouts have the same shape", () => {
    const a = [{ id: "a1", week: 1, slot: 1 }, { id: "a2", week: 2, slot: 1 }];
    const b = [{ id: "b1", week: 1, slot: 2 }, { id: "b2", week: 2, slot: 2 }];
    expect(pairOccurrences(a, b)).toEqual({ sameShape: true, pairs: new Map([["b1", "a1"], ["b2", "a2"]]) });
    expect(pairOccurrences(a, [...b, { id: "b3", week: 3, slot: 1 }]).sameShape).toBe(false);
    // A workout counts its emptiest session against the target.
    expect(occurrenceCounts([{ phaseIndex: 1, label: "A", name: null, target: 3 }], [
      { phaseIndex: 1, label: "A", included: 3 }, { phaseIndex: 1, label: "A", included: 2 },
    ])[0].count).toBe(2);
  });
});

describe("topic 11: applying keeps the professional's rows and writes one dose per session", () => {
  it("applies into the same draft: whole schedule, one row per engine slot, doses per session, manual rows untouched and included everywhere", async () => {
    const d = await newDraft();
    const manual = await rx().add(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { exerciseId: "sys-001" }, { sets: "4", reps: "6", notes: "Minha nota" });
    if (manual.status !== "saved") throw new Error("add");
    const custom = await rx().add(d.planId, d.revisionId, { phaseIndex: 2, workoutLabel: "Full" }, { customName: "Mobilidade de quadril" }, { sets: "2", reps: "10" });
    if (custom.status !== "saved") throw new Error("add");
    const before = await rows(d);
    const out = await generated(d);
    const preview = await service().previewApply(d.planId, d.revisionId, out.proposalId);
    expect(preview!.manualWorkouts).toEqual(
      expect.arrayContaining([{ phaseIndex: 1, label: "A", rows: 1, preserved: 1 }, { phaseIndex: 2, label: "Full", rows: 1, preserved: 1 }]),
    );
    expect(preview!.counts.occurrences).toBe(9);
    const cvBefore = await contentVersion(d);
    const result = applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version)));
    expect(result).toMatchObject({ replayed: false, counts: { occurrences: 9, preserved: 2, replaced: 0 } });
    expect(await contentVersion(d)).toBeGreaterThan(cvBefore);

    const revision = await db.prepare("SELECT prescription_model AS m, state FROM plan_revisions WHERE id = ?1").bind(d.revisionId).first<{ m: string; state: string }>();
    expect(revision).toEqual({ m: "OCCURRENCE", state: "DRAFT" });
    // The professional's rows: same ids, same values, still theirs.
    const after = await rows(d);
    for (const row of before) expect(after.find((r) => r.id === row.id)).toEqual(row);
    // Engine rows: one per slot, SYSTEM, with the application, slot key and a materialised text.
    const engine = after.filter((r) => r.application_id === result.applicationId);
    expect(engine.length).toBe(result.counts!.rows);
    expect(engine.every((r) => r.origin === "SYSTEM" && r.source_slot_key && r.dose_text && r.exercise_id)).toBe(true);
    expect(new Set(engine.map((r) => `${r.phase_index}|${r.source_slot_key}`)).size).toBe(engine.length);
    // Every session of the schedule exists, with the schedule's dates.
    const occ = await sessions(d);
    const plan = await plans().findRevision(d.planId, d.revisionId);
    expect(occ.map((o) => [o.phase_index, o.week_index, o.slot_index, o.workout_label, o.week_start, o.planned_date])).toEqual(
      scheduleOccurrences(plan!.revision.schedule).map((o) => [o.phaseIndex, o.week, o.slot, o.label, o.weekStart, o.plannedDate]),
    );
    // Each engine item became its dose in its session; the stored text is the proposal's.
    const stored = await doses(d);
    const items = await all<{ id: string; dose_text: string }>("SELECT id, dose_text FROM proposal_items WHERE proposal_id = ?1 AND origin <> 'PRESERVED'", out.proposalId);
    expect(stored.filter((x) => x.trace_json !== null)).toHaveLength(items.length);
    const textOf = new Map(items.map((i) => [i.id, i.dose_text]));
    const fromItems = await all<{ source_proposal_item_id: string; dose_text: string }>(
      "SELECT source_proposal_item_id, dose_text FROM prescribed_exercise_occurrences WHERE revision_id = ?1 AND trace_json IS NOT NULL", d.revisionId);
    expect(fromItems.every((x) => textOf.get(x.source_proposal_item_id) === x.dose_text)).toBe(true);
    // Manual rows: included in every session of their workout with their own dose, nothing invented.
    for (const row of before) {
      const mine = stored.filter((x) => x.prescribed_exercise_id === row.id);
      const workoutSessions = occ.filter((o) => o.phase_index === row.phase_index && o.workout_label === row.workout_label);
      expect(mine).toHaveLength(workoutSessions.length);
      expect(mine.every((x) => x.included === 1 && x.sets === row.sets && x.reps === row.reps && x.origin === "PROFESSIONAL")).toBe(true);
    }
    expect(stored.filter((x) => x.prescribed_exercise_id === manual.id).every((x) => x.notes === "Minha nota")).toBe(true);
    // Every row has exactly one dose in every session of its workout (left out = included 0, only for this application's rows).
    for (const row of after) {
      const workoutSessions = occ.filter((o) => o.phase_index === row.phase_index && o.workout_label === row.workout_label);
      expect(stored.filter((x) => x.prescribed_exercise_id === row.id)).toHaveLength(workoutSessions.length);
    }
    expect(stored.filter((x) => x.included === 0).every((x) => engine.some((r) => r.id === x.prescribed_exercise_id))).toBe(true);
    // The proposal is closed as APPLIED, with its decision and event; nothing was approved.
    const proposal = await db.prepare("SELECT state, version FROM prescription_proposals WHERE id = ?1").bind(out.proposalId).first<{ state: string; version: number }>();
    expect(proposal).toEqual({ state: "APPLIED", version: out.version + 1 });
    expect(await count("SELECT COUNT(*) AS n FROM proposal_decisions WHERE proposal_id = ?1 AND action = 'APPLY'", out.proposalId)).toBe(1);
    expect(await events(d, "PROPOSAL_APPLIED")).toBe(1);
    const app = await db.prepare("SELECT conflict_mode AS m, infeasible_confirmed AS i, replaced_json AS r, base_content_version AS b FROM prescription_applications WHERE id = ?1")
      .bind(result.applicationId).first<{ m: string; i: number; r: string | null; b: number }>();
    expect(app).toEqual({ m: "PRESERVE", i: 0, r: null, b: cvBefore });
    expect(await events(d, "APPROVED")).toBe(0);
  });

  it("edits per session after the apply: one session, every session, left out, substituted from a week on; engine rows become 'edited by you'", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const engineRow = (await rows(d)).find((r) => r.phase_index === 1 && r.workout_label === "A" && r.origin === "SYSTEM")!;
    const page = await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1 });
    expect(page.map((o) => `${o.week}/${o.slot}/${o.label}`)).toEqual(["1/1/A", "1/2/B", "2/1/A", "2/2/B", "3/1/A", "3/2/B"]);
    const doseIn = (week: number) => page.find((o) => o.week === week && o.label === "A")!.items.find((i) => i.prescribedExerciseId === engineRow.id)!;

    // "Só nesta sessão": week 2 only; the other weeks keep the engine's dose.
    const week1Before = doseIn(1);
    let cv = await contentVersion(d);
    expect(await rx().updateOccurrence(d.planId, d.revisionId, [doseIn(2).id], { sets: "5", notes: "Semana pesada" })).toEqual({ status: "saved", count: 1 });
    expect(await contentVersion(d)).toBe(cv + 1);
    let now = await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1 });
    const w2 = now.find((o) => o.week === 2 && o.label === "A")!.items.find((i) => i.prescribedExerciseId === engineRow.id)!;
    expect(w2).toMatchObject({ sets: "5", notes: "Semana pesada", reps: doseIn(2).reps, doseJson: null, doseText: null, origin: "SYSTEM_EDITED" });
    expect(now.find((o) => o.week === 1 && o.label === "A")!.items.find((i) => i.prescribedExerciseId === engineRow.id)).toEqual(week1Before);
    // A structured dose given by the professional: validated, stored with its text.
    expect(await rx().updateOccurrence(d.planId, d.revisionId, [doseIn(3).id], {}, { metric: "REPS", sets: 3, reps: { min: 8, max: 10 }, loadKg: null, intensity: { kind: "RIR", range: { min: 1, max: 2 } }, restSeconds: 90, tempo: null, loadBasis: "NONE", method: null, loadInstruction: null } as never)).toMatchObject({ status: "saved" });
    // An invalid one is refused (the engine never proposes kg; a range upside down; a video per session).
    expect(await rx().updateOccurrence(d.planId, d.revisionId, [doseIn(3).id], {}, { metric: "REPS", sets: 3, reps: { min: 8, max: 10 }, loadKg: 50, intensity: null, restSeconds: null, tempo: null, loadBasis: "NONE", method: null, loadInstruction: null } as never)).toEqual({ status: "invalid" });
    expect(await rx().updateOccurrence(d.planId, d.revisionId, [doseIn(3).id], { rirMin: 4, rirMax: 2 })).toEqual({ status: "invalid" });
    expect(await rx().updateOccurrence(d.planId, d.revisionId, [doseIn(3).id], { videoUrl: "https://vimeo.com/1" })).toEqual({ status: "invalid" });
    // Left out of week 3, then back.
    cv = await contentVersion(d);
    expect(await rx().setIncluded(d.planId, d.revisionId, [doseIn(3).id], false)).toEqual({ status: "saved", count: 1 });
    expect(await rx().setIncluded(d.planId, d.revisionId, [doseIn(3).id], false)).toEqual({ status: "saved", count: 0 });
    expect(await contentVersion(d)).toBe(cv + 1);
    expect(await rx().setIncluded(d.planId, d.revisionId, [doseIn(3).id], true)).toEqual({ status: "saved", count: 1 });

    // "Todas as sessões": the base dose typed now replaces every session's dose of the row (progression replaced, said so).
    expect(await rx().update(d.planId, d.revisionId, engineRow.id, { sets: "3", reps: "12" })).toBe(true);
    now = await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1 });
    const everyA = now.filter((o) => o.label === "A").map((o) => o.items.find((i) => i.prescribedExerciseId === engineRow.id)!);
    expect(everyA.every((x) => x.sets === "3" && x.reps === "12" && x.doseJson === null && x.origin === "SYSTEM_EDITED")).toBe(true);
    const base = (await rows(d)).find((r) => r.id === engineRow.id)!;
    expect(base).toMatchObject({ sets: "3", reps: "12", dose_json: null, dose_text: null, origin: "SYSTEM_EDITED", application_id: engineRow.application_id });
    // "Só a base": the sessions keep their doses.
    expect(await rx().update(d.planId, d.revisionId, engineRow.id, { sets: "2" }, undefined, new Date(), { applyTo: "NONE" })).toBe(true);
    expect((await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1, week: 1 }))[0].items.find((i) => i.prescribedExerciseId === engineRow.id)!.sets).toBe("3");

    // Substitution from week 2 on: a new row that records what it substitutes, in weeks 2-3 only; the old row out of them.
    const aSessions = now.filter((o) => o.label === "A");
    const fromWeek2 = aSessions.filter((o) => o.week >= 2).map((o) => o.id);
    const sub = await rx().substituteInOccurrences(d.planId, d.revisionId, engineRow.id, "sys-010", fromWeek2);
    expect(sub.status).toBe("saved");
    const newRow = (await rows(d)).find((r) => r.id === (sub as { id: string }).id)!;
    expect(newRow).toMatchObject({ exercise_id: "sys-010", substitutes_prescribed_exercise_id: engineRow.id, origin: "PROFESSIONAL" });
    const after = await doses(d);
    const inc = (rowId: string) => after.filter((x) => x.prescribed_exercise_id === rowId && x.workout_label === "A" && x.phase_index === 1).map((x) => `${x.week_index}:${x.included}`);
    expect(inc(newRow.id)).toEqual(["1:0", "2:1", "3:1"]);
    expect(inc(engineRow.id)).toEqual(["1:1", "2:0", "3:0"]);
    // Refused: an exercise of another organization, a session of another workout, a session list that is too long.
    expect((await rx().substituteInOccurrences(d.planId, d.revisionId, engineRow.id, "ex-nope", fromWeek2)).status).toBe("not_found");
    expect((await rx().substituteInOccurrences(d.planId, d.revisionId, engineRow.id, "sys-011", [now.find((o) => o.label === "B")!.id])).status).toBe("invalid_target");
    // Removing an applied row removes its doses first, in the same batch.
    expect(await rx().remove(d.planId, d.revisionId, newRow.id)).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM prescribed_exercise_occurrences WHERE prescribed_exercise_id = ?1", newRow.id)).toBe(0);
  });

  it("a second generation over an edited OCCURRENCE draft keeps every edit, and its apply does not abort", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const row = (await rows(d)).find((r) => r.phase_index === 2 && r.origin === "SYSTEM")!;
    const week2 = (await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 2, week: 2 }))[0].items.find((i) => i.prescribedExerciseId === row.id)!;
    expect((await rx().updateOccurrence(d.planId, d.revisionId, [week2.id], { reps: "3", notes: "Pico de força" })).status).toBe("saved");
    const before = await doses(d);
    const rowsBefore = await rows(d);
    const out = await generated(d);
    const second = applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version)));
    // Every earlier row is preserved: same ids, and every dose per session already written is kept exactly.
    expect(second.counts!.preserved).toBe(rowsBefore.length);
    const after = await doses(d);
    for (const x of before) expect(after.find((y) => y.id === x.id)).toEqual(x);
    expect(after.find((y) => y.id === week2.id)).toMatchObject({ reps: "3", notes: "Pico de força" });
    for (const r of rowsBefore) expect((await rows(d)).find((y) => y.id === r.id)).toEqual(r);
  });

  it("replaces manual rows only with a confirmation naming exactly the listed workouts, and keeps a snapshot", async () => {
    const d = await newDraft();
    const manual = await rx().add(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "B" }, { exerciseId: "sys-002" }, { sets: "3", reps: "15" });
    if (manual.status !== "saved") throw new Error("add");
    const out = await generated(d);
    const p = (extra: Partial<ApplyPayload>) => service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version, extra));
    // Confirming a workout that has no rows, or none at all, is asked again with the real list.
    const wrong = await p({ conflictMode: "REPLACE_CONFIRMED", confirmedWorkouts: [{ phaseIndex: 1, label: "A" }] });
    expect(wrong).toMatchObject({ ok: false, reason: "confirmation_required", workouts: [{ phaseIndex: 1, label: "B", rows: 1, preserved: 1 }] });
    expect(reason(await p({ conflictMode: "REPLACE_CONFIRMED", confirmedWorkouts: [] }))).toBe("confirmation_required");
    // PRESERVE never takes a list (nothing is replaced silently).
    expect(reason(await p({ confirmedWorkouts: [{ phaseIndex: 1, label: "B" }] }))).toBe("invalid");
    expect(await count("SELECT COUNT(*) AS n FROM prescription_applications WHERE revision_id = ?1", d.revisionId)).toBe(0);
    const result = applied(await p({ conflictMode: "REPLACE_CONFIRMED", confirmedWorkouts: [{ phaseIndex: 1, label: "B" }] }));
    expect(result.counts).toMatchObject({ replaced: 1, preserved: 0 });
    expect((await rows(d)).some((r) => r.id === manual.id)).toBe(false);
    const app = await db.prepare("SELECT conflict_mode AS m, replaced_json AS r FROM prescription_applications WHERE id = ?1").bind(result.applicationId).first<{ m: string; r: string }>();
    expect(app!.m).toBe("REPLACE_CONFIRMED");
    const snapshot = JSON.parse(app!.r) as { rows: Array<{ id: string; sets: string; reps: string; occurrences: unknown[] }> };
    expect(snapshot.rows).toEqual([expect.objectContaining({ id: manual.id, sets: "3", reps: "15", occurrences: [] })]);
    expect(await count("SELECT COUNT(*) AS n FROM proposal_decisions WHERE proposal_id = ?1 AND action = 'APPLY' AND target_json LIKE '%REPLACE_CONFIRMED%'", out.proposalId)).toBe(1);
  });

  it("saving the structure of an OCCURRENCE draft: new weeks get every row, dates move, a session with exercises is never dropped silently", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const before = await sessions(d);
    const rowsA = (await rows(d)).filter((r) => r.phase_index === 1 && r.workout_label === "A");
    expect(await plans().saveDraft(d.planId, d.revisionId, withBaseWeeks(4))).toBe(true);
    const after = await sessions(d);
    expect(after).toHaveLength(11);
    // Sessions that stay keep their ids; the later phases moved one week.
    for (const o of before) expect(after.find((x) => x.id === o.id)).toBeDefined();
    const phase2 = (list: typeof before) => list.find((o) => o.phase_index === 2 && o.week_index === 1)!;
    expect(phase2(after).week_start).not.toBe(phase2(before).week_start);
    expect(phase2(after).week_start).toBe(scheduleOccurrences(buildPeriodization(withBaseWeeks(4))).find((o) => o.phaseIndex === 2 && o.week === 1)!.weekStart);
    // Week 4 of phase 1: every row of the workout, included, with its base dose.
    const week4A = after.find((o) => o.phase_index === 1 && o.week_index === 4 && o.workout_label === "A")!;
    const inWeek4 = (await doses(d)).filter((x) => x.occurrence_id === week4A.id);
    expect(inWeek4.map((x) => x.prescribed_exercise_id).sort()).toEqual(rowsA.map((r) => r.id).sort());
    expect(inWeek4.every((x) => x.included === 1)).toBe(true);
    // Shrinking back would drop sessions that include exercises: refused, nothing changes.
    await expect(plans().saveDraft(d.planId, d.revisionId, V2)).rejects.toThrow("OCCURRENCE_PRESCRIPTION_WOULD_BE_LOST");
    expect(await sessions(d)).toHaveLength(11);
    // Once the professional leaves them out of week 4, the shorter structure is saved and week 4 goes.
    const week4 = (await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1, week: 4 })).flatMap((o) => o.items.map((i) => i.id));
    expect((await rx().setIncluded(d.planId, d.revisionId, week4, false)).status).toBe("saved");
    expect(await plans().saveDraft(d.planId, d.revisionId, V2)).toBe(true);
    expect(await sessions(d)).toHaveLength(9);
    expect(await count("SELECT COUNT(*) AS n FROM prescribed_exercise_occurrences x WHERE x.revision_id = ?1 AND NOT EXISTS (SELECT 1 FROM plan_session_occurrences o WHERE o.id = x.occurrence_id)", d.revisionId)).toBe(0);
  });

  it("copies on an OCCURRENCE draft carry their doses session by session (or one dose when the shapes differ), keep origin and provenance", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const all1 = await rows(d);
    const engineB = all1.find((r) => r.phase_index === 1 && r.workout_label === "B" && r.origin === "SYSTEM")!;
    // Duplicate: same workout, same sessions, same doses, origin and dose of the source; where it came from.
    const dup = await rx().duplicate(d.planId, d.revisionId, engineB.id);
    if (dup.status !== "saved") throw new Error("duplicate");
    const copy = (await rows(d)).find((r) => r.id === dup.id)!;
    expect(copy).toMatchObject({ copied_from_id: engineB.id, origin: "SYSTEM", dose_json: engineB.dose_json, dose_text: engineB.dose_text, application_id: null });
    const dosesNow = await doses(d);
    const key = (x: DoseRow) => `${x.week_index}/${x.slot_index}:${x.included}:${x.sets}:${x.reps}:${x.dose_text}`;
    expect(dosesNow.filter((x) => x.prescribed_exercise_id === dup.id).map(key)).toEqual(dosesNow.filter((x) => x.prescribed_exercise_id === engineB.id).map(key));
    // Copy workout A of phase 1 into phase 3 (1 week × 1 session vs 3 weeks × 1 A): shapes differ, one dose for all, said so.
    for (const r of (await rows(d)).filter((x) => x.phase_index === 3)) expect(await rx().remove(d.planId, d.revisionId, r.id)).toBe(true);
    const copied = await rx().copyWorkout(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { phaseIndex: 3, workoutLabel: "Full" });
    expect(copied).toMatchObject({ status: "saved", notice: expect.stringContaining("semanas diferentes") });
    const phase3 = (await rows(d)).filter((r) => r.phase_index === 3);
    expect(phase3.every((r) => r.copied_from_id && all1.some((s) => s.id === r.copied_from_id && s.origin === r.origin))).toBe(true);
    const phase3Doses = (await doses(d)).filter((x) => x.phase_index === 3);
    expect(phase3Doses).toHaveLength(phase3.length);
    expect(phase3Doses.every((x) => x.included === 1)).toBe(true);
  });

  it("the overview counts an OCCURRENCE workout by its emptiest session", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const row = (await plans().overview()).find((r) => r.revisionId === d.revisionId)!;
    expect(row.below).toBe(0);
    const week1 = (await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 2, week: 1 }))[0];
    expect((await rx().setIncluded(d.planId, d.revisionId, [week1.items[0].id], false)).status).toBe("saved");
    expect((await plans().overview()).find((r) => r.revisionId === d.revisionId)!.below).toBe(1);
  });

  it("every editor mutation on an OCCURRENCE draft records its event and moves the content version", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const target = { phaseIndex: 1, workoutLabel: "A" };
    const page = () => rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1, week: 1 });
    const steps: Array<[string, () => Promise<unknown>]> = [
      ["add", () => rx().add(d.planId, d.revisionId, target, { customName: "Prancha" }, { sets: "3", reps: "30 s" })],
      ["update", async () => rx().update(d.planId, d.revisionId, (await rows(d)).find((r) => r.name === "Prancha")!.id, { sets: "4" })],
      ["reorder", async () => rx().reorder(d.planId, d.revisionId, target, (await rows(d)).filter((r) => r.phase_index === 1 && r.workout_label === "A").map((r) => r.id).reverse())],
      ["duplicate", async () => rx().duplicate(d.planId, d.revisionId, (await rows(d)).find((r) => r.name === "Prancha")!.id)],
      ["replaceExercise", async () => rx().replaceExercise(d.planId, d.revisionId, (await rows(d)).find((r) => r.phase_index === 1 && r.workout_label === "A" && r.origin === "SYSTEM")!.id, "sys-020")],
      ["updateOccurrence", async () => rx().updateOccurrence(d.planId, d.revisionId, [(await page())[0].items[0].id], { notes: "x" })],
      ["setIncluded", async () => rx().setIncluded(d.planId, d.revisionId, [(await page())[0].items[0].id], false)],
      ["substituteInOccurrences", async () => rx().substituteInOccurrences(d.planId, d.revisionId, (await page())[0].items[1].prescribedExerciseId, "sys-030", [(await page())[0].id])],
      ["remove", async () => rx().remove(d.planId, d.revisionId, (await rows(d)).filter((r) => r.name === "Prancha")[1].id)],
    ];
    for (const [name, step] of steps) {
      const cv = await contentVersion(d);
      const ev = await events(d, "PRESCRIPTION_EDITED");
      const out = await step();
      expect(out === true || (typeof out === "object" && out !== null && (out as { status: string }).status === "saved"), name).toBe(true);
      expect(await contentVersion(d), name).toBeGreaterThan(cv);
      expect(await events(d, "PRESCRIPTION_EDITED"), name).toBe(ev + 1);
    }
    // Nothing left inconsistent: every row has exactly one dose per session of its workout.
    const occ = await sessions(d);
    const dd = await doses(d);
    for (const r of await rows(d))
      expect(dd.filter((x) => x.prescribed_exercise_id === r.id), r.name).toHaveLength(occ.filter((o) => o.phase_index === r.phase_index && o.workout_label === r.workout_label).length);
  });
});

describe("topic 12: concurrency and idempotency of the apply", () => {
  it("the same key is one application (one after the other and at once); another payload with it is refused", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const payload = applyPayload(out.proposalId, out.version);
    const first = applied(await service().apply(d.planId, d.revisionId, payload));
    const again = applied(await service().apply(d.planId, d.revisionId, payload));
    expect(again).toMatchObject({ applicationId: first.applicationId, replayed: true });
    expect(reason(await service().apply(d.planId, d.revisionId, { ...payload, confirmInfeasible: true }))).toBe("key_reused");
    expect(await count("SELECT COUNT(*) AS n FROM prescription_applications WHERE revision_id = ?1", d.revisionId)).toBe(1);

    const other = await newDraft();
    const out2 = await generated(other);
    const same = applyPayload(out2.proposalId, out2.version);
    const both = await Promise.all([1, 2].map(() => service().apply(other.planId, other.revisionId, same)));
    expect(both.every((o) => o.ok)).toBe(true);
    expect(new Set(both.map((o) => (o.ok ? o.applicationId : "")))).toHaveProperty("size", 1);
    expect(both.filter((o) => o.ok && o.replayed)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM prescribed_exercises WHERE revision_id = ?1", other.revisionId)).toBe(first.counts!.rows);
  });

  it("two different keys at once: one application, the other told the proposal is closed; nothing is written twice", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const both = await Promise.all([1, 2].map(() => service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version))));
    expect(both.map(reason).sort()).toEqual(["closed", "ok"]);
    const winner = both.find((o) => o.ok) as Extract<ApplyServiceOutcome, { ok: true }>;
    expect(await count("SELECT COUNT(*) AS n FROM prescribed_exercises WHERE revision_id = ?1", d.revisionId)).toBe(winner.counts!.rows);
    expect(await count("SELECT COUNT(*) AS n FROM plan_session_occurrences WHERE revision_id = ?1", d.revisionId)).toBe(9);
  });

  it("refuses a stale proposal version, a draft edited after the generation (until rebased), and a base version from the client", async () => {
    const d = await newDraft();
    const out = await generated(d);
    expect(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version + 1))).toMatchObject({ ok: false, reason: "proposal_conflict", version: out.version });
    // The professional edits the draft after generating: the proposal no longer describes it.
    await rx().add(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { customName: "Aquecimento" }, { sets: "1", reps: "5 min" });
    const changed = await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version));
    expect(changed).toMatchObject({ ok: false, reason: "revision_changed" });
    expect(await count("SELECT COUNT(*) AS n FROM prescription_applications WHERE revision_id = ?1", d.revisionId)).toBe(0);
    // The client cannot send its own base version: the payload is strict, the base is the proposal's stored one.
    expect(reason(await service().apply(d.planId, d.revisionId, { ...applyPayload(out.proposalId, out.version), baseContentVersion: 99 } as never))).toBe("invalid");
    // Rebase brings the new row in as preserved; then the apply goes through and keeps it.
    const rebased = ok(await service().rebase(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), writeId: id("write"), expectedVersion: out.version }));
    const result = applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, rebased.version)));
    expect(result.counts!.preserved).toBe(1);
    expect((await rows(d)).find((r) => r.name === "Aquecimento")).toMatchObject({ origin: "PROFESSIONAL", application_id: null });
  });

  it("an incomplete proposal is refused until continued; an INFEASIBLE one needs the explicit confirmation, which is recorded", async () => {
    const d = await newDraft();
    const small = service("tech-a", "org-a", 6 * 64);
    const out = await generated(d, ANSWERS, small);
    expect(out.complete).toBe(false);
    expect(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version))).toMatchObject({ ok: false, reason: "incomplete", phasesMissing: [2, 3] });
    const next = ok(await small.continue(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), writeId: id("write"), expectedVersion: out.version }));
    // The engine's result marked INFEASIBLE (an ERROR issue); written here directly so the test does not depend on which rule fires.
    await run("UPDATE prescription_proposals SET status = 'INFEASIBLE', validation = 'BLOCKED' WHERE id = ?1", out.proposalId);
    expect(await service().previewApply(d.planId, d.revisionId, out.proposalId)).toMatchObject({ infeasible: true, phasesMissing: [] });
    expect(reason(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, next.version)))).toBe("infeasible_confirmation_required");
    expect(await count("SELECT COUNT(*) AS n FROM prescribed_exercises WHERE revision_id = ?1", d.revisionId)).toBe(0);
    const result = applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, next.version, { confirmInfeasible: true })));
    expect(await count("SELECT infeasible_confirmed AS n FROM prescription_applications WHERE id = ?1", result.applicationId)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM proposal_decisions WHERE proposal_id = ?1 AND action = 'APPLY' AND target_json LIKE '%\"confirmInfeasible\":true%'", out.proposalId)).toBe(1);
  });

  it("an exercise archived after the generation stops the apply (nothing written) until that part is regenerated", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const used = await all<{ e: string }>("SELECT DISTINCT exercise_id AS e FROM proposal_items WHERE proposal_id = ?1 AND origin = 'ENGINE'", out.proposalId);
    await run("UPDATE exercises SET archived_at = 'x' WHERE id = ?1", used[0].e);
    const refused = await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version));
    expect(refused).toMatchObject({ ok: false, reason: "catalog_changed", exerciseIds: [used[0].e] });
    expect(await count("SELECT COUNT(*) AS n FROM prescription_applications WHERE revision_id = ?1", d.revisionId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM plan_session_occurrences WHERE revision_id = ?1", d.revisionId)).toBe(0);
    await run("UPDATE exercises SET archived_at = NULL WHERE id = ?1", used[0].e);
  });

  it("after the apply the proposal is closed to every engine operation", async () => {
    const d = await newDraft();
    const { proposalId } = await generatedAndApplied(d);
    const cas = { idempotencyKey: id("key"), writeId: id("write"), expectedVersion: 2 };
    expect(reason(await service().regenerate(d.planId, d.revisionId, { proposalId, ...cas, scope: { kind: "PHASE", phaseIndex: 1 } }))).toBe("closed");
    expect(reason(await service().discard(d.planId, d.revisionId, { proposalId, writeId: id("write"), expectedVersion: 2 }))).toBe("closed");
    expect(reason(await service().apply(d.planId, d.revisionId, applyPayload(proposalId, 2)))).toBe("closed");
  });
});

describe("topic 14: approved and delivered revisions", () => {
  it("apply → edit → ready → approve → deliver through the existing flow; the delivered revision is frozen, its copy is a new draft", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const row = (await rows(d)).find((r) => r.origin === "SYSTEM")!;
    expect(await rx().update(d.planId, d.revisionId, row.id, { notes: "Revisado" })).toBe(true);
    // The apply approved nothing: the revision is a DRAFT until the professional acts.
    expect(await events(d, "APPROVED")).toBe(0);
    // Approval and delivery stay the professional's acts with an active assignment: others are refused.
    expect(await plans().markReady(d.planId, d.revisionId)).toBe(true);
    for (const who of ["commercial-a", "tech-a2", "client-1"])
      expect((await plans(who).approve(d.planId, d.revisionId, { screeningNotRecorded: true })).status, who).toBe("not_found");
    expect((await plans().approve(d.planId, d.revisionId, { screeningNotRecorded: true })).status).toBe("approved");
    expect((await plans("commercial-a").deliver(d.planId, d.revisionId)).status).toBe("not_found");
    expect((await plans().deliver(d.planId, d.revisionId)).status).toBe("delivered");
    const frozenRows = await rows(d);
    const frozenDoses = await doses(d);
    const frozenSessions = await sessions(d);
    const occ = await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1 });
    expect(occ.length).toBeGreaterThan(0);
    // Every editor path is refused on the delivered revision (not found for it), and direct writes are refused by the database.
    expect(await rx().update(d.planId, d.revisionId, row.id, { sets: "9" })).toBe(false);
    expect(await rx().remove(d.planId, d.revisionId, row.id)).toBe(false);
    expect(await rx().updateOccurrence(d.planId, d.revisionId, [occ[0].items[0].id], { sets: "9" })).toEqual({ status: "not_found" });
    expect(await rx().setIncluded(d.planId, d.revisionId, [occ[0].items[0].id], false)).toEqual({ status: "not_found" });
    expect((await rx().substituteInOccurrences(d.planId, d.revisionId, row.id, "sys-010", [occ[0].id])).status).toBe("not_found");
    expect((await rx().add(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { customName: "X" })).status).toBe("not_found");
    await expect(plans().saveDraft(d.planId, d.revisionId, withBaseWeeks(4))).resolves.toBe(false);
    for (const sql of [
      "UPDATE prescribed_exercise_occurrences SET sets = '9' WHERE revision_id = ?1",
      "DELETE FROM prescribed_exercise_occurrences WHERE revision_id = ?1",
      "UPDATE plan_session_occurrences SET planned_date = '2030-01-01' WHERE revision_id = ?1",
      "UPDATE plan_revisions SET content_version = content_version + 1 WHERE id = ?1",
    ])
      await expect(run(sql, d.revisionId), sql).rejects.toThrow("PLAN_REVISION_FROZEN");
    // No new proposal on it either.
    expect(reason(await service().generate(d.planId, d.revisionId, { idempotencyKey: id("gen"), baseContentVersion: await contentVersion(d), answers: ANSWERS }))).toBe("not_open");
    // A new revision copies the delivered one (model, rows, sessions, doses, provenance); editing the copy leaves it untouched.
    const copy = await plans().newRevisionFrom(d.planId, d.revisionId);
    if (copy.status !== "created") throw new Error("copy");
    const next = { planId: d.planId, revisionId: copy.revisionId };
    expect((await db.prepare("SELECT prescription_model AS m FROM plan_revisions WHERE id = ?1").bind(next.revisionId).first<{ m: string }>())!.m).toBe("OCCURRENCE");
    expect((await rows(next)).length).toBe(frozenRows.length);
    expect((await doses(next)).length).toBe(frozenDoses.length);
    const copied = (await rows(next)).find((r) => r.copied_from_id === row.id)!;
    expect(copied.application_id).toBe(row.application_id);
    const nextOcc = await rx().occurrences(next.planId, next.revisionId, { phaseIndex: 1, week: 1 });
    expect((await rx().updateOccurrence(next.planId, next.revisionId, [nextOcc[0].items[0].id], { sets: "9" })).status).toBe("saved");
    expect(await rx().remove(next.planId, next.revisionId, copied.id)).toBe(true);
    expect(await rows(d)).toEqual(frozenRows);
    expect(await doses(d)).toEqual(frozenDoses);
    expect(await sessions(d)).toEqual(frozenSessions);
  });

  it("marking a draft ready closes an open proposal (superseded), which can no longer be applied", async () => {
    const d = await newDraft();
    const out = await generated(d);
    expect(await plans().markReady(d.planId, d.revisionId)).toBe(true);
    expect(reason(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version)))).toBe("closed");
    expect(await count("SELECT COUNT(*) AS n FROM prescription_applications WHERE revision_id = ?1", d.revisionId)).toBe(0);
  });

  it("outsiders never apply nor edit per session (not found), and nothing changes", async () => {
    const d = await newDraft();
    const out = await generated(d);
    for (const [who, org] of [["tech-b", "org-b"], ["tech-a2", "org-a"], ["commercial-a", "org-a"], ["client-1", "org-a"], ["tech-b", "org-a"]] as const) {
      expect(reason(await service(who, org).apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version))), `${who}/${org}`).toBe("not_found");
      expect(await service(who, org).previewApply(d.planId, d.revisionId, out.proposalId), `${who}/${org}`).toBeNull();
    }
    expect(await count("SELECT COUNT(*) AS n FROM prescription_applications WHERE revision_id = ?1", d.revisionId)).toBe(0);
    applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version)));
    const occ = await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1 });
    for (const [who, org] of [["tech-b", "org-b"], ["tech-a2", "org-a"], ["commercial-a", "org-a"]] as const) {
      expect(await rx(who, org).occurrences(d.planId, d.revisionId, { phaseIndex: 1 }), who).toEqual([]);
      expect(await rx(who, org).updateOccurrence(d.planId, d.revisionId, [occ[0].items[0].id], { sets: "9" }), who).toEqual({ status: "not_found" });
      expect(await rx(who, org).setIncluded(d.planId, d.revisionId, [occ[0].items[0].id], false), who).toEqual({ status: "not_found" });
    }
    expect((await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1 }))).toEqual(occ);
  });

  it("nothing in the automatic prescription path approves, delivers or imports the approval actions", () => {
    const files = [
      "src/db/prescription-proposals.ts",
      "src/modules/prescricao/automatica/service.ts",
      "src/modules/prescricao/automatica/actions.ts",
      "src/modules/prescricao/occurrences.ts",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/\.approve\(|\.deliver\(|planos\/actions|state\s*=\s*'(APPROVED|DELIVERED)'/);
    }
  });
});

describe("topic 16: legacy data stays as it was", () => {
  it("a TEMPLATE draft is written exactly as before: no sessions, no per-session doses, no structured dose, model unchanged", async () => {
    const d = await newDraft();
    const target = { phaseIndex: 1, workoutLabel: "A" };
    const a = await rx().add(d.planId, d.revisionId, target, { exerciseId: "sys-001" }, { sets: "3", reps: "10" });
    if (a.status !== "saved") throw new Error("add");
    expect(await rx().update(d.planId, d.revisionId, a.id, { sets: "4" })).toBe(true);
    const dup = await rx().duplicate(d.planId, d.revisionId, a.id);
    expect(dup.status).toBe("saved");
    expect(await rx().replaceExercise(d.planId, d.revisionId, a.id, "sys-002")).toBe(true);
    expect(await rx().copyWorkout(d.planId, d.revisionId, target, { phaseIndex: 1, workoutLabel: "B" })).toEqual({ status: "saved", count: 2 });
    expect(await rx().copyPhase(d.planId, d.revisionId, 1, 2)).toEqual({ status: "no_common_workouts" });
    expect(await rx().remove(d.planId, d.revisionId, (dup as { id: string }).id)).toBe(true);
    expect(await plans().saveDraft(d.planId, d.revisionId, withBaseWeeks(4))).toBe(true);
    const list = await rows(d);
    expect(list.every((r) => r.origin === "PROFESSIONAL" && r.dose_json === null && r.dose_text === null && r.application_id === null)).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM plan_session_occurrences WHERE revision_id = ?1", d.revisionId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM prescribed_exercise_occurrences WHERE revision_id = ?1", d.revisionId)).toBe(0);
    expect((await db.prepare("SELECT prescription_model AS m FROM plan_revisions WHERE id = ?1").bind(d.revisionId).first<{ m: string }>())!.m).toBe("TEMPLATE");
    expect(await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1 })).toEqual([]);
    expect((await plans().overview()).find((r) => r.revisionId === d.revisionId)).toMatchObject({ exercises: 3 });
  });

  it("a plan of the earlier structure (v1) with rows typed by hand is applied: the rows stay, sessions come from the v1 schedule", async () => {
    const v1 = { startDate: "2026-11-02", phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: "Full Body", exercisesPerSession: 3 })) };
    const d = await newDraft(v1);
    const typed = await rx().add(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "Full Body" }, { customName: "Caminhada" }, { sets: "1", reps: "20 min" });
    if (typed.status !== "saved") throw new Error("add");
    const before = await rows(d);
    const out = await generated(d, { ...ANSWERS });
    const result = applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version)));
    expect(result.counts!.occurrences).toBe(36);
    expect(await sessions(d)).toHaveLength(36);
    expect((await sessions(d)).every((o) => o.planned_date === null)).toBe(true);
    expect((await rows(d)).find((r) => r.id === typed.id)).toEqual(before[0]);
    expect((await doses(d)).filter((x) => x.prescribed_exercise_id === typed.id)).toHaveLength(12);
  });
});

describe("review of S7: what the professional wrote per session survives the editor and the apply", () => {
  const altFor = async (proposalId: string, phaseIndex: number, label: string) => {
    const items = await all<{ exercise_id: string | null; alternatives_json: string }>(
      `SELECT i.exercise_id, i.alternatives_json FROM proposal_items i JOIN proposal_occurrences o ON o.id = i.proposal_occurrence_id
       WHERE i.proposal_id = ?1 AND o.phase_index = ?2 AND o.workout_label = ?3`,
      proposalId, phaseIndex, label,
    );
    const used = new Set(items.map((i) => i.exercise_id));
    return items.flatMap((i) => JSON.parse(i.alternatives_json) as string[]).find((x) => !used.has(x))!;
  };
  const preservedKey = async (proposalId: string, rowId: string) =>
    (await db.prepare("SELECT slot_key AS k FROM proposal_items WHERE proposal_id = ?1 AND origin = 'PRESERVED' AND existing_prescribed_exercise_id = ?2 LIMIT 1")
      .bind(proposalId, rowId).first<{ k: string }>())!.k;
  const inclusion = async (d: Draft, rowId: string) =>
    (await doses(d)).filter((x) => x.prescribed_exercise_id === rowId).map((x) => `${x.week_index}:${x.included}`);

  it("a change of notes, video or name on the base row never resets the doses per session", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const row = (await rows(d)).find((r) => r.phase_index === 1 && r.workout_label === "A" && r.origin === "SYSTEM")!;
    const week3 = (await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1, week: 3 })).find((o) => o.label === "A")!.items.find((i) => i.prescribedExerciseId === row.id)!;
    expect((await rx().updateOccurrence(d.planId, d.revisionId, [week3.id], { sets: "5", reps: "6" })).status).toBe("saved");
    const before = (await doses(d)).filter((x) => x.prescribed_exercise_id === row.id);
    expect(before.some((x) => x.dose_text !== null)).toBe(true);
    // Notes only: every session takes the new notes; doses, structured doses and their texts stay.
    expect(await rx().update(d.planId, d.revisionId, row.id, { notes: "Controle a descida" })).toBe(true);
    const after = (await doses(d)).filter((x) => x.prescribed_exercise_id === row.id);
    for (const x of before) {
      const y = after.find((z) => z.id === x.id)!;
      expect(y).toMatchObject({ sets: x.sets, reps: x.reps, dose_json: x.dose_json, dose_text: x.dose_text, included: x.included, notes: "Controle a descida" });
    }
    expect(after.find((x) => x.id === week3.id)).toMatchObject({ sets: "5", reps: "6" });
    // The base row keeps its structured dose too (only the notes changed).
    expect((await rows(d)).find((r) => r.id === row.id)).toMatchObject({ dose_json: row.dose_json, dose_text: row.dose_text });
    // A video only: nothing per session changes at all.
    const snap = await doses(d);
    expect(await rx().update(d.planId, d.revisionId, row.id, { videoUrl: "https://vimeo.com/123456" })).toBe(true);
    expect(await doses(d)).toEqual(snap);
  });

  it("a notes-only edit per session keeps the stored dose text; a dose field clears it", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const row = (await rows(d)).find((r) => r.phase_index === 1 && r.workout_label === "B" && r.origin === "SYSTEM")!;
    const w1 = (await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1, week: 1 })).find((o) => o.label === "B")!.items.find((i) => i.prescribedExerciseId === row.id)!;
    expect(w1.doseText).not.toBeNull();
    expect((await rx().updateOccurrence(d.planId, d.revisionId, [w1.id], { notes: "Pegada neutra" })).status).toBe("saved");
    const kept = (await doses(d)).find((x) => x.id === w1.id)!;
    expect(kept).toMatchObject({ notes: "Pegada neutra", dose_text: w1.doseText, dose_json: w1.doseJson });
    expect((await rx().updateOccurrence(d.planId, d.revisionId, [w1.id], { reps: "10" })).status).toBe("saved");
    expect((await doses(d)).find((x) => x.id === w1.id)).toMatchObject({ reps: "10", dose_text: null, dose_json: null, notes: "Pegada neutra" });
  });

  it("a row of the professional substituted in the proposal from a week on is applied as reviewed (TEMPLATE and OCCURRENCE drafts)", async () => {
    const d = await newDraft();
    const manual = await rx().add(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { exerciseId: "sys-001" }, { sets: "4", reps: "6" });
    if (manual.status !== "saved") throw new Error("add");
    let out = await generated(d);
    let chosen = await altFor(out.proposalId, 1, "A");
    let sub = ok(await service().substitute(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), writeId: id("write"), expectedVersion: out.version,
      newExerciseId: chosen, target: { phaseIndex: 1, slotKey: await preservedKey(out.proposalId, manual.id), applies: { kind: "FROM_WEEK", week: 2 } } }));
    applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, sub.version)));
    expect(await inclusion(d, manual.id)).toEqual(["1:1", "2:0", "3:0"]);
    let substitute = (await rows(d)).find((r) => r.phase_index === 1 && r.workout_label === "A" && r.exercise_id === chosen)!;
    expect(substitute.substitutes_prescribed_exercise_id).toBe(manual.id);
    expect(await inclusion(d, substitute.id)).toEqual(["1:0", "2:1", "3:1"]);
    // The manual row keeps its own dose in the sessions it left (only "included" changed).
    expect((await doses(d)).filter((x) => x.prescribed_exercise_id === manual.id).every((x) => x.sets === "4" && x.reps === "6")).toBe(true);

    // Again over the OCCURRENCE draft: the engine row of workout B (now a row already in the draft, with doses per session) is
    // substituted from week 3 on; the apply leaves it out of week 3 even though a dose was already written there.
    const rowB = (await rows(d)).find((r) => r.phase_index === 1 && r.workout_label === "B" && r.origin === "SYSTEM")!;
    out = await generated(d);
    chosen = await altFor(out.proposalId, 1, "B");
    sub = ok(await service().substitute(d.planId, d.revisionId, { proposalId: out.proposalId, idempotencyKey: id("key"), writeId: id("write"), expectedVersion: out.version,
      newExerciseId: chosen, target: { phaseIndex: 1, slotKey: await preservedKey(out.proposalId, rowB.id), applies: { kind: "FROM_WEEK", week: 3 } } }));
    applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, sub.version)));
    expect(await inclusion(d, rowB.id)).toEqual(["1:1", "2:1", "3:0"]);
    substitute = (await rows(d)).find((r) => r.phase_index === 1 && r.workout_label === "B" && r.exercise_id === chosen && r.substitutes_prescribed_exercise_id === rowB.id)!;
    expect(await inclusion(d, substitute.id)).toEqual(["1:0", "2:0", "3:1"]);
    // Rows the second proposal did not touch keep exactly what they had.
    expect(await inclusion(d, manual.id)).toEqual(["1:1", "2:0", "3:0"]);
  });

  it("new weeks follow the closest earlier week: a substitution from a week on stays one exercise, not both", async () => {
    const d = await newDraft();
    await generatedAndApplied(d);
    const row = (await rows(d)).find((r) => r.phase_index === 1 && r.workout_label === "A" && r.origin === "SYSTEM")!;
    const fromWeek2 = (await sessions(d)).filter((o) => o.phase_index === 1 && o.workout_label === "A" && o.week_index >= 2).map((o) => o.id);
    const sub = await rx().substituteInOccurrences(d.planId, d.revisionId, row.id, "sys-010", fromWeek2);
    if (sub.status !== "saved") throw new Error("substitute");
    expect(await plans().saveDraft(d.planId, d.revisionId, withBaseWeeks(4))).toBe(true);
    expect(await inclusion(d, row.id)).toEqual(["1:1", "2:0", "3:0", "4:0"]);
    expect(await inclusion(d, sub.id)).toEqual(["1:0", "2:1", "3:1", "4:1"]);
    // Other rows of the workout stay included in the new week.
    const others = (await rows(d)).filter((r) => r.phase_index === 1 && r.workout_label === "A" && r.id !== row.id && r.id !== sub.id);
    for (const r of others) expect((await inclusion(d, r.id)).at(-1)).toBe("4:1");
  });

  it("a copy that races an apply (model read as TEMPLATE, OCCURRENCE when written) still gets a dose in every session", async () => {
    const d = await newDraft();
    const manual = await rx().add(d.planId, d.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { customName: "Prancha" }, { sets: "3", reps: "30 s" });
    if (manual.status !== "saved") throw new Error("add");
    await generatedAndApplied(d);
    // The model read before the batch answers TEMPLATE, as if the apply landed between that read and the copy's batch.
    const stale = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "prepare") return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes("r.prescription_model AS m")) return statement;
          return { bind: () => ({ first: async () => ({ m: "TEMPLATE" }) }) };
        };
      },
    }) as D1Database;
    const dup = await prescriptionFor(stale, scope("tech-a")).duplicate(d.planId, d.revisionId, manual.id);
    if (dup.status !== "saved") throw new Error("duplicate");
    const workoutSessions = (await sessions(d)).filter((o) => o.phase_index === 1 && o.workout_label === "A");
    const copied = (await doses(d)).filter((x) => x.prescribed_exercise_id === dup.id);
    expect(copied).toHaveLength(workoutSessions.length);
    expect(copied.every((x) => x.included === 1 && x.sets === "3" && x.reps === "30 s")).toBe(true);
  });

  it("a structure save that races an apply (model read as TEMPLATE, OCCURRENCE when written) is refused, then syncs the sessions when saved again", async () => {
    const d = await newDraft();
    const out = await generated(d);
    let raced = false;
    // The apply lands between saveDraft's read of the model and its batch, as with two tabs or a double submit.
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "batch") return Reflect.get(target, prop, receiver);
        return async (statements: Parameters<D1Database["batch"]>[0]) => {
          if (!raced) {
            raced = true;
            applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version)));
          }
          return target.batch(statements);
        };
      },
    }) as D1Database;
    await expect(plansFor(racing, scope("tech-a")).saveDraft(d.planId, d.revisionId, withBaseWeeks(4))).rejects.toThrow("DRAFT_MODEL_CHANGED");
    expect(raced).toBe(true);
    const revision = await db.prepare("SELECT prescription_model AS m, total_weeks AS w FROM plan_revisions WHERE id = ?1").bind(d.revisionId).first<{ m: string; w: number }>();
    expect(revision).toEqual({ m: "OCCURRENCE", w: 6 });
    // Saved again on the fresh read: the new week of phase 1 gets its sessions.
    expect(await plans().saveDraft(d.planId, d.revisionId, withBaseWeeks(4))).toBe(true);
    const phase1 = (await sessions(d)).filter((o) => o.phase_index === 1);
    expect(phase1).toHaveLength(8);
    expect(Math.max(...phase1.map((o) => o.week_index))).toBe(4);
  });

  it("a revoked assignment or membership, or a disabled user, can neither apply nor edit per session", async () => {
    const d = await newDraft();
    const out = await generated(d);
    const cuts: Array<[string, string, string]> = [
      ["UPDATE care_assignments SET revoked_at = '2026-11-20T00:00:00Z' WHERE student_id = 'st-1' AND professional_id = 'pro-a'",
        "UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1' AND professional_id = 'pro-a'", "assignment"],
      ["UPDATE memberships SET revoked_at = '2026-11-20T00:00:00Z' WHERE organization_id = 'org-a' AND user_id = 'tech-a'",
        "UPDATE memberships SET revoked_at = NULL WHERE organization_id = 'org-a' AND user_id = 'tech-a'", "membership"],
      ["UPDATE users SET disabled_at = '2026-11-20T00:00:00Z' WHERE id = 'tech-a'", "UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'", "user"],
    ];
    for (const [cut, restore, label] of cuts) {
      await run(cut);
      try {
        expect(reason(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version))), label).toBe("not_found");
      } finally {
        await run(restore);
      }
    }
    expect(await count("SELECT COUNT(*) AS n FROM prescription_applications WHERE revision_id = ?1", d.revisionId)).toBe(0);
    applied(await service().apply(d.planId, d.revisionId, applyPayload(out.proposalId, out.version)));
    const item = (await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1, week: 1 }))[0].items[0];
    const before = await doses(d);
    for (const [cut, restore, label] of cuts) {
      await run(cut);
      try {
        expect(await rx().occurrences(d.planId, d.revisionId, { phaseIndex: 1 }), label).toEqual([]);
        expect(await rx().updateOccurrence(d.planId, d.revisionId, [item.id], { sets: "9" }), label).toEqual({ status: "not_found" });
        expect(await rx().setIncluded(d.planId, d.revisionId, [item.id], false), label).toEqual({ status: "not_found" });
        expect(await rx().update(d.planId, d.revisionId, item.prescribedExerciseId, { notes: "x" }), label).toBe(false);
        expect((await plans().overview()).find((r) => r.revisionId === d.revisionId), label).toBeUndefined();
      } finally {
        await run(restore);
      }
    }
    expect(await doses(d)).toEqual(before);
  });
});
