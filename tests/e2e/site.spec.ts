import { test, expect, type Locator } from "@playwright/test";
import { createProfessional, localIP, newActor, noHorizontalOverflow } from "./helpers";
import { addAtEnd, addSelected, closeEditor, contentTab, editor, inspector, layerNames, library, openEditor, panel, selectLayer, stage, state, styleTab } from "./site-helpers";

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
  await addAtEnd(page, "Perguntas frequentes");
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Pergunta", { exact: true }).fill("Atende online?");
  await inspector(page).getByLabel("Resposta").fill("Sim, por vídeo e pelo aplicativo.");
  await addAtEnd(page, "Serviços");
  await panel(page, "Propriedades");
  await inspector(page).getByRole("group", { name: "Serviços que aparecem" }).getByLabel(/Consultoria online/).check();
  await addAtEnd(page, "Depoimento");
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Depoimento", { exact: true }).fill("Finalmente um treino que cabe na minha rotina.");
  await inspector(page).getByLabel("Quem deu o depoimento").fill("Ana, aluna");
  await addAtEnd(page, "Indicadores");
  await panel(page, "Propriedades");
  const first = inspector(page).getByRole("group", { name: "Indicador 1" });
  await first.getByLabel("Número ou passo").fill("01");
  await first.getByLabel("Legenda").fill("Avaliação inicial");
  await inspector(page).getByRole("button", { name: "Remover o indicador 3" }).click();
  await inspector(page).getByRole("button", { name: "Remover o indicador 2" }).click();
  // Two columns: a row container with two column containers, which take blocks by a click (inside the one that is selected).
  await addAtEnd(page, "2 colunas");
  await selectLayer(page, /^Coluna/, 0);
  await addSelected(page, "Título");
  await addSelected(page, "Parágrafo");
  await selectLayer(page, /^Coluna/, 1);
  await addSelected(page, "Botão");
  expect(await layerNames(page)).toEqual([
    "Configurações da página", "Destaque", "Chamada para contato", "Perguntas frequentes", "Serviços", "Depoimento", "Indicadores", "2 colunas", "Coluna", "Título", "Parágrafo", "Coluna", "Botão",
  ]);
  await selectLayer(page, /^Título/);
  await inspector(page).getByLabel("Título", { exact: true }).fill("Treino sem achismo");
  await selectLayer(page, /^Parágrafo/);
  await inspector(page).getByLabel("Parágrafo", { exact: true }).fill("Plano ajustado a cada semana, de acordo com a sua resposta.");
  await selectLayer(page, /^Botão/);
  await inspector(page).getByLabel("Texto do botão").fill("Chamar no WhatsApp");
  await inspector(page).getByLabel("O botão leva a").selectOption({ label: "Um contato" });
  await inspector(page).getByLabel("Contato de destino", { exact: true }).selectOption({ label: "WhatsApp" });

  // The style of the row: the gap and a background, written as typed values; what is out of range is not taken.
  await selectLayer(page, /^2 colunas/);
  await styleTab(page).click();
  // The style is the computer's (a phone starts on its own size): the sheet below is the base, the sizes are the next scenario.
  await inspector(page).getByRole("button", { name: "Estilo do computador" }).click();
  const gap = inspector(page).getByLabel("Espaço entre os blocos", { exact: true });
  await gap.fill("32");
  await inspector(page).locator("summary", { hasText: "Fundo" }).click();
  await inspector(page).getByRole("button", { name: "Cor de fundo: Destaque suave" }).click();
  await panel(page, "Página");
  const row = stage(page).locator('.site-main > [data-type="box"]');
  await expect(row).toHaveCSS("gap", "32px");
  await expect(row).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await panel(page, "Propriedades");
  await gap.fill("999");
  await expect(gap).toHaveAttribute("aria-invalid", "true");
  await panel(page, "Página");
  await expect(row).toHaveCSS("gap", "32px");
  await panel(page, "Propriedades");
  await gap.blur();
  await expect(gap).toHaveValue("32");
  await expect(gap).not.toHaveAttribute("aria-invalid", "true");
  await contentTab(page).click();

  // Order: the call to action goes to the end (down, down, ... with the block's own buttons).
  await selectLayer(page, /Chamada para contato/);
  for (let i = 0; i < 5; i++) await inspector(page).getByRole("button", { name: "Abaixo" }).click();
  await expect(inspector(page).getByRole("button", { name: "Abaixo" })).toBeDisabled();
  expect((await layerNames(page)).filter((name) => !["Título", "Parágrafo", "Botão", "Coluna"].includes(name))).toEqual([
    "Configurações da página", "Destaque", "Perguntas frequentes", "Serviços", "Depoimento", "Indicadores", "2 colunas", "Chamada para contato",
  ]);

  // A link that goes to another block of the page (an anchor), after everything else.
  await addAtEnd(page, "Link");
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Texto do link").fill("Ver os serviços");
  await inspector(page).getByLabel("O link leva a").selectOption({ label: "Outro bloco desta página" });
  await inspector(page).getByLabel("Bloco de destino").selectOption({ label: "Serviços · Serviços" });

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

  // The preview inside the editor is the page as it will be published, in the frame of the size being edited and, side by side, of another.
  await panel(page, "Página");
  await editor(page).getByRole("button", { name: "Prévia", exact: true }).click();
  await expect(stage(page).getByRole("link", { name: "Falar comigo" })).toHaveAttribute("href", "https://wa.me/5511912345678");
  await expect(stage(page).getByRole("heading", { name: "Consultoria online", level: 3 })).toBeVisible();
  await expect(stage(page).locator(".ve-tools")).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Mostrar o quadro do tablet" }).click();
  await expect(stage(page).locator("[data-frame]")).toHaveCount(2);
  await expect(stage(page).locator('[data-frame="tablet"]').getByRole("heading", { name: "Consultoria online", level: 3 })).toBeVisible();
  await editor(page).getByRole("button", { name: "Mostrar o quadro do tablet" }).click();
  await expect(stage(page).locator("[data-frame]")).toHaveCount(1);
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
  // The link goes to the block it was given, by an anchor that is on the page.
  const jump = anonymous.page.getByRole("link", { name: "Ver os serviços" });
  const anchor = (await jump.getAttribute("href"))!;
  expect(anchor).toMatch(/^#s-[a-z0-9-]+$/);
  await expect(anonymous.page.locator(anchor)).toContainText("Consultoria online");
  // The style of the row reaches the page by a sheet from the page's own address: nothing of the page has a style attribute or a style element (the framework's own scripts and tools are not the page).
  const sheet = anonymous.page.locator('link[rel="stylesheet"][href*="/estilo.css"]');
  await expect(sheet).toHaveCount(1);
  await expect(anonymous.page.locator(".site-main > .site-box").first()).toHaveCSS("gap", "32px");
  await expect(anonymous.page.locator(".site-main > .site-box").first()).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(anonymous.page.locator(".site[style], .site [style], .site style")).toHaveCount(0);
  const sheetUrl = new URL((await sheet.getAttribute("href"))!, anonymous.page.url()).toString();
  const css = await anonymous.page.request.get(sheetUrl);
  expect(css.status()).toBe(200);
  expect(css.headers()["content-type"]).toContain("text/css");
  expect(css.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await css.text()).toMatch(/^\.site \.s-[a-z0-9-]+\.s-[a-z0-9-]+\.s-[a-z0-9-]+\{[^{}]*gap:32px[^{}]*\}/m);
  expect((await anonymous.page.request.get(sheetUrl, { headers: { "If-None-Match": css.headers()["etag"] } })).status()).toBe(304);
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
  expect((await anonymous.page.request.get(sheetUrl)).status()).toBe(404);
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
test("blocks go from the library into the tree: between blocks, into containers at any depth; by the handle and by the layers; a container does not go into itself", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Dragging is for a pointer; the phone adds and moves blocks with buttons, which the scenario above does.");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Arrasto ${unique}`, "Marina Arrasto");
  await page.goto("./profissional/meu-site");
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await openEditor(page);

  const tile = (name: string) => library(page).getByRole("button", { name: `Acrescentar ${name}`, exact: true });
  const onPage = (type: string) => stage(page).locator(`.site-main > [data-type="${type}"]`);
  const typesOf = (container: Locator) => container.locator(":scope > [data-block-id]").evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.type));
  const order = () => typesOf(stage(page).locator(".site-main"));
  const near = async (target: Locator, edge: "top" | "bottom") => ({ x: 40, y: edge === "top" ? 2 : (await target.boundingBox())!.height - 2 });

  // Dropped on the lower half of a block, it goes after it; on the upper half, before; and it is the one selected.
  expect(await order()).toEqual(["hero", "cta"]);
  await tile("Perguntas frequentes").dragTo(onPage("hero"), { targetPosition: { x: 200, y: (await onPage("hero").boundingBox())!.height - 10 } });
  expect(await order()).toEqual(["hero", "faq", "cta"]);
  await tile("Depoimento").dragTo(onPage("hero"), { targetPosition: { x: 200, y: 8 } });
  expect(await order()).toEqual(["quote", "hero", "faq", "cta"]);
  await expect(stage(page).locator(".ve-select .ve-chip")).toHaveText("Depoimento");
  // The outline of the selected block is over the block itself, measured from the page as drawn.
  const outline = (await stage(page).locator(".ve-select").boundingBox())!;
  const drawn = (await onPage("quote").boundingBox())!;
  for (const [a, b] of [[outline.x, drawn.x], [outline.y, drawn.y], [outline.width, drawn.width], [outline.height, drawn.height]]) expect(Math.abs(a - b)).toBeLessThan(2);

  // A block that is there moves by its handle, and keeps what was written in it.
  await onPage("faq").locator(".site-editable").first().dblclick();
  await page.keyboard.type("Perguntas do arrasto");
  await page.keyboard.press("Enter");
  await expect(onPage("faq").getByText("Perguntas do arrasto")).toBeVisible();
  await onPage("faq").click({ position: { x: 20, y: 40 } });
  await stage(page).getByRole("button", { name: "Arrastar Perguntas frequentes" }).dragTo(onPage("quote"), { targetPosition: { x: 200, y: 8 } });
  expect(await order()).toEqual(["faq", "quote", "hero", "cta"]);
  await expect(onPage("faq").getByText("Perguntas do arrasto")).toBeVisible();

  // Two columns come as a row of two empty columns; each takes what is dropped in it, and any kind of block fits (a section too).
  await tile("2 colunas").dragTo(onPage("cta"), { targetPosition: { x: 200, y: 8 } });
  expect(await order()).toEqual(["faq", "quote", "hero", "box", "cta"]);
  const row = onPage("box");
  const columns = row.locator(':scope > [data-type="box"]');
  await expect(columns).toHaveCount(2);
  await expect(stage(page).locator("[data-empty]")).toHaveCount(2);
  await tile("Título").dragTo(columns.nth(0));
  await expect(stage(page).locator("[data-empty]")).toHaveCount(1);
  await tile("Botão").dragTo(columns.nth(1));
  await expect(stage(page).locator("[data-empty]")).toHaveCount(0);
  const heading = columns.nth(0).locator(':scope > [data-type="heading"]');
  await tile("Parágrafo").dragTo(heading, { targetPosition: await near(heading, "top") });
  expect(await typesOf(columns.nth(0))).toEqual(["paragraph", "heading"]);
  await tile("Serviços").dragTo(heading, { targetPosition: await near(heading, "bottom") });
  expect(await typesOf(columns.nth(0))).toEqual(["paragraph", "heading", "services"]);
  expect(await order()).toEqual(["faq", "quote", "hero", "box", "cta"]);

  // From one column to the other by the handle, as a row of blocks side by side (the line goes by the row's own direction).
  await columns.nth(0).locator(':scope > [data-type="paragraph"]').click({ position: { x: 20, y: 6 } });
  const button = columns.nth(1).locator(':scope > [data-type="button"]');
  await stage(page).getByRole("button", { name: "Arrastar Parágrafo" }).dragTo(button, { targetPosition: await near(button, "top") });
  expect(await typesOf(columns.nth(1))).toEqual(["paragraph", "button"]);
  expect(await typesOf(columns.nth(0))).toEqual(["heading", "services"]);

  // A container does not go into itself, nor into what it holds: nothing changes.
  await selectLayer(page, /^2 colunas/);
  const before = await layerNames(page);
  await stage(page).getByRole("button", { name: "Arrastar 2 colunas" }).dragTo(columns.nth(0));
  await stage(page).getByRole("button", { name: "Arrastar 2 colunas" }).dragTo(heading);
  expect(await layerNames(page)).toEqual(before);
  expect(await order()).toEqual(["faq", "quote", "hero", "box", "cta"]);

  // The layers are a tree, and it takes drags too: a layer dropped on the middle of a container goes inside it, at the end.
  const layerRow = (text: RegExp | string) => library(page).locator(".ve-layer-row").filter({ hasText: text });
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Camadas", exact: true }).click();
  expect(await layerNames(page)).toEqual(["Configurações da página", "Perguntas frequentes", "Depoimento", "Destaque", "2 colunas", "Coluna", "Título", "Serviços", "Coluna", "Parágrafo", "Botão", "Chamada para contato"]);
  await layerRow("Perguntas frequentes").dragTo(layerRow(/^Coluna/).first());
  expect(await order()).toEqual(["quote", "hero", "box", "cta"]);
  expect(await typesOf(columns.nth(0))).toEqual(["heading", "services", "faq"]);
  await expect(columns.nth(0).locator(':scope > [data-type="faq"]').getByText("Perguntas do arrasto")).toBeVisible();
  // Before and after a layer: the upper part of a row puts it before.
  await layerRow("Depoimento").dragTo(layerRow("Chamada para contato"), { targetPosition: { x: 60, y: 30 } });
  expect(await order()).toEqual(["hero", "box", "cta", "quote"]);
  // A container opens and closes in the list.
  await library(page).getByRole("button", { name: "Fechar 2 colunas" }).click();
  expect(await layerNames(page)).toEqual(["Configurações da página", "Destaque", "2 colunas", "Chamada para contato", "Depoimento"]);
  await library(page).getByRole("button", { name: "Abrir 2 colunas" }).click();
  expect((await layerNames(page)).length).toBe(12);

  // Writing straight on the page: double click, type, Enter keeps it; Escape gives it up; the panel agrees.
  const title = columns.nth(0).locator('[data-type="heading"] .site-editable');
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

  // Selecting by a click on the page selects the innermost block; the way up is the trail above the settings, or the layers.
  await title.click();
  await expect(inspector(page).getByRole("heading", { name: "Título", level: 2 })).toBeVisible();
  await inspector(page).getByRole("navigation", { name: "Onde este bloco está" }).getByRole("button", { name: /^Coluna/ }).click();
  await expect(inspector(page).getByRole("heading", { name: "Coluna", level: 2 })).toBeVisible();
  await expect(stage(page).locator(".ve-select .ve-chip")).toHaveText("Coluna");
  await onPage("quote").click({ position: { x: 20, y: 40 } });
  await expect(inspector(page).getByRole("heading", { name: "Depoimento", level: 2 })).toBeVisible();
  await stage(page).locator(".ve-canvas").click({ position: { x: 4, y: 4 } });
  await expect(inspector(page).getByRole("heading", { name: "Página", level: 2 })).toBeVisible();

  // Grouping wraps a block in a container where it stands, and ungrouping takes the container away again.
  await onPage("quote").click({ position: { x: 20, y: 40 } });
  await stage(page).getByRole("button", { name: "Agrupar Depoimento em um contêiner" }).click();
  expect(await order()).toEqual(["hero", "box", "cta", "box"]);
  await expect(inspector(page).getByRole("heading", { name: "Contêiner", level: 2 })).toBeVisible();
  await inspector(page).getByRole("button", { name: "Desagrupar" }).click();
  expect(await order()).toEqual(["hero", "box", "cta", "quote"]);

  // Nothing is saved until asked: after saving and reloading, the tree is as it was left.
  await expect(editor(page).getByText("Alterações não salvas")).toBeVisible();
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo.")).toBeVisible();
  await closeEditor(page);
  await page.reload();
  await openEditor(page);
  expect(await order()).toEqual(["hero", "box", "cta", "quote"]);
  expect(await typesOf(columns.nth(0))).toEqual(["heading", "services", "faq"]);
  expect(await typesOf(columns.nth(1))).toEqual(["paragraph", "button"]);
  await expect(columns.nth(0).locator('[data-type="heading"] .site-editable')).toHaveText("Título escrito na página");
});
});
