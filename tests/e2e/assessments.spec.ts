import { test, expect, type Page } from "@playwright/test";
import {
  addStudent,
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
} from "./helpers";

const todayBR = () => {
  const [year, month, day] = new Date().toISOString().slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
};
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const REVIEW_REQUIRED = "Revisão obrigatória antes da entrega.";
const editorTab = (page: Page, name: string) =>
  page.getByRole("group", { name: "Selecionar mesociclo" }).getByRole("button", { name });
const workout = (page: Page, label: string) =>
  page.getByRole("region", { name: `Treino ${label}` });

/** A small READY plan for the student on the current page. Returns the revision address. */
async function readyPlan(page: Page, studentURL: string, title: string) {
  await page.goto(studentURL);
  await page.getByRole("link", { name: "Novo plano" }).click();
  await page.getByLabel("Nome do plano").fill(title);
  await page.getByLabel("Data de início").fill(yesterday());
  for (const phase of ["Fase 01", "Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar fase" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Divisão de treinos").selectOption("Full Body");
    await page.getByLabel("Alvo de exercícios por treino").selectOption("3");
  }
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const fullBody = workout(page, "Full Body");
  for (const name of ["Agachamento da triagem", "Remada da triagem", "Prancha da triagem"]) {
    await fullBody.getByLabel("Ou um exercício com nome próprio").fill(name);
    await fullBody.getByRole("button", { name: "Adicionar com nome próprio" }).click();
    await expect(fullBody.locator(".exercise-list").getByText(name)).toBeVisible();
  }
  for (const phase of ["Fase 02", "Fase 03"]) {
    await editorTab(page, phase).click();
    await page.getByLabel("Copiar o mesociclo de outra fase").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Copiar mesociclo" }).click();
    await expect(page.getByText("Mesociclo copiado.")).toBeVisible();
  }
  await page.getByRole("button", { name: "Marcar estrutura como pronta" }).click();
  await expect(page.getByRole("heading", { name: "Aprovar esta revisão" })).toBeVisible();
  return page.url();
}

test("screening and indicators are recorded once, reviewed on top, and stay inside the organization", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da triagem");
  const studentURL = await addStudent(page, "Aluna da triagem");
  await expect(page.getByRole("heading", { name: "Avaliações e triagem" })).toBeVisible();
  await expect(page.getByText("Este aluno ainda não tem avaliação.")).toBeVisible();

  await page.getByRole("button", { name: "Iniciar avaliação" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação inicial de Aluna da triagem" })).toBeVisible();
  const draftURL = page.url();
  await noHorizontalOverflow(page);

  // The six items of the master document, and nothing else.
  for (const label of [
    "Dor durante esforço",
    "Tontura ou desmaio",
    "Dor torácica relatada",
    "Lesão em tratamento",
    "Pós-operatório recente",
    "Restrição médica relatada",
  ])
    await expect(page.getByLabel(label, { exact: true })).not.toBeChecked();
  // Nothing marked: recording needs the professional to say the items were asked.
  await expect(page.getByText("Isto não é liberação clínica.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar avaliação" })).toBeDisabled();

  await page.getByLabel("Dor torácica relatada", { exact: true }).check();
  await expect(page.getByText(REVIEW_REQUIRED, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar avaliação" })).toBeEnabled();
  await page.getByLabel("Detalhes da triagem").fill("Relatou aperto no peito ao subir escada");

  // Posture and movement, with the items and the scale of the master document.
  await expect(page.getByText("Registro visual e hipótese de trabalho, não diagnóstico.", { exact: false })).toBeVisible();
  const lateral = page.getByRole("group", { name: "Vista lateral" });
  await lateral.getByLabel("Cabeça anteriorizada").check();
  await lateral.getByLabel("Joelho hiperestendido").check();
  await page.getByRole("group", { name: "Vista anterior" }).getByLabel("Valgo aparente de joelhos").check();
  await page.getByLabel("Notas posturais").fill("Sem fotos nesta avaliação");
  const push = page.getByRole("group", { name: "Empurrar" });
  await expect(push.getByRole("combobox")).toHaveValue("NOT_ASSESSED");
  await expect(push.getByRole("combobox").locator("option")).toHaveText([
    "Não avaliado", "Sem limitação observada", "Limitação leve", "Limitação moderada", "Interrompido por dor/desconforto",
  ]);
  await push.getByRole("combobox").selectOption("STOPPED_BY_PAIN");
  await push.getByLabel("Observação (Empurrar)").fill("Dor no ombro direito");
  await page.getByRole("group", { name: "Agachamento" }).getByRole("combobox").selectOption("MILD");

  // Indicators: a value that does not fit its type is refused and nothing typed is lost.
  await page.getByRole("button", { name: "Adicionar indicador" }).click();
  await page.getByRole("group", { name: "Indicador 1" }).getByLabel("Valor").fill("62");
  await page.getByRole("button", { name: "Adicionar indicador" }).click();
  const second = page.getByRole("group", { name: "Indicador 2" });
  await second.getByLabel("Tipo").selectOption("BLOOD_PRESSURE");
  await second.getByLabel("Valor").fill("alta");
  await page.getByRole("button", { name: "Adicionar indicador" }).click();
  const third = page.getByRole("group", { name: "Indicador 3" });
  await third.getByLabel("Tipo").selectOption("CUSTOM");
  await third.getByLabel("Nome da medida ou do teste").fill("Teste de sentar e levantar");
  await third.getByLabel("Valor").fill("14 repetições");
  await third.getByLabel("Lado").selectOption("BOTH");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Confira os indicadores" })).toBeVisible();
  await expect(second.getByLabel("Valor")).toHaveValue("alta");
  await expect(page.getByLabel("Detalhes da triagem")).toHaveValue("Relatou aperto no peito ao subir escada");

  await second.getByLabel("Valor").fill("120/80");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Rascunho salvo.")).toBeVisible();
  // The draft survives a reload exactly as typed, and the student page points at it.
  await page.reload();
  await expect(page.getByLabel("Dor torácica relatada", { exact: true })).toBeChecked();
  await expect(page.getByRole("group", { name: "Indicador 1" }).getByLabel("Valor")).toHaveValue("62");
  await expect(page.getByRole("group", { name: "Vista lateral" }).getByLabel("Cabeça anteriorizada")).toBeChecked();
  await expect(page.getByRole("group", { name: "Vista lateral" }).getByLabel("Aumento aparente de cifose")).not.toBeChecked();
  await expect(page.getByLabel("Notas posturais")).toHaveValue("Sem fotos nesta avaliação");
  await expect(page.getByRole("group", { name: "Empurrar" }).getByRole("combobox")).toHaveValue("STOPPED_BY_PAIN");
  await expect(page.getByRole("group", { name: "Agachamento" }).getByRole("combobox")).toHaveValue("MILD");
  await expect(page.getByRole("group", { name: "Dobradiça de quadril" }).getByRole("combobox")).toHaveValue("NOT_ASSESSED");
  await expect(page.getByRole("group", { name: "Indicador 3" }).getByLabel("Nome da medida ou do teste")).toHaveValue(
    "Teste de sentar e levantar",
  );
  await page.goto(studentURL);
  await expect(page.getByRole("link", { name: /Rascunho de/ })).toBeVisible();
  await page.getByRole("link", { name: "Continuar o rascunho" }).click();
  await expect(page).toHaveURL(draftURL);

  // Removing an indicator is part of the draft too.
  await page.getByRole("button", { name: "Remover indicador 3" }).click();
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await expect(page.getByRole("heading", { name: `Avaliação de ${todayBR()}`, exact: true })).toBeVisible();

  // Recorded: shown as recorded, with the alert and without any way to edit it.
  await expect(page.getByText("Revisão obrigatória", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Dor torácica relatada" })).toBeVisible();
  await expect(page.getByText("Relatou aperto no peito ao subir escada")).toBeVisible();
  await expect(page.getByRole("cell", { name: "62 bpm" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "120/80 mmHg" })).toBeVisible();
  await expect(page.getByText("Teste de sentar e levantar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Salvar rascunho|Registrar avaliação|Adicionar indicador/ })).toHaveCount(0);
  // Posture and movement are shown as recorded. They did not touch the screening: the alert is
  // only the chest pain, and the stopped test is a recorded result, not a second alert.
  await expect(page.getByRole("heading", { name: "Análise postural" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vista lateral" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Cabeça anteriorizada" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Valgo aparente de joelhos" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Aumento aparente de cifose" })).toHaveCount(0);
  await expect(page.getByText("Sem fotos nesta avaliação")).toBeVisible();
  const movementRows = page.getByRole("table", { name: "Testes de movimento da avaliação" }).getByRole("row");
  await expect(movementRows.filter({ hasText: "Empurrar" })).toContainText("Interrompido por dor/desconforto");
  await expect(movementRows.filter({ hasText: "Empurrar" })).toContainText("Dor no ombro direito");
  await expect(movementRows.filter({ hasText: "Agachamento" })).toContainText("Limitação leve");
  await expect(movementRows.filter({ hasText: "Dobradiça de quadril" })).toHaveCount(0);
  const recordedURL = page.url();
  await noHorizontalOverflow(page);

  // The alert is reviewed with a stated basis. It does not turn into "clear".
  const review = page.getByRole("button", { name: "Registrar revisão" });
  await expect(review).toBeDisabled();
  await page.getByLabel("Base da sua revisão").fill("Atestado de cardiologista apresentado pelo aluno");
  await review.click();
  await expect(page.getByText("Revisão registrada.")).toBeVisible();
  await expect(page.getByText("Atestado de cardiologista apresentado pelo aluno")).toBeVisible();
  await expect(page.getByText("Alerta com revisão registrada")).toBeVisible();
  await expect(page.getByText("Revisão obrigatória", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Dor torácica relatada" })).toBeVisible();

  // The overview lists the student, and a second assessment is a reassessment.
  await page.goto("./profissional/avaliacoes");
  await expect(page.getByRole("heading", { name: "Avaliações", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Aluna da triagem/ })).toContainText("Alerta com revisão registrada");
  await expect(page.getByText("Nenhuma revisão obrigatória pendente")).toBeVisible();
  await page.goto(studentURL);
  await page.getByRole("button", { name: "Iniciar reavaliação" }).click();
  await expect(page.getByRole("heading", { name: "Reavaliação de Aluna da triagem" })).toBeVisible();
  await page.getByLabel("Dor torácica relatada", { exact: true }).uncheck();
  await page.getByLabel(/Perguntei ao aluno sobre os seis itens/).check();
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await expect(page.getByText("Nenhum sinal marcado na triagem. Isto não é liberação clínica.")).toBeVisible();
  await expect(page.getByText("Nenhum sinal marcado", { exact: true })).toBeVisible();

  // Another organization cannot open any of it by address.
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio da triagem");
  for (const url of [recordedURL, draftURL, `${studentURL}/avaliacoes`]) {
    const response = await other.page.goto(url);
    expect(response?.status(), url).toBe(404);
  }
  await other.context.close();
});

test("an alert without a review holds the approval and the delivery until the professional records the review", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do bloqueio");
  const studentURL = await addStudent(page, "Aluno do bloqueio");
  const revisionURL = await readyPlan(page, studentURL, "Plano do bloqueio");

  // No assessment yet: the acknowledgement path, with a way to register one.
  await expect(page.getByText("Triagem não registrada.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Registrar uma avaliação" })).toBeVisible();

  // Record an alert.
  await page.goto(studentURL);
  await page.getByRole("button", { name: "Iniciar avaliação" }).click();
  await page.getByLabel("Tontura ou desmaio", { exact: true }).check();
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await expect(page.getByRole("heading", { name: `Avaliação de ${todayBR()}`, exact: true })).toBeVisible();
  const assessmentURL = page.url();

  // The plan cannot be approved, and says why and where to fix it.
  await page.goto(revisionURL);
  await expect(page.getByText(REVIEW_REQUIRED, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar revisão" })).toBeDisabled();
  await expect(page.getByLabel(/Confirmo que não há triagem registrada/)).toHaveCount(0);
  await page.getByRole("link", { name: "Registrar a revisão" }).click();
  await expect(page).toHaveURL(assessmentURL);

  await page.getByLabel("Base da sua revisão").fill("Liberação médica anexada ao prontuário do aluno");
  await page.getByRole("button", { name: "Registrar revisão" }).click();
  await expect(page.getByText("Revisão registrada.")).toBeVisible();

  // Reviewed: no acknowledgement is asked and the approval records the assessment.
  await page.goto(revisionURL);
  await expect(page.getByText("Alerta da triagem com revisão registrada")).toBeVisible();
  await expect(page.getByLabel(/Confirmo que não há triagem registrada/)).toHaveCount(0);
  await page.getByRole("button", { name: "Aprovar revisão" }).click();
  await expect(page.getByRole("heading", { name: "Entregar ao aluno" })).toBeVisible();

  // An alert recorded after the approval holds the delivery until it is reviewed too.
  await page.goto(studentURL);
  await page.getByRole("button", { name: "Iniciar reavaliação" }).click();
  await page.getByLabel("Dor durante esforço", { exact: true }).check();
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await expect(page.getByRole("heading", { name: `Avaliação de ${todayBR()}`, exact: true })).toBeVisible();
  const secondURL = page.url();
  await page.goto("./profissional");
  await expect(page.getByText("Revisões obrigatórias pendentes")).toBeVisible();
  await page.goto(revisionURL);
  await expect(page.getByText(REVIEW_REQUIRED, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entregar ao aluno" })).toBeDisabled();

  await page.goto(secondURL);
  await page.getByLabel("Base da sua revisão").fill("Aluno orientado a procurar avaliação médica antes de progredir");
  await page.getByRole("button", { name: "Registrar revisão" }).click();
  await expect(page.getByText("Revisão registrada.")).toBeVisible();
  await page.goto(revisionURL);
  await page.getByRole("button", { name: "Entregar ao aluno" }).click();
  await expect(page.getByRole("heading", { name: "Entregue ao aluno" })).toBeVisible();
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const brazilian = (iso: string) => iso.split("-").reverse().join("/");

test("the evolution shows each measure over time and what differs between two assessments, without judging", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da evolução");
  const studentURL = await addStudent(page, "Aluno da evolução");
  const first = daysAgo(60);
  const second = daysAgo(0);

  // The first assessment, dated two months ago.
  await page.getByRole("button", { name: "Iniciar avaliação" }).click();
  await page.getByLabel("Data da avaliação").fill(first);
  await page.getByRole("group", { name: "Vista anterior" }).getByLabel("Valgo aparente de joelhos").check();
  await page.getByRole("button", { name: "Adicionar indicador" }).click();
  await page.getByRole("group", { name: "Indicador 1" }).getByLabel("Valor").fill("70");
  await page.getByRole("button", { name: "Adicionar indicador" }).click();
  const waist = page.getByRole("group", { name: "Indicador 2" });
  await waist.getByLabel("Tipo").selectOption("WAIST");
  await waist.getByLabel("Valor").fill("90");
  await page.getByRole("button", { name: "Adicionar indicador" }).click();
  const custom = page.getByRole("group", { name: "Indicador 3" });
  await custom.getByLabel("Tipo").selectOption("CUSTOM");
  await custom.getByLabel("Nome da medida ou do teste").fill("Sentar e levantar");
  await custom.getByLabel("Valor").fill("12 repetições");
  await page.getByLabel(/Perguntei ao aluno sobre os seis itens/).check();
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await expect(page.getByRole("heading", { name: `Avaliação de ${brazilian(first)}`, exact: true })).toBeVisible();

  // With one assessment there is nothing to compare yet, and no chart (a line needs two points).
  await page.goto(`${studentURL}/evolucao`);
  await expect(page.getByRole("heading", { name: "Evolução de Aluno da evolução" })).toBeVisible();
  await expect(page.getByText("Uma medição: 70 bpm", { exact: false })).toBeVisible();
  await expect(page.getByRole("group", { name: /^Gráfico:/ })).toHaveCount(0);
  await expect(page.getByText("Há uma avaliação só.", { exact: false })).toBeVisible();

  // The reassessment, today.
  await page.goto(studentURL);
  await page.getByRole("button", { name: "Iniciar reavaliação" }).click();
  await page.getByRole("group", { name: "Agachamento" }).getByRole("combobox").selectOption("MILD");
  await page.getByRole("button", { name: "Adicionar indicador" }).click();
  await page.getByRole("group", { name: "Indicador 1" }).getByLabel("Valor").fill("64");
  await page.getByRole("button", { name: "Adicionar indicador" }).click();
  const waist2 = page.getByRole("group", { name: "Indicador 2" });
  await waist2.getByLabel("Tipo").selectOption("WAIST");
  await waist2.getByLabel("Valor").fill("88,5");
  await page.getByRole("button", { name: "Adicionar indicador" }).click();
  const custom2 = page.getByRole("group", { name: "Indicador 3" });
  await custom2.getByLabel("Tipo").selectOption("CUSTOM");
  await custom2.getByLabel("Nome da medida ou do teste").fill("sentar e LEVANTAR");
  await custom2.getByLabel("Valor").fill("14 repetições");
  await page.getByLabel(/Perguntei ao aluno sobre os seis itens/).check();
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await expect(page.getByRole("heading", { name: `Avaliação de ${brazilian(second)}`, exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Voltar às avaliações" }).click();
  await page.getByRole("link", { name: "Ver a evolução ao longo do tempo" }).click();
  await expect(page.getByRole("heading", { name: "Evolução de Aluno da evolução" })).toBeVisible();
  await expect(page.getByText("2 avaliações registradas", { exact: false })).toBeVisible();
  await noHorizontalOverflow(page);

  // The same measure is one series across both assessments, in the order of the master document.
  const heartRate = page.getByRole("group", { name: "Frequência cardíaca de repouso", exact: true });
  await expect(heartRate).toContainText(`Primeira: 70 bpm em ${brazilian(first)}. Última: 64 bpm em ${brazilian(second)}.`);
  const chart = heartRate.getByRole("group", { name: /^Gráfico: Frequência cardíaca de repouso/ });
  await expect(chart).toBeVisible();
  // Focus and arrow keys read the same values as the table.
  await chart.focus();
  await expect(chart.getByRole("status")).toContainText("64 bpm");
  await page.keyboard.press("ArrowLeft");
  await expect(chart.getByRole("status")).toContainText("70 bpm");
  await expect(chart.getByRole("status")).toContainText(brazilian(first));
  await heartRate.getByText("Ver os valores").click();
  await expect(heartRate.getByRole("row", { name: new RegExp(`${brazilian(first)}.*70 bpm`) })).toBeVisible();
  await expect(heartRate.getByRole("row", { name: new RegExp(`${brazilian(second)}.*64 bpm`) })).toBeVisible();
  await expect(page.getByRole("group", { name: "Cintura", exact: true })).toContainText("Última: 88,5 cm");
  await expect(page.getByRole("group", { name: "Cintura", exact: true }).getByRole("group", { name: /^Gráfico:/ })).toBeVisible();
  // Case does not split a measure, and a value that is not a plain number is listed, not drawn.
  const sit = page.getByRole("group", { name: "Sentar e levantar", exact: true });
  await expect(sit).toContainText("Última: 14 repetições");
  await expect(sit.getByRole("group", { name: /^Gráfico:/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Sentar e levantar", exact: true })).toHaveCount(1);

  // What differs, in the words of the document, and nothing that judges.
  const changes = page.locator("section", { hasText: "O que mudou entre avaliações" });
  await expect(changes).toContainText(`De ${brazilian(first)} para ${brazilian(second)}`);
  await expect(changes).toContainText("Postura: Vista anterior: Valgo aparente de joelhos. Não marcado agora.");
  await expect(changes).toContainText("Movimento: Agachamento. De não avaliado para limitação leve.");
  await expect(changes).not.toContainText(/melhor|pior|resolvid|agrav/i);
  await expect(heartRate).not.toContainText(/melhor|pior|resolvid|agrav/i);

  // Another organization cannot open the history by address.
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio da evolução");
  const response = await other.page.goto(`${studentURL}/evolucao`);
  expect(response?.status()).toBe(404);
  await other.context.close();
});
