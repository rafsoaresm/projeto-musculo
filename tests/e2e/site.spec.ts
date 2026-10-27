import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor, noHorizontalOverflow } from "./helpers";

const block = (page: Page, n: number) => page.getByRole("group", { name: new RegExp(`^Bloco ${n}:`) });
const saveBar = (page: Page) => page.getByRole("region", { name: "Salvar o rascunho" });
const state = (page: Page) => page.getByRole("region", { name: "Estado do site" });

test("a professional builds a page, previews it, publishes it, changes it without touching what is public, takes it offline and changes its address", async ({
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
  await expect(block(page, 1)).toBeVisible();
  await expect(block(page, 2)).toBeVisible();
  await noHorizontalOverflow(page);

  // A new site cannot be published: the call to action points to a WhatsApp that is not filled in.
  await state(page).getByRole("button", { name: "Publicar" }).click();
  await expect(state(page).getByRole("list", { name: "O que falta para publicar" })).toContainText("WhatsApp");
  await expect(state(page).getByText("Fora do ar")).toBeVisible();

  // Fill in the contact and the text; what is not saved blocks publishing.
  await page.getByLabel("WhatsApp", { exact: true }).fill("(11) 91234-5678");
  await page.getByLabel("Descrição para buscadores (opcional)").fill("Treino com acompanhamento individual");
  await block(page, 1).getByLabel("Subtítulo").fill("Acompanhamento individual, presencial e online");
  await block(page, 1).getByLabel("Texto do botão").fill("Falar comigo");
  await block(page, 1).getByLabel("O botão leva a").selectOption({ label: "WhatsApp" });
  await expect(saveBar(page).getByText("Há alterações ainda não salvas.")).toBeVisible();
  await expect(state(page).getByRole("button", { name: "Publicar" })).toBeDisabled();
  await expect(state(page).getByText("Salve o rascunho antes de publicar.")).toBeVisible();

  // More blocks: questions and the service, then the questions are moved above the call to action.
  await page.getByLabel("Novo bloco").selectOption({ label: "Perguntas frequentes" });
  await page.getByRole("button", { name: "Acrescentar bloco" }).click();
  const faq = block(page, 3);
  await faq.getByLabel("Pergunta", { exact: true }).fill("Atende online?");
  await faq.getByLabel("Resposta").fill("Sim, por vídeo e pelo aplicativo.");
  await page.getByLabel("Novo bloco").selectOption({ label: "Serviços" });
  await page.getByRole("button", { name: "Acrescentar bloco" }).click();
  await block(page, 4).getByRole("group", { name: "Serviços do bloco 4" }).getByLabel(/Consultoria online/).check();
  await block(page, 4).getByRole("button", { name: "Subir o bloco 4" }).click();
  await block(page, 3).getByRole("button", { name: "Subir o bloco 3" }).click();
  await block(page, 4).getByRole("button", { name: "Subir o bloco 4" }).click();
  await expect(block(page, 2).getByLabel("Título da seção")).toHaveValue("Serviços");
  await expect(block(page, 3).getByLabel("Título da seção")).toHaveValue("Perguntas frequentes");
  await saveBar(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(saveBar(page).getByText("Rascunho salvo.")).toBeVisible();
  await expect(saveBar(page).getByText(/Rascunho salvo \(revisão 2\)/)).toBeVisible();

  // The preview shows the saved draft, is not indexed, and the page is not public yet.
  await state(page).getByRole("link", { name: "Ver a prévia" }).click();
  await expect(page.getByRole("heading", { name: "Prévia do rascunho", level: 1 })).toBeVisible();
  const previewed = page.getByLabel("Prévia da página");
  await expect(previewed.getByRole("heading", { name: "Marina Site", level: 1 }).or(previewed.getByRole("heading", { level: 1 }))).toBeVisible();
  await expect(previewed.getByText("Atende online?")).toBeVisible();
  await expect(previewed.getByRole("heading", { name: "Consultoria online" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const anonymous = await newActor(browser, baseURL);
  expect((await anonymous.page.request.get(`./s/${slug}`)).status()).toBe(404);

  // Publish: version 1 is public, for anybody, with no session.
  await page.getByRole("link", { name: "Voltar ao editor" }).click();
  await state(page).getByRole("button", { name: "Publicar" }).click();
  await expect(state(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();
  await expect(state(page).getByText("No ar", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Versões publicadas" }).getByText("Versão 1")).toBeVisible();
  await expect(state(page).getByText("Endereço:")).toContainText(`/s/${slug}`);

  await anonymous.page.goto(`./s/${slug}`);
  await expect(anonymous.page.getByRole("heading", { level: 1 })).toContainText("Estúdio");
  await expect(anonymous.page).toHaveTitle(/Estúdio/);
  await expect(anonymous.page.locator('meta[name="description"]')).toHaveAttribute("content", "Treino com acompanhamento individual");
  await expect(anonymous.page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
  await expect(anonymous.page.getByRole("link", { name: "Falar comigo" })).toHaveAttribute("href", "https://wa.me/5511912345678");
  await expect(anonymous.page.getByRole("heading", { name: "Consultoria online", level: 3 })).toBeVisible();
  await expect(anonymous.page.getByText("Plano mensal com ajustes por vídeo")).toBeVisible();
  await anonymous.page.getByText("Atende online?").click();
  await expect(anonymous.page.getByText("Sim, por vídeo e pelo aplicativo.")).toBeVisible();
  const headings = await anonymous.page.locator("main h2").allInnerTexts();
  expect(headings).toEqual(["Serviços", "Perguntas frequentes", "Fale comigo"]);
  // Nothing of the tool, nothing from elsewhere: no form, no image, and every script is the app's own.
  await expect(anonymous.page.locator("form, img, iframe")).toHaveCount(0);
  const origin = new URL(anonymous.page.url()).origin;
  for (const src of await anonymous.page.locator("script[src]").evaluateAll((nodes) => nodes.map((n) => (n as HTMLScriptElement).src)))
    expect(new URL(src, origin).origin, src).toBe(origin);
  await expect(anonymous.page.getByText("Minha conta")).toHaveCount(0);
  await noHorizontalOverflow(anonymous.page);
  expect((await anonymous.page.request.get("./s/nao-existe")).status()).toBe(404);
  expect((await anonymous.page.request.get("./s/..%2Fprofissional")).status()).toBe(404);

  // Editing the draft does not reach what is public until the next publication.
  await page.getByLabel("Título do site").fill("Título novo ainda sem publicar");
  await saveBar(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(saveBar(page).getByText("Rascunho salvo.")).toBeVisible();
  await expect(state(page).getByText("Há alterações salvas que ainda não foram publicadas.")).toBeVisible();
  await anonymous.page.reload();
  await expect(anonymous.page.getByText("Título novo ainda sem publicar")).toHaveCount(0);
  await state(page).getByRole("button", { name: "Publicar uma nova versão" }).click();
  await expect(state(page).getByText("Publicado: o site está no ar na versão 2.")).toBeVisible();
  await anonymous.page.reload();
  await expect(anonymous.page.getByText("Título novo ainda sem publicar").first()).toBeVisible();

  // An earlier version comes back as the draft (and asks first); the public page stays on version 2.
  const versions = page.getByRole("region", { name: "Versões publicadas" });
  await versions.getByRole("button", { name: "Usar a versão 1 como rascunho" }).click();
  await versions.getByRole("button", { name: /Confirmar: usar a versão 1 como rascunho/ }).click();
  await expect(versions.getByText("A versão voltou para o rascunho.")).toBeVisible();
  await expect(page.getByLabel("Título do site")).toHaveValue(new RegExp(`Estúdio ${unique}`));
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
