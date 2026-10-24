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
