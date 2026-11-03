import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, joinStudent, localIP, newActor, noHorizontalOverflow, png, signIn, answerScreening, showStudentTab } from "./helpers";

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
  await showStudentTab(page, "Avaliações");
  await page.getByRole("button", { name: "Iniciar avaliação" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação inicial de Aluna das fotos" })).toBeVisible();
  const draftURL = page.url();
  await noHorizontalOverflow(page);

  // No authorization of the student is asked for: even before the student has access, the screen takes photos and has no box to tick.
  const fieldset = page.locator("fieldset", { hasText: "Fotos da postura" });
  await expect(fieldset.getByText("Registro visual, não diagnóstico.", { exact: false })).toBeVisible();
  await expect(fieldset.getByText(/não autoriz|autorizou|revisão jurídica/)).toHaveCount(0);
  await expect(fieldset.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator("#foto-ANTERIOR")).toBeEnabled();

  // Anterior: the image is re-drawn in the browser, stored, and read back through the route.
  await upload(page, "ANTERIOR");
  await expect(page.getByText("Foto anterior enviada.")).toBeVisible();
  const anterior = slot(page, "anterior").getByRole("img", { name: "Foto anterior do aluno" });
  await expect(anterior).toBeVisible();
  // The picture loads lazily, as a person scrolling to it would make it.
  await anterior.scrollIntoViewIfNeeded();
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
  expect((await post({ "x-photo-request": "1" }, png())).status()).toBe(415); // a PNG
  expect((await post({ "x-photo-request": "1" }, Buffer.from("<html></html>"))).status()).toBe(415);
  expect((await page.request.delete(absolute(page, photoPath))).status()).toBe(400); // no request header
  expect((await page.request.put(absolute(page, photoPath.replace(/ANTERIOR$/, "TOP")), { headers: { "x-photo-request": "1" }, data: Buffer.from([0xff, 0xd8]) })).status()).toBe(404);

  // Nobody else reaches the images: no session, or another organization.
  const anonymous = await newActor(browser, baseURL);
  const noSession = await anonymous.page.request.get(absolute(page, src));
  expect(noSession.headers()["content-type"] ?? "").not.toContain("image/jpeg");
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio das fotos");
  const crossOrg = await other.page.request.get(absolute(other.page, photoPath.replace("/ANTERIOR", "/LATERAL_LEFT")));
  expect(crossOrg.status()).toBe(404);
  expect((await other.page.request.put(absolute(other.page, photoPath), { headers: { "x-photo-request": "1" }, data: Buffer.from([0xff, 0xd8]) })).status()).toBe(404);
  await anonymous.context.close();
  await other.context.close();

  // Recording closes it: the photos stay, nothing can change them.
  await answerScreening(page);
  await page.getByRole("button", { name: "Registrar avaliação" }).click();
  await expect(page.getByRole("heading", { name: `Avaliação de ${todayBR()}`, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fotos da postura" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Foto anterior do aluno" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Foto lateral esquerda do aluno" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Foto posterior do aluno" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Enviar foto|Remover foto/ })).toHaveCount(0);
  expect((await post({ "x-photo-request": "1" }, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).status()).toBe(404);
  const stillThere = await page.request.get(absolute(page, src));
  expect(stillThere.status()).toBe(200);

  // A photo of a recorded assessment can still be deleted, without any request of the student: the file goes, the record says it was erased.
  const lateralSrc = (await page.getByRole("img", { name: "Foto lateral esquerda do aluno" }).getAttribute("src"))!;
  await page.getByRole("button", { name: "Excluir foto lateral esquerda" }).click();
  await page.getByRole("button", { name: "Confirmar exclusão da foto lateral esquerda" }).click();
  await expect(page.getByText(/Foto apagada em /)).toBeVisible();
  await expect(page.getByRole("img", { name: "Foto lateral esquerda do aluno", exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Foto lateral esquerda do aluno: apagada", exact: true })).toBeVisible();
  expect((await page.request.get(absolute(page, lateralSrc))).status()).toBe(404);
  expect((await page.request.delete(absolute(page, lateralSrc), { headers: { "x-photo-request": "1" } })).status()).toBe(404);
  await expect(page.getByRole("img", { name: "Foto anterior do aluno" })).toBeVisible();

  // The evolution shows them, each with its date.
  await page.goto(`${studentURL}/evolucao`);
  await expect(page.getByRole("heading", { name: "Fotos da postura ao longo do tempo" })).toBeVisible();
  await expect(page.getByRole("img", { name: `Foto anterior de ${todayBR()}` })).toBeVisible();
  expect(draftURL).toContain("/avaliacoes/");
  void studentURL;
});

test("a student known to be under 18 is photographed like any other: nothing is refused for the age", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do menor");
  const studentURL = await addStudent(page, "Aluno menor de idade");
  const years = new Date();
  years.setUTCFullYear(years.getUTCFullYear() - 12);
  await page.getByRole("link", { name: "Preencher a ficha", exact: true }).click();
  await page.getByLabel("Data de nascimento").fill(years.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Ficha salva.")).toBeVisible();

  await page.goto(studentURL);
  await showStudentTab(page, "Avaliações");
  await page.getByRole("button", { name: "Iniciar avaliação" }).click();
  const fieldset = page.locator("fieldset", { hasText: "Fotos da postura" });
  await expect(fieldset.getByText("Menor de idade.", { exact: false })).toHaveCount(0);
  await expect(fieldset.getByRole("checkbox")).toHaveCount(0);
  await upload(page, "ANTERIOR");
  await expect(page.getByText("Foto anterior enviada.")).toBeVisible();
  await expect(slot(page, "anterior").getByRole("img", { name: "Foto anterior do aluno" })).toBeVisible();
});

test("a student with access is photographed without any choice of theirs, and their account has no photos choice", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio sem escolha");
  const studentURL = await addStudent(page, "Aluno sem escolha de fotos");
  await page.goto(studentURL);
  const email = await joinStudent(page, browser, baseURL, "Aluno sem escolha de fotos");

  await page.goto(studentURL);
  await showStudentTab(page, "Avaliações");
  await page.getByRole("button", { name: "Iniciar avaliação" }).click();
  const fieldset = page.locator("fieldset", { hasText: "Fotos da postura" });
  await expect(fieldset.getByText(/não autoriz|autorizou/)).toHaveCount(0);
  await noHorizontalOverflow(page);
  await upload(page, "ANTERIOR");
  await expect(page.getByText("Foto anterior enviada.")).toBeVisible();
  await expect(slot(page, "anterior").getByRole("img", { name: "Foto anterior do aluno" })).toBeVisible();

  const student = await newActor(browser, baseURL);
  await signIn(student.page, email);
  await student.page.goto("./aluno/conta");
  await expect(student.page.getByRole("heading", { name: "Fotos da sua postura (opcional)" })).toHaveCount(0);
  await expect(student.page.getByText(/Autorizo o meu profissional a registrar fotos/)).toHaveCount(0);
  await student.context.close();
});
