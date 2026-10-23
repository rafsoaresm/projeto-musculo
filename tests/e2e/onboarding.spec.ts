import { test, expect } from "@playwright/test";

test("account, organization and first student persist across logout with tenant isolation", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = `e2e-${crypto.randomUUID()}@example.test`;
  const password = "only-for-local-browser-testing";
  // Local Worker only: isolate concurrent suites' rate-limit buckets. Production
  // must overwrite this header at the edge; limiter behavior is tested in D1.
  const localIP = `10.${crypto.getRandomValues(new Uint8Array(3)).join(".")}`;
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP });
  await page.goto("./alunos");
  await expect(
    page.getByRole("heading", { name: "Bom ter você de volta." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Criar uma conta profissional" })
    .click();
  await page.getByLabel("Seu nome").fill("Profissional E2E");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(
    page.getByRole("heading", { name: "Um espaço para seu método." }),
  ).toBeVisible();
  await page.getByLabel("Nome do espaço").fill("Estúdio E2E");
  await page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(
    page.getByRole("heading", { name: "Seus alunos, mais perto." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Novo aluno" }).click();
  await page.getByLabel("Nome do aluno").fill("Aluno de teste privado");
  await page.getByRole("button", { name: "Cadastrar aluno" }).click();
  await expect(
    page.getByRole("heading", { name: "Aluno de teste privado" }),
  ).toBeVisible();
  const privateURL = page.url();
  const response = await page.reload();
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(
    page.getByRole("heading", { name: "Aluno de teste privado" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const other = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "cf-connecting-ip": localIP },
  });
  const another = await other.newPage();
  await another.goto("./cadastro");
  await another.getByLabel("Seu nome").fill("Outra pessoa");
  await another
    .getByLabel("E-mail", { exact: true })
    .fill(`other-${crypto.randomUUID()}@example.test`);
  await another.getByLabel("Senha", { exact: true }).fill(password);
  await another.getByRole("button", { name: "Criar minha conta" }).click();
  await another.getByLabel("Nome do espaço").fill("Outro estúdio");
  await another.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(
    another.getByRole("heading", { name: "Seus alunos, mais perto." }),
  ).toBeVisible();
  await another.goto(privateURL);
  await expect(
    another.getByRole("heading", { name: "Página não encontrada." }),
  ).toBeVisible();
  await expect(
    another.getByRole("heading", { name: "Aluno de teste privado" }),
  ).toHaveCount(0);
  await other.close();
  await page.getByRole("link", { name: "Voltar aos alunos" }).click();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bom ter você de volta." }),
  ).toBeVisible();
  await page.goto(privateURL);
  await expect(
    page.getByRole("heading", { name: "Bom ter você de volta." }),
  ).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Aluno de teste privado/ }),
  ).toBeVisible();
});
