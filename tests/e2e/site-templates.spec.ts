import { test, expect, type Locator, type Page } from "@playwright/test";
import { newActor } from "./helpers";
import { addAtEnd, editor, inspector, library, panel, selectLayer, stage, startEditor as startSite, styleTab } from "./site-helpers";

const startEditor = (page: Page) => startSite(page, "Marina Modelos");

type Size = "desktop" | "tablet" | "mobile";
const frame = (page: Page, size: Size) => stage(page).locator(`[data-frame="${size}"]`);
const showFrame = (page: Page, name: "computador" | "tablet" | "celular") => editor(page).getByRole("button", { name: `Mostrar o quadro do ${name}` });
const tags = (target: Locator) => target.evaluateAll((elements) => elements.map((element) => element.tagName.toLowerCase()));
/** How many columns a grid is drawn with right now (the browser resolves `repeat(3, …)` to the widths of three tracks). */
const columnsOf = (target: Locator) => target.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);

/** The names of the blocks of the page itself (the ones inside a container are not counted, whether the container is open or not). */
const topLayers = async (page: Page) => {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Camadas", exact: true }).click();
  return library(page).getByRole("list", { name: "Blocos da página" }).locator('.ve-layer-row[data-depth="0"] .ve-layer strong').allInnerTexts();
};

const TEMPLATES = ["Barra de navegação", "3 destaques", "Imagem e texto", "Planos", "Depoimentos", "Rodapé"];

test("templates: six sections ready in the library, each one a tree of containers and elements that adapts to the three sizes, added or undone in one step, and published with the rules for each size", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below: one frame at a time.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await startEditor(page);

  // The contact the buttons of the templates go to (a button that goes to a contact that is not filled in is only a warning, but the page should be whole).
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("WhatsApp", { exact: true }).fill("(11) 91234-5678");

  // ---- the library: a group of its own, with the six templates ----
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Blocos", exact: true }).click();
  const group = library(page).getByRole("region", { name: "Modelos" });
  await expect(group.getByRole("button", { name: /^Acrescentar / })).toHaveCount(6);
  for (const name of TEMPLATES) await expect(group.getByRole("button", { name: `Acrescentar ${name}`, exact: true })).toBeVisible();

  // ---- each one goes in with a click, at the end of the page, selected, as one step of the history ----
  const main = frame(page, "desktop").locator(".site-main > *");
  const before = await main.count();
  for (const name of TEMPLATES) await addAtEnd(page, name);
  await expect(main).toHaveCount(before + 6);
  expect((await tags(main)).slice(before)).toEqual(["header", "section", "section", "section", "section", "footer"]);
  expect((await topLayers(page)).slice(-6)).toEqual(TEMPLATES);
  await expect(stage(page).locator(".ve-chip")).toHaveText("Rodapé");

  // The navigation and the footer carry their links inside a <nav>; the plans are three cards of three elements.
  await expect(frame(page, "desktop").locator(".site-main > header nav .site-link")).toHaveCount(3);
  await expect(frame(page, "desktop").locator(".site-main > footer nav")).toHaveCount(1);
  const plans = frame(page, "desktop").locator(".site-main > section:has(> article)");
  await expect(plans.locator("> article")).toHaveCount(3);
  await expect(plans.locator("> article").first().locator("> *")).toHaveCount(3);
  await expect(plans.locator("> article").first().getByText("Quero este plano")).toBeVisible();

  // Nothing invented: the places for the person's words show what goes there, and the only words already written are the labels of structure.
  await expect(plans.locator("> article").first().locator('[data-placeholder="Escreva o título"]')).toHaveText("");
  await expect(plans.locator("> article").first().locator('[data-placeholder="Escreva o texto"]')).toHaveText("");

  // ---- one step: undo takes the last template out as a whole, redo puts it back ----
  await editor(page).getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(main).toHaveCount(before + 5);
  expect((await tags(main)).slice(before)).toEqual(["header", "section", "section", "section", "section"]);
  await editor(page).getByRole("button", { name: "Refazer", exact: true }).click();
  await expect(main).toHaveCount(before + 6);

  // ---- the three sizes: three columns on the computer, two on the tablet, one on the phone, and the image and the text one under the other when it is narrow ----
  await showFrame(page, "tablet").click();
  await showFrame(page, "celular").click();
  await expect(stage(page).locator("[data-frame]")).toHaveCount(3);
  const template = (size: Size, name: (typeof TEMPLATES)[number]) => frame(page, size).locator(".site-main > *").nth(before + TEMPLATES.indexOf(name));
  for (const [size, columns] of [["desktop", 3], ["tablet", 2], ["mobile", 1]] as const) {
    for (const name of ["3 destaques", "Planos", "Depoimentos"]) expect(await columnsOf(template(size, name)), `${size}, ${name}`).toBe(columns);
  }
  const sideBySide = async (size: Size) => {
    const [image, text] = await Promise.all([0, 1].map(async (at) => (await template(size, "Imagem e texto").locator("> *").nth(at).boundingBox())!));
    return text.y < image.y + image.height - 1;
  };
  expect(await sideBySide("desktop")).toBe(true);
  expect(await sideBySide("mobile")).toBe(false);

  // ---- the template is the person's to change: select the plans, and the panel shows the container's own style, size by size ----
  await selectLayer(page, /^Planos/);
  await expect(stage(page).locator(".ve-chip")).toHaveText("Planos");
  await styleTab(page).click();
  const columns = inspector(page).getByLabel("Colunas", { exact: true });
  await inspector(page).getByRole("button", { name: "Estilo do celular" }).click();
  await expect(columns).toHaveValue("1");
  await inspector(page).getByRole("button", { name: "Estilo do tablet" }).click();
  await expect(columns).toHaveValue("2");
  await inspector(page).getByRole("button", { name: "Estilo do computador" }).click();
  await expect(columns).toHaveValue("3");

  // ---- the testimony still asks for the authorization: the publication is stopped until it is given, and not by the other templates ----
  await panel(page, "Propriedades");
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  const stop = editor(page).getByRole("list", { name: "O que falta para publicar" });
  await expect(stop).toContainText("confirme que a pessoa autorizou");
  await expect(stop.getByRole("listitem")).toHaveCount(3);
  await expect(editor(page).getByRole("button", { name: "Publicar mesmo assim" })).toHaveCount(0);

  // Taking the testimonies out (Delete on the block selected) leaves only warnings (the words that are still to be written).
  await selectLayer(page, /^Depoimentos/);
  await page.keyboard.press("Delete");
  await expect(main).toHaveCount(before + 5);
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(editor(page).getByRole("list", { name: "O que falta para publicar" })).toHaveCount(0);
  await expect(editor(page).getByRole("list", { name: "Avisos antes de publicar" })).toContainText("escreva o título");
  await editor(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();

  // ---- the published page: the same rules for each size, written in the sheet and answered to by the window ----
  const anonymous = await newActor(browser, baseURL);
  const visitor = anonymous.page;
  await visitor.setViewportSize({ width: 1280, height: 800 });
  await visitor.goto(`./s/${slug}`);
  const publicPlans = visitor.locator(".site-main > section:has(> article)");
  await expect(publicPlans.locator("> article")).toHaveCount(3);
  expect(await columnsOf(publicPlans)).toBe(3);
  await visitor.setViewportSize({ width: 800, height: 800 });
  expect(await columnsOf(publicPlans)).toBe(2);
  await visitor.setViewportSize({ width: 400, height: 800 });
  expect(await columnsOf(publicPlans)).toBe(1);
  // Only what leads somewhere is on the page: of the links, the ones to a contact that is filled in (just the WhatsApp here), none of the ones with no destination.
  await expect(visitor.locator(".site-main > footer a")).toHaveCount(1);
  await expect(visitor.locator(".site-main > footer a")).toHaveText("WhatsApp");
  await expect(visitor.locator(".site-main > header nav a")).toHaveCount(1);
  await expect(visitor.locator(".site-main > header nav a")).toHaveText("Contato");
  await expect(publicPlans.locator("> article a")).toHaveText(["Quero este plano", "Quero este plano", "Quero este plano"]);
  const sheet = await (await visitor.request.get(`./s/${slug}/estilo.css`)).text();
  expect(sheet).toMatch(/@media \(max-width:1023px\)\{[^@]*repeat\(2,/);
  expect(sheet).toMatch(/@media \(max-width:576px\)\{[^@]*repeat\(1,/);
  await anonymous.context.close();
});

test("on a phone a template goes in from the list of blocks, is one block of the page, and the grid is one column", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(150_000);
  await startEditor(page);

  await addAtEnd(page, "Planos");
  await panel(page, "Página");
  const grid = frame(page, "mobile").locator(".site-main > section:has(> article)");
  await expect(grid.locator("> article")).toHaveCount(3);
  expect(await columnsOf(grid)).toBe(1);
  expect((await topLayers(page)).slice(-1)).toEqual(["Planos"]);
});
