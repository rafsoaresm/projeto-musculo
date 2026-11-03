import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentsFor } from "@/db/assessments";
import { plansFor } from "@/db/plans";
import { prescriptionFor } from "@/db/prescription";
import { FORMULA_VERSION } from "@/modules/avaliacoes/formulas";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Slice 0.77 on a real local D1 with every migration (triggers included): finalize a draft of the Avaliação Física (results written with the
// versioned formulas, PAR-Q decision with who and when, everything frozen after), the plan gate reading the PAR-Q, the amendment (retificação)
// and the history. Identities are rows, as the server derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const day = (n: number, hour = 12) => new Date(`2026-11-${String(n).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);
const one = <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const fails = async (sql: string, ...binds: unknown[]) => {
  try {
    await db.prepare(sql).bind(...binds).run();
    return "";
  } catch (error) {
    return String(error);
  }
};
const a = () => assessmentsFor(db, scope("tech-a"));
const plans = () => plansFor(db, scope("tech-a"));

const PARQ_CODES = ["heart_condition", "chest_pain_activity", "chest_pain_month", "dizziness", "bone_joint", "blood_pressure_medication", "other_reason"] as const;
const parq = (yes: string[] = [], review: { decision: string | null; notes: string } = { decision: null, notes: "" }) => ({
  anamnesis: { injuries: { answer: "yes", details: "Entorse em 2024" } },
  parq: { answers: Object.fromEntries(PARQ_CODES.map((code) => [code, yes.includes(code) ? "yes" : "no"])), professionalReview: review },
});
// The handoff's example (section 8): a man of 27 on the assessment date, 69,1 kg, 1,71 m, Jackson & Pollock 7.
const JP7 = {
  weightKg: 69.1,
  heightCm: 171,
  protocol: "jackson_pollock_7",
  equation: "male",
  skinfolds: { chest: [12], midaxillary: [9], triceps: [24], subscapular: [11], abdominal: [16], suprailiac: [15], thigh: [35], calf_medial: [17] },
};

/** Saves the modules of a draft one by one, against the revision, and returns the revision after them. */
async function fill(id: string, modules: Record<string, unknown>, by = "tech-a") {
  let revision = (await assessmentsFor(db, scope(by)).sections(id))!.revision;
  for (const [module, payload] of Object.entries(modules)) {
    const saved = await assessmentsFor(db, scope(by)).saveSection(id, { module: module as never, status: "IN_PROGRESS", payload, revision });
    if (saved.status !== "saved") throw new Error(saved.status);
    revision = saved.revision;
  }
  return revision;
}
async function started(student: string, when: Date) {
  const outcome = await a().startDraft(student, when);
  if (outcome.status !== "started") throw new Error(outcome.status);
  return outcome.id;
}
async function readyPlan(student: string) {
  const created = (await plans().create(student, {
    title: `Plano ${crypto.randomUUID().slice(0, 6)}`,
    input: { startDate: "2026-11-16", phases: Array.from({ length: 3 }, () => ({ weeks: 4, sessionsPerWeek: 3, split: "Full Body", exercisesPerSession: 3 })) },
  }))!;
  const rx = prescriptionFor(db, scope("tech-a"));
  for (let i = 0; i < 3; i++)
    await rx.add(created.planId, created.revisionId, { phaseIndex: 1, workoutLabel: "Full Body" }, { customName: `Exercício ${i + 1}` }, { sets: "3", reps: "10" });
  await rx.copyPhase(created.planId, created.revisionId, 1, 2);
  await rx.copyPhase(created.planId, created.revisionId, 1, 3);
  expect(await plans().markReady(created.planId, created.revisionId)).toBe(true);
  return created;
}
const approval = (revisionId: string) =>
  one<{ state: string; screening: string | null; assessment: string | null }>(
    "SELECT state, approval_screening AS screening, approval_assessment_id AS assessment FROM plan_revisions WHERE id = ?1",
    revisionId,
  );

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "assessment-v2-finalize-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  await db.batch([
    ...["tech-a", "tech-b"].map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare("INSERT INTO users(id) VALUES ('tech-a'),('tech-b')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL')"),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-2','org-a','Two'),('st-3','org-a','Three'),('st-b','org-b','B')"),
    db.prepare(
      "INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a'),('org-a','st-3','pro-a'),('org-b','st-b','pro-b')",
    ),
    db.prepare("INSERT INTO student_profiles(student_id,organization_id,birth_date,gender,height_cm,weight_kg,goal,updated_by_user_id) VALUES ('st-1','org-a','1999-03-04','Masculino',171,69.1,'Hipertrofia','tech-a')"),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("finalizing an Avaliação Física", () => {
  let id = "";
  it("refuses an incomplete triagem and says what is missing; nothing is written", async () => {
    id = await started("st-1", day(10));
    expect(await a().finalize(id, 1, day(10))).toEqual({ status: "pending", pending: ["PAR-Q: 7 de 7 perguntas sem resposta"] });
    const revision = await fill(id, { screening: parq(["dizziness"]), composition: JP7 });
    // A "Sim" asks for the professional's decision with a note: nobody decides for them.
    expect(await a().finalize(id, revision, day(10))).toEqual({
      status: "pending",
      pending: ["PAR-Q com “Sim”: registre a decisão profissional", "PAR-Q com “Sim”: escreva a nota da decisão"],
    });
    expect(await one("SELECT state, revision FROM assessments WHERE id = ?1", id)).toEqual({ state: "DRAFT", revision });
    expect(await one("SELECT count(*) AS n FROM assessment_results WHERE assessment_id = ?1", id)).toEqual({ n: 0 });
  });

  it("refuses a finalize from an older revision (another tab), and a draft of another organization is not reached", async () => {
    const revision = await fill(id, { screening: parq(["dizziness"], { decision: "medical_clearance", notes: "Encaminhado ao cardiologista." }) });
    expect(await a().finalize(id, revision - 1, day(10))).toEqual({ status: "conflict" });
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).finalize(id, revision, day(10))).toEqual({ status: "not_found" });
    expect(await one("SELECT state FROM assessments WHERE id = ?1", id)).toEqual({ state: "DRAFT" });
  });

  it("records the results with the versioned formulas (handoff example: 122 mm, ~17,27%), the decision with who and when, and RECORDED", async () => {
    const revision = (await a().sections(id))!.revision;
    expect(await a().finalize(id, revision, day(10, 15))).toEqual({ status: "recorded" });
    const head = await one<Record<string, unknown>>(
      "SELECT state, recorded_at AS recordedAt, recorded_by_user_id AS recordedBy, risk_status AS column FROM assessments WHERE id = ?1",
      id,
    );
    expect(head).toEqual({ state: "RECORDED", recordedAt: day(10, 15).toISOString(), recordedBy: "tech-a", column: "CLEAR" });
    const rows = (
      await db
        .prepare("SELECT code, value, unit, method, formula_version AS version, inputs, flags FROM assessment_results WHERE assessment_id = ?1 ORDER BY rowid")
        .bind(id)
        .all<{ code: string; value: number; unit: string; method: string; version: string; inputs: string; flags: string }>()
    ).results;
    expect(rows.map((row) => row.code)).toEqual(["bmi", "sum_skinfolds", "body_density", "body_fat_percent", "fat_mass_kg", "lean_mass_kg"]);
    const value = (code: string) => rows.find((row) => row.code === code)!;
    expect(value("sum_skinfolds").value).toBe(122);
    expect(value("body_fat_percent").value).toBeCloseTo(17.27, 2);
    expect(value("fat_mass_kg").value).toBeCloseTo(11.94, 2);
    expect(value("lean_mass_kg").value).toBeCloseTo(69.1 - 11.934, 1);
    expect(value("bmi").value).toBeCloseTo(23.63, 2);
    expect(value("body_fat_percent")).toMatchObject({ unit: "%", method: "jackson_pollock_7_1978_male", version: FORMULA_VERSION, flags: "[]" });
    expect(value("bmi")).toMatchObject({ unit: "kg/m²", method: "weight_over_height_squared" });
    const inputs = JSON.parse(value("body_fat_percent").inputs);
    // Only the protocol's sites are its inputs (the calf, measured too, is kept in the module, never summed).
    expect(inputs).toMatchObject({ protocol: "jackson_pollock_7", equation: "male", ageYears: 27, weightKg: 69.1, conversion: "siri_1961", aggregation: "mean" });
    expect(Object.keys(inputs.sitesMm).sort()).toEqual(["abdominal", "chest", "midaxillary", "subscapular", "suprailiac", "thigh", "triceps"]);
    // The screening says the derived flag and who decided and when; every module is DONE.
    const screening = JSON.parse((await one<{ payload: string }>("SELECT payload FROM assessment_sections WHERE assessment_id = ?1 AND module = 'screening'", id))!.payload);
    expect(screening.parq.riskFlag).toBe(true);
    expect(screening.parq.professionalReview).toEqual({
      decision: "medical_clearance",
      notes: "Encaminhado ao cardiologista.",
      reviewedAt: day(10, 15).toISOString(),
      reviewerUserId: "tech-a",
    });
    expect(await one("SELECT group_concat(DISTINCT status) AS s FROM assessment_sections WHERE assessment_id = ?1", id)).toEqual({ s: "DONE" });
    expect(await one("SELECT count(*) AS n FROM access_audit_events WHERE action = 'ASSESSMENT_RECORDED' AND subject_id = ?1", id)).toEqual({ n: 1 });
    // Read back: the risk is the PAR-Q's, and the decision is its review.
    const detail = await a().get(id);
    expect(detail).toMatchObject({ state: "RECORDED", riskStatus: "REVIEW_REQUIRED", reviewed: true, formatVersion: 2, recordedByName: "Pro A", amendedById: null });
    expect(await a().standing("st-1")).toMatchObject({ assessmentId: id, formatVersion: 2, risk: "REVIEW_REQUIRED", reviewed: true, reviewedAt: day(10, 15).toISOString() });
  });

  it("is frozen after: no save, no second finalize, and the database refuses direct writes", async () => {
    const revision = (await a().sections(id))!.revision;
    expect(await a().saveSection(id, { module: "composition", status: "IN_PROGRESS", payload: {}, revision })).toEqual({ status: "not_found" });
    expect(await a().finalize(id, revision)).toEqual({ status: "not_found" });
    expect(await fails("UPDATE assessment_results SET value = 1 WHERE assessment_id = ?1", id)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("DELETE FROM assessment_results WHERE assessment_id = ?1", id)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("UPDATE assessment_sections SET payload = '{}' WHERE assessment_id = ?1", id)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("UPDATE assessments SET revision = 99 WHERE id = ?1", id)).toContain("ASSESSMENT_FROZEN");
    expect(await fails("DELETE FROM assessments WHERE id = ?1", id)).toContain("ASSESSMENT_FROZEN");
  });

  it("records only what can be computed: with no birth date, no body fat (and the reason is the screen's), but the BMI", async () => {
    const other = await started("st-3", day(11));
    const revision = await fill(other, { screening: parq(), composition: { ...JP7, skinfolds: { ...JP7.skinfolds } } });
    expect(await a().finalize(other, revision, day(11))).toEqual({ status: "recorded" });
    const codes = (await a().results(other)).map((row) => row.code);
    expect(codes).toEqual(["bmi"]);
    expect(await a().get(other)).toMatchObject({ riskStatus: "CLEAR", reviewed: false });
    const screening = JSON.parse((await one<{ payload: string }>("SELECT payload FROM assessment_sections WHERE assessment_id = ?1 AND module = 'screening'", other))!.payload);
    expect(screening.parq.riskFlag).toBe(false);
    expect(screening.parq.professionalReview).toEqual({ decision: null, notes: "" });
  });
});

describe("the plan gate reads the PAR-Q of the newest Avaliação Física", () => {
  it("approves on a PAR-Q “Sim” with the recorded decision, recording that assessment as reviewed", async () => {
    const plan = await readyPlan("st-1");
    const latest = (await a().standing("st-1"))!.assessmentId;
    expect(await plans().approve(plan.planId, plan.revisionId, { screeningNotRecorded: false }, day(12))).toEqual({ status: "approved" });
    expect(await approval(plan.revisionId)).toEqual({ state: "APPROVED", screening: "REVIEW_REQUIRED_REVIEWED", assessment: latest });
    expect(await plans().deliver(plan.planId, plan.revisionId, day(12))).toEqual({ status: "delivered" });
  });
  it("approves a PAR-Q with no “Sim” as CLEAR (never a clearance), with no acknowledgement", async () => {
    const plan = await readyPlan("st-3");
    expect(await plans().approve(plan.planId, plan.revisionId, { screeningNotRecorded: false }, day(12))).toEqual({ status: "approved" });
    expect((await approval(plan.revisionId))?.screening).toBe("CLEAR");
  });
  it("blocks approval and delivery while the newest one has a “Sim” and no recorded decision (data the finalize never writes, read defensively)", async () => {
    const approved = await readyPlan("st-2");
    expect(await plans().approve(approved.planId, approved.revisionId, { screeningNotRecorded: true }, day(12))).toEqual({ status: "approved" });
    // Written by hand, as a damaged or imported record could be: a recorded Avaliação Física with a "Sim" and no decision.
    await db.batch([
      db.prepare(
        `INSERT INTO assessments (id, organization_id, student_id, assessed_on, kind, state, risk_status, created_by_user_id, screening_answered, format_version)
         VALUES ('raw-1','org-a','st-2','2026-11-12','INITIAL','DRAFT','CLEAR','tech-a','[]',2)`,
      ),
      db.prepare(
        `INSERT INTO assessment_sections (assessment_id, organization_id, module, status, payload, updated_at, updated_by_user_id)
         VALUES ('raw-1','org-a','screening','DONE',?1,'2026-11-12T12:00:00.000Z','tech-a')`,
      ).bind(JSON.stringify({ ...parq(["bone_joint"]), parq: { ...parq(["bone_joint"]).parq, riskFlag: true } })),
      db.prepare("UPDATE assessments SET state = 'RECORDED', recorded_at = '2026-11-12T12:00:00.000Z', recorded_by_user_id = 'tech-a' WHERE id = 'raw-1'"),
    ]);
    expect(await a().standing("st-2")).toMatchObject({ assessmentId: "raw-1", risk: "REVIEW_REQUIRED", reviewed: false });
    const plan = await readyPlan("st-2");
    expect(await plans().approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, day(13))).toEqual({ status: "review_required", assessedOn: "2026-11-12" });
    // The plan approved before stays approved (never undone), but is not delivered while the alert has no decision.
    expect(await plans().deliver(approved.planId, approved.revisionId, day(13))).toEqual({ status: "review_required", assessedOn: "2026-11-12" });
    expect((await approval(approved.revisionId))?.state).toBe("APPROVED");
    // The earlier format's review does not apply to it: the decision is part of the Avaliação Física.
    expect(await a().addReview("raw-1", "Revisado")).toBe(false);
  });
});

describe("an amendment (retificação)", () => {
  let original = "";
  let amendment = "";
  let before = "";
  it("needs a reason, is not reached from another organization, and starts a draft that copies the modules without what finalize wrote", async () => {
    original = (await a().standing("st-1"))!.assessmentId;
    before = JSON.stringify((await db.prepare("SELECT module, status, payload, updated_at FROM assessment_sections WHERE assessment_id = ?1 ORDER BY module").bind(original).all()).results);
    expect(await a().amend(original, "  x ")).toEqual({ status: "invalid_reason" });
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).amend(original, "Peso digitado errado")).toEqual({ status: "not_found" });
    const outcome = await a().amend(original, "Peso digitado errado", day(14));
    expect(outcome.status).toBe("started");
    if (outcome.status !== "started") return;
    amendment = outcome.id;
    const row = await one<Record<string, unknown>>(
      "SELECT state, kind, assessed_on AS assessedOn, amends_assessment_id AS amends, amend_reason AS reason, format_version AS f FROM assessments WHERE id = ?1",
      amendment,
    );
    expect(row).toEqual({ state: "DRAFT", kind: "INITIAL", assessedOn: "2026-11-10", amends: original, reason: "Peso digitado errado", f: 2 });
    const sections = (await a().sections(amendment))!.sections;
    expect(sections.map((section) => [section.module, section.status])).toEqual([["composition", "IN_PROGRESS"], ["screening", "IN_PROGRESS"]]);
    const screening = sections.find((section) => section.module === "screening")!.payload as { parq: Record<string, unknown> & { professionalReview: Record<string, unknown> } };
    expect(screening.parq.riskFlag).toBeUndefined();
    expect(screening.parq.professionalReview).toEqual({ decision: "medical_clearance", notes: "Encaminhado ao cardiologista." });
    // One draft per student: another amendment waits for this one.
    expect(await a().amend(original, "Outra correção")).toEqual({ status: "draft_open", id: amendment });
    expect((await a().get(amendment))?.amendReason).toBe("Peso digitado errado");
  });
  it("with a new “Sim”, asks for the decision to be looked at again before it is finalized", async () => {
    let revision = await fill(amendment, { screening: parq(["dizziness", "bone_joint"], { decision: "medical_clearance", notes: "Encaminhado ao cardiologista." }), composition: { ...JP7, weightKg: 70.2 } });
    expect(await a().finalize(amendment, revision, day(14))).toEqual({
      status: "pending",
      pending: ["Retificação com nova resposta “Sim” no PAR-Q: revise a decisão profissional e a nota"],
    });
    revision = await fill(amendment, { screening: parq(["dizziness", "bone_joint"], { decision: "medical_clearance", notes: "Encaminhado ao cardiologista; dor no joelho relatada." }) });
    expect(await a().finalize(amendment, revision, day(14, 16))).toEqual({ status: "recorded" });
  });
  it("leaves the original untouched, read as amended, and becomes the newest for the plan gate (only future approvals read it)", async () => {
    expect(JSON.stringify((await db.prepare("SELECT module, status, payload, updated_at FROM assessment_sections WHERE assessment_id = ?1 ORDER BY module").bind(original).all()).results)).toBe(before);
    expect(await a().get(original)).toMatchObject({ state: "RECORDED", amendedById: amendment });
    expect(await a().get(amendment)).toMatchObject({ state: "RECORDED", amendsAssessmentId: original, riskStatus: "REVIEW_REQUIRED", reviewed: true });
    expect((await a().results(amendment)).find((row) => row.code === "fat_mass_kg")?.value).toBeCloseTo((70.2 * 17.27) / 100, 1);
    expect((await a().standing("st-1"))?.assessmentId).toBe(amendment);
    // The plan approved and delivered on the original keeps it; the next approval records the amendment.
    const delivered = (await db.prepare("SELECT id FROM plan_revisions WHERE approval_assessment_id = ?1").bind(original).all<{ id: string }>()).results;
    expect(delivered.length).toBe(1);
    expect((await approval(delivered[0].id))?.state).toBe("DELIVERED");
    const plan = await readyPlan("st-1");
    expect(await plans().approve(plan.planId, plan.revisionId, { screeningNotRecorded: false }, day(15))).toEqual({ status: "approved" });
    expect(await approval(plan.revisionId)).toEqual({ state: "APPROVED", screening: "REVIEW_REQUIRED_REVIEWED", assessment: amendment });
    // Only the newest of a chain is amended.
    expect(await a().amend(original, "De novo")).toEqual({ status: "already_amended", id: amendment });
  });
});

describe("the history", () => {
  it("lists date, kind, PAR-Q and the main results with their method; the evolution leaves out what was amended", async () => {
    const list = await a().listForStudent("st-1");
    const amended = list.find((item) => item.amendsAssessmentId !== null)!;
    expect(amended.results.map((row) => [row.code, row.method])).toEqual([
      ["bmi", "weight_over_height_squared"],
      ["body_fat_percent", "jackson_pollock_7_1978_male"],
    ]);
    expect(list.filter((item) => item.amendedById !== null).length).toBe(1);
    const history = await a().history("st-1");
    expect(history.map((item) => item.id)).toEqual([amended.id]);
    // Not reached from another organization.
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).listForStudent("st-1")).toEqual([]);
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).results(amended.id)).toEqual([]);
  });
  it("offers a reassessment the previous reference of the equation, and copies nothing into its draft", async () => {
    const draft = await started("st-1", day(20));
    expect((await a().get(draft))?.kind).toBe("REASSESSMENT");
    expect(await a().previousEquation(draft)).toBe("male");
    expect((await a().sections(draft))?.sections).toEqual([]);
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).previousEquation(draft)).toBeNull();
  });
});
