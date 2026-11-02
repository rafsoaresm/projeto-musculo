import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, policyRefusals, trackPolicy } from "./helpers";

/** What the editor reads from its server, asked the way the editor asks (same origin, with the header that marks its calls). */
const asEditor = (page: Page, method: string, params: Record<string, unknown>) =>
  page.evaluate(
    async ([name, body]) => {
      const base = (window as unknown as { __EDITOR_API__: string }).__EDITOR_API__;
      const response = await fetch(`${base}/api/method/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-site-request": "1" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
    [method, params] as const,
  );

test("frappe models: the four site models are in the editor's 'Novo' gallery with their pictures and a preview; one becomes a page of the site, with no sample photo and no made-up fact, and is published", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The editor is a tool for a computer.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1700, height: 1000 });
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Frappe");
  await trackPolicy(page);
  const mount = new URL(baseURL!).pathname.replace(/\/$/, "");

  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Avançado" }).click();
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page).toHaveURL(/\/profissional\/meu-site\/editor/);
  await expect(page.getByRole("heading", { name: "Todas as páginas" })).toBeVisible();

  // ---- the gallery: the four models, each with its picture from this app, under the mount ----
  await page.getByRole("button", { name: "Novo", exact: true }).click();
  for (const title of ["Energia (vermelho e laranja)", "Bem-estar (claro e laranja)", "Premium (preto e laranja)", "Performance (azul e branco)"])
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  const picture = page.locator('img[alt="Performance (azul e branco)"]').first();
  await expect(picture).toHaveAttribute("src", `${mount}/site-models/thumb-race.webp`);
  await expect.poll(() => picture.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // ---- the preview: the page this model becomes, drawn by the app, in a frame of the editor ----
  const card = page.locator("div.group").filter({ has: page.getByText("Performance (azul e branco)", { exact: true }) }).first();
  await card.hover();
  await card.getByRole("button", { name: "Pré-visualização" }).click();
  const framed = page.frameLocator(`iframe[src="${mount}/profissional/meu-site/modelo-avancado/race"]`);
  await expect(framed.getByRole("heading", { name: /TREINE PARA SER MAIS RÁPIDO/i })).toBeVisible({ timeout: 20_000 });
  // The photos of the model are not in it: a photo still to be chosen is an empty box (the renderer draws an image without its file so).
  expect(await framed.locator("html").evaluate((root) => root.outerHTML)).not.toContain("site-models/");
  await page.getByRole("button", { name: "Usar modelo" }).click();

  // ---- the page made from it: the editor opens it, its draft is the model ----
  await expect(page).toHaveURL(new RegExp(`${mount}/profissional/meu-site/editor/page/(?!new$)[a-z0-9-]+$`), { timeout: 20_000 });
  const pageName = new URL(page.url()).pathname.split("/").pop()!;
  const read = async () => ((await asEditor(page, "frappe.client.get", { doctype: "Builder Page", name: pageName })).body as { message: Record<string, unknown> }).message;
  const made = await read();
  expect(made.page_title).toBe("Performance (azul e branco)");
  expect(Number(made.published)).toBe(0);
  const draft = String(made.draft_blocks);
  expect(draft).toContain("TREINE PARA SER");
  expect(draft).not.toContain("/site-models/");
  expect(draft).not.toContain("var(--site-");
  // No number of WhatsApp was written anywhere for this site: the buttons go to the contact part of the page, never to a made-up number.
  expect(draft).not.toContain("wa.me");
  expect(draft).not.toMatch(/R\$ ?\d/);

  // ---- published from the editor, it is the site's page, with what the model has and none of its samples ----
  await expect(page.getByText("body", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect.poll(async () => Number((await read()).published), { timeout: 30_000 }).toBe(1);
  const slug = `estudio-${unique}`;
  const answer = await page.request.get(`./site/${slug}`);
  expect(answer.status()).toBe(200);
  const html = await answer.text();
  expect(html).toContain("TREINE PARA SER");
  expect(html).toContain('href="#contato"');
  expect(html).toContain("<details");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("site-models/");

  expect(await policyRefusals(page)).toEqual([]);
});

test("frappe models: the preview of a model is only for who edits a site, and only for the four models", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The editor is a tool for a computer.");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Prévia");
  const seen = await page.request.get("./profissional/meu-site/modelo-avancado/trainix");
  expect(seen.status()).toBe(200);
  expect(seen.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(seen.headers()["content-security-policy"]).not.toContain("script-src");
  expect(await seen.text()).not.toContain("<script");
  expect((await page.request.get("./profissional/meu-site/modelo-avancado/outro")).status()).toBe(404);
  const stranger = await browser.newContext({ baseURL });
  expect((await stranger.request.get("./profissional/meu-site/modelo-avancado/trainix", { maxRedirects: 0 })).status()).toBe(401);
  await stranger.close();
});
