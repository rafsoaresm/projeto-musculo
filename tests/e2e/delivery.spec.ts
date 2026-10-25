import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
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

const editorTab = (page: Page, name: string) =>
  page.getByRole("group", { name: "Selecionar mesociclo" }).getByRole("button", { name });
const workout = (page: Page, label: string) =>
  page.getByRole("region", { name: `Treino ${label}` });
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("a plan reaches the client only after the professional approves and delivers it", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da entrega");
  const studentURL = await addStudent(page, "Cliente da entrega");

  // A small plan: three phases of one Full Body workout with a target of three exercises.
  await page.getByRole("link", { name: "Novo plano" }).click();
  await page.getByLabel("Nome do plano").fill("Plano entregue");
  await page.getByLabel("Data de início").fill(yesterday());
  for (const phase of ["Fase 01", "Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar fase" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Divisão de treinos").selectOption("Full Body");
    await page.getByLabel("Alvo de exercícios por treino").selectOption("3");
  }
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("heading", { name: "Plano entregue" })).toBeVisible();

  const fullBody = workout(page, "Full Body");
  for (const name of ["Agachamento do Cliente", "Remada do Cliente", "Prancha do Cliente"]) {
    await fullBody.getByLabel("Ou um exercício com nome próprio").fill(name);
    await fullBody.getByRole("button", { name: "Adicionar com nome próprio" }).click();
    await expect(fullBody.locator(".exercise-list").getByText(name)).toBeVisible();
  }
  await fullBody.getByRole("button", { name: "Editar Agachamento do Cliente" }).click();
  await fullBody.getByLabel("Séries").fill("3");
  await fullBody.getByLabel("Repetições").fill("8-12");
  await fullBody.getByRole("button", { name: "Salvar exercício" }).click();
  await expect(fullBody.getByText("3 séries × 8-12 repetições")).toBeVisible();
  for (const phase of ["Fase 02", "Fase 03"]) {
    await editorTab(page, phase).click();
    await page.getByLabel("Copiar o mesociclo de outra fase").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Copiar mesociclo" }).click();
    await expect(page.getByText("Mesociclo copiado.")).toBeVisible();
  }
  await page.getByRole("button", { name: "Marcar estrutura como pronta" }).click();
  await expect(page.getByRole("heading", { name: "Aprovar esta revisão" })).toBeVisible();
  const revisionURL = page.url();

  // The client gets access, and sees nothing yet.
  await page.goto(studentURL);
  await page.getByRole("button", { name: "Gerar link de convite" }).click();
  const link = await page.getByLabel("Link de convite (uso único)").inputValue();
  const client = await newActor(browser, baseURL);
  await client.page.goto(new URL(link).pathname);
  await client.page.waitForLoadState("networkidle");
  await client.page.getByLabel("Seu nome").fill("Cliente da entrega");
  await client.page.getByLabel("E-mail", { exact: true }).fill(uniqueEmail("client"));
  await client.page.getByLabel("Senha", { exact: true }).fill(password);
  await client.page.getByRole("button", { name: "Criar meu acesso" }).click();
  await acceptStudentTerms(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page.getByText("Nenhum treino liberado ainda.")).toBeVisible();

  // Approval is a deliberate act: the screening warning has to be acknowledged.
  await page.goto(revisionURL);
  await expect(page.getByText("Triagem não registrada.")).toBeVisible();
  const approve = page.getByRole("button", { name: "Aprovar revisão" });
  await expect(approve).toBeDisabled();
  await page.getByLabel(/Confirmo que não há triagem registrada/).check();
  await approve.click();
  await expect(page.getByRole("heading", { name: "Entregar ao aluno" })).toBeVisible();
  await expect(page.getByText("O aluno ainda não vê este plano.")).toBeVisible();
  // Approved is not delivered: the client still sees nothing.
  await client.page.goto("./aluno/treino");
  await expect(client.page.getByText("Nenhum treino liberado ainda.")).toBeVisible();

  await page.getByRole("button", { name: "Entregar ao aluno" }).click();
  await expect(page.getByRole("heading", { name: "Entregue ao aluno" })).toBeVisible();
  await expect(page.getByText("Revisão entregue ao aluno. Ela não muda mais.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Editar|Remover|Duplicar|Adicionar/ })).toHaveCount(0);

  // The professional downloads the delivered revision as a PDF, and it is only offered now.
  const proDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Baixar PDF desta revisão" }).click();
  const pro = await proDownload;
  expect(pro.suggestedFilename()).toBe("plano-Plano-entregue-rev1.pdf");
  const proFile = await readFile((await pro.path())!);
  expect(proFile.subarray(0, 5).toString()).toBe("%PDF-");
  expect(proFile.length).toBeGreaterThan(1500);
  await expect(page.getByRole("heading", { name: "Entregue ao aluno" })).toBeVisible();

  // Now the client sees exactly what was delivered.
  await client.page.goto("./aluno");
  await expect(client.page.getByRole("heading", { name: "Plano entregue" })).toBeVisible();
  await client.page.getByRole("link", { name: /Abrir o treino/ }).click();
  await expect(client.page.getByRole("heading", { name: "Treino atual" })).toBeVisible();
  await expect(client.page.getByRole("heading", { name: "Plano entregue" })).toBeVisible();
  await expect(client.page.getByText("Fase atual")).toBeVisible();
  const mine = client.page.getByRole("region", { name: "Treino Full Body, fase 1" });
  await expect(mine.getByText("Agachamento do Cliente")).toBeVisible();
  await expect(mine.getByText("3 séries × 8-12 repetições")).toBeVisible();
  await expect(mine.getByText("Remada do Cliente")).toBeVisible();
  await noHorizontalOverflow(client.page);
  // The client downloads the same version; somebody else's student or plan is a plain 404.
  const clientDownload = client.page.waitForEvent("download");
  await client.page.getByRole("link", { name: "Baixar PDF do treino" }).click();
  const mineFile = await clientDownload;
  expect(mineFile.suggestedFilename()).toBe("plano-Plano-entregue-rev1.pdf");
  const clientBytes = await readFile((await mineFile.path())!);
  expect(clientBytes.subarray(0, 5).toString()).toBe("%PDF-");
  const pdfPath = new URL(await client.page.getByRole("link", { name: "Baixar PDF do treino" }).evaluate((a) => (a as HTMLAnchorElement).href)).pathname;
  const [, studentId, planId] = pdfPath.match(/\/aluno\/treino\/pdf\/([^/]+)\/([^/]+)$/)!;
  const mountPrefix = pdfPath.slice(0, pdfPath.indexOf("/aluno/treino/pdf/"));
  for (const url of [
    `${mountPrefix}/aluno/treino/pdf/${planId}/${planId}`, // not the student of this login
    `${mountPrefix}/aluno/treino/pdf/${studentId}/${studentId}`, // not a plan of the student
  ]) {
    const refused = await client.page.request.get(new URL(url, client.page.url()).href);
    expect(refused.status(), url).toBe(404);
  }
  // A stranger without a session is sent to the sign-in page, never given a file.
  const anonymous = await newActor(browser, baseURL);
  const noSession = await anonymous.page.request.get(new URL(pdfPath, client.page.url()).href);
  expect(noSession.headers()["content-type"] ?? "").not.toContain("application/pdf");
  await anonymous.context.close();
  // No professional controls, and the client cannot reach the professional's address for it.
  await expect(client.page.getByRole("button", { name: /Editar|Remover|Adicionar|Aprovar/ })).toHaveCount(0);
  await client.page.goto(revisionURL);
  await expect(client.page).toHaveURL(/\/aluno$/);

  // A new draft revision never reaches the client, and the delivered one does not change.
  await page.getByRole("button", { name: "Criar nova revisão" }).click();
  await expect(page.getByText("Revisão 2", { exact: false }).first()).toBeVisible();
  const draft = workout(page, "Full Body");
  await draft.getByLabel("Ou um exercício com nome próprio").fill("Só na revisão dois");
  await draft.getByRole("button", { name: "Adicionar com nome próprio" }).click();
  await expect(draft.locator(".exercise-list").getByText("Só na revisão dois")).toBeVisible();
  await client.page.goto("./aluno/treino");
  await expect(client.page.getByText("Só na revisão dois")).toHaveCount(0);
  await expect(client.page.getByText("REVISÃO 1", { exact: false })).toBeVisible();

  // Revoking the access closes the training on the very next request.
  await page.goto(studentURL);
  await page.getByRole("button", { name: "Revogar acesso" }).click();
  await page.getByRole("button", { name: "Confirmar revogação" }).click();
  await expect(page.getByText("Acesso revogado.")).toBeVisible();
  await client.page.goto("./aluno/treino");
  await expect(client.page.getByRole("heading", { name: "Seu acesso não está ativo." })).toBeVisible();
  await client.context.close();
});
