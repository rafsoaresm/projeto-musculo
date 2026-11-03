import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow, showStudentTab } from "./helpers";
import { PARQ } from "../../src/modules/avaliacoes/catalog";

// Slice 0.82: the evolution of the results compares only values obtained the same way (handoff 4.3, 5, 9). Two Avaliações Físicas of the
// handoff's man (section 8): the first with Jackson & Pollock 7 (17,3%), the reassessment with Faulkner (15,88%). The body fat is two series
// with the warning of different methodologies, never one line; the BMI, the same arithmetic both times, is one series with its chart.
const JP7 = { Peitoral: "12", "Axilar média": "9", "Tríceps": "24", Subescapular: "11", Abdominal: "16", "Supra-ilíaca": "15", Coxa: "35" };
const FAULKNER = { "Tríceps": "24", Subescapular: "11", Abdominal: "16", "Supra-ilíaca": "15" };
const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
};
const step = (page: Page, name: string) => page.getByRole("navigation", { name: "Etapas da avaliação física" }).getByRole("button", { name });

/** Fills the PAR-Q with "Não", the weight, height and the skinfolds of one protocol, and finalizes. */
async function recordOne(page: Page, protocol: string, folds: Record<string, string>, weight: string) {
  for (const text of Object.values(PARQ)) await page.getByRole("radiogroup", { name: text, exact: true }).getByRole("radio", { name: "Não", exact: true }).check();
  await step(page, "2 Medidas").click();
  await page.getByLabel("Peso (kg)").fill(weight);
  await page.getByLabel("Altura (m)").fill("1,71");
  await page.getByRole("radio", { name: protocol }).check();
  await page.getByLabel("Referência da equação", { exact: true }).selectOption("male");
  for (const [name, value] of Object.entries(folds)) await page.getByLabel(`${name} (mm)`, { exact: true }).fill(value);
  await step(page, "5 Revisão").click();
  await expect(page.getByText("Nada pendente: a avaliação pode ser finalizada.")).toBeVisible();
  await page.getByRole("button", { name: "Finalizar avaliação" }).click();
  await page.getByRole("button", { name: "Confirmar e finalizar" }).click();
  await expect(page.getByRole("heading", { name: /^(Avaliação|Reavaliação) física de \d{2}\/\d{2}\/\d{4}$/, level: 1 })).toBeVisible();
}

/** Screenshots for the visual check of the slice, only where asked (SHOTS_DIR) and once (desktop project). */
async function shots(page: Page, name: string, projectName: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir || projectName !== "desktop") return;
  const size = page.viewportSize();
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${dir}/082-${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

test("the evolution compares a result only within the same method: a change of protocol is a separate series, marked where it happens", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da evolução");
  const studentURL = await addStudent(page, "Aluno da evolução");
  await page.getByRole("link", { name: "Preencher a ficha", exact: true }).click();
  await page.getByLabel("Data de nascimento").fill(yearsAgo(27));
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Ficha salva.")).toBeVisible();

  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await recordOne(page, "Jackson & Pollock · 7", JP7, "69,1");

  // One assessment: each result is one value, no chart, no warning.
  await page.goto(`${studentURL}/evolucao`);
  const results = page.getByRole("region", { name: "Resultados ao longo do tempo" });
  const fat = results.getByRole("group", { name: "Gordura estimada", exact: true });
  await expect(fat).toContainText("Um valor: 17,3% em");
  await expect(fat).toContainText("Jackson & Pollock · 7, equação masculina");
  await expect(fat).toContainText("fórmula av2-2026-11 · conversão Siri (1961) · estimativa");
  await expect(fat.getByText(/Metodologias diferentes/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Medidas do formato anterior" })).toHaveCount(0);

  // The reassessment, with another protocol.
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar reavaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Reavaliação física de Aluno da evolução" })).toBeVisible();
  await recordOne(page, "Faulkner", FAULKNER, "70");

  await page.goto(`${studentURL}/evolucao`);
  await expect(page.getByText("2 avaliações registradas", { exact: false })).toBeVisible();
  // Body fat: two methods, two series, the warning; never one chart joining them.
  await expect(fat.getByText("Metodologias diferentes: a comparação de gordura estimada entre elas pode não ser equivalente.", { exact: false })).toBeVisible();
  const jp7 = fat.getByRole("group", { name: "Gordura estimada, Jackson & Pollock · 7, equação masculina" });
  const faulkner = fat.getByRole("group", { name: "Gordura estimada, Faulkner", exact: true });
  await expect(jp7).toContainText("Um valor: 17,3% em");
  await expect(faulkner).toContainText("Um valor: 15,9% em");
  await expect(faulkner).toContainText("Método da avaliação mais recente");
  await expect(jp7).not.toContainText("Método da avaliação mais recente");
  await expect(fat.getByRole("group", { name: /^Gráfico:/ })).toHaveCount(0);
  // The values in time, the break marked on the Faulkner one.
  await fat.getByText("Ver os valores").click();
  const rows = fat.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText("Primeiro valor");
  await expect(rows.nth(2)).toContainText("15,9%");
  await expect(rows.nth(2)).toContainText("Método diferente do valor anterior");
  // The sum of skinfolds follows the protocol too: 122 mm and 66 mm are never one line.
  const sum = results.getByRole("group", { name: "Soma das dobras", exact: true });
  await expect(sum.getByText(/Metodologias diferentes/)).toBeVisible();
  // BMI: the same arithmetic both times, one series with its chart; no classification anywhere.
  const bmi = results.getByRole("group", { name: "IMC", exact: true });
  await expect(bmi.getByText(/Metodologias diferentes/)).toHaveCount(0);
  await expect(bmi).toContainText("2 valores. Primeiro: 23,63 kg/m² em");
  await expect(bmi).toContainText("Último: 23,94 kg/m² em");
  await expect(bmi.getByRole("group", { name: "Gráfico: IMC, peso ÷ altura². Use as setas para percorrer as medições." })).toBeVisible();
  await expect(results).not.toContainText(/\bnormal\b|\bbom\b|\bruim\b|excelente|sobrepeso|obesidade/i);
  // The item-by-item comparison of the earlier format does not claim "no differences" for these.
  await expect(page.getByText("Sem diferenças")).toHaveCount(0);
  await noHorizontalOverflow(page);
  await shots(page, "evolucao", testInfo.project.name);
});
