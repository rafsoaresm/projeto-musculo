import { test, expect } from "@playwright/test";
import {
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
  password,
  uniqueEmail,
} from "./helpers";

test("the library offers the 64 system exercises and keeps each organization's own apart", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da biblioteca");
  const own = `Exercício próprio ${crypto.randomUUID().slice(0, 8)}`;

  // The system library: 64 exercises, none of them with a reviewed video.
  await page.goto("./profissional/biblioteca");
  await expect(
    page.getByRole("heading", { name: "Biblioteca de exercícios", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "exercícios" })).toContainText("64");
  await expect(page.getByText("Vídeo revisado", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Link de busca, não é vídeo revisado").first(),
  ).toBeVisible();
  await noHorizontalOverflow(page);

  // Filters: by category, by name, and a wildcard is just text.
  await page.getByLabel("Categoria").selectOption("Cardio");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "exercícios" })).toContainText("4");
  await page.goto("./profissional/biblioteca?q=rosca");
  await expect(page.getByRole("link", { name: "Rosca martelo" })).toBeVisible();
  await page.goto("./profissional/biblioteca?q=%25");
  await expect(page.getByRole("heading", { name: "Nenhum exercício encontrado." })).toBeVisible();

  // A system exercise is read-only; a copy becomes the organization's own.
  await page.goto("./profissional/biblioteca?q=Rosca+martelo");
  await page.getByRole("link", { name: "Rosca martelo" }).click();
  await expect(page.getByText("Exercício do sistema, somente leitura.")).toBeVisible();
  await expect(page.getByLabel("Nome do exercício")).toHaveCount(0);
  await page.getByRole("button", { name: "Copiar para minha biblioteca" }).click();
  await expect(page.getByLabel("Nome do exercício")).toHaveValue("Rosca martelo");
  await page.getByLabel("Observações (só da sua organização)").fill("Pegada neutra.");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Alterações salvas.")).toBeVisible();
  // Saving must not reset the other fields (the category once fell back to the first option).
  await expect(page.getByLabel("Categoria")).toHaveValue("Puxar");
  await expect(page.getByLabel("Nome do exercício")).toHaveValue("Rosca martelo");

  // A second copy repeats the name and is refused.
  await page.goBack();
  await page.goto("./profissional/biblioteca?q=Rosca+martelo");
  await page.getByRole("link", { name: "Rosca martelo" }).first().click();
  await page.getByRole("button", { name: "Copiar para minha biblioteca" }).click();
  await expect(page.getByText("Você já tem uma cópia deste exercício")).toBeVisible();

  // Create: an insecure or foreign video link is refused, a YouTube link is accepted.
  await page.goto("./profissional/biblioteca/novo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome do exercício").fill(own);
  await page.getByLabel("Link do vídeo (opcional)").fill("https://exemplo.com/video");
  await page.getByRole("button", { name: "Criar exercício" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "link https do YouTube ou do Vimeo" })).toBeVisible();
  await page.getByLabel("Link do vídeo (opcional)").fill("https://www.youtube.com/watch?v=abc123");
  await page.getByRole("button", { name: "Criar exercício" }).click();
  await expect(page.getByRole("heading", { name: own, level: 1 })).toBeVisible();
  const ownURL = page.url();
  await expect(page.getByText("Vídeo ainda não revisado")).toBeVisible();

  // Reviewing the video is a deliberate second save.
  await page.getByLabel("Revisei este vídeo e ele mostra a execução que eu quero prescrever").check();
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Alterações salvas.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Vídeo revisado", { exact: true })).toBeVisible();
  // A new link clears the review even with the box ticked.
  await page.getByLabel("Link do vídeo (opcional)").fill("https://vimeo.com/123456");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Alterações salvas.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Vídeo ainda não revisado")).toBeVisible();

  // The same name twice is refused.
  await page.goto("./profissional/biblioteca/novo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome do exercício").fill(own.toUpperCase());
  await page.getByRole("button", { name: "Criar exercício" }).click();
  await expect(page.getByText("Já existe um exercício ativo com este nome")).toBeVisible();

  // Another organization sees the system library but not this exercise, even by address.
  const other = await newActor(browser, baseURL);
  await other.page.goto("./cadastro");
  await other.page.waitForLoadState("networkidle");
  await other.page.getByLabel("Seu nome").fill("Outra pessoa");
  await other.page.getByLabel("E-mail", { exact: true }).fill(uniqueEmail("other"));
  await other.page.getByLabel("Senha", { exact: true }).fill(password);
  await other.page.locator("form button").click();
  await other.page.getByLabel("Nome do espaço").fill("Outro estúdio da biblioteca");
  await other.page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(other.page.getByRole("heading", { name: /^Olá, / })).toBeVisible();
  await other.page.goto("./profissional/biblioteca");
  await expect(other.page.getByRole("status").filter({ hasText: "exercícios" })).toContainText("64");
  await other.page.goto(`./profissional/biblioteca?q=${encodeURIComponent(own)}`);
  await expect(other.page.getByRole("heading", { name: "Nenhum exercício encontrado." })).toBeVisible();
  await other.page.goto(ownURL);
  await expect(other.page.getByRole("heading", { name: "Página não encontrada." })).toBeVisible();
  await other.context.close();

  // Archive hides it from the default list; "Mostrar arquivados" brings it back.
  await page.goto(ownURL);
  await page.getByRole("button", { name: "Arquivar exercício" }).click();
  // The page itself changes state: archived, read-only, with a way back.
  await expect(page.getByRole("button", { name: "Restaurar exercício" })).toBeVisible();
  await expect(page.getByLabel("Nome do exercício")).toHaveCount(0);
  await page.goto(`./profissional/biblioteca?q=${encodeURIComponent(own)}`);
  await expect(page.getByRole("heading", { name: "Nenhum exercício encontrado." })).toBeVisible();
  await page.goto(`./profissional/biblioteca?q=${encodeURIComponent(own)}&arquivados=1`);
  await expect(page.getByRole("link", { name: own })).toBeVisible();
  await page.goto(ownURL);
  await page.getByRole("button", { name: "Restaurar exercício" }).click();
  await expect(page.getByLabel("Nome do exercício")).toHaveValue(own);
  await expect(page.getByRole("button", { name: "Arquivar exercício" })).toBeVisible();
});
