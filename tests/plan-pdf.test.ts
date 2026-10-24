import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { StudentExercise, StudentTrainingPlan } from "@/db/student-plan";
import { pdfFileName, planFingerprint, printable, renderPlanPdf, safeLink, wrap } from "@/modules/pdf/plan-pdf";

const exercise = (name: string, extra: Partial<StudentExercise> = {}): StudentExercise => ({
  name,
  videoUrl: "https://www.youtube.com/results?search_query=agachamento",
  videoStatus: "SEARCH_LINK",
  sets: "3",
  reps: "8-12",
  loadInstruction: null,
  cadence: null,
  restSeconds: 60,
  restText: null,
  rirMin: null,
  rirMax: null,
  notes: null,
  ...extra,
});
const plan = (extra: Partial<StudentTrainingPlan> = {}): StudentTrainingPlan => ({
  planId: "plan-1",
  revisionId: "rev-1",
  title: "Plano de hipertrofia",
  revisionNumber: 2,
  deliveredAt: "2026-11-10T13:00:00.000Z",
  deliveredBy: "Profissional Teste",
  startDate: "2026-11-02",
  endDate: "2027-01-24",
  phases: [1, 2, 3].map((index) => ({
    index,
    startDate: "2026-11-02",
    endDate: "2026-11-29",
    weeks: 4,
    sessionsPerWeek: 3,
    split: "Full Body",
    workouts: [
      {
        label: "Full Body",
        exercises: [exercise("Agachamento goblet"), exercise("Remada baixa", { videoUrl: null, videoStatus: "NONE" })],
      },
    ],
  })),
  ...extra,
});
const input = (p = plan(), generatedAt = new Date("2026-11-11T12:00:00Z")) => ({
  studentName: "Aluna Exemplo",
  organizationName: "Estúdio Exemplo",
  plan: p,
  generatedAt,
});

/** Text drawn on the pages: pdf-lib writes standard-font strings as hex of WinAnsi codes. */
function textOf(doc: PDFDocument): string {
  let out = "";
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      for (const match of operators.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))
        out += Buffer.from(match[1], "hex").toString("latin1") + "\n";
    }
  }
  return out;
}
function linksOf(doc: PDFDocument): string[] {
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (const ref of annots.asArray()) {
      const annot = doc.context.lookup(ref, PDFDict);
      const action = doc.context.lookup(annot.get(PDFName.of("A")), PDFDict);
      out.push((action.get(PDFName.of("URI")) as PDFString).decodeText());
    }
  }
  return out;
}

describe("the delivered plan as a PDF", () => {
  it("prints the plan exactly as delivered, with version, date and professional", async () => {
    const bytes = await renderPlanPdf(input());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    const text = textOf(doc);
    for (const expected of [
      "PLANO DE TREINO", "Plano de hipertrofia", "Aluna Exemplo", "Profissional Teste", "Estúdio Exemplo",
      "02/11/2026 a 24/01/2027", "Revisão 2", "Fase 01", "Fase 03", "Treino Full Body",
      "Agachamento goblet", "Remada baixa", "3 séries × 8-12 repetições", "descanso 60 s",
      "Buscar vídeos de execução", "Gerado em 11/11/2026",
    ])
      expect(text, expected).toContain(expected);
    expect(doc.getTitle()).toBe("Plano de hipertrofia (revisão 2)");
    expect(doc.getAuthor()).toBe("Profissional Teste");
    const fingerprint = await planFingerprint(plan());
    expect(doc.getKeywords()).toBe(`revisao:rev-1 sha256:${fingerprint}`);
    expect(text).toContain(fingerprint.slice(0, 12));
  });

  it("does not invent anything: an empty dose says so, and a missing professional says so", async () => {
    const bare = plan({
      deliveredBy: null,
      phases: [
        {
          index: 1, startDate: "2026-11-02", endDate: "2026-11-29", weeks: 4, sessionsPerWeek: 3, split: "Full Body",
          workouts: [{ label: "Full Body", exercises: [exercise("Prancha", { sets: null, reps: null, restSeconds: null, videoUrl: null })] }],
        },
      ],
    });
    const text = textOf(await PDFDocument.load(await renderPlanPdf(input(bare))));
    expect(text).toContain("Sem parâmetros definidos");
    expect(text).toContain("Não informado");
    expect(text).not.toMatch(/séries|repetições|descanso/);
  });

  it("links only plain http(s) videos, one link per exercise that has one", async () => {
    const mixed = plan({
      phases: [
        {
          index: 1, startDate: "2026-11-02", endDate: "2026-11-29", weeks: 4, sessionsPerWeek: 3, split: "Full Body",
          workouts: [{
            label: "Full Body",
            exercises: [
              exercise("A", { videoUrl: "https://example.test/a", videoStatus: "VERIFIED" }),
              exercise("B", { videoUrl: "javascript:alert(1)" }),
              exercise("C", { videoUrl: "data:text/html,<b>x</b>" }),
              exercise("D", { videoUrl: "not a url" }),
              exercise("E", { videoUrl: "http://example.test/e", videoStatus: "VERIFIED" }),
            ],
          }],
        },
      ],
    });
    const doc = await PDFDocument.load(await renderPlanPdf(input(mixed)));
    expect(linksOf(doc)).toEqual(["https://example.test/a", "http://example.test/e"]);
    expect(textOf(doc)).toContain("Ver vídeo");
    expect(safeLink("ftp://example.test/x")).toBeNull();
    expect(safeLink(null)).toBeNull();
  });

  it("paginates a long plan without cutting an exercise, and numbers the pages", async () => {
    const long = plan({
      phases: Array.from({ length: 12 }, (_, i) => ({
        index: i + 1, startDate: "2026-11-02", endDate: "2026-11-29", weeks: 4, sessionsPerWeek: 3, split: "ABC",
        workouts: ["A", "B", "C"].map((label) => ({
          label,
          exercises: Array.from({ length: 8 }, (_, k) => exercise(`Exercício ${label}${k + 1}`, { notes: "Observação longa ".repeat(12) })),
        })),
      })),
    });
    const doc = await PDFDocument.load(await renderPlanPdf(input(long)));
    const pages = doc.getPageCount();
    expect(pages).toBeGreaterThan(10);
    const text = textOf(doc);
    expect(text).toContain(`Página 1 de ${pages}`);
    expect(text).toContain(`Página ${pages} de ${pages}`);
    // Every exercise of every phase is printed once.
    expect((text.match(/Exercício A1/g) ?? []).length).toBe(12);
    expect(linksOf(doc)).toHaveLength(12 * 3 * 8);
  });

  it("survives text the standard fonts cannot draw", async () => {
    const odd = plan({ title: "Plano 😀 ≥ Ω", phases: [{
      index: 1, startDate: "2026-11-02", endDate: "2026-11-29", weeks: 4, sessionsPerWeek: 3, split: "Full Body",
      workouts: [{ label: "Full Body", exercises: [exercise("Supino → inclinado\nlinha dois", { notes: "x".repeat(300) })] }],
    }] });
    const doc = await PDFDocument.load(await renderPlanPdf(input(odd)));
    const text = textOf(doc);
    expect(text).toContain("Plano ? >= ?");
    expect(text).toContain("Supino -> inclinado");
    expect(text).toContain("linha dois");
  });

  it("gives the same version to the same revision and a different one when anything delivered differs", async () => {
    const base = await planFingerprint(plan());
    expect(await planFingerprint(plan())).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    // Regenerating on another day changes the date, not the version.
    const a = textOf(await PDFDocument.load(await renderPlanPdf(input(plan(), new Date("2026-11-11T12:00:00Z")))));
    const b = textOf(await PDFDocument.load(await renderPlanPdf(input(plan(), new Date("2026-12-24T12:00:00Z")))));
    expect(a).toContain(base.slice(0, 12));
    expect(b).toContain(base.slice(0, 12));
    expect(a).toContain("Gerado em 11/11/2026");
    expect(b).toContain("Gerado em 24/12/2026");
    // A rename of the student or the space is not a new version.
    const renamed = await renderPlanPdf({ ...input(), studentName: "Outro nome", organizationName: null });
    expect(textOf(await PDFDocument.load(renamed))).toContain(base.slice(0, 12));
    // Anything delivered counts.
    const edited = plan();
    edited.phases[0].workouts[0].exercises[0] = exercise("Agachamento goblet", { reps: "10-15" });
    expect(await planFingerprint(edited)).not.toBe(base);
    for (const change of [
      { notes: "outra" }, { videoUrl: "https://example.test/z" }, { videoStatus: "VERIFIED" as const }, { sets: "4" },
      { cadence: "2-0-2" }, { restSeconds: 90 }, { restText: "1 min" }, { rirMin: 1 }, { rirMax: 2 }, { loadInstruction: "leve" },
    ]) {
      const other = plan();
      other.phases[1].workouts[0].exercises[1] = exercise("Remada baixa", { videoUrl: null, videoStatus: "NONE", ...change });
      expect(await planFingerprint(other), JSON.stringify(change)).not.toBe(base);
    }
    expect(await planFingerprint(plan({ revisionId: "rev-2" }))).not.toBe(base);
    expect(await planFingerprint(plan({ revisionNumber: 3 }))).not.toBe(base);
  });

  it("builds a safe file name", () => {
    expect(pdfFileName(plan({ title: "Hipertrofia — Ação/ç: 12 semanas!" }))).toBe("plano-Hipertrofia-Acao-c-12-semanas-rev2.pdf");
    expect(pdfFileName(plan({ title: "😀" }))).toBe("plano-treino-rev2.pdf");
    expect(pdfFileName(plan({ title: '"; filename="x.exe' }))).toMatch(/^plano-[A-Za-z0-9-]+-rev2\.pdf$/);
  });

  it("wraps and sanitizes", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont("Helvetica");
    expect(printable(font, "Ação ≥ 😀\t")).toBe("Ação >= ? ");
    const lines = wrap(font, 10, "uma frase razoavelmente longa para quebrar em varias linhas curtas", 120);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((line) => font.widthOfTextAtSize(line, 10) <= 120)).toBe(true);
    const cut = wrap(font, 10, "x".repeat(200), 100);
    expect(cut.length).toBeGreaterThan(1);
    expect(cut.join("")).toBe("x".repeat(200));
  });
});
