import { test, expect, type Page } from "@playwright/test";
import { newActor } from "./helpers";
import { addAtEnd, closeEditor, editor, inspector, library, panel, startEditor as startSite, showTab } from "./site-helpers";

const startEditor = (page: Page) => startSite(page, "Marina Mensagens");
const field = (page: Page, label: string) => inspector(page).getByRole("textbox", { name: label, exact: true });
const save = async (page: Page) => {
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo (revisão", { exact: false })).toBeVisible();
};
/** Publishes from the editor, with the warnings the page has (the form of a site that is not receiving messages yet is one of them). */
async function publishAnyway(page: Page, number: number) {
  await editor(page).getByRole("button", { name: /^Publicar( nova versão)?$/ }).click();
  const anyway = editor(page).getByRole("button", { name: "Publicar mesmo assim" });
  if (await anyway.isVisible({ timeout: 3000 }).catch(() => false)) await anyway.click();
  await expect(editor(page).getByText(`Publicado: o site está no ar na versão ${number}.`)).toBeVisible();
}
const messages = (page: Page) => page.getByRole("region", { name: "Mensagens do site" });
/** What a visitor sees and does: the form of a published page. */
const fill = async (visitor: Page, who: { name: string; contact: string; message?: string }) => {
  await visitor.getByLabel("Nome", { exact: true }).fill(who.name);
  await visitor.getByLabel("E-mail ou telefone com DDD").fill(who.contact);
  if (who.message) await visitor.getByLabel("Mensagem (opcional)").fill(who.message);
  // There is no box to tick (decision of 03/11/2026).
  await expect(visitor.locator("form.site-form").first().getByRole("checkbox")).toHaveCount(0);
};

test("contact form: a block in the editor, a sample there, a plain form on the public page as soon as it is published (sites are born receiving), whose messages wait in Leads until the professional turns them into a lead or deletes them", async ({
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

  // ---- the block: in the library, a title, the fields that are the tool's, and a sample on the canvas ----
  await addAtEnd(page, "Formulário de contato");
  await panel(page, "Propriedades");
  await field(page, "Título do formulário").fill("Escreva para mim");
  const sample = editor(page).getByRole("main", { name: "Página" }).locator('[data-frame="desktop"]');
  await expect(sample.getByRole("heading", { name: "Escreva para mim" })).toBeVisible();
  await expect(sample.getByText("Amostra: o formulário só funciona na página publicada")).toBeVisible();
  await expect(sample.locator("fieldset[disabled]")).toHaveCount(1);
  await expect(inspector(page).getByText("Os campos (nome, e-mail ou telefone e mensagem) são os da ferramenta")).toBeVisible();
  // A second page with its own form, to send from a page that is not the home page.
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Páginas", exact: true }).click();
  await library(page).getByRole("button", { name: "Nova página" }).click();
  await panel(page, "Propriedades");
  await inspector(page).getByRole("textbox", { name: "Título da página", exact: true }).fill("Fale conosco");
  await addAtEnd(page, "Formulário de contato");
  await panel(page, "Propriedades");
  await field(page, "Título do formulário").fill("Mande a sua dúvida");
  await save(page);

  // ---- publishing: a new site already receives messages, so nothing warns about the form ----
  await editor(page).getByRole("button", { name: /^Publicar( nova versão)?$/ }).click();
  const anyway = editor(page).getByRole("button", { name: "Publicar mesmo assim" });
  if (await anyway.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(editor(page).getByRole("list", { name: "Avisos antes de publicar" })).not.toContainText("recebimento de mensagens");
    await anyway.click();
  }
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();
  await closeEditor(page);
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;

  // ---- the switch of the site: the forms are open by default (no variable in this run), and the site's own switch is born on ----
  await showTab(page, "Formulários e mensagens");
  await expect(messages(page)).toContainText("Formulários abertos pela plataforma");
  await showTab(page, "Formulários e mensagens");
  await expect(messages(page)).toContainText("Recebimento ligado");
  await expect(messages(page).getByText(/parecer jurídico|aviso de privacidade público/)).toHaveCount(0);

  // ---- the visitor: a plain form on the home page ----
  await visitor.goto(`./s/${slug}`);
  const form = visitor.locator("form.site-form");
  await expect(form).toHaveCount(1);
  await expect(visitor.getByRole("heading", { name: "Escreva para mim" })).toBeVisible();
  await expect(form).toHaveAttribute("method", "post");
  // The bait is out of the window (not display:none, which a clever program would skip), out of the reach of a screen reader and of the keyboard.
  const bait = form.locator('input[name="empresa_extra"]');
  expect((await bait.boundingBox())!.x).toBeLessThan(-5000);
  await expect(form.locator(".site-form-bait")).toHaveAttribute("aria-hidden", "true");
  await expect(bait).toHaveAttribute("tabindex", "-1");
  // No privacy notice is configured in this run: there is no link to one, and no box.
  await expect(visitor.getByRole("link", { name: /aviso de privacidade/i })).toHaveCount(0);
  await expect(form.getByRole("checkbox")).toHaveCount(0);
  await expect(visitor.locator("script[src*='forms'], form script")).toHaveCount(0);
  await fill(visitor, { name: "Ana Souza", contact: "ana@example.test", message: "Quero saber dos planos.\nPode ser online?" });
  await visitor.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/m/enviado$`));
  await expect(visitor.getByRole("heading", { name: "Mensagem enviada" })).toBeVisible();
  await visitor.getByRole("link", { name: "Voltar ao site" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}$`));

  // ---- from another page of the site: the message says which page it came from, and the way back is that page ----
  await visitor.goto(`./s/${slug}/fale-conosco`);
  await expect(visitor.getByRole("heading", { name: "Mande a sua dúvida" })).toBeVisible();
  await fill(visitor, { name: "Bia Lima", contact: "(11) 98888-7777" });
  await visitor.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/m/enviado\\?pagina=fale-conosco$`));
  await visitor.getByRole("link", { name: "Voltar ao site" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/s/${slug}/fale-conosco$`));

  // ---- what the form refuses, said by the server whatever the browser did ----
  const raw = (fields: Record<string, string>) => visitor.request.post(`./s/${slug}/m/contato`, { form: fields, maxRedirects: 0 });
  expect((await raw({ nome: "A", contato: "x@example.test" })).status()).toBe(400);
  expect((await raw({ nome: "Caio Reis", contato: "não é contato" })).status()).toBe(400);
  const program = await raw({ nome: "Robô", contato: "robo@example.test", empresa_extra: "http://spam.example" });
  expect(program.status()).toBe(303);

  // ---- the professional: the messages wait in Leads, not as leads ----
  await page.goto("./profissional/leads");
  await expect(page.getByRole("heading", { name: "Seu primeiro lead começa aqui." })).toBeVisible();
  await page.getByRole("link", { name: "Mensagens do site (2)" }).click();
  await expect(page.getByRole("heading", { name: "Mensagens do site", level: 1 })).toBeVisible();
  const inbox = page.getByRole("list", { name: "Mensagens do site" });
  await expect(inbox.getByRole("listitem")).toHaveCount(2);
  const ana = inbox.getByRole("listitem").filter({ hasText: "Ana Souza" });
  await expect(ana).toContainText("ana@example.test");
  await expect(ana).toContainText("da página inicial");
  await expect(ana.locator(".inquiry-message")).toHaveText("Quero saber dos planos.\nPode ser online?");
  const bia = inbox.getByRole("listitem").filter({ hasText: "Bia Lima" });
  await expect(bia).toContainText("(11) 98888-7777");
  await expect(bia).toContainText("da página /fale-conosco");
  await expect(bia).toContainText("Sem mensagem: só o contato.");
  await expect(page.getByText("Não registre aqui dados de saúde")).toHaveCount(0);

  // ---- a message becomes a lead of origin Site, once; the other is deleted after a confirmation ----
  await ana.getByRole("button", { name: "Virar lead" }).click();
  await expect(page.getByText("A mensagem virou um lead, com origem Site.")).toBeVisible();
  await expect(inbox.getByRole("listitem")).toHaveCount(1);
  await bia.getByRole("button", { name: "Apagar a mensagem de Bia Lima" }).click();
  await bia.getByRole("button", { name: "Confirmar: apagar a mensagem de Bia Lima" }).click();
  await expect(page.getByRole("heading", { name: "Nenhuma mensagem esperando." })).toBeVisible();
  await page.goto("./profissional/leads");
  const row = page.getByRole("row").filter({ hasText: "Ana Souza" });
  await expect(row).toContainText("Site");
  await expect(row).toContainText("ana@example.test");
  await expect(page.getByRole("link", { name: /Mensagens do site/ })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Bia Lima" })).toHaveCount(0);
  // The lead can be edited and keeps where it came from.
  await row.getByRole("link", { name: "Ana Souza" }).click();
  await expect(page.getByText("Site", { exact: true }).first()).toBeVisible();

  // ---- the site stops receiving: the form leaves the page at the next visit and the address refuses ----
  await page.goto("./profissional/meu-site");
  await showTab(page, "Formulários e mensagens");
  await messages(page).getByRole("button", { name: "Desligar o recebimento de mensagens" }).click();
  await showTab(page, "Formulários e mensagens");
  await expect(messages(page).getByText("O site parou de receber as mensagens do formulário.")).toBeVisible();
  await visitor.goto(`./s/${slug}`);
  await expect(visitor.locator("form")).toHaveCount(0);
  expect((await raw({ nome: "Depois", contato: "depois@example.test" })).status()).toBe(404);
  await showTab(page, "Formulários e mensagens");
  await expect(messages(page)).toContainText("Recebimento desligado");
  await visit.context.close();
});

test("contact form on a phone: the inbox and the switch are read and used on the small screen", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The computer has its own scenario above.");
  test.setTimeout(240_000);
  const slug = await startEditor(page);
  await panel(page, "Propriedades");
  await field(page, "WhatsApp").fill("(11) 91234-5678");
  await save(page);
  await publishAnyway(page, 1);
  await closeEditor(page);
  // A new site is born receiving messages.
  await showTab(page, "Formulários e mensagens");
  await expect(messages(page)).toContainText("Recebimento ligado");
  await expect(messages(page).getByRole("button", { name: "Desligar o recebimento de mensagens" })).toBeVisible();
  // The page has no form block, so a message comes the way a program sends it: the address takes it all the same.
  const visit = await newActor(browser, baseURL);
  expect((await visit.page.request.post(`./s/${slug}/m/contato`, { form: { nome: "Dani Alves", contato: "dani@example.test", mensagem: "Oi" }, maxRedirects: 0 })).status()).toBe(303);
  await visit.context.close();
  await page.goto("./profissional/leads/mensagens");
  const inbox = page.getByRole("list", { name: "Mensagens do site" });
  await expect(inbox.getByRole("listitem")).toHaveCount(1);
  await expect(inbox).toContainText("Dani Alves");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await inbox.getByRole("button", { name: "Virar lead" }).click();
  await expect(page.getByText("A mensagem virou um lead, com origem Site.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir o lead" })).toBeVisible();
  // It was the last message: the answer and the way to the new lead stay, with the empty state under them.
  await expect(page.getByRole("heading", { name: "Nenhuma mensagem esperando." })).toBeVisible();
  await expect(page.getByRole("list", { name: "Mensagens do site" })).toHaveCount(0);
});
