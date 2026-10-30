import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor } from "./helpers";
import { addAtEnd, closeEditor, editor, inspector, layerNames, library, openEditor, panel, stage, state } from "./site-helpers";

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
  const form = page.getByRole("form", { name: "Criar o meu site" });
  await form.getByRole("radio", { name: /Editor anterior/ }).check();
  await form.getByLabel("Título do site").fill(title);
  if (model) await form.getByRole("radio", { name: model }).check();
  await form.getByRole("radio", { name: /Editor anterior/ }).check();
  await form.getByRole("button", { name: "Criar meu site" }).click();
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

test("models: a site that starts complete, with the pages of a personal trainer to be written, and pages that start from a model, with no text invented; published with the warnings and visited by page", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await createWith(page, /^Site completo/, "Marina Modelos");
  // The buttons of the models go to the contacts of the site: they are filled in once, on the home page.
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");
  await field(page, "E-mail de contato").fill("marina@example.test");
  await field(page, "Instagram (o nome de usuário)").fill("marina.treinos");

  // ---- the complete site: the home page and four more, in the order of the menu, with the title where the visitor reads it first ----
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Sobre mim", "Serviços", "Perguntas frequentes", "Contato"]);
  await expect(list(page).getByRole("button", { name: "Abrir a página Sobre mim", exact: true })).toContainText("/sobre-mim");
  await expect(list(page).getByRole("button", { name: "Abrir a página Contato", exact: true })).toContainText("/contato");
  await expect(stage(page).locator('[data-frame="desktop"]').getByRole("heading", { name: "Marina Modelos", level: 1 })).toBeVisible();

  // ---- a page from a model opens in the editor with its blocks and no text of its own; its address is made from the title ----
  await addFromModel(page, "Depoimentos");
  await expect(editor(page).getByText("Página “Depoimentos” criada a partir do modelo", { exact: false })).toBeVisible();
  await expect(stage(page).getByText("Página: Depoimentos")).toBeVisible();
  await expect(field(page, "Endereço da página")).toHaveValue("depoimentos");
  await expect(stage(page).locator('[data-frame="desktop"] .site-quote')).toHaveCount(3);
  // The same model again does not take the address of the first: it has its own.
  await addFromModel(page, "Sobre mim");
  await expect(field(page, "Endereço da página")).toHaveValue("sobre-mim-2");
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Sobre mim", "Serviços", "Perguntas frequentes", "Contato", "Depoimentos", "Sobre mim"]);

  // ---- the testimonials come unauthorized: nothing is published before the person is confirmed, and the page is said ----
  await save(page);
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  const stopped = editor(page).getByRole("list", { name: "O que falta para publicar" });
  await expect(stopped).toContainText("Página “Depoimentos”: ");
  await expect(stopped).toContainText("confirme que a pessoa autorizou");
  await expect(editor(page).getByRole("button", { name: "Publicar mesmo assim" })).toHaveCount(0);

  // ---- without that page (the deletion can be undone), what is left is only warnings: publish anyway ----
  await openPages(page);
  await list(page).getByRole("button", { name: "Abrir a página Depoimentos", exact: true }).click();
  await library(page).getByRole("button", { name: "Excluir a página Depoimentos", exact: true }).click();
  await save(page);
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(editor(page).getByRole("list", { name: "O que falta para publicar" })).toHaveCount(0);
  await expect(editor(page).getByRole("list", { name: "Avisos antes de publicar" })).toContainText("Página “Sobre mim”: ");
  await editor(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();
  await closeEditor(page);

  // ---- the visitor: a menu with the five titles and the sixth page, each at its own address ----
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  await visitor.goto(`./s/${slug}`);
  const nav = visitor.getByRole("navigation", { name: "Páginas do site" });
  await expect(nav.getByRole("link")).toHaveText(["Início", "Sobre mim", "Serviços", "Perguntas frequentes", "Contato", "Sobre mim"]);
  await nav.getByRole("link", { name: "Contato" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/contato$`));
  await expect(visitor.getByRole("heading", { name: "Contato" })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Chamar no WhatsApp" })).toHaveAttribute("href", "https://wa.me/5511912345678");
  await expect(visitor.getByRole("link", { name: "Enviar e-mail" })).toHaveAttribute("href", "mailto:marina@example.test");
  await expect(visitor.getByRole("link", { name: "Abrir o Instagram" })).toHaveAttribute("href", "https://www.instagram.com/marina.treinos/");
  await visitor.goto(`./s/${slug}/sobre-mim-2`);
  await expect(visitor).toHaveTitle(/^Sobre mim — /);
  expect((await visitor.request.get(`./s/${slug}/depoimentos`)).status()).toBe(404);
  await visit.context.close();
});

test("models: the default is still a single page, and a model of a page can be added on a phone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(240_000);
  await createWith(page, null, "Marina Celular");
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início"]);
  await addFromModel(page, "Perguntas frequentes");
  await expect(editor(page).getByText("Página “Perguntas frequentes” criada a partir do modelo", { exact: false })).toBeVisible();
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Perguntas frequentes"]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("layout models: four models as cards with a drawing; a site of layouts starts with its pages, its look and empty image frames whose shape can be changed, and is published with no empty frame and nothing to the side", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Atleta");
  await page.goto("./profissional/meu-site");
  const form = page.getByRole("form", { name: "Criar o meu site" });
  await form.getByRole("radio", { name: /Editor anterior/ }).check();

  // ---- the first step: a card for each model, with a drawing that reading aids skip, and the chosen one outlined ----
  await expect(form.locator(".model-card").getByRole("radio")).toHaveCount(4);
  await expect(form.locator(".model-card svg.model-thumb[aria-hidden='true']")).toHaveCount(4);
  expect(await form.locator(".model-card").getByRole("radio").evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).checked))).toEqual([true, false, false, false]);
  const athlete = form.getByRole("radio", { name: /^Atleta e instrutor/ });
  await athlete.check();
  await expect(form.getByRole("radio", { name: /^Uma página só/ })).not.toBeChecked();
  const card = form.locator(".model-card", { hasText: "Atleta e instrutor" });
  expect(await card.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
  await form.getByLabel("Título do site").fill("Marina Atleta");
  await form.getByRole("radio", { name: /Editor anterior/ }).check();
  await form.getByRole("button", { name: "Criar meu site" }).click();
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await openEditor(page);
  const slug = `estudio-${unique}`;

  // ---- the pages and the look of the model, the name of the site as the big title, and the pictures as empty frames of a shape ----
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Sobre mim", "Serviços", "Contato"]);
  const desktop = stage(page).locator('[data-frame="desktop"]');
  await expect(desktop.locator('[data-site-accent="green"]').first()).toBeAttached();
  await expect(desktop.getByRole("heading", { name: "Marina Atleta", level: 2 })).toBeVisible();
  await expect(desktop.locator("figure.site-image .site-image-empty")).toHaveCount(3);
  await expect(desktop.locator("figure.site-image[data-ratio]")).toHaveCount(3);

  // ---- the shape of a frame is chosen in the panel and is the shape that is drawn ----
  const first = desktop.locator("figure.site-image").first();
  // The frame itself, not the figure (which also holds the line of the caption).
  const shape = async () => {
    const box = (await first.locator(".site-image-empty").boundingBox())!;
    return box.width / box.height;
  };
  expect(await shape()).toBeCloseTo(4 / 5, 1);
  await first.locator(".site-image-empty").click();
  await panel(page, "Propriedades");
  const ratio = inspector(page).locator("label", { hasText: /^Proporção/ }).locator("select");
  await expect(ratio).toHaveValue("4:5");
  await ratio.selectOption("1:1");
  expect(await shape()).toBeCloseTo(1, 1);
  await ratio.selectOption("16:9");
  expect(await shape()).toBeCloseTo(16 / 9, 1);
  await ratio.selectOption("4:5");
  // The corners of the frame are the radius written in its style (24px here), and a stand-in text takes the color of the text it stands for, so it
  // can be read on the band or the card that has a color of its own (white on the green band).
  expect(await first.locator(".site-image-empty").evaluate((node) => getComputedStyle(node).borderRadius)).toBe("24px");
  const standIn = await desktop.locator(".site-editable:empty").last().evaluate((node) => ({ own: getComputedStyle(node).color, before: getComputedStyle(node, "::before").color }));
  expect(standIn.before).toBe(standIn.own);
  expect(standIn.own).toBe("rgb(255, 255, 255)");

  // ---- the layouts are in the library, in a group of their own, and one added to the page is a section of containers and elements ----
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Blocos", exact: true }).click();
  await expect(library(page).getByRole("heading", { name: "Layouts" })).toBeVisible();
  for (const label of ["Destaque dividido", "Destaque com imagem à esquerda", "Faixa de números", "Faixa de links", "Cartões coloridos", "Sobre em painéis", "Chamada final em faixa"]) {
    await expect(library(page).getByRole("button", { name: `Acrescentar ${label}`, exact: true }), label).toBeVisible();
  }
  await addAtEnd(page, "Faixa de links");
  expect(await layerNames(page)).toContain("Faixa de links");

  // ---- published with the warnings: the empty frames are not on the page, and the page does not go to the side at any width ----
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
    await expect(visitor.getByRole("heading", { name: "Marina Atleta", level: 2 })).toBeVisible();
    await expect(visitor.locator(".site-image")).toHaveCount(0);
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px`).toBeLessThanOrEqual(1);
  }
  // On the phone the menu is the button, and it holds the four pages.
  await visitor.getByText("Menu", { exact: true }).click();
  await expect(visitor.getByRole("navigation", { name: "Páginas do site" }).getByRole("link")).toHaveText(["Início", "Sobre mim", "Serviços", "Contato"]);
  await visit.context.close();
});

test("layout models: the personal trainer model on a phone, with the cards one under the other and the pages in order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Luna Personal");
  await page.goto("./profissional/meu-site");
  const form = page.getByRole("form", { name: "Criar o meu site" });
  await form.getByRole("radio", { name: /Editor anterior/ }).check();
  await expect(form.locator(".model-card").getByRole("radio")).toHaveCount(4);
  const cards = await form.locator(".model-card").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
  expect(new Set(cards).size, "one column on a phone").toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await form.getByRole("radio", { name: /^Personal trainer/ }).check();
  await form.getByLabel("Título do site").fill("Luna Personal");
  await form.getByRole("radio", { name: /Editor anterior/ }).check();
  await form.getByRole("button", { name: "Criar meu site" }).click();
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await openEditor(page);
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Sobre mim", "Serviços", "Perguntas frequentes", "Contato"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
