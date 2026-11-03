import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import type { PhotoView } from "@/modules/avaliacoes/photos";
import {
  REPORT_EMPTY_NOTE,
  REPORT_FOOTER_NOTICE,
  REPORT_NOTICE,
  assessmentReport,
  reportDateTime,
  reportFingerprint,
  type ReportBlock,
  type ReportInput,
} from "@/modules/avaliacoes/v2/report";
import { formatCalendarDate } from "@/modules/training/format";
import { BRAND, CONTENT_WIDTH, Flow, INK, LINE, MARGIN, MUTED, PAGE, SOFT, printable, wrap } from "./plan-pdf";

/**
 * A recorded Avaliação Física as a PDF, generated on the server with pdf-lib (pure JavaScript, so it runs in the Worker), the same way as the
 * delivered plan. It draws the report of `assessmentReport` and nothing else: what was recorded, the results as computed at finalize, "Não
 * realizado" for a module not done, no classification. The same file goes to the professional and to the student. The version is a short
 * fingerprint of the recorded assessment (`reportFingerprint`), so the same record always carries the same one.
 */
export interface AssessmentPdfInput extends ReportInput {
  generatedAt: Date;
  /**
   * The bytes of the stored posture photos (slice 0.86), read by the server from the private storage after the gated query of the report. A
   * photo of the index without bytes here (storage off, or unreadable) prints "Foto indisponível no momento." in its place, never a blank.
   */
  photoImages?: Partial<Record<PhotoView, Uint8Array>>;
}

const WARNING = rgb(0x8a / 255, 0x4b / 255, 0x00);
const LABEL_WIDTH = 190;
const GAP = 12;
const VALUE_WIDTH = CONTENT_WIDTH - LABEL_WIDTH - GAP;

const PHOTO_WIDTH = (CONTENT_WIDTH - GAP) / 2;
const PHOTO_MAX_HEIGHT = 300;

/** Fits an image in the box of one photo, keeping its proportion. */
function photoSize(image: PDFImage) {
  const scale = Math.min(PHOTO_WIDTH / image.width, PHOTO_MAX_HEIGHT / image.height, 1);
  return { width: image.width * scale, height: image.height * scale };
}

function drawBlock(flow: Flow, block: ReportBlock, images: ReadonlyMap<PhotoView, PDFImage> = new Map()) {
  const { regular, bold } = flow;
  switch (block.kind) {
    case "subtitle": {
      flow.need(16 + 14);
      flow.y -= 4;
      flow.text(block.text, MARGIN, 10.5, bold, INK);
      flow.y -= 16;
      return;
    }
    case "text": {
      const lines = wrap(regular, 9.5, printable(regular, block.text), CONTENT_WIDTH);
      for (const line of lines) {
        flow.need(12);
        flow.text(line, MARGIN, 9.5, regular, block.muted ? MUTED : INK);
        flow.y -= 12;
      }
      flow.y -= 4;
      return;
    }
    case "facts": {
      for (const item of block.rows) {
        const label = wrap(bold, 9, printable(bold, item.label), LABEL_WIDTH);
        const value = wrap(regular, 9.5, printable(regular, item.value), VALUE_WIDTH);
        const height = Math.max(label.length, value.length) * 12 + 3;
        flow.need(height);
        const top = flow.y;
        label.forEach((line, index) => {
          flow.y = top - index * 12;
          flow.text(line, MARGIN, 9, bold, MUTED);
        });
        value.forEach((line, index) => {
          flow.y = top - index * 12;
          flow.text(line, MARGIN + LABEL_WIDTH + GAP, 9.5, regular, INK);
        });
        flow.y = top - height;
      }
      flow.y -= 4;
      return;
    }
    case "results": {
      for (const item of block.rows) {
        const label = wrap(bold, 9.5, printable(bold, item.label), LABEL_WIDTH);
        const value = wrap(bold, 10, printable(bold, item.value), VALUE_WIDTH);
        const detail = wrap(regular, 8.5, printable(regular, item.detail), VALUE_WIDTH);
        const flags = item.flags.length > 0 ? wrap(regular, 8.5, printable(regular, item.flags.join(" · ")), VALUE_WIDTH) : [];
        const right = value.length * 13 + detail.length * 11 + flags.length * 11;
        const height = Math.max(label.length * 12, right) + 6;
        flow.need(height);
        const top = flow.y;
        label.forEach((line, index) => {
          flow.y = top - index * 12;
          flow.text(line, MARGIN, 9.5, bold, INK);
        });
        let y = top;
        for (const line of value) {
          flow.y = y;
          flow.text(line, MARGIN + LABEL_WIDTH + GAP, 10, bold, INK);
          y -= 13;
        }
        for (const line of detail) {
          flow.y = y;
          flow.text(line, MARGIN + LABEL_WIDTH + GAP, 8.5, regular, MUTED);
          y -= 11;
        }
        for (const line of flags) {
          flow.y = y;
          flow.text(line, MARGIN + LABEL_WIDTH + GAP, 8.5, regular, WARNING);
          y -= 11;
        }
        flow.y = top - height;
        flow.page.drawLine({ start: { x: MARGIN, y: flow.y + 3 }, end: { x: PAGE.width - MARGIN, y: flow.y + 3 }, thickness: 0.4, color: LINE });
      }
      flow.y -= 4;
      return;
    }
    case "photos": {
      // Two per row: the name of the view over the image (or the line that says why there is none).
      for (let index = 0; index < block.items.length; index += 2) {
        const pair = block.items.slice(index, index + 2);
        const body = Math.max(...pair.map((item) => (item.erasedOn === null && images.has(item.view) ? photoSize(images.get(item.view)!).height : 14)));
        flow.need(16 + body + 12);
        const top = flow.y;
        pair.forEach((item, column) => {
          const x = MARGIN + column * (PHOTO_WIDTH + GAP);
          flow.y = top;
          flow.text(item.label, x, 9.5, bold, INK);
          flow.y = top - 16;
          const image = item.erasedOn === null ? images.get(item.view) : undefined;
          if (image) {
            const size = photoSize(image);
            flow.page.drawImage(image, { x, y: flow.y - size.height, width: size.width, height: size.height });
          } else {
            flow.text(item.erasedOn ? `Foto apagada em ${item.erasedOn}.` : "Foto indisponível no momento.", x, 9, regular, MUTED);
          }
        });
        flow.y = top - 16 - body - 12;
      }
      return;
    }
  }
}

export async function renderAssessmentPdf(input: AssessmentPdfInput): Promise<Uint8Array> {
  const report = assessmentReport(input);
  const fingerprint = await reportFingerprint(input);
  const short = fingerprint.slice(0, 12);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const flow = new Flow(doc, regular, bold);
  const heading = `${report.title} de ${formatCalendarDate(input.assessment.assessedOn)}`;
  // The stored photos, embedded once (a JPEG goes into the PDF as it is: no decoding, Workers-safe). One that pdf-lib cannot read is left out
  // and reads "Foto indisponível no momento.", like one the storage did not give.
  const images = new Map<PhotoView, PDFImage>();
  for (const photo of input.photos ?? []) {
    const bytes = photo.erasedAt === null ? input.photoImages?.[photo.view] : undefined;
    if (!bytes) continue;
    try {
      images.set(photo.view, await doc.embedJpg(bytes));
    } catch {
      // Left out on purpose; see above.
    }
  }

  // Header block.
  flow.text("AVALIAÇÃO FÍSICA · RELATÓRIO", MARGIN, 9, bold, BRAND);
  flow.y -= 16;
  for (const line of wrap(bold, 20, printable(bold, heading), CONTENT_WIDTH)) {
    flow.text(line, MARGIN, 20, bold);
    flow.y -= 25;
  }
  flow.y -= 4;
  drawBlock(flow, { kind: "facts", rows: [...report.facts, { label: "Identificação da versão", value: short }] });
  flow.page.drawLine({ start: { x: MARGIN, y: flow.y }, end: { x: PAGE.width - MARGIN, y: flow.y }, thickness: 0.75, color: LINE });
  flow.y -= 12;
  if (report.warning) {
    for (const line of wrap(bold, 9.5, printable(bold, report.warning), CONTENT_WIDTH)) {
      flow.text(line, MARGIN, 9.5, bold, WARNING);
      flow.y -= 12;
    }
    flow.y -= 4;
  }
  drawBlock(flow, { kind: "text", text: REPORT_NOTICE });
  drawBlock(flow, { kind: "text", text: REPORT_EMPTY_NOTE, muted: true });
  flow.y -= 6;

  for (const section of report.sections) {
    flow.need(22 + 12 + 30);
    flow.page.drawRectangle({ x: MARGIN, y: flow.y - 22, width: CONTENT_WIDTH, height: 22, color: SOFT });
    flow.y -= 5;
    flow.text(section.title, MARGIN + 8, 11, bold, BRAND);
    flow.y -= 17 + 10;
    for (const block of section.blocks) drawBlock(flow, block, images);
    flow.y -= 8;
  }

  // Footers, now that the page count is known.
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const left = printable(regular, `${heading} · ${input.studentName} · versão ${short}`);
    const right = `Página ${index + 1} de ${pages.length}`;
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 18 }, end: { x: PAGE.width - MARGIN, y: MARGIN + 18 }, thickness: 0.5, color: LINE });
    page.drawText(wrap(regular, 8, left, CONTENT_WIDTH - 80)[0] ?? "", { x: MARGIN, y: MARGIN + 6, size: 8, font: regular, color: MUTED });
    page.drawText(printable(regular, `Gerado em ${reportDateTime(input.generatedAt.toISOString())} · ${REPORT_FOOTER_NOTICE}`), {
      x: MARGIN,
      y: MARGIN - 5,
      size: 8,
      font: regular,
      color: MUTED,
    });
    page.drawText(right, { x: PAGE.width - MARGIN - regular.widthOfTextAtSize(right, 8), y: MARGIN + 6, size: 8, font: regular, color: MUTED });
  });

  doc.setTitle(printable(regular, heading));
  doc.setSubject(printable(regular, `Avaliação física de ${input.studentName}`));
  doc.setAuthor(printable(regular, input.assessment.recordedByName ?? "Profissional"));
  doc.setCreator("Trainer Prescription");
  doc.setProducer("Trainer Prescription (pdf-lib)");
  doc.setKeywords([`avaliacao:${input.assessment.id}`, `sha256:${fingerprint}`]);
  doc.setCreationDate(input.generatedAt);
  doc.setModificationDate(input.generatedAt);
  return doc.save();
}
