import { test, expect, type Page } from "@playwright/test";
import { newActor } from "./helpers";
import { addAtEnd, editor, inspector, library, panel, selectLayer, stage, startEditor as startSite, styleTab } from "./site-helpers";

const startEditor = (page: Page) => startSite(page, "Marina Telas");

type Size = "desktop" | "tablet" | "mobile";
const frame = (page: Page, size: Size) => stage(page).locator(`[data-frame="${size}"]`);
const rowIn = (page: Page, size: Size) => frame(page, size).locator('.site-main > [data-type="box"]').first();
const noteIn = (page: Page, size: Size) => frame(page, size).locator('.site-main > [data-type="paragraph"]');
const showFrame = (page: Page, name: "computador" | "tablet" | "celular") => editor(page).getByRole("button", { name: `Mostrar o quadro do ${name}` });
const screenButton = (page: Page, name: "computador" | "tablet" | "celular") => inspector(page).getByRole("button", { name: `Estilo do ${name}` });
const zoom = (page: Page) => editor(page).getByRole("button", { name: /^Zoom: voltar a 100%/ });
const percent = async (page: Page) => Number.parseInt((await zoom(page).innerText()).replace("%", ""), 10);
const gapField = (page: Page) => inspector(page).getByLabel("Espaço entre os blocos", { exact: true });
/** The gap field when its value comes from a larger size of the screen (shown in grey). */
const inheritedGap = (page: Page) => inspector(page).locator('.ve-length[data-inherited] input[aria-label="Espaço entre os blocos"]');

test("sizes of the screen: three frames side by side, each change written to one size and laid over the larger ones, hiding by size, and a published page that answers to the window", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below: one frame at a time, no zoom.");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await startEditor(page);

  // What the published page needs, and two blocks: a row, and a note that is only for the computer.
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("WhatsApp", { exact: true }).fill("(11) 91234-5678");
  await addAtEnd(page, "Linha");
  await panel(page, "Propriedades");
  await styleTab(page).click();
  await screenButton(page, "computador").click();
  await gapField(page).fill("32");
  await addAtEnd(page, "Parágrafo");
  await panel(page, "Propriedades");
  await inspector(page).getByRole("button", { name: "Conteúdo", exact: true }).click();
  await inspector(page).getByLabel("Parágrafo", { exact: true }).fill("Só aparece no computador");

  // Only the computer's frame at first; the others are shown with the buttons over the canvas, and each shown one becomes the one being edited.
  await expect(stage(page).locator("[data-frame]")).toHaveCount(1);
  await expect(frame(page, "desktop")).toBeVisible();
  await expect(showFrame(page, "computador")).toHaveAttribute("aria-pressed", "true");
  await expect(showFrame(page, "tablet")).toHaveAttribute("aria-pressed", "false");
  await showFrame(page, "tablet").click();
  await showFrame(page, "celular").click();
  await expect(stage(page).locator("[data-frame]")).toHaveCount(3);
  await expect(frame(page, "mobile").getByRole("button", { name: /^Celular/ })).toHaveAttribute("aria-pressed", "true");
  await expect(frame(page, "desktop").getByRole("button", { name: /^Computador/ })).toHaveAttribute("aria-pressed", "false");
  // All three draw the one document, so the row has the computer's gap in each of them.
  for (const size of ["desktop", "tablet", "mobile"] as const) await expect(rowIn(page, size)).toHaveCSS("gap", "32px");
  // The frames are as wide as their sizes (the canvas draws them smaller, by the same factor).
  const widths = await Promise.all((["desktop", "tablet", "mobile"] as const).map(async (size) => (await frame(page, size).boundingBox())!.width));
  expect(widths[0] / widths[1]).toBeCloseTo(1400 / 800, 1);
  expect(widths[0] / widths[2]).toBeCloseTo(1400 / 420, 1);

  // The tablet: the panel shows what the row has there (the computer's gap, in grey), and a change is the tablet's alone, and the phone's too until it says otherwise.
  await selectLayer(page, /^Linha/);
  await styleTab(page).click();
  await screenButton(page, "tablet").click();
  await expect(screenButton(page, "tablet")).toHaveAttribute("aria-pressed", "true");
  await expect(gapField(page)).toHaveValue("32");
  await expect(inheritedGap(page)).toHaveCount(1);
  await expect(inspector(page).getByRole("button", { name: "Espaço entre os blocos: voltar ao padrão" })).toHaveCount(0);
  await gapField(page).fill("16");
  await expect(inheritedGap(page)).toHaveCount(0);
  await expect(rowIn(page, "desktop")).toHaveCSS("gap", "32px");
  await expect(rowIn(page, "tablet")).toHaveCSS("gap", "16px");
  await expect(rowIn(page, "mobile")).toHaveCSS("gap", "16px");
  await expect(screenButton(page, "tablet").locator(".ve-dot")).toBeVisible();
  await expect(screenButton(page, "celular").locator(".ve-dot")).toHaveCount(0);

  // The phone: it starts from the tablet's value, and its own change does not reach the others.
  await screenButton(page, "celular").click();
  await expect(gapField(page)).toHaveValue("16");
  await expect(inheritedGap(page)).toHaveCount(1);
  await gapField(page).fill("8");
  await expect(rowIn(page, "mobile")).toHaveCSS("gap", "8px");
  await expect(rowIn(page, "tablet")).toHaveCSS("gap", "16px");
  await expect(rowIn(page, "desktop")).toHaveCSS("gap", "32px");

  // Taking the tablet's changes back leaves the phone's own, and the tablet goes back to the computer's.
  await screenButton(page, "tablet").click();
  await inspector(page).getByRole("button", { name: "Voltar o tablet ao que vem do tamanho de cima" }).click();
  await expect(rowIn(page, "tablet")).toHaveCSS("gap", "32px");
  await expect(rowIn(page, "mobile")).toHaveCSS("gap", "8px");
  await expect(inspector(page).getByRole("button", { name: "Voltar o tablet ao que vem do tamanho de cima" })).toBeDisabled();
  await gapField(page).fill("16");
  await expect(rowIn(page, "tablet")).toHaveCSS("gap", "16px");

  // Hiding: at the tablet, which the phone follows; the phone says it is shown; the eye of the layers does the same as the box of the panel.
  await selectLayer(page, /^Parágrafo/);
  await styleTab(page).click();
  await screenButton(page, "tablet").click();
  await expect(noteIn(page, "desktop")).toBeVisible();
  await expect(noteIn(page, "tablet")).toBeVisible();
  await expect(noteIn(page, "mobile")).toBeVisible();
  await inspector(page).getByLabel("Ocultar no tablet").check();
  await expect(noteIn(page, "desktop")).toBeVisible();
  await expect(noteIn(page, "tablet")).toBeHidden();
  await expect(noteIn(page, "mobile")).toBeHidden();
  await library(page).getByRole("button", { name: "Camadas", exact: true }).click();
  await expect(library(page).getByRole("button", { name: "Mostrar Parágrafo no tablet" })).toHaveAttribute("aria-pressed", "true");
  await screenButton(page, "celular").click();
  await library(page).getByRole("button", { name: "Mostrar Parágrafo no celular" }).click();
  await expect(noteIn(page, "mobile")).toBeVisible();
  await expect(noteIn(page, "tablet")).toBeHidden();
  await expect(noteIn(page, "desktop")).toBeVisible();
  await library(page).getByRole("button", { name: "Ocultar Parágrafo no celular" }).click();
  await expect(noteIn(page, "mobile")).toBeHidden();
  await expect(inspector(page).getByLabel("Ocultar no celular")).toBeChecked();

  // A click in another frame selects there, and that frame becomes the one being edited.
  await frame(page, "tablet").locator('[data-type="hero"]').click({ position: { x: 24, y: 24 } });
  await expect(stage(page).locator(".ve-select .ve-chip")).toHaveText("Destaque");
  await expect(frame(page, "tablet").getByRole("button", { name: /^Tablet/ })).toHaveAttribute("aria-pressed", "true");
  await expect(screenButton(page, "tablet")).toHaveAttribute("aria-pressed", "true");

  // A block dragged into a frame lands in the document, so it is in every frame.
  await library(page).getByRole("button", { name: "Blocos", exact: true }).click();
  await library(page).getByRole("button", { name: "Acrescentar Título", exact: true }).dragTo(frame(page, "tablet").locator('[data-type="hero"]'), { targetPosition: { x: 40, y: 4 } });
  for (const size of ["desktop", "tablet", "mobile"] as const) await expect(frame(page, size).locator('.site-main > [data-type="heading"]')).toHaveCount(1);
  await selectLayer(page, /^Título/);
  await inspector(page).getByRole("button", { name: "Conteúdo", exact: true }).click();
  await inspector(page).getByLabel("Título", { exact: true }).fill("Tamanhos de tela");

  // The canvas: zoom with the buttons, with Ctrl + wheel, to 100% and back to fitting everything; the wheel, the arrows and the space bar move it.
  const fitted = await percent(page);
  await editor(page).getByRole("button", { name: "Aumentar o zoom" }).click();
  expect(await percent(page)).toBe(fitted + 10);
  await editor(page).getByRole("button", { name: "Diminuir o zoom" }).click();
  expect(await percent(page)).toBe(fitted);
  const canvas = stage(page).locator(".ve-canvas");
  const area = (await canvas.boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect.poll(() => percent(page)).toBeGreaterThan(fitted);
  await editor(page).getByRole("button", { name: "Ajustar à tela" }).click();
  await expect.poll(() => percent(page)).toBe(fitted);
  await page.keyboard.press("Control+0");
  await expect.poll(() => percent(page)).toBe(100);
  await page.keyboard.press("Control+Shift+0");
  await expect.poll(() => percent(page)).toBe(fitted);
  const top = async () => (await frame(page, "desktop").boundingBox())!.y;
  const left = async () => (await frame(page, "desktop").boundingBox())!.x;
  const top0 = await top();
  await page.mouse.wheel(0, 120);
  await expect.poll(top).toBeCloseTo(top0 - 120, 0);
  // With a block selected the arrows are not the canvas's: nothing moves.
  await frame(page, "desktop").locator('[data-type="hero"]').click({ position: { x: 24, y: 24 } });
  await expect(stage(page).locator(".ve-select .ve-chip")).toHaveText("Destaque");
  const kept = await top();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  expect(await top()).toBe(kept);
  await canvas.click({ position: { x: 4, y: 4 } });
  await expect(inspector(page).getByRole("heading", { name: "Página", level: 2 })).toBeVisible();
  const top1 = await top();
  await page.keyboard.press("ArrowDown");
  await expect.poll(top).toBeCloseTo(top1 - 20, 0);
  const [left1, top2] = [await left(), await top()];
  // The space bar turns the pointer into a hand even over a frame (without it, a drag over the page is not a move of the canvas).
  const over = (await frame(page, "desktop").boundingBox())!;
  // A point of the frame that is on the canvas (the frame has been moved up by the steps above).
  const [fromX, fromY] = [over.x + over.width / 2, Math.max(over.y, area.y) + 80];
  expect(fromY).toBeLessThan(over.y + over.height);
  await page.keyboard.down("Space");
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + 80, fromY + 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(left).toBeCloseTo(left1 + 80, 0);
  await expect.poll(top).toBeCloseTo(top2 + 40, 0);
  // Moving the canvas is not a click on the page: nothing was selected.
  await expect(inspector(page).getByRole("heading", { name: "Página", level: 2 })).toBeVisible();

  // Save and publish: the published page answers to the width of the window, with the same rules the frames drew.
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();

  const anonymous = await newActor(browser, baseURL);
  const visitor = anonymous.page;
  await visitor.setViewportSize({ width: 1280, height: 800 });
  await visitor.goto(`./s/${slug}`);
  const publicRow = visitor.locator(".site-main > .site-box").first();
  const publicNote = visitor.getByText("Só aparece no computador");
  await expect(publicRow).toHaveCSS("gap", "32px");
  await expect(publicNote).toBeVisible();
  await visitor.setViewportSize({ width: 800, height: 800 });
  await expect(publicRow).toHaveCSS("gap", "16px");
  await expect(publicNote).toBeHidden();
  await visitor.setViewportSize({ width: 400, height: 800 });
  await expect(publicRow).toHaveCSS("gap", "8px");
  await expect(publicNote).toBeHidden();
  await visitor.setViewportSize({ width: 1280, height: 800 });
  await expect(publicRow).toHaveCSS("gap", "32px");
  await expect(publicNote).toBeVisible();
  const sheet = await (await visitor.request.get(`./s/${slug}/estilo.css`)).text();
  expect(sheet).toContain("@media (max-width:1023px){");
  expect(sheet).toContain("@media (max-width:576px){");
  expect(sheet).not.toContain("@container");
  await anonymous.context.close();
});

test("on a phone the canvas is a scrolling area with the phone's frame, and a change of style is the phone's", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(150_000);
  await startEditor(page);

  // One frame, the phone's, at its own width, and no zoom: the window is the canvas.
  await panel(page, "Página");
  await expect(stage(page).locator("[data-frame]")).toHaveCount(1);
  await expect(frame(page, "mobile")).toBeVisible();
  await expect(editor(page).getByRole("group", { name: "Zoom" })).toHaveCount(0);
  await expect(showFrame(page, "celular")).toHaveAttribute("aria-pressed", "true");

  // A style written here is the phone's.
  await addAtEnd(page, "Linha");
  await panel(page, "Propriedades");
  await styleTab(page).click();
  await expect(screenButton(page, "celular")).toHaveAttribute("aria-pressed", "true");
  await gapField(page).fill("8");
  await panel(page, "Página");
  await expect(rowIn(page, "mobile")).toHaveCSS("gap", "8px");

  // Showing the computer's frame draws the same page there, without the phone's change.
  await showFrame(page, "computador").click();
  await expect(stage(page).locator("[data-frame]")).toHaveCount(2);
  await expect(rowIn(page, "desktop")).toHaveCSS("gap", "16px");
  await expect(rowIn(page, "mobile")).toHaveCSS("gap", "8px");
  await panel(page, "Propriedades");
  await screenButton(page, "computador").click();
  await expect(gapField(page)).toHaveValue("16");
  await expect(inheritedGap(page)).toHaveCount(0);
});
