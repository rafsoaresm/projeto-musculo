import { test, expect } from "@playwright/test";
import { localIP, noHorizontalOverflow } from "./helpers";

// Requires DEMO_MODE=true (npm run auth:setup:local writes it for local runs).
test("the demonstration shows the three areas with fictional data and saves nothing", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await page.goto("./demonstracao");
  await expect(
    page.getByRole("heading", { name: "Veja a ferramenta pelos três papéis." }),
  ).toBeVisible();
  await noHorizontalOverflow(page);

  // Manager view.
  await page.getByRole("link", { name: "Ver como gestor" }).click();
  await expect(page.getByText("DEMONSTRAÇÃO", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Quem contratou a ferramenta." }),
  ).toBeVisible();
  await expect(page.getByText("Treino em Movimento").first()).toBeVisible();
  await noHorizontalOverflow(page);

  // Switch to the professional view.
  await page
    .getByRole("navigation", { name: "Trocar de área" })
    .getByRole("link", { name: "Profissional" })
    .click();
  await expect(page.getByRole("heading", { name: /^Olá, Marina\./ })).toBeVisible();
  await page.goto("./demonstracao/profissional/alunos/ana");
  await expect(page.getByText("Revisão profissional necessária.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar plano" })).toBeDisabled();
  await page.getByRole("tab", { name: /Mesociclo 2/ }).click();
  await expect(page.getByText(/8–12 repetições/)).toBeVisible();
  await noHorizontalOverflow(page);
  await page.goto("./demonstracao/profissional/alunos/carlos");
  await expect(page.getByText(/revisão foi entregue e é imutável/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar plano" })).toHaveCount(0);

  // Client view: ticking sets works, and reloading proves nothing was kept.
  await page.goto("./demonstracao/aluno/treino");
  await expect(page.getByText("0 de 12 séries concluídas")).toBeVisible();
  await page.getByLabel("Série 1 feita").first().check();
  await expect(page.getByText("1 de 12 séries concluídas")).toBeVisible();
  await page.reload();
  await expect(page.getByText("0 de 12 séries concluídas")).toBeVisible();
  await noHorizontalOverflow(page);

  // The demonstration never opens the real areas.
  await page.goto("./profissional");
  await expect(
    page.getByRole("heading", { name: "Bom ter você de volta." }),
  ).toBeVisible();
});
