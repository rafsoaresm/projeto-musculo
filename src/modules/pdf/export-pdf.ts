import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { READABLE_HEALTH_NOTE, READABLE_TITLE, readableDateTime, type ReadableBlock, type ReadableExport } from "@/modules/pedidos/export-readable";
import { BRAND, CONTENT_WIDTH, Flow, INK, LINE, MARGIN, MUTED, PAGE, SOFT, printable, wrap } from "./plan-pdf";

/**
 * "Baixar meus dados" as a PDF (slice 0.91), generated on the server with pdf-lib like the plan and
 * the assessment. It draws `readableExport` and nothing else, so it says what the page and the JSON
 * say. The account name goes into the footer of each page: the file carries health data, and a loose
 * page should say whose it is.
 */
export interface ExportPdfInput {
  readable: ReadableExport;
  accountName: string;
}

const LABEL_WIDTH = 170;
const GAP = 12;
const VALUE_WIDTH = CONTENT_WIDTH - LABEL_WIDTH - GAP;

/** `printable` turns a line break into a space, so each line of a value is wrapped on its own. */
/** One line of at most `width`; a longer text ends in "…" so the reader sees it was cut. */
function oneLine(font: PDFFont, size: number, text: string, width: number): string {
  const value = printable(font, text);
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  let cut = value;
  while (cut.length > 0 && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

const lines = (font: PDFFont, size: number, text: string, width: number) =>
  text.split(/\r?\n/).flatMap((line) => wrap(font, size, printable(font, line), width));

function drawBlock(flow: Flow, block: ReadableBlock) {
  const { regular, bold } = flow;
  switch (block.kind) {
    case "subtitle": {
      const lines = wrap(bold, 10.5, printable(bold, block.text), CONTENT_WIDTH);
      // Keeps the title with the first lines that follow it.
      flow.need(lines.length * 14 + 6 + 30);
      flow.y -= 6;
      for (const line of lines) {
        flow.text(line, MARGIN, 10.5, bold, INK);
        flow.y -= 14;
      }
      flow.y -= 2;
      return;
    }
    case "heading": {
      // A workout of the plan: kept with the first exercise that follows it.
      flow.need(14 + 30);
      flow.y -= 2;
      for (const line of wrap(bold, 9.5, printable(bold, block.text), CONTENT_WIDTH)) {
        flow.text(line, MARGIN, 9.5, bold, BRAND);
        flow.y -= 13;
      }
      flow.y -= 2;
      return;
    }
    case "text": {
      for (const line of lines(regular, 9.5, block.text, CONTENT_WIDTH)) {
        flow.need(12);
        flow.text(line, MARGIN, 9.5, regular, block.muted ? MUTED : INK);
        flow.y -= 12;
      }
      flow.y -= 4;
      return;
    }
    case "list": {
      for (const item of block.items) {
        const lines = wrap(regular, 9.5, printable(regular, item), CONTENT_WIDTH - 14);
        flow.need(lines.length * 12);
        flow.text("•", MARGIN + 2, 9.5, regular, MUTED);
        for (const line of lines) {
          flow.text(line, MARGIN + 14, 9.5, regular, INK);
          flow.y -= 12;
        }
      }
      flow.y -= 4;
      return;
    }
    case "facts": {
      for (const item of block.rows) {
        const label = wrap(bold, 9, printable(bold, item.label), LABEL_WIDTH);
        const value = lines(regular, 9.5, item.value, VALUE_WIDTH);
        const height = Math.max(label.length, value.length) * 12 + 3;
        // A long value (many sets, a long note) runs onto the next page line by line instead of overflowing the footer.
        if (height > PAGE.height / 2) {
          flow.need(12 * label.length + 12);
          const top = flow.y;
          const start = flow.page;
          label.forEach((line, index) => {
            flow.y = top - index * 12;
            flow.text(line, MARGIN, 9, bold, MUTED);
          });
          flow.y = top;
          for (const line of value) {
            flow.need(12);
            flow.text(line, MARGIN + LABEL_WIDTH + GAP, 9.5, regular, INK);
            flow.y -= 12;
          }
          if (flow.page === start) flow.y = Math.min(flow.y, top - label.length * 12);
          flow.y -= 3;
          continue;
        }
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
      flow.y -= 6;
      return;
    }
  }
}

export async function renderExportPdf(input: ExportPdfInput): Promise<Uint8Array> {
  const { readable } = input;
  const generatedAt = new Date(readable.generatedAt);
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const flow = new Flow(doc, regular, bold);

  // Header block.
  flow.text("ÁREA DO ALUNO · SEUS DADOS", MARGIN, 9, bold, BRAND);
  flow.y -= 16;
  for (const line of wrap(bold, 20, printable(bold, readable.title), CONTENT_WIDTH)) {
    flow.text(line, MARGIN, 20, bold);
    flow.y -= 25;
  }
  flow.y -= 4;
  // The same opening line as the page; the account name is in the first section and in every footer.
  drawBlock(flow, {
    kind: "text",
    text: `Gerada em ${readableDateTime(readable.generatedAt)}. É o mesmo conteúdo da página e do arquivo JSON. ${READABLE_HEALTH_NOTE}`,
  });
  flow.page.drawLine({ start: { x: MARGIN, y: flow.y }, end: { x: PAGE.width - MARGIN, y: flow.y }, thickness: 0.75, color: LINE });
  flow.y -= 14;

  for (const section of readable.sections) {
    // The eyebrow (workspace · student) tells two links apart, so it is never cut: it wraps.
    const eyebrow = section.eyebrow ? wrap(bold, 8, printable(bold, section.eyebrow.toUpperCase()), CONTENT_WIDTH) : [];
    flow.need(eyebrow.length * 12 + 22 + 12 + 30);
    for (const line of eyebrow) {
      flow.text(line, MARGIN, 8, bold, MUTED);
      flow.y -= 12;
    }
    flow.page.drawRectangle({ x: MARGIN, y: flow.y - 22, width: CONTENT_WIDTH, height: 22, color: SOFT });
    flow.y -= 5;
    flow.text(section.title, MARGIN + 8, 11, bold, BRAND);
    flow.y -= 17 + 10;
    for (const block of section.blocks) drawBlock(flow, block);
    flow.y -= 8;
  }

  // Footers, now that the page count is known.
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const left = oneLine(regular, 8, `${READABLE_TITLE} · ${input.accountName}`, CONTENT_WIDTH - 90);
    const right = `Página ${index + 1} de ${pages.length}`;
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 18 }, end: { x: PAGE.width - MARGIN, y: MARGIN + 18 }, thickness: 0.5, color: LINE });
    page.drawText(left, { x: MARGIN, y: MARGIN + 6, size: 8, font: regular, color: MUTED });
    page.drawText(oneLine(regular, 8, `Gerada em ${readableDateTime(readable.generatedAt)} · ${READABLE_HEALTH_NOTE}`, CONTENT_WIDTH), {
      x: MARGIN,
      y: MARGIN - 5,
      size: 8,
      font: regular,
      color: MUTED,
    });
    page.drawText(right, { x: PAGE.width - MARGIN - regular.widthOfTextAtSize(right, 8), y: MARGIN + 6, size: 8, font: regular, color: MUTED });
  });

  doc.setTitle(printable(regular, `${READABLE_TITLE} · ${input.accountName}`));
  doc.setSubject(printable(regular, `Cópia dos dados de ${input.accountName}`));
  doc.setAuthor(printable(regular, input.accountName));
  doc.setCreator("Trainer Prescription");
  doc.setProducer("Trainer Prescription (pdf-lib)");
  doc.setCreationDate(generatedAt);
  doc.setModificationDate(generatedAt);
  return doc.save();
}
