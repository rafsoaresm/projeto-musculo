import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  acceptProfessionalTerms,
  acceptStudentTerms,
  addStudent,
  createProfessional,
  localIP,
  noHorizontalOverflow,
  openInvitation,
  signUp,
  uniqueEmail,
} from "./helpers";

/** Invites the student and returns the client signed up with the invitation page open, terms not yet accepted. */
async function invited(page: Page, browser: Browser, baseURL: string | undefined, studentName: string) {
  const studentURL = await addStudent(page, studentName);
  return { studentURL, ...(await openInvitation(page, browser, baseURL, studentName)) };
}

test("a professional accepts the terms once, when creating the space, and cannot create it without", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await signUp(page, "Profissional dos termos", uniqueEmail("pro"));
  await expect(page.getByRole("heading", { name: "Um espaço para seu método." })).toBeVisible();
  await page.getByLabel("Nome do espaço").fill("Estúdio dos termos");

  // The terms are on the page with the version being read, the approved text is not marked as a draft,
  // and nothing is ticked beforehand.
  const terms = page.getByRole("region", { name: "Termos de uso do profissional" });
  await expect(terms).toBeVisible();
  await expect(terms.getByText("Versão 2026-10-25-base")).toBeVisible();
  await expect(terms.getByText("Texto provisório.")).toHaveCount(0);
  await expect(terms.getByText("não aprova nem libera treino")).toBeVisible();
  const accept = page.getByLabel("Li e aceito os termos de uso.");
  await expect(accept).not.toBeChecked();
  await noHorizontalOverflow(page);

  // Without the acknowledgement the space is not created.
  await page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(page.getByRole("heading", { name: "Um espaço para seu método." })).toBeVisible();
  expect(await accept.evaluate((input) => (input as HTMLInputElement).validity.valueMissing)).toBe(true);

  await acceptProfessionalTerms(page);
  await page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible();
});

test("a student accepts once with the invitation, chooses the photos apart, and the professional sees both facts", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do aceite");
  const first = await invited(page, browser, baseURL, "Aluna que autoriza");
  const me = first.client.page;

  // The terms are read on the invitation page, with the photos as an optional choice, unticked.
  await expect(me.getByRole("region", { name: "Termos e aviso de privacidade do aluno" })).toBeVisible();
  await expect(me.getByText("Fotos da sua postura (opcional)")).toBeVisible();
  await expect(me.getByLabel(/Autorizo o meu profissional a registrar fotos/)).not.toBeChecked();
  await noHorizontalOverflow(me);
  // The photos choice alone does not accept anything: the required acknowledgement is missing.
  await me.getByLabel(/Autorizo o meu profissional a registrar fotos/).check();
  await me.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(me.getByRole("button", { name: "Aceitar convite" })).toBeVisible();
  await expect(me).not.toHaveURL(/\/aluno\/?$/);

  await acceptStudentTerms(me, { photos: true });
  await me.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(me).toHaveURL(/\/aluno\/?$/);
  await expect(me.getByRole("heading", { name: "Seu acompanhamento." })).toBeVisible();

  // A second student declines the photos and still gets in: the photos are never a condition.
  const second = await invited(page, browser, baseURL, "Aluno que recusa");
  await acceptStudentTerms(second.client.page);
  await second.client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(second.client.page).toHaveURL(/\/aluno\/?$/);

  // The professional sees that it was accepted, when, and what was chosen about the photos.
  await page.goto(first.studentURL);
  await expect(page.getByText(/Aceite dos termos: feito em \d{2}\/\d{2}\/\d{4}\./)).toBeVisible();
  await expect(page.getByText("Fotos da postura: autorizadas pelo aluno.")).toBeVisible();
  await page.goto(second.studentURL);
  await expect(page.getByText("Fotos da postura: não autorizadas pelo aluno.")).toBeVisible();
  await first.client.context.close();
  await second.client.context.close();
});
