import { test, expect, type Page } from "@playwright/test";
import { createProfessional, localIP, noHorizontalOverflow, password, signIn, signOut } from "./helpers";
import { totpCode } from "../helpers/totp";

// Every phase uses its own address for the local limiter (the library limits the second step to a few
// tries every ten seconds per address), as separate people at separate places would.
const from = (page: Page) => page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
const wrongCodeFor = (key: string) => String((Number(totpCode(key)) + 1) % 1_000_000).padStart(6, "0");

/** The first step, by hand: with the second step on, the page does not leave the sign-in. */
async function passwordStep(page: Page, address: string) {
  await page.goto("./entrar");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail", { exact: true }).fill(address);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Digite o código." })).toBeVisible();
}

test("a professional turns on the second step, signs in with the app and with a recovery code, renews the codes and turns it off", async ({
  page,
}) => {
  await from(page);
  const address = await createProfessional(page, "Estúdio das duas etapas", "Profissional Duas Etapas");

  // Off by default, and it says what it is for.
  await page.goto("./profissional/conta");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Verificação em duas etapas" }) });
  await expect(panel.getByText("Desativada.")).toBeVisible();
  await expect(panel.getByText("não é obrigatória", { exact: false })).toHaveCount(0);
  await noHorizontalOverflow(page);

  // Starting needs the password.
  await panel.getByRole("button", { name: "Ativar a verificação em duas etapas" }).click();
  await panel.getByLabel("Sua senha").fill("não é a senha da conta");
  await panel.getByRole("button", { name: "Continuar" }).click();
  await expect(panel.locator("p.form-error")).toContainText("A senha não confere.");
  await panel.getByLabel("Sua senha").fill(password);
  await panel.getByRole("button", { name: "Continuar" }).click();

  // The screen gives the QR, the typed key and ten codes, once. Nothing counts before a code is typed.
  await expect(panel.getByRole("img", { name: /Código QR/ })).toBeVisible();
  const key = (await panel.locator(".two-factor-key").innerText()).replace(/\s/g, "");
  expect(key).toMatch(/^[A-Z2-7]{20,}$/);
  const recovery = await panel.getByRole("list", { name: "Códigos de recuperação" }).getByRole("listitem").allInnerTexts();
  expect(recovery).toHaveLength(10);
  expect(new Set(recovery).size).toBe(10);
  await expect(panel.getByText("Eles não aparecem de novo.", { exact: false })).toBeVisible();
  await noHorizontalOverflow(page);
  await panel.getByLabel("Código do aplicativo").fill(wrongCodeFor(key));
  await panel.getByRole("button", { name: "Ativar a verificação" }).click();
  await expect(panel.locator("p.form-error")).toContainText("Esse código não confere");
  await from(page);
  await panel.getByLabel("Código do aplicativo").fill(totpCode(key));
  await panel.getByRole("button", { name: "Ativar a verificação" }).click();
  await expect(panel.getByText("Verificação em duas etapas ativada.", { exact: false })).toBeVisible();
  await expect(panel.getByText("Ativada.", { exact: true })).toBeVisible();

  // Signing in now asks for a code after the password, and a wrong one gets nowhere.
  await signOut(page);
  await from(page);
  await passwordStep(page, address);
  await page.getByLabel("Código do aplicativo").fill(wrongCodeFor(key));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator("p.form-error")).toContainText("Esse código não confere");
  await expect(page).toHaveURL(/\/entrar/);
  await from(page);
  await page.getByLabel("Código do aplicativo").fill(totpCode(key));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/profissional\/?$/);

  // Lost the phone: a recovery code takes its place, once.
  await signOut(page);
  await from(page);
  await passwordStep(page, address);
  await page.getByRole("button", { name: /Perdi o celular/ }).click();
  await page.getByLabel("Código de recuperação").fill(recovery[0]);
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/profissional\/?$/);
  await signOut(page);
  await from(page);
  await passwordStep(page, address);
  await page.getByRole("button", { name: /Perdi o celular/ }).click();
  await page.getByLabel("Código de recuperação").fill(recovery[0]);
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator("p.form-error")).toContainText("não confere ou já foi usado");
  await page.getByRole("button", { name: "Voltar ao código do aplicativo" }).click();
  await page.getByLabel("Código do aplicativo").fill(totpCode(key));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/profissional\/?$/);

  // New recovery codes need the password and retire the old ones.
  await from(page);
  await page.goto("./profissional/conta");
  const again = page.locator("section", { has: page.getByRole("heading", { name: "Verificação em duas etapas" }) });
  await again.getByRole("button", { name: "Gerar novos códigos de recuperação" }).click();
  await again.getByLabel("Sua senha").fill("não é a senha da conta");
  await again.getByRole("button", { name: "Gerar novos códigos" }).click();
  await expect(again.locator("p.form-error")).toContainText("A senha não confere.");
  await again.getByLabel("Sua senha").fill(password);
  await again.getByRole("button", { name: "Gerar novos códigos" }).click();
  await expect(again.getByRole("list", { name: "Novos códigos de recuperação" }).getByRole("listitem")).toHaveCount(10);
  await again.getByRole("button", { name: "Já guardei os códigos" }).click();

  // Turning it off needs the password; after that, signing in asks for the password alone.
  await again.getByRole("button", { name: "Desativar", exact: true }).click();
  await again.getByLabel("Sua senha").fill("não é a senha da conta");
  await again.getByRole("button", { name: "Desativar", exact: true }).click();
  await expect(again.locator("p.form-error")).toContainText("A senha não confere.");
  await again.getByLabel("Sua senha").fill(password);
  await again.getByRole("button", { name: "Desativar", exact: true }).click();
  await expect(again.getByText("Verificação em duas etapas desativada.", { exact: false })).toBeVisible();
  await signOut(page);
  await from(page);
  await signIn(page, address);
  await expect(page).toHaveURL(/\/profissional\/?$/);
});
