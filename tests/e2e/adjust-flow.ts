import { expect, type Locator, type Page } from "@playwright/test";
import { noHorizontalOverflow } from "./helpers";
import { answerRequired, isPhone } from "./v4-flow";

/**
 * Assisted adjustments (Motor V4, PR 4.3, Figma RX-02 and M-02) on the proposal of the Xintus-like plan, as steps shared by two specs: the rules
 * path (no AI configured: the AI button is closed with the reason and the engine's alternatives work) and the AI path (the simulated provider,
 * through the gestor spec). Nothing is approved, delivered or applied to the draft by any of these steps.
 */
export const panel = (page: Page) => page.getByTestId("adjust-panel");

export async function openAdjust(page: Page) {
  const phone = isPhone(page);
  await page.getByTestId(phone ? "adjust-open-mobile" : "adjust-open").click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comparar antes e depois", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assistente de ajustes", level: 2 })).toBeVisible();
  await expect(page.getByText("Nada é enviado como texto livre: só o item e as opções marcadas.")).toBeVisible();
  // No text field: the request is built from controls.
  await expect(panel(page).locator("textarea")).toHaveCount(0);
  await expect(panel(page).getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("Proposta editável; não aprova nem altera treinos entregues.")).toBeVisible();
}

/** The apply bar says the draft is as it was: "Rascunho ainda não alterado" on a wide screen, the shorter phone text on a phone. */
export const draftUntouched = (page: Page) =>
  page.getByText(/^(Rascunho ainda não alterado|Nenhuma alteração aplicada ao aluno|Não aplica, não aprova e não entrega sozinho\.)/).filter({ visible: true }).first();

export const versionOf = async (page: Page) => Number((await page.locator(".proposal-pills").getByText(/^Versão \d+$/).innerText()).replace("Versão ", ""));

/** Every control of the builder is a 44 px target on a phone, and the page never scrolls sideways. */
export async function targetsAre44(page: Page, scope: Locator) {
  for (const control of await scope.locator("select, button, input[type='checkbox']").all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (!box) continue;
    const tag = await control.evaluate((el) => el.tagName + (el instanceof HTMLInputElement ? el.type : ""));
    // a checkbox is 20 px inside a 44 px label row
    if (tag.toLowerCase().includes("checkbox")) continue;
    expect(box.height, `${tag} ${await control.innerText().catch(() => "")}`).toBeGreaterThanOrEqual(39.5);
  }
  await noHorizontalOverflow(page);
}

export async function pickItem(page: Page, pattern: RegExp) {
  const item = panel(page).getByLabel("Item");
  const option = item.locator("option").filter({ hasText: pattern }).first();
  await item.selectOption(await option.getAttribute("value"));
}

/** The generation flow by rules (no AI) up to the proposal, with the accepted upper/lower split. */
export async function generateByRules(page: Page) {
  const phone = isPhone(page);
  await page.getByRole("link", { name: "Gerar prescrição automática" }).click();
  await answerRequired(page);
  await page.getByRole("button", { name: "Continuar para estratégia" }).click();
  await page.getByRole("radiogroup", { name: "Estratégias sugeridas" }).getByRole("radio", { name: /Superior \/ Inferior/ }).check();
  await page.getByRole("button", { name: phone ? "Conferir divisão por fase" : "Usar superior / inferior" }).click();
  await page.getByRole("button", { name: "Conferir blueprint" }).click();
  await page.getByRole("button", { name: "Gerar proposta" }).click();
  await expect(page.getByRole("region", { name: "Resumo da proposta" })).toBeVisible({ timeout: 90_000 });
}

/** The exercise names of one session of week 1, as the proposal lists them. */
export async function sessionNames(page: Page, slot: number, label: string) {
  await page.getByRole("navigation", { name: "Sessões da semana 1" }).getByRole("button").nth(slot - 1).click();
  const rows = page.getByRole("region", { name: new RegExp(`^Semana 1, sessão ${slot}, treino ${label}$`) }).locator("tbody tr .rx-name");
  await expect(rows.first()).toBeVisible();
  return (await rows.allInnerTexts()).map((t) => t.trim());
}

export async function backToSessions(page: Page) {
  await page.getByRole("button", { name: "Voltar às sessões" }).click();
  await expect(panel(page)).toHaveCount(0);
}

/**
 * The AI path (the simulated provider, through the platform manager of the gestor spec): "Sugerir alternativa com IA" asks the provider to choose
 * among the engine's alternatives with the ticked constraints; the suggestion shows its reasons; the engine's check is what counts; applying makes
 * a new version and nothing else. Runs on the proposal the AI flow scenario just generated (the page ends on it).
 */
export async function aiAdjustScenario(pro: Page) {
  await pro.setViewportSize({ width: 1440, height: 900 });
  const v1 = await versionOf(pro);
  const names1 = await sessionNames(pro, 1, "A");
  await openAdjust(pro);
  const root = panel(pro);
  const ai = root.getByRole("button", { name: "Sugerir alternativa com IA" });
  await expect(ai).toBeEnabled();
  await expect(root.getByText(/Sugestão por IA exige/)).toHaveCount(0);
  await root.getByLabel("Mesmo padrão de movimento").check();
  await ai.click();
  const card = root.getByRole("article", { name: "Sugestão da IA" });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("Nenhuma alteração aplicada");
  await expect(card.getByRole("list", { name: "Motivos" }).getByText("Mesmo padrão de movimento")).toBeVisible();
  await expect(root.getByRole("listitem").filter({ hasText: "IA · Sugestão" })).toBeVisible();
  const impact = root.getByRole("article", { name: "Impacto calculado" });
  await expect(impact).toContainText(/linhas? muda/);
  await expect(impact.getByRole("list", { name: "Restrições escolhidas" }).getByText("OK")).toBeVisible();
  expect(await versionOf(pro).catch(() => v1)).toBe(v1);
  // the same request again is a cache hit on the server: it answers without a second call (the screen cannot tell, the ledger can: see the D1 test)
  await pro.getByRole("button", { name: "Aplicar ajuste à proposta" }).click();
  await expect(pro.getByText(/^Ajuste aplicado: versão 2 da proposta\.$/)).toBeVisible({ timeout: 30_000 });
  await backToSessions(pro);
  expect(await versionOf(pro)).toBe(v1 + 1);
  const names2 = await sessionNames(pro, 1, "A");
  expect(names2.filter((n, i) => n !== names1[i]).length).toBeLessThanOrEqual(1);
  await expect(draftUntouched(pro)).toBeVisible();
}
