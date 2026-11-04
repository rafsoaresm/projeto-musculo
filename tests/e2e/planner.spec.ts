import { test, expect } from "@playwright/test";
import {
  createProfessional,
  localIP,
  noHorizontalOverflow,
} from "./helpers";

test("entry page, navigation and responsive layout render without application errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Um método. Todo o percurso." }),
  ).toBeVisible();
  // The three areas are always presented, each with its own entry.
  for (const area of [
    "Gestor da ferramenta",
    "Profissional de educação física",
    "Cliente (aluno)",
  ])
    await expect(page.getByRole("heading", { name: area })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.goto("./projeto");
  await expect(
    page.getByRole("heading", { name: "O produto, por inteiro." }),
  ).toBeVisible();

  await createProfessional(page, "Estúdio navegação");
  // On a phone the menu is in the drawer of the top bar (handoff V4, 5.1).
  const menuButton = page.getByRole("button", { name: "Menu" });
  if (await menuButton.isVisible()) await menuButton.click();
  await expect(
    page.getByRole("link", { name: "Visão geral", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  if (await menuButton.isVisible()) await page.keyboard.press("Escape");
  await noHorizontalOverflow(page);
  await page.goto("./profissional/periodizacao");
  await expect(page.getByRole("heading", { name: "Simulador de ciclos" })).toBeVisible();
  // A module that is in the structure but not built says so, honestly.
  await page.goto("./profissional/fontes");
  await expect(page.getByRole("heading", { name: "Fontes técnicas" })).toBeVisible();
  await expect(page.getByText("Ainda não disponível")).toBeVisible();
  await page.goto("./profissional/nao-existe");
  await expect(
    page.getByRole("heading", { name: "Página não encontrada." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("calculates independent phases, offers no JSON export and invalidates stale results", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio planejador");
  await page.goto("./profissional/periodizacao");
  await page.waitForLoadState("networkidle");
  // 0.93: nothing here is saved, and the way to keep a plan is "Novo plano" (choose the student), not a file.
  await expect(page.getByText(/Exporte|JSON/)).toHaveCount(0);
  await expect(page.locator(".notice").getByRole("link", { name: "Novo plano" })).toBeVisible();
  await page.getByLabel("Data de início").fill("2026-10-26");
  await page.getByLabel("Microciclos (semanas)").selectOption("3");
  await page.getByLabel("Sessões por semana").selectOption("2");
  // The target goes up to 20 exercises per workout (user, 03/11/2026).
  const target = page.getByLabel("Alvo de exercícios por treino");
  await expect(target.locator("option")).toHaveCount(18);
  await expect(target.locator("option").last()).toHaveText("20 exercícios");
  await target.selectOption("20");
  await page.getByRole("button", { name: "Fase 02", exact: true }).click();
  await expect(page.getByLabel("Microciclos (semanas)")).toHaveValue("4");
  await page.getByRole("button", { name: "Calcular planejamento" }).click();
  await expect(page.locator(".big-stat")).toContainText("11");
  await expect(page.locator(".summary-stats")).toContainText("30");
  await page.getByRole("button", { name: "Fase 01", exact: true }).click();
  await expect(page.locator(".microcycles")).toContainText("C / A");
  await expect(page.locator(".schedule-result tbody tr").first().locator("td").last()).toHaveText("20");
  await expect(page.getByRole("button", { name: /Exportar/ })).toHaveCount(0);
  await expect(page.getByText(/JSON/)).toHaveCount(0);
  await page.getByLabel("Sessões por semana").selectOption("3");
  await expect(
    page.getByRole("heading", { name: "Seu ciclo começa aqui." }),
  ).toBeVisible();
  await page.locator(".notice").getByRole("link", { name: "Novo plano" }).click();
  await expect(page.getByRole("heading", { name: "Novo plano: escolha o aluno", level: 1 })).toBeVisible();
});

test("requires a date and offers all twelve independently configurable phases", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio fases");
  await page.goto("./profissional/periodizacao");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Calcular planejamento" }).click();
  expect(
    await page
      .getByLabel("Data de início")
      .evaluate((node: HTMLInputElement) => node.validity.valueMissing),
  ).toBe(true);
  await page.getByLabel("Quantidade de fases").selectOption("12");
  await page.getByRole("button", { name: "Fase 12", exact: true }).click();
  await page.getByLabel("Divisão de treinos").selectOption("Full Body");
  await page.getByRole("button", { name: "Fase 01", exact: true }).click();
  await expect(page.getByLabel("Divisão de treinos")).toHaveValue("ABC");
  await noHorizontalOverflow(page);
});
