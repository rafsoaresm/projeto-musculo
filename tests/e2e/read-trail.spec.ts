import { test, expect } from "@playwright/test";
import {
  addStudent,
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
  openInvitation,
  password,
  showStudentTab,
  signIn,
  signOut,
} from "./helpers";

const WHEN = /\d{2}\/\d{2}\/\d{4}/;

test("opening the student's record leaves a line the owner and the student see; a wrong password shows in Minha conta", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const address = await createProfessional(page, "Estúdio das leituras", "Profissional Leituras");
  const studentURL = await addStudent(page, "Aluna das leituras");

  // The owner opened the record: the line is there, with the kind, the name and when; never the content.
  await page.goto(studentURL);
  await showStudentTab(page, "Acesso e dados");
  const trail = page.getByRole("region", { name: "Acessos aos dados do aluno" });
  const lines = trail.getByRole("list", { name: "Acessos aos dados do aluno" }).getByRole("listitem");
  await expect(lines.filter({ hasText: "Ficha do aluno" })).toHaveCount(1);
  await expect(lines.first()).toContainText("Profissional Leituras");
  await expect(lines.first()).toContainText(WHEN);
  // Reopening within the interval adds nothing.
  await page.reload();
  await showStudentTab(page, "Acesso e dados");
  await expect(lines).toHaveCount(1);
  await noHorizontalOverflow(page);

  // The student sees who accessed their data, in Minha conta.
  const { client } = await openInvitation(page, browser, baseURL, "Aluna das leituras");
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);
  await client.page.goto("./aluno/conta");
  const own = client.page.getByRole("region", { name: "Quem acessou os meus dados" });
  const ownLines = own.getByRole("list", { name: "Quem acessou os meus dados" }).getByRole("listitem");
  await expect(ownLines.filter({ hasText: "Ficha do aluno" }).first()).toContainText("Profissional Leituras");
  await expect(ownLines.first()).toContainText("Estúdio das leituras");
  await noHorizontalOverflow(client.page);
  await client.context.close();

  // A wrong password on this address shows in this person's Minha conta, next to the sign-ins.
  await signOut(page);
  await page.goto("./entrar");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail", { exact: true }).fill(address);
  await page.getByLabel("Senha", { exact: true }).fill(`${password}-errada`);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".form-error[role=alert]")).toBeVisible();
  await signIn(page, address);
  await page.goto("./profissional/conta");
  const failures = page.getByRole("list", { name: "Tentativas de entrada que falharam" }).getByRole("listitem");
  await expect(failures).toHaveCount(1);
  await expect(failures.first()).toContainText("E-mail ou senha errados");
  await expect(failures.first()).toContainText(WHEN);
  await noHorizontalOverflow(page);
});

test("a professional of another organization who tries to open the student gets a 404 and leaves no line", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio de outra pessoa");
  const studentURL = await addStudent(page, "Aluno de outro estúdio");
  const outsider = await newActor(browser, baseURL);
  await createProfessional(outsider.page, "Estúdio de fora");
  const response = await outsider.page.goto(new URL(studentURL, page.url()).pathname);
  expect(response?.status()).toBe(404);
  await outsider.context.close();

  await page.goto(studentURL);
  await showStudentTab(page, "Acesso e dados");
  const lines = page.getByRole("list", { name: "Acessos aos dados do aluno" }).getByRole("listitem");
  // Only the owner's own opening: the refused one left nothing.
  await expect(lines).toHaveCount(1);
});
