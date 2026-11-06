import { test, expect } from "@playwright/test";
import { localIP, noHorizontalOverflow } from "./helpers";
import { answerRequired, isPhone, xintusPlan } from "./v4-flow";

// Motor V4, PR 4.1: the generation FLOW (Figma GEN-01..04 and M-01) on whichever mount the run uses, rules path (no AI call). Context and mode,
// compare the strategies, the focus per phase, the week-type preview, and the generation by the ACCEPTED split: A and B differ.
// The AI path (the mock provider through a platform manager) is the scenario in ai-gestor-flow.ts, inside the gestor spec.
test("strategies, focus per phase and preview: the accepted upper/lower split shows in the proposal", async ({ page }) => {
  test.setTimeout(360_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const phone = isPhone(page);
  await xintusPlan(page, "Estúdio do fluxo V4", "Aluno Xintus");
  await page.getByRole("link", { name: "Gerar prescrição automática" }).click();

  // ---- GEN-01: context cards and the mode ----
  await expect(page.getByRole("heading", { name: phone ? "Montar prescrição" : "Montar prescrição", level: 1 }).first()).toBeVisible();
  const flowURL = page.url();
  for (const title of ["Objetivo e rotina", "Avaliação física", "Periodização existente", "Histórico e limitações"])
    await expect(page.getByRole("group", { name: title })).toBeVisible();
  await expect(page.getByRole("group", { name: "Periodização existente" })).toContainText("12 semanas · 3 fases de 4 semanas");
  await expect(page.getByRole("group", { name: "Periodização existente" })).toContainText("Estrutura A / B · alternância ABAB");
  await expect(page.getByRole("group", { name: "Histórico e limitações" })).toContainText("Sem dado de execução, não inferir cargas");
  const modes = page.getByRole("radiogroup", { name: "Modo de montagem" });
  // The AI is not configured for this organization: the card says why and the rules card is the selection (honest states, never hidden).
  const ai = modes.getByRole("radio", { name: /Assistida por IA/ });
  await expect(ai).toBeDisabled();
  await expect(modes.getByText(/^IA (não configurada|não habilitada para a sua organização|não incluída no plano)\.$/)).toBeVisible();
  await expect(modes.getByRole("radio", { name: /Por regras/ })).toBeChecked();
  const next = page.getByRole("button", { name: "Continuar para estratégia" });
  await expect(next).toBeDisabled();
  const stepper = page.getByRole("list", { name: "Etapas da montagem" });
  await expect(stepper.getByRole("listitem")).toHaveCount(3);
  await expect(stepper.locator('[aria-current="step"]')).toContainText("Contexto");
  await expect(stepper.getByRole("listitem").nth(2)).toContainText(phone ? "Revisão" : "Revisar e gerar");
  if (phone) await noHorizontalOverflow(page);
  await answerRequired(page);
  await expect(next).toBeEnabled();
  await next.click();

  // ---- GEN-02 / M-01: the strategies, nothing accepted by choosing ----
  await expect(page.getByRole("heading", { name: phone ? "Escolher estratégia" : "Escolher estratégia de treino", level: 1 }).first()).toBeVisible();
  await expect(stepper.locator('[aria-current="step"]')).toContainText("Estratégia");
  const list = page.getByRole("radiogroup", { name: "Estratégias sugeridas" });
  const ul = list.getByRole("radio", { name: /Superior \/ Inferior/ });
  await expect(list.getByText("Recomendada")).toBeVisible();
  await expect(list.getByRole("radio", { checked: true })).toHaveCount(1); // the recommended one is pre-selected, as drawn
  await ul.check();
  await expect(list.getByText("Padrão por regras").first()).toBeVisible();
  await expect(list.getByRole("radio", { name: /Corpo inteiro/ })).not.toBeChecked();
  const ppl = list.getByRole("radio", { name: /Empurrar \/ Puxar \/ Pernas/ });
  await expect(ppl).toBeDisabled();
  await expect(list.getByText("Exige alterar a periodização").first()).toBeVisible();
  await expect(list.getByRole("link", { name: "Alterar periodização" })).toHaveAttribute("href", /aba=periodizacao/);
  await expect(list.getByRole("radio", { name: /Personalizar/ })).toBeVisible();
  await expect(list.getByRole("radio", { name: /Sem divisão \(geração atual\)/ })).toBeVisible();
  if (!phone) await expect(page.getByRole("heading", { name: "Por que esta sugestão?" })).toBeVisible();
  // Choosing accepted nothing: the address alone, reached without the footer click, cannot show the preview.
  await page.goto(`${flowURL.split("?")[0]}?etapa=previa`);
  await expect(page.getByRole("heading", { name: phone ? "Escolher estratégia" : "Escolher estratégia de treino", level: 1 }).first()).toBeVisible();
  await expect(ul).toBeChecked();
  const use = page.getByRole("button", { name: phone ? "Conferir divisão por fase" : "Usar superior / inferior" });
  await expect(page.getByText(phone ? "Nenhuma divisão será aplicada sem aceite." : "Escolha uma opção ou personalize. A divisão escolhida é uma decisão do profissional.").first()).toBeVisible();
  await use.click();

  // ---- GEN-03: the focus per phase; edit one workout ----
  await expect(page.getByRole("heading", { name: phone ? "Definir focos" : "Definir focos por fase", level: 1 }).first()).toBeVisible();
  await expect(stepper.locator('[aria-current="step"]')).toContainText("Estratégia"); // the third pill is not lit on GEN-03
  const phases = page.getByRole("radiogroup", { name: "Fases" });
  await expect(phases.getByRole("radio", { name: /Fase 1 · Semanas 1–4/ })).toBeChecked();
  await expect(page.getByText("Qualquer alteração estrutural precisa de aceite")).toBeVisible();
  const cardA = page.getByRole("group", { name: "Treino A · Superiores" });
  const cardB = page.getByRole("group", { name: "Treino B · Inferiores" });
  await expect(cardA).toBeVisible();
  await expect(cardB).toBeVisible();
  await expect(cardA).toContainText("Padrão por regras");
  await cardA.getByRole("button", { name: "Editar foco do treino A" }).click();
  const editor = cardA.getByRole("group", { name: "Editar foco do treino A" });
  const calves = editor.getByRole("group", { name: "Músculos dominantes" }).getByLabel("Panturrilhas");
  await expect(calves).not.toBeChecked();
  await calves.check();
  await expect(cardA).toContainText("Decisão do profissional");
  await expect(cardA).toContainText("alterado: músculos dominantes");
  await expect(cardB).toContainText("Padrão por regras");
  if (phone) {
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    await cardA.getByRole("button", { name: "Editar foco do treino A" }).click();
  }
  await editor.getByRole("button", { name: "Restaurar sugestão" }).click();
  await expect(calves).not.toBeChecked();
  await expect(cardA).toContainText("Padrão por regras");
  if (phone) await page.keyboard.press("Escape");
  else await cardA.getByRole("button", { name: "Fechar edição" }).click();
  await noHorizontalOverflow(page);
  await expect(page.getByText(phone ? "Nenhuma divisão será aplicada sem aceite." : "O padrão por regras é editável. A geração só começa depois de aceitar esta organização.").first()).toBeVisible();
  await page.getByRole("button", { name: "Conferir blueprint" }).click();

  // ---- GEN-04: the preview, before generating ----
  await expect(page.getByRole("heading", { name: phone ? "Revisar e gerar" : "Revisar e gerar", level: 1 }).first()).toBeVisible();
  await expect(stepper.locator('[aria-current="step"]')).toContainText(phone ? "Revisão" : "Revisar e gerar");
  const week = page.getByRole("list", { name: "Semana-tipo, fase 1" });
  await expect(week.getByRole("listitem")).toHaveCount(4);
  await expect(week.getByRole("listitem").nth(0)).toContainText("Treino A · Superiores");
  await expect(week.getByRole("listitem").nth(0)).toContainText("Foco principal: superiores");
  await expect(week.getByRole("listitem").nth(1)).toContainText("Treino B · Inferiores");
  await expect(week.getByRole("listitem").nth(2)).toContainText("Repetição do foco A com progressão planejada");
  await expect(page.getByText("O blueprint não modifica sozinho o plano salvo.")).toBeVisible();
  await expect(page.getByText("Observação, não diagnóstico").or(page.getByText("Sem dado, nada é inferido"))).toBeVisible();
  await expect(page.getByText("O motor audita após gerar")).toBeVisible();
  await expect(page.getByText("Aceitar estratégia → gerar proposta → revisar → aplicar ao rascunho.").first()).toBeVisible();
  // The policy and progression are optional, closed, and the dose profiles opt-in is unchecked.
  const optional = page.locator("details", { has: page.locator("summary", { hasText: "Políticas e progressão (opcional)" }) });
  await expect(optional).not.toHaveAttribute("open", "");
  // A refresh restores the accepted strategy from the server.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Revisar e gerar", level: 1 }).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Semana-tipo, fase 1" }).getByRole("listitem")).toHaveCount(4);
  await noHorizontalOverflow(page);
  // The footer's button never sits over the last card (phone).
  if (phone) {
    const bar = await page.locator(".fig-gen-bar.fig-gen-m").boundingBox();
    const last = await page.getByRole("list", { name: "Semana-tipo, fase 1" }).getByRole("listitem").last().boundingBox();
    expect(bar).not.toBeNull();
    await page.getByRole("list", { name: "Semana-tipo, fase 1" }).getByRole("listitem").last().scrollIntoViewIfNeeded();
    const after = await page.getByRole("list", { name: "Semana-tipo, fase 1" }).getByRole("listitem").last().boundingBox();
    expect(last).not.toBeNull();
    expect(after!.y + after!.height).toBeLessThanOrEqual(bar!.y + 1);
  }
  await page.getByRole("button", { name: "Gerar proposta" }).click();

  // ---- the proposal: the accepted split is in the exercises ----
  await expect(page.getByRole("region", { name: "Resumo da proposta" })).toBeVisible({ timeout: 90_000 });
  const exercises = async (name: RegExp) => {
    const rows = page.getByRole("region", { name }).locator("tbody tr .rx-name");
    await expect(rows.first()).toBeVisible();
    return (await rows.allInnerTexts()).map((t) => t.trim());
  };
  const a = await exercises(/^Semana 1, sessão 1, treino A$/);
  const b = await exercises(/^Semana 1, sessão 2, treino B$/);
  expect(a.length).toBeGreaterThanOrEqual(3);
  expect(b.length).toBeGreaterThanOrEqual(3);
  expect(a.filter((n) => b.includes(n)), `A ${a.join(" | ")} / B ${b.join(" | ")}`).toEqual([]);
});
