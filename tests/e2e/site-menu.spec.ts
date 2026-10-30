import { test, expect, type Page } from "@playwright/test";
import { newActor } from "./helpers";
import { addAtEnd, closeEditor, editor, inspector, library, panel, stage, startEditor as startSite } from "./site-helpers";

const startEditor = (page: Page) => startSite(page, "Marina Menu");
const frame = (page: Page, size: "desktop" | "tablet" | "mobile") => stage(page).locator(`[data-frame="${size}"]`);
const showFrame = (page: Page, name: "computador" | "tablet" | "celular") => editor(page).getByRole("button", { name: `Mostrar o quadro do ${name}` });
async function addPage(page: Page, title: string) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Páginas", exact: true }).click();
  await library(page).getByRole("button", { name: "Nova página" }).click();
  await panel(page, "Propriedades");
  await inspector(page).getByRole("textbox", { name: "Título da página", exact: true }).fill(title);
  await addAtEnd(page, "Parágrafo");
}
/** A site with a menu of three pages, published; the address is returned. */
async function publishedSiteWithMenu(page: Page, names: [string, string]) {
  const slug = await startEditor(page);
  await panel(page, "Propriedades");
  await inspector(page).getByRole("textbox", { name: "WhatsApp", exact: true }).fill("(11) 91234-5678");
  await addPage(page, names[0]);
  await addPage(page, names[1]);
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
  await editor(page).getByRole("button", { name: /^Publicar( nova versão)?$/ }).click();
  await editor(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();
  return slug;
}
const menu = (page: Page) => page.getByRole("navigation", { name: "Páginas do site" });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("menu: a row of links on a wide page that folds into a Menu button on a narrow one, in the frames of the editor and on the published page", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await publishedSiteWithMenu(page, ["Sobre mim", "Perguntas frequentes sobre os treinos"]);

  // ---- the frames of the editor: the same rules, by the width of the page and not of the window ----
  await showFrame(page, "tablet").click();
  await showFrame(page, "celular").click();
  await expect(stage(page).locator("[data-frame]")).toHaveCount(3);
  for (const size of ["desktop", "tablet"] as const) {
    await expect(frame(page, size).locator(".site-menu-toggle")).toBeHidden();
    await expect(frame(page, size).locator(".site-menu-link").first()).toBeVisible();
  }
  const phone = frame(page, "mobile");
  await expect(phone.locator(".site-menu-toggle")).toBeVisible();
  await expect(phone.locator(".site-menu-toggle")).toHaveText("Menu");
  await expect(phone.locator(".site-menu-link").first()).toBeHidden();
  // The name of the site and the button are on one line in the phone's frame.
  const brand = await phone.locator(".site-brand").boundingBox();
  const button = await phone.locator(".site-menu-toggle").boundingBox();
  expect(Math.abs(brand!.y + brand!.height / 2 - (button!.y + button!.height / 2))).toBeLessThan(brand!.height);
  await closeEditor(page);

  // ---- the published page on a wide window: the links are in a row, and there is no button ----
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  await visitor.setViewportSize({ width: 1280, height: 900 });
  await visitor.goto(`./s/${slug}`);
  await expect(visitor.locator(".site-menu-toggle")).toBeHidden();
  await expect(menu(visitor).getByRole("link")).toHaveText(["Início", "Sobre mim", "Perguntas frequentes sobre os treinos"]);

  // ---- the same page on a narrow window: a Menu button; the links are out of sight until it is pressed ----
  await visitor.setViewportSize({ width: 400, height: 800 });
  const toggle = visitor.locator(".site-menu-toggle");
  await expect(toggle).toBeVisible();
  await expect(menu(visitor).getByRole("link")).toHaveCount(0);
  expect(await overflow(visitor)).toBeLessThanOrEqual(1);
  await toggle.click();
  await expect(menu(visitor).getByRole("link")).toHaveText(["Início", "Sobre mim", "Perguntas frequentes sobre os treinos"]);
  await expect(menu(visitor).getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  // The list is a panel under the header, over the page, and each link is as tall as a finger (44px).
  const panelBox = await menu(visitor).locator("ul").boundingBox();
  const headerBox = await visitor.locator(".site-header").boundingBox();
  expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
  for (const link of await menu(visitor).getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await overflow(visitor)).toBeLessThanOrEqual(1);
  // Pressing it again closes it; the keyboard does the same (the box is focusable and Space turns it on and off).
  await toggle.click();
  await expect(menu(visitor).getByRole("link")).toHaveCount(0);
  // From a fresh load the first stop of the Tab key is the box, and the button shows the focus ring.
  await visitor.goto(`./s/${slug}`);
  await visitor.keyboard.press("Tab");
  await expect(toggle).toHaveCSS("outline-style", "solid");
  await visitor.keyboard.press("Space");
  await expect(menu(visitor).getByRole("link", { name: "Sobre mim" })).toBeVisible();
  await menu(visitor).getByRole("link", { name: "Sobre mim" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/sobre-mim$`));
  // On the new page the menu is closed again and the current page is the one marked.
  await expect(menu(visitor).getByRole("link")).toHaveCount(0);
  await toggle.click();
  await expect(menu(visitor).getByRole("link", { name: "Sobre mim" })).toHaveAttribute("aria-current", "page");
  await visit.context.close();
});

test("menu on a phone: the published page has the Menu button, which opens the list, and nothing sticks out", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(300_000);
  const slug = await publishedSiteWithMenu(page, ["Sobre mim", "Contato"]);
  await closeEditor(page);
  const visit = await newActor(browser, baseURL);
  const visitor = await visit.context.newPage();
  await visitor.setViewportSize({ width: 412, height: 915 });
  await visitor.goto(`./s/${slug}`);
  await expect(visitor.locator(".site-menu-toggle")).toBeVisible();
  await expect(menu(visitor).getByRole("link")).toHaveCount(0);
  await visitor.locator(".site-menu-toggle").click();
  await expect(menu(visitor).getByRole("link")).toHaveText(["Início", "Sobre mim", "Contato"]);
  expect(await overflow(visitor)).toBeLessThanOrEqual(1);
  await menu(visitor).getByRole("link", { name: "Contato" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/contato$`));
  await visit.context.close();
});
