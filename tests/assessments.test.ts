import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentsFor, screeningStanding } from "@/db/assessments";
import { GRADE_KEYS, MOVEMENT_KEYS, parseAssessment, POSTURE_KEYS } from "@/modules/avaliacoes/contracts";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1. Identities are rows, as the server derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const day = (n: number) => new Date(`2026-11-${String(n).padStart(2, "0")}T12:00:00Z`);
const bp = { metricType: "BLOOD_PRESSURE", value: "120/80" };

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "assessment-tests" },
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
    db.prepare(
      "INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','Student One'),('st-2','org-a','Student Two'),('st-3','org-a','Student Three'),('st-b','org-b','Student B')",
    ),
    db.prepare(
      "INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a2'),('org-a','st-3','pro-a'),('org-b','st-b','pro-b')",
    ),
    db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1')"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

const a = () => assessmentsFor(db, scope("tech-a"));
async function recordedFor(student: string, input: Record<string, unknown>, when: Date, user = "tech-a") {
  const api = assessmentsFor(db, scope(user));
  const started = await api.startDraft(student, when);
  if (started.status !== "started") throw new Error(`could not start: ${started.status}`);
  await api.saveDraft(started.id, input, when);
  const result = await api.record(started.id, { screeningAsked: true }, when);
  if (result.status !== "recorded") throw new Error(`could not record: ${result.status}`);
  return started.id;
}

describe("the instrument", () => {
  const today = day(10);
  it("takes the six items of the master document and computes the status from them", () => {
    expect(parseAssessment({ assessedOn: "2026-11-10" }, today).riskStatus).toBe("CLEAR");
    for (const item of ["exertionPain", "dizzinessFainting", "chestPain", "injuryInTreatment", "recentSurgery", "medicalRestriction"])
      expect(parseAssessment({ assessedOn: "2026-11-10", [item]: true }, today).riskStatus, item).toBe("REVIEW_REQUIRED");
  });

  it("refuses a risk status sent by the caller, unknown fields, future dates and bad metrics", () => {
    expect(() => parseAssessment({ assessedOn: "2026-11-10", riskStatus: "CLEAR" }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-11-10", clearance: true }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-11-11" }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-02-30" }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-11-10", metrics: [{ metricType: "RESTING_HEART_RATE", value: "9999" }] }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-11-10", metrics: [{ metricType: "BLOOD_PRESSURE", value: "alta" }] }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-11-10", metrics: [{ metricType: "CUSTOM", value: "12" }] }, today)).toThrow();
  });

  it("normalizes metrics: default unit and name, plain numbers kept as numbers, free text kept as typed", () => {
    const input = parseAssessment(
      {
        assessedOn: "2026-11-10",
        metrics: [
          { metricType: "RESTING_HEART_RATE", value: "62" },
          bp,
          { metricType: "BODY_FAT", value: "21,5" },
          { metricType: "CUSTOM", name: "Teste de sentar e levantar", value: "14 reps", side: "BOTH", notes: "Sem apoio" },
        ],
      },
      today,
    );
    expect(input.metrics).toMatchObject([
      { name: "Frequência cardíaca de repouso", unit: "bpm", valueText: "62", valueNumber: 62 },
      { unit: "mmHg", valueText: "120/80", valueNumber: null },
      { unit: "%", valueText: "21,5", valueNumber: 21.5 },
      { name: "Teste de sentar e levantar", unit: null, valueText: "14 reps", valueNumber: null, side: "BOTH", notes: "Sem apoio" },
    ]);
  });
});

describe("posture and movement in the instrument", () => {
  const today = day(10);
  it("takes the items of sections 8 and 9 of the master document, and nothing else", () => {
    expect(POSTURE_KEYS).toHaveLength(18);
    expect(MOVEMENT_KEYS).toHaveLength(9);
    expect(GRADE_KEYS).toEqual(["NOT_ASSESSED", "NO_LIMITATION", "MILD", "MODERATE", "STOPPED_BY_PAIN"]);
    expect(() => parseAssessment({ assessedOn: "2026-11-10", posture: { findings: ["ANTERIOR.SCOLIOSIS"] } }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-11-10", posture: { findings: [], diagnosis: "x" } }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-11-10", movement: [{ test: "JUMP", grade: "MILD" }] }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-11-10", movement: [{ test: "SQUAT", grade: "SEVERE" }] }, today)).toThrow();
    expect(() => parseAssessment({ assessedOn: "2026-11-10", movement: [{ test: "SQUAT", grade: "MILD" }, { test: "SQUAT", grade: "MODERATE" }] }, today)).toThrow();
  });

  it("never changes the risk status: only the six screening items decide it", () => {
    const everything = parseAssessment(
      {
        assessedOn: "2026-11-10",
        posture: { findings: [...POSTURE_KEYS], notes: "Muitos achados" },
        movement: MOVEMENT_KEYS.map((test) => ({ test, grade: "STOPPED_BY_PAIN" })),
      },
      today,
    );
    expect(everything.riskStatus).toBe("CLEAR");
    expect(everything.posture.findings).toHaveLength(18);
  });
});

describe("recording an assessment", () => {
  it("starts an initial draft, saves screening and metrics, and records it once", async () => {
    const api = a();
    const started = await api.startDraft("st-1", day(10));
    expect(started.status).toBe("started");
    if (started.status !== "started") return;
    // Asking again returns the open draft instead of opening a parallel one.
    expect(await api.startDraft("st-1", day(10))).toEqual({ status: "draft_open", id: started.id });

    expect(
      await api.saveDraft(
        started.id,
        { assessedOn: "2026-11-10", exertionPain: true, screeningNotes: "Dor no joelho ao subir escada", metrics: [{ metricType: "RESTING_HEART_RATE", value: "62" }, bp] },
        day(10),
      ),
    ).toBe(true);
    // Saving again replaces the metrics, it does not add to them.
    expect(await api.saveDraft(started.id, { assessedOn: "2026-11-10", exertionPain: true, metrics: [bp] }, day(10))).toBe(true);
    const draft = await api.get(started.id);
    expect(draft).toMatchObject({ state: "DRAFT", kind: "INITIAL", riskStatus: "REVIEW_REQUIRED", previousAssessmentId: null });
    expect(draft?.flags).toMatchObject({ exertionPain: true, chestPain: false });
    expect(draft?.metrics).toHaveLength(1);
    expect(draft?.metrics[0]).toMatchObject({ valueText: "120/80", unit: "mmHg" });

    expect(await api.record(started.id, { screeningAsked: true }, day(10))).toEqual({ status: "recorded", riskStatus: "REVIEW_REQUIRED" });
    const recorded = await api.get(started.id);
    expect(recorded).toMatchObject({ state: "RECORDED", recordedAt: day(10).toISOString(), reviewed: false });
    // Once recorded it cannot be recorded again nor saved over.
    expect(await api.record(started.id, { screeningAsked: true }, day(11))).toEqual({ status: "not_found" });
    expect(await api.saveDraft(started.id, { assessedOn: "2026-11-10" }, day(11))).toBe(false);
    expect((await api.get(started.id))?.flags.exertionPain).toBe(true);
  });

  it("does not turn an untouched form into 'no alert': recording a clear form asks for confirmation", async () => {
    const api = a();
    const started = await api.startDraft("st-3", day(10));
    if (started.status !== "started") throw new Error("expected draft");
    await api.saveDraft(started.id, { assessedOn: "2026-11-10" }, day(10));
    expect(await api.record(started.id, { screeningAsked: false }, day(10))).toEqual({ status: "confirmation_required" });
    expect((await api.get(started.id))?.state).toBe("DRAFT");
    expect(await api.record(started.id, { screeningAsked: true }, day(10))).toEqual({ status: "recorded", riskStatus: "CLEAR" });
  });

  it("makes the next one a reassessment linked to the previous recorded one", async () => {
    const api = a();
    const first = (await api.listForStudent("st-1")).find((x) => x.state === "RECORDED");
    const next = await api.startDraft("st-1", day(20));
    if (next.status !== "started") throw new Error("expected draft");
    const draft = await api.get(next.id);
    expect(draft).toMatchObject({ kind: "REASSESSMENT", previousAssessmentId: first?.id });
  });

  it("keeps screening standing on the newest recorded assessment only", async () => {
    const draft = (await a().listForStudent("st-1")).find((x) => x.state === "DRAFT")!;
    expect(await screeningStanding(db, "org-a", "st-1")).toMatchObject({ risk: "REVIEW_REQUIRED", reviewed: false, assessedOn: "2026-11-10" });
    await a().saveDraft(draft.id, { assessedOn: "2026-11-20" }, day(20));
    await a().record(draft.id, { screeningAsked: true }, day(20));
    expect(await screeningStanding(db, "org-a", "st-1")).toMatchObject({ risk: "CLEAR", assessedOn: "2026-11-20" });
    expect(await screeningStanding(db, "org-a", "st-2")).toBeNull();
  });
});

describe("reviewing an alert", () => {
  it("adds the professional's basis as a separate record and never clears the status", async () => {
    const id = await recordedFor("st-2", { assessedOn: "2026-11-10", chestPain: true }, day(10), "tech-a2");
    const api = assessmentsFor(db, scope("tech-a2"));
    expect(await screeningStanding(db, "org-a", "st-2")).toMatchObject({ risk: "REVIEW_REQUIRED", reviewed: false });
    await expect(api.addReview(id, "   ", day(11))).rejects.toThrow("REVIEW_BASIS_INVALID");
    expect(await api.addReview(id, "Liberação médica anexada pelo aluno em 2026-11-11", day(11))).toBe(true);
    const detail = await api.get(id);
    expect(detail).toMatchObject({ riskStatus: "REVIEW_REQUIRED", reviewed: true });
    expect(detail?.reviews).toEqual([
      { reviewerUserId: "tech-a2", reviewerName: "Pro A2", basis: "Liberação médica anexada pelo aluno em 2026-11-11", reviewedAt: day(11).toISOString() },
    ]);
    expect(await screeningStanding(db, "org-a", "st-2")).toMatchObject({ risk: "REVIEW_REQUIRED", reviewed: true });
  });

  it("applies only to a recorded assessment that required a review", async () => {
    const clear = await recordedFor("st-3", { assessedOn: "2026-11-12" }, day(12));
    expect(await a().addReview(clear, "Sem necessidade", day(12))).toBe(false);
    const draftStart = await a().startDraft("st-3", day(13));
    if (draftStart.status !== "started") throw new Error("expected draft");
    expect(await a().addReview(draftStart.id, "Cedo demais", day(13))).toBe(false);
    const rows = await db.prepare("SELECT COUNT(*) AS n FROM assessment_reviews WHERE assessment_id IN (?1, ?2)").bind(clear, draftStart.id).first<{ n: number }>();
    expect(rows?.n).toBe(0);
    // A draft can be dropped; a recorded assessment cannot (see the database tests below).
    await db.prepare("DELETE FROM assessments WHERE id = ?1").bind(draftStart.id).run();
  });
});

describe("who can reach an assessment", () => {
  it("is refused, reading and writing, to anyone without an active technical assignment", async () => {
    const all = await a().listForStudent("st-1");
    const target = all.find((x) => x.state === "RECORDED")!;
    // An alert nobody has reviewed: the only kind a review can be added to.
    const alert = all.find((x) => x.state === "RECORDED" && x.riskStatus === "REVIEW_REQUIRED" && !x.reviewed)!;
    const count = async (table: string) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
    const before = { assessments: await count("assessments"), reviews: await count("assessment_reviews"), audit: await count("access_audit_events"), metrics: await count("assessment_metrics") };
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
      const api = assessmentsFor(db, scope(user, org));
      expect(await api.get(target.id), `${user}/${org} get`).toBeNull();
      expect(await api.listForStudent("st-1"), `${user}/${org} list`).toEqual([]);
      expect(await api.standing("st-1"), `${user}/${org} standing`).toBeNull();
      expect(await api.startDraft("st-1", day(25)), `${user}/${org} start`).toEqual({ status: "not_found" });
      expect(await api.saveDraft(target.id, { assessedOn: "2026-11-10" }, day(25)), `${user}/${org} save`).toBe(false);
      expect(await api.record(target.id, { screeningAsked: true }), `${user}/${org} record`).toEqual({ status: "not_found" });
      expect(await api.addReview(alert.id, "tentativa"), `${user}/${org} review`).toBe(false);
      expect((await api.overview()).filter((row) => row.studentId === "st-1"), `${user}/${org} overview`).toEqual([]);
    }
    expect({ assessments: await count("assessments"), reviews: await count("assessment_reviews"), audit: await count("access_audit_events"), metrics: await count("assessment_metrics") }).toEqual(before);
  });

  it("refuses an open draft of another professional's student, saves included", async () => {
    const draft = (await a().listForStudent("st-1")).find((x) => x.state === "DRAFT");
    const started = draft ? { status: "draft_open" as const, id: draft.id } : await a().startDraft("st-1", day(26));
    const id = "id" in started ? started.id : "";
    const before = await a().get(id);
    expect(await assessmentsFor(db, scope("tech-a2")).saveDraft(id, { assessedOn: "2026-11-10", chestPain: true, metrics: [bp] }, day(26))).toBe(false);
    expect(await a().get(id)).toEqual(before);
  });

  it("ends with the assignment or the identity", async () => {
    const all = await a().listForStudent("st-1");
    const target = all.find((x) => x.state === "RECORDED")!;
    const alert = all.find((x) => x.state === "RECORDED" && x.riskStatus === "REVIEW_REQUIRED" && !x.reviewed)!;
    await db.prepare("UPDATE care_assignments SET revoked_at = '2026-11-30T00:00:00.000Z' WHERE student_id = 'st-1'").run();
    expect(await a().get(target.id)).toBeNull();
    expect(await a().startDraft("st-1")).toEqual({ status: "not_found" });
    await db.prepare("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'").run();
    await db.prepare("UPDATE users SET disabled_at = '2026-11-30T00:00:00.000Z' WHERE id = 'tech-a'").run();
    expect(await a().get(target.id)).toBeNull();
    expect(await a().addReview(alert.id, "x")).toBe(false);
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = 'tech-a'").run();
    expect(await a().get(target.id)).not.toBeNull();
  });

  it("lists only the students of the acting professional, alerts without a review first", async () => {
    const rows = await a().overview();
    expect(rows.map((row) => row.studentId).sort()).toEqual(["st-1", "st-3"]);
    expect(rows.find((row) => row.studentId === "st-1")).toMatchObject({ riskStatus: "CLEAR", assessedOn: "2026-11-20" });
    const other = await assessmentsFor(db, scope("tech-b", "org-b")).overview();
    expect(other.map((row) => row.studentId)).toEqual(["st-b"]);
    expect(other[0]).toMatchObject({ assessmentId: null, riskStatus: null });
  });

  it("does not leak the content of an assessment into the audit trail", async () => {
    const events = await db.prepare("SELECT action, subject_id AS subject, actor_user_id AS actor FROM access_audit_events WHERE action LIKE 'ASSESSMENT_%'").all<{ action: string; subject: string; actor: string }>();
    expect(events.results.length).toBeGreaterThan(0);
    expect(JSON.stringify(events.results)).not.toMatch(/joelho|Liberação|120\/80/);
  });
});

describe("what the database itself refuses", () => {
  const sql = (text: string) => db.prepare(text).run();
  it("freezes a recorded assessment against direct SQL, metrics included", async () => {
    const id = await recordedFor("st-3", { assessedOn: "2026-11-14", metrics: [bp] }, day(14));
    await expect(sql(`UPDATE assessments SET exertion_pain = 1, risk_status = 'REVIEW_REQUIRED' WHERE id = '${id}'`)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(sql(`UPDATE assessments SET notes = 'editado' WHERE id = '${id}'`)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(sql(`UPDATE assessments SET recorded_at = '2030-01-01T00:00:00.000Z' WHERE id = '${id}'`)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(sql(`UPDATE assessments SET state = 'DRAFT' WHERE id = '${id}'`)).rejects.toThrow(/ASSESSMENT_STATE_INVALID/);
    await expect(sql(`DELETE FROM assessments WHERE id = '${id}'`)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(sql(`UPDATE assessment_metrics SET value_text = '999/99' WHERE assessment_id = '${id}'`)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(sql(`DELETE FROM assessment_metrics WHERE assessment_id = '${id}'`)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(
      sql(`INSERT INTO assessment_metrics(id,organization_id,assessment_id,metric_type,name,value_text,position) VALUES ('m-late','org-a','${id}','CUSTOM','Tardio','1',9)`),
    ).rejects.toThrow(/ASSESSMENT_FROZEN/);
  });

  it("keeps the risk status consistent with the items, even for a hand-written row", async () => {
    await expect(
      sql(`INSERT INTO assessments(id,organization_id,student_id,assessed_on,kind,risk_status,created_by_user_id,chest_pain)
           VALUES ('bad-1','org-a','st-2','2026-11-10','INITIAL','CLEAR','tech-a2',1)`),
    ).rejects.toThrow();
    await expect(
      sql(`INSERT INTO assessments(id,organization_id,student_id,assessed_on,kind,risk_status,created_by_user_id)
           VALUES ('bad-2','org-a','st-2','2026-11-10','INITIAL','REVIEW_REQUIRED','tech-a2')`),
    ).rejects.toThrow();
  });

  it("allows one open draft per student and no cross-organization link", async () => {
    await sql(`INSERT INTO assessments(id,organization_id,student_id,assessed_on,kind,risk_status,created_by_user_id)
               VALUES ('d-1','org-a','st-2','2026-11-15','REASSESSMENT','CLEAR','tech-a2')`);
    await expect(
      sql(`INSERT INTO assessments(id,organization_id,student_id,assessed_on,kind,risk_status,created_by_user_id)
           VALUES ('d-2','org-a','st-2','2026-11-16','REASSESSMENT','CLEAR','tech-a2')`),
    ).rejects.toThrow(/UNIQUE/);
    await expect(
      sql(`INSERT INTO assessments(id,organization_id,student_id,assessed_on,kind,risk_status,created_by_user_id)
           VALUES ('x-1','org-b','st-1','2026-11-15','INITIAL','CLEAR','tech-b')`),
    ).rejects.toThrow();
    await sql("DELETE FROM assessments WHERE id = 'd-1'");
  });

  it("keeps reviews append-only and only for a recorded alert", async () => {
    const alert = (await assessmentsFor(db, scope("tech-a2")).listForStudent("st-2")).find((x) => x.riskStatus === "REVIEW_REQUIRED")!;
    await expect(sql(`UPDATE assessment_reviews SET basis = 'reescrito' WHERE assessment_id = '${alert.id}'`)).rejects.toThrow(/APPEND_ONLY/);
    await expect(sql(`DELETE FROM assessment_reviews WHERE assessment_id = '${alert.id}'`)).rejects.toThrow(/APPEND_ONLY/);
    const clear = (await a().listForStudent("st-3")).find((x) => x.riskStatus === "CLEAR" && x.state === "RECORDED")!;
    await expect(
      sql(`INSERT INTO assessment_reviews(id,organization_id,assessment_id,reviewer_user_id,basis,reviewed_at) VALUES ('rv-x','org-a','${clear.id}','tech-a','x','2026-11-20T00:00:00.000Z')`),
    ).rejects.toThrow(/NOT_APPLICABLE/);
  });
});

describe("posture and movement of an assessment", () => {
  const owner = "tech-a2"; // professional of st-2
  const api = () => assessmentsFor(db, scope(owner));
  const rows = async (assessmentId: string) =>
    (await db.prepare("SELECT area, item, grade, notes FROM assessment_findings WHERE assessment_id = ?1 ORDER BY rowid").bind(assessmentId).all<{ area: string; item: string; grade: string | null; notes: string | null }>()).results;

  it("saves the marked findings and the recorded tests, reads them back and replaces them on the next save", async () => {
    const started = await api().startDraft("st-2", day(28));
    if (started.status !== "started") throw new Error(started.status);
    const base = { assessedOn: "2026-11-28" };
    expect(
      await api().saveDraft(
        started.id,
        {
          ...base,
          posture: { findings: ["POSTERIOR.OTHER_VISUAL", "ANTERIOR.KNEE_VALGUS", "LATERAL.FORWARD_HEAD", "ANTERIOR.KNEE_VALGUS"], notes: "Foto não feita" },
          movement: [
            { test: "PUSH", grade: "STOPPED_BY_PAIN", notes: "Dor no ombro direito" },
            { test: "SQUAT", grade: "MILD", notes: null },
            { test: "HIP_HINGE", grade: "NOT_ASSESSED", notes: null },
            { test: "PULL", grade: "NOT_ASSESSED", notes: "Sem equipamento hoje" },
          ],
        },
        day(28),
      ),
    ).toBe(true);
    const saved = (await api().get(started.id))!;
    // In the order of the document, once each; the unmarked and the empty "not assessed" are not rows.
    expect(saved.posture).toEqual({ findings: ["ANTERIOR.KNEE_VALGUS", "LATERAL.FORWARD_HEAD", "POSTERIOR.OTHER_VISUAL"], notes: "Foto não feita" });
    expect(saved.movement).toEqual([
      { test: "SQUAT", grade: "MILD", notes: null },
      { test: "PUSH", grade: "STOPPED_BY_PAIN", notes: "Dor no ombro direito" },
      { test: "PULL", grade: "NOT_ASSESSED", notes: "Sem equipamento hoje" },
    ]);
    // Posture and movement are not screening: nothing changed the status.
    expect(saved.riskStatus).toBe("CLEAR");

    // Another save replaces everything, it does not add.
    await api().saveDraft(started.id, { ...base, posture: { findings: ["LATERAL.KYPHOSIS"] }, movement: [{ test: "LUNGE", grade: "NO_LIMITATION" }] }, day(28));
    expect(await rows(started.id)).toEqual([
      { area: "POSTURE", item: "LATERAL.KYPHOSIS", grade: null, notes: null },
      { area: "MOVEMENT", item: "LUNGE", grade: "NO_LIMITATION", notes: null },
    ]);
    // What is not sent is not kept: a save without the fields clears them.
    await api().saveDraft(started.id, base, day(28));
    expect(await rows(started.id)).toEqual([]);
    expect((await api().get(started.id))?.posture).toEqual({ findings: [], notes: null });
  });

  it("is refused to anyone else, and an invalid payload writes nothing", async () => {
    const draft = (await api().listForStudent("st-2")).find((x) => x.state === "DRAFT")!;
    await api().saveDraft(draft.id, { assessedOn: "2026-11-28", posture: { findings: ["ANTERIOR.HEAD_TILT"] }, movement: [{ test: "SQUAT", grade: "MODERATE" }] }, day(28));
    const before = await rows(draft.id);
    expect(before).toHaveLength(2);
    for (const user of ["tech-a", "owner-a", "commercial-a", "client-1", "mgr-1"])
      expect(await assessmentsFor(db, scope(user)).saveDraft(draft.id, { assessedOn: "2026-11-28", posture: { findings: ["LATERAL.LORDOSIS"] }, movement: [] }, day(28)), user).toBe(false);
    expect(await rows(draft.id)).toEqual(before);
    await expect(api().saveDraft(draft.id, { assessedOn: "2026-11-28", posture: { findings: ["NOPE"] } }, day(28))).rejects.toThrow();
    expect(await rows(draft.id)).toEqual(before);
  });

  it("freezes them with the recorded assessment, against direct SQL too", async () => {
    const draft = (await api().listForStudent("st-2")).find((x) => x.state === "DRAFT")!;
    expect(await api().record(draft.id, { screeningAsked: true }, day(28))).toEqual({ status: "recorded", riskStatus: "CLEAR" });
    const before = await rows(draft.id);
    expect(await api().saveDraft(draft.id, { assessedOn: "2026-11-28", posture: { findings: [] }, movement: [] }, day(29))).toBe(false);
    expect(await rows(draft.id)).toEqual(before);
    const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).run();
    await expect(run("UPDATE assessment_findings SET grade = 'NO_LIMITATION' WHERE assessment_id = ?1 AND area = 'MOVEMENT'", draft.id)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(run("DELETE FROM assessment_findings WHERE assessment_id = ?1", draft.id)).rejects.toThrow(/ASSESSMENT_FROZEN/);
    await expect(
      run("INSERT INTO assessment_findings(id,organization_id,assessment_id,area,item) VALUES ('f-late','org-a',?1,'POSTURE','ANTERIOR.FOOT_ASYMMETRY')", draft.id),
    ).rejects.toThrow(/ASSESSMENT_FROZEN/);
    expect((await api().get(draft.id))?.movement).toEqual([{ test: "SQUAT", grade: "MODERATE", notes: null }]);
  });

  it("keeps the rows consistent in the database itself", async () => {
    const started = await api().startDraft("st-2", day(30));
    if (started.status !== "started") throw new Error(started.status);
    const insert = (area: string, item: string, grade: string | null) =>
      db.prepare("INSERT INTO assessment_findings(id,organization_id,assessment_id,area,item,grade) VALUES (?1,'org-a',?2,?3,?4,?5)").bind(crypto.randomUUID(), started.id, area, item, grade).run();
    await expect(insert("MOVEMENT", "SQUAT", null)).rejects.toThrow(); // a test needs its grade
    await expect(insert("POSTURE", "LATERAL.KYPHOSIS", "MILD")).rejects.toThrow(); // a finding has none
    await expect(insert("OTHER", "X", null)).rejects.toThrow();
    await insert("POSTURE", "LATERAL.KYPHOSIS", null);
    await expect(insert("POSTURE", "LATERAL.KYPHOSIS", null)).rejects.toThrow(/UNIQUE/);
    await expect(
      db.prepare("INSERT INTO assessment_findings(id,organization_id,assessment_id,area,item) VALUES ('x','org-b',?1,'POSTURE','ANTERIOR.HEAD_TILT')").bind(started.id).run(),
    ).rejects.toThrow(); // the assessment is not in that organization
    await db.prepare("DELETE FROM assessment_findings WHERE assessment_id = ?1").bind(started.id).run();
    await db.prepare("DELETE FROM assessments WHERE id = ?1").bind(started.id).run();
  });
});
