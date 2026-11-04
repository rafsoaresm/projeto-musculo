import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor, noHorizontalOverflow } from "./helpers";

// Motor S4: library metadata in the real UI. Provenance pills, the "Pendentes de curadoria" filter, reviewing a field (an
// adjustment of a system exercise that only this organization sees), marking pending, curated alternatives, and
// "Inferir metadados das minhas fichas" on the organization's own exercise. Another organization still sees the system values.

const field = (page: Page, name: string) => page.locator(`details[data-field="${name}"]`);
const count = (page: Page) => page.getByRole("status").filter({ hasText: /exercícios?$/ });

test("library metadata: provenance, curation filter, review, pending, alternatives and inference", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio dos metadados");

  // The list shows each exercise's provenance; the system seed is inferred, never "revisado".
  await page.goto("./profissional/biblioteca");
  await expect(page.getByRole("heading", { name: "Metadados para a prescrição automática" })).toBeVisible();
  await expect(page.getByText("Inferido (não revisado)").first()).toBeVisible();
  await expect(page.getByText("Metadados revisados")).toHaveCount(0);
  await noHorizontalOverflow(page);

  // "Pendentes de curadoria": names that do not say enough (no guess) are listed; a complete inferred one is not.
  await page.locator(`select[name="metadados"]`).selectOption("pendentes");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/metadados=pendentes/);
  await expect(page.getByRole("link", { name: "Elevação lateral" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Agachamento goblet" })).toHaveCount(0);
  const pendingBefore = Number((await count(page).textContent())!.match(/\d+/)![0]);
  expect(pendingBefore).toBeGreaterThan(0);

  // A system exercise: inferred values with their rule, editable only as this organization's adjustment.
  await page.getByRole("link", { name: "Elevação lateral" }).click();
  await expect(page.getByRole("heading", { name: "Elevação lateral", level: 1 })).toBeVisible();
  await expect(page.locator("#metadata-title + p")).toHaveText("Pendente de curadoria");
  await expect(field(page, "modality")).toContainText("Treino resistido");
  await expect(field(page, "modality")).toContainText("Inferido (não revisado)");
  await field(page, "modality").locator("summary").click();
  await expect(field(page, "modality")).toContainText("Regra MOD_RESISTANCE");
  await expect(field(page, "equipment")).toContainText("Pendente de curadoria");
  await field(page, "equipment").locator("summary").click();
  // Saving with nothing checked is refused: "Sem equipamento" is its own explicit choice, never implied.
  await field(page, "equipment").getByRole("button", { name: "Criar ajuste da minha organização (revisado por mim)" }).click();
  await expect(field(page, "equipment").getByRole("alert")).toContainText("Escolha um valor válido");
  await expect(field(page, "equipment").locator("summary")).toContainText("Pendente de curadoria");
  await expect(field(page, "equipment").getByLabel("Sem equipamento")).not.toBeChecked();
  await field(page, "equipment").getByLabel("Halteres").check();
  await field(page, "equipment").getByRole("button", { name: "Criar ajuste da minha organização (revisado por mim)" }).click();
  await expect(field(page, "equipment")).toContainText("Revisado pela sua organização");
  await expect(field(page, "equipment").locator("summary")).toContainText("Halteres");
  await expect(page.locator("#metadata-title + p")).toHaveText("Inferido (não revisado)");
  // A second save of the same field uses the new version (no false conflict).
  await field(page, "equipment").getByLabel("Polia / cabo").check();
  await field(page, "equipment").getByRole("button", { name: "Salvar como revisado por mim" }).click();
  await expect(field(page, "equipment").getByRole("status")).toHaveText("Salvo como revisado por você.");
  await expect(field(page, "equipment").locator("summary")).toContainText("Halteres, Polia / cabo");
  await noHorizontalOverflow(page);

  // Marking a field pending stops it being used, and says so.
  await field(page, "laterality").locator("summary").click();
  await field(page, "laterality").getByRole("button", { name: "Marcar como pendente" }).click();
  await expect(field(page, "laterality").locator("summary")).toContainText("Pendente de curadoria");

  // A curated alternative, added and removed.
  await page.getByLabel("Adicionar alternativa").selectOption({ label: "Elevação frontal" });
  await page.getByRole("button", { name: "Adicionar alternativa" }).click();
  await expect(page.getByRole("link", { name: "Elevação frontal" })).toBeVisible();
  await expect(page.getByText("Revisada pela sua organização")).toBeVisible();
  await page.getByRole("button", { name: "Remover a alternativa Elevação frontal" }).click();
  await expect(page.getByRole("link", { name: "Elevação frontal" })).toHaveCount(0);
  await page.getByText("Histórico dos metadados").click();
  await expect(page.getByText(/Equipamento: valor salvo como revisado/).first()).toBeVisible();

  // The reviewed equipment took the exercise out of the curation list for this organization.
  await page.goto("./profissional/biblioteca?metadados=pendentes&q=eleva%C3%A7%C3%A3o+lateral");
  await expect(page.getByRole("heading", { name: "Nenhum exercício encontrado." })).toBeVisible();

  // "Inferir metadados das minhas fichas" on an exercise of this organization.
  const own = `Remada baixa no cabo ${crypto.randomUUID().slice(0, 6)}`;
  await page.goto("./profissional/biblioteca/novo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome do exercício").fill(own);
  await page.getByLabel("Categoria").selectOption("Puxar");
  await page.getByRole("button", { name: "Criar exercício" }).click();
  await expect(page.getByRole("heading", { name: own, level: 1 })).toBeVisible();
  await expect(page.locator("#metadata-title + p")).toHaveText("Pendente de curadoria");
  await page.goto("./profissional/biblioteca");
  await page.getByRole("button", { name: "Inferir metadados das minhas fichas" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Inferência concluída em 1 exercício" })).toBeVisible();
  await page.goto(`./profissional/biblioteca?q=${encodeURIComponent(own)}`);
  await page.getByRole("link", { name: own }).click();
  await expect(field(page, "movement_patterns")).toContainText("Puxar horizontal");
  await expect(field(page, "movement_patterns")).toContainText("Inferido (não revisado)");
  await expect(field(page, "equipment")).toContainText("Polia / cabo");

  // Renaming the exercise refreshes its inferred values in the same save; the history credits the rule.
  const renamed = `Prancha frontal da casa ${crypto.randomUUID().slice(0, 6)}`;
  await page.getByLabel("Nome do exercício").fill(renamed);
  await page.getByLabel("Categoria").selectOption("Core");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Alterações salvas.")).toBeVisible();
  await page.reload();
  await expect(field(page, "movement_patterns").locator("summary")).toContainText("Antiextensão");
  await expect(field(page, "metric").locator("summary")).toContainText("Tempo");
  await page.getByText("Histórico dos metadados").click();
  await expect(page.getByText(/execução iniciada por/).first()).toBeVisible();

  // Another organization: same system exercise, still the system's values (the adjustment is not theirs).
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio dos metadados");
  await other.page.goto("./profissional/biblioteca?metadados=pendentes&q=eleva%C3%A7%C3%A3o+lateral");
  await expect(other.page.getByRole("link", { name: "Elevação lateral" })).toBeVisible();
  await other.page.getByRole("link", { name: "Elevação lateral" }).click();
  await expect(field(other.page, "equipment")).toContainText("Pendente de curadoria");
  await expect(field(other.page, "laterality")).toContainText("Inferido (não revisado)");
  await other.context.close();
});
