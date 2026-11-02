import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor } from "./helpers";
import { closeEditor, editor, inspector, library, openEditor, panel, stage, state, showTab, asLegacySite } from "./site-helpers";

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

test("models: a site of one page with pages from models, each at an address of its own, with no text invented; published with the warnings and visited by page", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await createWith(page, /^Uma página só/, "Marina Modelos");
  // The buttons of the models go to the contacts of the site: they are filled in once, on the home page.
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início"]);

  // ---- a page from a model opens in the editor with its blocks and no text of its own; the same model again takes another address ----
  await addFromModel(page, "Depoimentos");
  await expect(editor(page).getByText("Página “Depoimentos” criada a partir do modelo", { exact: false })).toBeVisible();
  await expect(field(page, "Endereço da página")).toHaveValue("depoimentos");
  await expect(stage(page).locator('[data-frame="desktop"] .site-quote')).toHaveCount(3);
  await addFromModel(page, "Sobre mim");
  await expect(field(page, "Endereço da página")).toHaveValue("sobre-mim");
  await addFromModel(page, "Sobre mim");
  await expect(field(page, "Endereço da página")).toHaveValue("sobre-mim-2");
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Depoimentos", "Sobre mim", "Sobre mim"]);

  // ---- the testimonies start empty: a warning (an empty one is not on the site), not a block ----
  await save(page);
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(editor(page).getByRole("list", { name: "O que falta para publicar" })).toHaveCount(0);
  await expect(editor(page).getByRole("list", { name: "Avisos antes de publicar" })).toContainText("escreva um depoimento autorizado");
  await editor(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();
  await closeEditor(page);

  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  await visitor.goto(`./s/${slug}`);
  const nav = visitor.getByRole("navigation", { name: "Páginas do site" });
  await expect(nav.getByRole("link")).toHaveText(["Início", "Depoimentos", "Sobre mim", "Sobre mim"]);
  await expect(visitor.getByRole("link", { name: "Chamar no WhatsApp" }).first()).toHaveAttribute("href", "https://wa.me/5511912345678");
  await nav.getByRole("link", { name: "Depoimentos" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/depoimentos$`));
  await expect(visitor.locator(".site-quote")).toHaveCount(0);
  await visitor.goto(`./s/${slug}/sobre-mim-2`);
  await expect(visitor).toHaveTitle(/^Sobre mim — /);
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

/** The form of the first step, after the Editor Guiado was chosen. */
async function startCreating(page: Page, owner: string) {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, owner);
  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Guiado" }).click();
  return { form: page.getByRole("form", { name: "Criar o meu site" }), slug: `estudio-${unique}` };
}
const LABELS = ["Energia (vermelho e laranja)", "Bem-estar (claro e laranja)", "Premium (preto e laranja)", "Performance (azul e branco)", "Uma página só"];

test("models V1: four models of the handoff as cards with a picture, each seen whole with its samples; the site created starts with the model's look and none of the samples, and is published without the sample photos", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { form, slug } = await startCreating(page, "Marina Premium");

  // ---- five cards: the four models with a picture of their page, and the single page with its drawing; the first is chosen ----
  const radios = form.locator(".model-card").getByRole("radio");
  await expect(radios).toHaveCount(5);
  for (const [at, label] of LABELS.entries()) await expect(radios.nth(at)).toHaveAccessibleName(new RegExp(`^${label.replace(/[()]/g, "\\$&")}`));
  await expect(form.locator(".model-card img.model-thumb[aria-hidden='true']")).toHaveCount(4);
  await expect(radios.first()).toBeChecked();
  await form.getByLabel("Título do site").fill("Marina Premium");

  // ---- "Ver o modelo": the model as the Figma has it, with its sample photos, numbers and coaches; Escape closes it ----
  await form.getByRole("button", { name: "Ver o modelo Performance (azul e branco)" }).click();
  let preview = page.getByRole("dialog", { name: "Modelo: Performance (azul e branco)" });
  await expect(preview.locator(".site[data-site-accent='palette'][data-site-font='inter']")).toHaveCount(1);
  await expect(preview.getByText("Alex", { exact: true })).toBeVisible();
  await expect(preview.locator("img[src*='/site-models/race-coach-1.webp']")).toBeVisible();
  await expect(preview.getByText("R$ 299")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await form.getByRole("button", { name: "Ver o modelo Premium (preto e laranja)" }).click();
  preview = page.getByRole("dialog", { name: "Modelo: Premium (preto e laranja)" });
  await expect(preview.locator("header.site-header")).toContainText("Marina Premium");
  await preview.getByRole("button", { name: "Celular" }).click();
  await preview.getByRole("button", { name: "Usar este modelo" }).click();
  await expect(preview).toBeHidden();
  await expect(form.getByRole("radio", { name: /^Premium/ })).toBeChecked();
  await form.getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();

  // ---- the Editor Guiado: the sections of the model, the six colors in Marca, the banner of the highlight swappable; contacts in the footer ----
  await page.getByRole("region", { name: "Páginas do site" }).getByRole("button", { name: "Abrir o Editor Guiado" }).click();
  const guided = page.getByRole("dialog", { name: "Editor Guiado" });
  const picks = guided.getByRole("navigation", { name: "Seções do site" }).locator(".guided-section-pick");
  await expect(picks.first()).toHaveText("Cabeçalho do site");
  expect((await picks.allTextContents()).length).toBeGreaterThan(10);
  await guided.getByRole("tablist", { name: "Partes do Editor Guiado" }).getByRole("tab", { name: "Marca" }).click();
  await expect(guided.getByRole("group", { name: "Cores do site" }).locator("input[type='color']")).toHaveCount(6);
  await guided.getByRole("tablist", { name: "Partes do Editor Guiado" }).getByRole("tab", { name: "Conteúdo" }).click();
  await guided.getByRole("navigation", { name: "Seções do site" }).getByRole("button", { name: "Destaque", exact: true }).click();
  await expect(guided.getByRole("region", { name: "Destaque" }).getByRole("group", { name: "Imagem de fundo" })).toBeVisible();
  await guided.getByRole("navigation", { name: "Seções do site" }).getByRole("button", { name: "Rodapé do site", exact: true }).click();
  await guided.getByRole("region", { name: "Rodapé do site" }).getByLabel("WhatsApp").fill("31 99999-0000");
  await guided.getByRole("button", { name: "Salvar rascunho" }).first().click();
  await expect(guided.getByText("Rascunho salvo.")).toBeVisible();
  await guided.getByRole("tablist", { name: "Partes do Editor Guiado" }).getByRole("tab", { name: "Publicar" }).click();
  const panelPublish = guided.getByRole("tabpanel");
  await panelPublish.getByRole("button", { name: "Publicar", exact: true }).click();
  // The sample photos are said before publishing (a warning: they are left out of the page).
  await expect(guided.getByRole("list", { name: "Avisos antes de publicar" })).toContainText("foto de exemplo do modelo");
  await panelPublish.getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(guided.getByText(/Publicado: o site está no ar/)).toBeVisible();
  await guided.getByRole("button", { name: "Fechar o Editor Guiado" }).click();

  // ---- the visitor: the model's look, the menu to the sections, the WhatsApp buttons, and none of the samples or sample photos ----
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  for (const width of [1440, 390]) {
    await visitor.setViewportSize({ width, height: 900 });
    await visitor.goto(`./s/${slug}`);
    await expect(visitor.locator(".site[data-site-accent='palette']")).toHaveCount(1);
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px`).toBeLessThanOrEqual(1);
  }
  await visitor.setViewportSize({ width: 1440, height: 900 });
  const html = await visitor.content();
  expect(html).not.toContain("site-models/");
  expect(html).not.toMatch(/R\$ \d|★/);
  const nav = visitor.getByRole("navigation", { name: "Páginas do site" });
  await expect(nav.getByRole("link", { name: "Contato" })).toHaveAttribute("href", /^#s-/);
  // The site is not receiving messages, so the buttons go straight to WhatsApp, with the model's opening message (0.66).
  const straight = `https://wa.me/5531999990000?text=${encodeURIComponent("Olá! Gostaria de conhecer seus treinos.")}`;
  await expect(visitor.locator("header .site-header-cta")).toHaveAttribute("href", straight);
  await expect(visitor.locator("main a.site-has-icon").first()).toHaveAttribute("href", straight);
  await expect(visitor.locator("#site-whatsapp-form")).toHaveCount(0);
  await visit.context.close();
});

test("models V1: on a phone the cards are one under the other, the model is seen without going to the side, and the site created opens in the Editor Guiado", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(240_000);
  const { form } = await startCreating(page, "Luna Energia");
  await expect(form.locator(".model-card").getByRole("radio")).toHaveCount(5);
  const lefts = await form.locator(".model-card").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
  expect(new Set(lefts).size, "one column on a phone").toBe(1);
  await form.getByRole("button", { name: "Ver o modelo Energia (vermelho e laranja)" }).click();
  const preview = page.getByRole("dialog", { name: "Modelo: Energia (vermelho e laranja)" });
  await expect(preview.locator(".site[data-site-accent='palette']")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await preview.getByRole("button", { name: "Fechar a prévia do modelo" }).click();
  await form.getByLabel("Título do site").fill("Luna Energia");
  await form.getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();
  await page.getByRole("region", { name: "Páginas do site" }).getByRole("button", { name: "Abrir o Editor Guiado" }).click();
  const guided = page.getByRole("dialog", { name: "Editor Guiado" });
  await guided.getByRole("button", { name: "Ver prévia" }).click();
  const shown = guided.getByRole("region", { name: "Prévia da página" });
  await expect(shown.locator(".site[data-site-accent='palette']")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
