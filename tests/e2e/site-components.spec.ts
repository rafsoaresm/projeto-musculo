import { test, expect, type Page } from "@playwright/test";
import { newActor } from "./helpers";
import { addAtEnd, editor, inspector, library, panel, selectLayer, stage, startEditor as startSite } from "./site-helpers";

const startEditor = (page: Page) => startSite(page, "Marina Componentes");

const frame = (page: Page) => stage(page).locator('[data-frame="desktop"]');
const instances = (page: Page) => frame(page).locator(".site-component");
const group = (page: Page) => library(page).getByRole("region", { name: "Componentes" });
const banner = (page: Page) => editor(page).locator(".ve-component-banner");

/** The layer list, on its tab (a list on a phone's panel too). */
async function layers(page: Page) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Camadas", exact: true }).click();
  return library(page).getByRole("list", { name: "Blocos da página" });
}
/** The first layer with this name (a name that is not the start of a longer one: "Plano" is not "Planos"). */
const layer = async (page: Page, name: RegExp) => (await layers(page)).locator(".ve-layer").filter({ hasText: name }).first();
/** The library's own tab, where the blocks (and the components) are. */
async function openBlocks(page: Page) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Blocos", exact: true }).click();
}
const save = async (page: Page) => {
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
};
/** A text field of the panel by its name (not by the text of its label: a field that already has a text would not match that). */
const field = (page: Page, label: string) => inspector(page).getByRole("textbox", { name: label, exact: true });

test("components: made from a card, used again, changed by one instance, edited once for all of them, taken back to plain blocks and deleted, and published as plain page", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await startEditor(page);
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");

  // ---- a card to start from: the first of the three of the "Planos" template, with its title and text written ----
  await addAtEnd(page, "Planos");
  await (await layer(page, /^Plano(?!s)/)).click();
  await (await layer(page, /^Título/)).click();
  await panel(page, "Propriedades");
  await field(page, "Título").fill("Plano mensal");
  await (await layer(page, /^Parágrafo/)).click();
  await panel(page, "Propriedades");
  await field(page, "Parágrafo").fill("Treino 3 vezes por semana");
  await openBlocks(page);
  await expect(group(page)).toContainText("Selecione blocos na página");

  // ---- a component made of the card: the layers show an instance where the card was, and the library lists the component ----
  await (await layer(page, /^Plano(?!s)/)).click({ button: "right" });
  await editor(page).getByRole("menuitem", { name: "Criar componente", exact: true }).click();
  await expect(editor(page).getByText("Componente “Plano” criado", { exact: false })).toBeVisible();
  await expect(instances(page)).toHaveCount(1);
  await expect(instances(page).first().locator("article h3")).toHaveText("Plano mensal");
  await expect(stage(page).locator(".ve-chip")).toHaveText("Plano");
  await openBlocks(page);
  await expect(group(page).getByRole("button", { name: "Acrescentar o componente Plano" })).toBeVisible();

  // ---- used again, from the library, in the same grid ----
  await group(page).getByRole("button", { name: "Acrescentar o componente Plano" }).click();
  await group(page).getByRole("button", { name: "Acrescentar o componente Plano" }).click();
  await expect(instances(page)).toHaveCount(3);
  for (let at = 0; at < 3; at++) await expect(instances(page).nth(at).locator("article h3")).toHaveText("Plano mensal");
  await expect(instances(page).nth(1).locator("article > p")).toHaveText("Treino 3 vezes por semana");
  // The three of them are in the grid, next to the other two cards of the template.
  await expect(frame(page).locator(".site-main > section:has(.site-component) > *")).toHaveCount(5);

  // ---- one instance changes its title and its button's contact; the others do not ----
  await instances(page).nth(1).click({ position: { x: 4, y: 4 } });
  await panel(page, "Propriedades");
  await expect(inspector(page).getByRole("status").first()).toContainText("Este bloco é o componente “Plano”, usado em 3 lugares");
  await field(page, "Título").fill("Plano trimestral");
  await expect(instances(page).nth(1).locator("article h3")).toHaveText("Plano trimestral");
  await expect(instances(page).nth(0).locator("article h3")).toHaveText("Plano mensal");
  await expect(instances(page).nth(2).locator("article h3")).toHaveText("Plano mensal");
  await inspector(page).getByRole("button", { name: "Voltar ao do componente (Título)" }).click();
  await expect(instances(page).nth(1).locator("article h3")).toHaveText("Plano mensal");
  await field(page, "Título").fill("Plano trimestral");

  // ---- the component itself: going into it draws it alone, and a change reaches every instance (the one with its own title keeps it) ----
  await inspector(page).getByRole("button", { name: "Editar o componente" }).click();
  await expect(banner(page)).toContainText("Editando o componente Plano");
  await expect(frame(page).locator(".site-header")).toHaveCount(0);
  await expect(frame(page).locator(".site-component")).toHaveCount(0);
  await expect(frame(page).locator("article")).toHaveCount(1);
  // Nothing of the page can be reached from here, and a component cannot hold another one.
  await openBlocks(page);
  await expect(group(page)).toContainText("Você está editando o componente “Plano”");
  await expect(group(page).getByRole("button", { name: /Acrescentar o componente/ })).toHaveCount(0);
  await (await layer(page, /^Parágrafo/)).click();
  await panel(page, "Propriedades");
  await field(page, "Parágrafo").fill("Treino 4 vezes por semana");
  await expect(frame(page).locator("article > p")).toHaveText("Treino 4 vezes por semana");
  // The preview, from inside the component, is of the whole page: the three instances, already with the new text.
  await editor(page).getByRole("button", { name: "Prévia" }).click();
  await expect(frame(page).locator(".site-component")).toHaveCount(3);
  await expect(frame(page).locator(".site-component article > p")).toHaveText(["Treino 4 vezes por semana", "Treino 4 vezes por semana", "Treino 4 vezes por semana"]);
  await editor(page).getByRole("button", { name: "Voltar a editar" }).click();
  await expect(banner(page)).toContainText("Editando o componente Plano");
  await editor(page).getByRole("button", { name: "Concluir edição" }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect(instances(page)).toHaveCount(3);
  for (let at = 0; at < 3; at++) await expect(instances(page).nth(at).locator("article > p")).toHaveText("Treino 4 vezes por semana");
  await expect(instances(page).nth(1).locator("article h3")).toHaveText("Plano trimestral");
  // Closing the component goes back to the instance it was opened from.
  await expect(stage(page).locator(".ve-chip")).toHaveText("Plano");

  // ---- the preview draws the whole page, with the components, and no marks of the editor ----
  await editor(page).getByRole("button", { name: "Prévia" }).click();
  await expect(frame(page).locator(".site-component")).toHaveCount(3);
  await expect(frame(page).locator("[data-block-id]")).toHaveCount(0);
  await expect(frame(page).locator(".site-component article h3")).toHaveText(["Plano mensal", "Plano trimestral", "Plano mensal"]);
  await editor(page).getByRole("button", { name: "Voltar a editar" }).click();

  // ---- the same text of the instance, typed on the page itself ----
  const title = instances(page).nth(0).locator("article h3 .site-editable");
  await title.dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" anual");
  await page.keyboard.press("Enter");
  await expect(instances(page).nth(0).locator("article h3")).toHaveText("Plano mensal anual");
  await expect(instances(page).nth(2).locator("article h3")).toHaveText("Plano mensal");
  // What is inside the component and is not the instance's to change cannot be typed over from the page: the layout is the component's.
  await expect(instances(page).nth(0).locator("article")).not.toHaveAttribute("data-block-id", /./);

  // ---- published: the page is plain markup, with the instances drawn and nothing of the editor ----
  await save(page);
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await editor(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar", { exact: false })).toBeVisible();
  const anonymous = await newActor(browser, baseURL);
  const visitor = anonymous.page;
  await visitor.goto(`./s/${slug}`);
  await expect(visitor.locator(".site-component")).toHaveCount(3);
  await expect(visitor.locator(".site-component article h3")).toHaveText(["Plano mensal anual", "Plano trimestral", "Plano mensal"]);
  await expect(visitor.locator(".site-component article > p")).toHaveText(["Treino 4 vezes por semana", "Treino 4 vezes por semana", "Treino 4 vezes por semana"]);
  await expect(visitor.locator(".site-component a")).toHaveCount(3);
  await expect(visitor.locator("[data-block-id]")).toHaveCount(0);
  const sheet = await (await visitor.request.get(`./s/${slug}/estilo.css`)).text();
  expect(sheet).toContain("border-radius:16px");

  // ---- a copy of the component: plain blocks that do not follow it ----
  await openBlocks(page);
  await group(page).getByRole("button", { name: "Acrescentar uma cópia de Plano" }).click();
  await expect(instances(page)).toHaveCount(3);
  await expect(frame(page).locator("article")).toHaveCount(6);
  await save(page);

  // ---- taking an instance back to plain blocks: the card is there as before, and it no longer follows the component ----
  await instances(page).nth(0).click({ position: { x: 4, y: 4 } });
  await panel(page, "Propriedades");
  await inspector(page).getByRole("button", { name: /Desvincular/ }).click();
  await expect(instances(page)).toHaveCount(2);
  await expect(frame(page).locator("article")).toHaveCount(6);
  await expect(frame(page).locator("article h3").first()).toHaveText("Plano mensal anual");

  // ---- deleting the component: the instances that are left become plain blocks, nothing is lost ----
  await openBlocks(page);
  await group(page).getByRole("button", { name: "Excluir o componente Plano" }).click();
  await expect(instances(page)).toHaveCount(0);
  await expect(frame(page).locator("article")).toHaveCount(6);
  await expect(frame(page).locator("article h3").nth(2)).toHaveText("Plano trimestral");
  await expect(frame(page).locator("article h3").nth(3)).toHaveText("Plano mensal");
  await expect(group(page)).toContainText("Selecione blocos na página");
  await expect(editor(page).getByText("Componente excluído", { exact: false })).toBeVisible();

  // ---- one undo brings the component and its instances back ----
  await editor(page).getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(instances(page)).toHaveCount(2);
  await expect(group(page).getByRole("button", { name: "Acrescentar o componente Plano" })).toBeVisible();
  await anonymous.context.close();
});

test("on a phone a component is made from the panel of a block and used again from the list of blocks", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(180_000);
  await startEditor(page);

  await addAtEnd(page, "Planos");
  await (await layer(page, /^Plano(?!s)/)).click();
  await panel(page, "Propriedades");
  await inspector(page).getByRole("button", { name: "Criar componente" }).click();
  await panel(page, "Página");
  await expect(stage(page).locator('[data-frame="mobile"] .site-component')).toHaveCount(1);
  await openBlocks(page);
  await library(page).getByRole("button", { name: "Acrescentar o componente Plano" }).click();
  await panel(page, "Página");
  await expect(stage(page).locator('[data-frame="mobile"] .site-component')).toHaveCount(2);
  await selectLayer(page, /^Plano(?!s)/, 0);
  await expect(inspector(page).getByRole("button", { name: "Editar o componente" })).toBeVisible();
});
