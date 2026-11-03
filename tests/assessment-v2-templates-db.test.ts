import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentsFor } from "@/db/assessments";
import { assessmentTemplatesFor } from "@/db/assessment-templates";
import { assessmentReportsFor } from "@/db/assessment-reports";
import { assessmentPhotosFor } from "@/db/assessment-photos";
import type { R2Bucket } from "@cloudflare/workers-types";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Slice 0.85 on a real local D1 with every migration (0036 included): the models of the Avaliação Física. Only a technical member of the
// organization writes them; editing writes a new version and a draft keeps the one it started with; a part left out holds nothing and never blocks
// the finalize; an amendment keeps the model of what it amends; nothing of one organization reaches another. Identities are rows, as the server
// derives them from a verified session.
let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const one = <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const fails = async (sql: string, ...binds: unknown[]) => {
  try {
    await db.prepare(sql).bind(...binds).run();
    return "";
  } catch (error) {
    return String(error);
  }
};
const t = (user = "tech-a", org = "org-a") => assessmentTemplatesFor(db, scope(user, org));
const a = (user = "tech-a", org = "org-a") => assessmentsFor(db, scope(user, org));
const ORDER = ["medidas", "movimento", "testes"];
const PARQ_CODES = ["heart_condition", "chest_pain_activity", "chest_pain_month", "dizziness", "bone_joint", "blood_pressure_medication", "other_reason"] as const;
const noParq = { parq: { answers: Object.fromEntries(PARQ_CODES.map((code) => [code, "no"])) } };

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "assessment-v2-templates-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  await db.batch([
    ...["tech-a", "sales-a", "tech-b"].map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare("INSERT INTO users(id) VALUES ('tech-a'),('sales-a'),('tech-b')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-a','sales-a','COMMERCIAL'),('org-b','tech-b','TECHNICAL')"),
    db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B')"),
    db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-2','org-a','Two'),('st-b','org-b','B')"),
    db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a'),('org-b','st-b','pro-b')"),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe("models of the Avaliação Física", () => {
  let id = "";
  it("are created by a technical member, version 1, with the parts in the order of the steps", async () => {
    const created = await t().create({ name: "Corrida", parts: ["conclusion", "cooper", "basics"], stepOrder: ["testes", "medidas", "movimento"] });
    expect(created).toMatchObject({ status: "saved", version: 1 });
    id = (created as { id: string }).id;
    expect(await t().get(id)).toMatchObject({ name: "Corrida", version: 1, enabled: ["cooper", "basics", "conclusion"], archivedAt: null, assessments: 0 });
    expect(await t().create({ name: "", parts: [], stepOrder: ORDER })).toEqual({ status: "invalid" });
  });

  it("are not written nor read by a commercial member, nor by another organization", async () => {
    expect(await t("sales-a").create({ name: "Vendas", parts: [], stepOrder: ORDER })).toEqual({ status: "not_found" });
    expect(await t("sales-a").list()).toEqual([]);
    expect(await t("tech-b", "org-b").get(id)).toBeNull();
    expect(await t("tech-b", "org-b").list()).toEqual([]);
    expect(await t("tech-b", "org-b").update(id, { name: "X", parts: [], stepOrder: ORDER }, 1)).toEqual({ status: "not_found" });
    expect(await t("tech-b", "org-b").setArchived(id, true)).toBe(false);
    // Straight into the database too: the triggers ask for a technical member of that organization.
    expect(await fails("INSERT INTO assessment_form_templates (id, organization_id, created_by_user_id, created_at) VALUES ('t-x','org-a','sales-a','x')")).toContain(
      "TEMPLATE_NOT_AUTHORIZED",
    );
    expect(await fails("INSERT INTO assessment_form_templates (id, organization_id, created_by_user_id, created_at) VALUES ('t-x','org-a','tech-b','x')")).toContain(
      "TEMPLATE_NOT_AUTHORIZED",
    );
  });

  it("start a draft that keeps the version and a copy of its list; the default stays every part", async () => {
    const started = await a().startDraft("st-1", new Date("2026-11-03T12:00:00Z"), { templateId: id });
    expect(started.status).toBe("started");
    const draft = (started as { id: string }).id;
    expect(await a().sections(draft)).toMatchObject({ template: { id, version: 1, name: "Corrida" }, enabled: ["cooper", "basics", "conclusion"] });
    const plain = await a().startDraft("st-2", new Date("2026-11-03T12:00:00Z"));
    expect(await a().sections((plain as { id: string }).id)).toMatchObject({ template: null, enabled: null });
    // A model of another organization is not one of this organization's.
    expect(await a("tech-b", "org-b").startDraft("st-b", new Date(), { templateId: id })).toEqual({ status: "template_not_found" });
    expect(await one("SELECT count(*) AS n FROM assessments WHERE student_id = 'st-b'")).toEqual({ n: 0 });
  });

  it("are edited as a new version; a draft started before keeps its own; nothing changed writes no version; a stale screen is a conflict", async () => {
    expect(await t().update(id, { name: "Corrida", parts: ["cooper", "basics", "conclusion"], stepOrder: ["testes", "medidas", "movimento"] }, 1)).toEqual({
      status: "unchanged",
      id,
      version: 1,
    });
    expect(await t().update(id, { name: "Corrida longa", parts: ["cooper", "perimeters"], stepOrder: ORDER }, 1)).toEqual({ status: "saved", id, version: 2 });
    expect(await t().update(id, { name: "Outra", parts: [], stepOrder: ORDER }, 1)).toEqual({ status: "conflict" });
    expect(await t().get(id)).toMatchObject({ name: "Corrida longa", version: 2, enabled: ["perimeters", "cooper"], assessments: 1 });
    const draft = await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-1' AND state = 'DRAFT'");
    expect(await a().sections(draft!.id)).toMatchObject({ template: { version: 1, name: "Corrida" }, enabled: ["cooper", "basics", "conclusion"] });
    // A version is written once.
    expect(await fails("UPDATE assessment_form_template_versions SET name = 'x' WHERE template_id = ?1", id)).toContain("TEMPLATE_VERSION_FIXED");
    expect(await fails("DELETE FROM assessment_form_template_versions WHERE template_id = ?1", id)).toContain("TEMPLATE_VERSION_FIXED");
    expect(await fails("DELETE FROM assessment_form_templates WHERE id = ?1", id)).toContain("TEMPLATE_FIXED");
  });

  it("never land silently in a draft of another model, nor start with a version newer than the one the screen named", async () => {
    // st-1 has a draft of the model (version 1); st-2 one without a model. The model is now in version 2.
    expect((await a().startDraft("st-1", new Date(), { templateId: id })).status).toBe("draft_open");
    expect((await a().startDraft("st-1", new Date())).status).toBe("draft_open_other_model");
    expect((await a().startDraft("st-2", new Date(), { templateId: id })).status).toBe("draft_open_other_model");
    expect(await a().startDraft("st-2", new Date(), { templateId: id, templateVersion: 1 })).toEqual({ status: "template_changed", version: 2 });
    expect(await one("SELECT count(*) AS n FROM assessments WHERE student_id IN ('st-1','st-2')")).toEqual({ n: 2 });
  });

  it("take no postural photo on a draft whose model leaves the postural assessment out, and say so (not “not found”)", async () => {
    const draft = (await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-1' AND state = 'DRAFT'"))!.id;
    // The refusal comes before any image is read or stored: the storage is never touched.
    const untouched = new Proxy({}, { get: () => { throw new Error("storage touched"); } }) as unknown as R2Bucket;
    expect(await assessmentPhotosFor(db, untouched, scope("tech-a")).put(draft, "ANTERIOR", new Uint8Array([0xff, 0xd8]))).toEqual({ status: "not_included" });
    expect(await assessmentPhotosFor(db, untouched, scope("tech-b", "org-b")).put(draft, "ANTERIOR", new Uint8Array([0xff, 0xd8]))).toEqual({ status: "not_found" });
  });

  it("refuse a save with something in a part the draft's model leaves out, and never block the finalize", async () => {
    const draft = (await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-1' AND state = 'DRAFT'"))!.id;
    let revision = (await a().sections(draft))!.revision;
    expect(await a().saveSection(draft, { module: "composition", status: "IN_PROGRESS", payload: { perimetersCm: { waist: 80, hip: 100 } }, revision })).toEqual({
      status: "excluded",
      parts: ["perimeters"],
    });
    expect(await a().saveSection(draft, { module: "tests", status: "IN_PROGRESS", payload: { abdominal: { repetitions: 30 } }, revision })).toEqual({
      status: "excluded",
      parts: ["abdominal"],
    });
    for (const [module, payload] of [
      ["screening", noParq],
      ["composition", { weightKg: 70, heightCm: 170 }],
      ["tests", { cooper: { distanceM: 2200 } }],
    ] as const) {
      const saved = await a().saveSection(draft, { module, status: "IN_PROGRESS", payload, revision });
      if (saved.status !== "saved") throw new Error(saved.status);
      revision = saved.revision;
    }
    expect(await a().finalize(draft, revision, new Date("2026-11-03T15:00:00Z"))).toEqual({ status: "recorded" });
    const codes = (await a().results(draft)).map((result) => result.code);
    expect(codes).toEqual(["bmi", "cooper_speed_kmh", "cooper_vo2_estimate"]);
    // The report says what the model left out, with the model's name and version.
    const report = await assessmentReportsFor(db, scope("tech-a")).source("st-1", draft);
    expect(report).toMatchObject({ template: { name: "Corrida", version: 1 }, enabled: ["cooper", "basics", "conclusion"] });
  });

  it("keep the model of an assessment fixed (draft or recorded), and its list equal to the version's", async () => {
    const recorded = (await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-1' AND state = 'RECORDED'"))!.id;
    expect(await fails("UPDATE assessments SET enabled_modules = '[]' WHERE id = ?1", recorded)).toContain("ASSESSMENT_TEMPLATE_FIXED");
    expect(await fails("UPDATE assessments SET template_version = 2 WHERE id = ?1", recorded)).toContain("ASSESSMENT_TEMPLATE_FIXED");
    const draft = (await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-2' AND state = 'DRAFT'"))!.id;
    expect(await fails("UPDATE assessments SET template_id = ?2, template_version = 1, enabled_modules = '[\"cooper\",\"basics\",\"conclusion\"]' WHERE id = ?1", draft, id)).toContain(
      "ASSESSMENT_TEMPLATE_FIXED",
    );
    const insert = (row: string, template: string | null, version: number | null, list: string | null, org = "org-a", student = "st-2") =>
      fails(
        `INSERT INTO assessments (id,organization_id,student_id,assessed_on,kind,state,risk_status,created_by_user_id,format_version,template_id,template_version,enabled_modules)
         VALUES (?1,?5,?6,'2026-11-05','INITIAL','DRAFT','CLEAR','tech-a',2,?2,?3,?4)`,
        row,
        template,
        version,
        list,
        org,
        student,
      );
    expect(await insert("x1", id, 1, '["cooper"]')).toContain("ASSESSMENT_TEMPLATE_INVALID");
    expect(await insert("x2", id, null, null)).toContain("ASSESSMENT_TEMPLATE_INVALID");
    expect(await insert("x3", null, null, '["cooper"]')).toContain("ASSESSMENT_TEMPLATE_INVALID");
    expect(await insert("x4", id, 9, '["cooper"]')).toContain("ASSESSMENT_TEMPLATE_INVALID");
    expect(await insert("x5", id, 2, '["perimeters","cooper"]', "org-b", "st-b")).toContain("ASSESSMENT_TEMPLATE_INVALID");
  });

  it("go with an amendment: it keeps the model and version of what it amends", async () => {
    const recorded = (await one<{ id: string }>("SELECT id FROM assessments WHERE student_id = 'st-1' AND state = 'RECORDED'"))!.id;
    const amended = await a().amend(recorded, "peso digitado errado", new Date("2026-11-04T12:00:00Z"));
    expect(amended.status).toBe("started");
    expect(await a().sections((amended as { id: string }).id)).toMatchObject({ template: { id, version: 1 }, enabled: ["cooper", "basics", "conclusion"] });
  });

  it("are archived (no longer offered; what was made with them stays) and brought back", async () => {
    expect(await t().setArchived(id, true)).toBe(true);
    expect(await t().list()).toEqual([]);
    expect((await t().list({ includeArchived: true }))[0]).toMatchObject({ id, archivedAt: expect.any(String) });
    expect(await a().startDraft("st-2", new Date(), { templateId: id })).toEqual({ status: "template_not_found" });
    expect(await t().update(id, { name: "X", parts: [], stepOrder: ORDER }, 2)).toEqual({ status: "not_found" });
    expect(await t().setArchived(id, false)).toBe(true);
    expect((await t().list()).map((item) => item.id)).toEqual([id]);
  });
});
