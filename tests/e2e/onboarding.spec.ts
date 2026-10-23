import { test, expect } from "@playwright/test";
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
} from "./helpers";

test("account, organization and first student persist across logout with tenant isolation", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  // Legacy addresses keep working and still require a session.
  await page.goto("./alunos");
  await expect(
    page.getByRole("heading", { name: "Bom ter você de volta." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Criar uma conta profissional" }).click();
  const email = await createProfessional(page, "Estúdio E2E");
  const privateURL = await addStudent(page, "Aluno de teste privado");
  const response = await page.reload();
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(
    page.getByRole("heading", { name: "Aluno de teste privado" }),
  ).toBeVisible();
  await noHorizontalOverflow(page);

  const other = await newActor(browser, baseURL);
  await other.page.goto("./cadastro");
  await other.page.waitForLoadState("networkidle");
  await other.page.getByLabel("Seu nome").fill("Outra pessoa");
  await other.page
    .getByLabel("E-mail", { exact: true })
    .fill(uniqueEmail("other"));
  await other.page.getByLabel("Senha", { exact: true }).fill(password);
  await other.page.locator("form button").click();
  await other.page.getByLabel("Nome do espaço").fill("Outro estúdio");
  await other.page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(other.page.getByRole("heading", { name: /^Olá, / })).toBeVisible();
  await other.page.goto(privateURL);
  await expect(
    other.page.getByRole("heading", { name: "Página não encontrada." }),
  ).toBeVisible();
  await expect(
    other.page.getByRole("heading", { name: "Aluno de teste privado" }),
  ).toHaveCount(0);
  await other.context.close();

  await page.getByRole("link", { name: "Voltar aos alunos" }).click();
  await signOut(page);
  await expect(
    page.getByRole("heading", { name: "Bom ter você de volta." }),
  ).toBeVisible();
  await page.goto(privateURL);
  await expect(
    page.getByRole("heading", { name: "Bom ter você de volta." }),
  ).toBeVisible();
  await signIn(page, email);
  await page.goto("./profissional/alunos");
  await expect(
    page.getByRole("link", { name: /Aluno de teste privado/ }),
  ).toBeVisible();
});
