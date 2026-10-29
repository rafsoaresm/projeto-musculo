import { test, expect, type Locator, type Page } from "@playwright/test";
import { addAtEnd, addSelected, editor, inspector, panel, selectLayer, stage, startEditor, styleTab } from "./site-helpers";

type Size = "desktop" | "tablet" | "mobile";
const frame = (page: Page, size: Size) => stage(page).locator(`[data-frame="${size}"]`);
const row = (page: Page, size: Size = "desktop") => frame(page, size).locator('.site-main > [data-type="box"]').first();
const handle = (page: Page, name: string) => stage(page).locator(`[data-handle="${name}"]`);
const gapHandle = (page: Page) => stage(page).locator('[data-handle^="gap-"]:not([hidden])').first();
const guide = (page: Page, axis: "x" | "y") => stage(page).locator(`.ve-guide[data-axis="${axis}"]`);
const readout = (page: Page) => stage(page).locator(".ve-readout");
const showFrame = (page: Page, name: "computador" | "tablet" | "celular") => editor(page).getByRole("button", { name: `Mostrar o quadro do ${name}` });
const zoomValue = async (page: Page) => Number.parseInt((await editor(page).getByRole("button", { name: /^Zoom: voltar a 100%/ }).innerText()).replace("%", ""), 10) / 100;
const frameOf = (page: Page) => frame(page, "desktop");
const field = (page: Page, label: string) => inspector(page).getByLabel(label, { exact: true });
const css = (target: Locator, property: string) => target.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
const px = async (target: Locator, property: string) => Number.parseFloat(await css(target, property));

/** Drags a handle by (dx, dy) screen pixels from its center, in small steps, holding the keys given. */
async function drag(page: Page, target: Locator, dx: number, dy: number, keys: string[] = []) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (const key of keys) await page.keyboard.down(key);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(x + (dx * step) / 6, y + (dy * step) / 6);
  await page.mouse.up();
  for (const key of keys) await page.keyboard.up(key);
}

test("handles over the selected block: size with guides, padding with Shift and Alt, the gap between children, the rounding, one step of history for a drag, Escape to give it up, and a size of the screen of its own", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The handles are for a pointer on a wide window: the phone has the style panel.");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startEditor(page, "Marina Alças");

  // Two columns in a row: the row has a gap, and so there is a gap to take hold of.
  await addAtEnd(page, "2 colunas");
  await selectLayer(page, /^2 colunas/);
  await expect(handle(page, "resize-e")).toBeVisible();
  const scale = await zoomValue(page);
  expect(scale).toBeGreaterThan(0.2);
  expect(scale).toBeLessThanOrEqual(1);
  const near = (value: number, expected: number, slack = 2) => expect(Math.abs(value - expected), `${value} is not near ${expected}`).toBeLessThanOrEqual(slack);

  // ---- the gap between the columns: the row's own style, in the panel too ----
  expect(await px(row(page), "column-gap")).toBe(16);
  await expect(gapHandle(page)).toBeVisible();
  await drag(page, gapHandle(page), 20, 0);
  const gap = await px(row(page), "column-gap");
  near(gap, 16 + 20 / scale);
  await panel(page, "Propriedades");
  await styleTab(page).click();
  await inspector(page).getByRole("button", { name: "Estilo do computador" }).click();
  await expect(field(page, "Espaço entre os blocos")).toHaveValue(String(Math.round(gap)));
  // The whole drag is one step: one undo puts the gap back.
  await editor(page).getByRole("button", { name: "Desfazer" }).click();
  expect(await px(row(page), "column-gap")).toBe(16);
  await editor(page).getByRole("button", { name: "Refazer" }).click();
  near(await px(row(page), "column-gap"), gap, 0);
  // Escape gives a drag up: the gap is back to what it was when the drag began.
  const box = (await gapHandle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
  await expect.poll(() => px(row(page), "column-gap")).toBeGreaterThan(gap + 5);
  await expect(readout(page)).toContainText("Espaço entre os blocos");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  near(await px(row(page), "column-gap"), gap, 0);
  await expect(readout(page)).toHaveCount(0);

  // ---- a block too small for the inner handles keeps the ones on its edges: the empty row is low, so it is made taller from the bottom handle ----
  await expect(handle(page, "padding-top")).toBeHidden();
  await expect(handle(page, "radius")).toBeHidden();
  await drag(page, handle(page, "resize-s"), 0, 160);
  await expect(handle(page, "padding-top")).toBeVisible();
  await expect(handle(page, "radius")).toBeVisible();

  // A drag with a long pause in the middle is still one step: one undo takes back the whole of it.
  const calm = await px(row(page), "padding-top");
  const grab = (await handle(page, "padding-top").boundingBox())!;
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2 + 10, { steps: 3 });
  await page.waitForTimeout(1500);
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2 + 30, { steps: 3 });
  await page.mouse.up();
  expect(await px(row(page), "padding-top")).toBeGreaterThan(calm + 5);
  await editor(page).getByRole("button", { name: "Desfazer" }).click();
  expect(await px(row(page), "padding-top")).toBe(calm);

  // ---- the padding: one side, the side across with Alt, all four with Shift ----
  await drag(page, handle(page, "padding-top"), 0, 24);
  const top = await px(row(page), "padding-top");
  near(top, 24 / scale);
  expect(await px(row(page), "padding-bottom")).toBe(0);
  await drag(page, handle(page, "padding-left"), 18, 0, ["Alt"]);
  const side = await px(row(page), "padding-left");
  near(side, 18 / scale);
  near(await px(row(page), "padding-right"), side, 0);
  expect(await px(row(page), "padding-bottom")).toBe(0);
  await drag(page, handle(page, "padding-bottom"), 0, -12, ["Shift"]);
  const all = await px(row(page), "padding-bottom");
  near(all, 12 / scale);
  for (const edge of ["top", "right", "left"]) near(await px(row(page), `padding-${edge}`), all, 0);
  await expect(field(page, "Margem interna · cima")).toHaveValue(String(Math.round(all)));

  // ---- the rounding, in the panel too ----
  await drag(page, handle(page, "radius"), 16, 16);
  const radius = await px(row(page), "border-top-left-radius");
  near(radius, 16 / scale);
  await expect(field(page, "Arredondamento")).toHaveValue(String(Math.round(radius)));

  // ---- the size: free, then snapped to the line of the container (and Alt turns the snapping off) ----
  const before = (await row(page).boundingBox())!;
  const startWidth = await px(row(page), "width");
  await drag(page, handle(page, "resize-e"), -80, 0);
  const narrower = await px(row(page), "width");
  near(narrower, startWidth - 80 / scale, 3);
  await expect(field(page, "Largura")).toHaveValue(String(Math.round(narrower)));
  // Back out to a few pixels short of the container's edge: the right edge snaps to it and a guide shows, and the width is exactly the container's.
  const reachRight = (startWidth - narrower) * scale - 3;
  await drag(page, handle(page, "resize-e"), reachRight, 0);
  await expect(guide(page, "x")).toHaveCount(0);
  expect(Math.abs((await px(row(page), "width")) - startWidth)).toBeLessThanOrEqual(1);
  await expect(field(page, "Largura")).toHaveValue(String(Math.round(startWidth)));
  // While a drag is on, the guide is there at the snapped edge and goes when it ends.
  const east = (await handle(page, "resize-e").boundingBox())!;
  await page.mouse.move(east.x + east.width / 2, east.y + east.height / 2);
  await page.mouse.down();
  await page.mouse.move(east.x + east.width / 2 - 60, east.y + east.height / 2, { steps: 5 });
  await expect(guide(page, "x")).toHaveCount(0);
  await page.mouse.move(east.x + east.width / 2 - 2, east.y + east.height / 2, { steps: 5 });
  await expect(guide(page, "x")).toHaveCount(1);
  await expect(readout(page)).toContainText("Largura");
  await page.mouse.up();
  await expect(guide(page, "x")).toHaveCount(0);
  await expect(readout(page)).toHaveCount(0);
  const snapped = await px(row(page), "width");
  // With Alt the same few pixels short are not snapped.
  await drag(page, handle(page, "resize-e"), -4, 0, ["Alt"]);
  expect(await px(row(page), "width")).toBeLessThan(snapped - 1);
  // The height, from the bottom handle, and both from the corner.
  const startHeight = await px(row(page), "height");
  await drag(page, handle(page, "resize-s"), 0, 50);
  near(await px(row(page), "height"), startHeight + 50 / scale, 3);
  await expect(field(page, "Altura")).toHaveValue(String(Math.round(await px(row(page), "height"))));
  await drag(page, handle(page, "resize-se"), -30, 20);
  await expect(field(page, "Altura")).toHaveValue(String(Math.round(await px(row(page), "height"))));
  void before;

  // ---- a size of the screen of its own: the tablet's frame is edited, only the tablet changes ----
  await showFrame(page, "tablet").click();
  await expect(frame(page, "tablet")).toBeVisible();
  await selectLayer(page, /^2 colunas/);
  await expect(handle(page, "padding-top")).toBeVisible();
  const desktopTop = await px(row(page, "desktop"), "padding-top");
  const tabletScale = await zoomValue(page);
  await drag(page, handle(page, "padding-top"), 0, 30, ["Shift"]);
  expect(await px(row(page, "desktop"), "padding-top")).toBe(desktopTop);
  near(await px(row(page, "tablet"), "padding-top"), desktopTop + 30 / tabletScale, 3);
  await panel(page, "Propriedades");
  await inspector(page).getByRole("button", { name: "Estilo do tablet" }).click();
  await expect(inspector(page).getByLabel("Margem interna · cima", { exact: true })).toHaveValue(String(Math.round(await px(row(page, "tablet"), "padding-top"))));
});

test("the handles are for a pointer on a wide window: none on a block that is not selected, none in the preview, and a small block keeps only the ones on its edges", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has the style panel.");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startEditor(page, "Marina Alças 2");
  await addAtEnd(page, "Parágrafo");
  // Nothing selected: no handles. Selecting the page settings (no block) shows none either.
  await selectLayer(page, "Configurações da página");
  await expect(stage(page).locator("[data-handle]")).toHaveCount(0);
  await selectLayer(page, /^Parágrafo/);
  await expect(handle(page, "resize-e")).toBeVisible();
  // A paragraph holds no children: no gap handle.
  await expect(stage(page).locator('[data-handle^="gap-"]')).toHaveCount(0);
  // The preview is only a view.
  await editor(page).getByRole("button", { name: "Prévia", exact: true }).click();
  await expect(stage(page).locator("[data-handle]")).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Voltar a editar" }).click();
  await expect(stage(page).locator("[data-handle]").first()).toBeAttached();
});

test("the gap of a column is taken by a bar between its children, dragged up and down", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The handles are for a pointer on a wide window.");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startEditor(page, "Marina Alças 3");
  // A stack (a column with a gap of 12) holding two paragraphs that have some text, so that they take room.
  await addAtEnd(page, "Pilha");
  await selectLayer(page, /^Pilha/);
  await addSelected(page, "Parágrafo");
  await selectLayer(page, /^Pilha/);
  await addSelected(page, "Parágrafo");
  for (const at of [0, 1]) {
    await selectLayer(page, /^Parágrafo/, at);
    await panel(page, "Propriedades");
    await inspector(page).getByLabel("Parágrafo", { exact: true }).fill(`Linha número ${at + 1}, com texto para ocupar lugar`);
  }
  await selectLayer(page, /^Pilha/);
  const stack = frameOf(page).locator('.site-main > [data-type="box"]').first();
  const scale = await zoomValue(page);
  expect(await px(stack, "row-gap")).toBe(12);
  await expect(gapHandle(page)).toBeVisible();
  await expect(gapHandle(page)).toHaveAttribute("data-axis", "y");
  await drag(page, gapHandle(page), 0, 15);
  expect(Math.abs((await px(stack, "row-gap")) - (12 + 15 / scale))).toBeLessThanOrEqual(2);
  await drag(page, gapHandle(page), 0, -400);
  expect(await px(stack, "row-gap")).toBe(0);
  await panel(page, "Propriedades");
  await styleTab(page).click();
  await expect(inspector(page).getByLabel("Espaço entre os blocos", { exact: true })).toHaveValue("0");
});
