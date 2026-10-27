import { test, expect } from "@playwright/test";
import { createProfessional, localIP, newActor, noHorizontalOverflow, signIn, signOut } from "./helpers";

test("a professional sees where the account is open, disconnects another device and reads the latest sign-ins", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const address = await createProfessional(page, "Estúdio dos aparelhos", "Profissional Aparelhos");
  const panelOf = (target: typeof page) =>
    target.locator("section", { has: target.getByRole("heading", { name: "Aparelhos conectados", level: 2 }) });

  // Only this device, and no sign-in is on record yet: the account was made a moment ago.
  await page.goto("./profissional/conta");
  const panel = panelOf(page);
  const devices = panel.getByRole("list", { name: "Aparelhos conectados" }).getByRole("listitem");
  await expect(devices).toHaveCount(1);
  await expect(panel.getByText("Este aparelho")).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Desconectar / })).toHaveCount(0);
  await expect(panel.getByText("A lista começa na primeira entrada", { exact: false })).toBeVisible();
  await expect(panel.getByText("Aparelho não identificado")).toHaveCount(0);

  // The same account, opened somewhere else.
  const other = await newActor(browser, baseURL);
  await signIn(other.page, address);
  await other.page.goto("./profissional/conta");
  await expect(panelOf(other.page).getByRole("list", { name: "Aparelhos conectados" }).getByRole("listitem")).toHaveCount(2);

  await page.reload();
  await expect(devices).toHaveCount(2);
  await expect(panel.getByText("Este aparelho")).toHaveCount(1);
  await expect(panel.getByText(/Entrou em \d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();
  const entries = panel.getByRole("list", { name: "Entradas recentes" }).getByRole("listitem");
  await expect(entries).toHaveCount(1);
  await noHorizontalOverflow(page);

  // Disconnecting the other one signs it out on its very next request; this one stays.
  await panel.getByRole("button", { name: /^Desconectar / }).click();
  await expect(panel.getByText("Aparelho desconectado.")).toBeVisible();
  await expect(devices).toHaveCount(1);
  await expect(panel.getByText("Este aparelho")).toBeVisible();
  await other.page.goto("./profissional");
  await expect(other.page).toHaveURL(/\/entrar/);
  await other.context.close();

  // A new sign-in adds a line, and the list keeps the newest first.
  await signOut(page);
  await signIn(page, address);
  await page.goto("./profissional/conta");
  await expect(entries).toHaveCount(2);
  await expect(devices).toHaveCount(1);
});
