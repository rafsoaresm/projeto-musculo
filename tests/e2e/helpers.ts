import { expect, type Browser, type Page } from "@playwright/test";

export const password = "only-for-local-browser-testing";

/**
 * Local Worker only: every actor gets its own rate-limit bucket. Production must
 * overwrite this header at the edge; the limiter itself is tested against D1.
 */
export const localIP = () =>
  `10.${[...crypto.getRandomValues(new Uint8Array(3))].join(".")}`;

export const uniqueEmail = (prefix: string) =>
  `${prefix}-${crypto.randomUUID()}@example.test`;

/** A fresh browser identity (own cookies, own rate-limit bucket). */
export async function newActor(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "cf-connecting-ip": localIP() },
  });
  return { context, page: await context.newPage() };
}

export async function signUp(
  page: Page,
  name: string,
  email: string,
  path = "./cadastro",
) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator("form button").click();
}

export async function signIn(page: Page, email: string, path = "./entrar") {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Wait for the session to exist before the caller navigates on.
  await page.waitForURL((url) => !url.pathname.endsWith("/entrar"));
}

/** Professional account + workspace. Ends on the professional overview. */
export async function createProfessional(
  page: Page,
  workspace: string,
  name = "Profissional E2E",
) {
  const email = uniqueEmail("pro");
  await signUp(page, name, email);
  await expect(
    page.getByRole("heading", { name: "Um espaço para seu método." }),
  ).toBeVisible();
  await page.getByLabel("Nome do espaço").fill(workspace);
  await page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible();
  return email;
}

export async function addStudent(page: Page, name: string) {
  await page.goto("./profissional/alunos/novo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome do aluno").fill(name);
  await page.getByRole("button", { name: "Cadastrar aluno" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return page.url();
}

export async function noHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

/** Desktop has "Sair" in the top bar; on a phone it lives in the menu sheet. */
export async function signOut(page: Page) {
  const button = page.getByRole("button", { name: "Sair", exact: true });
  if (!(await button.first().isVisible()))
    await page.getByRole("button", { name: "Menu" }).click();
  await button.first().click();
}
