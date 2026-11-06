import { expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, showStudentTab } from "./helpers";

/**
 * Shared steps of the V4 generation flow specs (Xintus-like case, fictitious): hypertrophy, intermediate, 4 sessions a week, 3 phases of 4 weeks
 * with the A/B division. The professional, the student and the plan are created through the real screens; nothing is seeded.
 */
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

export async function xintusPlan(page: Page, studio: string, studentName: string): Promise<{ studentURL: string; revisionURL: string }> {
  await createProfessional(page, studio);
  const studentURL = await addStudent(page, studentName);
  await page.goto(studentURL);
  await showStudentTab(page, "Periodização");
  await page.getByRole("link", { name: "Novo plano" }).click();
  await page.getByLabel("Nome do plano").fill("Plano Xintus");
  await page.getByLabel("Data de início").fill(yesterday());
  for (const phase of ["Fase 01", "Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar fase" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Microciclos (semanas)").selectOption("4");
    await page.getByLabel("Sessões por semana").selectOption("4");
    await page.getByLabel("Divisão de treinos").selectOption("AB");
    await page.getByLabel("Alvo de exercícios por treino").selectOption("5");
  }
  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();
  await expect(page.getByRole("heading", { name: "Plano Xintus" })).toBeVisible();
  return { studentURL, revisionURL: page.url() };
}

/** The required answers of GEN-01: a stimulus per phase and the whole equipment list. */
export async function answerRequired(page: Page) {
  for (const n of [1, 2, 3]) await page.getByLabel(`Estímulo principal da fase ${n}`).selectOption("HYPERTROPHY");
  const equipment = page.getByRole("group", { name: "Equipamentos disponíveis" });
  await equipment.getByRole("button", { name: "Ver lista completa de equipamentos" }).click();
  await equipment.getByRole("button", { name: "Marcar todos" }).click();
}

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 861;
