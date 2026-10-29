import { expect, type Page } from "@playwright/test";
import { createProfessional, localIP } from "./helpers";

export const state = (page: Page) => page.getByRole("region", { name: "Estado do site" });
export const editor = (page: Page) => page.getByRole("dialog", { name: "Editor visual do site" });
export const stage = (page: Page) => editor(page).getByRole("main", { name: "Página" });
export const inspector = (page: Page) => editor(page).getByRole("complementary", { name: "Propriedades" });
export const library = (page: Page) => editor(page).getByRole("complementary", { name: "Blocos e camadas" });

/** On a phone the editor shows one panel at a time; on a computer all three are there. */
export async function panel(page: Page, name: "Blocos" | "Página" | "Propriedades") {
  const tabs = editor(page).getByRole("group", { name: "Painéis do editor" });
  if (await tabs.isVisible()) await tabs.getByRole("button", { name, exact: true }).click();
}
export async function openEditor(page: Page) {
  await state(page).getByRole("button", { name: "Abrir o editor visual" }).click();
  await expect(editor(page)).toBeVisible();
}
export async function closeEditor(page: Page) {
  await editor(page).getByRole("button", { name: "Fechar o editor" }).click();
  await expect(editor(page)).toHaveCount(0);
}
/** Selects a block by the list of layers, the way that works with a keyboard and on a phone. */
export async function selectLayer(page: Page, label: RegExp | string, nth = 0) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Camadas", exact: true }).click();
  await library(page).getByRole("list", { name: "Blocos da página" }).locator(".ve-layer").filter({ hasText: label }).nth(nth).click();
  await panel(page, "Propriedades");
}
/** The names of the layers, from the first to the last (the tree, as a list). */
export const layerNames = async (page: Page) => {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Camadas", exact: true }).click();
  return library(page).getByRole("list", { name: "Blocos da página" }).locator(".ve-layer strong").allInnerTexts();
};
/** Adds a block from the library by a click. It goes inside the container that is selected, or after the block that is selected. */
export async function addSelected(page: Page, name: string) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Blocos", exact: true }).click();
  await library(page).getByRole("button", { name: `Acrescentar ${name}`, exact: true }).click();
}
/** Adds a block at the end of the page: nothing selected first, so it goes to the end. */
export async function addAtEnd(page: Page, name: string) {
  await selectLayer(page, "Configurações da página");
  await addSelected(page, name);
}
export const styleTab = (page: Page) => inspector(page).getByRole("button", { name: "Estilo", exact: true });
export const contentTab = (page: Page) => inspector(page).getByRole("button", { name: "Conteúdo", exact: true });


/** A new professional with a new site, and its editor open. Returns the address of the site. */
export async function startEditor(page: Page, name = "Marina Editor") {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, name);
  await page.goto("./profissional/meu-site");
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await openEditor(page);
  return `estudio-${unique}`;
}
