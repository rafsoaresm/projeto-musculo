import { test, expect } from "@playwright/test";
import {
  acceptStudentTerms,
  addStudent,
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
  openInvitation,
} from "./helpers";

const DATE = /\d{2}\/\d{2}\/\d{4}/;

test("a student checks in, can correct it the same day, a report of discomfort stays as said, and the professional reads it", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do check-in");
  const studentURL = await addStudent(page, "Aluna do check-in");
  const { client } = await openInvitation(page, browser, baseURL, "Aluna do check-in");
  const me = client.page;
  await acceptStudentTerms(me);
  await me.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(me).toHaveURL(/\/aluno\/?$/);

  // The entry is in the student's menu and opens the page; it says what it is not.
  await me.goto("./aluno/check-in");
  await expect(me.getByRole("heading", { name: "Check-in", level: 1 })).toBeVisible();
  await expect(me.getByText("não é um canal de urgência", { exact: false })).toBeVisible();
  await expect(me.getByText("Você ainda não fez nenhum check-in.")).toBeVisible();
  await noHorizontalOverflow(me);

  // Nothing is prefilled; an empty check-in is refused with a plain message.
  const form = me.locator("form", { has: me.getByText("Como você está hoje") });
  await expect(form.getByLabel(/Esforço percebido nos últimos dias/)).toHaveValue("");
  await form.getByRole("button", { name: "Salvar check-in" }).click();
  await expect(me.locator("p.form-error")).toContainText("Responda pelo menos uma pergunta");

  // A check-in without discomfort is saved, shown as said, and corrected the same day.
  await form.getByLabel(/Esforço percebido nos últimos dias/).selectOption("7");
  await form.getByLabel(/Quanto você sente que recuperou/).selectOption({ label: "Mais ou menos" });
  await form.getByLabel("Observações").fill("Dormi pouco.");
  await form.getByRole("button", { name: "Salvar check-in" }).click();
  await expect(me.getByText("Check-in salvo. Você pode corrigi-lo ainda hoje.")).toBeVisible();
  await expect(me.getByText("Esforço percebido: 7 de 10 · Recuperação: Mais ou menos")).toBeVisible();
  await form.getByLabel(/Esforço percebido nos últimos dias/).selectOption("8");
  await form.getByRole("button", { name: "Salvar a correção" }).click();
  await expect(me.getByText("Esforço percebido: 8 de 10 · Recuperação: Mais ou menos")).toBeVisible();
  await expect(me.getByText("Esforço percebido: 7 de 10", { exact: false })).toHaveCount(0);
  await expect(me.getByText("Observações: Dormi pouco.")).toBeVisible();

  // It can be deleted the same day, and made again.
  await form.getByRole("button", { name: "Apagar este check-in" }).click();
  await expect(me.getByText("Check-in apagado.")).toBeVisible();
  await expect(me.getByText("Você ainda não fez nenhum check-in.")).toBeVisible();

  // A report of discomfort warns, is kept as said, and closes the check-in.
  await form.getByLabel(/Esforço percebido nos últimos dias/).selectOption("4");
  await form.getByLabel("Estou com dor ou desconforto").check();
  await expect(me.getByText("não poderá ser alterado nem apagado", { exact: false })).toBeVisible();
  await form.getByLabel("Onde e como é? (opcional)").fill("Joelho esquerdo ao agachar.");
  await form.getByRole("button", { name: "Salvar check-in" }).click();
  await expect(me.getByText("Registramos o relato de desconforto", { exact: false })).toBeVisible();
  await expect(form.getByRole("button", { name: /Salvar|Apagar/ })).toHaveCount(0);
  await me.reload();
  await expect(me.getByText("Relato de desconforto", { exact: true })).toBeVisible();
  await expect(me.getByText("Desconforto: Joelho esquerdo ao agachar.")).toBeVisible();
  // Playwright does not count a disabled fieldset itself, only the controls inside it.
  await expect(me.getByLabel(/Esforço percebido nos últimos dias/)).toBeDisabled();
  await expect(me.getByLabel("Observações")).toBeDisabled();
  await expect(me.getByRole("button", { name: /Salvar|Apagar/ })).toHaveCount(0);

  // The professional finds it first in the overview, reads it as said, and registers the reading.
  await page.goto("./profissional");
  await expect(page.locator(".kpi", { hasText: "Check-ins sem leitura" }).locator(".kpi-value")).toHaveText("1");
  await expect(page.getByText("1 com relato de desconforto")).toBeVisible();
  const queue = page.getByRole("region", { name: "Check-ins dos alunos sem leitura" });
  await expect(queue.getByRole("link", { name: new RegExp(`Aluna do check-in · check-in de ${DATE.source} · relato de desconforto`) })).toBeVisible();
  await queue.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/profissional\/alunos\/[^/]+#checkins$/);
  const panel = page.getByRole("region", { name: "Check-ins do aluno" });
  await expect(panel.getByText("Esforço percebido: 4 de 10 · Recuperação: não informada")).toBeVisible();
  await expect(panel.getByText("Desconforto: Joelho esquerdo ao agachar.")).toBeVisible();
  await expect(panel.getByText(/^Lido em/)).toHaveCount(0);
  await noHorizontalOverflow(page);
  await panel.getByLabel("Anotação da leitura (opcional)").fill("Vamos ver isso no próximo treino.");
  await panel.getByRole("button", { name: "Registrar leitura" }).click();
  // The proof is on the screen: the check-in is marked as read and the form gives way to it.
  await expect(panel.getByText(new RegExp(`^Lido em ${DATE.source}`))).toBeVisible();
  await expect(panel.getByRole("button", { name: "Registrar leitura" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Check-ins do aluno" }).getByText(new RegExp(`Lido em ${DATE.source}`))).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar leitura" })).toHaveCount(0);
  await page.goto("./profissional");
  await expect(page.locator(".kpi", { hasText: "Check-ins sem leitura" }).locator(".kpi-value")).toHaveText("0");
  await expect(page.getByRole("region", { name: "Check-ins dos alunos sem leitura" })).toHaveCount(0);

  // The student sees that it was read, and the professional's note is not shown to them.
  await me.goto("./aluno/check-in");
  await expect(me.getByText(new RegExp(`Lido pelo seu profissional em ${DATE.source}`))).toBeVisible();
  await expect(me.getByText("Vamos ver isso no próximo treino.")).toHaveCount(0);

  // Another organization's professional reaches neither the student nor the check-in.
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio do check-in");
  await other.page.goto(studentURL);
  await expect(other.page.getByText("Joelho esquerdo")).toHaveCount(0);
  await expect(other.page.getByRole("heading", { name: "Check-ins do aluno" })).toHaveCount(0);
  await other.page.goto("./profissional");
  await expect(other.page.locator(".kpi", { hasText: "Check-ins sem leitura" }).locator(".kpi-value")).toHaveText("0");
  await other.context.close();
  await client.context.close();
});
