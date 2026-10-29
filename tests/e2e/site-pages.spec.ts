import { test, expect, type Page } from "@playwright/test";
import { newActor, png } from "./helpers";
import { addAtEnd, editor, inspector, library, panel, selectLayer, stage, startEditor as startSite } from "./site-helpers";

const startEditor = (page: Page) => startSite(page, "Marina Páginas");

const frame = (page: Page) => stage(page).locator('[data-frame="desktop"]');
const list = (page: Page) => library(page).getByRole("list", { name: "Páginas do site" });
const rowNames = (page: Page) => list(page).locator(".ve-layer strong").allInnerTexts();
const field = (page: Page, label: string) => inspector(page).getByRole("textbox", { name: label, exact: true });
const save = async (page: Page) => {
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
};
/** The library's tab of pages. */
async function openPages(page: Page) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Páginas", exact: true }).click();
}
async function addPage(page: Page, title: string) {
  await openPages(page);
  await library(page).getByRole("button", { name: "Nova página" }).click();
  await panel(page, "Propriedades");
  await field(page, "Título da página").fill(title);
}
async function goTo(page: Page, title: string) {
  await openPages(page);
  await list(page).getByRole("button", { name: `Abrir a página ${title}`, exact: true }).click();
}
const goHome = async (page: Page) => {
  await openPages(page);
  await list(page).getByRole("button", { name: "Abrir a página inicial" }).click();
};
/** Goes to the page's own settings (nothing selected). */
const pageSettings = async (page: Page) => {
  await selectLayer(page, "Configurações da página");
};

test("pages: made in the editor with a title that makes the address, put in the menu or out of it, reached from a button, shown in the preview and published together; each one has its own address, title and description, and the images and styles of the site", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const slug = await startEditor(page);
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");

  // ---- the list starts with the home page alone; a new page opens in the editor, empty, with no title ----
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início"]);
  await library(page).getByRole("button", { name: "Nova página" }).click();
  await expect(editor(page).getByText("Página criada. Dê um título a ela", { exact: false })).toBeVisible();
  await expect(stage(page).getByText("Página: sem título")).toBeVisible();
  await expect(frame(page).locator(".site-hint")).toContainText("A página está sem blocos");
  await expect(field(page, "Endereço da página")).toHaveValue("pagina");

  // ---- the first title makes the address; the menu on the canvas has the home page and the pages that have a title ----
  await field(page, "Título da página").fill("Sobre mim");
  await expect(field(page, "Endereço da página")).toHaveValue("sobre-mim");
  await expect(inspector(page).getByText(`/s/${slug}/sobre-mim`)).toBeVisible();
  await expect(stage(page).getByText("Página: Sobre mim")).toBeVisible();
  await field(page, "Descrição para buscadores (opcional)").fill("Quem sou eu e como trabalho");
  await addAtEnd(page, "Parágrafo");
  await panel(page, "Propriedades");
  await field(page, "Parágrafo").fill("Sou personal trainer há dez anos");
  await addAtEnd(page, "Imagem");
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Escolher o arquivo da imagem").setInputFiles({ name: "marina.png", mimeType: "image/png", buffer: png(300, 200) });
  await expect(inspector(page).getByText("Imagem enviada.")).toBeVisible();
  await inspector(page).getByLabel("Descrição da imagem (para quem não consegue vê-la)").fill("Marina no estúdio");
  await expect(frame(page).locator(".site-image img")).toHaveAttribute("src", /\/imagens\/[0-9a-f-]{36}$/);
  await expect(frame(page).locator(".site-menu .site-menu-link")).toHaveText(["Início", "Sobre mim"]);

  // ---- a second page, with a template that has styles; and a third one that is not in the menu ----
  await addPage(page, "Planos");
  await expect(field(page, "Endereço da página")).toHaveValue("planos");
  await addAtEnd(page, "Planos");
  await expect(frame(page).locator(".site-main article")).toHaveCount(3);
  await addPage(page, "Equipe");
  await inspector(page).getByRole("checkbox", { name: "Aparecer no menu do site" }).uncheck();
  await addAtEnd(page, "Parágrafo");
  await panel(page, "Propriedades");
  await field(page, "Parágrafo").fill("Quem treina com você");
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Sobre mim", "Planos", "Equipe"]);
  await expect(list(page).getByRole("button", { name: "Abrir a página Equipe" })).toContainText("/equipe · fora do menu");
  await expect(frame(page).locator(".site-menu .site-menu-link")).toHaveText(["Início", "Sobre mim", "Planos"]);

  // ---- the home page: a button that goes to a page, and the menu in its header ----
  await goHome(page);
  await expect(stage(page).getByText("Seu site")).toBeVisible();
  await expect(frame(page).locator(".site-main > *")).toHaveCount(2);
  await addAtEnd(page, "Botão");
  await panel(page, "Propriedades");
  await field(page, "Texto do botão").fill("Conheça a Marina");
  await inspector(page).getByLabel("O botão leva a").selectOption({ label: "Outra página do site" });
  await inspector(page).getByLabel("Página de destino").selectOption({ label: "Sobre mim" });
  // The home page is not among the destinations of a button of the home page; the others are.
  await expect(inspector(page).getByLabel("Página de destino").locator("option")).toHaveText(["Sobre mim", "Planos", "Equipe"]);
  await expect(frame(page).locator(".site-main .button").filter({ hasText: "Conheça a Marina" })).toHaveCount(1);

  // ---- the preview shows the page that is open, and the menu goes to the other ones in the same window ----
  await editor(page).getByRole("button", { name: "Prévia" }).click();
  const menu = frame(page).getByRole("navigation", { name: "Páginas do site" });
  await expect(menu.getByRole("link")).toHaveText(["Início", "Sobre mim", "Planos"]);
  await expect(menu.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  await frame(page).getByRole("link", { name: "Conheça a Marina" }).click();
  await expect(frame(page).getByText("Sou personal trainer há dez anos")).toBeVisible();
  await expect(menu.getByRole("link", { name: "Sobre mim" })).toHaveAttribute("aria-current", "page");
  await menu.getByRole("link", { name: "Planos" }).click();
  await expect(frame(page).locator("article")).toHaveCount(3);
  await editor(page).getByRole("button", { name: "Voltar a editar" }).click();
  await expect(stage(page).getByText("Página: Planos")).toBeVisible();
  await expect(frame(page).locator(".site-main article")).toHaveCount(3);

  // ---- what is wrong in a page is said with the page, and the button goes to it ----
  await save(page);
  await goHome(page);
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  const issues = editor(page).locator(".ve-issues");
  const ofPlanos = issues.getByRole("listitem").filter({ hasText: "Página “Planos”: " }).first();
  await expect(ofPlanos).toBeVisible();
  await ofPlanos.getByRole("button", { name: "Ir ao bloco" }).click();
  await expect(stage(page).getByText("Página: Planos")).toBeVisible();
  await panel(page, "Propriedades");
  await expect(inspector(page).locator(".ve-crumbs, h2").first()).toBeVisible();
  await editor(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar", { exact: false })).toBeVisible();

  // ---- the published site: a menu on every page, each page at its own address, with its own title and description ----
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  await visitor.goto(`./s/${slug}`);
  const nav = visitor.getByRole("navigation", { name: "Páginas do site" });
  await expect(nav.getByRole("link")).toHaveText(["Início", "Sobre mim", "Planos"]);
  await expect(nav.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  await visitor.getByRole("link", { name: "Conheça a Marina" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/sobre-mim$`));
  await expect(visitor.getByText("Sou personal trainer há dez anos")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Sobre mim" })).toHaveAttribute("aria-current", "page");
  await expect(visitor).toHaveTitle(/^Sobre mim — /);
  await expect(visitor.locator('meta[name="description"]')).toHaveAttribute("content", "Quem sou eu e como trabalho");
  await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  // An image of a page below the site is served from the site's own address, from where the page is.
  const photo = visitor.locator(".site-image img");
  await expect(photo).toHaveAttribute("src", /^\.\/m\/[0-9a-f-]{36}$/);
  await expect.poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // The sheet of styles is the site's, and a page that is not the home page finds it.
  await nav.getByRole("link", { name: "Planos" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/planos$`));
  await expect(visitor.locator("article")).toHaveCount(3);
  await expect(visitor.locator('link[rel=stylesheet][href*="estilo.css"]')).toHaveAttribute("href", /^\.\/estilo\.css\?v=\d+$/);
  await expect(visitor.locator("article").first()).toHaveCSS("border-radius", "16px");
  await expect(visitor).toHaveTitle(/^Planos — /);
  expect((await visitor.request.get(`./s/${slug}/estilo.css`)).status()).toBe(200);
  // From a page, the menu goes back to the home page.
  await nav.getByRole("link", { name: "Início" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}$`));
  await expect(visitor.locator(".site-hero, .site-main").first()).toBeVisible();
  // A page that is out of the menu is at its address; one that does not exist, and the address of an image or of the sheet as a page, are not pages.
  await visitor.goto(`./s/${slug}/equipe`);
  await expect(visitor.getByText("Quem treina com você")).toBeVisible();
  await expect(visitor.getByRole("navigation", { name: "Páginas do site" }).locator('[aria-current="page"]')).toHaveCount(0);
  expect((await visitor.request.get(`./s/${slug}/nao-existe`)).status()).toBe(404);
  expect((await visitor.request.get(`./s/${slug}/m/nao-e-imagem`)).status()).toBe(404);
  // A site that is not published has no pages either.
  expect((await visitor.request.get(`./s/estudio-que-nao-existe/sobre-mim`)).status()).toBe(404);
  await visit.context.close();

  // ---- the preview of the draft is of the page asked for ----
  await page.goto("./profissional/meu-site/previa?pagina=gone");
  await expect(page.getByRole("navigation", { name: "Páginas do site" }).getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Páginas do site" }).getByRole("link", { name: "Sobre mim" }).click();
  await expect(page).toHaveURL(/\/previa\?pagina=[0-9a-f]+$/);
  await expect(page.getByText("Sou personal trainer há dez anos")).toBeVisible();
  await expect(page.locator(".site-image img")).toHaveAttribute("src", /^\.\/imagens\/[0-9a-f-]{36}$/);
});

test("pages: addresses that are accepted, refused or taken, moving, copying, deleting with what it leaves behind and undoing it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The phone has its own scenario below.");
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startEditor(page);
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");
  await addPage(page, "Sobre mim");
  await addAtEnd(page, "Parágrafo");
  await addPage(page, "Planos");
  await addAtEnd(page, "Planos");

  // ---- the address: what is not one stays in the field with the reason and is not written; leaving the field takes the page's own back ----
  await pageSettings(page);
  const address = field(page, "Endereço da página");
  await address.fill("Sobre Nós");
  await expect(inspector(page).getByRole("alert")).toContainText("O endereço usa letras minúsculas sem acento");
  await openPages(page);
  await expect(list(page).getByRole("button", { name: "Abrir a página Planos", exact: true })).toContainText("/planos");
  await pageSettings(page);
  await address.fill("Sobre Nós");
  await address.blur();
  await expect(address).toHaveValue("planos");
  await expect(inspector(page).getByRole("alert")).toHaveCount(0);
  await address.fill("sobre-mim");
  await expect(inspector(page).getByRole("alert")).toContainText("Já há uma página com esse endereço");
  await address.fill("m");
  await expect(inspector(page).getByRole("alert")).toContainText("reservado");
  await address.fill("  Valores ");
  await expect(inspector(page).getByRole("alert")).toHaveCount(0);
  await openPages(page);
  await expect(list(page).getByRole("button", { name: "Abrir a página Planos", exact: true })).toContainText("/valores");

  // ---- order, copy ----
  // The buttons are of the page that is open (Planos, the last one made): the others have none.
  await expect(list(page).getByRole("button", { name: "Subir a página Sobre mim" })).toHaveCount(0);
  await list(page).getByRole("button", { name: "Subir a página Planos" }).click();
  expect(await rowNames(page)).toEqual(["Início", "Planos", "Sobre mim"]);
  await expect(list(page).getByRole("button", { name: "Subir a página Planos" })).toBeDisabled();
  await goTo(page, "Sobre mim");
  await expect(list(page).getByRole("button", { name: "Descer a página Sobre mim" })).toBeDisabled();
  await goTo(page, "Planos");
  await list(page).getByRole("button", { name: "Duplicar a página Planos" }).click();
  expect(await rowNames(page)).toEqual(["Início", "Planos", "Planos (cópia)", "Sobre mim"]);
  await expect(stage(page).getByText("Página: Planos (cópia)")).toBeVisible();
  await expect(frame(page).locator(".site-main article")).toHaveCount(3);
  await expect(list(page).getByRole("button", { name: "Abrir a página Planos (cópia)" })).toContainText("/valores-copia");
  await expect(inspector(page).getByRole("textbox", { name: "Título da página", exact: true })).toHaveValue("Planos (cópia)");
  // The copy is its own: a change in it is not in the original.
  await addAtEnd(page, "Parágrafo");
  await expect(frame(page).locator(".site-main > *")).toHaveCount(2);
  await goTo(page, "Planos");
  await expect(frame(page).locator(".site-main > *")).toHaveCount(1);

  // ---- a button of the home page goes to a page; deleting the page leaves it with no destination, and one undo brings both back ----
  await goHome(page);
  await addAtEnd(page, "Botão");
  await panel(page, "Propriedades");
  await field(page, "Texto do botão").fill("Sobre");
  await inspector(page).getByLabel("O botão leva a").selectOption({ label: "Outra página do site" });
  await inspector(page).getByLabel("Página de destino").selectOption({ label: "Sobre mim" });
  await goTo(page, "Sobre mim");
  await list(page).getByRole("button", { name: "Excluir a página Sobre mim" }).click();
  await expect(editor(page).getByText("Página “Sobre mim” excluída. 1 botão ou link que levava a ela ficou sem destino. Dá para desfazer.")).toBeVisible();
  expect(await rowNames(page)).toEqual(["Início", "Planos", "Planos (cópia)"]);
  await selectLayer(page, /^Botão/);
  await expect(inspector(page).getByLabel("O botão leva a")).toHaveValue("none");
  await editor(page).getByRole("button", { name: "Desfazer", exact: true }).click();
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Planos", "Planos (cópia)", "Sobre mim"]);
  await selectLayer(page, /^Botão/);
  await expect(inspector(page).getByLabel("O botão leva a")).toHaveValue("page");
  await expect(inspector(page).getByLabel("Página de destino")).toHaveValue(/.+/);
  await expect(inspector(page).getByLabel("Página de destino").locator("option:checked")).toHaveText("Sobre mim");
  // Changing where the button goes takes the page away (a button goes to one place only): the draft is still one the server accepts.
  await inspector(page).getByLabel("O botão leva a").selectOption({ label: "Um contato" });
  await expect(inspector(page).getByLabel("Página de destino")).toHaveCount(0);
  await expect(inspector(page).getByLabel("Contato de destino")).toBeVisible();
  await save(page);
  await inspector(page).getByLabel("O botão leva a").selectOption({ label: "Outra página do site" });
  await inspector(page).getByLabel("Página de destino").selectOption({ label: "Sobre mim" });
  await inspector(page).getByLabel("O botão leva a").selectOption({ label: "Outro bloco desta página" });
  await expect(inspector(page).getByLabel("Página de destino")).toHaveCount(0);
  await expect(inspector(page).getByLabel("Bloco de destino")).toBeVisible();
  await save(page);
  await inspector(page).getByLabel("O botão leva a").selectOption({ label: "Outra página do site" });
  await inspector(page).getByLabel("Página de destino").selectOption({ label: "Sobre mim" });
  await expect(inspector(page).getByLabel("Bloco de destino")).toHaveCount(0);
  await save(page);

  // ---- deleting the page that is open goes back to the home page; the others are not touched ----
  await goTo(page, "Planos (cópia)");
  await openPages(page);
  await list(page).getByRole("button", { name: "Excluir a página Planos (cópia)" }).click();
  await expect(stage(page).getByText("Seu site")).toBeVisible();
  expect(await rowNames(page)).toEqual(["Início", "Planos", "Sobre mim"]);
  await save(page);
  await page.reload();
  await page.getByRole("button", { name: "Abrir o editor visual" }).click();
  await openPages(page);
  expect(await rowNames(page)).toEqual(["Início", "Planos", "Sobre mim"]);

  // ---- a page with no title and no blocks is flagged with its page, and the button next to the issue goes to it ----
  await library(page).getByRole("button", { name: "Nova página" }).click();
  await goHome(page);
  await save(page);
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  const flagged = editor(page).locator(".ve-issues").getByRole("listitem").filter({ hasText: "Página “pagina”: " });
  await expect(flagged).toHaveCount(2);
  await expect(flagged.first()).toContainText("dê um título à página");
  await expect(flagged.last()).toContainText("a página está sem blocos");
  await flagged.first().getByRole("button", { name: "Ir à página" }).click();
  await expect(stage(page).getByText("Página: sem título")).toBeVisible();
});

test("pages on a phone: a page is made from the list of the library, named in the settings and seen in the frame of the phone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenarios above.");
  test.setTimeout(180_000);
  await startEditor(page);
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");
  await addPage(page, "Contato");
  await expect(field(page, "Endereço da página")).toHaveValue("contato");
  await addAtEnd(page, "Parágrafo");
  await panel(page, "Propriedades");
  await field(page, "Parágrafo").fill("Fale comigo pelo WhatsApp");
  await panel(page, "Página");
  await expect(stage(page).locator('[data-frame="mobile"] .site-main')).toContainText("Fale comigo pelo WhatsApp");
  await expect(stage(page).locator('[data-frame="mobile"] .site-menu .site-menu-link')).toHaveText(["Início", "Contato"]);
  await goHome(page);
  await panel(page, "Página");
  await expect(stage(page).locator('[data-frame="mobile"] .site-main')).not.toContainText("Fale comigo pelo WhatsApp");
  await expect(stage(page).getByText("Seu site")).toBeVisible();
});
