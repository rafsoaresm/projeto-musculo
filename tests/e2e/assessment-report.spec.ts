import { copyFile, readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { addStudent, createProfessional, expectNoTermsBox, localIP, newActor, noHorizontalOverflow, openInvitation, showStudentTab } from "./helpers";
import { PARQ } from "../../src/modules/avaliacoes/catalog";

// Slice 0.81: the report of a recorded Avaliação Física in PDF, from the recorded assessment (professional) and from the student's area
// (user's decision of 02/11/2026: it goes to both). A draft has no report; another student's address is a 404; no session, no file.
const question = (page: Page, text: string) => page.getByRole("radiogroup", { name: text, exact: true });
const step = (page: Page, name: string) => page.getByRole("navigation", { name: "Etapas da avaliação física" }).getByRole("button", { name });
/** Screenshots of the new screens for the visual check of the slice, only where asked (SHOTS_DIR) and once (desktop project). */
async function shots(page: Page, name: string, projectName: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir || projectName !== "desktop") return;
  const size = page.viewportSize();
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${dir}/081-${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

test("the recorded Avaliação Física has its report in PDF for the professional and for the student, and only for them", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do relatório");
  const studentURL = await addStudent(page, "Aluna do relatório");

  // The student joins the portal first and has no assessment yet.
  const { client } = await openInvitation(page, browser, baseURL, "Aluna do relatório");
  await expectNoTermsBox(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);
  await expect(client.page.locator('a[href$="/aluno/avaliacoes"]').first()).toBeAttached();
  await client.page.goto("./aluno/avaliacoes");
  await expect(client.page.getByRole("heading", { name: "Avaliação Física", level: 1 })).toBeVisible();
  await expect(client.page.getByText("Nenhuma avaliação física registrada ainda.")).toBeVisible();

  // The professional records one: the triagem without "Sim", the weight and the height.
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  for (const text of Object.values(PARQ)) await question(page, text).getByRole("radio", { name: "Não", exact: true }).check();
  await step(page, "2 Medidas").click();
  await page.getByLabel("Peso (kg)").fill("69,1");
  await page.getByLabel("Altura (m)").fill("1,71");
  await page.getByLabel("Cintura (cm)").fill("69,5");
  await page.getByLabel("Quadril (cm)").fill("108");
  await step(page, "5 Revisão").click();
  // A draft has no report yet: the finalize card says where it will be.
  await expect(page.getByText("O relatório em PDF, para você e para o aluno, sai da avaliação registrada")).toBeVisible();
  await expect(page.getByRole("link", { name: "Baixar relatório em PDF" })).toHaveCount(0);
  const draftPath = new URL(page.url()).pathname;
  const draftReport = await page.request.get(new URL(`${draftPath}/pdf`, page.url()).href);
  expect(draftReport.status()).toBe(404);
  await page.getByRole("button", { name: "Finalizar avaliação" }).click();
  await page.getByRole("button", { name: "Confirmar e finalizar" }).click();
  await expect(page.getByRole("heading", { name: /^Avaliação física de \d{2}\/\d{2}\/\d{4}$/, level: 1 })).toBeVisible();

  // The professional downloads the report from the recorded assessment.
  const report = page.getByRole("link", { name: "Baixar relatório em PDF" });
  await expect(report).toBeVisible();
  await expect(page.getByText(/O mesmo relatório que o aluno baixa na área dele/)).toBeVisible();
  await shots(page, "registrada", testInfo.project.name);
  const proDownload = page.waitForEvent("download");
  await report.click();
  const pro = await proDownload;
  expect(pro.suggestedFilename()).toMatch(/^avaliacao-fisica-\d{4}-\d{2}-\d{2}\.pdf$/);
  const proFile = await readFile((await pro.path())!);
  expect(proFile.subarray(0, 5).toString()).toBe("%PDF-");
  const proDoc = await PDFDocument.load(proFile);
  expect(proDoc.getTitle()).toMatch(/^Avaliação física de \d{2}\/\d{2}\/\d{4}$/);
  const keywords = proDoc.getKeywords();
  if (process.env.SHOTS_DIR && testInfo.project.name === "desktop") await copyFile((await pro.path())!, `${process.env.SHOTS_DIR}/081-relatorio.pdf`);

  // The student lists it and downloads the same report (same version: the fingerprint of the printed content).
  await client.page.goto("./aluno/avaliacoes");
  const row = client.page.getByRole("row").filter({ hasText: "Inicial" });
  await expect(row).toContainText("Registrada");
  await expect(client.page.getByText("Valores estimados; sem classificação.", { exact: false })).toBeVisible();
  await noHorizontalOverflow(client.page);
  await shots(client.page, "aluno", testInfo.project.name);
  const link = row.getByRole("link", { name: /^Baixar PDF da avaliação de \d{2}\/\d{2}\/\d{4}$/ });
  const clientDownload = client.page.waitForEvent("download");
  await link.click();
  const mine = await clientDownload;
  expect(mine.suggestedFilename()).toBe(pro.suggestedFilename());
  const mineDoc = await PDFDocument.load(await readFile((await mine.path())!));
  expect(mineDoc.getKeywords()).toBe(keywords);

  // Somebody else's student or assessment is a plain 404; no session, no file.
  const pdfPath = new URL(await link.evaluate((a) => (a as HTMLAnchorElement).href)).pathname;
  const [, studentId, assessmentId] = pdfPath.match(/\/aluno\/avaliacoes\/pdf\/([^/]+)\/([^/]+)$/)!;
  const mountPrefix = pdfPath.slice(0, pdfPath.indexOf("/aluno/avaliacoes/pdf/"));
  for (const url of [`${mountPrefix}/aluno/avaliacoes/pdf/${assessmentId}/${assessmentId}`, `${mountPrefix}/aluno/avaliacoes/pdf/${studentId}/${studentId}`]) {
    const refused = await client.page.request.get(new URL(url, client.page.url()).href);
    expect(refused.status(), url).toBe(404);
  }
  const anonymous = await newActor(browser, baseURL);
  const noSession = await anonymous.page.request.get(new URL(pdfPath, client.page.url()).href);
  expect(noSession.headers()["content-type"] ?? "").not.toContain("application/pdf");
  await anonymous.context.close();
  await client.context.close();

  // Another organization does not get the professional's report by its address.
  const reportPath = new URL(await report.evaluate((a) => (a as HTMLAnchorElement).href)).pathname;
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio do relatório");
  const foreign = await other.page.request.get(new URL(reportPath, other.page.url()).href);
  expect(foreign.status()).toBe(404);
  await other.context.close();
});
