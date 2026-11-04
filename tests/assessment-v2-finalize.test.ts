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
    // Slice 0.78: with the perimeters of the handoff (waist 69,5, hip 108), the ratio and each bilateral difference with both sides are recorded;
    // a side not measured gives no difference, and the bone breadths no result.
    const composition = {
      ...JP7,
      skinfolds: { ...JP7.skinfolds },
      perimetersCm: { waist: 69.5, hip: 108 },
      sidedPerimetersCm: { thigh: { right: 56, left: 56.6 }, calf: { right: 40, left: null } },
      boneBreadthsCm: { humerus: 6.4, femur: 9.4, wrist: 5.7 },
    };
    const revision = await fill(other, { screening: parq(), composition });
    expect(await a().finalize(other, revision, day(11))).toEqual({ status: "recorded" });
    const results = await a().results(other);
    expect(results.map((row) => row.code)).toEqual(["bmi", "waist_hip_ratio", "bilateral_difference_thigh"]);
    const ratio = results.find((row) => row.code === "waist_hip_ratio")!;
    expect(ratio.value).toBeCloseTo(0.644, 3);
    expect(ratio).toMatchObject({ unit: null, method: "waist_over_hip", formulaVersion: FORMULA_VERSION });
    expect(results.find((row) => row.code === "bilateral_difference_thigh")).toMatchObject({ unit: "cm", method: "right_minus_left", formulaVersion: FORMULA_VERSION });
    // The raw measures stay in the module, frozen, as typed.
    const stored = JSON.parse((await one<{ payload: string }>("SELECT payload FROM assessment_sections WHERE assessment_id = ?1 AND module = 'composition'", other))!.payload);
    expect(stored).toMatchObject({ perimetersCm: composition.perimetersCm, sidedPerimetersCm: composition.sidedPerimetersCm, boneBreadthsCm: composition.boneBreadthsCm });
    // The history keeps showing body fat and BMI only.
    expect((await a().listForStudent("st-3")).find((row) => row.id === other)?.results.map((row) => row.code)).toEqual(["bmi"]);
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
  it("reads a “Sim” from the answers too: a recorded one without the derived flag is never taken as clear", async () => {
    await db.batch([
      db.prepare(
        `INSERT INTO assessments (id, organization_id, student_id, assessed_on, kind, state, risk_status, created_by_user_id, screening_answered, format_version)
         VALUES ('raw-2','org-a','st-2','2026-11-13','REASSESSMENT','DRAFT','CLEAR','tech-a','[]',2)`,
      ),
      db.prepare(
        `INSERT INTO assessment_sections (assessment_id, organization_id, module, status, payload, updated_at, updated_by_user_id)
         VALUES ('raw-2','org-a','screening','DONE',?1,'2026-11-13T12:00:00.000Z','tech-a')`,
      ).bind(JSON.stringify(parq(["bone_joint"]))),
      db.prepare("UPDATE assessments SET state = 'RECORDED', recorded_at = '2026-11-13T12:00:00.000Z', recorded_by_user_id = 'tech-a' WHERE id = 'raw-2'"),
    ]);
    expect(await a().standing("st-2")).toMatchObject({ assessmentId: "raw-2", risk: "REVIEW_REQUIRED", reviewed: false });
    const plan = await readyPlan("st-2");
    expect(await plans().approve(plan.planId, plan.revisionId, { screeningNotRecorded: true }, day(13))).toEqual({ status: "review_required", assessedOn: "2026-11-13" });
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
    // Slice 0.82: the evolution reads every result with its method, formula version and inputs (the conversion), as written at finalize.
    const fat = history[0].results.find((row) => row.code === "body_fat_percent")!;
    expect([fat.method, fat.formulaVersion, fat.inputs?.conversion]).toEqual(["jackson_pollock_7_1978_male", FORMULA_VERSION, "siri_1961"]);
    expect(history[0].results.map((row) => row.code)).toEqual((await a().results(amended.id)).map((row) => row.code));
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).history("st-1")).toEqual([]);
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

describe("who decided, the finalize guard and the previous equation", () => {
  const decided = { decision: "cleared", notes: "Liberado para treinar com supervisão." };
  let first = "";
  beforeAll(async () => {
    await db.batch([
      db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-4','org-a','Four')"),
      db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-4','pro-a')"),
      db.prepare("INSERT INTO student_profiles(student_id,organization_id,birth_date,updated_by_user_id) VALUES ('st-4','org-a','1999-03-04','tech-a')"),
    ]);
  });
  it("an amendment that carries the decision unchanged keeps who decided and when; a changed one is stamped again", async () => {
    first = await started("st-4", day(21));
    let revision = await fill(first, { screening: parq(["dizziness"], decided), composition: JP7 });
    expect(await a().finalize(first, revision, day(21, 10))).toEqual({ status: "recorded" });
    const review = async (id: string) =>
      JSON.parse((await one<{ payload: string }>("SELECT payload FROM assessment_sections WHERE assessment_id = ?1 AND module = 'screening'", id))!.payload).parq
        .professionalReview;
    const amended = await a().amend(first, "Peso corrigido", day(22));
    if (amended.status !== "started") throw new Error(amended.status);
    revision = await fill(amended.id, { composition: { ...JP7, weightKg: 70 } });
    expect(await a().finalize(amended.id, revision, day(22, 10))).toEqual({ status: "recorded" });
    expect(await review(amended.id)).toEqual({ ...decided, reviewedAt: day(21, 10).toISOString(), reviewerUserId: "tech-a" });
    const again = await a().amend(amended.id, "Nota revista", day(23));
    if (again.status !== "started") throw new Error(again.status);
    revision = await fill(again.id, { screening: parq(["dizziness"], { ...decided, notes: "Liberado, com supervisão nas duas primeiras semanas." }) });
    expect(await a().finalize(again.id, revision, day(23, 10))).toEqual({ status: "recorded" });
    expect(await review(again.id)).toMatchObject({ reviewedAt: day(23, 10).toISOString(), reviewerUserId: "tech-a" });
  });
  it("a save that lands before the finalize, even stamped in the same millisecond, leaves the finalize without effect", async () => {
    const draft = await started("st-4", day(24));
    const revision = await fill(draft, { screening: parq() });
    // Another tab saves after the finalize read the draft and before its batch, at the very instant the finalize stamps.
    let saved = "";
    const racing = new Proxy(db, {
      get(target, key) {
        if (key === "batch")
          return async (statements: Parameters<D1Database["batch"]>[0]) => {
            if (!saved)
              saved = (await a().saveSection(draft, { module: "screening", status: "IN_PROGRESS", payload: parq(["bone_joint"]), revision }, day(24, 10))).status;
            return target.batch(statements);
          };
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await assessmentsFor(racing, scope("tech-a")).finalize(draft, revision, day(24, 10))).toEqual({ status: "conflict" });
    expect(saved).toBe("saved");
    expect(await one("SELECT state, revision FROM assessments WHERE id = ?1", draft)).toEqual({ state: "DRAFT", revision: revision + 1 });
    const stored = JSON.parse((await one<{ payload: string }>("SELECT payload FROM assessment_sections WHERE assessment_id = ?1 AND module = 'screening'", draft))!.payload);
    expect(stored.parq.answers.bone_joint).toBe("yes");
    expect(stored.parq.riskFlag).toBeUndefined();
    expect(await one("SELECT count(*) AS n FROM access_audit_events WHERE action = 'ASSESSMENT_RECORDED' AND subject_id = ?1", draft)).toEqual({ n: 0 });
    // Finalized from the current revision, it records with no Medidas.
    expect(await a().finalize(draft, revision + 1, day(24, 11))).toEqual({ status: "pending", pending: ["PAR-Q com “Sim”: registre a decisão profissional", "PAR-Q com “Sim”: escreva a nota da decisão"] });
    const next = await fill(draft, { screening: parq(["bone_joint"], decided) });
    expect(await a().finalize(draft, next, day(24, 12))).toEqual({ status: "recorded" });
  });
  it("suggests the equation of the newest recorded one only: with no Medidas there, nothing older is offered", async () => {
    const draft = await started("st-4", day(25));
    expect(await a().previousEquation(draft)).toBeNull();
  });
});

// Slice 0.79: the module "posture" (posture and somatotype, handoff 3.3) is checked at finalize, recorded as typed, frozen, and copied by an
// amendment. It gives no result: nothing in it is computed (the somatotype is the professional's record; Heath-Carter is not computed).
describe("the posture and the somatotype", () => {
  const POSTURE = {
    findings: { lateral_shoulders: ["protracted", "internal_rotation"], posterior_scapulae: ["left_winged"], anterior_asis: ["right_depressed"] },
    notes: { lateral: "Ombro direito mais protuso", posterior: "", anterior: "" },
    somatotype: { method: "manual", labels: ["endomorph", "mesomorph"], notes: "", heathCarter: { supraspinaleSkinfoldMm: 8.5, flexedArmGirthCm: null } },
  };
  beforeAll(async () => {
    await db.batch([
      db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-5','org-a','Five')"),
      db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-5','pro-a')"),
    ]);
  });
  it("refuses to finalize a stored posture its schema does not take (a payload not from the screen), and writes nothing", async () => {
    const draft = await started("st-5", day(26));
    const revision = await fill(draft, { screening: parq(), posture: { findings: { anterior_knees: ["valgus", "varus"] } } });
    expect(await a().finalize(draft, revision, day(26, 10))).toEqual({ status: "invalid" });
    expect(await one("SELECT state FROM assessments WHERE id = ?1", draft)).toEqual({ state: "DRAFT" });
    // Another organization does not reach the draft to save its posture.
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).saveSection(draft, { module: "posture", status: "IN_PROGRESS", payload: POSTURE, revision })).toEqual({ status: "not_found" });
    expect(await a().discardDraft(draft)).toMatchObject({ status: "discarded" });
  });
  it("records the posture as typed, with no result, frozen, and an amendment copies it to correct", async () => {
    const draft = await started("st-5", day(27));
    const revision = await fill(draft, { screening: parq(), composition: JP7, posture: POSTURE });
    expect(await a().finalize(draft, revision, day(27, 10))).toEqual({ status: "recorded" });
    const stored = await one<{ status: string; payload: string }>("SELECT status, payload FROM assessment_sections WHERE assessment_id = ?1 AND module = 'posture'", draft);
    expect(stored?.status).toBe("DONE");
    expect(JSON.parse(stored!.payload)).toEqual(POSTURE);
    expect((await a().results(draft)).map((row) => row.code)).toEqual(["bmi"]);
    expect(await fails("UPDATE assessment_sections SET payload = '{}' WHERE assessment_id = ?1 AND module = 'posture'", draft)).toContain("ASSESSMENT_FROZEN");
    const amended = await a().amend(draft, "Escápula do lado errado", day(28));
    if (amended.status !== "started") throw new Error(amended.status);
    const copy = (await a().sections(amended.id))!.sections.find((section) => section.module === "posture");
    expect(copy).toMatchObject({ status: "IN_PROGRESS", payload: POSTURE });
  });
});

describe("the Flexiteste, the physical tests and the final considerations (0.80)", () => {
  const LEVELS = { shoulder_horizontal_abduction: 2, shoulder_abduction: 3, elbow_flexion: 2, elbow_hyperextension: 2, wrist_flexion: 1, wrist_extension: 1, hip_flexion: 2, trunk_hyperextension: 3, trunk_lateral_flexion: 3, thigh_flexion: 2, thigh_extension: 2, knee_flexion: 3, knee_hyperextension: 2, ankle_dorsiflexion: 2, ankle_plantar_flexion: 2 };
  const MOVEMENT = { flexitest: { variant: "pdf_15_movements_1_to_4", levels: LEVELS, classificationManual: "Médio (-)", notes: "" } };
  const TESTS = {
    abdominal: { exercise: "Abdominal 1 min", repetitions: 35, durationSeconds: 60, conditions: "", notes: "", classificationManual: "" },
    upperLimb: { exercise: "Flexão de braço", repetitions: 0, durationSeconds: null, conditions: "", notes: "", classificationManual: "" },
    cooper: { distanceM: 2200, testedOn: "2026-11-28", location: "Pista", conditions: "", contraindications: "", notes: "", classificationManual: "" },
  };
  const CONCLUSION = { considerations: "Boa evolução.", recommendations: "", limitations: "", referrals: "" };
  beforeAll(async () => {
    await db.batch([
      db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-6','org-a','Six')"),
      db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-6','pro-a')"),
    ]);
  });
  it("refuses to finalize a stored Flexiteste with a level 0 or tests with a negative count (payloads not from the screen), and writes nothing", async () => {
    const draft = await started("st-6", day(26));
    let revision = await fill(draft, { screening: parq(), movement: { flexitest: { levels: { knee_flexion: 0 } } } });
    expect(await a().finalize(draft, revision, day(26, 10))).toEqual({ status: "invalid" });
    revision = await fill(draft, { movement: MOVEMENT, tests: { abdominal: { repetitions: -1 } } });
    expect(await a().finalize(draft, revision, day(26, 10))).toEqual({ status: "invalid" });
    expect(await one("SELECT state FROM assessments WHERE id = ?1", draft)).toEqual({ state: "DRAFT" });
    // Another organization does not reach the draft to save its tests.
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).saveSection(draft, { module: "tests", status: "IN_PROGRESS", payload: TESTS, revision })).toEqual({ status: "not_found" });
    expect(await a().discardDraft(draft)).toMatchObject({ status: "discarded" });
  });
  it("records the Flexiteste total (32), the Cooper speed and estimated VO₂ with method and version, the texts as typed, frozen; an amendment copies them", async () => {
    const draft = await started("st-6", day(27));
    const revision = await fill(draft, { screening: parq(), movement: MOVEMENT, tests: TESTS, conclusion: CONCLUSION });
    expect(await a().finalize(draft, revision, day(27, 10))).toEqual({ status: "recorded" });
    const results = await a().results(draft);
    expect(results.map((row) => row.code).sort()).toEqual(["cooper_speed_kmh", "cooper_vo2_estimate", "flexitest_total"]);
    expect(results.find((row) => row.code === "flexitest_total")).toMatchObject({ value: 32, unit: "pontos", method: "flexitest_sum_of_15_levels", formulaVersion: FORMULA_VERSION });
    expect(results.find((row) => row.code === "cooper_speed_kmh")).toMatchObject({ value: 11, unit: "km/h", method: "cooper_distance_over_200" });
    const vo2 = results.find((row) => row.code === "cooper_vo2_estimate")!;
    expect(vo2.value).toBeCloseTo(37.9, 2);
    expect(vo2).toMatchObject({ unit: "ml/kg/min", method: "cooper_12min_vo2_504_9_44_73", formulaVersion: FORMULA_VERSION });
    for (const name of ["movement", "tests", "conclusion"]) {
      const stored = await one<{ status: string }>("SELECT status FROM assessment_sections WHERE assessment_id = ?1 AND module = ?2", draft, name);
      expect(stored?.status).toBe("DONE");
    }
    expect(await fails("UPDATE assessment_sections SET payload = '{}' WHERE assessment_id = ?1 AND module = 'tests'", draft)).toContain("ASSESSMENT_FROZEN");
    const amended = await a().amend(draft, "Distância anotada errada", day(28));
    if (amended.status !== "started") throw new Error(amended.status);
    const copy = (await a().sections(amended.id))!.sections;
    expect(copy.find((section) => section.module === "tests")).toMatchObject({ status: "IN_PROGRESS", payload: TESTS });
    expect(copy.find((section) => section.module === "movement")).toMatchObject({ payload: MOVEMENT });
    expect(copy.find((section) => section.module === "conclusion")).toMatchObject({ payload: CONCLUSION });
  });
});

// Slice 0.92: the classification by the reference tables is written with each result at finalize and freezes with it; a result recorded
// before the tables keeps no classification (never recomputed); the reference is the equation's, or the one chosen in Revisão.
describe("the classifications by the reference tables (0.92)", () => {
  beforeAll(async () => {
    await db.batch([
      db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-7','org-a','Seven'),('st-8','org-a','Eight')"),
      db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-7','pro-a'),('org-a','st-8','pro-a')"),
      db.prepare("INSERT INTO student_profiles(student_id,organization_id,birth_date,gender,updated_by_user_id) VALUES ('st-7','org-a','1999-03-04','Feminino','tech-a')"),
    ]);
  });

  it("writes the classification of the handoff's man with each result a table covers, frozen, and reads it back only for who reaches it", async () => {
    const draft = await started("st-7", day(12));
    const revision = await fill(draft, { screening: parq(), composition: { ...JP7, perimetersCm: { waist: 69.5, hip: 108 } } });
    expect(await a().finalize(draft, revision, day(12, 10))).toEqual({ status: "recorded" });
    const rows = (
      await db.prepare("SELECT code, classification FROM assessment_results WHERE assessment_id = ?1 ORDER BY rowid").bind(draft).all<{ code: string; classification: string | null }>()
    ).results;
    const stored = Object.fromEntries(rows.map((row) => [row.code, row.classification === null ? null : JSON.parse(row.classification)]));
    // The equation is "male" (JP7), so the tables use the masculine reference: the profile's gender ("Feminino") is never read.
    expect(stored.body_fat_percent).toMatchObject({
      table: "body_fat",
      version: "ref-2026-11-03",
      status: "in_range",
      levels: ["Acima da Média"],
      comparedValue: 17,
      column: "homens, 26 a 35 anos",
      source: "Pollock & Wilmore, 1993",
      sex: "male",
      referenceFrom: "equation",
      ageYears: 27,
    });
    expect(stored.bmi).toMatchObject({ table: "bmi", levels: ["Peso ideal (parabéns)"], comparedValue: 23.6, sex: null });
    expect(stored.waist_hip_ratio).toMatchObject({ table: "waist_hip", levels: ["Baixo"], comparedValue: 0.64, column: "homens, 20 a 29 anos" });
    for (const code of ["sum_skinfolds", "body_density", "fat_mass_kg", "lean_mass_kg"]) expect(stored[code], code).toBeNull();
    expect(await fails("UPDATE assessment_results SET classification = NULL WHERE assessment_id = ?1", draft)).toContain("ASSESSMENT_FROZEN");
    const read = await a().results(draft);
    expect(read.find((row) => row.code === "body_fat_percent")?.classification).toMatchObject({ levels: ["Acima da Média"] });
    expect("classification" in read.find((row) => row.code === "body_density")!).toBe(false);
    expect(await assessmentsFor(db, scope("tech-b", "org-b")).results(draft)).toEqual([]);
  });

  it("without the equation, uses the reference chosen in Revisão; without one, says so; without a birth date, says so", async () => {
    const chosen = await started("st-7", day(13));
    const composition = { weightKg: 53.5, heightCm: 170, perimetersCm: { waist: 70, hip: 95 }, tableReference: "female" };
    const tests = { cooper: { distanceM: 1800 } };
    let revision = await fill(chosen, { screening: parq(), composition, tests });
    expect(await a().finalize(chosen, revision, day(13, 10))).toEqual({ status: "recorded" });
    const of = async (id: string, code: string) => (await a().results(id)).find((row) => row.code === code)?.classification;
    expect(await of(chosen, "waist_hip_ratio")).toMatchObject({ levels: ["Moderado"], sex: "female", referenceFrom: "chosen", column: "mulheres, 20 a 29 anos" });
    expect(await of(chosen, "cooper_speed_kmh")).toMatchObject({ table: "cooper_12min", value: 1800, levels: ["Média"], column: "mulheres, 20 a 29 anos" });
    // 53,5 ÷ 1,70² = 18,51, compared as 18,5: in the table's gap, said so.
    expect(await of(chosen, "bmi")).toMatchObject({ status: "gap", levels: ["abaixo do peso", "Peso ideal (parabéns)"], comparedValue: 18.5 });

    const none = await started("st-8", day(13));
    revision = await fill(none, { screening: parq(), composition: { ...composition, tableReference: undefined }, tests });
    expect(await a().finalize(none, revision, day(13, 11))).toEqual({ status: "recorded" });
    // st-8 has no birth date: the BMI needs neither; the ratio has no reference (checked before the age).
    expect(await of(none, "waist_hip_ratio")).toMatchObject({ status: "no_reference", levels: [] });
    expect(await of(none, "bmi")).toMatchObject({ status: "gap" });
    const noAge = await started("st-8", day(14));
    revision = await fill(noAge, { screening: parq(), composition, tests });
    expect(await a().finalize(noAge, revision, day(14, 10))).toEqual({ status: "recorded" });
    expect(await of(noAge, "waist_hip_ratio")).toMatchObject({ status: "no_age", sex: "female" });
    expect(await of(noAge, "cooper_speed_kmh")).toMatchObject({ status: "no_age" });
  });

  it("a result recorded before the tables keeps no classification: nothing recomputes it", async () => {
    const old = await started("st-8", day(15));
    // As recorded before 0.92: a result written without the column, then the assessment recorded.
    await db
      .prepare(
        `INSERT INTO assessment_results (id, assessment_id, organization_id, code, value, unit, method, formula_version, inputs, flags, created_at)
         VALUES ('old-bmi', ?1, 'org-a', 'bmi', 23.63, 'kg/m²', 'weight_over_height_squared', 'av2-2026-11', '{}', '[]', ?2)`,
      )
      .bind(old, day(15).toISOString())
      .run();
    await db.prepare("UPDATE assessments SET state = 'RECORDED', recorded_at = ?2, recorded_by_user_id = 'tech-a' WHERE id = ?1").bind(old, day(15).toISOString()).run();
    const [bmi] = await a().results(old);
    expect(bmi).toMatchObject({ code: "bmi", value: 23.63 });
    expect("classification" in bmi).toBe(false);
    expect(await fails("UPDATE assessment_results SET classification = '{}' WHERE id = 'old-bmi'")).toContain("ASSESSMENT_FROZEN");
  });
});
