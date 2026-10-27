import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor, noHorizontalOverflow } from "./helpers";

const state = (page: Page) => page.getByRole("region", { name: "Estado do site" });
const editor = (page: Page) => page.getByRole("dialog", { name: "Editor visual do site" });
const stage = (page: Page) => editor(page).getByRole("main", { name: "Página" });
const inspector = (page: Page) => editor(page).getByRole("complementary", { name: "Propriedades" });
const library = (page: Page) => editor(page).getByRole("complementary", { name: "Blocos e camadas" });

/** On a phone the editor shows one panel at a time; on a computer all three are there. */
async function panel(page: Page, name: "Blocos" | "Página" | "Propriedades") {
  const tabs = editor(page).getByRole("group", { name: "Painéis do editor" });
  if (await tabs.isVisible()) await tabs.getByRole("button", { name, exact: true }).click();
}
async function openEditor(page: Page) {
  await state(page).getByRole("button", { name: "Abrir o editor visual" }).click();
  await expect(editor(page)).toBeVisible();
}
async function closeEditor(page: Page) {
  await editor(page).getByRole("button", { name: "Fechar o editor" }).click();
  await expect(editor(page)).toHaveCount(0);
}
/** Adds a block to the end of the page from the library (no dragging: a click does it). */
async function addBlock(page: Page, name: string) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Blocos", exact: true }).click();
  await library(page).getByRole("button", { name: `Acrescentar ${name} ao fim da página` }).click();
}
/** Selects a block by the list of layers, the way that works with a keyboard and on a phone. */
async function selectLayer(page: Page, label: RegExp | string) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Camadas", exact: true }).click();
  await library(page).getByRole("list", { name: "Blocos da página" }).getByRole("button", { name: label }).first().click();
  await panel(page, "Propriedades");
}
const layers = async (page: Page) => {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Camadas", exact: true }).click();
  return library(page).getByRole("list", { name: "Blocos da página" }).getByRole("button");
};
const layerNames = async (page: Page) => (await (await layers(page)).allInnerTexts()).map((text) => text.replace(/^\d+\s*/, "").trim());

test("a professional builds a page in the visual editor, previews it, publishes it, changes it without touching what is public, takes it offline and changes its address", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Site");
  const slug = `estudio-${unique}`;

  // A service to put on the page.
  await page.goto("./profissional/servicos");
  const newService = page.getByRole("form", { name: "Novo serviço" });
  await newService.getByLabel("Nome do serviço").fill("Consultoria online");
  await newService.getByLabel("Descrição (opcional)").fill("Plano mensal com ajustes por vídeo");
  await newService.getByRole("button", { name: "Criar serviço" }).click();
  await expect(page.getByText("Serviço criado.")).toBeVisible();

  // Nothing exists yet: the address is suggested from the name of the space, and a reserved one is refused.
  await page.goto("./profissional/meu-site");
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();
  const create = page.getByRole("form", { name: "Criar o meu site" });
  await expect(create.getByLabel("Endereço (letras minúsculas, números e hífens)")).toHaveValue(slug);
  await create.getByLabel("Endereço (letras minúsculas, números e hífens)").fill("gestor");
  await create.getByRole("button", { name: "Criar meu site" }).click();
  await expect(create.getByRole("alert")).toContainText("não pode ser um nome reservado");
  await create.getByLabel("Endereço (letras minúsculas, números e hífens)").fill(slug);
  await create.getByRole("button", { name: "Criar meu site" }).click();
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await noHorizontalOverflow(page);

  // A new site cannot be published: the call to action points to a WhatsApp that is not filled in.
  await state(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(state(page).getByRole("list", { name: "O que falta para publicar" })).toContainText("WhatsApp");
  await expect(state(page).getByText("Fora do ar")).toBeVisible();

  // The editor: the page in the middle, nothing selected shows the settings of the whole page.
  await openEditor(page);
  await expect(editor(page).getByText("Rascunho salvo (revisão 1)")).toBeVisible();
  expect(await layerNames(page)).toEqual(["Configurações da página", "Destaque", "Chamada para contato"]);
  await panel(page, "Propriedades");
  await expect(inspector(page).getByRole("heading", { name: "Página", level: 2 })).toBeVisible();
  await inspector(page).getByLabel("WhatsApp", { exact: true }).fill("(11) 91234-5678");
  await inspector(page).getByLabel("Descrição para buscadores (opcional)").fill("Treino com acompanhamento individual");
  await inspector(page).getByLabel("Verde").check();
  await inspector(page).getByLabel("Escuro").check();
  await expect(editor(page).getByText("Alterações não salvas")).toBeVisible();
  await expect(editor(page).getByRole("button", { name: "Publicar", exact: true })).toBeDisabled();
  await panel(page, "Página");
  await expect(stage(page).locator(".site")).toHaveAttribute("data-site-accent", "green");
  await expect(stage(page).locator(".site")).toHaveAttribute("data-site-mode", "dark");

  // Select the highlight and fill it in: the fields are the block's, and the canvas follows them.
  await selectLayer(page, /Destaque/);
  await expect(inspector(page).getByRole("heading", { name: "Destaque", level: 2 })).toBeVisible();
  await inspector(page).getByLabel("Etiqueta acima do título (opcional)").fill("Personal trainer");
  await inspector(page).getByLabel("Subtítulo").fill("Acompanhamento individual, presencial e online");
  await inspector(page).getByLabel("Texto do botão").fill("Falar comigo");
  await inspector(page).getByLabel("O botão leva a").selectOption({ label: "WhatsApp" });
  await panel(page, "Página");
  await expect(stage(page).getByText("Acompanhamento individual, presencial e online")).toBeVisible();
  await expect(stage(page).getByText("Personal trainer")).toBeVisible();

  // More blocks, from the library: questions, services, a testimony, indicators and two columns.
  await addBlock(page, "Perguntas frequentes");
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Pergunta", { exact: true }).fill("Atende online?");
  await inspector(page).getByLabel("Resposta").fill("Sim, por vídeo e pelo aplicativo.");
  await addBlock(page, "Serviços");
  await panel(page, "Propriedades");
  await inspector(page).getByRole("group", { name: "Serviços que aparecem" }).getByLabel(/Consultoria online/).check();
  await addBlock(page, "Depoimento");
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Depoimento", { exact: true }).fill("Finalmente um treino que cabe na minha rotina.");
  await inspector(page).getByLabel("Quem deu o depoimento").fill("Ana, aluna");
  await addBlock(page, "Indicadores");
  await panel(page, "Propriedades");
  const first = inspector(page).getByRole("group", { name: "Indicador 1" });
  await first.getByLabel("Número ou passo").fill("01");
  await first.getByLabel("Legenda").fill("Avaliação inicial");
  await inspector(page).getByRole("button", { name: "Remover o indicador 3" }).click();
  await inspector(page).getByRole("button", { name: "Remover o indicador 2" }).click();
  await addBlock(page, "2 colunas");
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Largura das colunas").selectOption({ label: "60 / 40" });
  await panel(page, "Página");
  await stage(page).getByRole("button", { name: "Acrescentar título à coluna da esquerda" }).click();
  await stage(page).getByRole("button", { name: "Acrescentar parágrafo à coluna da esquerda" }).click();
  await stage(page).getByRole("button", { name: "Acrescentar botão à coluna da direita" }).click();
  expect(await layerNames(page)).toEqual([
    "Configurações da página", "Destaque", "Chamada para contato", "Perguntas frequentes", "Serviços", "Depoimento", "Indicadores", "2 colunas", "Título", "Parágrafo", "Botão",
  ]);
  await selectLayer(page, /Título$/);
  await inspector(page).getByLabel("Título", { exact: true }).fill("Treino sem achismo");
  await selectLayer(page, /Parágrafo$/);
  await inspector(page).getByLabel("Parágrafo", { exact: true }).fill("Plano ajustado a cada semana, de acordo com a sua resposta.");
  await selectLayer(page, /Botão$/);
  await inspector(page).getByLabel("Texto do botão").fill("Chamar no WhatsApp");
  await inspector(page).getByLabel("O botão leva a").selectOption({ label: "WhatsApp" });

  // Order: the call to action goes to the end (down, down, ... with the block's own buttons).
  await selectLayer(page, /Chamada para contato/);
  for (let i = 0; i < 5; i++) await inspector(page).getByRole("button", { name: "Abaixo" }).click();
  await expect(inspector(page).getByRole("button", { name: "Abaixo" })).toBeDisabled();
  expect((await layerNames(page)).filter((name) => !["Título", "Parágrafo", "Botão"].includes(name))).toEqual([
    "Configurações da página", "Destaque", "Perguntas frequentes", "Serviços", "Depoimento", "Indicadores", "2 colunas", "Chamada para contato",
  ]);

  // A testimony needs the person's authorization to be published: the editor says which block and goes to it.
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo.")).toBeVisible();
  await expect(editor(page).getByText("Rascunho salvo (revisão 2)")).toBeVisible();
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  const issues = editor(page).getByRole("list", { name: "O que falta para publicar" });
  await expect(issues).toContainText("confirme que a pessoa autorizou");
  await expect(issues.getByRole("listitem")).toHaveCount(1);
  await issues.getByRole("button", { name: "Ir ao bloco" }).click();
  await panel(page, "Propriedades");
  await expect(inspector(page).getByRole("heading", { name: "Depoimento", level: 2 })).toBeVisible();
  await inspector(page).getByLabel("Tenho a autorização da pessoa para publicar este depoimento.").check();
  await expect(editor(page).getByRole("list", { name: "O que falta para publicar" })).toHaveCount(0);

  // Undo and redo take back what was done, a step at a time.
  await selectLayer(page, /Perguntas frequentes/);
  await inspector(page).getByRole("button", { name: "Excluir" }).click();
  expect(await layerNames(page)).not.toContain("Perguntas frequentes");
  await editor(page).getByRole("button", { name: "Desfazer" }).click();
  expect(await layerNames(page)).toContain("Perguntas frequentes");
  await editor(page).getByRole("button", { name: "Refazer" }).click();
  expect(await layerNames(page)).not.toContain("Perguntas frequentes");
  await editor(page).getByRole("button", { name: "Desfazer" }).click();
  expect(await layerNames(page)).toContain("Perguntas frequentes");
  await selectLayer(page, /Perguntas frequentes/);
  await expect(inspector(page).getByLabel("Resposta")).toHaveValue("Sim, por vídeo e pelo aplicativo.");

  // The preview inside the editor is the page as it will be published, on a computer and on a phone.
  await panel(page, "Página");
  await editor(page).getByRole("button", { name: "Prévia", exact: true }).click();
  await expect(stage(page).getByRole("link", { name: "Falar comigo" })).toHaveAttribute("href", "https://wa.me/5511912345678");
  await expect(stage(page).getByRole("heading", { name: "Consultoria online", level: 3 })).toBeVisible();
  await expect(stage(page).locator(".ve-tools")).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Celular" }).click();
  // The frame narrows with a short transition; the page inside answers to its own width, not to the screen's.
  await expect.poll(async () => (await stage(page).locator(".ve-browser").boundingBox())!.width).toBeLessThanOrEqual(391);
  await editor(page).getByRole("button", { name: "Computador" }).click();
  await editor(page).getByRole("button", { name: "Voltar a editar" }).click();
  await noHorizontalOverflow(page);

  // Save, then publish from the editor.
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão 3)")).toBeVisible();
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();
  await closeEditor(page);
  await expect(state(page).getByText("No ar", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Versões publicadas" }).getByText("Versão 1")).toBeVisible();
  await expect(state(page).getByText("Endereço:")).toContainText(`/s/${slug}`);

  // The page is public, for anybody, with no session.
  const anonymous = await newActor(browser, baseURL);
  await anonymous.page.goto(`./s/${slug}`);
  await expect(anonymous.page.getByRole("heading", { level: 1 })).toContainText("Estúdio");
  await expect(anonymous.page).toHaveTitle(/Estúdio/);
  await expect(anonymous.page.locator('meta[name="description"]')).toHaveAttribute("content", "Treino com acompanhamento individual");
  await expect(anonymous.page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
  await expect(anonymous.page.locator(".site")).toHaveAttribute("data-site-accent", "green");
  await expect(anonymous.page.locator(".site")).toHaveAttribute("data-site-mode", "dark");
  await expect(anonymous.page.getByRole("link", { name: "Falar comigo" })).toHaveAttribute("href", "https://wa.me/5511912345678");
  // The button in the column and the call to action both say it: two links, both to the same WhatsApp.
  const whats = anonymous.page.getByRole("link", { name: "Chamar no WhatsApp" });
  await expect(whats).toHaveCount(2);
  for (const href of await whats.evaluateAll((nodes) => nodes.map((n) => (n as HTMLAnchorElement).href))) expect(href).toBe("https://wa.me/5511912345678");
  await expect(anonymous.page.getByText("Personal trainer")).toBeVisible();
  await expect(anonymous.page.getByRole("heading", { name: "Consultoria online", level: 3 })).toBeVisible();
  await expect(anonymous.page.getByText("Plano mensal com ajustes por vídeo")).toBeVisible();
  await expect(anonymous.page.getByText("“Finalmente um treino que cabe na minha rotina.”")).toBeVisible();
  await expect(anonymous.page.getByText("Ana, aluna")).toBeVisible();
  await expect(anonymous.page.getByText("Avaliação inicial")).toBeVisible();
  await expect(anonymous.page.getByRole("heading", { name: "Treino sem achismo", level: 2 })).toBeVisible();
  await expect(anonymous.page.getByText("Plano ajustado a cada semana")).toBeVisible();
  await anonymous.page.getByText("Atende online?").click();
  await expect(anonymous.page.getByText("Sim, por vídeo e pelo aplicativo.")).toBeVisible();
  const headings = await anonymous.page.locator("main h2").allInnerTexts();
  expect(headings).toEqual(["Perguntas frequentes", "Serviços", "Treino sem achismo", "Fale comigo"]);
  // Nothing of the tool, nothing from elsewhere: no form, no image, no editor, and every script is the app's own.
  await expect(anonymous.page.locator("form, img, iframe, dialog, [contenteditable], [data-block-id]")).toHaveCount(0);
  const origin = new URL(anonymous.page.url()).origin;
  for (const src of await anonymous.page.locator("script[src]").evaluateAll((nodes) => nodes.map((n) => (n as HTMLScriptElement).src)))
    expect(new URL(src, origin).origin, src).toBe(origin);
  await expect(anonymous.page.getByText("Minha conta")).toHaveCount(0);
  await noHorizontalOverflow(anonymous.page);
  expect((await anonymous.page.request.get("./s/nao-existe")).status()).toBe(404);
  expect((await anonymous.page.request.get("./s/..%2Fprofissional")).status()).toBe(404);

  // The saved draft has its own preview page, which is not indexed.
  await state(page).getByRole("link", { name: "Ver a prévia do rascunho salvo" }).click();
  await expect(page.getByRole("heading", { name: "Prévia do rascunho", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Prévia da página").getByText("Atende online?")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.getByRole("link", { name: "Voltar ao editor" }).click();

  // Editing the draft does not reach what is public until the next publication.
  await openEditor(page);
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Título do site").fill("Título novo ainda sem publicar");
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo.")).toBeVisible();
  await closeEditor(page);
  await expect(state(page).getByText("Há alterações salvas que ainda não foram publicadas.")).toBeVisible();
  await anonymous.page.reload();
  await expect(anonymous.page.getByText("Título novo ainda sem publicar")).toHaveCount(0);
  await state(page).getByRole("button", { name: "Publicar uma nova versão" }).click();
  await expect(state(page).getByText("Publicado: o site está no ar na versão 2.")).toBeVisible();
  await anonymous.page.reload();
  await expect(anonymous.page.getByText("Título novo ainda sem publicar").first()).toBeVisible();

  // Closing the editor with changes not saved keeps them, and the page says so and offers to save.
  await openEditor(page);
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Descrição para buscadores (opcional)").fill("Descrição que ainda não foi salva");
  await closeEditor(page);
  await expect(state(page).getByText("Há alterações no editor que ainda não foram salvas.")).toBeVisible();
  await expect(state(page).getByRole("button", { name: "Publicar uma nova versão" })).toBeDisabled();
  await openEditor(page);
  await panel(page, "Propriedades");
  await expect(inspector(page).getByLabel("Descrição para buscadores (opcional)")).toHaveValue("Descrição que ainda não foi salva");
  await editor(page).getByRole("button", { name: "Desfazer" }).click();
  await expect(inspector(page).getByLabel("Descrição para buscadores (opcional)")).toHaveValue("Treino com acompanhamento individual");
  await closeEditor(page);
  await expect(state(page).getByText("Há alterações no editor que ainda não foram salvas.")).toHaveCount(0);

  // An earlier version comes back as the draft (and asks first); the public page stays on version 2.
  const versions = page.getByRole("region", { name: "Versões publicadas" });
  await versions.getByRole("button", { name: "Usar a versão 1 como rascunho" }).click();
  await versions.getByRole("button", { name: /Confirmar: usar a versão 1 como rascunho/ }).click();
  await expect(versions.getByText("A versão voltou para o rascunho.")).toBeVisible();
  await openEditor(page);
  await panel(page, "Propriedades");
  await expect(inspector(page).getByLabel("Título do site")).toHaveValue(new RegExp(`Estúdio ${unique}`));
  await expect(editor(page).getByRole("button", { name: "Desfazer" })).toBeDisabled();
  await closeEditor(page);
  await anonymous.page.reload();
  await expect(anonymous.page.getByText("Título novo ainda sem publicar").first()).toBeVisible();

  // Offline: the page answers 404 at once, the releases stay, and only now can the address change.
  await expect(page.getByRole("heading", { name: "Endereço do site" })).toHaveCount(0);
  await state(page).getByRole("button", { name: "Tirar do ar" }).click();
  await expect(state(page).getByText("O site saiu do ar.")).toBeVisible();
  expect((await anonymous.page.request.get(`./s/${slug}`)).status()).toBe(404);
  await expect(page.getByRole("list", { name: "Versões publicadas" }).getByText("Versão 2")).toBeVisible();
  const address = page.getByRole("form", { name: "Mudar o endereço do site" });
  await address.getByLabel(/^Endereço/).fill("gestor");
  await address.getByRole("button", { name: "Mudar o endereço" }).click();
  await expect(address.getByRole("alert")).toContainText("não pode ser um nome reservado");
  await address.getByLabel(/^Endereço/).fill(`${slug}-novo`);
  await address.getByRole("button", { name: "Mudar o endereço" }).click();
  await expect(address.getByText("Endereço mudado.")).toBeVisible();
  await page.reload();
  await expect(state(page).getByText("Endereço:")).toContainText(`/s/${slug}-novo`);

  // The editor is not for visitors.
  await anonymous.page.goto("./profissional/meu-site");
  await expect(anonymous.page).toHaveURL(/\/entrar/);
  await anonymous.context.close();
});

// A tall window: the blocks being dragged and the places they go to are on the screen at the same time.
test.describe("drag and drop", () => {
test.use({ viewport: { width: 1440, height: 1200 } });
test("blocks go from the library to the page, move between places, fill the columns, and what does not fit a column stays out", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Dragging is for a pointer; the phone adds and moves blocks with buttons, which the scenario above does.");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Arrasto ${unique}`, "Marina Arrasto");
  await page.goto("./profissional/meu-site");
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await openEditor(page);

  const frame = (type: string) => stage(page).locator(`.ve-frame[data-type="${type}"]`);
  const tile = (name: string) => library(page).getByRole("button", { name: `Acrescentar ${name} ao fim da página` });
  const order = async () => (await stage(page).locator(".site-main > .ve-frame").evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.type)));

  // Dropped on the lower half of a block, it goes after it; on the upper half, before.
  expect(await order()).toEqual(["hero", "cta"]);
  await tile("Perguntas frequentes").dragTo(frame("hero"), { targetPosition: { x: 200, y: (await frame("hero").boundingBox())!.height - 10 } });
  expect(await order()).toEqual(["hero", "faq", "cta"]);
  await tile("Depoimento").dragTo(frame("hero"), { targetPosition: { x: 200, y: 8 } });
  expect(await order()).toEqual(["quote", "hero", "faq", "cta"]);
  await expect(frame("quote")).toHaveAttribute("data-selected", "true");

  // A block that is there moves by its handle, and keeps what was written in it.
  await frame("faq").locator(".site-editable").first().dblclick();
  await page.keyboard.type("Perguntas do arrasto");
  await page.keyboard.press("Enter");
  await expect(frame("faq").getByText("Perguntas do arrasto")).toBeVisible();
  await frame("faq").click({ position: { x: 20, y: 40 } });
  await frame("faq").getByRole("button", { name: /^Arrastar Bloco 3/ }).dragTo(frame("quote"), { targetPosition: { x: 200, y: 8 } });
  expect(await order()).toEqual(["faq", "quote", "hero", "cta"]);
  await expect(frame("faq").getByText("Perguntas do arrasto")).toBeVisible();

  // Two columns: they take title, paragraph and button, in either column; a section dropped over them stays out.
  await tile("2 colunas").dragTo(frame("cta"), { targetPosition: { x: 200, y: 8 } });
  expect(await order()).toEqual(["faq", "quote", "hero", "columns", "cta"]);
  const left = stage(page).locator('.site-column[data-side="left"]');
  const right = stage(page).locator('.site-column[data-side="right"]');
  await expect(left.locator(".ve-empty")).toBeVisible();
  await tile("Título").dragTo(left.locator(".ve-empty"));
  await expect(left.locator('.ve-frame[data-type="heading"]')).toHaveCount(1);
  await tile("Botão").dragTo(right.locator(".ve-empty"));
  await expect(right.locator('.ve-frame[data-type="button"]')).toHaveCount(1);
  await tile("Parágrafo").dragTo(left.locator('.ve-frame[data-type="heading"]'), { targetPosition: { x: 40, y: 2 } });
  await expect(left.locator(".ve-frame").evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.type))).resolves.toEqual(["paragraph", "heading"]);
  await tile("Serviços").dragTo(left.locator('.ve-frame[data-type="heading"]'));
  await expect(left.locator('.ve-frame[data-type="services"]')).toHaveCount(0);
  await expect(frame("services")).toHaveCount(1);
  expect((await order()).filter((type) => type === "services")).toHaveLength(1);

  // Dragging an element from one column to the other, and out of the columns onto the page.
  await left.locator('.ve-frame[data-type="paragraph"]').click({ position: { x: 20, y: 6 } });
  await left.locator('.ve-frame[data-type="paragraph"]').getByRole("button", { name: /^Arrastar Elemento 1/ }).dragTo(right.locator(".ve-frame").first(), { targetPosition: { x: 40, y: 2 } });
  await expect(right.locator(".ve-frame").evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.type))).resolves.toEqual(["paragraph", "button"]);
  await expect(left.locator(".ve-frame")).toHaveCount(1);

  // Writing straight on the page: double click, type, Enter keeps it; Escape gives it up; the panel agrees.
  const title = left.locator('.ve-frame[data-type="heading"] .site-editable');
  await title.dblclick();
  await page.keyboard.type("Título escrito na página");
  await page.keyboard.press("Enter");
  await expect(title).toHaveText("Título escrito na página");
  await title.dblclick();
  await page.keyboard.type("isto será descartado");
  await page.keyboard.press("Escape");
  await expect(title).toHaveText("Título escrito na página");
  await expect(inspector(page).getByRole("textbox", { name: "Título", exact: true })).toHaveValue("Título escrito na página");

  // Undo, with the keyboard, takes back the last change; redo brings it again.
  await page.locator("body").press("Control+z");
  await expect(title).toHaveText("");
  await page.locator("body").press("Control+Shift+z");
  await expect(title).toHaveText("Título escrito na página");

  // Selecting by a click on the page shows that block's settings; a click on the background shows the page's.
  await frame("quote").click({ position: { x: 20, y: 40 } });
  await expect(inspector(page).getByRole("heading", { name: "Depoimento", level: 2 })).toBeVisible();
  await stage(page).locator(".ve-stage-scroll").click({ position: { x: 4, y: 4 } });
  await expect(inspector(page).getByRole("heading", { name: "Página", level: 2 })).toBeVisible();

  // Nothing is saved until asked: leaving shows the page as it was.
  await expect(editor(page).getByText("Alterações não salvas")).toBeVisible();
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo.")).toBeVisible();
  await closeEditor(page);
  await page.reload();
  await openEditor(page);
  // The section dropped over the upper half of the columns went before them, on the page.
  expect(await order()).toEqual(["faq", "quote", "hero", "services", "columns", "cta"]);
  await expect(left.locator('.ve-frame[data-type="heading"] .site-editable')).toHaveText("Título escrito na página");
});
});
