import zlib from "node:zlib";
import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, newActor, noHorizontalOverflow } from "./helpers";

/** A real PNG (a gradient), so the browser has something to decode and re-draw. */
function png(width = 120, height = 160): Buffer {
  const crc = (buffer: Buffer) => {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(zlib.crc32(buffer));
    return out;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    return Buffer.concat([length, body, crc(body)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      rows[at] = Math.round((x / width) * 255);
      rows[at + 1] = Math.round((y / height) * 255);
      rows[at + 2] = 160;
    }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const todayBR = () => {
  const [year, month, day] = new Date().toISOString().slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
};
const slot = (page: Page, label: string) => page.getByRole("group", { name: `Foto ${label}` });
const upload = (page: Page, view: string, name = "foto.png") =>
  page.locator(`#foto-${view}`).setInputFiles({ name, mimeType: "image/png", buffer: png() });
const absolute = (page: Page, path: string) => new URL(path, page.url()).href;

test("postural photos are sent as clean JPEGs to the private storage, shown only to the professional and frozen with the assessment", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das fotos");
  const studentURL = await addStudent(page, "Aluna das fotos");
  await page.getByRole("button", { name: "Iniciar avaliação" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação inicial de Aluna das fotos" })).toBeVisible();
  const draftURL = page.url();
  await noHorizontalOverflow(page);

  // The upload waits for the professional's confirmation that the student authorized it.
  const fieldset = page.locator("fieldset", { hasText: "Fotos da postura" });
  await expect(fieldset.getByText("Registro visual, não diagnóstico.", { exact: false })).toBeVisible();
  await expect(fieldset.getByText("base legal e o texto do consentimento", { exact: false })).toBeVisible();
  await expect(page.locator("#foto-ANTERIOR")).toBeDisabled();
  await fieldset.getByLabel("O aluno autorizou o registro destas fotos").check();
  await expect(page.locator("#foto-ANTERIOR")).toBeEnabled();

  // Anterior: the image is re-drawn in the browser, stored, and read back through the route.
  await upload(page, "ANTERIOR");
  await expect(page.getByText("Foto anterior enviada.")).toBeVisible();
  const anterior = slot(page, "anterior").getByRole("img", { name: "Foto anterior do aluno" });
  await expect(anterior).toBeVisible();
  await expect.poll(() => anterior.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const src = (await anterior.getAttribute("src"))!;
  const served = await page.request.get(absolute(page, src));
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  expect(served.headers()["cache-control"]).toContain("no-store");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");
  const body = await served.body();
  expect(body.subarray(0, 3).toString("hex")).toBe("ffd8ff");
  expect(body.includes(Buffer.from("Exif"))).toBe(false);

  // Replace keeps one photo for the view; the others stay empty.
  await upload(page, "ANTERIOR", "outra.png");
  await expect(page.getByText("Foto anterior enviada.")).toBeVisible();
  await expect(slot(page, "anterior").getByRole("img", { name: "Foto anterior do aluno" })).toBeVisible();
  await expect(slot(page, "lateral esquerda").getByText("Sem foto")).toBeVisible();
  await expect(slot(page, "posterior").getByText("Sem foto")).toBeVisible();

  // Remove, then send two for the record.
  await slot(page, "anterior").getByRole("button", { name: /Remover foto/ }).click();
  await expect(page.getByText("Foto anterior removida.")).toBeVisible();
  await expect(slot(page, "anterior").getByText("Sem foto")).toBeVisible();
  const afterRemove = await page.request.get(absolute(page, src));
  expect(afterRemove.status()).toBe(404);
  await upload(page, "ANTERIOR");
  await expect(slot(page, "anterior").getByRole("img", { name: "Foto anterior do aluno" })).toBeVisible();
  await upload(page, "LATERAL_LEFT");
  await expect(slot(page, "lateral esquerda").getByRole("img", { name: "Foto lateral esquerda do aluno" })).toBeVisible();

  // The route refuses what it should, for the signed-in professional too.
  const photoPath = new URL(src, page.url()).pathname;
  const post = (headers: Record<string, string>, data: Buffer) =>
    page.request.put(absolute(page, photoPath), { headers, data });
  expect((await post({ "content-type": "image/jpeg" }, png())).status()).toBe(400); // no request header
  expect((await post({ "x-photo-request": "1", "x-consent": "confirmed" }, png())).status()).toBe(415); // a PNG
  expect((await post({ "x-photo-request": "1", "x-consent": "confirmed" }, Buffer.from("<html></html>"))).status()).toBe(415);
  expect((await post({ "x-photo-request": "1" }, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).status()).toBe(400); // no consent
  expect((await page.request.delete(absolute(page, photoPath))).status()).toBe(400); // no request header
  expect((await page.request.put(absolute(page, photoPath.replace(/ANTERIOR$/, "TOP")), { headers: { "x-photo-request": "1", "x-consent": "confirmed" }, data: Buffer.from([0xff, 0xd8]) })).status()).toBe(404);

  // Nobody else reaches the images: no session, or another organization.
  const anonymous = await newActor(browser, baseURL);
  const noSession = await anonymous.page.request.get(absolute(page, src));
  expect(noSession.headers()["content-type"] ?? "").not.toContain("image/jpeg");
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio das fotos");
  const crossOrg = await other.page.request.get(absolute(other.page, photoPath.replace("/ANTERIOR", "/LATERAL_LEFT")));
  expect(crossOrg.status()).toBe(404);
  expect((await other.page.request.put(absolute(other.page, photoPath), { headers: { "x-photo-request": "1", "x-consent": "confirmed" }, data: Buffer.from([0xff, 0xd8]) })).status()).toBe(404);
  await anonymous.context.close();
  await other.context.close();

  // Recording closes it: the photos stay, nothing can change them.
  await page.getByLabel(/Perguntei ao aluno sobre os seis itens/).check();
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await expect(page.getByRole("heading", { name: `Avaliação de ${todayBR()}`, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fotos da postura" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Foto anterior do aluno" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Foto lateral esquerda do aluno" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Foto posterior do aluno" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Enviar foto|Remover foto/ })).toHaveCount(0);
  expect((await post({ "x-photo-request": "1", "x-consent": "confirmed" }, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).status()).toBe(404);
  expect((await page.request.delete(absolute(page, photoPath), { headers: { "x-photo-request": "1" } })).status()).toBe(404);
  const stillThere = await page.request.get(absolute(page, src));
  expect(stillThere.status()).toBe(200);

  // The evolution shows them, each with its date.
  await page.goto(`${studentURL}/evolucao`);
  await expect(page.getByRole("heading", { name: "Fotos da postura ao longo do tempo" })).toBeVisible();
  await expect(page.getByRole("img", { name: `Foto anterior de ${todayBR()}` })).toBeVisible();
  expect(draftURL).toContain("/avaliacoes/");
});

test("a student known to be under 18 is not photographed by the tool", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do menor");
  const studentURL = await addStudent(page, "Aluno menor de idade");
  const years = new Date();
  years.setUTCFullYear(years.getUTCFullYear() - 12);
  await page.getByRole("link", { name: "Preencher a ficha" }).click();
  await page.getByLabel("Data de nascimento").fill(years.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Ficha salva.")).toBeVisible();

  await page.goto(studentURL);
  await page.getByRole("button", { name: "Iniciar avaliação" }).click();
  const fieldset = page.locator("fieldset", { hasText: "Fotos da postura" });
  await expect(fieldset.getByText("Menor de idade.", { exact: false })).toBeVisible();
  await expect(page.locator("#foto-ANTERIOR")).toHaveCount(0);
  await expect(fieldset.getByLabel("O aluno autorizou o registro destas fotos")).toHaveCount(0);
  // The server refuses it too, not only the screen.
  const path = new URL(page.url()).pathname;
  const response = await page.request.put(new URL(`${path}/fotos/ANTERIOR`, page.url()).href, {
    headers: { "x-photo-request": "1", "x-consent": "confirmed" },
    data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).error).toContain("menores de idade");
});
