import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { addStudent, createProfessional, expectNoTermsBox, localIP, noHorizontalOverflow, openInvitation, showStudentTab } from "./helpers";
import { DRAFT_AUTOSAVE_DELAY_MS } from "../../src/modules/avaliacoes/v2/autosave";
import { PARQ } from "../../src/modules/avaliacoes/catalog";

// Slice 0.92: the classifications by the reference tables the user sent (03/11/2026). A woman of 25 with no skinfolds (so no equation): the
// BMI of 53,5 kg and 1,70 m is 18,51, compared as 18,5, in the table's gap; the Flexiteste of ten levels 1 and five levels 2 is 20, between
// "< 20" and "21 – 30"; the waist-hip ratio and the Cooper wait for "Referência das tabelas", chosen in Revisão and saved with the draft.
// Recorded: the same classifications, frozen, on the record, in the PDF and in the student's area.
const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
};
const step = (page: Page, name: string) => page.getByRole("navigation", { name: "Etapas da avaliação física" }).getByRole("button", { name });
const savedLine = (page: Page) => page.locator(".av2-status").filter({ hasText: /^Salvo às \d{2}:\d{2}\.$/ });

/** The text drawn on the pages of a PDF (each Tj on a line of its own, joined with spaces so a wrapped sentence reads whole). */
function pdfText(doc: PDFDocument): string {
  let out = "";
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      for (const match of operators.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += `${Buffer.from(match[1], "hex").toString("latin1")} `;
    }
  }
  return out.replace(/\s+/g, " ");
}

/** Screenshots of the new or changed screens for the visual check of the slice, only where asked (SHOTS_DIR) and once (desktop project). */
async function shots(page: Page, name: string, projectName: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir || projectName !== "desktop") return;
  const size = page.viewportSize();
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${dir}/${process.env.SHOTS_PREFIX ?? "0.92"}-${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

test("classifies by the reference tables: gaps said as gaps, the reference chosen in Revisão, frozen on the record, the PDF and the student's area", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(300_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das tabelas");
  const studentURL = await addStudent(page, "Aluna das tabelas");
  await page.getByRole("link", { name: "Preencher a ficha", exact: true }).click();
  await page.getByLabel("Data de nascimento").fill(yearsAgo(25));
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Ficha salva.")).toBeVisible();

  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  for (const text of Object.values(PARQ)) await page.getByRole("radiogroup", { name: text, exact: true }).getByRole("radio", { name: "Não", exact: true }).check();
  await step(page, "2 Medidas").click();
  await page.getByLabel("Peso (kg)").fill("53,5");
  await page.getByLabel("Altura (m)").fill("1,70");
  await page.getByLabel("Cintura (cm)").fill("70");
  await page.getByLabel("Quadril (cm)").fill("95");
  await step(page, "3 Movimento").click();
  const movements = page.getByRole("region", { name: "Flexiteste · 15 movimentos" }).getByRole("radiogroup");
  await expect(movements).toHaveCount(15);
  for (let index = 0; index < 15; index++) await movements.nth(index).getByRole("radio", { name: `Nível ${index < 10 ? 1 : 2}` }).check();
  await step(page, "4 Testes").click();
  await page.getByRole("region", { name: "Teste de Cooper · 12 minutos" }).getByLabel("Distância percorrida (m)").fill("1.800");

  // Revisão: the preview of what finalize records, each with its table, column, source and the precision of the comparison.
  await step(page, "5 Revisão").click();
  const toRecord = page.getByRole("list", { name: "Resultados a registrar" });
  const row = (list: typeof toRecord, name: string) => list.getByRole("listitem").filter({ hasText: name });
  await expect(row(toRecord, "IMC")).toContainText("Classificação: entre abaixo do peso e Peso ideal (parabéns) (fora das faixas da tabela)");
  await expect(row(toRecord, "IMC")).toContainText("18,51 comparado como 18,5");
  await expect(row(toRecord, "Flexiteste, soma dos 15 níveis")).toContainText("Classificação: entre Muito pequeno (ancilose) e Pequeno (fora das faixas da tabela)");
  await expect(row(toRecord, "Flexiteste, soma dos 15 níveis")).toContainText("tabela enviada pelo usuário em 03/11/2026");
  await expect(row(toRecord, "RCQ")).toContainText("Classificação: sem referência escolhida");
  await expect(row(toRecord, "Cooper, velocidade média")).toContainText("Classificação da distância (1.800 m): sem referência escolhida");
  // The VO₂ estimate has no table: no classification line.
  await expect(row(toRecord, "Cooper, VO₂máx estimado")).not.toContainText("Classificação");
  const reference = page.getByLabel("Referência das tabelas", { exact: true });
  await expect(reference).toHaveValue("");
  await expect(reference).toHaveAccessibleDescription(/não o gênero da pessoa/);
  await reference.selectOption("female");
  await expect(row(toRecord, "RCQ")).toContainText("Classificação: Moderado");
  await expect(row(toRecord, "RCQ")).toContainText("Risco para a saúde pelo índice cintura/quadril, mulheres, 20 a 29 anos · Adaptado de Bray et Gray (1988) · 0,737 comparado como 0,74");
  await expect(row(toRecord, "Cooper, velocidade média")).toContainText("Classificação da distância (1.800 m): Média");
  await expect(row(toRecord, "Cooper, velocidade média")).toContainText("Cooper, 1982 · comparado como 1.800 m · referência feminina");
  // Saved with the draft by itself: a reload brings the choice back.
  await expect(savedLine(page)).toBeVisible({ timeout: DRAFT_AUTOSAVE_DELAY_MS + 10_000 });
  await page.reload();
  await expect(page.getByLabel("Referência das tabelas", { exact: true })).toHaveValue("female");
  await expect(row(toRecord, "RCQ")).toContainText("Classificação: Moderado");
  await noHorizontalOverflow(page);
  await shots(page, "revisao", testInfo.project.name);

  await page.getByRole("button", { name: "Finalizar avaliação" }).click();
  await page.getByRole("button", { name: "Confirmar e finalizar" }).click();
  await expect(page.getByRole("heading", { name: /^Avaliação física de \d{2}\/\d{2}\/\d{4}$/, level: 1 })).toBeVisible();
  const recorded = page.getByRole("list", { name: "Resultados" });
  await expect(row(recorded, "IMC")).toContainText("Classificação: entre abaixo do peso e Peso ideal (parabéns) (fora das faixas da tabela)");
  await expect(row(recorded, "RCQ")).toContainText("Classificação: Moderado");
  await expect(row(recorded, "Cooper, velocidade média")).toContainText("Classificação da distância (1.800 m): Média");
  await expect(row(recorded, "Flexiteste, soma dos 15 níveis")).toContainText("entre Muito pequeno (ancilose) e Pequeno");
  await expect(page.getByText("A classificação é a registrada ao finalizar", { exact: false })).toBeVisible();
  await expect(page.getByText("Referência das tabelas: Feminina, escolhida na Revisão")).toBeVisible();
  await noHorizontalOverflow(page);
  await shots(page, "registrada", testInfo.project.name);

  // The PDF prints the same classifications, with their source.
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Baixar relatório em PDF" }).click();
  const file = await download;
  const text = pdfText(await PDFDocument.load(await readFile((await file.path())!)));
  for (const expected of [
    "são classificados pelas tabelas de referência da ferramenta",
    "Classificação: entre abaixo do peso e Peso ideal (parabéns) (fora das faixas da tabela)",
    "Classificação: Moderado",
    "Adaptado de Bray et Gray (1988)",
    "Classificação da distância (1.800 m): Média",
    "Cooper, 1982",
    "Referência das tabelas",
    "Feminina, escolhida na Revisão",
    "Classificação: entre Muito pequeno (ancilose) e Pequeno (fora das faixas da tabela)",
  ])
    expect(text, expected).toContain(expected);

  // The student reads the same, read only, in their area.
  await page.goto(studentURL);
  const { client } = await openInvitation(page, browser, baseURL, "Aluna das tabelas");
  await expectNoTermsBox(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);
  await client.page.goto("./aluno/avaliacoes");
  await client.page.getByRole("row").filter({ hasText: "Inicial" }).getByRole("link", { name: /^Ver / }).click();
  const mine = client.page.getByRole("list", { name: "Resultados" });
  await expect(row(mine, "RCQ")).toContainText("Classificação: Moderado");
  await expect(row(mine, "IMC")).toContainText("fora das faixas da tabela");
  await expect(client.page.getByText("Referência das tabelas: Feminina, escolhida na Revisão")).toBeVisible();
  await noHorizontalOverflow(client.page);
  await shots(client.page, "aluno-avaliacao", testInfo.project.name);
  await client.context.close();
});
