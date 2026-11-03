import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow, readyPlan, showStudentTab } from "./helpers";
import { PARQ } from "../../src/modules/avaliacoes/catalog";

// Slice 0.77: the "Revisão" step, finalize, the recorded assessment, the plan gate on the PAR-Q, the amendment (retificação) and the history.
// The figures are the handoff's example (section 8): a man of 27 on the assessment date, 69,1 kg, 1,71 m, Jackson & Pollock 7 → 122 mm, 17,3%.
const JP7 = { Peitoral: "12", "Axilar média": "9", "Tríceps": "24", Subescapular: "11", Abdominal: "16", "Supra-ilíaca": "15", Coxa: "35" };
const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
};
const question = (page: Page, text: string) => page.getByRole("radiogroup", { name: text, exact: true });
const step = (page: Page, name: string) => page.getByRole("navigation", { name: "Etapas da avaliação física" }).getByRole("button", { name });
/** Screenshots for the visual check of the slice, at 1280 and 390, only where asked (SHOTS_DIR) and once (desktop project). */
async function shots(page: Page, name: string, projectName: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir || projectName !== "desktop") return;
  const size = page.viewportSize();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}/077b-${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

test("the Revisão step finalizes the Avaliação Física, the record shows the results with their method, the plan reads the PAR-Q, and an amendment keeps the original", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da finalização");
  const studentURL = await addStudent(page, "Aluno da finalização");
  await page.getByRole("link", { name: "Preencher a ficha", exact: true }).click();
  await page.getByLabel("Data de nascimento").fill(yearsAgo(27));
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Ficha salva.")).toBeVisible();
  const revisionURL = await readyPlan(page, studentURL, "Plano da finalização");

  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();

  // Revisão with nothing filled: the PAR-Q blocks, Medidas and Movimento are "Não realizado", and nothing can be finalized.
  await step(page, "4 Revisão").click();
  const pending = page.getByRole("region", { name: "Pendências para finalizar" });
  await expect(pending.getByText("PAR-Q: 7 de 7 perguntas sem resposta")).toBeVisible();
  const checklist = page.getByRole("region", { name: "Checklist por etapa" });
  await expect(checklist.getByText("Não realizado", { exact: true }).first()).toBeVisible();
  const finalize = page.getByRole("button", { name: "Finalizar avaliação" });
  await expect(finalize).toHaveAttribute("aria-disabled", "true");
  await finalize.click({ force: true });
  await expect(page.getByRole("button", { name: "Confirmar e finalizar" })).toHaveCount(0);

  // Triagem: every answer, one "Sim" and no decision yet.
  await step(page, "1 Triagem").click();
  for (const text of Object.values(PARQ)) await question(page, text).getByRole("radio", { name: "Não", exact: true }).check();
  await question(page, PARQ.dizziness).getByRole("radio", { name: "Sim" }).check();
  await step(page, "4 Revisão").click();
  await expect(pending.getByText("PAR-Q com “Sim”: registre a decisão profissional")).toBeVisible();
  await expect(pending.getByText("PAR-Q com “Sim”: escreva a nota da decisão")).toBeVisible();
  await expect(finalize).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText(/^Ainda não pode ser finalizada: resolva as 2 pendências listadas/)).toBeVisible();
  await noHorizontalOverflow(page);
  await shots(page, "revisao-pendente", testInfo.project.name);
  // The pending items say where they are fixed: the button goes to the Triagem.
  await pending.getByRole("button", { name: "Abrir a etapa Triagem" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  await step(page, "4 Revisão").click();
  // The last step has no "Próximo": the next action is the finalize card.
  await expect(page.getByRole("button", { name: "Próximo" })).toHaveCount(0);

  // Meanwhile the plan still has no recorded screening: an open draft (with a "Sim" and no decision) never counts as one.
  const draftURL = page.url();
  await page.goto(revisionURL);
  await expect(page.getByText("Triagem não registrada.")).toBeVisible();
  await page.goto(draftURL);

  // The decision, then Medidas with the handoff's example.
  await step(page, "1 Triagem").click();
  const decision = page.getByRole("region", { name: "Decisão profissional" });
  await decision.getByRole("radio", { name: "Precisa de liberação médica" }).check();
  await decision.getByLabel("Nota da decisão").fill("Encaminhado ao cardiologista antes de treinos intensos.");
  await step(page, "2 Medidas").click();
  await page.getByLabel("Peso (kg)").fill("69,1");
  await page.getByLabel("Altura (m)").fill("1,71");
  await page.getByRole("radio", { name: "Jackson & Pollock · 7" }).check();
  await page.getByLabel("Referência da equação", { exact: true }).selectOption("male");
  for (const [name, value] of Object.entries(JP7)) await page.getByLabel(`${name} (mm)`, { exact: true }).fill(value);
  // Slice 0.78: the handoff's waist and hip, one thigh pair and one calf with a side missing.
  await page.getByLabel("Cintura (cm)").fill("69,5");
  await page.getByLabel("Quadril (cm)").fill("108");
  await page.getByLabel("Coxa direita (cm)").fill("56");
  await page.getByLabel("Coxa esquerda (cm)").fill("56,6");
  await page.getByLabel("Panturrilha direita (cm)").fill("40");
  await page.getByLabel("Biestiloide (cm)").fill("5,7");

  await step(page, "4 Revisão").click();
  await expect(pending.getByText("Nada pendente: a avaliação pode ser finalizada.")).toBeVisible();
  const toRecord = page.getByRole("list", { name: "Resultados a registrar" });
  await expect(toRecord.getByRole("listitem").filter({ hasText: "Gordura estimada" })).toContainText("17,3%");
  await expect(toRecord.getByRole("listitem").filter({ hasText: "Gordura estimada" })).toContainText("Jackson & Pollock · 7, equação masculina");
  await expect(toRecord.getByRole("listitem").filter({ hasText: "Soma das dobras" })).toContainText("122 mm");
  await expect(toRecord.getByRole("listitem").filter({ hasText: "IMC" })).toContainText("23,63");
  const ratioRow = toRecord.getByRole("listitem").filter({ hasText: "RCQ" });
  await expect(ratioRow).toContainText("0,644");
  await expect(ratioRow).toContainText("cintura ÷ quadril · fórmula av2-2026-11");
  await expect(ratioRow).not.toContainText("estimativa");
  const thighRow = toRecord.getByRole("listitem").filter({ hasText: "Diferença bilateral da coxa" });
  await expect(thighRow.locator(".av2-result-value")).toHaveText("−0,6 cm");
  await expect(thighRow.locator(".av2-result-method")).toHaveText("esquerdo maior em 0,6 cm · direito − esquerdo · fórmula av2-2026-11");
  await expect(page.getByText("Diferença bilateral da panturrilha: falta o lado esquerdo")).toBeVisible();
  await expect(checklist.getByText("Perímetros: 3 de 9 com medida · Panturrilha só com um lado")).toBeVisible();
  await expect(checklist.getByText("Diâmetros ósseos: 1 de 3 com medida")).toBeVisible();
  await noHorizontalOverflow(page);
  await shots(page, "revisao", testInfo.project.name);

  // Finalize asks once more, saves what is still on the screen, and goes to the record.
  await finalize.click();
  await page.getByRole("button", { name: "Confirmar e finalizar" }).click();
  await expect(page.getByRole("heading", { name: /^Avaliação física de \d{2}\/\d{2}\/\d{4}$/, level: 1 })).toBeVisible();
  const recordedURL = page.url();
  await expect(page.getByText("PAR-Q com “Sim”, decisão registrada")).toBeVisible();
  const results = page.getByRole("list", { name: "Resultados" });
  await expect(results.getByRole("listitem").filter({ hasText: "Gordura estimada" })).toContainText("17,3%");
  await expect(results.getByRole("listitem").filter({ hasText: "Gordura estimada" })).toContainText("fórmula av2-2026-11");
  await expect(results.getByRole("listitem").filter({ hasText: "Massa gorda" })).toContainText("11,9 kg");
  await expect(results.getByRole("listitem").filter({ hasText: "RCQ" })).toContainText("0,644");
  await expect(results.getByRole("listitem").filter({ hasText: "Diferença bilateral da coxa" })).toContainText("−0,6 cm");
  const recordedPerimeters = page.getByRole("definition").filter({ hasText: /^D 40 cm \/ E Sem aferição$/ });
  await expect(recordedPerimeters).toBeVisible();
  await expect(page.getByText("Biestiloide", { exact: true })).toBeVisible();
  const recordedDecision = page.getByRole("group", { name: "Decisão profissional" });
  await expect(recordedDecision).toContainText("Precisa de liberação médica");
  await expect(recordedDecision).toContainText(/Registrada por .+ em \d{2}\/\d{2}\/\d{4}/);
  await expect(page.getByRole("region", { name: "Movimento" }).getByText("Não realizado.")).toBeVisible();
  // Nothing of it is editable any more.
  await expect(page.getByRole("button", { name: "Salvar rascunho" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Peso (kg)" })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await shots(page, "registrada", testInfo.project.name);

  // The plan reads the PAR-Q: a "Sim" with the recorded decision approves with no acknowledgement.
  await page.goto(revisionURL);
  await expect(page.getByText("PAR-Q com “Sim” e decisão profissional registrada")).toBeVisible();
  await expect(page.getByLabel(/Confirmo que não há triagem registrada/)).toHaveCount(0);
  await shots(page, "plano", testInfo.project.name);
  await page.getByRole("button", { name: "Aprovar revisão" }).click();
  await expect(page.getByRole("heading", { name: "Entregar ao aluno" })).toBeVisible();

  // Retificar: a reason is required; the amendment is a new draft with the original's modules.
  await page.goto(recordedURL);
  await page.getByRole("button", { name: "Retificar" }).click();
  await page.getByRole("button", { name: "Criar retificação" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Escreva o motivo da retificação" })).toBeVisible();
  await page.getByLabel("Motivo da retificação").fill("Resposta do PAR-Q sobre articulações registrada errada");
  await page.getByRole("button", { name: "Criar retificação" }).click();
  await expect(page.getByRole("heading", { name: "Retificação da avaliação física de Aluno da finalização" })).toBeVisible();
  await expect(page.getByText(/Motivo: Resposta do PAR-Q sobre articulações registrada errada/)).toBeVisible();
  await expect(question(page, PARQ.dizziness).getByRole("radio", { name: "Sim" })).toBeChecked();
  await question(page, PARQ.bone_joint).getByRole("radio", { name: "Sim" }).check();
  await step(page, "4 Revisão").click();
  await expect(pending.getByText("Retificação com nova resposta “Sim” no PAR-Q: revise a decisão profissional e a nota")).toBeVisible();
  await shots(page, "retificacao", testInfo.project.name);
  await step(page, "1 Triagem").click();
  await decision.getByLabel("Nota da decisão").fill("Encaminhado ao cardiologista e ao ortopedista antes de treinos intensos.");
  await step(page, "4 Revisão").click();
  await page.getByRole("button", { name: "Finalizar retificação" }).click();
  await page.getByRole("button", { name: "Confirmar e finalizar" }).click();
  await expect(page.getByRole("heading", { name: /^Retificação da avaliação física de \d{2}\/\d{2}\/\d{4}$/, level: 1 })).toBeVisible();
  await expect(page.getByText(/Motivo: Resposta do PAR-Q sobre articulações registrada errada/)).toBeVisible();

  // The original stays as it was, read as amended.
  await page.goto(recordedURL);
  await expect(page.getByText(/^Retificada por/)).toBeVisible();
  await expect(page.getByRole("link", { name: /^retificação registrada em \d{2}\/\d{2}\/\d{4}/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Respostas do PAR-Q" }).getByRole("listitem").filter({ hasText: PARQ.bone_joint })).toContainText("Não");
  await expect(page.getByRole("button", { name: "Retificar" })).toHaveCount(0);

  // The history: date and kind, PAR-Q, body fat with its method, BMI; the amended one says so.
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  const history = page.getByRole("table", { name: "Histórico de avaliações físicas" });
  await expect(history.getByRole("row")).toHaveCount(3);
  const amended = history.getByRole("row").filter({ hasText: "Retificada" });
  await expect(amended).toContainText("Avaliação física de");
  await expect(amended.getByRole("cell").filter({ hasText: /^Inicial$/ })).toBeVisible();
  await expect(amended.getByRole("link", { name: /^retificação registrada em/ })).toBeVisible();
  const amendment = history.getByRole("row").filter({ hasText: "Retificação da avaliação física de" });
  await expect(amendment.getByRole("cell").filter({ hasText: /^Retificação$/ })).toBeVisible();
  await expect(amendment).toContainText("17,3%");
  await expect(amendment).toContainText("Jackson & Pollock · 7, equação masculina");
  await expect(amendment).toContainText("23,63");
  await expect(amendment).toContainText("PAR-Q com “Sim”, decisão registrada");
  await noHorizontalOverflow(page);
  await shots(page, "historico", testInfo.project.name);

  // A reassessment offers the previous reference of the equation, and copies nothing by itself.
  await page.getByRole("button", { name: "Iniciar reavaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Reavaliação física de Aluno da finalização" })).toBeVisible();
  await step(page, "2 Medidas").click();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("");
  await expect(page.getByLabel("Referência da equação", { exact: true })).toHaveValue("not_selected");
  await page.getByRole("button", { name: "Usar a mesma referência" }).click();
  await expect(page.getByLabel("Referência da equação", { exact: true })).toHaveValue("male");
});
