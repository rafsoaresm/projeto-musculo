import { test, expect } from "@playwright/test";
import {
  addStudent,
  approveWithoutDelivering,
  createNewRevision,
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
  password,
  uniqueEmail,
  expectNoTermsBox, openStructure, showStudentTab
} from "./helpers";

test("a professional saves, revisits and revises a plan; nobody else reaches it", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio dos planos");
  const studentURL = await addStudent(page, "Aluno do plano");

  // New plan: a name and a valid date are required before anything is stored.
  await showStudentTab(page, "Periodização");
  await page.getByRole("link", { name: "Novo plano" }).click();
  await expect(
    page.getByRole("heading", { name: "Novo plano de periodização" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();
  await expect(page.locator(".error-message")).toBeVisible();
  await page.getByLabel("Nome do plano").fill("Ciclo inicial");
  await page.getByLabel("Data de início").fill("2026-11-02");
  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();

  // Lands on revision 1 as a draft: the prescription first, the structure folded under it with the date and phases as saved.
  await expect(page.getByRole("heading", { name: "Ciclo inicial" })).toBeVisible();
  await expect(page.getByText("Rascunho", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prescrição dos exercícios" })).toBeVisible();
  await expect(page.locator("details.structure-details summary")).toContainText("3 fases · 12 semanas · 02/11/2026");
  await expect(page.getByLabel("Data de início")).toBeHidden();
  await openStructure(page);
  await expect(page.getByLabel("Data de início")).toHaveValue("2026-11-02");
  const revisionURL = page.url();
  await noHorizontalOverflow(page);

  // Change to six phases; saving is blocked from marking ready until saved.
  await page.getByLabel("Quantidade de fases").selectOption("6");
  await expect(page.getByText("Há alterações não salvas.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar e entregar", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Rascunho salvo.")).toBeVisible();
  await page.reload();
  await openStructure(page);
  await expect(page.getByLabel("Quantidade de fases")).toHaveValue("6");
  await expect(page.locator(".big-stat")).toContainText("24");

  // Approve without delivering (the exception, under "Mais ações"): the revision closes, is approved and the student does not get it.
  await approveWithoutDelivering(page);
  await expect(page.getByRole("region", { name: "Aprovada, não entregue" }).getByText("O aluno ainda não vê esta revisão", { exact: false }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar alterações" })).toHaveCount(0);
  await expect(page.getByLabel("Data de início")).toHaveCount(0);

  // A revision is copied, never edited: revision 2 opens as a draft.
  await createNewRevision(page);
  await expect(page.getByText("Revisão 2", { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel("Quantidade de fases")).toHaveValue("6");
  await page.goto(studentURL);
  await showStudentTab(page, "Periodização");
  await expect(page.getByRole("heading", { name: "Planos salvos" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revisão 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revisão 2" })).toBeVisible();
  // Revision 1 is still the validated one.
  await page.goto(revisionURL);
  await expect(page.getByRole("region", { name: "Aprovada, não entregue" })).toBeVisible();

  // Another organization cannot open the plan or the student by address.
  const other = await newActor(browser, baseURL);
  await other.page.goto("./cadastro");
  await other.page.waitForLoadState("networkidle");
  await other.page.getByLabel("Seu nome").fill("Outra pessoa");
  await other.page.getByLabel("E-mail", { exact: true }).fill(uniqueEmail("other"));
  await other.page.getByLabel("Senha", { exact: true }).fill(password);
  await other.page.locator("form button").click();
  await other.page.getByLabel("Nome do espaço").fill("Outro estúdio dos planos");
  await expectNoTermsBox(other.page);
  await other.page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(other.page.getByRole("heading", { name: "Visão geral", level: 1 })).toBeVisible();
  await other.page.goto(revisionURL);
  await expect(
    other.page.getByRole("heading", { name: "Página não encontrada." }),
  ).toBeVisible();
  await expect(other.page.getByText("Ciclo inicial")).toHaveCount(0);
  await other.context.close();
});
