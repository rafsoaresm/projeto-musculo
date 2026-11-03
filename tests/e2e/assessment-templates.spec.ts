import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow, showStudentTab } from "./helpers";
import { PARQ } from "../../src/modules/avaliacoes/catalog";

// Slice 0.85: models (templates) of the Avaliação Física (handoff V2 section 2: activate or reorder the optional modules per template). A model
// leaves parts out and changes the order of the middle steps; a draft started with it hides what it leaves out, the review and the record say
// "Não incluído neste modelo" (never "Não realizado"), the finalize is not blocked by it, and editing the model writes a new version.
const question = (page: Page, text: string) => page.getByRole("radiogroup", { name: text, exact: true });
const steps = (page: Page) => page.getByRole("navigation", { name: "Etapas da avaliação física" });
const part = (page: Page, name: string) => page.getByRole("checkbox", { name: new RegExp(`^${name}`) });

/** Screenshots of the slice (SHOTS_DIR), at every width asked, once (desktop project). */
async function shots(page: Page, name: string, projectName: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir || projectName !== "desktop") return;
  const size = page.viewportSize();
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${dir}/${process.env.SHOTS_PREFIX ?? "085-"}${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

test("a model of the Avaliação Física leaves parts out, reorders the steps, never blocks the finalize, and is versioned", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio dos modelos");
  const studentURL = await addStudent(page, "Aluno do modelo");

  // Without a model the start is as before: no choice, every step.
  await page.goto("./profissional/avaliacoes");
  await page.getByRole("link", { name: "Modelos de avaliação" }).click();
  await expect(page.getByRole("heading", { name: "Nenhum modelo ainda." })).toBeVisible();
  await page.getByRole("link", { name: "Novo modelo" }).click();
  await expect(page.getByRole("heading", { name: "Novo modelo de avaliação" })).toBeVisible();
  // The Triagem is not a choice: it gates the plans.
  await expect(page.getByRole("region", { name: "1 · Triagem e segurança" }).getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("Todas as partes opcionais incluídas.")).toBeVisible();
  await shots(page, "modelo-novo", testInfo.project.name);

  await page.getByLabel("Nome", { exact: true }).fill("Corrida");
  for (const name of ["Dobras cutâneas", "Diâmetros ósseos", "Avaliação postural", "Somatotipo", "Flexiteste", "Resistência abdominal", "Resistência de membros superiores", "Considerações finais"])
    await part(page, name).uncheck();
  await expect(page.getByText("8 partes opcionais fora deste modelo.")).toBeVisible();
  // Testes before Medidas.
  await page.getByRole("button", { name: "Subir Testes" }).click();
  await page.getByRole("button", { name: "Subir Testes" }).click();
  await expect(page.getByRole("button", { name: "Subir Testes" })).toBeDisabled();
  // The editor names and numbers the steps as the draft's chips will: a step with nothing ticked has no number, and the ones after move up.
  await expect(page.getByRole("heading", { level: 3, name: /^\d · / })).toHaveText([
    "1 · Triagem e segurança",
    "2 · Testes físicos",
    "3 · Composição corporal",
    "4 · Revisão e conclusão",
  ]);
  await expect(page.getByRole("heading", { level: 3, name: "Postura e movimento · não aparece neste modelo" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Criar modelo" }).click();
  await expect(page.getByText("Modelo “Corrida” salvo na versão 1.")).toBeVisible();
  const row = page.getByRole("row", { name: /Corrida/ });
  await expect(row).toContainText("3 de 11 partes opcionais");
  await expect(row).toContainText("Triagem, Testes, Medidas, Movimento, Revisão");
  await expect(row).toContainText("Fora: Dobras cutâneas, Diâmetros ósseos");
  await shots(page, "modelos-lista", testInfo.project.name);

  // Start an assessment with the model: only the steps it shows, in its order.
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByLabel("Modelo da avaliação").selectOption({ label: "Corrida (versão 1)" });
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  await expect(page.getByText(/Modelo: Corrida \(versão 1\)\./)).toBeVisible();
  await expect(steps(page).getByRole("button")).toHaveText(["1 Triagem", "2 Testes", "3 Medidas", "4 Revisão"]);
  for (const text of Object.values(PARQ)) await question(page, text).getByRole("radio", { name: "Não", exact: true }).check();

  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByRole("heading", { name: "Testes físicos" })).toBeVisible();
  await expect(page.getByText("Não incluído neste modelo: Resistência abdominal, Resistência de membros superiores.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Resistência abdominal" })).toHaveCount(0);
  await page.getByLabel("Distância percorrida (m)").fill("2200");
  await shots(page, "rascunho-testes", testInfo.project.name);

  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByRole("heading", { name: "Composição corporal" })).toBeVisible();
  await expect(page.getByText("Não incluído neste modelo: Dobras cutâneas, Diâmetros ósseos.")).toBeVisible();
  // The description under the title names only what the model has (never "dobras" above "Não incluído neste modelo: Dobras cutâneas").
  await expect(page.getByText("Neste modelo: Medidas básicas e sinais vitais, Perímetros corporais")).toBeVisible();
  await expect(page.getByRole("region", { name: "Protocolo de dobras cutâneas" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Diâmetros ósseos • cm" })).toHaveCount(0);
  await page.getByLabel("Peso (kg)").fill("70");
  await page.getByLabel("Altura (m)").fill("1,70");
  // The preview keeps only what the model has: the BMI, no skinfold result.
  const preview = page.getByRole("region", { name: "Prévia calculada" });
  await expect(preview.locator(".av2-result dt")).toHaveText(["IMC"]);
  await noHorizontalOverflow(page);
  await shots(page, "rascunho-medidas", testInfo.project.name);

  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByRole("heading", { name: "Revisão e conclusão" })).toBeVisible();
  await expect(page.getByText("Não incluído neste modelo: Considerações finais.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Considerações finais" })).toHaveCount(0);
  const checklist = page.getByRole("region", { name: "Checklist por etapa" });
  const movement = checklist.locator(".av2-module", { has: page.getByText("Movimento", { exact: true }) });
  await expect(movement.locator(".pill")).toHaveText("Não incluído neste modelo");
  await expect(checklist.getByText("Dobras cutâneas: Não incluído neste modelo")).toBeVisible();
  // The checklist follows the model's order of the steps, as the chips do.
  await expect(checklist.locator(".av2-module-head strong")).toHaveText(["Triagem", "Testes físicos", "Medidas", "Movimento"]);
  await expect(page.getByText("Nada pendente: a avaliação pode ser finalizada.")).toBeVisible();
  await shots(page, "rascunho-revisao", testInfo.project.name);
  await page.getByRole("button", { name: "Finalizar avaliação" }).click();
  await page.getByRole("button", { name: "Confirmar e finalizar" }).click();

  // The record: the model, and what it left out said as such.
  await expect(page.getByRole("heading", { name: /^Avaliação física de \d{2}\/\d{2}\/\d{4}$/ })).toBeVisible();
  await expect(page.getByText("Modelo: Corrida (versão 1).")).toBeVisible();
  const recordedMovement = page.getByRole("region", { name: "Postura e movimento" });
  await expect(recordedMovement.getByText("Não incluído neste modelo.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Considerações finais" }).getByText("Não incluído neste modelo.")).toBeVisible();
  // A part left out reads the same way in every card: its subtitle, then "Não incluído neste modelo.".
  const recordedMeasures = page.getByRole("region", { name: "Medidas", exact: true });
  await expect(recordedMeasures.getByRole("heading", { name: "Dobras cutâneas" })).toBeVisible();
  await expect(recordedMeasures.getByText("Não incluído neste modelo.")).toHaveCount(2);
  const recordedTests = page.getByRole("region", { name: "Testes físicos" });
  await expect(recordedTests.getByText("Não incluído neste modelo.")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Resultados" }).getByText("Cooper, VO₂máx estimado")).toBeVisible();
  await noHorizontalOverflow(page);
  await shots(page, "registro", testInfo.project.name);

  // Editing the model writes version 2; the recorded assessment still says version 1.
  const recordURL = page.url();
  await page.goto("./profissional/avaliacoes/modelos");
  await page.getByRole("link", { name: "Corrida", exact: true }).click();
  await expect(page.getByText(/Salvar cria a versão 2/)).toBeVisible();
  await part(page, "Flexiteste").check();
  await page.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(page.getByText("Modelo “Corrida” salvo na versão 2.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Corrida/ })).toContainText("1 avaliação");
  await page.goto(recordURL);
  await expect(page.getByText("Modelo: Corrida (versão 1).")).toBeVisible();
});
