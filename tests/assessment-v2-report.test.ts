import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessmentsFor } from "@/db/assessments";
import { ASSESSMENT_PDF_DOWNLOADED, assessmentReportsFor, recordReportDownload, studentAssessmentsFor } from "@/db/assessment-reports";
import { renderAssessmentPdf } from "@/modules/pdf/assessment-pdf";
import { REPORT_NOTICE, assessmentReport, reportFileName, reportFingerprint, type ReportInput } from "@/modules/avaliacoes/v2/report";
import { readComposition } from "@/modules/avaliacoes/v2/composition";
import { readScreening } from "@/modules/avaliacoes/v2/screening";
import { readMovement } from "@/modules/avaliacoes/v2/flexitest";
import { readTests } from "@/modules/avaliacoes/v2/physical-tests";
import { readConclusion } from "@/modules/avaliacoes/v2/conclusion";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Slice 0.81: the report (PDF) of a recorded Avaliação Física, for the professional and for the student. It prints what was recorded and the
// results as computed at finalize; nothing measured is never 0; there is no classification; only who reaches the assessment gets it.

/** Text drawn on the pages: pdf-lib writes standard-font strings as hex of WinAnsi codes. */
function textOf(doc: PDFDocument): string {
  let out = "";
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      for (const match of operators.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += Buffer.from(match[1], "hex").toString("latin1") + "\n";
    }
  }
  return out;
}

const PARQ_CODES = ["heart_condition", "chest_pain_activity", "chest_pain_month", "dizziness", "bone_joint", "blood_pressure_medication", "other_reason"] as const;
const noParq = { parq: { answers: Object.fromEntries(PARQ_CODES.map((code) => [code, "no"])) } };
const JP7 = {
  weightKg: 69.1,
  heightCm: 171,
  protocol: "jackson_pollock_7",
  equation: "male",
  skinfolds: { chest: [12], midaxillary: [9], triceps: [24], subscapular: [11], abdominal: [16], suprailiac: [15], thigh: [35] },
  perimetersCm: { waist: 69.5, hip: 108 },
};

const empty = (extra: Partial<ReportInput> = {}): ReportInput => ({
  assessment: {
    id: "as-1",
    assessedOn: "2026-11-03",
    kind: "INITIAL",
    recordedAt: "2026-11-03T15:00:00.000Z",
    recordedByName: "Pro A",
    riskStatus: "CLEAR",
    reviewed: false,
    amendsAssessmentId: null,
    amendReason: null,
    amendedById: null,
  },
  amendsAssessedOn: null,
  amendedAt: null,
  studentName: "Aluno Exemplo",
  organizationName: "Studio A",
  results: [],
  profile: null,
  screening: null,
  composition: null,
  posture: null,
  movement: null,
  tests: null,
  conclusion: null,
  decidedBy: null,
  ...extra,
});

describe("the report of a recorded Avaliação Física (pure)", () => {
  it("reads every module not done as “Não realizado” and invents nothing", () => {
    const report = assessmentReport(empty());
    expect(report.title).toBe("Avaliação física");
    expect(report.sections.map((section) => section.title)).toEqual(["Triagem", "Medidas", "Resultados", "Postura e movimento", "Testes físicos", "Considerações finais"]);
    const text = JSON.stringify(report);
    for (const title of ["Medidas", "Postura e movimento", "Testes físicos"])
      expect(report.sections.find((section) => section.title === title)?.blocks).toEqual([{ kind: "text", text: "Não realizado.", muted: true }]);
    expect(text).toContain("Nenhum resultado foi calculado.");
    expect(text).toContain("Não escritas.");
    expect(text).not.toMatch(/\b0 (kg|cm|mm|m|%)\b|\bbom\b|\bruim\b|excelente|normal|percentil/i);
  });

  it("keeps an empty measure as “Sem aferição” and a typed classification as the professional's", () => {
    const report = assessmentReport(
      empty({
        composition: readComposition({ weightKg: 70, sidedPerimetersCm: { calf: { right: 40 } } }),
        movement: readMovement({ flexitest: { levels: { ankle_dorsiflexion: 2 }, classificationManual: "Médio" } }),
        tests: readTests({ cooper: { distanceM: 2200 } }),
      }),
    );
    const text = JSON.stringify(report);
    expect(text).toContain('"label":"Altura","value":"Sem aferição"');
    expect(text).toContain("D 40 cm / E Sem aferição");
    expect(text).toContain('"label":"Classificação (manual)","value":"Médio"');
    expect(text).toContain("Escrita pelo profissional. O sistema não classifica");
    expect(text).toContain("2.200 m em 12 min");
    expect(text).toContain("1 de 15 preenchido");
  });

  it("says an amendment amends and an amended one is the original", () => {
    const amendment = assessmentReport(
      empty({ assessment: { ...empty().assessment, amendsAssessmentId: "as-0", amendReason: "Peso digitado errado" }, amendsAssessedOn: "2026-11-01" }),
    );
    expect(amendment.title).toBe("Retificação da avaliação física");
    expect(amendment.facts).toContainEqual({ label: "Retifica", value: "a avaliação de 01/11/2026" });
    expect(amendment.facts).toContainEqual({ label: "Motivo da retificação", value: "Peso digitado errado" });
    const amended = assessmentReport(empty({ assessment: { ...empty().assessment, amendedById: "as-2" }, amendedAt: "2026-11-05T13:00:00.000Z" }));
    expect(amended.warning).toMatch(/^Retificada por uma retificação registrada em 05\/11\/2026,? 10:00\. Os dados abaixo são os originais/);
    expect(reportFileName({ assessedOn: "2026-11-03", kind: "REASSESSMENT", amendsAssessmentId: null })).toBe("reavaliacao-fisica-2026-11-03.pdf");
    expect(reportFileName({ assessedOn: "2026-11-03", kind: "INITIAL", amendsAssessmentId: "x" })).toBe("retificacao-avaliacao-fisica-2026-11-03.pdf");
  });

  it("prints the results as recorded at finalize, with method, formula version and estimate, never recomputed", async () => {
    const results = [
      { code: "body_fat_percent", value: 17.27, unit: "%", method: "jackson_pollock_7_male", formulaVersion: "av2-2026-11", inputs: null, flags: [] },
      { code: "waist_hip_ratio", value: 0.6435, unit: null, method: "waist_over_hip", formulaVersion: "av2-2026-11", inputs: null, flags: [] },
      { code: "cooper_vo2_estimate", value: 37.9, unit: "ml/kg/min", method: "cooper_12min_vo2_504_9_44_73", formulaVersion: "av2-2026-11", inputs: null, flags: [] },
    ];
    const report = assessmentReport(empty({ results }));
    const rows = report.sections.find((section) => section.title === "Resultados")!.blocks.find((block) => block.kind === "results");
    expect(rows).toMatchObject({
      rows: [
        { label: "Gordura estimada", value: "17,3%" },
        { label: "RCQ", value: "0,644", detail: "cintura ÷ quadril · fórmula av2-2026-11" },
        { label: "Cooper, VO₂máx estimado", value: "37,90 ml/kg/min", detail: "Cooper 12 min, (distância − 504,9) ÷ 44,73 · fórmula av2-2026-11 · estimativa" },
      ],
    });
    // The fingerprint follows the content, not the names nor the time of the download.
    const same = await reportFingerprint("as-1", report);
    expect(await reportFingerprint("as-1", assessmentReport(empty({ results, studentName: "Outro nome" })))).toBe(same);
    expect(await reportFingerprint("as-1", assessmentReport(empty()))).not.toBe(same);
  });
});

describe("the report as a PDF", () => {
  it("draws the header, the neutral line, the measures and the results; the same record keeps its version", async () => {
    const input = {
      ...empty({
        screening: readScreening({ ...noParq, anamnesis: { injuries: { answer: "yes", details: "Entorse em 2024" } } }),
        composition: readComposition(JP7),
        conclusion: readConclusion({ recommendations: "Treinar 3 vezes por semana." }),
        results: [{ code: "cooper_vo2_estimate", value: 37.9, unit: "ml/kg/min", method: "cooper_12min_vo2_504_9_44_73", formulaVersion: "av2-2026-11", inputs: null, flags: [] }],
      }),
      generatedAt: new Date("2026-11-04T12:00:00Z"),
    };
    const bytes = await renderAssessmentPdf(input);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    const text = textOf(doc);
    for (const expected of [
      "AVALIAÇÃO FÍSICA · RELATÓRIO", "Avaliação física de 03/11/2026", "Aluno Exemplo", "Pro A", "Studio A", "PAR-Q sem", // the curly quotes are WinAnsi 0x93/0x94, not latin1
      REPORT_NOTICE, "Triagem", "Entorse em 2024", "69,1 kg", "1,71 m", "Jackson & Pollock · 7", "Cintura", "69,5 cm",
      "Cooper, VO2máx estimado", "37,90 ml/kg/min", "Recomendações", "Treinar 3 vezes por semana.", "Não realizado.", "Gerado em 04/11/2026",
    ])
      expect(text, expected).toContain(expected);
    expect(doc.getTitle()).toBe("Avaliação física de 03/11/2026");
    expect(doc.getAuthor()).toBe("Pro A");
    const keywords = doc.getKeywords()!;
    expect(keywords).toMatch(/^avaliacao:as-1 sha256:[0-9a-f]{64}$/);
    const again = await PDFDocument.load(await renderAssessmentPdf({ ...input, generatedAt: new Date("2026-12-01T12:00:00Z") }));
    expect(again.getKeywords()).toBe(keywords);
  });

  it("flows a long text over more pages with a footer on each", async () => {
    const long = Array.from({ length: 60 }, (_, index) => `Linha ${index + 1} das considerações do profissional, escrita com calma e por extenso.`).join("\n");
    const doc = await PDFDocument.load(
      await renderAssessmentPdf({ ...empty({ conclusion: readConclusion({ considerations: long.slice(0, 4000) }) }), generatedAt: new Date("2026-11-04T12:00:00Z") }),
    );
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const text = textOf(doc);
    expect(text).toContain(`Página ${doc.getPageCount()} de ${doc.getPageCount()}`);
  });
});

describe("who gets the report (local D1)", () => {
  let mf: Miniflare;
  let db: D1Database;
  const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
  let recorded = "";
  let draft = "";

  beforeAll(async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default { fetch() { return new Response('test'); } };",
        compatibilityDate: "2026-10-23",
        d1Databases: { DB: "assessment-v2-report-tests" },
        cf: false,
      }),
    );
    db = await mf.getD1Database("DB");
    await migrate(db, ALL_MIGRATIONS);
    await db.batch([
      ...["tech-a", "tech-b", "client-1", "client-2"].map((id) =>
        db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`),
      ),
      db.prepare("INSERT INTO users(id) VALUES ('tech-a'),('tech-b'),('client-1'),('client-2')"),
      db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
      db.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES ('org-a','tech-a','TECHNICAL'),('org-b','tech-b','TECHNICAL')"),
      db.prepare("INSERT INTO professionals(id,organization_id,user_id,display_name) VALUES ('pro-a','org-a','tech-a','Pro A'),('pro-b','org-b','tech-b','Pro B')"),
      db.prepare("INSERT INTO students(id,organization_id,display_name) VALUES ('st-1','org-a','One'),('st-2','org-a','Two'),('st-b','org-b','B')"),
      db.prepare("INSERT INTO care_assignments(organization_id,student_id,professional_id) VALUES ('org-a','st-1','pro-a'),('org-a','st-2','pro-a'),('org-b','st-b','pro-b')"),
      db.prepare("INSERT INTO student_profiles(student_id,organization_id,birth_date,gender,height_cm,weight_kg,goal,updated_by_user_id) VALUES ('st-1','org-a','1999-03-04','Masculino',171,69.1,'Hipertrofia','tech-a')"),
      db.prepare("INSERT INTO student_access(organization_id,student_id,user_id) VALUES ('org-a','st-1','client-1'),('org-a','st-2','client-2')"),
    ]);
    const api = assessmentsFor(db, scope("tech-a"));
    const started = await api.startDraft("st-1", new Date("2026-11-03T12:00:00Z"));
    if (started.status !== "started") throw new Error(started.status);
    recorded = started.id;
    let revision = (await api.sections(recorded))!.revision;
    for (const [module, payload] of Object.entries({ screening: noParq, composition: JP7 })) {
      const saved = await api.saveSection(recorded, { module: module as never, status: "IN_PROGRESS", payload, revision });
      if (saved.status !== "saved") throw new Error(saved.status);
      revision = saved.revision;
    }
    expect(await api.finalize(recorded, revision, new Date("2026-11-03T15:00:00Z"))).toEqual({ status: "recorded" });
    const second = await api.startDraft("st-1", new Date("2026-11-04T12:00:00Z"));
    if (second.status !== "started") throw new Error(second.status);
    draft = second.id;
  });
  afterAll(async () => {
    await mf?.dispose();
  });

  it("the professional with technical care reads the recorded one, with the results written at finalize", async () => {
    const source = await assessmentReportsFor(db, scope("tech-a")).source("st-1", recorded);
    expect(source).toMatchObject({ studentName: "One", organizationName: "Studio A", assessment: { id: recorded, recordedByName: "Pro A", riskStatus: "CLEAR" } });
    expect(source!.composition?.weightKg).toBe(69.1);
    expect(source!.posture).toBeNull();
    expect(source!.results.find((result) => result.code === "waist_hip_ratio")).toMatchObject({ method: "waist_over_hip", formulaVersion: expect.any(String) });
    expect(source!.results.find((result) => result.code === "sum_skinfolds")?.value).toBe(122);
  });

  it("refuses a draft, the wrong student, another organization and a professional without care", async () => {
    expect(await assessmentReportsFor(db, scope("tech-a")).source("st-1", draft)).toBeNull();
    expect(await assessmentReportsFor(db, scope("tech-a")).source("st-2", recorded)).toBeNull();
    expect(await assessmentReportsFor(db, scope("tech-b", "org-b")).source("st-1", recorded)).toBeNull();
    expect(await assessmentReportsFor(db, scope("tech-b", "org-a")).source("st-1", recorded)).toBeNull();
    await db.prepare("UPDATE care_assignments SET revoked_at = '2026-11-05T00:00:00Z' WHERE student_id = 'st-1'").run();
    expect(await assessmentReportsFor(db, scope("tech-a")).source("st-1", recorded)).toBeNull();
    await db.prepare("UPDATE care_assignments SET revoked_at = NULL WHERE student_id = 'st-1'").run();
  });

  it("the linked student lists and reads their own recorded ones; nobody else does", async () => {
    const mine = studentAssessmentsFor(db, "client-1", "st-1");
    expect(await mine.list()).toEqual([
      { id: recorded, assessedOn: expect.any(String), kind: "INITIAL", recordedAt: "2026-11-03T15:00:00.000Z", amendsAssessmentId: null, amendedById: null },
    ]);
    expect((await mine.source(recorded))?.assessment.id).toBe(recorded);
    expect(await mine.source(draft)).toBeNull();
    expect(await studentAssessmentsFor(db, "client-2", "st-1").list()).toEqual([]);
    expect(await studentAssessmentsFor(db, "client-2", "st-1").source(recorded)).toBeNull();
    expect(await studentAssessmentsFor(db, "client-2", "st-2").source(recorded)).toBeNull();
    expect(await studentAssessmentsFor(db, "tech-a", "st-1").source(recorded)).toBeNull();
    expect(await studentAssessmentsFor(db, "", "st-1").list()).toEqual([]);
    // A revoked link reads nothing.
    await db.prepare("UPDATE student_access SET revoked_at = '2026-11-05T00:00:00Z' WHERE user_id = 'client-1'").run();
    expect(await mine.list()).toEqual([]);
    expect(await mine.source(recorded)).toBeNull();
    await db.prepare("UPDATE student_access SET revoked_at = NULL WHERE user_id = 'client-1'").run();
  });

  it("records who downloaded which report and when, never the content", async () => {
    await recordReportDownload(db, { organizationId: "org-a", actorUserId: "client-1", assessmentId: recorded }, new Date("2026-11-05T10:00:00Z"));
    expect(
      await db.prepare("SELECT organization_id AS org, actor_user_id AS actor, subject_id AS subject FROM access_audit_events WHERE action = ?1").bind(ASSESSMENT_PDF_DOWNLOADED).first(),
    ).toEqual({ org: "org-a", actor: "client-1", subject: recorded });
  });
});
