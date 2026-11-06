import { test, expect } from "@playwright/test";
import { localIP, noHorizontalOverflow } from "./helpers";
import { xintusPlan } from "./v4-flow";
import { backToSessions, draftUntouched, generateByRules, openAdjust, panel, pickItem, sessionNames, targetsAre44, versionOf } from "./adjust-flow";

// Motor V4, PR 4.3: assisted adjustments (Figma RX-02, M-02) on whichever mount the run uses, WITHOUT AI configured for the organization: the AI
// button is closed with the reason, the engine's alternatives carry the same impact preview, one point is applied as a new version of the proposal
// (nothing else changes, nothing is approved, delivered or applied to the draft), a violated constraint disables the apply and a discard keeps
// everything. The AI path (the simulated provider) is the last scenario of the gestor spec.
test("without AI: engine alternatives with impact, apply one point, discard, violated constraint", async ({ page }) => {
  test.setTimeout(480_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await xintusPlan(page, "Estúdio de ajustes", "Aluno Ajustes");
  await generateByRules(page);
  const v1 = await versionOf(page);
  expect(v1).toBe(1);
  const a1 = await sessionNames(page, 1, "A");
  const b1 = await sessionNames(page, 2, "B");

  await openAdjust(page);
  const root = panel(page);
  await expect(page.getByRole("heading", { name: /Ajustar/, level: 1 }).first()).toBeVisible();
  // the AI is not configured here: the button is closed and says why; the engine's list is the way
  const ai = root.getByRole("button", { name: "Sugerir alternativa com IA" });
  await expect(ai).toBeDisabled();
  await expect(root.getByText(/^Sugestão por IA exige a IA habilitada \(.+\)\. Use as alternativas do motor\.$/)).toBeVisible();
  await expect(ai).toHaveAttribute("aria-describedby", /.+/);
  await expect(root.getByRole("button", { name: "Aplicar ajuste à proposta" })).toBeDisabled();
  await expect(page.getByText("Peça uma sugestão para ver o efeito antes de aplicar.")).toBeVisible();
  await targetsAre44(page, root);

  // the thread says what is selected; the builder offers the contract's controls only
  await expect(root.getByLabel("O que ajustar").locator("option")).toHaveText(["Trocar exercício", "Séries", "Repetições", "RIR", "Pausa"]);
  await root.getByLabel("Mesmo padrão de movimento").check();
  await root.getByLabel("Sem aumentar a duração").check();
  await root.getByRole("button", { name: "Ver alternativas do motor" }).click();
  const list = root.getByRole("list", { name: "Alternativas do motor" });
  await expect(list.getByRole("listitem").first()).toBeVisible();
  await expect(list.getByText("Mesmo padrão de movimento · OK").first()).toBeVisible();
  const first = list.getByRole("listitem").first();
  const replacement = (await first.locator("strong").first().innerText()).trim();
  await first.getByRole("button", { name: /^Ver o efeito de trocar por/ }).click();

  // the before/after: the suggestion, the calculated impact, the constraints as the professional ticked them
  await expect(root.getByRole("article", { name: "Alternativa" })).toContainText(`por ${replacement}`);
  await expect(root.getByRole("article", { name: "Alternativa" })).toContainText("Nenhuma alteração aplicada");
  const impact = root.getByRole("article", { name: "Impacto calculado" });
  await expect(impact).toContainText(/linhas? muda/);
  await expect(impact.getByRole("list", { name: "Linhas que mudam" })).toContainText(replacement);
  await expect(impact.getByRole("list", { name: "Restrições escolhidas" })).toContainText("Mesmo padrão de movimento");
  await expect(impact.getByRole("list", { name: "Restrições escolhidas" }).getByText("OK").first()).toBeVisible();
  await expect(root.getByRole("listitem").filter({ hasText: "Alternativa escolhida" })).toBeVisible();
  // nothing moved yet
  expect(await versionOf(page).catch(() => v1)).toBe(v1);
  const apply = page.getByRole("button", { name: "Aplicar ajuste à proposta" });
  await expect(apply).toBeEnabled();
  await noHorizontalOverflow(page);

  // apply: version 2, only that exercise changed, the rest of the proposal is as it was
  await apply.click();
  await expect(page.getByText("Ajuste aplicado: versão 2 da proposta.")).toBeVisible({ timeout: 30_000 });
  await expect(apply).toBeDisabled();
  await backToSessions(page);
  expect(await versionOf(page)).toBe(2);
  const a2 = await sessionNames(page, 1, "A");
  const b2 = await sessionNames(page, 2, "B");
  const changed = [...a1.map((n, i) => [n, a2[i]]), ...b1.map((n, i) => [n, b2[i]])].filter(([x, y]) => x !== y);
  expect(changed.length).toBe(1);
  expect(changed[0][1]).toBe(replacement);
  // nothing was applied to the draft, approved or delivered by this
  await expect(draftUntouched(page)).toBeVisible();

  // discard keeps everything: pick another item and another alternative, then discard
  await openAdjust(page);
  await pickItem(page, /^2\./);
  await panel(page).getByRole("button", { name: "Ver alternativas do motor" }).click();
  await panel(page).getByRole("list", { name: "Alternativas do motor" }).getByRole("button", { name: /^Ver o efeito de trocar por/ }).first().click();
  await expect(panel(page).getByRole("article", { name: "Impacto calculado" })).toContainText(/linhas? muda/);
  await page.getByRole("button", { name: "Descartar sugestão" }).click();
  await expect(page.getByText("Sugestão descartada. A proposta continua como estava.")).toBeVisible();
  await expect(panel(page).getByRole("article", { name: "Impacto calculado" })).toContainText("Auditoria recalculada antes do aceite");
  await backToSessions(page);
  expect(await versionOf(page)).toBe(2);

  // dose: sets +N with "sem aumentar o volume semanal" is VIOLATED with the numbers and cannot be applied
  await openAdjust(page);
  await panel(page).getByLabel("O que ajustar").selectOption("CHANGE_SETS");
  await panel(page).getByLabel("Séries").fill("8");
  await panel(page).getByLabel(/^Sem aumentar o volume semanal de /).check();
  await panel(page).getByRole("button", { name: "Ver impacto" }).click();
  const constraints = panel(page).getByRole("list", { name: "Restrições escolhidas" });
  await expect(constraints.getByText("VIOLADA")).toBeVisible();
  await expect(constraints).toContainText(/Violaria: .+ \+\d+(,\d+)? séries ponderadas na semana \d+/);
  await expect(page.getByRole("button", { name: "Aplicar ajuste à proposta" })).toBeDisabled();
  await expect(page.getByText(/^Violaria: /).first()).toBeVisible();
  await noHorizontalOverflow(page);

  // without the constraint the same change applies as a new version
  await panel(page).getByLabel(/^Sem aumentar o volume semanal de /).uncheck();
  await panel(page).getByLabel("Séries").fill("5");
  await panel(page).getByRole("button", { name: "Ver impacto" }).click();
  await expect(panel(page).getByRole("article", { name: "Impacto calculado" })).toContainText(/linhas? muda/);
  await page.getByRole("button", { name: "Aplicar ajuste à proposta" }).click();
  await expect(page.getByText("Ajuste aplicado: versão 3 da proposta.")).toBeVisible({ timeout: 30_000 });
  await backToSessions(page);
  expect(await versionOf(page)).toBe(3);
  await expect(draftUntouched(page)).toBeVisible();
});
