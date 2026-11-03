import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, showStudentTab } from "./helpers";
import { PARQ } from "../../src/modules/avaliacoes/catalog";

// Temporary: screenshots of slice 0.80 at five widths. Removed before the slice is handed over.
const DIR = "/tmp/claude-0/-home-user-projeto-musculo/437756eb-90b4-5954-a2ec-e4bf8a130c76/scratchpad/av2-p1";
const WIDTHS = [1440, 1280, 1024, 768, 390];
const mount = process.env.BASE_URL ? "b" : "";
async function shots(page: Page, name: string, region?: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    if (region) await page.getByRole("region", { name: region }).screenshot({ path: `${DIR}/0.80${mount}-${name}-${width}.png` });
    else await page.screenshot({ path: `${DIR}/0.80${mount}-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
test("screenshots 0.80", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(300_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das capturas 080");
  await addStudent(page, "Aluno das capturas");
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  for (const text of Object.values(PARQ)) await page.getByRole("radiogroup", { name: text, exact: true }).getByRole("radio", { name: "Não", exact: true }).check();
  const steps = page.getByRole("navigation", { name: "Etapas da avaliação física" });
  await steps.getByRole("button", { name: "3 Movimento" }).click();
  const flexitest = page.getByRole("region", { name: "Flexiteste · 15 movimentos" });
  const levels = [2, 3, 2, 2, 1, 1, 2, 3, 3, 2, 2, 3, 2, 2];
  for (const [index, level] of levels.entries()) await flexitest.getByRole("radiogroup").nth(index).getByRole("radio", { name: `Nível ${level}` }).check();
  await flexitest.getByLabel("Classificação (manual)").fill("Médio (-)");
  await shots(page, "flexiteste", "Flexiteste · 15 movimentos");
  await steps.getByRole("button", { name: "4 Testes" }).click();
  const abdominal = page.getByRole("region", { name: "Resistência abdominal" });
  await abdominal.getByLabel("Exercício ou protocolo").fill("Abdominal em 1 minuto");
  await abdominal.getByLabel("Repetições completas (rep)").fill("35");
  await abdominal.getByLabel("Duração (s)").fill("60");
  await page.getByRole("region", { name: "Resistência de membros superiores" }).getByLabel("Repetições completas (rep)").fill("22");
  await page.getByRole("region", { name: "Teste de Cooper · 12 minutos" }).getByLabel("Distância percorrida (m)").fill("2.200");
  await shots(page, "testes");
  await steps.getByRole("button", { name: "5 Revisão" }).click();
  await page.getByRole("region", { name: "Considerações finais" }).getByLabel("Considerações finais").fill("Boa mobilidade geral.\nQuadril esquerdo aduzido.");
  await shots(page, "revisao");
  await page.getByRole("button", { name: "Finalizar avaliação" }).click();
  await page.getByRole("button", { name: "Confirmar e finalizar" }).click();
  await expect(page.getByRole("heading", { name: /^Avaliação física de \d{2}\/\d{2}\/\d{4}$/, level: 1 })).toBeVisible();
  await shots(page, "registro");
});
