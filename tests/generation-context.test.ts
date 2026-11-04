import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentsFor } from "@/db/assessments";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { executionFor, studentSessionsFor } from "@/db/workout-sessions";
import { loadGenerationContext, type LoadOutcome } from "@/modules/prescricao/automatica/context";
import { buildEngineInput } from "@/modules/prescricao/automatica/build-input";
import { parseGenerationAnswers, type GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import type { GenerationContext } from "@/modules/prescricao/automatica/facts";
import { generate, type EngineResult } from "@/modules/prescricao/motor";
import { legacyAssessments } from "./helpers/legacy-assessments";
import { ALL_NO } from "./helpers/screening";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Motor S5 on a real local D1 with every migration (0001–0045, triggers and the inferred library seed included): the input adapter
// reads the student's real records through the gated repositories. Topic 6 (triagem com alertas) and topic 7 (dados ausentes) with
// tenant gating: identities are rows, as the server derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const day = (n: number, hour = 15) => new Date(`2026-11-${String(n).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);
const NOW = day(20);
const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
const PARQ = ["heart_condition", "chest_pain_activity", "chest_pain_month", "dizziness", "bone_joint", "blood_pressure_medication", "other_reason"] as const;

const V2 = {
  schemaVersion: 2, startDate: "2026-11-23",
  phases: [
    { name: "Base", weeks: 2, sessionsPerWeek: 2, workouts: [{ label: "A", exerciseTarget: 3 }, { label: "B", exerciseTarget: null }], trainingDays: [0, 3] },
    { name: "Força", weeks: 1, sessionsPerWeek: 1, workouts: [{ label: "Full", exerciseTarget: 2, focus: { minutes: 40, note: "SEGREDO-FOCO" } }] },
  ],
};
const ANSWERS: GenerationAnswersInput = {
  stimulusByPhase: [{ phaseIndex: 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" }, { phaseIndex: 2, value: "STRENGTH", basis: "PROFESSIONAL" }],
  exerciseCountByWorkout: [{ phaseIndex: 1, label: "B", count: 3 }],
  equipmentCodes: ["BARBELL", "RACK", "MACHINE", "DUMBBELL", "BENCH", "CABLE", "PULL_UP_BAR"],
};
const okContext = (outcome: LoadOutcome): GenerationContext => {
  if (outcome.status !== "ok") throw new Error(outcome.status);
  return outcome.context;
};
const built = (ctx: GenerationContext, answers: GenerationAnswersInput = ANSWERS) => {
  const out = buildEngineInput(ctx, parseGenerationAnswers(answers));
  if (!out.ok) throw new Error(out.code);
  return out;
};
const picked = (r: EngineResult) => r.occurrences.map((o) => `${o.phaseIndex}/${o.week}/${o.slot}:${o.items.map((i) => i.exerciseId ?? i.exerciseName).join(",")}`);

/** A recorded Avaliação Física: PAR-Q answers, a decision when there is a "Sim", and the modules given. */
async function recordedAssessment(student: string, yes: string[], decision: string | null, modules: Record<string, unknown> = {}, when = day(3)) {
  const a = assessmentsFor(db, scope("tech-a"));
  const started = await a.startDraft(student, when);
  if (started.status !== "started") throw new Error(started.status);
  let revision = (await a.sections(started.id))!.revision;
  const payloads = {
    screening: {
      anamnesis: { injuries: { answer: "yes", details: "SEGREDO-ANAMNESE" }, smoking: { answer: "no", details: "" } },
      parq: { answers: Object.fromEntries(PARQ.map((c) => [c, yes.includes(c) ? "yes" : "no"])), professionalReview: { decision, notes: decision ? "SEGREDO-NOTA" : "" } },
    },
    ...modules,
  };
  for (const [module, payload] of Object.entries(payloads)) {
    const saved = await a.saveSection(started.id, { module: module as never, status: "IN_PROGRESS", payload, revision });
    if (saved.status !== "saved") throw new Error(`${module}: ${saved.status}`);
    revision = saved.revision;
  }
  const final = await a.finalize(started.id, revision, when);
  if (final.status !== "recorded") throw new Error(JSON.stringify(final));
  return started.id;
}

let draft = { planId: "", revisionId: "" };
let emptyDraft = { planId: "", revisionId: "" };
let assessmentId = "";

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "generation-context-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["tech-a", "tech-a2", "commercial-a", "tech-off", "tech-rev", "tech-ra", "tech-b", "client-1"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-a','tech-a2','TECHNICAL'),
       ('org-a','commercial-a','COMMERCIAL'),('org-a','tech-off','TECHNICAL'),('org-a','tech-rev','TECHNICAL'),('org-a','tech-ra','TECHNICAL'),
       ('org-b','tech-b','TECHNICAL')`,
    ),
    db.prepare(
      `INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-a2','org-a','tech-a2','Pro A2'),
       ('pro-off','org-a','tech-off','Off'),('pro-rev','org-a','tech-rev','Rev'),('pro-ra','org-a','tech-ra','Ra'),('pro-b','org-b','tech-b','Pro B')`,
    ),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-2','org-a','Two'),('st-3','org-a','Three'),('st-b','org-b','B')"),
    db.prepare(
      `INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a'),('org-a','st-3','pro-a'),
       ('org-a','st-1','pro-off'),('org-a','st-1','pro-rev'),('org-a','st-1','pro-ra'),('org-b','st-b','pro-b')`,
    ),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
    db.prepare(
      `INSERT INTO student_profiles(student_id,organization_id,birth_date,gender,height_cm,weight_kg,goal,level,days_per_week,session_minutes,equipment,injuries,updated_by_user_id)
       VALUES ('st-1','org-a','1999-03-04','Masculino',171,69.1,'Hipertrofia','Intermediário',3,60,'SEGREDO-EQUIP halteres','SEGREDO-LESAO','tech-a')`,
    ),
  ]);

  // st-1: a recorded Avaliação Física with a PAR-Q "Sim", the decision "Precisa de liberação médica", anamnesis, posture, tests,
  // skinfolds (results with their method) and free-text conclusions.
  assessmentId = await recordedAssessment("st-1", ["dizziness"], "medical_clearance", {
    composition: {
      weightKg: 69.1, heightCm: 171, protocol: "jackson_pollock_7", equation: "male",
      skinfolds: { chest: [12], midaxillary: [9], triceps: [24], subscapular: [11], abdominal: [16], suprailiac: [15], thigh: [35], calf_medial: [17] },
    },
    posture: { findings: { lateral_shoulders: ["protracted"], lateral_hip: ["aligned"] }, notes: { lateral: "SEGREDO-POSTURA", posterior: "", anterior: "" } },
    tests: { abdominal: { exercise: "SEGREDO-TESTE", repetitions: 30 } },
    conclusion: { limitations: "SEGREDO-CONCLUSAO" },
  });

  // st-1: a delivered plan with two library exercises and one typed by name, logged by the student.
  const plans = plansFor(db, scope("tech-a"));
  const rx = prescriptionFor(db, scope("tech-a"));
  const old = (await plans.create("st-1", {
    title: "Plano entregue",
    input: { startDate: "2026-11-02", phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: "Full Body", exercisesPerSession: 3 })) },
  }))!;
  for (const source of [{ exerciseId: "sys-001" }, { exerciseId: "sys-002" }, { customName: "SEGREDO-CUSTOM" }])
    await rx.add(old.planId, old.revisionId, { phaseIndex: 1, workoutLabel: "Full Body" }, source, { sets: "3", reps: "10" });
  await rx.copyPhase(old.planId, old.revisionId, 1, 2);
  await rx.copyPhase(old.planId, old.revisionId, 1, 3);
  expect(await plans.markReady(old.planId, old.revisionId)).toBe(true);
  expect(await plans.approve(old.planId, old.revisionId, { screeningNotRecorded: false }, day(4))).toMatchObject({ status: "approved" });
  expect(await plans.deliver(old.planId, old.revisionId, day(4, 16))).toMatchObject({ status: "delivered" });
  const [goblet, legpress, custom] = (await rx.list(old.planId, old.revisionId)).filter((i) => i.phaseIndex === 1).map((i) => i.id);
  const student = studentSessionsFor(db, "client-1");
  const logged = async (performedOn: string, exercises: unknown[], effort: number | null, now: Date) => {
    const out = await student.save("st-1", { planId: old.planId, phaseIndex: 1, workoutLabel: "Full Body", performedOn, effort, exercises }, now);
    if (out.status !== "saved") throw new Error(out.status);
  };
  await logged("2026-11-05", [
    { prescribedExerciseId: goblet, done: true, rir: 2, sets: [{ reps: 10, loadKg: 20 }, { reps: 9, loadKg: 20 }] },
    { prescribedExerciseId: custom, done: true, sets: [{ reps: 12 }] },
    { prescribedExerciseId: legpress, done: false },
  ], 7, day(5));
  await logged("2026-11-10", [
    { prescribedExerciseId: goblet, done: true, sets: [{ reps: 10, loadKg: 22.5 }] },
    { prescribedExerciseId: legpress, done: false, pain: true, notes: "SEGREDO-DOR" },
  ], null, day(10));
  // Per-set RIR (0043) is typed by the student in S8; here it is written directly to prove the adapter reads it as typed.
  await run(
    `UPDATE session_sets SET rir = 3, load_basis = 'TOTAL' WHERE set_number = 1 AND session_exercise_id IN
       (SELECT se.id FROM session_exercises se JOIN workout_sessions ws ON ws.id = se.session_id WHERE ws.performed_on = '2026-11-05' AND se.prescribed_exercise_id = ?1)`,
    goblet,
  );
  // An old log (outside the 180-day window) and a log of another organization's student must never be read.
  const revision = await db.prepare("SELECT revision_id AS r FROM workout_sessions LIMIT 1").first<{ r: string }>();
  await run(
    `INSERT INTO workout_sessions (id, organization_id, student_id, revision_id, phase_index, workout_label, performed_on, logged_by_user_id, created_at, updated_at)
     VALUES ('ws-old', 'org-a', 'st-1', ?1, 1, 'Full Body', '2026-04-01', 'client-1', 'x', 'x')`,
    revision!.r,
  );
  await run("INSERT INTO session_exercises (id, organization_id, session_id, prescribed_exercise_id, exercise_name, position, done) VALUES ('se-old','org-a','ws-old',?1,'Agachamento goblet',0,1)", goblet);

  // The DRAFT to generate into: structure v2 and one row typed by hand.
  const created = (await plans.create("st-1", { title: "Plano novo", input: V2 }))!;
  await rx.add(created.planId, created.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { customName: "Mobilidade do professor" }, { sets: "2", reps: "12", restSeconds: 45 });
  draft = created;
  // st-2 has nothing: no profile, no assessment, no history.
  emptyDraft = (await plans.create("st-2", { title: "Sem dados", input: V2 }))!;

  // Access that must not reach st-1: disabled user, revoked membership, revoked assignment.
  await run("UPDATE users SET disabled_at = 'x' WHERE id = 'tech-off'");
  await run("UPDATE memberships SET revoked_at = 'x' WHERE user_id = 'tech-rev'");
  await run("UPDATE care_assignments SET revoked_at = 'x' WHERE professional_id = 'pro-ra'");
});
afterAll(async () => {
  await mf?.dispose();
});

describe("loading the student's real data (gated)", () => {
  it("reads profile, newest recorded assessment, library with metadata, structure, existing rows and history", async () => {
    const ctx = okContext(await loadGenerationContext(db, scope("tech-a"), draft.planId, draft.revisionId, { now: NOW }));
    expect(ctx.asOf).toBe("2026-11-20");
    expect(ctx.revision).toMatchObject({ id: draft.revisionId, state: "DRAFT", prescriptionModel: "TEMPLATE" });
    expect(ctx.revision.contentVersion).toBeGreaterThan(0);
    expect(ctx.profile).toMatchObject({ level: "Intermediário", goal: "Hipertrofia", sessionMinutes: 60 });
    expect(ctx.assessment).toMatchObject({ id: assessmentId, formatVersion: 2, standing: { risk: "REVIEW_REQUIRED", reviewed: true } });
    expect(ctx.assessment!.conclusion?.limitations).toBe("SEGREDO-CONCLUSAO");
    // Library: the 64 system exercises with the inferred seed (0045); some are pending curation.
    expect(ctx.catalog).toHaveLength(64);
    const goblet = ctx.catalog.find((e) => e.id === "sys-001")!;
    expect(goblet).toMatchObject({ name: "Agachamento goblet", metadataStatus: "INFERRED", modality: "RESISTANCE" });
    expect(ctx.catalog.some((e) => e.metadataStatus === "PENDING")).toBe(true);
    expect(ctx.existing.map((e) => e.name)).toEqual(["Mobilidade do professor"]);
    // History: two sessions in the window, the old one outside; the custom exercise is counted apart; pain kept.
    expect(ctx.history.window).toEqual({ since: "2026-05-24", until: "2026-11-20", sinceDays: 180, sessions: 2, truncated: false });
    expect(ctx.history.summary.customSkipped).toBe(1);
    expect(ctx.history.summary.logs.map((l) => `${l.date}:${l.exerciseId}:${l.pain}`)).toEqual([
      "2026-11-05:sys-001:false",
      "2026-11-10:sys-001:false",
      "2026-11-10:sys-002:true",
    ]);
    const first = ctx.history.summary.logs[0];
    // The exercise's RIR (2) is not copied onto sets; the per-set RIR typed (3) is read as typed; empty is null, never 0.
    expect(first.sets).toEqual([
      { reps: 10, durationSeconds: null, loadKg: 20, loadBasis: "TOTAL", rir: 3, completed: true },
      { reps: 9, durationSeconds: null, loadKg: 20, loadBasis: null, rir: null, completed: true },
    ]);
    expect(first.sessionEffort).toBe(7);
  });

  it("answers not_found for another organization, an unassigned colleague, commercial roles, the student, disabled or revoked access", async () => {
    for (const who of [scope("tech-b", "org-b"), scope("tech-a", "org-b"), scope("tech-a2"), scope("commercial-a"), scope("client-1"), scope("tech-off"), scope("tech-rev"), scope("tech-ra")])
      expect(await loadGenerationContext(db, who, draft.planId, draft.revisionId, { now: NOW }), JSON.stringify(who)).toEqual({ status: "not_found" });
    expect(await loadGenerationContext(db, scope("tech-a"), draft.planId, emptyDraft.revisionId, { now: NOW })).toEqual({ status: "not_found" });
  });

  it("never opens a revision past DRAFT", async () => {
    const plans = plansFor(db, scope("tech-a"));
    const ready = (await plans.create("st-3", { title: "Pronto", input: V2 }))!;
    await prescriptionFor(db, scope("tech-a")).add(ready.planId, ready.revisionId, { phaseIndex: 1, workoutLabel: "A" }, { customName: "X" });
    expect(await plans.markReady(ready.planId, ready.revisionId)).toBe(true);
    expect(await loadGenerationContext(db, scope("tech-a"), ready.planId, ready.revisionId, { now: NOW })).toEqual({ status: "not_open", state: "READY" });
  });

  it("exposures() is gated like every other read and bounded by the window", async () => {
    const ex = (who: ReturnType<typeof scope>) => executionFor(db, who).exposures("st-1", { sinceDays: 180, today: "2026-11-20" });
    expect(await ex(scope("tech-b", "org-b"))).toBeNull();
    expect(await ex(scope("tech-a2"))).toBeNull();
    expect(await ex(scope("tech-ra"))).toBeNull();
    expect((await ex(scope("tech-a")))!.sessions).toBe(2);
    const wide = (await executionFor(db, scope("tech-a")).exposures("st-1", { sinceDays: 365, today: "2026-11-20" }))!;
    expect(wide.sessions).toBe(3);
    const before = (await executionFor(db, scope("tech-a")).exposures("st-1", { sinceDays: 180, today: "2026-11-09" }))!;
    expect(before.sessions).toBe(1);
    await expect(executionFor(db, scope("tech-a")).exposures("st-1", { sinceDays: -1 })).rejects.toThrow("EXPOSURE_WINDOW_INVALID");
  });
});

describe("topic 6: triagem com alertas (real assessment)", () => {
  it("PAR-Q 'Sim' + 'Precisa de liberação médica', anamnesis and posture become flags; the selection is the same as without them", async () => {
    const ctx = okContext(await loadGenerationContext(db, scope("tech-a"), draft.planId, draft.revisionId, { now: NOW }));
    const out = built(ctx);
    expect(out.ready).toBe(true);
    expect(out.input.student.screening).toEqual({ parq: "POSITIVE", professionalDecision: "MEDICAL_CLEARANCE", medicalClearanceRecorded: true, ref: `assessment:${assessmentId}` });
    expect(out.input.student.findings.map((f) => `${f.kind}:${f.code}`)).toEqual(expect.arrayContaining([
      "POSTURE:lateral_shoulders:protracted", "ANAMNESIS:injuries", "ASSESSMENT_CONTEXT:TEST:abdominal", "ASSESSMENT_CONTEXT:RESULT:body_fat_percent",
    ]));
    const r = generate(out.input);
    const codes = r.flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["MEDICAL_CLEARANCE_RECORDED", "ANAMNESIS:injuries", "ASSESSMENT:POSTURE:lateral_shoulders:protracted", "HISTORY_PAIN:sys-002"]));
    expect(codes).not.toContain("SCREENING_REVIEW_REQUIRED");
    expect(r.flags.filter((f) => f.source !== "HISTORY").every((f) => !f.suggestedDecision && !f.decided)).toBe(true);
    // The pain report suggests an exclusion for the professional to decide; it is not applied by itself.
    expect(r.flags.find((f) => f.code === "HISTORY_PAIN:sys-002")!.suggestedDecision).toEqual({ kind: "EXCLUDE_EXERCISE", exerciseId: "sys-002" });
    const clear = generate({ ...out.input, student: { ...out.input.student, screening: { parq: "CLEAR", professionalDecision: null, medicalClearanceRecorded: false }, findings: [] } });
    expect(picked(r)).toEqual(picked(clear));
    expect(r.occurrences.flatMap((o) => o.items).filter((i) => i.origin === "ENGINE").length).toBeGreaterThan(5);
    expect(r.status).toBe("SUCCEEDED");
    // The hand-typed row is preserved and counts toward workout A.
    expect(r.occurrences.filter((o) => o.phaseIndex === 1 && o.label === "A").every((o) => o.items.some((i) => i.origin === "PRESERVED" && i.exerciseName === "Mobilidade do professor"))).toBe(true);
    // Every planned session of the saved structure is in the proposal, with the structure's dates.
    expect(r.occurrences.map((o) => `${o.phaseIndex}/${o.week}/${o.slot}/${o.plannedDate}`)).toEqual([
      "1/1/1/2026-11-23", "1/1/2/2026-11-26", "1/2/1/2026-11-30", "1/2/2/2026-12-03", "2/1/1/null",
    ]);
    // Health free text never reaches the engine input, the ledger references or the assumptions.
    for (const part of [out.input, out.facts, out.assumptions, r.flags]) expect(JSON.stringify(part)).not.toMatch(/SEGREDO/);
  });

  it("a recorded movement test graded MODERATE (earlier format) suggests excluding the pattern; only an accepted decision applies it", async () => {
    const legacy = legacyAssessments(db, scope("tech-a"));
    const started = await legacy.startDraft("st-3", day(6));
    if (started.status !== "started") throw new Error(started.status);
    await legacy.saveDraft(started.id, { ...ALL_NO, exertionPain: true, assessedOn: "2026-11-06", movement: [{ test: "SQUAT", grade: "MODERATE", notes: "SEGREDO-MOV" }] }, day(6));
    expect(await legacy.record(started.id, { screeningAsked: true }, day(6))).toMatchObject({ status: "recorded", riskStatus: "REVIEW_REQUIRED" });
    const plans = plansFor(db, scope("tech-a"));
    const p = (await plans.create("st-3", { title: "Legado", input: V2 }))!;
    let ctx = okContext(await loadGenerationContext(db, scope("tech-a"), p.planId, p.revisionId, { now: NOW }));
    let out = built(ctx);
    expect(out.input.student.screening).toMatchObject({ parq: "POSITIVE", professionalDecision: null });
    expect(out.questions.map((q) => q.code)).toContain("SCREENING_DECISION");
    let r = generate(out.input);
    expect(r.flags.find((f) => f.code === "SCREENING_REVIEW_REQUIRED")?.severity).toBe("WARNING");
    const squat = r.flags.find((f) => f.code === "MOVEMENT_FINDING:SQUAT:SQUAT")!;
    expect(squat.suggestedDecision).toEqual({ kind: "EXCLUDE_PATTERN", pattern: "SQUAT" });
    const squatItems = (res: EngineResult) =>
      res.occurrences.flatMap((o) => o.items).filter((i) => ctx.catalog.find((e) => e.id === i.exerciseId)?.patterns.includes("SQUAT")).length;
    const accepted = generate(built(ctx, { ...ANSWERS, acceptedFlagDecisions: [{ flagCode: squat.code, decision: squat.suggestedDecision! }] }).input);
    expect(squatItems(accepted)).toBe(0);
    expect(picked(r)).not.toEqual(picked(accepted));
    // A review recorded on the earlier format is a decision (REVIEWED), never a "cleared".
    await assessmentsFor(db, scope("tech-a")).addReview(started.id, "SEGREDO-FUNDAMENTO", day(7));
    ctx = okContext(await loadGenerationContext(db, scope("tech-a"), p.planId, p.revisionId, { now: NOW }));
    out = built(ctx);
    expect(out.input.student.screening.professionalDecision).toBe("REVIEWED");
    r = generate(out.input);
    expect(r.flags.map((f) => f.code)).toContain("SCREENING_REVIEWED");
    expect(JSON.stringify([out.input, r.flags])).not.toMatch(/SEGREDO/);
  });
});

describe("topic 7: dados ausentes (real student without records)", () => {
  it("asks instead of inventing; generation runs with assumptions and empty values where data is missing", async () => {
    const ctx = okContext(await loadGenerationContext(db, scope("tech-a"), emptyDraft.planId, emptyDraft.revisionId, { now: NOW }));
    expect(ctx.profile).toBeNull();
    expect(ctx.assessment).toBeNull();
    expect(ctx.history.window.sessions).toBe(0);
    const unanswered = built(ctx, {});
    expect(unanswered.ready).toBe(false);
    expect(unanswered.questions.map((q) => `${q.code}${q.required ? "!" : ""}`)).toEqual([
      "STIMULUS!", "EXERCISE_COUNT!", "STIMULUS!", "EQUIPMENT!", "AVAILABLE_MINUTES", "PROFILE_MISSING", "PROFILE_GOAL", "ASSESSMENT_MISSING",
    ]);
    // No goal anywhere: no stimulus suggestion either.
    expect(unanswered.questions.find((q) => q.code === "STIMULUS")!.suggestions).toBeUndefined();
    const out = built(ctx);
    expect(out.ready).toBe(true);
    expect(out.input.student).toEqual({ level: null, goal: null, sessionMinutes: null, screening: { parq: "NOT_DONE", professionalDecision: null, medicalClearanceRecorded: false }, findings: [] });
    expect(out.input.history).toEqual([]);
    expect(out.facts).toMatchObject({ profile: null, assessment: null, history: { sessions: 0, logs: 0 }, existing: { rows: 0 } });
    const r = generate(out.input);
    expect(r.flags.map((f) => f.code)).toEqual(["SCREENING_NOT_DONE"]);
    expect(r.assumptions.map((a) => a.code)).toEqual(expect.arrayContaining(["EXPERIENCE_UNKNOWN", "NO_HISTORY", "BUDGET_UNKNOWN"]));
    expect(r.occurrences.filter((o) => o.phaseIndex === 1).every((o) => o.budgetMinutes === null)).toBe(true);
    expect(r.historySuggestions).toEqual([]);
    expect(r.occurrences.flatMap((o) => o.items).every((i) => !i.dose || i.dose.metric !== "REPS" || i.dose.loadKg === null)).toBe(true);
  });

  it("refuses an answer that names an exercise of another organization", async () => {
    await run("INSERT INTO exercises (id, organization_id, name, name_key, category, source) VALUES ('org-b-ex','org-b','Segredo B','segredo b','Agachar','ORGANIZATION')");
    const ctx = okContext(await loadGenerationContext(db, scope("tech-a"), emptyDraft.planId, emptyDraft.revisionId, { now: NOW }));
    expect(ctx.catalog.some((e) => e.id === "org-b-ex")).toBe(false);
    expect(buildEngineInput(ctx, parseGenerationAnswers({ ...ANSWERS, preferredExerciseIds: ["org-b-ex"] }))).toEqual({ ok: false, code: "UNKNOWN_EXERCISE", exerciseIds: ["org-b-ex"] });
  });
});
