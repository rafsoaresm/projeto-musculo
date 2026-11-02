import { test, expect } from "@playwright/test";
import { createProfessional, localIP, newActor } from "./helpers";
import { showTab, state } from "./site-helpers";

// The Editor Guiado (handoff V4, Figma 10:162; the user's decision of 01/11/2026): a site created in the guided editor is edited by sections
// with a form, and what is saved and published is the same draft as before.
test("guided editor: sections, the content of each one, the page seen as it changes, saved, published and seen by a visitor", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Guiado ${unique}`, "Marina Guiada");
  const slug = `guiado-${unique}`;
  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Guiado" }).click();
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();

  await page.getByRole("region", { name: "Páginas do site" }).getByRole("button", { name: "Abrir o Editor Guiado" }).click();
  const guided = page.getByRole("dialog", { name: "Editor Guiado" });
  await expect(guided).toBeVisible();
  await expect(guided.getByText("Site profissional / Página inicial / Rascunho")).toBeVisible();
  const sections = guided.getByRole("navigation", { name: "Seções do site" });
  const names = await sections.getByRole("button").allTextContents();
  expect(names.length).toBeGreaterThan(0);

  // The first section that has a title: its title is typed and the page in the middle shows it at once.
  const form = guided.getByRole("region", { name: "Conteúdo da seção" });
  const preview = guided.getByRole("region", { name: "Prévia da página" });
  let typed = false;
  for (const name of names) {
    await sections.getByRole("button", { name, exact: true }).click();
    const title = form.getByLabel("Título", { exact: true });
    if (await title.count()) {
      await title.fill("Treino sob medida em Belo Horizonte");
      typed = true;
      break;
    }
  }
  expect(typed, "the starting page has a section with a title").toBe(true);
  await expect(preview.getByText("Treino sob medida em Belo Horizonte")).toBeVisible();
  await form.getByLabel("Descrição da página (SEO)").fill("Acompanhamento individual de treino");
  await expect(guided.getByText("alterações não salvas")).toBeVisible();

  await guided.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(guided.getByText("Rascunho salvo.")).toBeVisible();
  await expect(guided.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  await guided.getByRole("button", { name: "Fechar o Editor Guiado" }).click();
  await expect(guided).toHaveCount(0);

  // A reload keeps what was saved; publishing is the same as before (a warning may ask to publish anyway).
  await page.reload();
  await page.getByRole("link", { name: "Editar site" }).click();
  await expect(guided.getByRole("region", { name: "Prévia da página" }).getByText("Treino sob medida em Belo Horizonte")).toBeVisible();
  await guided.getByRole("button", { name: "Fechar o Editor Guiado" }).click();
  await showTab(page, "Publicação");
  await state(page).getByRole("button", { name: "Publicar", exact: true }).click();
  const anyway = state(page).getByRole("button", { name: "Publicar mesmo assim" });
  await expect(anyway.or(state(page).getByText("No ar").first())).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
  await expect(state(page).getByText("No ar").first()).toBeVisible();
  const visitor = await newActor(browser, baseURL);
  await visitor.page.goto(`./s/${slug}`);
  await expect(visitor.page.getByText("Treino sob medida em Belo Horizonte")).toBeVisible();
  await expect(visitor.page.locator('meta[name="description"]')).toHaveAttribute("content", "Acompanhamento individual de treino");
  await visitor.page.close();
});
