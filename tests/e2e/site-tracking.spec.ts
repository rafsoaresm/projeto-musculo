import { test, expect, type Page, type Request } from "@playwright/test";
import { createProfessional, localIP, newActor, policyRefusals, trackPolicy } from "./helpers";
import { showTab } from "./site-helpers";

/**
 * Meu Site 0.71: the tagging of a published site. The tools' own addresses never reach the internet in this test: googletagmanager.com/gtag/js and
 * connect.facebook.net/.../fbevents.js are answered with tiny stand-ins that record what the page asks of them, and every other host of the
 * tools is answered empty. Real delivery to GA4, Meta or Google Ads accounts is not verifiable here.
 */
const SHOTS = process.env.T071_SHOTS || "";
const VENDOR = /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com|google\.com|google\.com\.br|googlesyndication\.com|facebook\.net|facebook\.com)\//;
// The stand-in of gtag.js: everything already in the dataLayer and everything pushed later, as plain arrays.
const GTAG_STUB = `(function(){var w=window,dl=w.dataLayer=w.dataLayer||[];w.__gtag=w.__gtag||[];
function rec(a){try{w.__gtag.push(JSON.parse(JSON.stringify(Array.prototype.slice.call(a))))}catch(e){}}
for(var i=0;i<dl.length;i++)rec(dl[i]);var push=dl.push;dl.push=function(){for(var i=0;i<arguments.length;i++)rec(arguments[i]);return push.apply(dl,arguments)};})();`;
// The stand-in of fbevents.js: the queue the page built before it, and every later call.
const FBQ_STUB = `(function(){var w=window,f=w.fbq;w.__fbq=[];function rec(a){w.__fbq.push(JSON.parse(JSON.stringify(Array.prototype.slice.call(a))))}
for(var i=0;i<f.queue.length;i++)rec(f.queue[i]);f.queue=[];f.callMethod=function(){rec(arguments)};})();`;

const guided = (page: Page) => page.getByRole("dialog", { name: "Editor Guiado" });
const messages = (page: Page) => page.getByRole("region", { name: "Mensagens do site" });
const panel = (page: Page) => page.getByRole("region", { name: "Rastreamento e conversões" });
/** The consent banner of the first 0.71: it is gone (decision of 03/11/2026), and the tests check that it stays gone. */
const banner = (page: Page) => page.getByRole("dialog", { name: "Cookies e medição deste site" });

/** A professional whose site is the Energia model, with a WhatsApp number its buttons go straight to, published, receiving messages. */
async function publishedSite(page: Page) {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Rastreio");
  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Guiado" }).click();
  const form = page.getByRole("form", { name: "Criar o meu site" });
  await form.getByLabel("Título do site").fill("Marina Rastreio");
  await form.getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();
  await page.getByRole("region", { name: "Páginas do site" }).getByRole("button", { name: "Abrir o Editor Guiado" }).click();
  const editor = guided(page);
  await editor.getByRole("navigation", { name: "Seções do site" }).getByRole("button", { name: "Rodapé do site", exact: true }).click();
  const footer = editor.getByRole("region", { name: "Rodapé do site" });
  await footer.getByLabel("WhatsApp", { exact: true }).fill("(11) 91234-5678");
  // Straight to WhatsApp (a click to measure), and the contact section becomes the plain contact form (a message to convert).
  await footer.getByRole("group", { name: "Botões do WhatsApp" }).getByRole("checkbox", { name: "Pedir o nome e o celular antes de abrir o WhatsApp" }).uncheck();
  await editor.getByRole("button", { name: "Salvar rascunho" }).first().click();
  await expect(editor.getByText("Rascunho salvo.")).toBeVisible();
  await editor.getByRole("tablist", { name: "Partes do Editor Guiado" }).getByRole("tab", { name: "Publicar" }).click();
  const publish = editor.getByRole("tabpanel");
  await publish.getByRole("button", { name: "Publicar", exact: true }).click();
  // The model's sample photos are always said before publishing (a warning): it is published anyway.
  await expect(editor.getByRole("list", { name: "Avisos antes de publicar" })).toBeVisible();
  await publish.getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor.getByText(/Publicado: o site está no ar/)).toBeVisible();
  await editor.getByRole("button", { name: "Fechar o Editor Guiado" }).click();
  // A new site is born receiving messages.
  await showTab(page, "Formulários e mensagens");
  await expect(messages(page)).toContainText("Recebimento ligado");
  return `estudio-${unique}`;
}

const calls = (page: Page, name: "__gtag" | "__fbq") => page.evaluate((key) => ((window as unknown as Record<string, unknown[]>)[key] ?? []) as unknown[][], name);
const events = async (page: Page, event: string) => (await calls(page, "__gtag")).filter((call) => call[0] === "event" && call[1] === event).map((call) => call[2] as Record<string, unknown>);
const tracks = async (page: Page, event: string) => (await calls(page, "__fbq")).filter((call) => call[0] === "track" && call[1] === event);

test("tagging: configured in the panel, the tools load with the page (no banner, no consent calls), then the events and the conversions once", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(360_000);
  const phone = testInfo.project.name === "mobile";
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  const slug = await publishedSite(page);

  // ---- the panel: in Configurações, the GTM field off with the reason, an ID of the wrong tool refused next to its field ----
  await showTab(page, "Configurações");
  const settings = panel(page);
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("Nenhuma ferramenta ligada");
  await expect(settings).toContainText("As ferramentas que você configurar carregam junto com a página");
  await expect(settings).not.toContainText("revisão jurídica");
  const gtm = settings.getByLabel("ID do contêiner do GTM");
  await expect(gtm).toBeDisabled();
  await expect(settings).toContainText("O Google Tag Manager fica disponível quando o seu site tiver um endereço próprio, separado do app (por segurança: um contêiner do GTM pode rodar qualquer código)");
  const ga4 = settings.getByLabel("ID de medição do GA4");
  await ga4.fill("GTM-ABC1234");
  await settings.getByRole("button", { name: "Salvar rastreamento" }).click();
  await expect(settings.getByText("Esse é um ID do Google Tag Manager (GTM-…)")).toBeVisible();
  await expect(ga4).toHaveAttribute("aria-invalid", "true");
  await expect(settings).toContainText("Nenhuma ferramenta ligada");

  await ga4.fill(" g-test1234 ");
  await settings.getByLabel("ID do Google Ads").fill("AW-123456789");
  await settings.getByLabel("Rótulo da conversão do formulário").fill("LeadLabel1");
  await settings.getByLabel("Rótulo da conversão de contato (opcional)").fill("Contato_22");
  await settings.getByLabel("ID do Meta Pixel").fill("123456789012345");
  await settings.getByLabel("Valor de um contato (opcional, R$)").fill("150,00");
  await settings.getByLabel("Endereço do aviso de privacidade do seu site").fill("https://marina.example/privacidade");
  // What the site does not send is also up to the accounts: the panel says which automatic collections to leave off.
  await expect(settings).toContainText("deixe desligada a “correspondência avançada automática”");
  await expect(settings).toContainText("deixe desligada a “coleta de dados fornecidos pelo usuário”");
  await expect(settings).toContainText("Deixe desligadas as “conversões otimizadas” automáticas");
  await expect(settings.getByRole("checkbox", { name: "Mensagem pelo formulário" })).toBeChecked();
  await expect(settings.getByRole("checkbox", { name: "Clique no WhatsApp" })).toBeChecked();
  await expect(settings.getByRole("checkbox", { name: "Clique no e-mail" })).not.toBeChecked();
  await settings.getByRole("button", { name: "Salvar rastreamento" }).click();
  await expect(settings.getByText("Rastreamento salvo.", { exact: false })).toBeVisible();
  await expect(settings).toContainText("Ativo: GA4, Google Ads, Meta Pixel");
  await expect(settings.getByLabel("ID de medição do GA4")).toHaveValue("G-TEST1234");
  const table = settings.getByRole("table", { name: "Eventos do site por ferramenta" });
  await expect(table.getByRole("row", { name: /Mensagem enviada pelo formulário/ })).toContainText("generate_lead");
  await expect(table.getByRole("row", { name: /Mensagem enviada pelo formulário/ })).toContainText("Lead");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  if (SHOTS) {
    await settings.screenshot({ path: `${SHOTS}/painel-${phone ? 390 : 1280}.png` });
    await page.screenshot({ path: `${SHOTS}/painel-tela-${phone ? 390 : 1280}.png` });
  }

  // ---- the visitor: the tools' hosts are answered by the stand-ins, and every request to them is counted ----
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  if (phone) await visitor.setViewportSize({ width: 390, height: 844 });
  const vendor: string[] = [];
  const problems: string[] = [];
  visitor.on("pageerror", (error) => problems.push(error.message));
  visitor.on("console", (message) => {
    if (message.type() === "error" && /hydrat|did not match/i.test(message.text())) problems.push(message.text());
  });
  await visit.context.route(VENDOR, (route, request: Request) => {
    vendor.push(request.url());
    const url = request.url();
    if (url.startsWith("https://www.googletagmanager.com/gtag/js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: GTAG_STUB });
    if (url === "https://connect.facebook.net/en_US/fbevents.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: FBQ_STUB });
    return route.fulfill({ status: 204, body: "" });
  });
  await visit.context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "WhatsApp" }));

  // ---- the page: gtag.js and fbevents.js load with it, once each; no banner, no "cookie preferences", and no consent call at all ----
  const gtagLoaded = visitor.waitForRequest((request) => request.url().startsWith("https://www.googletagmanager.com/gtag/js?id=G-TEST1234"));
  const fbLoaded = visitor.waitForRequest("https://connect.facebook.net/en_US/fbevents.js");
  await visitor.goto(`./s/${slug}`);
  await expect(visitor.locator("script[src$='/m/rastreio']")).toHaveCount(1);
  await gtagLoaded;
  await fbLoaded;
  await expect(banner(visitor)).toHaveCount(0);
  await expect(visitor.getByRole("button", { name: "Preferências de cookies" })).toHaveCount(0);
  await expect.poll(async () => (await calls(visitor, "__fbq")).length).toBeGreaterThan(0);
  const google = await calls(visitor, "__gtag");
  expect(google.filter((call) => call[0] === "consent")).toEqual([]);
  // Google's cookies are named per site (the sites share the app's address).
  expect(google.filter((call) => call[0] === "config").map((call) => call[2])).toEqual([{ cookie_prefix: `rst_${slug}` }, { cookie_prefix: `rst_${slug}` }]);
  expect(await calls(visitor, "__fbq")).toEqual([["set", "autoConfig", false, "123456789012345"], ["init", "123456789012345"], ["track", "PageView"]]);
  expect(vendor.filter((url) => url.startsWith("https://www.googletagmanager.com/gtag/js"))).toHaveLength(1);
  expect(vendor.filter((url) => url.startsWith("https://connect.facebook.net/"))).toHaveLength(1);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const cta = visitor.locator('main a[href^="https://wa.me"]').first();
  if (SHOTS) await visitor.screenshot({ path: `${SHOTS}/pagina-${phone ? 390 : 1280}.png` });

  // ---- a click on WhatsApp: GA4 contact, Meta Contact and the Ads contact conversion ----
  // The button opens WhatsApp in a new tab (answered by the test); this page stays and sends the events.
  await expect(cta).toHaveAttribute("target", "_blank");
  const popup = visitor.context().waitForEvent("page");
  await cta.click();
  await (await popup).close();
  await expect.poll(async () => (await events(visitor, "contact")).length).toBe(1);
  expect((await events(visitor, "contact"))[0]).toMatchObject({ method: "whatsapp", send_to: "G-TEST1234", transport_type: "beacon" });
  expect(await events(visitor, "conversion")).toEqual([{ send_to: "AW-123456789/Contato_22", transport_type: "beacon", value: 150, currency: "BRL" }]);
  expect((await tracks(visitor, "Contact"))).toHaveLength(1);

  // ---- the contact form: the conversion is on the thank-you page, with the server's one-time id, once ----
  const contact = visitor.locator("section.site-contact-form form, form.site-form").filter({ has: visitor.getByLabel("E-mail ou telefone com DDD") }).first();
  await contact.getByLabel("Nome", { exact: true }).fill("Ana Souza");
  await contact.getByLabel("E-mail ou telefone com DDD").fill("ana@example.test");
  await contact.getByRole("button").last().click();
  await expect(visitor.getByRole("heading", { name: "Mensagem enviada" })).toBeVisible();
  await expect.poll(async () => (await events(visitor, "generate_lead")).length).toBe(1);
  const [lead] = await events(visitor, "generate_lead");
  expect(lead).toEqual({ send_to: "G-TEST1234", transport_type: "beacon", lead_source: "site_form", value: 150, currency: "BRL" });
  const [conversion] = await events(visitor, "conversion");
  expect(conversion).toMatchObject({ send_to: "AW-123456789/LeadLabel1", value: 150, currency: "BRL" });
  expect(String(conversion!.transaction_id)).toMatch(/^[0-9a-f]{32}$/);
  await expect.poll(async () => (await tracks(visitor, "Lead")).length).toBe(1);
  expect((await tracks(visitor, "Lead"))[0]![3]).toEqual({ eventID: conversion!.transaction_id });
  // Nothing the visitor typed went anywhere.
  const sent = JSON.stringify([await calls(visitor, "__gtag"), await calls(visitor, "__fbq")]);
  expect(sent).not.toMatch(/Ana Souza|ana@example\.test/);
  // The id leaves the address once counted, and a reload does not count again.
  await expect(visitor).toHaveURL(/\/m\/enviado$/);
  await visitor.reload();
  await expect(visitor.getByRole("heading", { name: "Mensagem enviada" })).toBeVisible();
  await expect.poll(async () => (await calls(visitor, "__fbq")).length).toBeGreaterThan(0);
  expect(await events(visitor, "generate_lead")).toEqual([]);
  expect(await tracks(visitor, "Lead")).toEqual([]);
  expect(problems).toEqual([]);
  await visit.context.close();
});

// ---- the advanced editor (Frappe): its pages and its thank-you page run the same script under their own strict policy ----

/** What the editor asks of its server, asked the way the editor asks (same origin, with the header that marks its calls). */
const asEditor = async (page: Page, method: string, params: Record<string, unknown>) => {
  const response = await page.request.post(`./api/builder-editor/api/method/${method}`, { headers: { "x-site-request": "1" }, data: params });
  return { status: response.status(), body: (await response.json()) as { message?: Record<string, unknown> } };
};
const node = (element: string, attributes: Record<string, string> = {}, more: Record<string, unknown> = {}) => ({ blockId: crypto.randomUUID().slice(0, 8), element, attributes, ...more });
const body = (...children: unknown[]) => JSON.stringify([{ blockId: "root", originalElement: "body", element: "div", baseStyles: { display: "flex", flexDirection: "column", padding: "16px" }, children }]);
async function publishFrappe(page: Page, route: string, title: string, blocks: string) {
  const made = await asEditor(page, "frappe.client.insert", { doc: { doctype: "Builder Page", page_title: title, route, blocks: "[]", draft_blocks: blocks } });
  expect(made.status).toBe(200);
  expect((await asEditor(page, "run_doc_method", { dt: "Builder Page", dn: String(made.body.message!.name), method: "publish", args: {} })).status).toBe(200);
}

test("tagging on the advanced editor: the tools at any depth with the page, within the page's policy, and the form's conversion on its thank-you page", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Avançado");
  const slug = `estudio-${unique}`;
  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Avançado" }).click();
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page).toHaveURL(/\/profissional\/meu-site\/editor/);
  const form = node("form", {}, {
    blockId: "contact-form",
    children: [node("input", { type: "text", placeholder: "Seu nome" }), node("input", { type: "email", placeholder: "E-mail" }), node("textarea", { placeholder: "Mensagem" }), node("button", {}, { innerHTML: "Enviar mensagem" })],
  });
  await publishFrappe(page, "contato", "Contato", body(node("h1", {}, { innerHTML: "Fale comigo" }), form));
  await publishFrappe(page, "servicos/personal", "Personal", body(node("h1", {}, { innerHTML: "Personal" })));
  await page.goto("./profissional/meu-site");
  // A new site is born receiving messages.
  await showTab(page, "Formulários e mensagens");
  await expect(page.getByRole("region", { name: "Formulários e mensagens" })).toContainText("Recebimento ligado");
  await showTab(page, "Configurações");
  const settings = panel(page);
  await settings.getByLabel("ID de medição do GA4").fill("G-TEST1234");
  await settings.getByLabel("ID do Google Ads").fill("AW-123456789/LeadLabel1");
  await settings.getByLabel("ID do Meta Pixel").fill("123456789012345");
  await settings.getByRole("button", { name: "Salvar rastreamento" }).click();
  await expect(settings).toContainText("Ativo: GA4, Google Ads, Meta Pixel");

  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  await trackPolicy(visitor);
  const problems: string[] = [];
  visitor.on("pageerror", (error) => problems.push(error.message));
  await visit.context.route(VENDOR, (route, request: Request) => {
    const url = request.url();
    if (url.startsWith("https://www.googletagmanager.com/gtag/js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: GTAG_STUB });
    if (url === "https://connect.facebook.net/en_US/fbevents.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: FBQ_STUB });
    return route.fulfill({ status: 204, body: "" });
  });

  // ---- two levels below the site: the script's relative address reaches it, and the tools load with the page, with no banner ----
  const gtagLoaded = visitor.waitForRequest((request) => request.url().startsWith("https://www.googletagmanager.com/gtag/js?id=G-TEST1234"));
  await visitor.goto(`./site/${slug}/servicos/personal`);
  await expect(visitor.getByRole("heading", { name: "Personal" })).toBeVisible();
  await gtagLoaded;
  await expect(banner(visitor)).toHaveCount(0);
  await expect.poll(async () => (await calls(visitor, "__fbq")).length).toBeGreaterThan(0);
  expect((await calls(visitor, "__gtag")).filter((call) => call[0] === "config").map((call) => call[1])).toEqual(["G-TEST1234", "AW-123456789"]);
  expect(await policyRefusals(visitor)).toEqual([]);

  // ---- the page with the form: the tools load again; the message is sent; the thank-you page counts it once and drops the id ----
  await visitor.goto(`./site/${slug}/contato`);
  await expect(banner(visitor)).toHaveCount(0);
  await expect.poll(async () => (await calls(visitor, "__gtag")).filter((call) => call[0] === "config").length).toBe(2);
  await visitor.getByRole("textbox", { name: "Seu nome" }).fill("Ana Souza");
  await visitor.getByRole("textbox", { name: "E-mail" }).fill("ana@example.test");
  await visitor.getByRole("textbox", { name: "Mensagem" }).fill("Quero saber dos planos.");
  await visitor.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(visitor.getByRole("heading", { name: "Mensagem enviada" })).toBeVisible();
  await expect.poll(async () => (await events(visitor, "generate_lead")).length).toBe(1);
  const [conversion] = await events(visitor, "conversion");
  expect(conversion).toMatchObject({ send_to: "AW-123456789/LeadLabel1" });
  expect(String(conversion!.transaction_id)).toMatch(/^[0-9a-f]{32}$/);
  await expect.poll(async () => (await tracks(visitor, "Lead")).length).toBe(1);
  await expect(visitor).toHaveURL(new RegExp(`/site/${slug}/m/enviado\\?pagina=contato$`));
  expect(JSON.stringify([await calls(visitor, "__gtag"), await calls(visitor, "__fbq")])).not.toMatch(/Ana Souza|ana@example\.test/);
  expect(await policyRefusals(visitor)).toEqual([]);
  expect(problems).toEqual([]);
  await visit.context.close();
});
