import zlib from "node:zlib";
import { expect, type Browser, type Page } from "@playwright/test";

export const password = "only-for-local-browser-testing";

/**
 * Local Worker only: every actor gets its own rate-limit bucket. Production must
 * overwrite this header at the edge; the limiter itself is tested against D1.
 */
export const localIP = () =>
  `10.${[...crypto.getRandomValues(new Uint8Array(3))].join(".")}`;

export const uniqueEmail = (prefix: string) =>
  `${prefix}-${crypto.randomUUID()}@example.test`;

/** A fresh browser identity (own cookies, own rate-limit bucket). */
export async function newActor(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "cf-connecting-ip": localIP() },
  });
  return { context, page: await context.newPage() };
}

export async function signUp(
  page: Page,
  name: string,
  email: string,
  path = "./cadastro",
) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator("form button").click();
}

export async function signIn(page: Page, email: string, path = "./entrar") {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Wait for the session to exist before the caller navigates on.
  await page.waitForURL((url) => !url.pathname.endsWith("/entrar"));
}

/** Professional account + workspace. Ends on the professional overview. */
export async function createProfessional(
  page: Page,
  workspace: string,
  name = "Profissional E2E",
) {
  const email = uniqueEmail("pro");
  await signUp(page, name, email);
  await expect(
    page.getByRole("heading", { name: "Um espaço para seu método." }),
  ).toBeVisible();
  await page.getByLabel("Nome do espaço").fill(workspace);
  await acceptProfessionalTerms(page);
  await page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible();
  return email;
}

export async function addStudent(page: Page, name: string) {
  await page.goto("./profissional/alunos/novo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome do aluno").fill(name);
  await page.getByRole("button", { name: "Cadastrar aluno" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return page.url();
}

export async function noHorizontalOverflow(page: Page) {
  // When the page is wider than the window, name what sticks out, so the failure says where to look.
  const offenders = await page.evaluate(async () => {
    // The layout is only final once the fonts are in and a frame has been drawn.
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    if (document.documentElement.scrollWidth <= innerWidth) return [];
    return [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 6)
      .map((element) => `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(" ").join(".")}` : ""} → ${Math.round(element.getBoundingClientRect().right)}px of ${innerWidth}px`);
  });
  expect(offenders).toEqual([]);
}

/** Desktop has "Sair" in the top bar; on a phone it lives in the menu sheet. */
export async function signOut(page: Page) {
  const button = page.getByRole("button", { name: "Sair", exact: true });
  if (!(await button.first().isVisible()))
    await page.getByRole("button", { name: "Menu" }).click();
  await button.first().click();
}

/** Joining the tool is where the terms are accepted, once: the professional when creating the space. */
export async function acceptProfessionalTerms(page: Page) {
  await page.getByLabel("Li e aceito os termos de uso.").check();
}

/** The student, when accepting the invitation. The photos are a separate, optional choice. */
export async function acceptStudentTerms(page: Page, options: { photos?: boolean } = {}) {
  await page.getByLabel(/Tenho 18 anos completos, li e aceito/).check();
  if (options.photos) await page.getByLabel(/Autorizo o meu profissional a registrar fotos/).check();
}

/** From a student's page: generates the invitation and signs the student up with it, terms not yet accepted. */
export async function openInvitation(page: Page, browser: Browser, baseURL: string | undefined, studentName: string) {
  await page.getByRole("button", { name: "Gerar link de convite" }).click();
  const link = await page.getByLabel("Link de convite (uso único)").inputValue();
  const client = await newActor(browser, baseURL);
  const email = uniqueEmail("client");
  await client.page.goto(new URL(link).pathname);
  await client.page.waitForLoadState("networkidle");
  await client.page.getByLabel("Seu nome").fill(studentName);
  await client.page.getByLabel("E-mail", { exact: true }).fill(email);
  await client.page.getByLabel("Senha", { exact: true }).fill(password);
  await client.page.getByRole("button", { name: "Criar meu acesso" }).click();
  await expect(client.page.getByRole("button", { name: "Aceitar convite" })).toBeVisible();
  return { client, email };
}

/**
 * The student joins from the professional's page of that student: reads the invitation, accepts the
 * terms (the photos are an optional choice) and reaches their own area. The student's session is closed.
 */
export async function joinStudent(
  page: Page,
  browser: Browser,
  baseURL: string | undefined,
  studentName: string,
  options: { photos?: boolean } = {},
) {
  const { client, email } = await openInvitation(page, browser, baseURL, studentName);
  await acceptStudentTerms(client.page, options);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  // The invitation is accepted when the student area opens: closing before would cancel it.
  await expect(client.page).toHaveURL(/\/aluno\/?$/);
  await client.context.close();
  return email;
}

/** A real PNG (a gradient), so the browser has something to decode and re-draw. */
export function png(width = 120, height = 160): Buffer {
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
