import { test, expect, type Page } from "@playwright/test";
import {
  addStudent,
  createProfessional,
  localIP,
  noHorizontalOverflow,
} from "./helpers";

// The page has two sets of phase tabs: the planner's and the prescription's.
const editorTab = (page: Page, name: string) =>
  page.getByRole("group", { name: "Selecionar mesociclo" }).getByRole("button", { name });
const workout = (page: Page, label: string) =>
  page.getByRole("region", { name: `Treino ${label}` });

test("a professional prescribes by hand, reorders, copies and revises without losing work", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da prescrição");
  await addStudent(page, "Aluno da prescrição");

  // A plan with three phases (ABC, target 5 per workout).
  await page.getByRole("link", { name: "Novo plano" }).click();
  await page.getByLabel("Nome do plano").fill("Ciclo com exercícios");
  await page.getByLabel("Data de início").fill("2026-11-02");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("heading", { name: "Ciclo com exercícios" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exercícios por mesociclo" })).toBeVisible();
  await expect(page.getByText("9 de 9 treinos abaixo do alvo")).toBeVisible();
  const revisionURL = page.url();

  // Nothing is filled in for the professional.
  const a = workout(page, "A");
  await expect(a.getByText("Nenhum exercício neste treino ainda.")).toBeVisible();
  await expect(a.getByText("0 de 5", { exact: true })).toBeVisible();

  // From the library, with a snapshot of the name; then a name of the professional's own.
  await a.getByLabel("Exercício da biblioteca").selectOption({ label: "Agachamento goblet" });
  await a.getByRole("button", { name: "Adicionar da biblioteca" }).click();
  await expect(a.locator(".exercise-list").getByText("Agachamento goblet")).toBeVisible();
  await expect(a.getByText("Sem parâmetros definidos")).toBeVisible();
  await expect(a.getByText("Link de busca, não é vídeo revisado")).toBeVisible();
  await a.getByLabel("Ou um exercício com nome próprio").fill("Meu exercício");
  await a.getByRole("button", { name: "Adicionar com nome próprio" }).click();
  await expect(a.getByText("Meu exercício", { exact: true })).toBeVisible();
  await expect(a.getByText("2 de 5", { exact: true })).toBeVisible();
  await expect(a.getByText("Abaixo do alvo")).toBeVisible();

  // Edit: the professional types every value; a bad video link is refused.
  await a.getByRole("button", { name: "Editar Meu exercício" }).click();
  await a.getByLabel("Séries").fill("3-4");
  await a.getByLabel("Repetições").fill("8-12");
  await a.getByLabel("RIR mínimo").fill("1");
  await a.getByLabel("RIR máximo").fill("3");
  await a.getByLabel("Descanso (segundos)").fill("90");
  await a.getByLabel("Link do vídeo desta prescrição (opcional)").fill("https://exemplo.com/v");
  await a.getByRole("button", { name: "Salvar exercício" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "link https do YouTube ou do Vimeo" })).toBeVisible();
  await a.getByLabel("Link do vídeo desta prescrição (opcional)").fill("https://vimeo.com/123456");
  await a.getByRole("button", { name: "Salvar exercício" }).click();
  await expect(a.getByText("3-4 séries × 8-12 repetições")).toBeVisible();
  await expect(a.getByText("RIR 1 a 3")).toBeVisible();
  await expect(a.getByText("Vídeo ainda não revisado")).toBeVisible();

  // Reorder, duplicate, and remove with a confirmation.
  await a.getByRole("button", { name: "Subir Meu exercício" }).click();
  await expect(a.locator(".exercise-list > li").first()).toContainText("Meu exercício");
  await a.getByRole("button", { name: "Duplicar Meu exercício" }).click();
  await expect(a.getByText("3 de 5", { exact: true })).toBeVisible();
  await a.getByRole("button", { name: "Remover Meu exercício" }).last().click();
  await a.getByRole("button", { name: "Confirmar remoção" }).click();
  await expect(a.getByText("2 de 5", { exact: true })).toBeVisible();

  // Copy a workout into an empty one in another phase.
  await editorTab(page, "Fase 02").click();
  const a2 = workout(page, "A");
  await expect(a2.getByText("0 de 5", { exact: true })).toBeVisible();
  await a2.getByLabel("Copiar de outro treino").selectOption({ label: "Fase 1 · Treino A (2)" });
  await a2.getByRole("button", { name: "Copiar exercícios" }).click();
  await expect(a2.getByText("2 de 5", { exact: true })).toBeVisible();
  await expect(a2.getByText("3-4 séries × 8-12 repetições")).toBeVisible();
  // A workout that already has exercises offers no copy, so nothing is overwritten.
  await expect(a2.getByLabel("Copiar de outro treino")).toHaveCount(0);
  await noHorizontalOverflow(page);

  // A structure change that would drop a workout with exercises is refused and explained.
  await editorTab(page, "Fase 01").click();
  const c = workout(page, "C");
  await c.getByLabel("Ou um exercício com nome próprio").fill("Só no C");
  await c.getByRole("button", { name: "Adicionar com nome próprio" }).click();
  await expect(c.getByText("1 de 5", { exact: true })).toBeVisible();
  // The planner above edits phase 1; switch its split to AB.
  await page.getByRole("group", { name: "Selecionar fase" }).getByRole("button", { name: "Fase 01" }).click();
  await page.getByLabel("Divisão de treinos").selectOption("AB");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "remove treinos que já têm exercícios" })).toBeVisible();
  await page.reload();
  await expect(workout(page, "C").getByText("Só no C")).toBeVisible();

  // Mark the revision ready: it becomes read-only, exercises included.
  await page.getByRole("button", { name: "Marcar estrutura como pronta" }).click();
  await expect(page.getByText("Estrutura pronta", { exact: true }).first()).toBeVisible();
  const frozen = workout(page, "A");
  await expect(frozen.getByText("Meu exercício")).toBeVisible();
  await expect(frozen.getByRole("button", { name: /Editar|Remover|Duplicar|Adicionar/ })).toHaveCount(0);
  await expect(page.getByText("Esta revisão está fechada")).toBeVisible();

  // A new revision carries the exercises; editing it leaves the closed one intact.
  await page.getByRole("button", { name: "Criar nova revisão" }).click();
  await expect(page.getByText("Revisão 2", { exact: false }).first()).toBeVisible();
  const copy = workout(page, "A");
  await expect(copy.getByText("Meu exercício")).toBeVisible();
  await copy.getByRole("button", { name: "Remover Meu exercício" }).click();
  await copy.getByRole("button", { name: "Confirmar remoção" }).click();
  await expect(copy.getByText("Meu exercício")).toHaveCount(0);
  await page.goto(revisionURL);
  await expect(workout(page, "A").getByText("Meu exercício")).toBeVisible();
});
