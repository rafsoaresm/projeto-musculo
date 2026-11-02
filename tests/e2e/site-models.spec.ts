import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor } from "./helpers";
import { addAtEnd, closeEditor, editor, inspector, layerNames, library, openEditor, panel, stage, state, showTab, asLegacySite } from "./site-helpers";

const list = (page: Page) => library(page).getByRole("list", { name: "Páginas do site" });
const rowNames = (page: Page) => list(page).locator(".ve-layer strong").allInnerTexts();
const field = (page: Page, label: string) => inspector(page).getByRole("textbox", { name: label, exact: true });
const save = async (page: Page) => {
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
};
async function openPages(page: Page) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Páginas", exact: true }).click();
}
/** A new professional on the first step of the site, with the model chosen on the form. */
async function createWith(page: Page, model: RegExp | null, title: string) {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Modelos");
  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Guiado" }).click();
  const form = page.getByRole("form", { name: "Criar o meu site" });
  await form.getByLabel("Título do site").fill(title);
  if (model) await form.getByRole("radio", { name: model }).check();
  await form.getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();
  await asLegacySite(page, `estudio-${unique}`);
  await showTab(page, "Publicação");
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await openEditor(page);
  return `estudio-${unique}`;
}
async function addFromModel(page: Page, label: string) {
  await openPages(page);
  const models = library(page).locator("details.ve-models");
  if (!(await models.evaluate((node) => (node as HTMLDetailsElement).open))) await models.locator("summary").click();
  await models.getByRole("button", { name: `Nova página a partir do modelo ${label}`, exact: true }).click();
}

test("models: the Personal trainer model starts as a complete site of five pages, a page from a model takes an address of its own, and empty testimonies are not published", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await createWith(page, /^Personal trainer/, "Marina Modelos");
  // The buttons of the models go to the contacts of the site: they are filled in once, on the home page.
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");
  await field(page, "E-mail de contato").fill("marina@example.test");
  await field(page, "Instagram (o nome de usuário)").fill("marina.treinos");

  // ---- the complete site: the home page and four more, in the order of the menu, with the name of the site as the big title ----
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Sobre", "Serviços e planos", "Depoimentos", "Contato"]);
  await expect(list(page).getByRole("button", { name: "Abrir a página Sobre", exact: true })).toContainText("/sobre");
  await expect(list(page).getByRole("button", { name: "Abrir a página Contato", exact: true })).toContainText("/contato");
  await expect(stage(page).locator('[data-frame="desktop"]').getByRole("heading", { name: "Marina Modelos", level: 2 })).toBeVisible();
  // The pictures of the model are its own drawings, not empty frames.
  await expect(stage(page).locator('[data-frame="desktop"] svg[data-illustration]').first()).toBeVisible();
  await expect(stage(page).locator('[data-frame="desktop"] .site-image-empty')).toHaveCount(0);

  // ---- a page from a model opens in the editor with its blocks and no text of its own; the address of the site's own page is not taken ----
  await addFromModel(page, "Depoimentos");
  await expect(editor(page).getByText("Página “Depoimentos” criada a partir do modelo", { exact: false })).toBeVisible();
  await expect(field(page, "Endereço da página")).toHaveValue("depoimentos-2");
  await expect(stage(page).locator('[data-frame="desktop"] .site-quote')).toHaveCount(3);
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Sobre", "Serviços e planos", "Depoimentos", "Contato", "Depoimentos"]);

  // ---- the testimonies start empty: that is a warning (an empty one is not on the site), not a block ----
  await save(page);
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(editor(page).getByRole("list", { name: "O que falta para publicar" })).toHaveCount(0);
  await expect(editor(page).getByRole("list", { name: "Avisos antes de publicar" })).toContainText("escreva um depoimento autorizado");
  await editor(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();
  await closeEditor(page);

  // ---- the visitor: a menu with every page, each at its own address ----
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  await visitor.goto(`./s/${slug}`);
  const nav = visitor.getByRole("navigation", { name: "Páginas do site" });
  await expect(nav.getByRole("link")).toHaveText(["Início", "Sobre", "Serviços e planos", "Depoimentos", "Contato", "Depoimentos"]);
  await expect(visitor.locator("svg[data-illustration]").first()).toBeVisible();
  await nav.getByRole("link", { name: "Contato" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/contato$`));
  await expect(visitor.getByRole("heading", { name: "Contato", level: 2 })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Chamar no WhatsApp" }).first()).toHaveAttribute("href", "https://wa.me/5511912345678");
  await expect(visitor.getByRole("link", { name: "Enviar e-mail" })).toHaveAttribute("href", "mailto:marina@example.test");
  await expect(visitor.getByRole("link", { name: "Abrir o Instagram" })).toHaveAttribute("href", "https://www.instagram.com/marina.treinos/");
  await visitor.goto(`./s/${slug}/depoimentos-2`);
  await expect(visitor).toHaveTitle(/^Depoimentos — /);
  await expect(visitor.locator(".site-quote")).toHaveCount(0);
  await visit.context.close();
});

test("models: a site of one page, and a model of a page can be added on a phone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(240_000);
  await createWith(page, /^Uma página só/, "Marina Celular");
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início"]);
  await addFromModel(page, "Perguntas frequentes");
  await expect(editor(page).getByText("Página “Perguntas frequentes” criada a partir do modelo", { exact: false })).toBeVisible();
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Perguntas frequentes"]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("models: three complete models as cards with a drawing, each seen whole before it is chosen; the studio is dark and purple, with its drawings in frames whose shape can be changed, and is published with nothing to the side", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Estúdio");
  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Guiado" }).click();
  const form = page.getByRole("form", { name: "Criar o meu site" });

  // ---- a card for each model, with a drawing that reading aids skip; Personal trainer is chosen at first ----
  await expect(form.locator(".model-card").getByRole("radio")).toHaveCount(4);
  await expect(form.locator(".model-card svg.model-thumb[aria-hidden='true']")).toHaveCount(4);
  expect(await form.locator(".model-card").getByRole("radio").evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).checked))).toEqual([true, false, false, false]);
  await expect(form.getByRole("radio", { name: /^Personal trainer/ })).toBeChecked();
  await form.getByLabel("Título do site").fill("Marina Estúdio");

  // ---- "Ver o modelo": every page of the model, at the width of a computer or a phone, with the name typed; closed with Escape ----
  await form.getByRole("button", { name: "Ver o modelo Treino online / consultoria" }).click();
  let preview = page.getByRole("dialog", { name: "Modelo: Treino online / consultoria" });
  await expect(preview.getByRole("heading", { name: "Marina Estúdio", level: 2 })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(form.getByRole("radio", { name: /^Personal trainer/ })).toBeChecked();
  await form.getByRole("button", { name: "Ver o modelo Estúdio / assessoria" }).click();
  preview = page.getByRole("dialog", { name: "Modelo: Estúdio / assessoria" });
  await expect(preview.locator(".site[data-site-mode='dark']")).toHaveCount(1);
  await expect(preview.getByLabel("Página")).toHaveValue(/.+/);
  await preview.getByLabel("Página").selectOption({ label: "Contato" });
  await expect(preview.getByRole("heading", { name: "Contato", level: 2 })).toBeVisible();
  await preview.getByRole("button", { name: "Celular" }).click();
  await expect(preview.getByRole("button", { name: "Celular" })).toHaveAttribute("aria-pressed", "true");
  await preview.getByRole("button", { name: "Usar este modelo" }).click();
  await expect(preview).toBeHidden();
  await expect(form.getByRole("radio", { name: /^Estúdio \/ assessoria/ })).toBeChecked();
  const card = form.locator(".model-card", { hasText: "Estúdio / assessoria" });
  expect(await card.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
  await form.getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();
  await asLegacySite(page, `estudio-${unique}`);
  await showTab(page, "Publicação");
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await openEditor(page);
  const slug = `estudio-${unique}`;

  // ---- the pages and the look of the model, the name of the site as the big title, and the drawings in frames of a shape ----
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Sobre", "Serviços e planos", "Depoimentos", "Contato"]);
  const desktop = stage(page).locator('[data-frame="desktop"]');
  await expect(desktop.locator('[data-site-accent="purple"]').first()).toBeAttached();
  await expect(desktop.locator(".site[data-site-mode='dark']").first()).toBeAttached();
  await expect(desktop.getByRole("heading", { name: "Marina Estúdio", level: 2 })).toBeVisible();
  await expect(desktop.locator("figure.site-image .site-image-empty")).toHaveCount(0);
  const first = desktop.locator("figure.site-image[data-ratio]").first();
  await expect(first.locator("svg[data-illustration]")).toBeVisible();

  // ---- the shape of a frame is chosen in the panel and is the shape that is drawn ----
  const shape = async () => {
    const box = (await first.locator("svg[data-illustration]").boundingBox())!;
    return box.width / box.height;
  };
  await first.locator("svg[data-illustration]").click();
  await panel(page, "Propriedades");
  const ratio = inspector(page).locator("label", { hasText: /^Proporção/ }).locator("select");
  await ratio.selectOption("1:1");
  expect(await shape()).toBeCloseTo(1, 1);
  await ratio.selectOption("16:9");
  expect(await shape()).toBeCloseTo(16 / 9, 1);

  // ---- the layouts are in the library, in a group of their own, and one added to the page is a section of containers and elements ----
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Blocos", exact: true }).click();
  await expect(library(page).getByRole("heading", { name: "Layouts" })).toBeVisible();
  await addAtEnd(page, "Faixa de links");
  expect(await layerNames(page)).toContain("Faixa de links");

  // ---- published with the warnings: the drawings are on the page, and the page does not go to the side at any width ----
  await save(page);
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(editor(page).getByRole("list", { name: "O que falta para publicar" })).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();
  await closeEditor(page);
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  for (const width of [1280, 768, 360]) {
    await visitor.setViewportSize({ width, height: 900 });
    await visitor.goto(`./s/${slug}`);
    await expect(visitor.getByRole("heading", { name: "Marina Estúdio", level: 2 })).toBeVisible();
    await expect(visitor.locator("svg[data-illustration]").first()).toBeVisible();
    await expect(visitor.locator(".site-image-empty")).toHaveCount(0);
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px`).toBeLessThanOrEqual(1);
  }
  // On the phone the menu is the button, and it holds the five pages.
  await visitor.getByText("Menu", { exact: true }).click();
  await expect(visitor.getByRole("navigation", { name: "Páginas do site" }).getByRole("link")).toHaveText(["Início", "Sobre", "Serviços e planos", "Depoimentos", "Contato"]);
  await visit.context.close();
});

test("models: the Personal trainer model on a phone, seen first, with the cards one under the other and the pages in order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Luna Personal");
  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Guiado" }).click();
  const form = page.getByRole("form", { name: "Criar o meu site" });
  await expect(form.locator(".model-card").getByRole("radio")).toHaveCount(4);
  const cards = await form.locator(".model-card").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
  expect(new Set(cards).size, "one column on a phone").toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await form.getByRole("button", { name: "Ver o modelo Personal trainer" }).click();
  const preview = page.getByRole("dialog", { name: "Modelo: Personal trainer" });
  await expect(preview.locator("svg[data-illustration]").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await preview.getByRole("button", { name: "Fechar a prévia do modelo" }).click();
  await form.getByRole("radio", { name: /^Personal trainer/ }).check();
  await form.getByLabel("Título do site").fill("Luna Personal");
  await form.getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();
  await asLegacySite(page, `estudio-${unique}`);
  await showTab(page, "Publicação");
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await openEditor(page);
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Sobre", "Serviços e planos", "Depoimentos", "Contato"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
