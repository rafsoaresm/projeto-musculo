import { test, expect } from "@playwright/test";
import {
  addStudent,
  createProfessional,
  expectNoTermsBox,
  localIP,
  newActor,
  noHorizontalOverflow,
  openInvitation,
} from "./helpers";

const DATE = /\d{2}\/\d{2}\/\d{4}/;
const brazilDay = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - offsetDays * 86_400_000));
const display = (day: string) => day.split("-").reverse().join("/");

test("the professional chooses the questions, the student answers a previous day, the professional replies and the student sees it as new", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das respostas");
  const studentURL = await addStudent(page, "Aluno das respostas");
  const { client } = await openInvitation(page, browser, baseURL, "Aluno das respostas");
  const me = client.page;
  await expectNoTermsBox(me);
  await me.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(me).toHaveURL(/\/aluno\/?$/);

  // The professional turns the effort off and adds a question of their own (text answers only).
  await page.goto(`${studentURL}?aba=evolucao`);
  const setup = page.getByRole("region", { name: "Perguntas do check-in" });
  await expect(setup.getByText("Hoje o aluno responde as perguntas padrão.", { exact: false })).toBeVisible();
  await expect(setup.getByLabel("Dor ou desconforto (sempre perguntado)")).toBeDisabled();
  await setup.getByLabel("Esforço percebido nos últimos dias (0 a 10)").uncheck();
  await setup.getByRole("button", { name: "Adicionar pergunta" }).click();
  await setup.getByLabel("Pergunta 1", { exact: true }).fill("Como foi o sono?");
  await setup.getByRole("button", { name: "Salvar perguntas" }).click();
  await expect(setup.getByText("Perguntas salvas (versão 1)", { exact: false })).toBeVisible();
  await expect(setup.getByText("Em uso: versão 1.", { exact: false })).toBeVisible();
  await noHorizontalOverflow(page);

  // The student is asked the new questions and registers the check-in of yesterday.
  await me.goto("./aluno/check-in");
  const form = me.getByRole("form", { name: "Check-in" });
  await expect(form.getByLabel(/Esforço percebido nos últimos dias/)).toHaveCount(0);
  await expect(form.getByLabel("Como foi o sono?")).toBeVisible();
  const yesterday = brazilDay(1);
  await form.getByLabel("Dia a que o check-in se refere").fill(yesterday);
  await expect(form.getByText(`Como você estava em ${display(yesterday)}`)).toBeVisible();
  await form.getByLabel("Como foi o sono?").fill("Dormi cinco horas.");
  await form.getByLabel(/Quanto você sente que recuperou/).selectOption({ label: "Cansado(a)" });
  await form.getByRole("button", { name: "Salvar check-in" }).click();
  await expect(me.getByText("Check-in salvo.", { exact: false })).toBeVisible();
  const history = me.getByRole("region", { name: "Os seus últimos check-ins" });
  await expect(history.getByText(display(yesterday), { exact: true })).toBeVisible();
  await expect(history.getByText("Registrado depois, em", { exact: false })).toBeVisible();
  await expect(history.getByText("Recuperação: Cansado(a)", { exact: true })).toBeVisible();
  await expect(history.getByText("Esforço percebido", { exact: false })).toHaveCount(0);
  await expect(history.getByText("Dormi cinco horas.")).toBeVisible();
  await noHorizontalOverflow(me);

  // The professional reads the answer with the questions it was answered with, and replies.
  await page.goto(`${studentURL}?aba=evolucao`);
  const panel = page.getByRole("region", { name: "Check-ins do aluno" });
  await expect(panel.getByText("Dormi cinco horas.")).toBeVisible();
  await expect(panel.getByText("Respondido com as perguntas da versão 1.")).toBeVisible();
  await panel.getByText("Responder ao aluno").click();
  await panel.getByLabel("Resposta ao aluno").fill("Tente deitar mais cedo esta semana.");
  await panel.getByRole("button", { name: "Enviar resposta" }).click();
  await expect(panel.getByText("Tente deitar mais cedo esta semana.")).toBeVisible();
  await expect(panel.getByText(new RegExp(`respondeu em ${DATE.source}`))).toBeVisible();
  // A reply registers the reading: the check-in leaves the unread state.
  await expect(panel.getByText(new RegExp(`^Lido em ${DATE.source}`))).toBeVisible();
  await expect(panel.getByRole("button", { name: "Registrar leitura" })).toHaveCount(0);
  await noHorizontalOverflow(page);

  // A new version of the questions does not change the check-in already answered.
  await page.getByRole("region", { name: "Perguntas do check-in" }).getByLabel("Esforço percebido nos últimos dias (0 a 10)").check();
  await page.getByRole("region", { name: "Perguntas do check-in" }).getByLabel("Pergunta 1", { exact: true }).fill("Como está a alimentação?");
  await page.getByRole("region", { name: "Perguntas do check-in" }).getByRole("button", { name: "Salvar perguntas" }).click();
  await expect(page.getByText("Perguntas salvas (versão 2)", { exact: false })).toBeVisible();
  await page.reload();
  const again = page.getByRole("region", { name: "Check-ins do aluno" });
  await expect(again.getByText("Como foi o sono?")).toBeVisible();
  await expect(again.getByText("Como está a alimentação?")).toHaveCount(0);

  // The student finds the reply marked as new, from the home, with the professional's name and time.
  await me.goto("./aluno");
  await expect(me.getByRole("heading", { name: "Nova resposta do seu profissional" })).toBeVisible();
  await me.getByRole("link", { name: "Ver a resposta" }).click();
  await expect(me).toHaveURL(/\/aluno\/check-in$/);
  const seen = me.getByRole("region", { name: "Os seus últimos check-ins" });
  await expect(seen.getByText("Nova resposta", { exact: true })).toBeVisible();
  await expect(seen.getByText("Tente deitar mais cedo esta semana.")).toBeVisible();
  await expect(seen.getByText(new RegExp(`respondeu em ${DATE.source}`))).toBeVisible();
  await expect(seen.getByText(new RegExp(`Lido pelo seu profissional em ${DATE.source}`))).toBeVisible();
  // The check-in of yesterday is closed; a new one is asked with version 2.
  await me.getByRole("form", { name: "Check-in" }).getByLabel("Dia a que o check-in se refere").fill(yesterday);
  await expect(me.getByText("Este dia já tem check-in e ele não pode mais ser alterado.", { exact: false })).toBeVisible();
  await me.getByRole("form", { name: "Check-in" }).getByLabel("Dia a que o check-in se refere").fill(brazilDay(0));
  await expect(me.getByRole("form", { name: "Check-in" }).getByLabel("Como está a alimentação?")).toBeVisible();
  await expect(me.getByRole("form", { name: "Check-in" }).getByLabel(/Esforço percebido nos últimos dias/)).toBeVisible();
  // Once seen, the marker leaves.
  await expect(async () => {
    await me.reload();
    await expect(me.getByRole("region", { name: "Os seus últimos check-ins" }).getByText("Nova resposta", { exact: true })).toHaveCount(0);
  }).toPass({ timeout: 15_000 });
  await me.goto("./aluno");
  await expect(me.getByRole("heading", { name: "Nova resposta do seu profissional" })).toHaveCount(0);

  // Another organization's professional reaches neither the questions nor the replies.
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio das respostas");
  await other.page.goto(`${studentURL}?aba=evolucao`);
  await expect(other.page.getByText("Tente deitar mais cedo")).toHaveCount(0);
  await expect(other.page.getByRole("heading", { name: "Perguntas do check-in" })).toHaveCount(0);
  await other.context.close();
  await client.context.close();
});
