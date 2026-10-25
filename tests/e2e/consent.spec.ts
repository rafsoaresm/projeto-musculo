import { execFileSync } from "node:child_process";
import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  acceptProfessionalTerms,
  acceptStudentTerms,
  addStudent,
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
  password,
  signUp,
  uniqueEmail,
} from "./helpers";

/** Local database only, as the global setup does: the test makes an acceptance stale by adding a newer, older-version row. */
function makeAcceptanceStale(email: string, audience: "STUDENT" | "PROFESSIONAL") {
  const sql = `INSERT INTO consent_acceptances (id, user_id, audience, terms_version, terms_sha256, photos_authorized, accepted_at)
    SELECT lower(hex(randomblob(16))), id, '${audience}', '2020-01-01-versao-antiga', '${"a".repeat(64)}', 0, '${new Date().toISOString()}'
    FROM auth_user WHERE email = '${email}'`;
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", sql], {
    stdio: "ignore",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}

/** Invites the student and returns the client signed up with the invitation page open, terms not yet accepted. */
async function invited(page: Page, browser: Browser, baseURL: string | undefined, studentName: string) {
  const studentURL = await addStudent(page, studentName);
  await page.getByRole("button", { name: "Gerar link de convite" }).click();
  const link = await page.getByLabel("Link de convite (uso único)").inputValue();
  const client = await newActor(browser, baseURL);
  const email = uniqueEmail("client");
  await client.page.goto(new URL(link).pathname);
  await client.page.waitForLoadState("networkidle");
  await client.page.getByLabel("Seu nome").fill(studentName);
  await client.page.getByLabel("E-mail", { exact: true }).fill(email);
  await client.page.getByLabel("Senha", { exact: true }).fill(password);
  await client.page.getByRole("button", { name: "Criar meu acesso" }).click();
  await expect(client.page.getByRole("button", { name: "Aceitar convite" })).toBeVisible();
  return { studentURL, client, email };
}

test("a professional accepts the terms once, when creating the space, and cannot create it without", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await signUp(page, "Profissional dos termos", uniqueEmail("pro"));
  await expect(page.getByRole("heading", { name: "Um espaço para seu método." })).toBeVisible();
  await page.getByLabel("Nome do espaço").fill("Estúdio dos termos");

  // The terms are on the page, the draft is said to be a draft, and nothing is ticked beforehand.
  const terms = page.getByRole("region", { name: "Termos de uso do profissional" });
  await expect(terms).toBeVisible();
  await expect(terms.getByText("Texto provisório.")).toBeVisible();
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

test("a stale acceptance sends each person to accept again, and only to the area they really have", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const proEmail = await createProfessional(page, "Estúdio da versão");
  const { client, email: clientEmail } = await invited(page, browser, baseURL, "Aluno da versão");
  await acceptStudentTerms(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);

  // A new version of the text is a newer row of an older version: the next access asks again.
  makeAcceptanceStale(clientEmail, "STUDENT");
  await client.page.goto("./aluno/treino");
  await expect(client.page).toHaveURL(/\/aceite\?area=aluno/);
  await expect(client.page.getByRole("heading", { name: "Leia e aceite os termos." })).toBeVisible();
  await expect(client.page.getByRole("region", { name: "Termos e aviso de privacidade do aluno" })).toBeVisible();
  // Nothing of the area is reachable meanwhile, and the page cannot be used to get in without ticking.
  await client.page.goto("./aluno");
  await expect(client.page).toHaveURL(/\/aceite\?area=aluno/);
  await client.page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(client.page).toHaveURL(/\/aceite\?area=aluno/);
  await acceptStudentTerms(client.page);
  await client.page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);
  await client.page.goto("./aluno/treino");
  await expect(client.page.getByRole("heading", { name: "Treino atual" })).toBeVisible();

  // The professional is asked the same way, and the address of the acceptance page grants no area.
  makeAcceptanceStale(proEmail, "PROFESSIONAL");
  await page.goto("./profissional/alunos");
  await expect(page).toHaveURL(/\/aceite\?area=profissional/);
  await page.goto("./aceite?area=aluno");
  await expect(page).not.toHaveURL(/\/aceite\?area=aluno/);
  await page.goto("./aceite?area=profissional");
  await acceptProfessionalTerms(page);
  await page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(page).toHaveURL(/\/profissional\/?$/);
  await page.goto("./profissional/alunos");
  await expect(page.getByRole("heading", { name: "Alunos" })).toBeVisible();
  await client.context.close();
});
