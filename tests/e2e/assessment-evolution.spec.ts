import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, expectNoTermsBox, localIP, noHorizontalOverflow, openInvitation, showStudentTab } from "./helpers";
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
    await page.screenshot({ path: `${dir}/${process.env.SHOTS_PREFIX ?? "082"}-${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

// Slice 0.84: both are recorded today, so they share the date: in the order recorded, side by side on the chart, each dated with its time;
// the student reads the same series in their area (read only), and only their own.
const sameDayTime = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}( \([12]ª de 2 no dia\))?$/;

test("the evolution compares a result only within the same method: a change of protocol is a separate series, marked where it happens", async ({ page, browser, baseURL }, testInfo) => {
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
  // The handoff's warning, verbatim (4.3).
  await expect(fat.getByText("Metodologias diferentes; comparação de % de gordura pode não ser equivalente", { exact: false })).toBeVisible();
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
  await expect(rows.nth(1)).toContainText("conversão Siri (1961)");
  await expect(rows.nth(2)).not.toContainText("conversão");
  // The sum of skinfolds follows the protocol too: 122 mm and 66 mm are never one line.
  const sum = results.getByRole("group", { name: "Soma das dobras", exact: true });
  await expect(sum.getByText("Metodologias diferentes; comparação de “Soma das dobras” pode não ser equivalente", { exact: false })).toBeVisible();
  // The sum is measured, not estimated, and the conversion (Siri) is only the % fat's (handoff 4.2).
  const jp7Sum = sum.getByRole("group", { name: "Soma das dobras, Jackson & Pollock · 7, equação masculina" });
  await expect(jp7Sum).toContainText("fórmula av2-2026-11");
  await expect(jp7Sum).not.toContainText("estimativa");
  await expect(jp7Sum).not.toContainText("conversão");
  // BMI: the same arithmetic both times, one series with its chart; no classification anywhere.
  const bmi = results.getByRole("group", { name: "IMC", exact: true });
  await expect(bmi.getByText(/Metodologias diferentes/)).toHaveCount(0);
  await expect(bmi).toContainText("2 valores. Primeiro: 23,63 kg/m² em");
  await expect(bmi).toContainText("Último: 23,94 kg/m² em");
  await expect(bmi.getByRole("group", { name: "Gráfico: IMC, peso ÷ altura². Use as setas para percorrer as medições." })).toBeVisible();
  await expect(results).not.toContainText(/\bnormal\b|\bbom\b|\bruim\b|excelente|sobrepeso|obesidade/i);
  // Two of the same date: each value dated with the time it was recorded, oldest first, and two separate points on the chart.
  await bmi.getByText("Ver os valores").click();
  const bmiDates = bmi.getByRole("table").getByRole("rowheader");
  await expect(bmiDates).toHaveCount(2);
  const [firstAt, secondAt] = [await bmiDates.nth(0).innerText(), await bmiDates.nth(1).innerText()];
  expect(firstAt).toMatch(sameDayTime);
  expect(secondAt).toMatch(sameDayTime);
  expect(firstAt < secondAt).toBe(true);
  await expect(bmi.getByRole("table").getByRole("row").nth(1)).toContainText("23,63 kg/m²");
  const dots = bmi.locator("circle.chart-dot");
  await expect(dots).toHaveCount(2);
  const xs = await dots.evaluateAll((items) => items.map((item) => Number(item.getAttribute("cx"))));
  expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(10);
  // The item-by-item comparison of the earlier format does not claim "no differences" for these.
  await expect(page.getByText("Sem diferenças")).toHaveCount(0);
  await noHorizontalOverflow(page);
  await shots(page, "evolucao", testInfo.project.name);

  // The student, once linked, reads the same series in their area, read only.
  await page.goto(studentURL);
  const { client } = await openInvitation(page, browser, baseURL, "Aluno da evolução");
  await expectNoTermsBox(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);
  await client.page.goto("./aluno/avaliacoes");
  const mine = client.page.getByRole("region", { name: "Resultados ao longo do tempo" });
  await expect(mine).toBeVisible();
  const myFat = mine.getByRole("group", { name: "Gordura estimada", exact: true });
  await expect(myFat.getByText("Metodologias diferentes; comparação de % de gordura pode não ser equivalente", { exact: false })).toBeVisible();
  await expect(myFat.getByRole("group", { name: "Gordura estimada, Faulkner", exact: true })).toContainText("Um valor: 15,9% em");
  await expect(myFat.getByRole("group", { name: /^Gráfico:/ })).toHaveCount(0);
  const myBmi = mine.getByRole("group", { name: "IMC", exact: true });
  await expect(myBmi).toContainText("2 valores. Primeiro: 23,63 kg/m² em");
  await expect(myBmi.getByRole("group", { name: "Gráfico: IMC, peso ÷ altura². Use as setas para percorrer as medições." })).toBeVisible();
  await myBmi.getByText("Ver os valores").click();
  await expect(myBmi.getByRole("table").getByRole("rowheader")).toHaveText([firstAt, secondAt]);
  await expect(mine).not.toContainText(/\bnormal\b|\bbom\b|\bruim\b|excelente|sobrepeso|obesidade/i);
  // Read only: nothing to start, finalize or change from here, and no professional link.
  await expect(client.page.getByRole("button", { name: /Iniciar|Finalizar|Retificar/ })).toHaveCount(0);
  await expect(client.page.locator('a[href*="/profissional/"]')).toHaveCount(0);
  await noHorizontalOverflow(client.page);
  await shots(client.page, "aluno-evolucao", testInfo.project.name);
  await client.context.close();
});
