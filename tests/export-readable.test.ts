import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { EXPORT_CHECKIN_LIMIT, EXPORT_INCLUDED, EXPORT_NOT_INCLUDED, type ExportLinkSource, type ExportSource } from "@/modules/pedidos/export";
import { READABLE_EMPTY_NOTE, READABLE_HEALTH_NOTE, readableExport, readablePdfFileName, type ReadableExport } from "@/modules/pedidos/export-readable";
import { renderExportPdf } from "@/modules/pdf/export-pdf";

const NOW = new Date("2026-11-12T15:00:00.000Z");

const link = (extra: Partial<ExportLinkSource> = {}): ExportLinkSource => ({
  organizationName: "Estúdio Exemplo",
  studentName: "Aluna Exemplo",
  professionalName: "Profissional Teste",
  since: "2026-11-01T10:00:00.000Z",
  checkins: [
    {
      checkedOn: "2026-11-12",
      effort: 6,
      recovery: 3,
      discomfort: true,
      discomfortNotes: "ombro",
      notes: "cansada",
      createdAt: NOW.toISOString(),
      read: true,
      questions: [
        { question: "Dormiu bem?", answer: "Sim, 8 horas" },
        { question: "Comeu antes?", answer: null },
      ],
      replies: [{ author: "Profissional Teste", body: "Vamos aliviar o ombro.", createdAt: "2026-11-12T16:00:00.000Z" }],
    },
    {
      checkedOn: "2026-11-11",
      effort: null,
      recovery: null,
      discomfort: false,
      discomfortNotes: null,
      notes: null,
      createdAt: "2026-11-11T15:00:00.000Z",
      read: false,
      questions: [],
      replies: [],
    },
  ],
  checkinsCut: false,
  sessions: [
    {
      performedOn: "2026-11-12",
      planTitle: "Plano de força",
      phaseIndex: 1,
      workoutLabel: "A",
      effort: null,
      painReported: false,
      notes: "boa sessão",
      createdAt: NOW.toISOString(),
      read: false,
      exercises: [
        { name: "Agachamento", done: true, rir: null, pain: false, notes: null, sets: [{ setNumber: 1, reps: 10, loadKg: 22.5 }, { setNumber: 2, reps: null, loadKg: null }] },
        { name: "Remada", done: false, rir: 0, pain: false, notes: "sem tempo", sets: [] },
      ],
    },
  ],
  sessionsCut: false,
  plans: [
    {
      title: "Plano de força",
      revisionNumber: 2,
      deliveredAt: "2026-11-02T13:00:00.000Z",
      deliveredBy: "Profissional Teste",
      deliveredOrganizationName: "Estúdio Antigo",
      startDate: "2026-11-02",
      endDate: "2027-01-24",
      phases: [
        {
          index: 1,
          startDate: "2026-11-02",
          endDate: "2026-11-29",
          weeks: 4,
          sessionsPerWeek: 1,
          split: "Full Body",
          workouts: [
            {
              label: "A",
              exercises: [
                { name: "Agachamento", videoUrl: "https://example.test/v", sets: "3", reps: "8-12", loadInstruction: null, cadence: null, restSeconds: 60, restText: null, rirMin: null, rirMax: null, notes: "joelho alinhado" },
                { name: "Prancha", videoUrl: null, sets: null, reps: null, loadInstruction: null, cadence: null, restSeconds: null, restText: null, rirMin: null, rirMax: null, notes: null },
              ],
            },
            { label: "B", exercises: [] },
          ],
        },
      ],
    },
  ],
  requests: [
    { kind: "CORRECTION", message: "meu nome está errado", createdAt: NOW.toISOString(), dueAt: "2026-11-27T15:00:00.000Z", outcome: null, outcomeNote: null, decidedAt: null },
    { kind: "ACCESS", message: null, createdAt: NOW.toISOString(), dueAt: "2026-11-27T15:00:00.000Z", outcome: "PARTIALLY_FULFILLED", outcomeNote: "Enviei por e-mail.", decidedAt: "2026-11-13T15:00:00.000Z" },
  ],
  requestsCut: false,
  ...extra,
});

const source = (extra: Partial<ExportSource> = {}): ExportSource => ({
  generatedAt: NOW,
  account: { name: "Aluna Exemplo", email: "aluna@example.test" },
  acceptances: [{ termsVersion: "v1", termsSha256: "a".repeat(64), photosAuthorized: false, acceptedAt: "2026-11-01T10:00:00.000Z" }],
  links: [link()],
  ...extra,
});

/** Every row of a section, as "label: value". */
function rowsOf(readable: ReadableExport, id: string): string[] {
  const section = readable.sections.find((item) => item.id === id);
  if (!section) throw new Error(`no section ${id}`);
  return section.blocks.flatMap((block) =>
    block.kind === "facts" ? block.rows.map((row) => `${row.label}: ${row.value}`) : block.kind === "list" ? block.items : [block.text],
  );
}

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

describe("the readable copy", () => {
  it("has the same sections as the file, in order, and says what it does not carry", () => {
    const readable = readableExport(source());
    expect(readable.generatedAt).toBe(NOW.toISOString());
    expect(readable.sections.map((section) => section.title)).toEqual([
      "Sobre esta cópia",
      "Seus dados de acesso",
      "Aceites dos termos",
      "Seu profissional",
      "Check-ins",
      "Treinos que você registrou",
      "Treino entregue",
      "Pedidos sobre os seus dados",
    ]);
    const about = rowsOf(readable, "sobre");
    for (const item of [...EXPORT_INCLUDED, ...EXPORT_NOT_INCLUDED, READABLE_EMPTY_NOTE]) expect(about).toContain(item);
    expect(rowsOf(readable, "conta")).toEqual(["Nome: Aluna Exemplo", "E-mail: aluna@example.test"]);
    expect(rowsOf(readable, "aceites")).toEqual(
      expect.arrayContaining(["Versão dos termos: v1", "Fotos autorizadas: Não", `Impressão do texto (SHA-256): ${"a".repeat(64)}`]),
    );
  });

  it("writes every value as recorded and an empty one in words, never as 0", () => {
    const readable = readableExport(source());
    const checkins = rowsOf(readable, "check-ins");
    expect(checkins).toEqual(
      expect.arrayContaining([
        "Check-in de 12/11/2026",
        "Esforço percebido: 6 de 10",
        "Recuperação: Mais ou menos",
        "Desconforto: Sim",
        "Sobre o desconforto: ombro",
        "Observações: cansada",
        "Dormiu bem?: Sim, 8 horas",
        "Comeu antes?: Sem resposta",
        "Lido pelo profissional: Sim",
        "Resposta do profissional: Vamos aliviar o ombro. (Profissional Teste, 12/11/2026, 13:00)",
        "Check-in de 11/11/2026",
        "Esforço percebido: Não informado",
        "Recuperação: Não informado",
        "Observações: Sem registro",
      ]),
    );
    // No discomfort and no note: the line is left out instead of saying "Sem registro" about nothing.
    expect(checkins.filter((line) => line.startsWith("Sobre o desconforto"))).toHaveLength(1);

    const sessions = rowsOf(readable, "treinos-registrados");
    expect(sessions).toEqual(
      expect.arrayContaining([
        "Treino A de 12/11/2026",
        "Plano: Plano de força · fase 1",
        "Esforço percebido: Não informado",
        "Observações: boa sessão",
        "Exercício: Agachamento",
        "Repetições em reserva (RIR): Não informado",
        "Séries: Série 1: 10 repetições · 22,5 kg\nSérie 2: repetições não informadas · carga não informada",
        "Exercício: Remada",
        // A recorded zero stays a zero: it is what the student typed.
        "Repetições em reserva (RIR): 0",
        "Séries: Sem registro",
        "Observações: sem tempo",
      ]),
    );
    // A logged exercise with no note says so (Agachamento) instead of dropping the line.
    expect(sessions.filter((line) => line.startsWith("Observações"))).toEqual([
      "Observações: boa sessão",
      "Observações: Sem registro",
      "Observações: sem tempo",
    ]);
    for (const line of [...checkins, ...sessions]) expect(line).not.toMatch(/: 0 de 10|: 0 kg|: 0 repeti/);

    const plan = rowsOf(readable, "treino-entregue");
    expect(plan).toEqual(
      expect.arrayContaining([
        "Plano de força · revisão 2",
        "Entregue por: Profissional Teste",
        "Espaço na entrega: Estúdio Antigo",
        "Ciclo: 02/11/2026 a 24/01/2027",
        "Fase 1: 02/11/2026 a 29/11/2026 · 4 semanas · 1 sessão por semana · divisão Full Body",
        "Treino A",
        "1. Agachamento: Séries: 3\nRepetições: 8-12\nCarga: Não definido\nCadência: Não definido\nDescanso: 60 s\n" +
          "Repetições em reserva (RIR): Não definido\nObservações: joelho alinhado\nVídeo: https://example.test/v",
        // Every field the professional left empty says so instead of being left out.
        "2. Prancha: Séries: Não definido\nRepetições: Não definido\nCarga: Não definido\nCadência: Não definido\n" +
          "Descanso: Não definido\nRepetições em reserva (RIR): Não definido\nObservações: Não definido\nVídeo: Não definido",
        "Treino B",
        "Nenhum exercício neste treino.",
      ]),
    );
    for (const line of plan) expect(line).not.toMatch(/A\d+\./);

    const requests = rowsOf(readable, "pedidos");
    expect(requests).toEqual(
      expect.arrayContaining([
        "Corrigir um dado meu",
        "Mensagem: meu nome está errado",
        "Situação: Em andamento",
        "Receber uma cópia dos meus dados",
        "Mensagem: Sem registro",
        "Situação: Atendido em parte",
        "Resposta do profissional: Enviei por e-mail.",
      ]),
    );
    // A request still open has no answer line at all.
    expect(requests.filter((line) => line.startsWith("Resposta do profissional"))).toHaveLength(1);
  });

  it("says when a list was cut and when a list is empty", () => {
    const readable = readableExport(source({ acceptances: [], links: [link({ checkinsCut: true, sessions: [], plans: [], requests: [] })] }));
    expect(rowsOf(readable, "aceites")).toEqual(["Nenhum aceite registrado."]);
    expect(rowsOf(readable, "check-ins")[0]).toBe(
      `A lista passou de ${EXPORT_CHECKIN_LIMIT} entradas e foi cortada: aparecem as ${EXPORT_CHECKIN_LIMIT} mais recentes.`,
    );
    expect(rowsOf(readable, "treinos-registrados")).toEqual(["Nenhum treino registrado."]);
    expect(rowsOf(readable, "treino-entregue")).toEqual(["Nenhum treino entregue."]);
    expect(rowsOf(readable, "pedidos")).toEqual(["Nenhum pedido feito."]);
  });

  it("names each link when the login has more than one, with distinct anchors", () => {
    const readable = readableExport(source({ links: [link(), link({ organizationName: "Studio B", studentName: "Aluna na B", professionalName: null })] }));
    const ids = readable.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["check-ins-1", "check-ins-2"]));
    expect(readable.sections.find((section) => section.id === "vinculo-2")?.eyebrow).toBe("Studio B · Aluna na B");
    expect(rowsOf(readable, "vinculo-2")).toContain("Profissional: Não informado");
  });

  it("names the PDF with the day in Brazil", () => {
    expect(readablePdfFileName(new Date("2026-10-27T01:30:00Z"))).toBe("meus-dados-2026-10-26.pdf");
  });
});

describe("the PDF of the copy", () => {
  it("prints the readable copy, with the owner's name on every page", async () => {
    const bytes = await renderExportPdf({ readable: readableExport(source()), accountName: "Aluna Exemplo" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("Cópia dos meus dados · Aluna Exemplo");
    const text = textOf(doc);
    for (const expected of [
      "Cópia dos meus dados",
      "Sobre esta cópia",
      "Check-in de 12/11/2026",
      "Mais ou menos",
      "Sem resposta",
      "Vamos aliviar o ombro.",
      "Série 1: 10 repetições · 22,5 kg",
      "Treino A",
      "1. Agachamento",
      "Repetições: Não definido",
      "Enviei por e-mail.",
      "Página 1 de",
    ])
      expect(text).toContain(expected);
    expect(text.match(/Cópia dos meus dados · Aluna Exemplo/g)?.length).toBe(doc.getPageCount());
  });

  it("opens like the page and warns about health data on every page", async () => {
    const doc = await PDFDocument.load(await renderExportPdf({ readable: readableExport(source()), accountName: "Aluna Exemplo" }));
    const text = textOf(doc);
    expect(text).toContain("É o mesmo conteúdo da página e do arquivo JSON.");
    expect(text).not.toContain("Titular");
    expect(text.match(new RegExp(READABLE_HEALTH_NOTE.replace(/[.:]/g, "\\$&"), "g"))?.length).toBeGreaterThanOrEqual(doc.getPageCount());
  });

  it("wraps a long workspace · student line and marks a cut footer name", async () => {
    const longOrg = "Estúdio de Treinamento Funcional e Reabilitação Esportiva da Zona Norte, Unidade Centro e Anexo";
    const readable = readableExport(source({ links: [link({ organizationName: longOrg, studentName: "Beatriz" }), link({ organizationName: "Studio B" })] }));
    const longName = "Aluna Com Um Nome Muito Comprido ".repeat(4).trim();
    const doc = await PDFDocument.load(await renderExportPdf({ readable, accountName: longName }));
    const text = textOf(doc);
    // The eyebrow is never cut: the student's name, after the long workspace name, is printed.
    expect(text).toMatch(/\bBEATRIZ\n/);
    // The footer name does not fit in one line and ends in an ellipsis on every page.
    // (WinAnsi writes "…" as byte 0x85.)
    expect(text.match(/Cópia dos meus dados · Aluna Com Um Nome[^\n]*\x85\n/g)?.length).toBe(doc.getPageCount());
  });

  it("runs a long history over many pages without drawing below the footer", async () => {
    const many = Array.from({ length: 300 }, (_, index) => ({
      ...link().checkins[0],
      checkedOn: `2026-${String((index % 12) + 1).padStart(2, "0")}-01`,
      notes: "Uma observação longa ".repeat(20),
    }));
    const longSets = Array.from({ length: 120 }, (_, index) => ({ setNumber: index + 1, reps: 10, loadKg: 20 }));
    const readable = readableExport(
      source({
        links: [link({ checkins: many, sessions: [{ ...link().sessions[0], exercises: [{ ...link().sessions[0].exercises[0], sets: longSets }] }] })],
      }),
    );
    const doc = await PDFDocument.load(await renderExportPdf({ readable, accountName: "Aluna Exemplo" }));
    expect(doc.getPageCount()).toBeGreaterThan(20);
    const text = textOf(doc);
    expect(text).toContain("Série 120: 10 repetições · 20 kg");
    expect(text).toContain(`Página ${doc.getPageCount()} de ${doc.getPageCount()}`);
  });
});
