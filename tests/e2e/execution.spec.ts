import { test, expect, type Browser, type Page } from "@playwright/test";
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

const workout = (page: Page, label: string) =>
  page.getByRole("region", { name: `Treino ${label}` });
const yesterdayStart = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
/** A calendar day in the zone the product uses, `back` days before today, as the date field wants it. */
const brazilDay = (back = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - back * 86_400_000));
const absolute = (page: Page, path: string) => new URL(path, page.url()).href;

/** A delivered plan (one Full Body workout of three exercises in three phases) and a client with access. */
async function deliveredPlanWithClient(page: Page, browser: Browser, baseURL: string | undefined, studentName: string) {
  const studentURL = await addStudent(page, studentName);
  await page.getByRole("link", { name: "Novo plano" }).click();
  await page.getByLabel("Nome do plano").fill("Plano da execução");
  await page.getByLabel("Data de início").fill(yesterdayStart());
  for (const phase of ["Fase 01", "Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar fase" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Divisão de treinos").selectOption("Full Body");
    await page.getByLabel("Alvo de exercícios por treino").selectOption("3");
  }
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("heading", { name: "Plano da execução" })).toBeVisible();
  const fullBody = workout(page, "Full Body");
  for (const name of ["Agachamento da Execução", "Remada da Execução", "Prancha da Execução"]) {
    await fullBody.getByLabel("Ou um exercício com nome próprio").fill(name);
    await fullBody.getByRole("button", { name: "Adicionar com nome próprio" }).click();
    await expect(fullBody.locator(".exercise-list").getByText(name)).toBeVisible();
  }
  await fullBody.getByRole("button", { name: "Editar Agachamento da Execução" }).click();
  await fullBody.getByLabel("Séries").fill("3");
  await fullBody.getByLabel("Repetições").fill("8-12");
  await fullBody.getByRole("button", { name: "Salvar exercício" }).click();
  await expect(fullBody.getByText("3 séries × 8-12 repetições")).toBeVisible();
  for (const phase of ["Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar mesociclo" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Copiar o mesociclo de outra fase").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Copiar mesociclo" }).click();
    await expect(page.getByText("Mesociclo copiado.")).toBeVisible();
  }
  await page.getByRole("button", { name: "Marcar estrutura como pronta" }).click();
  await expect(page.getByRole("heading", { name: "Aprovar esta revisão" })).toBeVisible();
  await page.getByLabel(/Confirmo que não há triagem registrada/).check();
  await page.getByRole("button", { name: "Aprovar revisão" }).click();
  await page.getByRole("button", { name: "Entregar ao aluno" }).click();
  await expect(page.getByRole("heading", { name: "Entregue ao aluno" })).toBeVisible();

  await page.goto(studentURL);
  await page.getByRole("button", { name: "Gerar link de convite" }).click();
  const link = await page.getByLabel("Link de convite (uso único)").inputValue();
  const client = await newActor(browser, baseURL);
  await client.page.goto(new URL(link).pathname);
  await client.page.waitForLoadState("networkidle");
  await client.page.getByLabel("Seu nome").fill(studentName);
  await client.page.getByLabel("E-mail", { exact: true }).fill(uniqueEmail("client"));
  await client.page.getByLabel("Senha", { exact: true }).fill(password);
  await client.page.getByRole("button", { name: "Criar meu acesso" }).click();
  await acceptStudentTerms(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page.getByRole("heading", { name: "Plano da execução" })).toBeVisible();
  return { studentURL, client };
}

const exerciseGroup = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("the student logs a workout, corrects it, reports pain, and the professional reads it without anything about the plan changing", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da execução");
  const { studentURL, client } = await deliveredPlanWithClient(page, browser, baseURL, "Aluno da execução");
  const me = client.page;

  // The delivered training offers one way in per workout.
  await me.goto("./aluno/treino");
  await me.getByRole("link", { name: "Registrar treino Full Body, fase 1" }).click();
  await expect(me.getByRole("heading", { name: "Registrar treino Full Body" })).toBeVisible();
  await expect(me.getByText("Em caso de dor ou desconforto, interrompa o treino e fale com o seu profissional.").first()).toBeVisible();
  await expect(me.getByText("Você ainda não registrou este treino.")).toBeVisible();
  await noHorizontalOverflow(me);
  const registerURL = me.url();

  // Nothing is prefilled: the sets only appear once the exercise is marked as done, and they are empty.
  const squat = exerciseGroup(me, "Agachamento da Execução");
  await expect(squat.getByText("3 séries × 8-12 repetições")).toBeVisible();
  await expect(squat.getByRole("group", { name: "Série 1" })).toHaveCount(0);
  await squat.getByLabel("Fiz este exercício").check();
  await expect(squat.getByRole("group", { name: /Série / })).toHaveCount(3);
  await expect(squat.getByLabel("Repetições").first()).toHaveValue("");
  await expect(squat.getByLabel("Carga (kg)").first()).toHaveValue("");
  await squat.getByRole("group", { name: "Série 1" }).getByLabel("Repetições").fill("10");
  await squat.getByRole("group", { name: "Série 1" }).getByLabel("Carga (kg)").fill("22,5");
  await squat.getByRole("group", { name: "Série 2" }).getByLabel("Repetições").fill("9");
  await squat.getByRole("group", { name: "Série 2" }).getByLabel("Carga (kg)").fill("22,5");
  await squat.getByRole("button", { name: "Remover série 3" }).click();
  await squat.getByLabel(/Repetições que sobraram/).selectOption("2");
  await me.getByLabel(/Esforço percebido da sessão/).selectOption("7");

  // A number that is not a number is refused on the screen and nothing is saved.
  await squat.getByRole("group", { name: "Série 1" }).getByLabel("Carga (kg)").fill("pesado");
  await me.getByRole("button", { name: "Salvar registro" }).click();
  await expect(me.locator("p.form-error")).toContainText("confira a carga");
  await squat.getByRole("group", { name: "Série 1" }).getByLabel("Carga (kg)").fill("22,5");
  await me.getByRole("button", { name: "Salvar registro" }).click();
  await expect(me.getByText("Registro salvo. Você pode corrigir este registro por até 24 horas.")).toBeVisible();

  // It is listed, and can be corrected inside the window.
  await me.goto(registerURL);
  await expect(me.getByText("esforço 7 de 10")).toBeVisible();
  await me.getByRole("link", { name: "Corrigir este registro" }).click();
  await expect(me.getByRole("heading", { name: "Corrigir registro" })).toBeVisible();
  const again = exerciseGroup(me, "Agachamento da Execução");
  await expect(again.getByRole("group", { name: "Série 1" }).getByLabel("Carga (kg)")).toHaveValue("22,5");
  await expect(again.getByRole("group", { name: "Série 2" }).getByLabel("Repetições")).toHaveValue("9");
  await expect(again.getByLabel("Fiz este exercício")).toBeChecked();
  await expect(exerciseGroup(me, "Remada da Execução").getByLabel("Fiz este exercício")).not.toBeChecked();
  await again.getByRole("group", { name: "Série 2" }).getByLabel("Carga (kg)").fill("25");
  await me.getByRole("button", { name: "Salvar registro" }).click();
  await expect(me.getByText("Registro salvo.")).toBeVisible();

  // The professional sees it, with what was prescribed next to what was done.
  await page.goto(studentURL);
  await expect(page.getByRole("heading", { name: /O que o aluno registrou/ })).toBeVisible();
  await expect(page.getByText("sem leitura")).toHaveCount(0);
  await page.getByRole("link", { name: "Ver todos os registros" }).click();
  await expect(page.getByRole("heading", { name: "Execução dos treinos de Aluno da execução" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "1 de 3" })).toBeVisible();
  // What was foreseen next to what was logged, and the load as typed. The week is still going, so it is not a miss.
  const cycle = page.getByRole("group", { name: "Plano da execução, revisão 1" });
  await expect(cycle.getByText("Em uso", { exact: true })).toBeVisible();
  await expect(cycle.getByText("Nenhuma semana encerrada ainda.")).toBeVisible();
  const thisWeek = cycle.getByRole("row").filter({ hasText: "Em andamento" });
  await expect(thisWeek).toHaveCount(1);
  await expect(thisWeek.getByRole("cell").last()).toContainText("1 · Full Body");
  const squatLoad = page.getByRole("group", { name: "Carga: Agachamento da Execução" });
  await expect(squatLoad.getByText(/Uma carga anotada: 25 kg em /)).toBeVisible();
  await squatLoad.getByText("Ver os registros").click();
  await expect(squatLoad.getByRole("cell", { name: "25 kg × 9 rep." })).toBeVisible();
  await expect(page.getByText("Não lido")).toBeVisible();
  await page.getByRole("table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: /^Treino Full Body de / })).toBeVisible();
  await expect(page.getByRole("cell", { name: "3 séries × 8-12 repetições" })).toBeVisible();
  await expect(page.getByText("Série 1: 10 rep. × 22,5 kg")).toBeVisible();
  await expect(page.getByText("Série 2: 9 rep. × 25 kg")).toBeVisible();
  await expect(page.getByText("RIR informado: 2")).toBeVisible();
  await expect(page.getByText("Sem registro: Remada da Execução, Prancha da Execução.")).toBeVisible();
  await expect(page.getByText("O aluno relatou dor")).toHaveCount(0);
  await noHorizontalOverflow(page);
  const detailURL = page.url();

  // Reading it is recorded with who and when, and closes the log for the student.
  await page.getByLabel(/Anotação da leitura/).fill("Cargas coerentes com o planejado.");
  await page.getByRole("button", { name: "Registrar leitura" }).click();
  await expect(page.getByText("Leitura registrada.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Cargas coerentes com o planejado.")).toBeVisible();
  await me.goto(registerURL);
  await expect(me.getByText("Lido pelo profissional", { exact: true })).toBeVisible();
  await expect(me.getByRole("link", { name: "Corrigir este registro" })).toHaveCount(0);
  // The last record of the exercise is shown as a reference and nothing is filled in.
  const lastSquat = exerciseGroup(me, "Agachamento da Execução");
  await expect(lastSquat.getByText(/Seu último registro: 25 kg × 9 rep\. em /)).toBeVisible();
  await expect(lastSquat.getByLabel("Fiz este exercício")).not.toBeChecked();
  await expect(exerciseGroup(me, "Remada da Execução").getByText(/Seu último registro/)).toHaveCount(0);

  // A report of pain is kept: the screen says so before saving and the log cannot be changed after.
  await me.getByLabel("Data em que você treinou").fill(brazilDay(1));
  const row = exerciseGroup(me, "Remada da Execução");
  await row.getByLabel("Fiz este exercício").check();
  await row.getByRole("group", { name: "Série 1" }).getByLabel("Repetições").fill("12");
  await row.getByLabel("Senti dor ou desconforto neste exercício").check();
  await row.getByLabel("Observação sobre este exercício").fill("ombro direito");
  await expect(me.getByText("não poderá ser alterado nem apagado")).toBeVisible();
  await me.getByRole("button", { name: "Salvar registro" }).click();
  await expect(me.getByText(/Registramos o relato de dor ou desconforto/)).toBeVisible();
  await expect(me.getByRole("button", { name: "Salvar registro" })).toHaveCount(0);
  await expect(me.getByRole("button", { name: "Apagar este registro" })).toHaveCount(0);
  await expect(row.getByLabel("Observação sobre este exercício")).toBeDisabled();
  await me.goto(registerURL);
  await expect(me.getByText("Relato de dor registrado", { exact: true })).toBeVisible();
  // The only log that can still be corrected is none: the first was read, the second reports pain.
  await expect(me.getByRole("link", { name: "Corrigir este registro" })).toHaveCount(0);

  // The professional finds it on the overview, before any reading.
  await page.goto("./profissional");
  await expect(page.getByText("Relatos de dor sem leitura")).toBeVisible();
  await expect(page.getByRole("heading", { name: /sem leitura/ })).toBeVisible();
  await page.getByRole("link", { name: /Aluno da execução · treino Full Body/ }).click();
  await expect(page.getByText("O aluno relatou dor ou desconforto neste treino.")).toBeVisible();
  await expect(page.getByText("ombro direito")).toBeVisible();
  await expect(page.getByText("Dor ou desconforto").first()).toBeVisible();
  await page.getByRole("button", { name: "Registrar leitura" }).click();
  await expect(page.getByText("Leitura registrada.")).toBeVisible();
  await page.goto("./profissional");
  await expect(page.getByRole("heading", { name: /sem leitura/ })).toHaveCount(0);

  // Nothing about the delivered plan changed.
  await me.goto("./aluno/treino");
  await expect(me.getByText("REVISÃO 1", { exact: false })).toBeVisible();
  await expect(me.getByRole("region", { name: "Treino Full Body, fase 1" }).getByText("3 séries × 8-12 repetições")).toBeVisible();

  // Somebody else's address is a plain not-found, in both areas, and nobody without a session reads it.
  const [, ids] = registerURL.match(/registrar\/([^?]+)$/)!;
  const [studentId, planId] = ids.split("/");
  const wrong = [
    `./aluno/treino/registrar/${planId}/${planId}/1/Full%20Body`, // not the student of this login
    `./aluno/treino/registrar/${studentId}/${studentId}/1/Full%20Body`, // not a plan of the student
    `./aluno/treino/registrar/${studentId}/${planId}/9/Full%20Body`, // a phase the plan does not have
    `./aluno/treino/registrar/${studentId}/${planId}/1/Treino%20Z`, // a workout the plan does not have
  ];
  for (const url of wrong) {
    const response = await me.goto(url);
    expect(response?.status(), url).toBe(404);
  }
  const outsider = await newActor(browser, baseURL);
  await createProfessional(outsider.page, "Outro estúdio da execução");
  const other = await outsider.page.goto(absolute(page, detailURL));
  expect(other?.status()).toBe(404);
  const otherList = await outsider.page.goto(absolute(page, `${studentURL}/execucao`));
  expect(otherList?.status()).toBe(404);
  await outsider.context.close();
  const anonymous = await newActor(browser, baseURL);
  const noSession = await anonymous.page.goto(absolute(page, registerURL));
  expect(new URL(anonymous.page.url()).pathname).not.toContain("/registrar/");
  expect(noSession?.status()).toBeLessThan(400);
  await anonymous.context.close();

  // Revoking the access closes the log on the very next request.
  await page.goto(studentURL);
  await page.getByRole("button", { name: "Revogar acesso" }).click();
  await page.getByRole("button", { name: "Confirmar revogação" }).click();
  await expect(page.getByText("Acesso revogado.")).toBeVisible();
  await me.goto(registerURL);
  await expect(me.getByRole("heading", { name: "Seu acesso não está ativo." })).toBeVisible();
  await client.context.close();
});

test("a log without pain can be deleted by the student inside the window", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do apagar");
  const { client } = await deliveredPlanWithClient(page, browser, baseURL, "Aluna do apagar");
  const me = client.page;
  await me.goto("./aluno/treino");
  await me.getByRole("link", { name: "Registrar treino Full Body, fase 1" }).click();
  const prancha = exerciseGroup(me, "Prancha da Execução");
  await prancha.getByLabel("Fiz este exercício").check();
  await prancha.getByRole("group", { name: "Série 1" }).getByLabel("Repetições").fill("1");
  await me.getByLabel("Data em que você treinou").fill(brazilDay(2));
  await me.getByRole("button", { name: "Salvar registro" }).click();
  await expect(me.getByText("Registro salvo.")).toBeVisible();
  // After the first save the day is fixed: a new day would be a new log.
  await expect(me.getByLabel("Data em que você treinou")).toBeDisabled();
  await me.getByRole("button", { name: "Apagar este registro" }).click();
  await expect(me.getByRole("heading", { name: "Treino atual" })).toBeVisible();
  await me.getByRole("link", { name: "Registrar treino Full Body, fase 1" }).click();
  await expect(me.getByText("Você ainda não registrou este treino.")).toBeVisible();
  // With nothing logged, the progress page says so and invents no number.
  await me.goto("./aluno/evolucao");
  await expect(me.getByRole("heading", { name: "Você ainda não registrou nenhum treino." })).toBeVisible();
  await expect(me.getByText("Você ainda não registrou exercícios.")).toBeVisible();
  await expect(me.getByText(/\d+\s?kg/)).toHaveCount(0);
  await client.context.close();
});

test("the professional reads the load of an exercise over the days, as the student typed it", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da carga");
  const { studentURL, client } = await deliveredPlanWithClient(page, browser, baseURL, "Aluno da carga");
  const me = client.page;
  const logSquat = async (back: number, reps: string, load: string) => {
    await me.goto("./aluno/treino");
    await me.getByRole("link", { name: "Registrar treino Full Body, fase 1" }).click();
    const squat = exerciseGroup(me, "Agachamento da Execução");
    await me.getByLabel("Data em que você treinou").fill(brazilDay(back));
    await squat.getByLabel("Fiz este exercício").check();
    await squat.getByRole("group", { name: "Série 1" }).getByLabel("Repetições").fill(reps);
    await squat.getByRole("group", { name: "Série 1" }).getByLabel("Carga (kg)").fill(load);
    await me.getByRole("button", { name: "Salvar registro" }).click();
    await expect(me.getByText("Registro salvo.")).toBeVisible();
  };
  await logSquat(1, "10", "20");
  await logSquat(0, "8", "22,5");

  await page.goto(`${studentURL}/execucao`);
  const load = page.getByRole("group", { name: "Carga: Agachamento da Execução" });
  await expect(load.getByText(/Primeira: 20 kg em .* Última: 22,5 kg em /)).toBeVisible();
  // The drawing is a supplement: the keyboard reads the same values that the table lists.
  const chart = load.getByRole("group", { name: /Gráfico: Carga de Agachamento da Execução/ });
  await expect(chart).toBeVisible();
  await chart.focus();
  await expect(chart.getByRole("status")).toContainText("22,5 kg");
  await page.keyboard.press("ArrowLeft");
  await expect(chart.getByRole("status")).toContainText("20 kg");
  await load.getByText("Ver os registros").click();
  await expect(load.getByRole("cell", { name: "20 kg × 10 rep." })).toBeVisible();
  await expect(load.getByRole("cell", { name: "22,5 kg × 8 rep." })).toBeVisible();
  await noHorizontalOverflow(page);

  // The student reads the same facts about themselves, from the menu.
  await me.goto("./aluno");
  await me.getByRole("link", { name: "Evolução" }).locator("visible=true").first().click();
  await expect(me.getByRole("heading", { name: "Evolução", exact: true })).toBeVisible();
  await expect(me.getByRole("heading", { name: "Seus registros por semana" })).toBeVisible();
  await expect(me.getByText("Em andamento", { exact: true })).toBeVisible();
  const mine = me.getByRole("group", { name: "Carga: Agachamento da Execução" });
  await expect(mine.getByText(/Primeira: 20 kg em .* Última: 22,5 kg em /)).toBeVisible();
  const ownChart = mine.getByRole("group", { name: /Gráfico: Carga de Agachamento da Execução/ });
  await ownChart.focus();
  await expect(ownChart.getByRole("status")).toContainText("22,5 kg");
  await expect(me.getByRole("heading", { name: "Seus últimos registros" })).toBeVisible();
  await expect(me.locator(".review-list li")).toHaveCount(2);
  await noHorizontalOverflow(me);
  // Somebody else's student has no progress to read.
  const outsider = await newActor(browser, baseURL);
  await createProfessional(outsider.page, "Outro estúdio da carga");
  const other = await outsider.page.goto(new URL(`${studentURL}/execucao`, page.url()).href);
  expect(other?.status()).toBe(404);
  await outsider.context.close();
  await client.context.close();
});
