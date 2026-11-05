import { test, expect, type Page } from "@playwright/test";
import { addStudent, approveWithoutDelivering, createProfessional, localIP, newActor, noHorizontalOverflow } from "./helpers";

// 0.93 (user, 03/11/2026): "Novo plano" from Planos e treinos asks for the student, and saving the structure goes straight to the prescription.
const workout = (page: Page, label: string) => page.getByRole("region", { name: `Treino ${label}` });
const pickerRow = (page: Page, name: string) => page.locator(".picker-row", { has: page.getByRole("heading", { name, exact: true }) });

test("Planos e treinos → Novo plano → choose the student → structure → prescription, with search and the empty states", async ({
  page,
  browser,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do novo plano");

  // No student yet: the picker points to Alunos, and Planos e treinos offers Novo plano in the header and in the empty state.
  await page.goto("./profissional/prescricao");
  await expect(page.getByRole("heading", { name: "Nenhum plano ainda." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Novo plano" })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Ver alunos" })).toBeVisible();
  await page.locator(".page-heading").getByRole("link", { name: "Novo plano" }).click();
  await expect(page.getByRole("heading", { name: "Novo plano: escolha o aluno", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nenhum aluno no seu atendimento." })).toBeVisible();
  await page.getByRole("link", { name: "Ver alunos" }).click();
  await expect(page.getByRole("link", { name: "Novo aluno" })).toBeVisible();

  await addStudent(page, "Bruna Araújo");
  await addStudent(page, "Carlos Lima");

  // The picker lists the students of this professional, with a search that works by name (accents do not matter).
  await page.goto("./profissional/prescricao");
  await page.getByRole("link", { name: "Novo plano" }).first().click();
  await expect(page.getByRole("heading", { name: "Novo plano: escolha o aluno", level: 1 })).toBeVisible();
  await expect(page.locator(".picker-row")).toHaveCount(2);
  await expect(pickerRow(page, "Bruna Araújo")).toContainText("Nenhum plano em andamento.");
  await page.getByLabel("Buscar aluno pelo nome").fill("araujo");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/planos\/novo\?q=araujo$/);
  await expect(page.locator(".picker-row")).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "1 de 2 alunos" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByLabel("Buscar aluno pelo nome").fill("ninguém");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByRole("heading", { name: "Nenhum aluno com esse nome." })).toBeVisible();
  await page.getByRole("link", { name: "Limpar a busca" }).click();
  await expect(page.locator(".picker-row")).toHaveCount(2);

  // Choosing the student opens the student's own Novo plano form: steps 1, 2, 3 and no JSON export.
  await pickerRow(page, "Bruna Araújo").getByRole("link", { name: /Novo plano/ }).click();
  await expect(page.getByRole("heading", { name: "Novo plano de periodização", level: 1 })).toBeVisible();
  await expect(page.locator(".page-heading .eyebrow")).toHaveText("Bruna Araújo");
  const steps = page.getByRole("list", { name: "Etapas do novo plano" });
  await expect(steps).toContainText("Estrutura do ciclo");
  await expect(steps).toContainText("Configurar cada fase");
  await expect(steps).toContainText("Prescrever exercícios");
  await expect(page.getByRole("heading", { name: "Prescrever exercícios" })).toBeVisible();
  await expect(page.getByText(/JSON|Exportar/)).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.getByLabel("Nome do plano").fill("Ciclo da Bruna");
  await page.getByLabel("Data de início").fill("2026-11-09");
  // Up to 20 exercises per workout.
  await page.getByLabel("Alvo de exercícios por treino").selectOption("20");
  // "Calcular planejamento" is a preview: it stores nothing and stays on the page.
  await page.getByRole("button", { name: "Calcular planejamento" }).click();
  await expect(page.locator(".big-stat")).toContainText("12");
  await expect(page.getByRole("heading", { name: "Novo plano de periodização", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();

  // Straight to the prescription, with an explicit first step using the real names.
  await expect(page.getByRole("heading", { name: "Ciclo da Bruna", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prescrição dos exercícios" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Primeiro passo: escolha os exercícios do Treino A da Fase 01.");
  await expect(workout(page, "A").getByText("0 de 20", { exact: true })).toBeVisible();
  await expect(page.locator("details.structure-details summary")).toContainText("3 fases · 12 semanas");
  await noHorizontalOverflow(page);
  const revisionURL = page.url();

  // Add an exercise from the library to Treino A of Fase 1, even when another phase is open: the link opens Fase 01 and goes there.
  await page.getByRole("group", { name: "Selecionar mesociclo" }).getByRole("button", { name: "Fase 02" }).click();
  await page.getByRole("link", { name: "Adicionar exercício ao Treino A" }).click();
  await expect(page.getByRole("group", { name: "Selecionar mesociclo" }).getByRole("button", { name: "Fase 01" })).toHaveAttribute("aria-pressed", "true");
  const a = workout(page, "A");
  await expect(a.getByLabel("Exercício da biblioteca")).toBeInViewport();
  await a.getByLabel("Exercício da biblioteca").selectOption({ label: "Agachamento goblet" });
  await a.getByRole("button", { name: "Adicionar da biblioteca" }).click();
  await expect(a.locator(".exercise-list").getByText("Agachamento goblet")).toBeVisible();
  await expect(a.getByText("1 de 20", { exact: true })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.reload();
  await expect(workout(page, "A").locator(".exercise-list").getByText("Agachamento goblet")).toBeVisible();

  // The draft is listed with "Continuar prescrição" in Planos e treinos, in the picker and in the student's plans tab.
  await page.goto("./profissional/prescricao");
  const row = page.locator("tbody tr", { hasText: "Ciclo da Bruna" });
  await expect(row).toContainText("Bruna Araújo");
  await expect(row.getByRole("link", { name: /^Continuar prescrição/ })).toBeVisible();
  await page.getByRole("link", { name: "Novo plano" }).first().click();
  await expect(pickerRow(page, "Bruna Araújo")).toContainText("Em andamento: Ciclo da Bruna, revisão 1");
  await expect(pickerRow(page, "Carlos Lima")).toContainText("Nenhum plano em andamento.");
  await pickerRow(page, "Bruna Araújo").getByRole("link", { name: /^Continuar prescrição/ }).click();
  await expect(page.getByRole("heading", { name: "Ciclo da Bruna", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prescrição dos exercícios" })).toBeInViewport();
  await page.goto(revisionURL);

  // The approval path still works: the one strip offers "Aprovar e entregar" and, under "Mais ações", the exception.
  await expect(page.getByRole("button", { name: "Aprovar e entregar", exact: true })).toBeEnabled();
  await approveWithoutDelivering(page);
  await expect(page.getByRole("region", { name: "Aprovada, não entregue" })).toBeVisible();
  await expect(workout(page, "A").getByText("Agachamento goblet")).toBeVisible();

  // Another organization sees none of these students in its picker.
  const other = await newActor(browser, baseURL);
  const otherPage = other.page;
  await createProfessional(otherPage, "Outro estúdio do novo plano");
  await otherPage.goto("./profissional/planos/novo");
  await expect(otherPage.getByRole("heading", { name: "Nenhum aluno no seu atendimento." })).toBeVisible();
  await expect(otherPage.getByText("Bruna Araújo")).toHaveCount(0);
  await otherPage.goto("./profissional/planos/novo?q=Bruna");
  await expect(otherPage.getByText("Bruna Araújo")).toHaveCount(0);
  await other.context.close();
  expect(errors).toEqual([]);
});

test("the student's Novo plano form saves a target of 20 and the prescription counts against it", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do alvo 20");
  const studentURL = await addStudent(page, "Aluno do alvo");
  await page.goto(`${studentURL.split("?")[0].replace(/\/$/, "")}/planos/novo`);
  await page.getByLabel("Nome do plano").fill("Ciclo de vinte");
  await page.getByLabel("Data de início").fill("2026-11-09");
  for (const phase of ["Fase 01", "Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar fase" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Divisão de treinos").selectOption("Full Body");
    await page.getByLabel("Alvo de exercícios por treino").selectOption("20");
  }
  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();
  await expect(page.getByRole("heading", { name: "Ciclo de vinte", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Primeiro passo: escolha os exercícios do Treino Full Body da Fase 01.");
  await expect(workout(page, "Full Body").getByText("0 de 20", { exact: true })).toBeVisible();
  await page.locator("details.structure-details summary").click();
  await expect(page.getByLabel("Alvo de exercícios por treino")).toHaveValue("20");
  await expect(page.locator(".schedule-result tbody tr").first().locator("td").last()).toHaveText("20");
});
