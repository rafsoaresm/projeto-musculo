import { test, expect } from "@playwright/test";
import {
  addStudent,
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
  password,
  uniqueEmail,
} from "./helpers";

const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
};

test("the student's file is saved, kept after errors, flags minors and stays inside the organization", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da ficha");
  const studentURL = await addStudent(page, "Aluna da ficha");
  await expect(page.getByText("A ficha ainda não foi preenchida")).toBeVisible();

  await page.getByRole("link", { name: "Preencher a ficha" }).click();
  await expect(page.getByRole("heading", { name: "Ficha de Aluna da ficha" })).toBeVisible();
  await expect(page.getByText(/base legal e o texto de\s+consentimento/)).toBeVisible();
  const fileURL = page.url();
  await noHorizontalOverflow(page);

  // A refused value keeps everything that was typed.
  await page.getByLabel("Data de nascimento").fill(yearsAgo(32));
  await page.getByLabel("E-mail").fill("aluna@exemplo"); // the browser accepts it, the server does not
  await page.getByLabel("Objetivo principal").selectOption("Hipertrofia");
  await page.getByLabel("Lesões relatadas").fill("Entorse de tornozelo em 2024");
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Confira o e-mail." })).toBeVisible();
  await expect(page.getByLabel("Lesões relatadas")).toHaveValue("Entorse de tornozelo em 2024");
  await expect(page.getByLabel("Objetivo principal")).toHaveValue("Hipertrofia");
  await expect(page.getByText("Idade: 32 anos")).toBeVisible();

  // Fixed, it saves; nothing else resets, and the file survives a reload.
  await page.getByLabel("E-mail").fill("Aluna@Exemplo.test");
  await page.getByLabel("Gênero").selectOption("Feminino");
  await page.getByLabel("Nível").selectOption("Intermediário");
  await page.getByLabel("Dias por semana").selectOption("4");
  await page.getByLabel("Tempo por sessão (minutos)").fill("60");
  await page.getByLabel("Altura (cm)").fill("168");
  await page.getByLabel("Peso (kg)").fill("64,5");
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Ficha salva.")).toBeVisible();
  await expect(page.getByLabel("Objetivo principal")).toHaveValue("Hipertrofia");
  await page.reload();
  await expect(page.getByLabel("E-mail")).toHaveValue("aluna@exemplo.test");
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("64.5");
  await expect(page.getByLabel("Nível")).toHaveValue("Intermediário");
  await expect(page.getByLabel("Lesões relatadas")).toHaveValue("Entorse de tornozelo em 2024");

  // The student page summarises it and points at what to read before prescribing.
  await page.goto(studentURL);
  await expect(page.getByText(/32 anos · Hipertrofia · Intermediário · 4 dias por semana · 60 min por sessão/)).toBeVisible();
  await expect(page.getByText("Há lesões, dores ou limitações relatadas")).toBeVisible();
  await expect(page.getByText("Entorse de tornozelo")).toHaveCount(0);

  // A minor is flagged, because the tool does not support attending minors yet.
  await page.goto(fileURL);
  await page.getByLabel("Data de nascimento").fill(yearsAgo(15));
  await expect(page.getByText("Menor de idade.", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Ficha salva.")).toBeVisible();
  await page.goto(studentURL);
  await expect(page.getByText("Menor de idade", { exact: true })).toBeVisible();

  // Another organization cannot open the file by address.
  const other = await newActor(browser, baseURL);
  await other.page.goto("./cadastro");
  await other.page.waitForLoadState("networkidle");
  await other.page.getByLabel("Seu nome").fill("Outra pessoa");
  await other.page.getByLabel("E-mail", { exact: true }).fill(uniqueEmail("other"));
  await other.page.getByLabel("Senha", { exact: true }).fill(password);
  await other.page.locator("form button").click();
  await other.page.getByLabel("Nome do espaço").fill("Outro estúdio da ficha");
  await other.page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(other.page.getByRole("heading", { name: /^Olá, / })).toBeVisible();
  await other.page.goto(fileURL);
  await expect(other.page.getByRole("heading", { name: "Página não encontrada." })).toBeVisible();
  await other.context.close();
});
