import { test, expect, type Page } from "@playwright/test";
import { localIP, newActor } from "./helpers";
import { brandPalette, parseHex } from "../../src/modules/meu-site/brand-color";
import { closeEditor, editor, inspector, openEditor, panel, selectLayer, stage, startEditor as startSite } from "./site-helpers";

const startEditor = (page: Page) => startSite(page, "Marina Tema");
const frame = (page: Page) => stage(page).locator('[data-frame="desktop"]');
const css = ([r, g, b]: readonly number[]) => `rgb(${r}, ${g}, ${b})`;
const settings = async (page: Page) => {
  await selectLayer(page, "Configurações da página");
  await panel(page, "Propriedades");
};
const save = async (page: Page) => {
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
};

test("theme: a font for the whole page, a brand color made readable, the automatic mode that follows the visitor's device, and the choice of not being listed by search engines", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The settings of the page are the same on a phone; the scenario is for the wide window.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await startEditor(page);
  await settings(page);
  await inspector(page).getByLabel("WhatsApp", { exact: true }).fill("(11) 91234-5678");

  const button = frame(page).locator(".site-cta .button.primary");
  const root = frame(page).locator(".site");
  // The blue of the page's own palette, light.
  await expect(button).toHaveCSS("background-color", "rgb(0, 119, 182)");
  await expect(root).not.toHaveAttribute("data-site-font", /.*/);

  // ---- a font for the whole page: the system's own serif, and back to the page's own ----
  await inspector(page).getByRole("radio", { name: "Com serifa" }).check();
  await expect(root).toHaveAttribute("data-site-font", "serif");
  await expect(root).toHaveCSS("font-family", /Georgia/);
  await inspector(page).getByRole("radio", { name: "Monoespaçada" }).check();
  await expect(root).toHaveCSS("font-family", /monospace/);
  await inspector(page).getByRole("radio", { name: "Padrão da página" }).check();
  await expect(root).not.toHaveAttribute("data-site-font", /.*/);
  await expect(root).not.toHaveCSS("font-family", /Georgia|monospace/);
  await inspector(page).getByRole("radio", { name: "Com serifa" }).check();

  // ---- the color of the brand: the palette is made from it and moved only as far as the text needs ----
  await inspector(page).getByRole("radio", { name: "Minha cor" }).check();
  await expect(root).toHaveAttribute("data-site-accent", "custom");
  const light = brandPalette("#0077b6", "light");
  await expect(button).toHaveCSS("background-color", css(parseHex(light.solid)));
  await inspector(page).getByLabel("Cor da sua marca").fill("#ffd700");
  const yellow = brandPalette("#ffd700", "light");
  expect(yellow.solid).not.toBe("#ffd700");
  await expect(button).toHaveCSS("background-color", css(parseHex(yellow.solid)));
  await expect(button).toHaveCSS("color", css(parseHex(yellow.on)));
  await expect(inspector(page).getByText("A cor é ajustada só o quanto for preciso")).toContainText(yellow.solid);
  await inspector(page).getByLabel("Cor da sua marca").fill("#aa3355");
  const brand = { light: brandPalette("#aa3355", "light"), dark: brandPalette("#aa3355", "dark") };
  await expect(button).toHaveCSS("background-color", css(parseHex(brand.light.solid)));
  // A color of the list takes the place of the brand color, and the input goes away.
  await inspector(page).getByRole("radio", { name: "Verde" }).check();
  await expect(root).toHaveAttribute("data-site-accent", "green");
  await expect(inspector(page).getByLabel("Cor da sua marca")).toHaveCount(0);
  await inspector(page).getByRole("radio", { name: "Minha cor" }).check();
  await inspector(page).getByLabel("Cor da sua marca").fill("#aa3355");
  await expect(button).toHaveCSS("background-color", css(parseHex(brand.light.solid)));

  // ---- the automatic mode, and not being listed ----
  await inspector(page).getByRole("radio", { name: /^Automático/ }).check();
  await expect(root).toHaveAttribute("data-site-mode", "auto");
  await inspector(page).getByRole("checkbox", { name: "Aparecer nos buscadores (Google e outros)" }).uncheck();
  await save(page);
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar", { exact: false })).toBeVisible();
  await closeEditor(page);

  // ---- the published page: the same attributes, the brand's rules in the sheet, light for a light device and dark for a dark one ----
  const visit = async (colorScheme: "light" | "dark") => {
    const context = await browser.newContext({ baseURL, colorScheme, extraHTTPHeaders: { "cf-connecting-ip": localIP() } });
    const visitor = await context.newPage();
    await visitor.goto(`./s/${slug}`);
    return { context, visitor };
  };
  const day = await visit("light");
  const dayRoot = day.visitor.locator(".site");
  await expect(dayRoot).toHaveAttribute("data-site-accent", "custom");
  await expect(dayRoot).toHaveAttribute("data-site-mode", "auto");
  await expect(dayRoot).toHaveAttribute("data-site-font", "serif");
  await expect(dayRoot).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(day.visitor.locator(".site-cta .button.primary")).toHaveCSS("background-color", css(parseHex(brand.light.solid)));
  await expect(day.visitor.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  const sheet = await (await day.visitor.request.get(`./s/${slug}/estilo.css`)).text();
  expect(sheet).toContain('[data-site-accent="custom"]');
  expect(sheet).toContain(`--site-solid:${brand.light.solid}`);
  expect(sheet).toContain(`--site-solid:${brand.dark.solid}`);
  await day.context.close();

  const night = await visit("dark");
  await expect(night.visitor.locator(".site")).toHaveCSS("background-color", "rgb(15, 23, 32)");
  await expect(night.visitor.locator(".site-cta .button.primary")).toHaveCSS("background-color", css(parseHex(brand.dark.solid)));
  await night.context.close();

  // ---- listed again: the robots tag is the page's own, as it was ----
  await openEditor(page);
  await settings(page);
  await inspector(page).getByRole("checkbox", { name: "Aparecer nos buscadores (Google e outros)" }).check();
  await save(page);
  await editor(page).getByRole("button", { name: "Publicar nova versão", exact: true }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 2.")).toBeVisible();
  const again = await newActor(browser, baseURL);
  await again.page.goto(`./s/${slug}`);
  await expect(again.page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await again.context.close();
});
