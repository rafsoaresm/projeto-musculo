import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor, policyRefusals, trackPolicy } from "./helpers";

/** What the editor asks of its server, asked the way the editor asks (same origin, with the header that marks its calls). */
const asEditor = async (page: Page, method: string, params: Record<string, unknown>) => {
  const response = await page.request.post(`./api/builder-editor/api/method/${method}`, { headers: { "x-site-request": "1" }, data: params });
  return { status: response.status(), body: (await response.json()) as { message?: Record<string, unknown> } };
};

const node = (element: string, attributes: Record<string, string> = {}, more: Record<string, unknown> = {}) => ({ blockId: crypto.randomUUID().slice(0, 8), element, attributes, ...more });
const body = (...children: unknown[]) => JSON.stringify([{ blockId: "root", originalElement: "body", element: "div", baseStyles: { display: "flex", flexDirection: "column", padding: "16px" }, children }]);
/** A form as the editor writes one: its own blocks, a hint on each field, and the type of each chosen in its panel. */
const contactForm = () =>
  node("form", { }, {
    blockId: "contact-form",
    baseStyles: { display: "flex", flexDirection: "column", gap: "8px", maxWidth: "420px" },
    children: [
      node("input", { type: "text", placeholder: "Seu nome" }),
      node("input", { type: "email", placeholder: "E-mail" }),
      node("input", { type: "tel", placeholder: "WhatsApp" }),
      node("select", { "aria-label": "Objetivo" }, { children: [node("option", {}, { innerHTML: "Emagrecer" }), node("option", {}, { innerHTML: "Ganhar massa" })] }),
      node("textarea", { placeholder: "Mensagem" }),
      node("button", {}, { innerHTML: "<p>Enviar mensagem</p>", baseStyles: { padding: "10px" } }),
    ],
  });

async function publish(page: Page, route: string, title: string, blocks: string) {
  const made = await asEditor(page, "frappe.client.insert", { doc: { doctype: "Builder Page", page_title: title, route, blocks: "[]", draft_blocks: blocks } });
  expect(made.status).toBe(200);
  const name = String(made.body.message!.name);
  expect((await asEditor(page, "run_doc_method", { dt: "Builder Page", dn: name, method: "publish", args: {} })).status).toBe(200);
  return name;
}

const panel = (page: Page) => page.getByRole("region", { name: "Editor novo (Frappe Builder)" });

test("frappe form: a form drawn with the editor's blocks is on the page only when the site opens it, goes to the inbox of Leads with the lines of its fields, and the panel says what each form can do", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Formulário");
  const slug = `estudio-${unique}`;
  await page.goto("./profissional/meu-site");
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("Nenhum formulário nas páginas que estão no ar.")).toBeVisible();

  // ---- two pages on the air: a complete form, and a newsletter that has no field for the name ----
  await publish(page, "contato", "Contato", body(node("h1", {}, { innerHTML: "Fale comigo" }), contactForm()));
  await publish(page, "boletim", "Boletim", body(node("h2", {}, { innerHTML: "Receba novidades" }), node("form", {}, { blockId: "news", children: [node("input", { type: "email", placeholder: "E-mail" }), node("button", {}, { innerHTML: "Assinar" })] })));

  // ---- the panel: what each form can do, and the switch (the environment of this run has the public forms open; the site is off) ----
  await page.goto("./profissional/meu-site");
  const forms = panel(page).getByRole("list", { name: "Formulários das páginas no ar" });
  await expect(forms.getByRole("listitem").filter({ hasText: "/contato" })).toContainText("pronto — nome, e-mail, telefone, mensagem e um outro campo.");
  await expect(forms.getByRole("listitem").filter({ hasText: "/boletim" })).toContainText("incompleto e não aparece para quem visita: Falta o campo do nome: um campo de texto.");
  await expect(panel(page)).toContainText("Formulários abertos pela plataforma");
  await expect(panel(page)).toContainText("Recebimento desligado");

  // ---- a visitor: the page is there, the form is not (the site is not receiving), and a program posting to the address is refused ----
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  await visitor.goto(`./site/${slug}/contato`);
  await expect(visitor.getByRole("heading", { name: "Fale comigo" })).toBeVisible();
  await expect(visitor.locator("form")).toHaveCount(0);
  const raw = (fields: Record<string, string>) => visitor.request.post(`./site/${slug}/m/contato`, { form: fields, maxRedirects: 0 });
  expect((await raw({ pagina: "contato", formulario: "contact-form", aceite: "on" })).status()).toBe(404);

  // ---- the switch of the site ----
  await panel(page).getByRole("button", { name: "Ligar o recebimento de mensagens" }).click();
  await expect(panel(page).getByText("O site passou a receber as mensagens do formulário.")).toBeVisible();
  await expect(panel(page)).toContainText("Recebimento ligado");

  // ---- the page now has the form, as a plain form with the box of the notice and a bait that a person never meets ----
  await visitor.reload();
  const form = visitor.locator("form");
  await expect(form).toHaveCount(1);
  await expect(form).toHaveAttribute("method", "post");
  await expect(form).toHaveAttribute("action", /\/site\/[a-z0-9-]+\/m\/contato$/);
  const bait = form.locator('input[name="empresa_extra"]');
  expect((await bait.boundingBox())!.x).toBeLessThan(-5000);
  await expect(bait).toHaveAttribute("tabindex", "-1");
  await expect(bait.locator("xpath=ancestor::div[1]")).toHaveAttribute("aria-hidden", "true");
  const notice = visitor.getByRole("link", { name: "aviso de privacidade" });
  await expect(notice).toHaveAttribute("href", /\/aviso-de-privacidade-de-teste$/);
  await expect(notice).toHaveAttribute("rel", "noopener noreferrer");
  await expect(visitor.locator("script")).toHaveCount(0);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  // The browser itself asks for what the form needs: the name, a way to reach the person and the box of the notice.
  await visitor.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/site/${slug}/contato$`));
  expect(await form.evaluate((element) => (element as HTMLFormElement).checkValidity())).toBe(false);

  // ---- sending it from the page, as a person does ----
  await visitor.getByRole("textbox", { name: "Seu nome" }).fill("Ana Souza");
  await visitor.getByRole("textbox", { name: "E-mail" }).fill("ana@example.test");
  await visitor.getByRole("combobox", { name: "Objetivo" }).selectOption({ label: "Ganhar massa" });
  await visitor.getByRole("textbox", { name: "Mensagem" }).fill("Quero saber dos planos.\nPode ser online?");
  await visitor.getByRole("checkbox", { name: /Li o aviso de privacidade/ }).check();
  await visitor.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/site/${slug}/m/enviado\\?pagina=contato$`));
  await expect(visitor.getByRole("heading", { name: "Mensagem enviada" })).toBeVisible();
  await visitor.getByRole("link", { name: "Voltar ao site" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/site/${slug}/contato$`));

  // ---- what the address refuses, whatever the browser did ----
  const html = await visitor.content();
  const version = /name="versao" value="([^"]+)"/.exec(html)![1]!;
  const good = { pagina: "contato", formulario: "contact-form", versao: version, aceite: "on" };
  expect((await raw({ ...good, f1: "A", f2: "x@example.test" })).status()).toBe(400);
  expect((await raw({ ...good, f1: "Caio Reis", f2: "caio@example.test", aceite: "" })).status()).toBe(400);
  expect((await raw({ ...good, f1: "Caio Reis", f2: "caio@example.test", f4: "9" })).status()).toBe(400);
  expect((await raw({ pagina: "contato", formulario: "contact-form", aceite: "on", f1: "Caio Reis", f2: "caio@example.test" })).status(), "no version").toBe(409);
  expect((await raw({ ...good, formulario: "outro", f1: "Caio Reis", f2: "caio@example.test" })).status()).toBe(409);
  expect((await raw({ ...good, pagina: "boletim", formulario: "news", f1: "caio@example.test" })).status(), "a form that is not drawn").toBe(404);
  expect((await raw({ ...good, f1: "Robô", f2: "robo@example.test", empresa_extra: "http://spam.example" })).status()).toBe(303);

  // ---- the professional: the message waits in Leads, with the lines of the fields, and becomes a lead of origin Site ----
  await page.goto("./profissional/leads/mensagens");
  const inbox = page.getByRole("list", { name: "Mensagens do site" });
  await expect(inbox.getByRole("listitem")).toHaveCount(1);
  const ana = inbox.getByRole("listitem").filter({ hasText: "Ana Souza" });
  await expect(ana).toContainText("ana@example.test");
  await expect(ana).toContainText("da página /contato");
  await expect(ana.locator(".inquiry-message")).toHaveText("Quero saber dos planos.\nPode ser online?\n\nObjetivo: Ganhar massa");
  await ana.getByRole("button", { name: "Virar lead" }).click();
  await expect(page.getByText("A mensagem virou um lead, com origem Site.")).toBeVisible();

  // ---- the site stops receiving: the form leaves the page at the next visit and the address refuses ----
  await page.goto("./profissional/meu-site");
  await panel(page).getByRole("button", { name: "Desligar o recebimento de mensagens" }).click();
  await expect(panel(page).getByText("O site parou de receber as mensagens do formulário.")).toBeVisible();
  await visitor.goto(`./site/${slug}/contato`);
  await expect(visitor.locator("form")).toHaveCount(0);
  expect((await raw({ ...good, f1: "Depois", f2: "depois@example.test" })).status()).toBe(404);
  await visit.context.close();
});

test("frappe form, from the editor itself: the form of the editor's own library, dragged onto a page and published, works as it is, and the panel says what it holds", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The editor is a tool for a computer.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Biblioteca");
  const slug = `estudio-${unique}`;
  await page.goto("./profissional/meu-site");
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "Ligar o recebimento de mensagens" }).click();
  await expect(panel(page)).toContainText("Recebimento ligado");

  // ---- a page from scratch; the library ("+") has the three forms of the editor; one is dragged onto the page ----
  await trackPolicy(page);
  await page.goto("./profissional/meu-site/editor");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByText("Start from scratch").click();
  await expect(page.getByText("body", { exact: true }).first()).toBeVisible();
  const pageName = new URL(page.url()).pathname.split("/").pop()!;
  await page.mouse.click(28, 76);
  await page.getByPlaceholder("Search Template").fill("form");
  const card = page.getByText("Form 1", { exact: true });
  await expect(card).toBeVisible();
  const read = async () => {
    const answer = await asEditor(page, "frappe.client.get", { doctype: "Builder Page", name: pageName });
    return (answer.body.message ?? {}) as Record<string, unknown>;
  };
  await expect(async () => {
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y - 20);
    await page.mouse.down();
    await page.mouse.move(700, 400, { steps: 12 });
    await page.mouse.move(890, 420, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => String((await read()).draft_blocks ?? ""), { timeout: 4000 }).toContain("Full Name");
  }).toPass({ timeout: 40_000 });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect.poll(async () => Number((await read()).published), { timeout: 30_000 }).toBe(1);
  // Dragging from the library and publishing is a normal use of the editor: its content policy refused nothing.
  expect(await policyRefusals(page)).toEqual([]);

  // ---- the panel reads the form of the editor's library as a working form ----
  await page.goto("./profissional/meu-site");
  const forms = panel(page).getByRole("list", { name: "Formulários das páginas no ar" });
  await expect(forms.getByRole("listitem")).toHaveCount(1);
  await expect(forms).toContainText("pronto — nome, e-mail e mensagem.");

  // ---- a visitor sends it from the home address of the site, with nothing changed in it ----
  const visit = await newActor(browser, baseURL);
  const visitor = visit.page;
  await visitor.goto(`./site/${slug}`);
  await expect(visitor.locator("form")).toHaveCount(1);
  await visitor.getByRole("textbox", { name: "Full Name" }).fill("Bia Lima");
  await visitor.getByRole("textbox", { name: "Email" }).fill("bia@example.test");
  await visitor.getByRole("textbox", { name: "Message" }).fill("Oi, quero começar.");
  await visitor.getByRole("checkbox", { name: /Li o aviso de privacidade/ }).check();
  await visitor.getByRole("button", { name: "Submit" }).click();
  await expect(visitor).toHaveURL(new RegExp(`/site/${slug}/m/enviado\\?pagina=pages(%2F|/)page-[a-z0-9-]+$`));
  await expect(visitor.getByRole("heading", { name: "Mensagem enviada" })).toBeVisible();
  await visitor.getByRole("link", { name: "Voltar ao site" }).click();
  await expect(visitor.locator("form")).toHaveCount(1);
  await visit.context.close();

  await page.goto("./profissional/leads/mensagens");
  const bia = page.getByRole("list", { name: "Mensagens do site" }).getByRole("listitem").filter({ hasText: "Bia Lima" });
  await expect(bia).toContainText("bia@example.test");
  await expect(bia.locator(".inquiry-message")).toHaveText("Oi, quero começar.");
});
