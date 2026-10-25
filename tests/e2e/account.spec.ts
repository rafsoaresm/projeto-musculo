import { test, expect, type Page } from "@playwright/test";
import {
  addStudent,
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
  password,
  signIn,
  signOut,
  uniqueEmail,
  acceptStudentTerms,
} from "./helpers";

const next = "another-long-browser-password";

async function changePassword(page: Page, current: string, fresh: string, again = fresh) {
  await page.getByLabel("Senha atual").fill(current);
  await page.getByLabel("Nova senha", { exact: true }).fill(fresh);
  await page.getByLabel("Repita a nova senha").fill(again);
  await page.getByRole("button", { name: "Alterar senha" }).click();
}

test("a professional changes the password, ends the other devices and the old password stops working", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const email = await createProfessional(page, "Estúdio da conta");
  // Another device, signed in with the same account.
  const device = await newActor(browser, baseURL);
  await signIn(device.page, email);
  await device.page.goto("./profissional");
  await expect(device.page.getByRole("heading", { name: /^Olá, / })).toBeVisible();

  await page.goto("./profissional/conta");
  await expect(page.getByRole("heading", { name: "Minha conta", level: 1 })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await noHorizontalOverflow(page);

  // What is refused on the screen, and by the server, changes nothing.
  await changePassword(page, password, next, "something-else-entirely");
  await expect(page.locator("p.form-error")).toContainText("A confirmação não é igual");
  await changePassword(page, password, "short");
  await expect(page.locator("p.form-error")).toContainText("12 a 128 caracteres");
  await changePassword(page, "not-the-current-password", next);
  await expect(page.locator("p.form-error")).toContainText("Confira a senha atual");

  await changePassword(page, password, next);
  await expect(page.getByText("Senha alterada. Os outros aparelhos foram desconectados.")).toBeVisible();
  await expect(page.getByLabel("Senha atual")).toHaveValue("");

  // The other device is out on its next request; this one keeps working.
  await device.page.goto("./profissional");
  await expect(device.page).toHaveURL(/\/entrar/);
  await page.goto("./profissional");
  await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible();

  // The old password is refused and the new one signs in.
  await signOut(page);
  await page.waitForURL(/\/entrar/);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("Não foi possível entrar")).toBeVisible();
  await page.getByLabel("Senha", { exact: true }).fill(next);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/entrar"));
  await page.goto("./profissional/conta");
  await expect(page.getByRole("heading", { name: "Minha conta", level: 1 })).toBeVisible();
  await device.context.close();
});

test("the other devices can be ended without changing the password, and a visitor reaches nothing", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const email = await createProfessional(page, "Estúdio dos aparelhos");
  const device = await newActor(browser, baseURL);
  await signIn(device.page, email);
  await device.page.goto("./profissional");
  await expect(device.page.getByRole("heading", { name: /^Olá, / })).toBeVisible();

  await page.goto("./profissional/conta");
  await page.getByRole("button", { name: "Desconectar os outros aparelhos" }).click();
  await expect(page.getByText("Os outros aparelhos foram desconectados.")).toBeVisible();
  await device.page.goto("./profissional");
  await expect(device.page).toHaveURL(/\/entrar/);
  await page.goto("./profissional");
  await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible();

  // Without a session the page is the sign-in page, never the account.
  const visitor = await newActor(browser, baseURL);
  await visitor.page.goto("./profissional/conta");
  await expect(visitor.page).not.toHaveURL(/\/conta/);
  await visitor.page.goto("./aluno/conta");
  await expect(visitor.page).not.toHaveURL(/\/conta/);
  await visitor.context.close();
  await device.context.close();
});

test("a student changes the password and sees what is not available yet", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da conta do aluno");
  const studentURL = await addStudent(page, "Aluna da conta");
  await page.getByRole("button", { name: "Gerar link de convite" }).click();
  const link = await page.getByLabel("Link de convite (uso único)").inputValue();
  const client = await newActor(browser, baseURL);
  const clientEmail = uniqueEmail("client");
  await client.page.goto(new URL(link).pathname);
  await client.page.waitForLoadState("networkidle");
  await client.page.getByLabel("Seu nome").fill("Aluna da conta");
  await client.page.getByLabel("E-mail", { exact: true }).fill(clientEmail);
  await client.page.getByLabel("Senha", { exact: true }).fill(password);
  await client.page.getByRole("button", { name: "Criar meu acesso" }).click();
  await acceptStudentTerms(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  // The invitation is accepted when the student area opens: going elsewhere before would cancel it.
  await expect(client.page).toHaveURL(/\/aluno\/?$/);

  await client.page.goto("./aluno/conta");
  await expect(client.page.getByRole("heading", { name: "Minha conta", level: 1 })).toBeVisible();
  await expect(client.page.getByText(clientEmail)).toBeVisible();
  await expect(client.page.getByRole("heading", { name: "Consentimentos e solicitações" })).toBeVisible();
  await expect(client.page.getByText(/Ainda não existe uma tela para pedir a exportação ou a exclusão/)).toBeVisible();
  await expect(client.page.getByText(/Você aceitou os termos em \d{2}\/\d{2}\/\d{4}\. Fotos da sua postura: você não autorizou\./)).toBeVisible();
  await noHorizontalOverflow(client.page);
  await changePassword(client.page, password, next);
  await expect(client.page.getByText("Senha alterada.")).toBeVisible();
  await signOut(client.page);
  await client.page.waitForURL(/\/entrar/);
  await client.page.getByLabel("E-mail", { exact: true }).fill(clientEmail);
  await client.page.getByLabel("Senha", { exact: true }).fill(next);
  await client.page.getByRole("button", { name: "Entrar", exact: true }).click();
  await client.page.waitForURL((url) => !url.pathname.endsWith("/entrar"));
  await expect(client.page).toHaveURL(/\/aluno/);
  // The professional's address for the same page is not the student's.
  await client.page.goto("./profissional/conta");
  await expect(client.page).toHaveURL(/\/aluno$/);
  expect(studentURL).toContain("/profissional/alunos/");
  await client.context.close();
});
