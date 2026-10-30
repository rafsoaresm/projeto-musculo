import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, png } from "./helpers";

/** What the editor asks of its server, asked the way the editor asks (same origin, with the header that marks its calls). */
const asEditor = async (page: Page, method: string, params: Record<string, unknown>) => {
  const response = await page.request.post(`./api/builder-editor/api/method/${method}`, { headers: { "x-site-request": "1" }, data: params });
  return { status: response.status(), body: (await response.json()) as { message?: Record<string, unknown> } };
};

test("meu site, new editor: a site born in it, an image sent from the editor, the main address leading to it once chosen (and back), and deleting everything to start again", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Fluxo");
  const slug = `estudio-${unique}`;
  const mount = new URL(baseURL!).pathname.replace(/\/$/, "");
  const noFollow = { maxRedirects: 0 } as const;

  // ---- the first step offers the new editor first, and a site born in it has no models to choose from ----
  await page.goto("./profissional/meu-site");
  const create = page.getByRole("form", { name: "Criar o meu site" });
  await expect(create.getByRole("radio", { name: /Editor novo/ })).toBeChecked();
  await expect(create.getByText("Começar com")).toHaveCount(0);
  await expect(create.getByText(`/site/${slug}`)).toBeVisible();
  await create.getByRole("button", { name: "Criar meu site" }).click();
  const panel = page.getByRole("region", { name: "Editor novo (Frappe Builder)" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Nenhuma ainda.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Colocar o site novo no endereço principal" })).toHaveCount(0); // born in the new editor: it already has the address
  await expect(page.getByRole("link", { name: "Abrir o editor novo" })).toBeVisible();

  // ---- an image sent the way the editor's file picker sends it: a form, with the mark of the editor ----
  const endpoint = "./api/builder-editor/api/method/builder.api.upload_builder_asset";
  const rejected = await page.request.post(endpoint, { multipart: { file: { name: "x.png", mimeType: "image/png", buffer: png() } } });
  expect(rejected.status(), "without the mark of the editor").toBe(400);
  const text = await page.request.post(endpoint, { headers: { "x-site-request": "1", "x-editor-mount": mount }, multipart: { file: { name: "nota.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)>") } } });
  expect(text.status()).toBe(417);
  expect(JSON.stringify(await text.json())).toContain("JPEG ou PNG");
  const sent = await page.request.post(endpoint, { headers: { "x-site-request": "1", "x-editor-mount": mount }, multipart: { file: { name: "Treino da Marina.png", mimeType: "image/png", buffer: png(80, 60) }, is_private: "0", folder: "Home/Builder Uploads" } });
  expect(sent.status()).toBe(200);
  const file = ((await sent.json()) as { message: { name: string; file_url: string; file_name: string } }).message;
  expect(file.file_url).toBe(`${mount}/s/${slug}/m/${file.name}`);
  expect(file.file_name).toBe("Treino da Marina.png");
  const image = await page.request.get(file.file_url);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect(image.headers()["content-security-policy"]).toContain("sandbox");
  // someone who is not signed in reads it by its address too (it is the image of a public page), and nothing of another address
  const stranger = await page.context().browser()!.newContext({ baseURL });
  expect((await stranger.request.get(file.file_url)).status()).toBe(200);
  expect((await stranger.request.get(`${mount}/s/outro-endereco-${unique}/m/${file.name}`)).status()).toBe(404);

  // ---- a page with that image, published, is at /site/<address>, and the image on it is the site's own, written from the page ----
  const blocks = JSON.stringify([
    { blockId: "r", originalElement: "body", element: "div", baseStyles: { display: "flex", background: "#101010" }, children: [{ blockId: "i", element: "img", attributes: { src: file.file_url, alt: "Treino" }, baseStyles: { width: "80px" } }, { blockId: "t", element: "p", innerHTML: "Olá, mundo", baseStyles: { color: "#ffffff", fontFamily: "Oswald", fontWeight: "700" } }] },
  ]);
  const made = await asEditor(page, "frappe.client.insert", { doc: { doctype: "Builder Page", page_title: "Início", route: "home", blocks: "[]", draft_blocks: blocks } });
  const pageName = String(made.body.message!.name);
  expect((await asEditor(page, "run_doc_method", { dt: "Builder Page", dn: pageName, method: "publish", args: {} })).status).toBe(200);
  const published = await stranger.request.get(`./site/${slug}`);
  expect(published.status()).toBe(200);
  const html = await published.text();
  expect(html).toContain(`<img src="../s/${slug}/m/${file.name}" alt="Treino" class="fb-2">`);
  expect(html).toContain('<title>Início</title>');
  expect(html).toContain('font-family: "Oswald"');
  expect(html).toContain('src: url("../frappe-editor/fonts/oswald/oswald-latin-wght-normal.woff2")');
  // what the page names, answered from the page's own address, with nothing outside the site
  const font = await stranger.request.get(`${mount}/frappe-editor/fonts/oswald/oswald-latin-wght-normal.woff2`);
  expect(font.status()).toBe(200);
  const seen = await stranger.newPage();
  const outside: string[] = [];
  const origin = new URL(baseURL!).origin;
  seen.on("request", (request) => {
    if (!request.url().startsWith(`${origin}/`) && !request.url().startsWith("data:")) outside.push(request.url());
  });
  await seen.goto(`${mount}/site/${slug}`);
  await expect(seen.getByText("Olá, mundo")).toBeVisible();
  await expect.poll(() => seen.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(80);
  await expect.poll(() => seen.evaluate(() => document.fonts.check("700 16px Oswald"))).toBe(true);
  expect(outside).toEqual([]);

  // ---- the panel lists the page, and the address of the first editor leads to the new site ----
  await page.reload();
  await expect(panel.getByRole("list", { name: "Páginas no ar no editor novo" })).toContainText("Início");
  const toNew = await stranger.request.get(`./s/${slug}`, noFollow);
  expect(toNew.status()).toBe(307);
  expect(toNew.headers().location).toContain(`/site/${slug}`);
  await seen.goto(`${mount}/s/${slug}`);
  await expect(seen).toHaveURL(new RegExp(`${mount}/site/${slug}$`));
  await expect(seen.getByText("Olá, mundo")).toBeVisible();

  // ---- back to the first editor and again to the new one, nothing deleted in either direction ----
  await panel.getByRole("button", { name: "Voltar ao editor anterior" }).click();
  await expect(panel.getByRole("status")).toContainText("voltou a mostrar o site do editor anterior");
  await expect(page.getByText("Fora do ar").first()).toBeVisible();
  expect((await stranger.request.get(`./s/${slug}`, noFollow)).status(), "the first editor was never published: nothing at its address").toBe(404);
  expect((await stranger.request.get(`./site/${slug}`)).status(), "the page of the new editor is still where it was").toBe(200);
  await panel.getByRole("button", { name: "Colocar o site novo no endereço principal" }).click();
  await expect(panel.getByRole("status")).toContainText("agora mostra o site do editor novo");
  expect((await stranger.request.get(`./s/${slug}`, noFollow)).status()).toBe(307);

  // ---- delete everything: the address typed again, and then it is nothing, for visitors and for the editor, and can be started again ----
  await page.getByRole("button", { name: "Excluir o site…" }).click();
  const deleting = page.getByRole("form", { name: "Excluir o site" });
  await deleting.getByLabel(/Para confirmar, digite o endereço/).fill("outro-endereco");
  await expect(deleting.getByRole("button", { name: "Excluir o site para sempre" })).toBeDisabled();
  await deleting.getByLabel(/Para confirmar, digite o endereço/).fill(slug);
  await deleting.getByRole("button", { name: "Excluir o site para sempre" }).click();
  await expect(page.getByRole("form", { name: "Criar o meu site" })).toBeVisible();
  expect((await stranger.request.get(`./site/${slug}`)).status()).toBe(404);
  expect((await stranger.request.get(`./s/${slug}`, noFollow)).status()).toBe(404);
  expect((await stranger.request.get(file.file_url)).status(), "the image goes with the site").toBe(404);
  expect((await asEditor(page, "frappe.client.get_list", { doctype: "Builder Page" })).body.message).toEqual([]);
  // the same address is free again, and the first editor can be chosen this time
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("radio", { name: /Editor anterior/ }).check();
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();
  await expect(page.getByText("Fora do ar").first()).toBeVisible();
  await stranger.close();
});
