import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
  await expect(
    page.getByRole("link", { name: "Visão geral", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await noHorizontalOverflow(page);
  await page.goto("./profissional/periodizacao");
  await expect(page.getByRole("heading", { name: "Periodização" })).toBeVisible();
  // A module that is in the structure but not built says so, honestly.
  await page.goto("./profissional/meu-site");
  await expect(page.getByRole("heading", { name: "Meu Site" })).toBeVisible();
  await expect(page.getByText("Ainda não disponível")).toBeVisible();
  await page.goto("./profissional/nao-existe");
  await expect(
    page.getByRole("heading", { name: "Página não encontrada." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("calculates independent phases, exports the actual draft and invalidates stale results", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio planejador");
  await page.goto("./profissional/periodizacao");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Data de início").fill("2026-10-26");
  await page.getByLabel("Microciclos (semanas)").selectOption("3");
  await page.getByLabel("Sessões por semana").selectOption("2");
  await page.getByRole("button", { name: "Fase 02", exact: true }).click();
  await expect(page.getByLabel("Microciclos (semanas)")).toHaveValue("4");
  await page.getByRole("button", { name: "Calcular planejamento" }).click();
  await expect(page.locator(".big-stat")).toContainText("11");
  await expect(page.locator(".summary-stats")).toContainText("30");
  await page.getByRole("button", { name: "Fase 01", exact: true }).click();
  await expect(page.locator(".microcycles")).toContainText("C / A");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar rascunho JSON" }).click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(file).toBeTruthy();
  const result = JSON.parse(await readFile(file!, "utf8"));
  expect(result).toMatchObject({
    status: "DRAFT",
    totalWeeks: 11,
    totalSessions: 30,
    startDate: "2026-10-26",
    endDate: "2027-01-10",
  });
  expect(
    result.phases[0].microcycles.map((w: { sessions: string[] }) => w.sessions),
  ).toEqual([
    ["A", "B"],
    ["C", "A"],
    ["B", "C"],
  ]);
  await page.getByLabel("Sessões por semana").selectOption("3");
  await expect(
    page.getByRole("button", { name: "Exportar rascunho JSON" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Seu ciclo começa aqui." }),
  ).toBeVisible();
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
