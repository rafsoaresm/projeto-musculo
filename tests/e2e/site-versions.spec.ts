import { test, expect, type Page } from "@playwright/test";
import { newActor } from "./helpers";
import { addAtEnd, closeEditor, editor, inspector, library, openEditor, panel, selectLayer, startEditor as startSite } from "./site-helpers";

const startEditor = (page: Page) => startSite(page, "Marina Versões");
const field = (page: Page, label: string) => inspector(page).getByRole("textbox", { name: label, exact: true });
const versions = (page: Page) => page.getByRole("list", { name: "Versões publicadas" });
const frame = (page: Page) => page.locator(".site-preview");
const marked = (page: Page, how: "added" | "changed") => frame(page).locator(`[data-diff="${how}"]`);
const save = async (page: Page) => {
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
};
const publish = async (page: Page, number: number) => {
  await editor(page).getByRole("button", { name: /^Publicar( nova versão)?$/ }).click();
  await expect(editor(page).getByText(`Publicado: o site está no ar na versão ${number}.`)).toBeVisible();
};
async function openPages(page: Page) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Páginas", exact: true }).click();
}
const pageNames = async (page: Page) => {
  await openPages(page);
  return library(page).getByRole("list", { name: "Páginas do site" }).locator(".ve-layer strong").allInnerTexts();
};

test("versions: each one can be seen as it was published, compared with another (or with the draft) with the blocks marked on the page, and brought back as the draft with its pages", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The versions are on the screen of the site, the same on a phone.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await startEditor(page);
  void slug;

  // ---- version 1: the starter page, with the contact its button goes to ----
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");
  const oldTitle = await field(page, "Título do site").inputValue();
  await save(page);
  await publish(page, 1);

  // ---- version 2: another title, a new paragraph and a new page ----
  await field(page, "Título do site").fill("Marina Personal");
  await addAtEnd(page, "Parágrafo");
  await panel(page, "Propriedades");
  await field(page, "Parágrafo").fill("Atendimento presencial e online");
  await openPages(page);
  await library(page).getByRole("button", { name: "Nova página" }).click();
  await panel(page, "Propriedades");
  await inspector(page).getByRole("textbox", { name: "Título da página", exact: true }).fill("Sobre mim");
  await addAtEnd(page, "Parágrafo");
  await panel(page, "Propriedades");
  await field(page, "Parágrafo").fill("Formada há dez anos");
  await save(page);
  await publish(page, 2);
  await closeEditor(page);

  // ---- the list of versions: what can be done with each one ----
  await expect(versions(page).getByRole("listitem")).toHaveCount(2);
  await expect(versions(page).getByRole("link", { name: "Ver a versão 1" })).toBeVisible();
  await expect(versions(page).getByRole("link", { name: "Ver a versão 2" })).toBeVisible();
  await expect(versions(page).getByRole("link", { name: "O que mudou na versão 2 desde a 1" })).toBeVisible();
  // The first version has none before it to be compared with; only the one that is public has "the draft since".
  await expect(versions(page).getByRole("link", { name: /^O que mudou na versão 1/ })).toHaveCount(0);
  await expect(versions(page).getByRole("link", { name: "O que mudou no rascunho desde a versão 2" })).toBeVisible();
  await expect(versions(page).getByRole("link", { name: "O que mudou no rascunho desde a versão 1" })).toHaveCount(0);

  // ---- a version as it was published: no page of version 2, and not the paragraph that came later ----
  await versions(page).getByRole("link", { name: "Ver a versão 1" }).click();
  await expect(page.getByRole("heading", { name: "Versão 1", level: 1 })).toBeVisible();
  await expect(page.getByText("Esta é a versão 1 como foi publicada")).toBeVisible();
  await expect(frame(page).getByText(oldTitle).first()).toBeVisible();
  await expect(frame(page).getByRole("navigation", { name: "Páginas do site" })).toHaveCount(0);
  await expect(frame(page).getByText("Atendimento presencial e online")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "O que mudou" })).toHaveCount(0);
  await page.getByRole("link", { name: "Voltar às versões" }).click();
  await expect(page.getByRole("heading", { name: "Versões publicadas" })).toBeVisible();

  // ---- what changed from version 1 to version 2: the list, grouped, and the page with the new block marked ----
  await versions(page).getByRole("link", { name: "O que mudou na versão 2 desde a 1" }).click();
  await expect(page).toHaveURL(/\/previa\?versao=2&desde=1$/);
  await expect(page.getByRole("heading", { name: "O que mudou da versão 1 para a versão 2" })).toBeVisible();
  const site = page.getByRole("region", { name: "O site", exact: true });
  await expect(site).toContainText(`O título do site mudou de “${oldTitle}” para “Marina Personal”.`);
  const home = page.getByRole("region", { name: "Página inicial" });
  await expect(home).toContainText("Acrescentado: Parágrafo “Atendimento presencial e");
  const about = page.getByRole("region", { name: "Página “Sobre mim”" });
  await expect(about).toContainText("A página “Sobre mim” foi acrescentada, com o endereço /sobre-mim.");
  await expect(about).toContainText("Acrescentado: Parágrafo “Formada há dez anos”.");
  await expect(marked(page, "added")).toHaveCount(1);
  await expect(marked(page, "added")).toHaveText("Atendimento presencial e online");
  await expect(marked(page, "changed")).toHaveCount(0);
  // The menu of the version goes to its other page without losing the comparison; that page has its block marked too.
  const menu = frame(page).getByRole("navigation", { name: "Páginas do site" });
  await expect(menu.getByRole("link")).toHaveText(["Início", "Sobre mim"]);
  await menu.getByRole("link", { name: "Sobre mim" }).click();
  await expect(page).toHaveURL(/\/previa\?versao=2&desde=1&pagina=[0-9a-f]+$/);
  await expect(frame(page).getByText("Formada há dez anos")).toBeVisible();
  await expect(marked(page, "added")).toHaveText("Formada há dez anos");
  // The link of a page in the list does the same.
  await about.getByRole("link", { name: "Ver esta página" }).click();
  await expect(frame(page).getByText("Formada há dez anos")).toBeVisible();
  // The other way round: what version 1 would have to change to be version 2, from the draft's side, is nothing to the draft: it is version 2.
  await page.getByRole("navigation", { name: "Comparar versões" }).getByRole("link", { name: "o rascunho" }).click();
  await expect(page.getByRole("region", { name: "O site", exact: true })).toHaveCount(0);
  await expect(page.getByText("Nada mudou entre estas duas versões.")).toBeVisible();
  await expect(marked(page, "added")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Comparar versões" }).getByRole("link", { name: "não comparar" }).click();
  await expect(page.getByRole("heading", { name: "Versão 2", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "O site", exact: true })).toHaveCount(0);

  // ---- the draft, changed after the publication, against the version that is public ----
  await page.goto("./profissional/meu-site");
  await openEditor(page);
  await addAtEnd(page, "Título");
  await panel(page, "Propriedades");
  await field(page, "Título").fill("Novidade");
  await selectLayer(page, "Configurações da página");
  await field(page, "Título do site").fill("Marina Personal Trainer");
  await save(page);
  await closeEditor(page);
  await versions(page).getByRole("link", { name: "O que mudou no rascunho desde a versão 2" }).click();
  await expect(page.getByRole("heading", { name: "Prévia do rascunho", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "O que mudou da versão 2 para o rascunho" })).toBeVisible();
  await expect(page.getByRole("region", { name: "O site", exact: true })).toContainText("O título do site mudou de “Marina Personal” para “Marina Personal Trainer”.");
  await expect(page.getByRole("region", { name: "Página inicial" })).toContainText("Acrescentado: Título “Novidade”.");
  await expect(marked(page, "added")).toHaveText("Novidade");
  // The version that is public does not have it.
  await page.getByRole("navigation", { name: "Comparar versões" }).getByRole("link", { name: "não comparar" }).click();
  await expect(marked(page, "added")).toHaveCount(0);
  await expect(frame(page).getByText("Novidade")).toBeVisible();
  await page.goto("./profissional/meu-site/previa?versao=2");
  await expect(frame(page).getByText("Novidade")).toHaveCount(0);

  // ---- a version that is not one, or one this site does not have, is not shown: the preview is the draft ----
  for (const query of ["versao=99", "versao=abc", "versao=0", "versao=1.5", "versao=2&desde=99", "desde=zzz", "versao=%00"]) {
    await page.goto(`./profissional/meu-site/previa?${query}`);
    await expect(page.getByRole("heading", { name: "Prévia do rascunho", level: 1 }), query).toBeVisible();
    await expect(page).toHaveURL(/\/previa$/);
  }

  // ---- bringing a version back: the draft becomes it, pages included (and without them for the first one), and what is public does not change ----
  await page.goto("./profissional/meu-site");
  await versions(page).getByRole("button", { name: "Usar a versão 1 como rascunho" }).click();
  await page.getByRole("button", { name: "Confirmar: usar a versão 1 como rascunho" }).click();
  // The note of the first time is still on the screen: what says this one is done is the confirmation going away (the draft was replaced with it).
  await expect(page.getByRole("button", { name: "Confirmar: usar a versão 1 como rascunho" })).toHaveCount(0);
  await expect(page.getByText("A versão voltou para o rascunho.")).toBeVisible();
  await openEditor(page);
  expect(await pageNames(page)).toEqual(["Início"]);
  await panel(page, "Propriedades");
  await selectLayer(page, "Configurações da página");
  await expect(field(page, "Título do site")).toHaveValue(oldTitle);
  await closeEditor(page);
  await versions(page).getByRole("button", { name: "Usar a versão 2 como rascunho" }).click();
  await page.getByRole("button", { name: "Confirmar: usar a versão 2 como rascunho" }).click();
  // The note of the first time is still on the screen: what says this one is done is the confirmation going away (the draft was replaced with it).
  await expect(page.getByRole("button", { name: "Confirmar: usar a versão 2 como rascunho" })).toHaveCount(0);
  await expect(page.getByText("A versão voltou para o rascunho.")).toBeVisible();
  await openEditor(page);
  expect(await pageNames(page)).toEqual(["Início", "Sobre mim"]);
  await closeEditor(page);
  // The draft is version 2 again: the public page never stopped being it.
  await versions(page).getByRole("link", { name: "O que mudou no rascunho desde a versão 2" }).click();
  await expect(page.getByText("Nada mudou entre estas duas versões.")).toBeVisible();

  // ---- nobody outside the site's team sees a version ----
  const stranger = await newActor(browser, baseURL);
  await stranger.page.goto("./profissional/meu-site/previa?versao=1");
  await expect(stranger.page.getByRole("heading", { name: "Versão 1" })).toHaveCount(0);
  await expect(stranger.page).not.toHaveURL(/profissional\/meu-site\/previa/);
  await stranger.context.close();
});

test("versions on a phone: the list has the links, and the version and its changes are read on the small screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(240_000);
  await startEditor(page);
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");
  await save(page);
  await publish(page, 1);
  await selectLayer(page, "Configurações da página");
  await field(page, "Título do site").fill("Marina Celular");
  await save(page);
  await publish(page, 2);
  await closeEditor(page);
  await versions(page).getByRole("link", { name: "O que mudou na versão 2 desde a 1" }).click();
  await expect(page.getByRole("region", { name: "O site", exact: true })).toContainText("O título do site mudou");
  await expect(page.locator(".site-preview")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
