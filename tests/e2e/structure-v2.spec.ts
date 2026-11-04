import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow } from "./helpers";

// Motor S2: the planner edits the free structure (v2) — free labels, any weeks, up to 14 sessions, a target per workout
// (or none), rotation and training days — and the prescription editor works on those labels.
const workout = (page: Page, label: string) => page.getByRole("region", { name: `Treino ${label}` });

test("free structure: build, check limits, save and prescribe on free labels", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da estrutura livre");
  await addStudent(page, "Diana Prado");
  await page.goto("./profissional/planos/novo");
  await page.locator(".picker-row", { has: page.getByRole("heading", { name: "Diana Prado", exact: true }) }).getByRole("link", { name: /Novo plano/ }).click();
  await expect(page.getByRole("heading", { name: "Novo plano de periodização", level: 1 })).toBeVisible();

  await page.getByLabel("Nome do plano").fill("Ciclo livre");
  await page.getByLabel("Data de início").fill("2026-11-04");
  await page.getByRole("radio", { name: /Estrutura livre/ }).check();
  // The standard split's values come along: 3 phases of A, B, C with target 5.
  await expect(page.getByLabel("Rótulo do treino 1")).toHaveValue("A");
  await page.getByLabel("Quantidade de fases").selectOption("1");
  await page.getByLabel("Nome da fase (opcional)").fill("Adaptação");
  await page.getByLabel("Semanas da fase").fill("10");
  await page.getByLabel("Sessões por semana").selectOption("4");
  await page.getByLabel("Rótulo do treino 1").fill("Superior");
  await page.getByLabel("Nome do treino 1").fill("Empurrar");
  await page.getByLabel("Rótulo do treino 2").fill("Inferior");
  await page.getByLabel("Alvo do treino 2").selectOption("");
  await page.getByRole("button", { name: "Remover o treino C" }).click();
  await page.getByLabel("Definir os dias de treino").check();
  // Day 1 is the start date's weekday (a Wednesday).
  await expect(page.getByLabel("Dia da sessão 1").locator("option:checked")).toHaveText("Dia 1 (qua.)");
  await noHorizontalOverflow(page);

  // A label with "|" is refused with the reason and the phase.
  await page.getByLabel("Rótulo do treino 2").fill("Inferior|2");
  await page.getByRole("button", { name: "Calcular planejamento" }).click();
  await expect(page.locator(".error-message")).toHaveText("Fase 1: O rótulo do treino não pode ter |, / ou \\.");
  await page.getByLabel("Rótulo do treino 2").fill("Inferior");
  // Going back to the standard split is refused: this structure does not fit in it.
  await page.getByRole("radio", { name: /Divisão padrão/ }).click();
  await expect(page.locator(".error-message")).toContainText("não cabe na divisão padrão");
  await expect(page.getByRole("radio", { name: /Estrutura livre/ })).toBeChecked();

  await page.getByRole("button", { name: "Calcular planejamento" }).click();
  await expect(page.locator(".big-stat")).toContainText("10");
  await expect(page.locator(".summary-stats")).toContainText("40");
  await expect(page.locator(".schedule-result tbody tr").first()).toContainText("Adaptação");
  await expect(page.locator(".schedule-result tbody tr").first()).toContainText("Superior / Inferior");
  await expect(page.locator(".schedule-result tbody tr").first()).toContainText("Superior 5 · Inferior sem alvo");
  await expect(page.locator(".microcycles > div").first()).toContainText("Superior / Inferior / Superior / Inferior");

  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();
  await expect(page.getByRole("heading", { name: "Ciclo livre", level: 1 })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Primeiro passo: escolha os exercícios do Treino Superior da Fase 01.");
  await expect(workout(page, "Superior").getByRole("heading", { name: "Treino Superior · Empurrar" })).toBeVisible();
  await expect(workout(page, "Superior").getByText("0 de 5", { exact: true })).toBeVisible();
  await expect(workout(page, "Inferior").getByText("Sem alvo", { exact: true })).toBeVisible();
  await expect(page.locator("details.structure-details summary")).toContainText("1 fase · 10 semanas");

  await workout(page, "Inferior").getByLabel("Ou um exercício com nome próprio").fill("Agachamento livre");
  await workout(page, "Inferior").getByRole("button", { name: "Adicionar com nome próprio" }).click();
  await expect(workout(page, "Inferior").getByText("Agachamento livre")).toBeVisible();
  await expect(workout(page, "Inferior").getByText("1 exercício", { exact: true })).toBeVisible();

  // The saved structure opens again in the free editor, with everything kept.
  await page.locator("details.structure-details summary").click();
  await expect(page.getByRole("radio", { name: /Estrutura livre/ })).toBeChecked();
  await expect(page.getByLabel("Rótulo do treino 2")).toHaveValue("Inferior");
  await expect(page.getByLabel("Semanas da fase")).toHaveValue("10");
  // Renaming a workout that already has exercises is refused, as removing it always was.
  await page.getByLabel("Rótulo do treino 2").fill("Pernas");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.locator(".error-message")).toContainText("remove treinos que já têm exercícios");
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
