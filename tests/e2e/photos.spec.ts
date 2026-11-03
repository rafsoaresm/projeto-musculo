import { test, expect, type Page } from "@playwright/test";
import { addStudent, browserJpeg, createProfessional, joinStudent, localIP, newActor, showStudentTab, signIn } from "./helpers";

// The photo field of the earlier form went away with that form (user's decision of 03/11/2026: only the Avaliação Física); since 0.83 the
// posture step of the Avaliação Física takes the photos again (assessment-posture-photos.spec.ts). Checked here is the private route the photos
// go through: what it stores and serves, what it refuses, and to whom. Storing, freezing with a recorded assessment and
// erasing are also covered against the real D1 and R2 in tests/assessment-photos.test.ts.

const absolute = (page: Page, path: string) => new URL(path, page.url()).href;

async function draftOf(page: Page, student: string) {
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: `Avaliação física de ${student}` })).toBeVisible();
  return page.url();
}

test("the photo route stores a clean JPEG of an open draft privately, serves it only to the professional, and refuses the rest", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das fotos");
  await addStudent(page, "Aluna das fotos");
  const draftURL = await draftOf(page, "Aluna das fotos");
  const photo = (view: string) => absolute(page, `${new URL(draftURL).pathname}/fotos/${view}`);
  const send = (view: string, data: Buffer, headers: Record<string, string> = { "x-photo-request": "1", "content-type": "image/jpeg" }) =>
    page.request.put(photo(view), { headers, data });

  const jpeg = await browserJpeg(page);
  const stored = await send("ANTERIOR", jpeg);
  expect(stored.status()).toBe(200);
  expect(await stored.json()).toEqual({ stored: true, replaced: false });
  const served = await page.request.get(photo("ANTERIOR"));
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  expect(served.headers()["cache-control"]).toContain("no-store");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");
  const body = await served.body();
  expect(body.subarray(0, 3).toString("hex")).toBe("ffd8ff");
  expect(body.includes(Buffer.from("Exif"))).toBe(false);
  expect(await (await send("ANTERIOR", jpeg)).json()).toEqual({ stored: true, replaced: true });

  // What it refuses, for the signed-in professional too.
  expect((await send("ANTERIOR", jpeg, { "content-type": "image/jpeg" })).status()).toBe(400); // no request header
  expect((await send("LATERAL_LEFT", Buffer.from("<html></html>"))).status()).toBe(415);
  expect((await send("TOP", jpeg)).status()).toBe(404);
  expect((await page.request.delete(photo("ANTERIOR"))).status()).toBe(400); // no request header
  expect((await page.request.get(photo("POSTERIOR"))).status()).toBe(404);

  // Nobody else reaches the image: no session, or another organization.
  const anonymous = await newActor(browser, baseURL);
  const noSession = await anonymous.page.request.get(photo("ANTERIOR"));
  expect(noSession.headers()["content-type"] ?? "").not.toContain("image/jpeg");
  const other = await newActor(browser, baseURL);
  await createProfessional(other.page, "Outro estúdio das fotos");
  expect((await other.page.request.get(photo("ANTERIOR"))).status()).toBe(404);
  expect((await other.page.request.put(photo("LATERAL_LEFT"), { headers: { "x-photo-request": "1" }, data: jpeg })).status()).toBe(404);
  expect((await other.page.request.delete(photo("ANTERIOR"), { headers: { "x-photo-request": "1" } })).status()).toBe(404);
  await anonymous.context.close();
  await other.context.close();

  // Removing it from the open draft takes the file away.
  const removed = await page.request.delete(photo("ANTERIOR"), { headers: { "x-photo-request": "1" } });
  expect(await removed.json()).toEqual({ removed: true, erased: false });
  expect((await page.request.get(photo("ANTERIOR"))).status()).toBe(404);
});

test("a student under 18 or with access is handled like any other: nothing is refused, and the student's account has no photos choice", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio sem escolha");
  const studentURL = await addStudent(page, "Aluno menor sem escolha");
  const years = new Date();
  years.setUTCFullYear(years.getUTCFullYear() - 12);
  await page.getByRole("link", { name: "Preencher a ficha", exact: true }).click();
  await page.getByLabel("Data de nascimento").fill(years.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Ficha salva.")).toBeVisible();
  await page.goto(studentURL);
  const email = await joinStudent(page, browser, baseURL, "Aluno menor sem escolha");

  await page.goto(studentURL);
  const draftURL = await draftOf(page, "Aluno menor sem escolha");
  const stored = await page.request.put(absolute(page, `${new URL(draftURL).pathname}/fotos/ANTERIOR`), {
    headers: { "x-photo-request": "1", "content-type": "image/jpeg" },
    data: await browserJpeg(page),
  });
  expect(stored.status()).toBe(200);

  const student = await newActor(browser, baseURL);
  await signIn(student.page, email);
  await student.page.goto("./aluno/conta");
  await expect(student.page.getByRole("heading", { name: "Fotos da sua postura (opcional)" })).toHaveCount(0);
  await expect(student.page.getByText(/Autorizo o meu profissional a registrar fotos/)).toHaveCount(0);
  await student.context.close();
});
