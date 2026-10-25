import { test, expect } from "@playwright/test";
import {
  addStudent,
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
  password,
  uniqueEmail,
  acceptStudentTerms,
} from "./helpers";

test("a client enters only by invitation and reaches nothing but the own area", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio convites", "Profissional Convites");
  const studentURL = await addStudent(page, "Cliente de convite");
  await expect(page.getByText("Sem acesso ao portal")).toBeVisible();

  // The professional creates a one-use link; the raw token is shown once.
  await page.getByRole("button", { name: "Gerar link de convite" }).click();
  const link = await page.getByLabel("Link de convite (uso único)").inputValue();
  expect(link).toMatch(/\/convite\/[A-Za-z0-9_-]{43}$/);
  await page.goto("./profissional/alunos");
  await expect(page.getByText(/Convite pendente/)).toBeVisible();

  // The client opens the link, creates a login and accepts.
  const client = await newActor(browser, baseURL);
  await client.page.goto(new URL(link).pathname);
  await client.page.waitForLoadState("networkidle");
  await expect(
    client.page.getByRole("heading", { name: /convidou você/ }),
  ).toBeVisible();
  await client.page.getByLabel("Seu nome").fill("Cliente de convite");
  await client.page
    .getByLabel("E-mail", { exact: true })
    .fill(uniqueEmail("client"));
  await client.page.getByLabel("Senha", { exact: true }).fill(password);
  await client.page.getByRole("button", { name: "Criar meu acesso" }).click();
  await acceptStudentTerms(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(
    client.page.getByRole("heading", { name: "Seu acompanhamento." }),
  ).toBeVisible();
  await expect(
    client.page.getByText("Nenhum treino liberado ainda."),
  ).toBeVisible();
  await noHorizontalOverflow(client.page);

  // A client is not a professional and not a manager: each door leads back home.
  for (const path of ["./profissional", "./profissional/alunos", "./gestor"]) {
    await client.page.goto(path);
    await expect(client.page).toHaveURL(/\/aluno$/);
    await expect(
      client.page.getByRole("heading", { name: "Seu acompanhamento." }),
    ).toBeVisible();
  }
  await client.page.goto(studentURL);
  await expect(client.page).toHaveURL(/\/aluno$/);
  await client.page.goto("./aluno/treino");
  await expect(
    client.page.getByRole("heading", { name: "Treino atual" }),
  ).toBeVisible();
  await expect(client.page.getByText("Nenhum treino liberado ainda.")).toBeVisible();

  // The same link never works twice, for anyone.
  const stranger = await newActor(browser, baseURL);
  await stranger.page.goto(new URL(link).pathname);
  await expect(
    stranger.page.getByRole("heading", { name: "Convite indisponível." }),
  ).toBeVisible();
  await stranger.context.close();

  // The professional sees the active access and can revoke it.
  await page.goto(studentURL);
  await expect(page.getByText("Acesso ativo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revogar acesso" }).click();
  await page.getByRole("button", { name: "Confirmar revogação" }).click();
  await expect(page.getByText("Acesso revogado.")).toBeVisible();

  // The next request of the client is refused: the check runs on every request.
  await client.page.goto("./aluno");
  await expect(
    client.page.getByRole("heading", { name: "Seu acesso não está ativo." }),
  ).toBeVisible();
  await client.context.close();
});

test("an unauthenticated visitor and a plain professional are kept out of other areas", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  for (const path of ["./gestor", "./profissional", "./aluno", "./gestor/organizacoes"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Bom ter você de volta." }),
    ).toBeVisible();
  }
  await createProfessional(page, "Estúdio sem acesso de gestor");
  await page.goto("./gestor");
  await expect(page).toHaveURL(/\/profissional$/);
  await expect(
    page.getByRole("heading", { name: "Quem contratou a ferramenta." }),
  ).toHaveCount(0);
  await page.goto("./aluno");
  await expect(page).toHaveURL(/\/profissional$/);
  await page.goto("./gestor/ativar");
  // Without a configured/valid token the e-mail alone grants nothing.
  await expect(
    page.getByRole("heading", { name: "Ative a gestão da plataforma." }),
  ).toBeVisible();
});
