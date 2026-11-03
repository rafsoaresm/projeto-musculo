import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  expectNoTermsBox, addStudent,
  createProfessional,
  localIP,
  noHorizontalOverflow,
  openInvitation,
  signUp,
  uniqueEmail, showStudentTab
} from "./helpers";

/** Invites the student and returns the client signed up with the invitation page open, the invitation not yet accepted. */
async function invited(page: Page, browser: Browser, baseURL: string | undefined, studentName: string) {
  const studentURL = await addStudent(page, studentName);
  return { studentURL, ...(await openInvitation(page, browser, baseURL, studentName)) };
}

test("a professional creates the space with nothing to tick; the terms in force can still be read there", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await signUp(page, "Profissional dos termos", uniqueEmail("pro"));
  await expect(page.getByRole("heading", { name: "Um espaço para seu método." })).toBeVisible();
  await page.getByLabel("Nome do espaço").fill("Estúdio dos termos");

  // The terms are folded on the page, with the version, and open to be read; there is no box of acceptance.
  await page.getByText(/Ler os termos \(versão 2026-10-25-base\)/).click();
  const terms = page.getByRole("region", { name: "Termos de uso do profissional" });
  await expect(terms).toBeVisible();
  await expect(terms.getByText("Texto provisório.")).toHaveCount(0);
  await expect(terms.getByText("não aprova nem libera treino")).toBeVisible();
  await expectNoTermsBox(page);
  await noHorizontalOverflow(page);

  await page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(page.getByRole("heading", { name: "Visão geral", level: 1 })).toBeVisible();
});

test("a student accepts the invitation with nothing to tick, and the professional sees no acceptance or photo choice to depend on", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do aceite");
  const first = await invited(page, browser, baseURL, "Aluna do convite");
  const me = first.client.page;

  // The terms can be read on the invitation page; no box of age, of acceptance or of photos.
  await me.getByText(/Ler os termos \(versão /).click();
  await expect(me.getByRole("region", { name: "Termos e aviso de privacidade do aluno" })).toBeVisible();
  await expectNoTermsBox(me);
  await noHorizontalOverflow(me);
  await me.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(me).toHaveURL(/\/aluno\/?$/);
  await expect(me.getByRole("heading", { name: "Seu acompanhamento." })).toBeVisible();

  // In "Minha conta" the student can read the terms; there is no photos choice any more.
  await me.goto("./aluno/conta");
  await expect(me.getByRole("link", { name: "Ler os termos" })).toBeVisible();
  await expect(me.getByText(/Autorizo|Fotos da sua postura/)).toHaveCount(0);

  // The professional sees no line about an acceptance or about photos: nothing was recorded and nothing depends on it.
  await page.goto(first.studentURL);
  await showStudentTab(page, "Acesso e dados");
  await expect(page.getByText(/Aceite dos termos/)).toHaveCount(0);
  await expect(page.getByText(/Fotos da postura: /)).toHaveCount(0);
  await first.client.context.close();
});
