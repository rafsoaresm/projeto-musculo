import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor, png } from "./helpers";
import { showTab, state } from "./site-helpers";

// The Editor Guiado, rebuilt after the user's review of 02/11/2026: tabs, every page (also on a phone), the section being edited outlined on
// the page, the site's header (name, logo, menu) and footer (contacts) on every page, the brand, an image sent from its field, and SEO by page.

async function createGuided(page: Page, model: RegExp | null) {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Guiado ${unique}`, "Marina Guiada");
  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Guiado" }).click();
  const form = page.getByRole("form", { name: "Criar o meu site" });
  if (model) await form.getByRole("radio", { name: model }).check();
  await form.getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();
  await page.getByRole("region", { name: "Páginas do site" }).getByRole("button", { name: "Abrir o Editor Guiado" }).click();
  const guided = page.getByRole("dialog", { name: "Editor Guiado" });
  await expect(guided).toBeVisible();
  return { guided, slug: `guiado-${unique}` };
}
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 720;
const tab = (guided: ReturnType<Page["getByRole"]>, name: string) => guided.getByRole("tablist", { name: "Partes do Editor Guiado" }).getByRole("tab", { name, exact: true });

/** Chooses a section in the list (on a phone the list is a step of its own). */
async function chooseSection(page: Page, name: string) {
  const guided = page.getByRole("dialog", { name: "Editor Guiado" });
  if (isPhone(page) && (await guided.getByRole("button", { name: "Seções", exact: true }).isVisible())) await guided.getByRole("button", { name: "Seções", exact: true }).click();
  await guided.getByRole("navigation", { name: "Seções do site" }).getByRole("button", { name, exact: true }).click();
}
/** The preview: next to the form on a computer, over everything on a phone. */
async function openPreview(page: Page) {
  const guided = page.getByRole("dialog", { name: "Editor Guiado" });
  if (isPhone(page)) await guided.getByRole("button", { name: "Ver prévia" }).click();
  const preview = guided.getByRole("region", { name: "Prévia da página" });
  await expect(preview).toBeVisible();
  return preview;
}
async function closePreview(page: Page) {
  if (isPhone(page)) await page.getByRole("dialog", { name: "Editor Guiado" }).getByRole("button", { name: "Fechar prévia" }).click();
}

test("guided editor: tabs, every page of the site, the section outlined on the page, header and footer on every page, saved, published and visited", async ({
  page,
  browser,
  baseURL,
}) => {
  const { guided, slug } = await createGuided(page, /^Personal trainer/);
  await expect(guided.getByRole("tablist", { name: "Partes do Editor Guiado" }).getByRole("tab")).toHaveText(["Páginas", "Conteúdo", "Marca", "SEO", "Publicar"]);
  await expect(tab(guided, "Conteúdo")).toHaveAttribute("aria-selected", "true");
  await expect(guided.getByLabel("Onde você está")).toContainText("Página inicial › Cabeçalho do site");

  // The header of the site: its name, typed here, is in the preview's header and footer.
  const name = `Marina Treinos ${slug.slice(-4)}`;
  await chooseSection(page, "Cabeçalho do site");
  await guided.getByRole("region", { name: "Cabeçalho do site" }).getByLabel("Nome do site").fill(name);
  // The footer has the contacts, the same on every page.
  await chooseSection(page, "Rodapé do site");
  await guided.getByRole("region", { name: "Rodapé do site" }).getByLabel("WhatsApp").fill("31 99999-0000");
  let preview = await openPreview(page);
  await expect(preview.locator("header.site-header")).toContainText(name);
  await expect(preview.locator("footer.site-footer")).toContainText(name);
  await expect(preview.locator("footer.site-footer")).toContainText("WhatsApp");
  await expect(preview.locator("footer[data-guided-current]")).toHaveCount(1);
  await closePreview(page);

  // Another page of the site, chosen in the same place on a phone and on a computer: its sections are listed and its title is edited.
  if (isPhone(page)) await guided.getByRole("button", { name: "Seções", exact: true }).click();
  await guided.getByLabel("Página em edição").selectOption({ label: "Sobre" });
  await expect(guided.getByLabel("Onde você está")).toContainText("Sobre");
  const sections = guided.getByRole("navigation", { name: "Seções do site" }).getByRole("button");
  const names = (await sections.allTextContents()).filter((entry) => entry !== "Cabeçalho do site" && entry !== "Rodapé do site");
  let typed = false;
  for (const section of names) {
    await chooseSection(page, section);
    const title = guided.getByRole("region", { name: section }).getByLabel("Título", { exact: true });
    if (await title.count()) {
      await title.fill("Quem eu sou e como trabalho");
      typed = true;
      await expect(guided.getByLabel("Onde você está")).toContainText(`Sobre › ${section}`);
      break;
    }
  }
  expect(typed, "the page Sobre has a section with a title").toBe(true);
  preview = await openPreview(page);
  await expect(preview.getByText("Quem eu sou e como trabalho")).toBeVisible();
  await expect(preview.locator("[data-guided-current]")).toBeInViewport();
  await expect(preview.locator("footer.site-footer")).toContainText("WhatsApp");
  // A click on a part of the page chooses it (on a phone the preview closes and its fields open).
  await preview.locator("header.site-header").click();
  if (isPhone(page)) await expect(guided.getByRole("region", { name: "Prévia da página" })).toBeHidden();
  else await closePreview(page);
  await expect(guided.getByLabel("Onde você está")).toContainText("Sobre › Cabeçalho do site");
  await expect(guided.getByRole("region", { name: "Cabeçalho do site" }).getByLabel("Nome do site")).toHaveValue(name);

  // SEO of that page, with the preview of a search result.
  await tab(guided, "SEO").click();
  await guided.getByLabel("Descrição para buscadores (opcional)").fill("Como é o acompanhamento, passo a passo");
  await expect(guided.getByRole("group", { name: "Prévia no Google" })).toContainText("Como é o acompanhamento, passo a passo");
  await expect(guided.getByRole("group", { name: "Prévia no Google" })).toContainText(`Sobre — ${name}`);

  // Saved and published from the editor itself.
  await guided.getByRole("button", { name: "Salvar rascunho" }).first().click();
  await expect(guided.getByText("Rascunho salvo.")).toBeVisible();
  await tab(guided, "Publicar").click();
  const panel = guided.getByRole("tabpanel");
  await panel.getByRole("button", { name: "Publicar", exact: true }).click();
  const anyway = panel.getByRole("button", { name: "Publicar mesmo assim" });
  await expect(anyway.or(guided.getByText(/Publicado: o site está no ar/))).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
  await expect(guided.getByText(/Publicado: o site está no ar/)).toBeVisible();
  await guided.getByRole("button", { name: "Fechar o Editor Guiado" }).click();

  const visitor = await newActor(browser, baseURL);
  await visitor.page.goto(`./s/${slug}/sobre`);
  await expect(visitor.page.getByText("Quem eu sou e como trabalho")).toBeVisible();
  await expect(visitor.page.locator('meta[name="description"]')).toHaveAttribute("content", "Como é o acompanhamento, passo a passo");
  await expect(visitor.page.locator("footer.site-footer")).toContainText(name);
  await expect(visitor.page.locator("footer.site-footer").getByRole("link", { name: "WhatsApp" })).toBeVisible();
  await visitor.page.goto(`./s/${slug}`);
  await expect(visitor.page.locator("footer.site-footer").getByRole("link", { name: "WhatsApp" })).toBeVisible();
  await visitor.context.close();
});

test("guided editor: the brand (logo sent from the editor, color, look and font) and an image of a section sent from its own field", async ({ page, browser, baseURL }) => {
  const { guided, slug } = await createGuided(page, /^Estúdio \/ assessoria/);

  await tab(guided, "Marca").click();
  const logo = guided.getByRole("group", { name: "Logotipo" });
  await logo.getByLabel("Escolher o arquivo da imagem").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png(200, 80) });
  await expect(logo.getByText("Imagem enviada.")).toBeVisible();
  await guided.getByRole("radio", { name: "Minha cor" }).check();
  await guided.getByLabel("Cor da sua marca").fill("#ffff00");
  await expect(guided.getByText(/A cor foi ajustada para o texto continuar legível/)).toBeVisible();
  await guided.getByRole("radio", { name: "Escuro" }).check();
  await guided.getByRole("radio", { name: "Com serifa" }).check();
  let preview = await openPreview(page);
  await expect(preview.locator("header.site-header img.site-logo")).toBeVisible();
  await expect(preview.locator(".site[data-site-mode='dark'][data-site-font='serif']")).toHaveCount(1);
  await closePreview(page);

  // A section with an image: a new banner is sent from the field itself and chosen at once; its description is written next to it.
  await tab(guided, "Conteúdo").click();
  const names = (await guided.getByRole("navigation", { name: "Seções do site" }).getByRole("button").allTextContents()).filter((entry) => !entry.endsWith("do site"));
  let sent = false;
  for (const section of names) {
    await chooseSection(page, section);
    const region = guided.getByRole("region", { name: section });
    const field = region.getByRole("group", { name: /^Imagem/ }).first();
    if (await field.count()) {
      await field.getByLabel("Escolher o arquivo da imagem").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: png(640, 360) });
      await expect(field.getByText("Imagem enviada.")).toBeVisible();
      await region.getByLabel(/^Descrição da imagem/).first().fill("Treino ao ar livre");
      sent = true;
      break;
    }
  }
  expect(sent, "the model Estúdio / assessoria has a section with an image").toBe(true);
  preview = await openPreview(page);
  await expect(preview.getByRole("img", { name: "Treino ao ar livre" })).toBeVisible();
  await closePreview(page);

  await guided.getByRole("button", { name: "Salvar rascunho" }).first().click();
  await expect(guided.getByText("Rascunho salvo.")).toBeVisible();
  await guided.getByRole("button", { name: "Fechar o Editor Guiado" }).click();
  await showTab(page, "Publicação");
  await state(page).getByRole("button", { name: "Publicar", exact: true }).click();
  const anyway = state(page).getByRole("button", { name: "Publicar mesmo assim" });
  await expect(anyway.or(state(page).getByText("No ar").first())).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
  await expect(state(page).getByText("No ar").first()).toBeVisible();
  const visitor = await newActor(browser, baseURL);
  await visitor.page.goto(`./s/${slug}`);
  await expect(visitor.page.locator("header.site-header img.site-logo")).toBeVisible();
  await expect(visitor.page.locator(".site[data-site-mode='dark']")).toHaveCount(1);
  await expect(visitor.page.getByRole("img", { name: "Treino ao ar livre" })).toBeVisible();
  await visitor.context.close();
});
