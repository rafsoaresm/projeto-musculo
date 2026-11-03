import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, expectNoTermsBox, localIP, openInvitation } from "./helpers";

const DIR = "/tmp/claude-0/-home-user-projeto-musculo/437756eb-90b4-5954-a2ec-e4bf8a130c76/scratchpad/produto";
const WIDTHS = [1440, 1280, 1024, 768, 390];
const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - 86_400_000));

async function shots(page: Page, name: string, locator?: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    if (locator) await page.locator(locator).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}/0.87-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("zz screenshots 0.87", async ({ page, browser, baseURL }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das capturas");
  const studentURL = await addStudent(page, "Aluna das capturas");
  const { client } = await openInvitation(page, browser, baseURL, "Aluna das capturas");
  const me = client.page;
  await expectNoTermsBox(me);
  await me.getByRole("button", { name: "Aceitar convite" }).click();
  await page.goto(`${studentURL}?aba=evolucao`);
  const setup = page.getByRole("region", { name: "Perguntas do check-in" });
  await setup.getByLabel("Esforço percebido nos últimos dias (0 a 10)").uncheck();
  for (const text of ["Como foi o sono nas últimas noites?", "Algo diferente na rotina desta semana (viagem, trabalho, alimentação)?"]) {
    await setup.getByRole("button", { name: "Adicionar pergunta" }).click();
    await setup.getByRole("textbox").last().fill(text);
  }
  await setup.getByRole("button", { name: "Salvar perguntas" }).click();
  await expect(setup.getByText("Perguntas salvas", { exact: false })).toBeVisible();

  await me.goto("./aluno/check-in");
  const form = me.getByRole("form", { name: "Check-in" });
  await form.getByLabel("Dia a que o check-in se refere").fill(yesterday);
  await form.getByLabel("Como foi o sono nas últimas noites?").fill("Dormi cinco horas, acordei duas vezes.");
  await form.getByLabel(/Quanto você sente que recuperou/).selectOption({ label: "Cansado(a)" });
  await form.getByRole("button", { name: "Salvar check-in" }).click();
  await expect(me.getByText("Check-in salvo.", { exact: false })).toBeVisible();

  await page.goto(`${studentURL}?aba=evolucao`);
  const panel = page.getByRole("region", { name: "Check-ins do aluno" });
  await panel.getByText("Responder ao aluno").click();
  await panel.getByLabel("Resposta ao aluno").fill("Obrigado por contar. Tente deitar mais cedo esta semana e me diga como foi no próximo check-in.");
  await panel.getByRole("button", { name: "Enviar resposta" }).click();
  await expect(panel.getByText("respondeu em", { exact: false })).toBeVisible();
  await page.reload();
  await page.getByRole("region", { name: "Check-ins do aluno" }).getByText("Responder de novo").click();
  await shots(page, "profissional-evolucao");

  await me.goto("./aluno");
  await shots(me, "aluno-inicio");
  await me.goto("./aluno/check-in");
  await expect(me.getByText("Nova resposta", { exact: true })).toBeVisible();
  await shots(me, "aluno-checkin");
  await client.context.close();
});
