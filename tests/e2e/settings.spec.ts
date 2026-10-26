import { test, expect } from "@playwright/test";
import { addStudent, createProfessional, joinStudent, localIP, newActor, noHorizontalOverflow, signIn } from "./helpers";

test("the owner corrects the workspace name and their own display name, and the student sees both", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das configurações", "Marina Configuradora");
  await addStudent(page, "Aluna das configurações");
  const studentEmail = await joinStudent(page, browser, baseURL, "Aluna das configurações");

  // The page is real (it has its own forms), and it says who has access and what is not available yet.
  await page.goto("./profissional/configuracoes");
  await expect(page.getByRole("heading", { name: "Configurações", level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Nome do espaço" })).toHaveValue("Estúdio das configurações");
  await expect(page.getByRole("textbox", { name: "Nome de exibição" })).toHaveValue("Marina Configuradora");
  const members = page.getByRole("table", { name: "Pessoas com acesso ao espaço" });
  await expect(members.getByRole("row", { name: /Marina Configuradora.*Você.*Proprietário/ })).toBeVisible();
  await expect(page.getByText("ainda não está disponível", { exact: false })).toBeVisible();
  await expect(page.getByText("muda também como os treinos já entregues dizem quem os entregou", { exact: false })).toBeVisible();
  await noHorizontalOverflow(page);

  // A name that is not plain text is refused with a plain message, and what was typed stays.
  const workspace = page.getByRole("form", { name: "Alterar o nome do espaço" });
  await workspace.getByRole("textbox", { name: "Nome do espaço" }).fill("A");
  await workspace.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator("p.form-error")).toContainText("Use de 2 a 160 caracteres");
  await expect(workspace.getByRole("textbox", { name: "Nome do espaço" })).toHaveValue("A");

  // The workspace is renamed (inner spaces collapse), and the same name again changes nothing.
  await workspace.getByRole("textbox", { name: "Nome do espaço" }).fill("  Estúdio   Renomeado ");
  await workspace.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Nome do espaço salvo.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nome do espaço" })).toHaveValue("Estúdio Renomeado");
  await expect(page.locator(".eyebrow", { hasText: "Estúdio Renomeado" }).first()).toBeVisible();
  await page.getByRole("form", { name: "Alterar o nome do espaço" }).getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Esse já é o nome atual.")).toBeVisible();

  // The display name is renamed, and the access list shows it.
  const own = page.getByRole("form", { name: "Alterar o nome de exibição" });
  await own.getByRole("textbox", { name: "Nome de exibição" }).fill("Marina Renomeada");
  await own.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Nome de exibição salvo.")).toBeVisible();
  await page.reload();
  await expect(members.getByRole("row", { name: /Marina Renomeada.*Você.*Proprietário/ })).toBeVisible();

  // The student sees the new names in their own area.
  const student = await newActor(browser, baseURL);
  await signIn(student.page, studentEmail);
  await student.page.goto("./aluno");
  await expect(student.page.locator(".eyebrow", { hasText: "COM MARINA RENOMEADA" })).toBeVisible();
  await expect(student.page.getByText("Estúdio Renomeado · acompanhamento desde", { exact: false })).toBeVisible();
  // A student has no settings: the professional's page is not theirs.
  await student.page.goto("./profissional/configuracoes");
  await expect(student.page).not.toHaveURL(/configuracoes/);
  await expect(student.page.getByRole("heading", { name: "Configurações", level: 1 })).toHaveCount(0);
  await student.context.close();

  // A visitor reaches nothing.
  const visitor = await newActor(browser, baseURL);
  await visitor.page.goto("./profissional/configuracoes");
  await expect(visitor.page).not.toHaveURL(/configuracoes/);
  await expect(visitor.page.getByRole("heading", { name: "Configurações", level: 1 })).toHaveCount(0);
  await visitor.context.close();
});

test("the settings entry opens the page from the menu", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "On a phone the menu is a sheet; the page itself is covered above.");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do menu");
  await page.getByRole("link", { name: "Configurações" }).first().click();
  await expect(page).toHaveURL(/\/profissional\/configuracoes\/?$/);
  await expect(page.getByRole("heading", { name: "Configurações", level: 1 })).toBeVisible();
});
