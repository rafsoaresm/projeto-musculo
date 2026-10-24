import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { StudentExercise, StudentTrainingPlan } from "@/db/student-plan";
import { describeDose } from "@/modules/prescricao/describe";
import { formatCalendarDate } from "@/modules/training/format";

/**
 * The delivered plan as a PDF, generated on the server with pdf-lib (pure JavaScript, so it runs
 * in the Worker). It prints exactly what was delivered: the doses are the ones the professional
 * typed, an empty field is left out and nothing is suggested. Only http(s) video links become
 * clickable. The version is the revision number plus a short fingerprint of the delivered
 * content, so the same revision always carries the same fingerprint and a regenerated file can
 * be told apart from a different version by it. The generation date is the only thing that
 * changes between downloads.
 */
export interface PlanPdfInput {
  studentName: string;
  organizationName: string | null;
  plan: StudentTrainingPlan;
  generatedAt: Date;
}

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 44;
const FOOTER = 34;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const INK = rgb(0x1f / 255, 0x29 / 255, 0x33 / 255);
const MUTED = rgb(0x5a / 255, 0x64 / 255, 0x70 / 255);
const BRAND = rgb(0, 0x77 / 255, 0xb6 / 255);
const SOFT = rgb(0xe8 / 255, 0xf3 / 255, 0xfa / 255);
const LINE = rgb(0xd7 / 255, 0xdd / 255, 0xe3 / 255);

const REPLACEMENTS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  "−": "-",
  " ": " ",
  "\t": " ",
};

/**
 * The standard fonts only draw the WinAnsi set (Portuguese is inside it). Anything else is
 * replaced by a plain equivalent or "?" instead of failing the whole document.
 */
export function printable(font: PDFFont, value: string): string {
  const supported = new Set(font.getCharacterSet());
  let out = "";
  for (const char of value.normalize("NFC")) {
    const mapped = REPLACEMENTS[char] ?? char;
    for (const piece of mapped) {
      const code = piece.codePointAt(0)!;
      out += supported.has(code) && code >= 0x20 ? piece : code < 0x20 ? " " : "?";
    }
  }
  return out;
}

/** Greedy wrap by words; a word wider than the line is cut where it no longer fits. */
export function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(" ").filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** A video link is clickable only when it is a plain http(s) address. */
export function safeLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * SHA-256 over the delivered content, in a fixed key order. Student and organization names are
 * not part of it, so a rename does not make a different version of the same revision.
 */
export async function planFingerprint(plan: StudentTrainingPlan): Promise<string> {
  const canonical = JSON.stringify([
    plan.revisionId,
    plan.title,
    plan.revisionNumber,
    plan.deliveredAt,
    plan.startDate,
    plan.endDate,
    plan.phases.map((phase) => [
      phase.index,
      phase.startDate,
      phase.endDate,
      phase.weeks,
      phase.sessionsPerWeek,
      phase.split,
      phase.workouts.map((workout) => [
        workout.label,
        workout.exercises.map((exercise) => [
          exercise.name,
          exercise.videoUrl,
          exercise.videoStatus,
          exercise.sets,
          exercise.reps,
          exercise.loadInstruction,
          exercise.cadence,
          exercise.restSeconds,
          exercise.restText,
          exercise.rirMin,
          exercise.rirMax,
          exercise.notes,
        ]),
      ]),
    ]),
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const dateTimeBR = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
const dateBR = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export const pdfFileName = (plan: StudentTrainingPlan) => {
  const slug = plan.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `plano-${slug || "treino"}-rev${plan.revisionNumber}.pdf`;
};

/** Vertical flow over A4 pages. Footers are written last, when the page count is known. */
class Flow {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
  }
  /** Starts a new page unless `height` still fits above the footer. */
  need(height: number) {
    if (this.y - height < MARGIN + FOOTER) this.newPage();
  }
  text(value: string, x: number, size: number, font: PDFFont, color = INK) {
    this.page.drawText(printable(font, value), { x, y: this.y - size, size, font, color });
  }
  link(url: string, x: number, width: number, size: number) {
    const annotation = this.doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, this.y - size - 2, x + width, this.y + 1],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    });
    const ref = this.doc.context.register(annotation);
    const existing = this.page.node.Annots();
    if (existing) existing.push(ref);
    else this.page.node.set(PDFName.of("Annots"), this.doc.context.obj([ref]));
  }
}

function exerciseHeight(exercise: StudentExercise, flow: Flow): number {
  const name = wrap(flow.bold, 10.5, printable(flow.bold, exercise.name), CONTENT_WIDTH - 18);
  const dose = wrap(
    flow.regular,
    9.5,
    printable(flow.regular, describeDose(exercise) || "Sem parâmetros definidos"),
    CONTENT_WIDTH - 18,
  );
  const notes = exercise.notes
    ? wrap(flow.regular, 9.5, printable(flow.regular, `Obs.: ${exercise.notes}`), CONTENT_WIDTH - 18)
    : [];
  const link = safeLink(exercise.videoUrl) ? 1 : 0;
  return name.length * 13 + dose.length * 12 + notes.length * 12 + link * 12 + 8;
}

function drawExercise(flow: Flow, exercise: StudentExercise, number: number) {
  const x = MARGIN + 18;
  const width = CONTENT_WIDTH - 18;
  flow.need(exerciseHeight(exercise, flow));
  flow.text(`${number}.`, MARGIN, 10.5, flow.bold, MUTED);
  for (const line of wrap(flow.bold, 10.5, printable(flow.bold, exercise.name), width)) {
    flow.text(line, x, 10.5, flow.bold);
    flow.y -= 13;
  }
  const dose = describeDose(exercise) || "Sem parâmetros definidos";
  for (const line of wrap(flow.regular, 9.5, printable(flow.regular, dose), width)) {
    flow.text(line, x, 9.5, flow.regular, MUTED);
    flow.y -= 12;
  }
  if (exercise.notes)
    for (const line of wrap(flow.regular, 9.5, printable(flow.regular, `Obs.: ${exercise.notes}`), width)) {
      flow.text(line, x, 9.5, flow.regular, MUTED);
      flow.y -= 12;
    }
  const url = safeLink(exercise.videoUrl);
  if (url) {
    const label = exercise.videoStatus === "SEARCH_LINK" ? "Buscar vídeos de execução" : "Ver vídeo";
    const labelWidth = flow.regular.widthOfTextAtSize(printable(flow.regular, label), 9.5);
    flow.text(label, x, 9.5, flow.regular, BRAND);
    flow.page.drawLine({
      start: { x, y: flow.y - 9.5 - 1.5 },
      end: { x: x + labelWidth, y: flow.y - 9.5 - 1.5 },
      thickness: 0.5,
      color: BRAND,
    });
    flow.link(url, x, labelWidth, 9.5);
    flow.y -= 12;
  }
  flow.y -= 8;
}

export async function renderPlanPdf(input: PlanPdfInput): Promise<Uint8Array> {
  const { plan } = input;
  const fingerprint = await planFingerprint(plan);
  const short = fingerprint.slice(0, 12);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const flow = new Flow(doc, regular, bold);

  // Header block.
  flow.text("PLANO DE TREINO", MARGIN, 9, bold, BRAND);
  flow.y -= 16;
  for (const line of wrap(bold, 20, printable(bold, plan.title), CONTENT_WIDTH)) {
    flow.text(line, MARGIN, 20, bold);
    flow.y -= 25;
  }
  flow.y -= 4;
  const facts: Array<[string, string]> = [
    ["Aluno", input.studentName],
    ["Profissional", plan.deliveredBy ?? "Não informado"],
    ...(input.organizationName ? ([["Espaço", input.organizationName]] as Array<[string, string]>) : []),
    ["Ciclo", `${formatCalendarDate(plan.startDate)} a ${formatCalendarDate(plan.endDate)}`],
    ["Versão", `Revisão ${plan.revisionNumber}, entregue em ${dateBR(plan.deliveredAt)}`],
    ["Identificação da versão", short],
  ];
  const labelWidth = 128;
  for (const [label, value] of facts) {
    const lines = wrap(regular, 10, printable(regular, value), CONTENT_WIDTH - labelWidth);
    flow.need(lines.length * 14);
    flow.text(label, MARGIN, 10, bold, MUTED);
    for (const line of lines) {
      flow.text(line, MARGIN + labelWidth, 10, regular);
      flow.y -= 14;
    }
  }
  flow.y -= 4;
  flow.page.drawLine({
    start: { x: MARGIN, y: flow.y },
    end: { x: PAGE.width - MARGIN, y: flow.y },
    thickness: 0.75,
    color: LINE,
  });
  flow.y -= 12;
  for (const line of wrap(
    regular,
    9,
    printable(
      regular,
      "Este é o treino que o seu profissional aprovou e entregou. Em caso de dor ou desconforto, interrompa e fale com ele. Os parâmetros são os digitados por ele; um campo em branco não foi definido.",
    ),
    CONTENT_WIDTH,
  )) {
    flow.text(line, MARGIN, 9, regular, MUTED);
    flow.y -= 12;
  }
  flow.y -= 8;

  // Phases, workouts, exercises.
  for (const phase of plan.phases) {
    const firstWorkout = phase.workouts[0];
    const firstExercise = firstWorkout?.exercises[0];
    flow.need(
      34 + 22 + (firstExercise ? exerciseHeight(firstExercise, flow) : 16),
    );
    flow.page.drawRectangle({
      x: MARGIN,
      y: flow.y - 22,
      width: CONTENT_WIDTH,
      height: 22,
      color: SOFT,
    });
    const head = `Fase ${String(phase.index).padStart(2, "0")}`;
    flow.y -= 5;
    flow.text(head, MARGIN + 8, 11, bold, BRAND);
    const meta =
      `${formatCalendarDate(phase.startDate)} a ${formatCalendarDate(phase.endDate)} · ${phase.weeks} semanas · ` +
      `${phase.sessionsPerWeek} ${phase.sessionsPerWeek === 1 ? "sessão" : "sessões"} por semana` +
      (phase.split === "Full Body" ? "" : ` · divisão ${phase.split}`);
    flow.text(meta, MARGIN + 8 + bold.widthOfTextAtSize(head, 11) + 10, 9, regular, MUTED);
    flow.y -= 17 + 12;
    for (const workout of phase.workouts) {
      flow.need(18 + (workout.exercises[0] ? exerciseHeight(workout.exercises[0], flow) : 16));
      flow.text(`Treino ${workout.label}`, MARGIN, 11, bold, INK);
      flow.y -= 17;
      if (workout.exercises.length === 0) {
        flow.text("Nenhum exercício neste treino.", MARGIN + 18, 9.5, regular, MUTED);
        flow.y -= 16;
      }
      workout.exercises.forEach((exercise, index) => drawExercise(flow, exercise, index + 1));
      flow.y -= 4;
    }
    flow.y -= 6;
  }

  // Footers, now that the page count is known.
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const left = printable(
      regular,
      `${plan.title} · Revisão ${plan.revisionNumber} · versão ${short}`,
    );
    const right = `Página ${index + 1} de ${pages.length}`;
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 18 },
      end: { x: PAGE.width - MARGIN, y: MARGIN + 18 },
      thickness: 0.5,
      color: LINE,
    });
    page.drawText(left, { x: MARGIN, y: MARGIN + 6, size: 8, font: regular, color: MUTED });
    page.drawText(
      printable(regular, `Gerado em ${dateTimeBR(input.generatedAt)}`),
      { x: MARGIN, y: MARGIN - 5, size: 8, font: regular, color: MUTED },
    );
    page.drawText(right, {
      x: PAGE.width - MARGIN - regular.widthOfTextAtSize(right, 8),
      y: MARGIN + 6,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  doc.setTitle(printable(regular, `${plan.title} (revisão ${plan.revisionNumber})`));
  doc.setSubject(`Plano de treino de ${printable(regular, input.studentName)}`);
  doc.setAuthor(printable(regular, plan.deliveredBy ?? "Profissional"));
  doc.setCreator("Trainer Prescription");
  doc.setProducer("Trainer Prescription (pdf-lib)");
  doc.setKeywords([`revisao:${plan.revisionId}`, `sha256:${fingerprint}`]);
  doc.setCreationDate(input.generatedAt);
  doc.setModificationDate(input.generatedAt);
  return doc.save();
}
