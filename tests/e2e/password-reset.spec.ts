import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { createProfessional, localIP, newActor, noHorizontalOverflow, password, signIn, signOut, uniqueEmail } from "./helpers";

/**
 * Reads the e-mail the local "capture" transport kept: the application only honours that transport on
 * 127.0.0.1 or localhost, so this is how the test gets the link a person would find in their inbox.
 * It reads the LOCAL database from outside the worker, so the scenario runs alone (see the `recovery`
 * project), like the one that writes to it.
 */
function capturedTexts(recipient: string): string[] {
  const sql = `SELECT captured_text AS text FROM email_messages WHERE recipient = '${recipient.toLowerCase()}' AND status = 'SENT' ORDER BY rowid`;
  const output = execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command", sql], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  const parsed = JSON.parse(output.slice(output.indexOf("["))) as Array<{ results: Array<{ text: string }> }>;
  return parsed[0].results.map((row) => row.text);
}
const linkIn = (text: string) => text.match(/https?:\/\/\S+\/redefinir-senha#token=\S+/)![0];
const NEUTRAL = "Se este e-mail tiver uma conta, enviamos um link";
const fresh = "uma-senha-nova-bem-longa";

test("a forgotten password is recovered with the link from the e-mail, once, and every session ends", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const email = await createProfessional(page, "Estúdio da senha");
  // The same account is also signed in on another device.
  const other = await newActor(browser, baseURL);
  await signIn(other.page, email);
  await other.page.goto("./profissional");
  await expect(other.page.getByRole("heading", { name: /^Olá, / })).toBeVisible();
  await signOut(page);

  // The recovery exists here: the sign-in page offers it and the health says so, without saying how.
  const health = await page.request.get(new URL("api/health", baseURL).href);
  expect((await health.json()).capabilities.passwordRecovery).toBe("available");
  await page.goto("./entrar");
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(page.getByRole("heading", { name: "Esqueci minha senha" })).toBeVisible();
  await noHorizontalOverflow(page);

  // An address with no account gets the same answer and nothing is sent.
  const stranger = uniqueEmail("ninguem");
  await page.getByLabel("E-mail da sua conta").fill(stranger);
  await page.getByRole("button", { name: "Enviar o link" }).click();
  await expect(page.getByText(NEUTRAL, { exact: false })).toBeVisible();
  expect(capturedTexts(stranger)).toEqual([]);

  // The real address, typed in capitals, gets the same answer and one e-mail with the link.
  await page.goto("./esqueci-a-senha");
  await page.getByLabel("E-mail da sua conta").fill(email.toUpperCase());
  await page.getByRole("button", { name: "Enviar o link" }).click();
  await expect(page.getByText(NEUTRAL, { exact: false })).toBeVisible();
  const [mail] = capturedTexts(email);
  expect(mail).toContain("vale por 1 hora");
  const link = linkIn(mail);

  // The link opens our own page. The token is in the fragment, so the server never sees it, and it
  // leaves the address bar as soon as the page is up.
  const asked: string[] = [];
  page.on("request", (request) => asked.push(request.url()));
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Escolha uma nova senha" })).toBeVisible();
  await expect(page.getByLabel("Nova senha", { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  expect(asked.filter((url) => url.includes("token="))).toEqual([]);
  await noHorizontalOverflow(page);
  await page.getByLabel("Nova senha", { exact: true }).fill(fresh);
  await page.getByLabel("Repita a nova senha").fill(`${fresh}-diferente`);
  await page.getByRole("button", { name: "Salvar a nova senha" }).click();
  await expect(page.locator("p.form-error")).toContainText("A confirmação não é igual à nova senha.");
  await page.getByLabel("Repita a nova senha").fill(fresh);
  await page.getByRole("button", { name: "Salvar a nova senha" }).click();
  await expect(page.getByText("Senha alterada.", { exact: false })).toBeVisible();

  // The other device was signed out; the old password no longer opens the account; the new one does.
  await other.page.goto("./profissional");
  await expect(other.page).toHaveURL(/\/(entrar|acesso)/);
  await page.goto("./entrar");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("p.form-error")).toContainText("Não foi possível entrar");
  await page.getByLabel("Senha", { exact: true }).fill(fresh);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/entrar"));
  await expect(page.getByRole("heading", { name: /^Olá, / })).toBeVisible();

  // The link works once; an invalid one is told apart from one that was used.
  await signOut(page);
  await page.goto(link);
  await page.getByLabel("Nova senha", { exact: true }).fill("outra-senha-bem-longa-ainda");
  await page.getByLabel("Repita a nova senha").fill("outra-senha-bem-longa-ainda");
  await page.getByRole("button", { name: "Salvar a nova senha" }).click();
  await expect(page.locator("p.form-error")).toContainText("Este link venceu ou já foi usado");
  await page.goto("./redefinir-senha#token=curto");
  await expect(page.getByText("Este link não é válido.", { exact: false })).toBeVisible();
  await page.goto("./redefinir-senha");
  await expect(page.getByText("Este link não é válido.", { exact: false })).toBeVisible();
  await other.context.close();
});
