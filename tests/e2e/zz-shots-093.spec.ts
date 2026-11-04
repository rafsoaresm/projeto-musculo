import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP } from "./helpers";

const DIR = "/tmp/claude-0/-home-user-projeto-musculo/437756eb-90b4-5954-a2ec-e4bf8a130c76/scratchpad/produto";
const WIDTHS = [1440, 1280, 1024, 768, 390];
async function shots(page: Page, name: string, widths = WIDTHS) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${DIR}/0.93-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("0.93 screenshots", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop");
  test.setTimeout(300_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das capturas 0.93");
  await page.goto("./profissional/prescricao");
  await shots(page, "lista-vazia");
  await page.goto("./profissional/planos/novo");
  await shots(page, "seletor-vazio");
  await addStudent(page, "Bruna Araújo de Souza Mendes");
  await addStudent(page, "Carlos Lima");
  await addStudent(page, "Daniela Ferreira");
  await page.goto("./profissional/planos/novo");
  await shots(page, "seletor");
  await page.locator(".picker-row", { hasText: "Bruna" }).getByRole("link", { name: /Novo plano/ }).click();
  await expect(page.getByRole("heading", { name: "Novo plano de periodização" })).toBeVisible();
  await page.getByLabel("Nome do plano").fill("Ciclo inicial de força");
  await page.getByLabel("Data de início").fill("2026-11-09");
  await page.getByLabel("Alvo de exercícios por treino").selectOption("20");
  await shots(page, "novo-plano");
  await page.getByRole("button", { name: "Calcular planejamento" }).click();
  await shots(page, "novo-plano-calculado", [1440, 390]);
  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();
  await expect(page.getByRole("heading", { name: "Prescrição dos exercícios" })).toBeVisible();
  await shots(page, "revisao-vazia");
  const a = page.getByRole("region", { name: "Treino A" });
  await a.getByLabel("Exercício da biblioteca").selectOption({ label: "Agachamento goblet" });
  await a.getByRole("button", { name: "Adicionar da biblioteca" }).click();
  await expect(a.locator(".exercise-list").getByText("Agachamento goblet")).toBeVisible();
  await shots(page, "revisao-com-exercicio");
  await page.locator("details.structure-details summary").click();
  await shots(page, "revisao-estrutura-aberta", [1440, 390]);
  await page.goto("./profissional/prescricao");
  await shots(page, "lista");
  await page.goto("./profissional/planos/novo");
  await shots(page, "seletor-com-plano");
  await page.goto("./profissional/planos/novo?q=lima");
  await shots(page, "seletor-busca", [1440, 390]);
  await page.goto("./profissional/periodizacao");
  await shots(page, "simulador", [1440, 390]);
});
