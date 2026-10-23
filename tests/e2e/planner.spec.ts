import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("navigation and responsive layout render without application errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Um método. Todo o percurso." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Visão geral", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Explorar planejamento" }).click();
  await expect(
    page.getByRole("heading", { name: "Planejamento de ciclos" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Mapa do produto" }).click();
  await expect(
    page.getByRole("heading", { name: "O produto, por inteiro." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("calculates independent phases, exports the actual draft and invalidates stale results", async ({
  page,
}) => {
  await page.goto("./planejamento");
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
  await page.goto("./planejamento");
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
