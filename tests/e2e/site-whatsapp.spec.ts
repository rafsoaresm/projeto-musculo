import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor } from "./helpers";
import { showTab } from "./site-helpers";

const MESSAGE = "Olá! Gostaria de conhecer seus treinos.";
const guided = (page: Page) => page.getByRole("dialog", { name: "Editor Guiado" });
const messages = (page: Page) => page.getByRole("region", { name: "Mensagens do site" });

/** A professional whose site is the Energia model, with a WhatsApp number, published. */
async function publishedModel(page: Page, owner: string) {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, owner);
  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Guiado" }).click();
  const form = page.getByRole("form", { name: "Criar o meu site" });
  await form.getByLabel("Título do site").fill(owner);
  await expect(form.getByRole("radio", { name: /^Energia/ })).toBeChecked();
  await form.getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();
  await page.getByRole("region", { name: "Páginas do site" }).getByRole("button", { name: "Abrir o Editor Guiado" }).click();
  const editor = guided(page);
  await editor.getByRole("navigation", { name: "Seções do site" }).getByRole("button", { name: "Rodapé do site", exact: true }).click();
  const footer = editor.getByRole("region", { name: "Rodapé do site" });
  await footer.getByLabel("WhatsApp", { exact: true }).fill("(11) 91234-5678");
  // The model starts asking first, with the handoff's opening message; the platform of this run has the forms open, the site has not yet.
  const buttons = footer.getByRole("group", { name: "Botões do WhatsApp" });
  await expect(buttons.getByLabel("Mensagem que já vai escrita na conversa (opcional)")).toHaveValue(MESSAGE);
  await expect(buttons.getByRole("checkbox", { name: "Pedir o nome e o celular antes de abrir o WhatsApp" })).toBeChecked();
  await expect(buttons.getByRole("checkbox", { name: /Perguntar também o objetivo/ })).toBeChecked();
  await expect(buttons.getByRole("status")).toContainText("o recebimento de mensagens estiver ligado no site");
  await editor.getByRole("button", { name: "Salvar rascunho" }).first().click();
  await expect(editor.getByText("Rascunho salvo.")).toBeVisible();
  await editor.getByRole("tablist", { name: "Partes do Editor Guiado" }).getByRole("tab", { name: "Publicar" }).click();
  const publish = editor.getByRole("tabpanel");
  await publish.getByRole("button", { name: "Publicar", exact: true }).click();
  // The model's sample photos are always said before publishing (a warning): it is published anyway.
  await expect(editor.getByRole("list", { name: "Avisos antes de publicar" })).toContainText("foto de exemplo do modelo");
  await publish.getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor.getByText(/Publicado: o site está no ar/)).toBeVisible();
  await editor.getByRole("button", { name: "Fechar o Editor Guiado" }).click();
  return `estudio-${unique}`;
}

test("WhatsApp: the buttons go straight while the site does not receive messages; once it does, they open a form whose lead is kept before WhatsApp opens", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(300_000);
  const phone = testInfo.project.name === "mobile";
  const slug = await publishedModel(page, "Marina Energia");
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  // WhatsApp itself is not part of this test: it is answered here when the browser lets the test answer it, and only the address is checked.
  await visit.context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "WhatsApp" }));
  const straight = `https://wa.me/5511912345678?text=${encodeURIComponent(MESSAGE)}`;

  // ---- receiving off: straight to WhatsApp in a new tab, with the opening message; no form on the page ----
  await visitor.goto(`./s/${slug}`);
  const cta = visitor.locator("main a.site-has-icon").first();
  await expect(cta).toHaveAttribute("href", straight);
  await expect(cta).toHaveAttribute("target", "_blank");
  await expect(visitor.locator("#site-whatsapp-form")).toHaveCount(0);
  expect((await visitor.request.post(`./s/${slug}/m/whatsapp`, { form: { nome: "Robô", celular: "11987654321", aceite: "on" }, maxRedirects: 0 })).status()).toBe(404);

  // ---- the site turns its receiving on ----
  await showTab(page, "Formulários e mensagens");
  await messages(page).getByRole("button", { name: "Ligar o recebimento de mensagens" }).click();
  await expect(messages(page)).toContainText("Recebimento ligado");

  // ---- the visitor: the button opens the form over the page, without script; it closes, and opens again ----
  await visitor.reload();
  const dialog = visitor.getByRole("dialog", { name: "Antes de abrir o WhatsApp" });
  await expect(dialog).toBeHidden();
  const header = visitor.locator("header .site-header-cta");
  if (!phone) {
    await expect(header).toHaveAttribute("href", "#site-whatsapp-form");
    await expect(header).not.toHaveAttribute("target", "_blank");
  }
  await cta.click();
  await expect(dialog).toBeVisible();
  await expect(visitor).toHaveURL(/#site-whatsapp-form$/);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const box = (await dialog.locator(".site-wa-dialog").boundingBox())!;
  const view = visitor.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  // With the page's script: the focus is in the first field, the page behind is out of reach, Escape closes and the focus goes back.
  await expect(dialog.getByLabel("Nome", { exact: true })).toBeFocused();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(visitor.locator(".site > main")).toHaveJSProperty("inert", true);
  await visitor.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(cta).toBeFocused();
  await expect(visitor.locator(".site > main")).toHaveJSProperty("inert", false);
  await cta.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("link", { name: "Fechar e voltar à página" }).click();
  await expect(dialog).toBeHidden();
  // The contact section of the model is this same form: it is sent to the WhatsApp address.
  await expect(visitor.locator("section.site-contact-form form")).toHaveAttribute("action", /\/m\/whatsapp$/);
  await cta.click();
  await expect(dialog).toBeVisible();

  // ---- the browser holds back an empty form and a landline, with the form still open; the server says what is wrong when the browser is passed by ----
  await dialog.getByRole("button", { name: "Continuar no WhatsApp" }).click();
  await expect(visitor).toHaveURL(/#site-whatsapp-form$/);
  await dialog.getByLabel("Celular com DDD").fill("(11) 3456-7890");
  expect(await dialog.getByLabel("Celular com DDD").evaluate((input) => (input as HTMLInputElement).validity.patternMismatch)).toBe(true);
  const raw = (fields: Record<string, string>) => visitor.request.post(`./s/${slug}/m/whatsapp`, { form: fields, maxRedirects: 0 });
  const landline = await raw({ nome: "Ana Souza", celular: "(11) 3456-7890", aceite: "on" });
  expect(landline.status()).toBe(400);
  expect(await landline.text()).toContain("celular com DDD");
  expect((await raw({ nome: "Ana Souza", celular: "(11) 98765-4321" })).status()).toBe(400);

  // ---- sent: kept first, then WhatsApp in the same tab with the professional's message only ----
  await dialog.getByLabel("Nome", { exact: true }).fill("Ana Souza");
  await dialog.getByLabel("Celular com DDD").fill("(11) 98765-4321");
  await dialog.getByLabel("Seu objetivo (opcional)").fill("Ganhar força");
  const notice = dialog.getByRole("link", { name: "aviso de privacidade" });
  await expect(notice).toHaveAttribute("href", /\/aviso-de-privacidade-de-teste$/);
  await dialog.getByRole("checkbox", { name: /Li o aviso de privacidade/ }).check();
  // The browser is sent to WhatsApp's own address (WhatsApp itself may send it on elsewhere: only the address it was sent to is checked).
  const toWhatsApp = visitor.waitForRequest((request) => request.url().startsWith("https://wa.me/"));
  await dialog.getByRole("button", { name: "Continuar no WhatsApp" }).click();
  expect((await toWhatsApp).url()).toBe(straight);
  await visit.context.close();

  // ---- the professional: the message waits in Leads, saying where it came from ----
  await page.goto("./profissional/leads/mensagens");
  const entry = page.getByRole("list", { name: "Mensagens do site" }).getByRole("listitem").filter({ hasText: "Ana Souza" });
  await expect(entry).toContainText("(11) 98765-4321");
  await expect(entry).toContainText("Veio do formulário antes do WhatsApp");
  await expect(entry).toContainText("Objetivo: Ganhar força");
});
