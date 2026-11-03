import { test, expect, type Page } from "@playwright/test";
import { addStudent, browserJpeg, createProfessional, joinStudent, localIP, newActor, noHorizontalOverflow, png, showStudentTab, signIn } from "./helpers";
import { PARQ } from "../../src/modules/avaliacoes/catalog";

// Slice 0.83: the optional photos of the posture of the Avaliação Física (handoff 3.3; PENDENCIAS B48), through the private photo route of
// 0.14 (relative to the mount, never a fixed "/api"). No consent, authorization or age gate (decision of 03/11/2026).
const step = (page: Page, name: string) => page.getByRole("navigation", { name: "Etapas da avaliação física" }).getByRole("button", { name });
const question = (page: Page, text: string) => page.getByRole("radiogroup", { name: text, exact: true });
const slot = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

/** Screenshots for the visual check, at every width the brief asks for, only where asked (SHOTS_DIR) and once (desktop project). */
async function shots(page: Page, name: string, projectName: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir || projectName !== "desktop") return;
  const prefix = process.env.BASE_URL ? "0.83b" : "0.83";
  const size = page.viewportSize();
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${dir}/${prefix}-${name}-${width}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

/** The image really loaded (the route served a JPEG the browser could draw). */
async function drawn(page: Page, alt: string) {
  const image = page.getByRole("img", { name: alt, exact: true });
  await expect(image).toBeVisible();
  // It is loaded lazily: on a phone it may be below the fold.
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
}

test("the posture takes optional photos per view on a draft, they freeze with the record, can be erased, and an amendment starts without them", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das fotos posturais");
  const studentURL = await addStudent(page, "Aluna das fotos posturais");
  const email = await joinStudent(page, browser, baseURL, "Aluna das fotos posturais");
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  for (const text of Object.values(PARQ)) await question(page, text).getByRole("radio", { name: "Não", exact: true }).check();

  // Movimento: each view has its photos under its notes; the lateral view takes both sides. Nothing is there by itself.
  await step(page, "3 Movimento").click();
  const posture = page.getByRole("region", { name: "Avaliação postural" });
  await expect(posture.getByRole("group", { name: "Fotos da vista lateral (opcional)" })).toBeVisible();
  await expect(slot(page, "Foto lateral esquerda").getByText("Sem foto")).toBeVisible();
  await expect(slot(page, "Foto lateral direita").getByText("Sem foto")).toBeVisible();
  await expect(posture.getByText(/tira da foto os dados do aparelho/).first()).toBeVisible();

  // A JPEG goes at once; a PNG is re-drawn as a JPEG by the browser; one per view, replaced in place.
  const jpeg = await browserJpeg(page);
  await page.getByLabel("Enviar foto lateral esquerda").setInputFiles({ name: "lateral.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.getByRole("status").filter({ hasText: "Foto da vista lateral esquerda enviada." })).toBeVisible();
  await drawn(page, "Foto lateral esquerda do aluno");
  await page.getByLabel("Substituir foto lateral esquerda").setInputFiles({ name: "lateral.png", mimeType: "image/png", buffer: png() });
  await expect(page.getByRole("status").filter({ hasText: "Foto da vista lateral esquerda enviada." })).toBeVisible();
  await drawn(page, "Foto lateral esquerda do aluno");
  // Something that is not a picture is said, and nothing changes.
  await page.getByLabel("Enviar foto lateral direita").setInputFiles({ name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("não é foto") });
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível ler esta imagem" })).toBeVisible();
  await expect(slot(page, "Foto lateral direita").getByText("Sem foto")).toBeVisible();
  await page.getByLabel("Enviar foto lateral direita").setInputFiles({ name: "lateral-d.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await drawn(page, "Foto lateral direita do aluno");
  await page.getByRole("button", { name: "Remover foto lateral direita" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Foto da vista lateral direita removida." })).toBeVisible();
  await expect(slot(page, "Foto lateral direita").getByText("Sem foto")).toBeVisible();
  await posture.getByRole("tab", { name: /^Anterior/ }).click();
  await page.getByLabel("Enviar foto anterior").setInputFiles({ name: "anterior.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await drawn(page, "Foto anterior do aluno");
  await expect(page.getByRole("status").filter({ hasText: "Foto da vista anterior enviada." })).toBeVisible();
  // The photo buttons reach the 44px touch target.
  const anterior = slot(page, "Foto anterior");
  for (const control of [anterior.locator("label.button"), anterior.getByRole("button", { name: "Remover foto anterior" })]) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await shots(page, "movimento-fotos-anterior", testInfo.project.name);
  await posture.getByRole("tab", { name: /^Lateral/ }).click();
  // The line of the last photo is not read under another view.
  await expect(page.getByRole("status").filter({ hasText: "Foto da vista anterior enviada." })).toHaveCount(0);
  await shots(page, "movimento-fotos-lateral", testInfo.project.name);

  // The photos stay when the step changes and after a reload (they are stored, apart from the autosave of the text).
  await step(page, "2 Medidas").click();
  await step(page, "3 Movimento").click();
  await drawn(page, "Foto lateral esquerda do aluno");
  await page.reload();
  await step(page, "3 Movimento").click();
  await drawn(page, "Foto lateral esquerda do aluno");
  await expect(slot(page, "Foto lateral direita").getByText("Sem foto")).toBeVisible();

  // Finalize; the record shows the photos per view, says they are not in the PDF, and each one can still be erased.
  await step(page, "5 Revisão").click();
  await page.getByRole("button", { name: "Finalizar avaliação" }).click();
  await page.getByRole("button", { name: "Confirmar e finalizar" }).click();
  await expect(page.getByRole("heading", { name: /^Avaliação física de \d{2}\/\d{2}\/\d{4}$/, level: 1 })).toBeVisible();
  const recordedURL = page.url();
  const photos = page.getByRole("group", { name: "Fotos da postura" });
  await expect(photos.getByRole("figure")).toHaveCount(2);
  await expect(photos.locator("figcaption")).toHaveText(["Lateral esquerda", "Anterior"]);
  await expect(page.getByText(/elas não entram no relatório em PDF/)).toBeVisible();
  const day = (await page.getByRole("heading", { level: 1 }).textContent())!.match(/\d{2}\/\d{2}\/\d{4}/)![0];
  await drawn(page, `Foto lateral esquerda de ${day}`);
  await shots(page, "registro-fotos", testInfo.project.name);

  // Frozen: the route refuses a new photo and a removal through the draft path is now an erasure.
  const route = (view: string) => new URL(`${new URL(recordedURL).pathname}/fotos/${view}`, page.url()).href;
  const late = await page.request.put(route("POSTERIOR"), { headers: { "x-photo-request": "1", "content-type": "image/jpeg" }, data: jpeg });
  expect(late.status()).toBe(404);
  await page.getByRole("button", { name: "Excluir foto anterior" }).click();
  await page.getByRole("button", { name: "Confirmar exclusão da foto anterior" }).click();
  await expect(photos.getByText(/^Foto apagada em /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Excluir foto anterior" })).toHaveCount(0);
  expect((await page.request.get(route("ANTERIOR"))).status()).toBe(404);
  expect((await page.request.get(route("LATERAL_LEFT"))).status()).toBe(200);

  // The student never reaches the photos: not through the route, and the student's assessments page shows none.
  const student = await newActor(browser, baseURL);
  await signIn(student.page, email);
  const asStudent = await student.page.request.get(route("LATERAL_LEFT"));
  expect(asStudent.headers()["content-type"] ?? "").not.toContain("image/jpeg");
  await student.page.goto("./aluno/avaliacoes");
  await expect(student.page.getByRole("img", { name: /^Foto / })).toHaveCount(0);
  await student.context.close();

  // An amendment starts without photos (the corrected one keeps its own) and takes new ones; discarding it removes them.
  await page.getByRole("button", { name: "Retificar" }).click();
  await page.getByLabel("Motivo da retificação").fill("Foto da vista errada");
  await page.getByRole("button", { name: "Criar retificação" }).click();
  await expect(page.getByRole("heading", { name: "Retificação da avaliação física de Aluna das fotos posturais" })).toBeVisible();
  await step(page, "3 Movimento").click();
  await expect(posture.getByText(/Esta retificação começa sem fotos/).first()).toBeVisible();
  await expect(slot(page, "Foto lateral esquerda").getByText("Sem foto")).toBeVisible();
  await page.getByLabel("Enviar foto lateral direita").setInputFiles({ name: "lateral-d.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await drawn(page, "Foto lateral direita do aluno");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(page.getByRole("button", { name: "Iniciar reavaliação física" })).toBeVisible();
  await page.goto(recordedURL);
  await drawn(page, `Foto lateral esquerda de ${day}`);
  await expect(page.getByRole("group", { name: "Fotos da postura" }).getByRole("figure")).toHaveCount(2);
});
