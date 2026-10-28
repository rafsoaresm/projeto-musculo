import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, newActor, png } from "./helpers";

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
async function addBlock(page: Page, name: string) {
  await panel(page, "Blocos");
  await library(page).getByRole("button", { name: "Blocos", exact: true }).click();
  await library(page).getByRole("button", { name: `Acrescentar ${name} ao fim da página` }).click();
}
/** A real JPEG, drawn by the browser itself: nothing in the repository to keep up to date. */
async function jpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#336699";
    context.fillRect(0, 0, 240, 160);
    context.fillStyle = "#ffcc00";
    context.fillRect(40, 30, 100, 60);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

test("images: sent in the editor, shown on the page, public only through the published version, and gone when the page goes offline", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Imagens ${unique}`, "Marina Imagens");
  const slug = `imagens-${unique}`;
  await page.goto("./profissional/meu-site");
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Criar meu site" }).click();
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  await state(page).getByRole("button", { name: "Abrir o editor visual" }).click();
  await expect(editor(page)).toBeVisible();

  // The contact the starter page's button points to, so the page can be published.
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("WhatsApp", { exact: true }).fill("(11) 91234-5678");

  // An image block: choose a file. The browser re-draws it and the server cleans it again.
  await addBlock(page, "Imagem");
  await panel(page, "Propriedades");
  await expect(inspector(page).getByRole("heading", { name: "Imagem", level: 2 })).toBeVisible();
  await expect(inspector(page).getByText("Nenhuma imagem")).toHaveCount(0);
  await inspector(page).getByLabel("Escolher o arquivo da imagem").setInputFiles({ name: "estudio.png", mimeType: "image/png", buffer: png(300, 200) });
  await expect(inspector(page).getByText("Imagem enviada.")).toBeVisible();
  await expect(inspector(page).getByRole("radio", { name: /^Imagem 1, 300 por 200 pixels/ })).toBeChecked();
  await inspector(page).getByLabel("Descrição da imagem (para quem não consegue vê-la)").fill("Marina no estúdio");
  await inspector(page).getByLabel("Legenda (opcional)").fill("O estúdio");
  await inspector(page).getByLabel("Tamanho").selectOption({ label: "Média" });
  await panel(page, "Página");
  const drawn = stage(page).locator(".site-image img");
  await expect(drawn).toHaveAttribute("src", /\/profissional\/meu-site\/imagens\/[0-9a-f-]{36}$/);
  await expect.poll(() => drawn.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // A JPEG too, which ends up only in the library (newest first). It is used nowhere, so it can be removed; the PNG cannot.
  await stage(page).locator(".ve-stage-scroll").click({ position: { x: 4, y: 4 } });
  await panel(page, "Propriedades");
  await expect(inspector(page).getByRole("heading", { name: "Página", level: 2 })).toBeVisible();
  const logo = inspector(page).getByRole("group", { name: "Logotipo" });
  await logo.getByLabel("Escolher o arquivo da imagem").setInputFiles({ name: "capa.jpg", mimeType: "image/jpeg", buffer: await jpeg(page) });
  await expect(logo.getByText("Imagem enviada.")).toBeVisible();
  await expect(logo.getByRole("radio", { name: /^Imagem 1, 240 por 160 pixels/ })).toBeChecked();
  // Uploading chose it as the logo. Choose none, and it is only in the library.
  await logo.getByRole("radio", { name: "Sem logotipo" }).check();
  await expect(logo.getByRole("button", { name: /^Remover a imagem 2 da biblioteca/ })).toBeDisabled();
  const libraryIds = await logo.locator(".ve-thumb img").evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).src.split("/").pop()!));
  expect(libraryIds).toHaveLength(2);
  const [onlyInLibrary, used] = libraryIds;
  await logo.getByRole("button", { name: "Remover a imagem 1 da biblioteca" }).click();
  await expect(logo.getByRole("group", { name: "Confirmar a remoção da imagem" })).toBeVisible();
  await logo.getByRole("button", { name: "Voltar" }).click();
  // The logo is the PNG, which the block uses too: one stored image, two places.
  await logo.getByRole("radio", { name: /^Imagem 2, 300 por 200/ }).check();

  // What is sent that is not an image is refused, with no way around the checks of the browser.
  const upload = (data: Buffer, headers: Record<string, string>) => page.request.post("./profissional/meu-site/imagens", { data, headers });
  const sneaky = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  expect((await upload(sneaky, { "x-site-request": "1", "Content-Type": "image/png" })).status()).toBe(415);
  expect((await upload(Buffer.from("GIF89a"), { "x-site-request": "1", "Content-Type": "image/gif" })).status()).toBe(415);
  expect((await upload(png(10, 10), { "Content-Type": "image/png" })).status()).toBe(400);

  // Save and publish: the page and the images it uses.
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo.")).toBeVisible();
  await editor(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();

  // A visitor sees the image from the page's own address, and nothing from the editor's.
  const anonymous = await newActor(browser, baseURL);
  await anonymous.page.goto(`./s/${slug}`);
  const published = anonymous.page.locator(".site-image img");
  await expect(published).toHaveAttribute("src", new RegExp(`/s/${slug}/m/${used}$`));
  await expect(published).toHaveAttribute("alt", "Marina no estúdio");
  await expect(published).toHaveAttribute("width", "300");
  await expect(published).toHaveAttribute("height", "200");
  await expect(anonymous.page.locator(".site-image figcaption")).toHaveText("O estúdio");
  await expect.poll(() => published.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(300);
  const sources = await anonymous.page.locator("img").evaluateAll((nodes) => nodes.map((n) => new URL((n as HTMLImageElement).src).pathname));
  for (const source of sources) expect(source, source).toMatch(new RegExp(`/s/${slug}/m/[0-9a-f-]{36}$`));
  // The logo is the same image, from the same public address, and the picture is decorative (the name next to it says it).
  const publishedLogo = anonymous.page.locator(".site-logo");
  await expect(publishedLogo).toHaveAttribute("src", new RegExp(`/s/${slug}/m/${used}$`));
  await expect(publishedLogo).toHaveAttribute("alt", "");

  // The file: an image, with the headers that keep it an image, revalidated by its digest.
  const first = await anonymous.page.request.get(`./s/${slug}/m/${used}`);
  expect(first.status()).toBe(200);
  expect(first.headers()["content-type"]).toBe("image/png");
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  expect(first.headers()["content-security-policy"]).toContain("sandbox");
  expect(first.headers()["cache-control"]).toContain("no-cache");
  const etag = first.headers()["etag"];
  expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
  expect((await anonymous.page.request.get(`./s/${slug}/m/${used}`, { headers: { "If-None-Match": etag } })).status()).toBe(304);

  // The image that is only in the library is not public, nor is any made-up identifier or another address.
  expect((await anonymous.page.request.get(`./s/${slug}/m/${onlyInLibrary}`)).status()).toBe(404);
  expect((await anonymous.page.request.get(`./s/${slug}/m/${crypto.randomUUID()}`)).status()).toBe(404);
  expect((await anonymous.page.request.get(`./s/${slug}/m/..%2F..%2Fapi%2Fhealth`)).status()).toBe(404);
  expect((await anonymous.page.request.get(`./s/outro-endereco/m/${used}`)).status()).toBe(404);

  // The editor's address needs the login: without it nothing of the library comes out.
  const guarded = await anonymous.page.request.get(`./profissional/meu-site/imagens/${used}`, { maxRedirects: 0 });
  expect(guarded.headers()["content-type"] ?? "").not.toContain("image/");
  expect((await anonymous.page.request.post("./profissional/meu-site/imagens", { data: png(10, 10), headers: { "x-site-request": "1", "Content-Type": "image/png" }, maxRedirects: 0 })).status()).not.toBe(200);

  // The used image stays when it is asked to go; the unused one goes, file and all.
  await expect(inspector(page).getByRole("group", { name: "Logotipo" }).getByRole("button", { name: /^Remover a imagem \d da biblioteca/ }).first()).toBeVisible();
  await logo.getByRole("button", { name: "Remover a imagem 1 da biblioteca" }).click();
  await logo.getByRole("button", { name: "Remover", exact: true }).click();
  await expect(logo.getByText("Imagem removida.")).toBeVisible();
  await expect(logo.locator(".ve-thumb img")).toHaveCount(1);
  expect((await page.request.get(`./profissional/meu-site/imagens/${onlyInLibrary}`)).status()).toBe(404);
  expect((await page.request.get(`./profissional/meu-site/imagens/${used}`)).status()).toBe(200);
  expect((await page.request.delete(`./profissional/meu-site/imagens/${used}`)).status()).toBe(400);
  expect((await page.request.delete(`./profissional/meu-site/imagens/${used}`, { headers: { "x-site-request": "1" } })).status()).toBe(409);

  // Taking the page offline takes its images with it, at once.
  await editor(page).getByRole("button", { name: "Fechar o editor" }).click();
  await state(page).getByRole("button", { name: "Tirar do ar" }).click();
  await expect(state(page).getByText("O site saiu do ar.")).toBeVisible();
  expect((await anonymous.page.request.get(`./s/${slug}/m/${used}`)).status()).toBe(404);
  expect((await anonymous.page.request.get(`./s/${slug}`)).status()).toBe(404);
  await anonymous.context.close();
});
