import { test, expect } from "@playwright/test";
import { addStudent, createProfessional, localIP, newActor, noHorizontalOverflow, readyPlan, showStudentTab } from "./helpers";

// The Avaliação Física is the only assessment (user's decision of 03/11/2026). Until it can be finalized (a later slice), no assessment can be
// recorded: the plan approval keeps its acknowledgement path, and a draft never counts as a screening. The records of the earlier format that
// exist (their reading, their review and the hold of an unreviewed alert on a plan) are in `assessments-legacy.spec.ts`.

test("without a recorded assessment the plan approval asks for the acknowledgement and points to the Avaliação Física; a draft does not count", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do aviso de ciência");
  const studentURL = await addStudent(page, "Aluno do aviso de ciência");
  const revisionURL = await readyPlan(page, studentURL, "Plano do aviso de ciência");

  await expect(page.getByText("Triagem não registrada.")).toBeVisible();
  await page.getByRole("link", { name: "Iniciar a avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação Física de Aluno do aviso de ciência" })).toBeVisible();
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação física de Aluno do aviso de ciência" })).toBeVisible();
  await page.getByLabel("Peso (kg)").fill("70");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  // Sooner than the pause of the autosave (1,8 s): it was the button.
  await expect(page.getByText(/^Salvo às \d{2}:\d{2}\.$/)).toBeVisible({ timeout: 1500 });

  // An open draft is not a recorded screening: the approval still asks for the acknowledgement, and with it the plan is approved.
  await page.goto(revisionURL);
  await expect(page.getByText("Triagem não registrada.")).toBeVisible();
  const approve = page.getByRole("button", { name: "Aprovar revisão" });
  await expect(approve).toBeDisabled();
  await page.getByLabel(/Confirmo que não há triagem registrada/).check();
  await approve.click();
  await expect(page.getByRole("heading", { name: "Entregar ao aluno" })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("the Avaliação Física list shows every student and the open draft, and stays inside the organization", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da lista");
  const studentURL = await addStudent(page, "Aluna da lista");
  await page.goto("./profissional/avaliacoes");
  await expect(page.getByRole("heading", { name: "Avaliação Física", exact: true })).toBeVisible();
  const row = page.getByRole("row", { name: /Aluna da lista/ });
  await expect(row).toContainText("Sem triagem registrada");
  await expect(row).toContainText("Nenhuma");
  await noHorizontalOverflow(page);

  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação física de Aluna da lista" })).toBeVisible();
  const draftURL = page.url();
  // The record's summary says where the student is, in the same name.
  await page.goto(studentURL);
  await expect(page.getByRole("list", { name: "Etapas do aluno" })).toContainText("Avaliação física em rascunho");
  await expect(page.getByRole("link", { name: "Próxima ação: continuar a avaliação física" })).toBeVisible();
  await showStudentTab(page, "Avaliação Física");
  await expect(page.getByRole("link", { name: /^Rascunho de / })).toBeVisible();
  await page.goto("./profissional/avaliacoes");
  await page.getByRole("row", { name: /Aluna da lista/ }).getByRole("link", { name: "Continuar" }).click();
  await expect(page).toHaveURL(draftURL);

  // Another organization cannot open any of it by address.
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio da lista");
  for (const url of [draftURL, `${studentURL}/avaliacoes`]) {
    const response = await other.page.goto(url);
    expect(response?.status(), url).toBe(404);
  }
  await other.context.close();
});
