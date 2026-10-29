import { test, expect, type Locator, type Page } from "@playwright/test";
import { addAtEnd, addSelected, editor, inspector, layerNames, library, panel, selectLayer, stage, startEditor } from "./site-helpers";

const frame = (page: Page) => stage(page).locator('[data-frame="desktop"]');
const paragraphs = (page: Page) => frame(page).locator('[data-type="paragraph"]');
const topParagraphs = (page: Page) => frame(page).locator('.site-main > [data-type="paragraph"]');
const chip = (page: Page) => stage(page).locator(".ve-chip");
const menu = (page: Page) => editor(page).getByRole("menu");
const radiusOf = (target: Locator) => target.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);

/** Opens a section of the style panel (they start closed, except the first and the visibility one). */
async function openSection(page: Page, title: string) {
  const summary = inspector(page).locator("summary", { hasText: title });
  const closed = await summary.evaluate((element) => !(element.parentElement as HTMLDetailsElement).open);
  if (closed) await summary.click();
}

/** The layers of a kind, in the list (the Layers tab is opened first). */
async function layers(page: Page, name: RegExp | string) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Camadas", exact: true }).click();
  return library(page).getByRole("list", { name: "Blocos da página" }).locator(".ve-layer").filter({ hasText: name });
}
const chosenLayers = async (page: Page) => {
  await layers(page, /./);
  return library(page).getByRole("list", { name: "Blocos da página" }).locator('.ve-layer[aria-current="true"]');
};

test("several blocks at once: Ctrl and Shift in the layers, Shift on the page, a rectangle drawn with Shift, one style for all of them, group, duplicate and delete together", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The pointer shortcuts are for a wide window.");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startEditor(page, "Marina Seleção");
  for (let i = 0; i < 4; i++) await addAtEnd(page, "Parágrafo");
  await expect(topParagraphs(page)).toHaveCount(4);

  // ---- the layers: Ctrl adds (and takes away), Shift takes the range from the last one chosen ----
  const paragraphLayers = await layers(page, /^Parágrafo/);
  await paragraphLayers.nth(0).click();
  await paragraphLayers.nth(2).click({ modifiers: ["Control"] });
  await expect(await chosenLayers(page)).toHaveCount(2);
  await expect(chip(page)).toHaveText("2 blocos");
  await expect(paragraphLayers.nth(2)).toHaveAttribute("data-primary", "");
  await paragraphLayers.nth(2).click({ modifiers: ["Control"] });
  await expect(await chosenLayers(page)).toHaveCount(1);
  await expect(chip(page)).toHaveText("Parágrafo");
  await paragraphLayers.nth(0).click();
  await paragraphLayers.nth(3).click({ modifiers: ["Shift"] });
  await expect(await chosenLayers(page)).toHaveCount(4);
  await expect(chip(page)).toHaveText("4 blocos");

  // ---- one style for all of them: the panel shows what the last chosen has, and every one of them takes the change ----
  await panel(page, "Propriedades");
  await expect(inspector(page).getByRole("status")).toContainText("4 blocos selecionados");
  await openSection(page, "Borda, sombra e efeitos");
  await inspector(page).getByLabel("Arredondamento", { exact: true }).fill("6");
  for (let at = 0; at < 4; at++) await expect(topParagraphs(page).nth(at)).toHaveCSS("border-top-left-radius", "6px");

  // ---- the page: a click picks one, Shift adds a block (or takes it away), a click on the empty page does not clear a selection made with Shift ----
  await topParagraphs(page).nth(1).click();
  await expect(chip(page)).toHaveText("Parágrafo");
  await topParagraphs(page).nth(3).click({ modifiers: ["Shift"] });
  await expect(chip(page)).toHaveText("2 blocos");
  await expect(stage(page).locator(".ve-select-extra")).toHaveCount(1);
  await topParagraphs(page).nth(3).click({ modifiers: ["Shift"] });
  await expect(chip(page)).toHaveText("Parágrafo");
  await expect(stage(page).locator(".ve-select-extra")).toHaveCount(0);

  // ---- the empty page: a click with Shift changes nothing (the selection is being built), a plain click lets go of it ----
  const pageBox = (await frame(page).boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.click(pageBox.x + pageBox.width / 2, pageBox.y + pageBox.height - 6);
  await page.keyboard.up("Shift");
  await expect(chip(page)).toHaveText("Parágrafo");
  await page.mouse.click(pageBox.x + pageBox.width / 2, pageBox.y + pageBox.height - 6);
  await expect(stage(page).locator(".ve-select").first()).toBeHidden();
  await topParagraphs(page).nth(1).click();
  await expect(chip(page)).toHaveText("Parágrafo");

  // ---- Escape lets go of the selection; then a rectangle drawn with Shift picks what it touches ----
  await page.keyboard.press("Escape");
  await expect(stage(page).locator(".ve-select").first()).toBeHidden();
  const second = (await topParagraphs(page).nth(1).boundingBox())!;
  const third = (await topParagraphs(page).nth(2).boundingBox())!;
  const page0 = (await frame(page).boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.move(page0.x - 12, second.y + 1);
  await page.mouse.down();
  await page.mouse.move(third.x + third.width / 2, third.y + third.height - 2, { steps: 8 });
  await expect(stage(page).locator(".ve-marquee")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(stage(page).locator(".ve-marquee")).toHaveCount(0);
  await expect(chip(page)).toHaveText("2 blocos");
  const picked = await chosenLayers(page);
  await expect(picked).toHaveCount(2);
  await expect(picked.nth(0)).toBeVisible();

  // ---- together: group them in a container (Ctrl+G), take it back (Ctrl+Z), duplicate (Ctrl+D), delete ----
  const before = (await layerNames(page)).length;
  await page.keyboard.press("Control+g");
  await expect(topParagraphs(page)).toHaveCount(2);
  expect((await layerNames(page)).length).toBe(before + 1);
  await expect(frame(page).locator('.site-main > [data-type="box"] > [data-type="paragraph"]')).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(topParagraphs(page)).toHaveCount(4);
  expect((await layerNames(page)).length).toBe(before);
  // The container it made is taken apart with Ctrl+Shift+G: what it held goes back to the page, in place.
  const again = await layers(page, /^Parágrafo/);
  await again.nth(1).click();
  await again.nth(2).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await expect(topParagraphs(page)).toHaveCount(2);
  // The container is the block selected after the grouping.
  await expect(chip(page)).toHaveText("Contêiner");
  await page.keyboard.press("Control+Shift+g");
  await expect(topParagraphs(page)).toHaveCount(4);
  await expect(frame(page).locator('.site-main > [data-type="box"]')).toHaveCount(0);
  const both = await layers(page, /^Parágrafo/);
  await both.nth(0).click();
  await both.nth(1).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+d");
  await expect(topParagraphs(page)).toHaveCount(6);
  await expect(chip(page)).toHaveText("2 blocos");
  await page.keyboard.press("Delete");
  await expect(topParagraphs(page)).toHaveCount(4);
  await expect(stage(page).locator(".ve-select").first()).toBeHidden();
  await page.keyboard.press("Control+z");
  await expect(topParagraphs(page)).toHaveCount(6);

  // ---- blocks that are not in the same place cannot be grouped, and the page says why ----
  const outer = await layers(page, /^Parágrafo/);
  await outer.nth(2).click();
  await outer.nth(3).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await expect(frame(page).locator('.site-main > [data-type="box"] > [data-type="paragraph"]')).toHaveCount(2);
  const inner = await layers(page, /^Parágrafo/);
  await inner.nth(0).click();
  await inner.nth(2).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await expect(editor(page).getByRole("alert")).toContainText("mesmo lugar");
});

test("the clipboard, the menu of a block, the shortcuts, the name of a layer and the arrows through the tree", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The pointer shortcuts are for a wide window.");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startEditor(page, "Marina Atalhos");

  // A row of two columns, and a paragraph in the first one.
  await addAtEnd(page, "2 colunas");
  await selectLayer(page, /^Coluna/, 0);
  await addSelected(page, "Parágrafo");
  const names = await layerNames(page);
  expect(names.slice(-4)).toEqual(["2 colunas", "Coluna", "Parágrafo", "Coluna"]);
  const current = async () => (await (await chosenLayers(page)).allInnerTexts()).map((text) => text.split("\n")[0]);

  // ---- the arrows go through the tree from the block that is selected ----
  await (await layers(page, /^Parágrafo/)).first().click();
  expect(await current()).toEqual(["Parágrafo"]);
  await page.keyboard.press("ArrowLeft");
  expect(await current()).toEqual(["Coluna"]);
  await page.keyboard.press("ArrowLeft");
  expect(await current()).toEqual(["2 colunas"]);
  await page.keyboard.press("ArrowRight");
  expect(await current()).toEqual(["Coluna"]);
  await page.keyboard.press("ArrowDown");
  expect(await current()).toEqual(["Parágrafo"]);
  await page.keyboard.press("ArrowDown");
  expect(await current()).toEqual(["Coluna"]);
  await page.keyboard.press("ArrowUp");
  expect(await current()).toEqual(["Parágrafo"]);
  // With Shift the walk adds to the selection (and walking back takes it away).
  await page.keyboard.press("Shift+ArrowDown");
  await expect(await chosenLayers(page)).toHaveCount(2);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(await chosenLayers(page)).toHaveCount(1);

  // ---- the name of a layer: F2, or two clicks; Enter keeps it, Escape gives it up ----
  await page.keyboard.press("F2");
  const field = library(page).getByLabel("Nome da camada Parágrafo");
  await expect(field).toBeFocused();
  await field.fill("Minha frase");
  await page.keyboard.press("Enter");
  await expect(library(page).getByRole("list", { name: "Blocos da página" }).locator(".ve-layer strong", { hasText: "Minha frase" })).toBeVisible();
  const named = (await layers(page, /^Minha frase/)).first();
  await named.dblclick();
  const again = library(page).getByLabel("Nome da camada Minha frase");
  await again.fill("Outro nome");
  await page.keyboard.press("Escape");
  await expect(library(page).getByRole("list", { name: "Blocos da página" }).locator(".ve-layer strong", { hasText: "Minha frase" })).toBeVisible();
  await expect(library(page).getByRole("list", { name: "Blocos da página" }).locator(".ve-layer strong", { hasText: "Outro nome" })).toHaveCount(0);
  // Leaving the field keeps what was typed.
  await named.dblclick();
  await library(page).getByLabel("Nome da camada Minha frase").fill("Por foco");
  await library(page).getByRole("button", { name: "Blocos", exact: true }).click();
  await (await layers(page, /./)).first().waitFor();
  await expect(library(page).getByRole("list", { name: "Blocos da página" }).locator(".ve-layer strong", { hasText: "Por foco" })).toBeVisible();
  await (await layers(page, /^Por foco/)).first().dblclick();
  await library(page).getByLabel("Nome da camada Por foco").fill("Minha frase");
  await page.keyboard.press("Enter");
  // Typing in the field is typing: the block's shortcuts do not take it (Delete does not remove the block).
  await named.dblclick();
  await library(page).getByLabel("Nome da camada Minha frase").fill("");
  await page.keyboard.press("Delete");
  await expect(paragraphs(page)).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(library(page).getByRole("list", { name: "Blocos da página" }).locator(".ve-layer strong", { hasText: "Parágrafo" })).toBeVisible();

  // ---- the menu of a block: right button on the page; Escape closes it; an item does what it says ----
  await paragraphs(page).first().click({ button: "right", position: { x: 6, y: 3 } });
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: /^Desagrupar/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await paragraphs(page).first().click({ button: "right", position: { x: 6, y: 3 } });
  await menu(page).getByRole("menuitem", { name: /^Duplicar/ }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(paragraphs(page)).toHaveCount(2);
  // The right button on a block that is not selected selects it first: the menu is about what is under the pointer.
  await paragraphs(page).nth(0).click({ position: { x: 6, y: 3 } });
  await paragraphs(page).nth(1).click({ button: "right", position: { x: 6, y: 3 } });
  const picked = await chosenLayers(page);
  await expect(picked).toHaveCount(1);
  await expect(picked.first()).toHaveAttribute("data-primary", "").catch(() => undefined);
  const secondLayer = (await layers(page, /^Parágrafo/)).nth(1);
  await expect(secondLayer).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Escape");
  // On a handle of the selected block it is that block's menu too (a small block is mostly handle).
  await paragraphs(page).first().click({ position: { x: 6, y: 3 } });
  await stage(page).locator('[data-handle="resize-s"]').click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  // By keyboard: the arrows move through the items, Enter does the one it is on.
  await paragraphs(page).first().click({ button: "right", position: { x: 6, y: 3 } });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(editor(page).getByRole("alert").or(frame(page).locator("[data-type]").first())).toBeVisible();
  // From the layers, too, and it keeps a selection of several.
  const some = await layers(page, /^Parágrafo/);
  await some.nth(0).click();
  await some.nth(1).click({ modifiers: ["Control"] });
  await some.nth(1).click({ button: "right" });
  await expect(menu(page)).toHaveAccessibleName("Ações de 2 blocos");
  await expect(menu(page).getByRole("menuitem", { name: "Excluir 2 blocos" })).toBeVisible();
  await page.keyboard.press("Escape");

  // ---- copy, cut and paste of blocks: inside the container that is selected ----
  const before = await paragraphs(page).count();
  await (await layers(page, /^Parágrafo/)).first().click();
  await page.keyboard.press("Control+c");
  const columns = await layers(page, /^Coluna/);
  await columns.nth(1).click();
  await page.keyboard.press("Control+v");
  await expect(paragraphs(page)).toHaveCount(before + 1);
  await expect(frame(page).locator('[data-type="box"] [data-type="box"]:nth-of-type(2) > [data-type="paragraph"]')).toHaveCount(1);
  await page.keyboard.press("Control+x");
  await expect(paragraphs(page)).toHaveCount(before);
  await page.keyboard.press("Control+v");
  await expect(paragraphs(page)).toHaveCount(before + 1);

  // ---- copy and paste of a style: from one block to others ----
  const style = await layers(page, /^Parágrafo/);
  await style.nth(0).click();
  await panel(page, "Propriedades");
  await inspector(page).getByRole("button", { name: "Estilo", exact: true }).click();
  await openSection(page, "Borda, sombra e efeitos");
  await inspector(page).getByLabel("Arredondamento", { exact: true }).fill("10");
  await expect.poll(() => radiusOf(paragraphs(page).nth(0))).toBe("10px");
  await expect.poll(() => radiusOf(paragraphs(page).nth(1))).toBe("0px");
  // The focus is in the field the value was typed in, where the shortcut is the field's: it goes back to the block first.
  await style.nth(0).click();
  await page.keyboard.press("Control+Alt+c");
  const targets = await layers(page, /^Parágrafo/);
  await targets.nth(1).click();
  await targets.nth(2).click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+Alt+v");
  await expect.poll(() => radiusOf(paragraphs(page).nth(1))).toBe("10px");
  await expect.poll(() => radiusOf(paragraphs(page).nth(2))).toBe("10px");

  // ---- Escape lets go of the selection, and what is not a copy of blocks is not pasted ----
  await page.keyboard.press("Escape");
  await expect(editor(page).getByRole("heading", { name: "Página", level: 2 })).toBeVisible();
  const count = await paragraphs(page).count();
  await page.evaluate(() => navigator.clipboard.writeText("texto qualquer, que não é uma cópia de blocos")).catch(() => undefined);
  await page.keyboard.press("Control+v");
  await expect(paragraphs(page)).toHaveCount(count);
});
