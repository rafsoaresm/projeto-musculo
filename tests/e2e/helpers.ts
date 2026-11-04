import zlib from "node:zlib";
import { totpCode } from "../helpers/totp";
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
  // Sign-up ends in two pages drawn by the server one after the other; with many tests at once one of them can take longer than the
  // default 5 s (seen in CI, desktop and phone). The wait is only longer, the page is the same.
  const signUpPage = { timeout: 15_000 };
  await expect(
    page.getByRole("heading", { name: "Um espaço para seu método." }),
  ).toBeVisible(signUpPage);
  await page.getByLabel("Nome do espaço").fill(workspace);
  await expectNoTermsBox(page);
  await page.getByRole("button", { name: "Criar meu espaço" }).click();
  await expect(page.getByRole("heading", { name: "Visão geral", level: 1 })).toBeVisible(signUpPage);
  return email;
}

/** Opens a tab of the student's record (Resumo, Avaliação Física, Periodização, Treinos, Evolução, Acesso e dados) unless it is already open. */
export async function showStudentTab(page: Page, name: "Resumo" | "Avaliação Física" | "Periodização" | "Treinos" | "Evolução" | "Acesso e dados") {
  const tab = page.getByRole("tablist", { name: "Ficha do aluno" }).getByRole("tab", { name: new RegExp(`^${name}`) });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
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

/**
 * Desktop has "Sair" in the top bar; on a phone it lives in the menu drawer. The drawer closes when the address changes (a navigation that
 * was still finishing when it opened closes it again), so it is opened again until "Sair" is clicked inside it.
 */
export async function signOut(page: Page) {
  const button = page.getByRole("button", { name: "Sair", exact: true });
  if (await button.first().isVisible()) {
    await button.first().click();
    return;
  }
  await expect(async () => {
    const drawer = page.getByRole("dialog");
    if (!(await drawer.isVisible())) await page.getByRole("button", { name: "Menu" }).click();
    await drawer.getByRole("button", { name: "Sair", exact: true }).click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Joining the tool asks for nothing to be ticked (decision of 03/11/2026): the terms can be read, folded, and there is no box of acceptance,
 * of age or of photos. Used where a person creates a space or accepts an invitation, to say so.
 */
export async function expectNoTermsBox(page: Page) {
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText(/Tenho 18 anos completos|Li e aceito os termos|Autorizo o meu profissional a registrar fotos/)).toHaveCount(0);
}

/** From a student's page: generates the invitation and signs the student up with it, the invitation not yet accepted. */
export async function openInvitation(page: Page, browser: Browser, baseURL: string | undefined, studentName: string) {
  await showStudentTab(page, "Acesso e dados");
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
 * The student joins from the professional's page of that student: accepts the invitation (nothing to tick)
 * and reaches their own area. The student's session is closed.
 */
export async function joinStudent(
  page: Page,
  browser: Browser,
  baseURL: string | undefined,
  studentName: string,
) {
  const { client, email } = await openInvitation(page, browser, baseURL, studentName);
  await expectNoTermsBox(client.page);
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

/**
 * From the account page of someone signed in: starts the second step with the password, reads the key
 * and the recovery codes the screen shows, and confirms with a code computed from that key. Returns what a
 * person would have written down.
 */
export async function turnOnTwoFactor(page: Page, accountPath: string) {
  await page.goto(accountPath);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Ativar a verificação em duas etapas" }).click();
  await page.getByLabel("Sua senha").fill(password);
  await page.getByRole("button", { name: "Continuar" }).click();
  const key = (await page.locator(".two-factor-key").innerText()).replace(/\s/g, "");
  const recovery = await page.getByRole("list", { name: "Códigos de recuperação" }).getByRole("listitem").allInnerTexts();
  await page.getByLabel("Código do aplicativo").fill(totpCode(key));
  await page.getByRole("button", { name: "Ativar a verificação" }).click();
  await expect(page.getByText("Verificação em duas etapas ativada.", { exact: false })).toBeVisible();
  return { key, recovery };
}

/**
 * Records what the content policy of a page refuses (the editor runs under one). Call before the page is opened; read with `policyRefusals`.
 * One refusal is known and harmless: a library bundled with the editor tries `Function("return this")()` to find the global object and, refused,
 * falls back to `window` (see `PageBuilder-*.js`); it is left out. Anything else is the editor losing something, or a block trying something.
 */
export async function trackPolicy(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __refused: string[] };
    w.__refused = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      const target = event.target instanceof Element ? event.target.outerHTML.slice(0, 160) : "";
      w.__refused.push(`${event.violatedDirective} ${event.blockedURI} ${event.sourceFile} ${target}`);
    });
  });
}

export async function policyRefusals(page: Page): Promise<string[]> {
  const all = await page.evaluate(() => (window as unknown as { __refused?: string[] }).__refused ?? []);
  return all.filter((entry) => !/^script-src eval \S+\/frappe-editor\/assets\/PageBuilder-[\w-]+\.js\s*$/.test(entry));
}

/** A small JPEG drawn by the browser itself (as the photo field of the earlier form did before sending), for the photo route. */
export async function browserJpeg(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 160;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2f6fa3";
    context.fillRect(0, 0, 120, 160);
    context.fillStyle = "#f3c14b";
    context.fillRect(30, 40, 60, 80);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), "image/jpeg", 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
/** A small READY plan for the student at `studentURL`, waiting on the approval step. Returns the revision address. */
export async function readyPlan(page: Page, studentURL: string, title: string) {
  await page.goto(studentURL);
  await showStudentTab(page, "Periodização");
  await page.getByRole("link", { name: "Novo plano" }).click();
  await page.getByLabel("Nome do plano").fill(title);
  await page.getByLabel("Data de início").fill(yesterday());
  for (const phase of ["Fase 01", "Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar fase" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Divisão de treinos").selectOption("Full Body");
    await page.getByLabel("Alvo de exercícios por treino").selectOption("3");
  }
  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const fullBody = page.getByRole("region", { name: "Treino Full Body" });
  for (const name of ["Agachamento da triagem", "Remada da triagem", "Prancha da triagem"]) {
    await fullBody.getByLabel("Ou um exercício com nome próprio").fill(name);
    await fullBody.getByRole("button", { name: "Adicionar com nome próprio" }).click();
    await expect(fullBody.locator(".exercise-list").getByText(name)).toBeVisible();
  }
  for (const phase of ["Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar mesociclo" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Copiar o mesociclo de outra fase").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Copiar mesociclo" }).click();
    await expect(page.getByText("Mesociclo copiado.")).toBeVisible();
  }
  await page.getByRole("button", { name: "Marcar estrutura como pronta" }).click();
  await expect(page.getByRole("heading", { name: "Aprovar esta revisão" })).toBeVisible();
  return page.url();
}

/** A draft revision folds the structure of the cycle under the prescription (0.93); this unfolds it. */
export async function openStructure(page: Page) {
  const details = page.locator("details.structure-details");
  await expect(details).toHaveCount(1);
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
    await details.locator("summary").click();
  await expect(details.getByLabel("Data de início")).toBeVisible();
}
