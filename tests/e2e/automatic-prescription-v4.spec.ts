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
  await ul.check(); // the page was reloaded: the suggestions are restored from the server, the choice starts again at the recommendation
  const use = page.getByRole("button", { name: phone ? "Conferir divisão por fase" : "Usar superior / inferior" });
  await expect(page.locator(".fig-gen-bar:visible").getByText(phone ? "Nenhuma divisão será aplicada sem aceite." : "Escolha uma opção ou personalize. A divisão escolhida é uma decisão do profissional.").first()).toBeVisible();
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
  else await cardA.getByRole("button", { name: "Editar foco do treino A" }).click();
  await noHorizontalOverflow(page);
  await expect(page.locator(".fig-gen-bar:visible").getByText(("O padrão por regras é editável. A geração só começa depois de aceitar esta organização.")).first()).toBeVisible();
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
  await expect(page.locator(".fig-gen-bar:visible").getByText("Aceitar estratégia → gerar proposta → revisar → aplicar ao rascunho.")).toBeVisible();
  // The policy and progression are optional, closed, and the dose profiles opt-in is unchecked.
  const optional = page.locator("details", { has: page.locator("summary", { hasText: "Políticas e progressão (opcional)" }) });
  await expect(optional).not.toHaveAttribute("open", "");
  // A refresh restores the accepted strategy from the server.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Revisar e gerar", level: 1 }).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Semana-tipo, fase 1" }).getByRole("listitem")).toHaveCount(4);
  await noHorizontalOverflow(page);
  // The sticky footer never covers the end of the page (phone): at the bottom, the last block clears it.
  if (phone) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bar = await page.locator(".fig-gen-bar.fig-gen-m").boundingBox();
    const lastBlock = await page.locator(".fig-gen-body > *").last().boundingBox();
    expect(bar).not.toBeNull();
    expect(lastBlock!.y + lastBlock!.height).toBeLessThanOrEqual(bar!.y + 1);
  }
  await page.getByRole("button", { name: "Gerar proposta" }).click();

  // ---- the proposal: the accepted split is in the exercises ----
  await expect(page.getByRole("region", { name: "Resumo da proposta" })).toBeVisible({ timeout: 90_000 });
  const exercises = async (name: RegExp, slot: number) => {
    await page.getByRole("navigation", { name: "Sessões da semana 1" }).getByRole("button").nth(slot - 1).click();
    const rows = page.getByRole("region", { name }).locator("tbody tr .rx-name");
    await expect(rows.first()).toBeVisible();
    return (await rows.allInnerTexts()).map((t) => t.trim());
  };
  const a = await exercises(/^Semana 1, sessão 1, treino A$/, 1);
  const b = await exercises(/^Semana 1, sessão 2, treino B$/, 2);
  expect(a.length).toBeGreaterThanOrEqual(3);
  expect(b.length).toBeGreaterThanOrEqual(3);
  expect(a.filter((n) => b.includes(n)), `A ${a.join(" | ")} / B ${b.join(" | ")}`).toEqual([]);

  // ---- 4.2: RX-01 / M-02, the review by focus and dose ----
  await expect(page.getByRole("heading", { name: phone ? "Revisar estratégia e treino" : "Revisar prescrição e justificativas", level: 1 })).toBeVisible();
  await expect(page.locator("[data-stage]")).toHaveText("Pronta para revisão");
  await page.getByRole("navigation", { name: "Sessões da semana 1" }).getByRole("button").nth(0).click();
  const sessionA = page.getByRole("region", { name: /^Semana 1, sessão 1, treino A$/ });
  await expect(sessionA).toContainText("Treino A · Superior");
  await expect(sessionA.locator("[data-focus-chip]")).toBeVisible();
  await expect(sessionA.locator(".rx-pattern").first()).toBeVisible(); // "Empurrar horizontal •" before the exercise name
  if (phone) {
    await expect(sessionA.locator('[data-phone-card="focus"]')).toBeVisible();
    await expect(sessionA.locator('[data-phone-card="doses"]')).toContainText("Doses a revisar");
  }
  await noHorizontalOverflow(page);
  await sessionA.getByRole("button", { name: /^Por quê\? 1\. / }).click();
  const panel = page.getByRole("complementary", { name: /^Exercício selecionado:/ });
  await expect(panel.getByRole("heading", { name: "Por que foi selecionado?" })).toBeVisible();
  for (const [id, title] of [["focus", "Foco dominante"], ["dose", "Parâmetros da dose"], ["audit", "Auditoria semanal"]] as const)
    await expect(panel.locator(`[data-why="${id}"]`)).toContainText(title);
  await expect(panel.locator('[data-why="focus"]')).toContainText("Treino A: superior");
  await expect(panel.locator('[data-why="audit"]')).toContainText("Calendário: o treino A acontece");
  await expect(panel.locator('[data-why="audit"]')).toContainText("Volume da semana 1");
  await expect(panel.locator("[data-provenance]").first()).toContainText("Padrão por regras (editável)");
  expect(await panel.locator("[data-provenance]").count()).toBeGreaterThanOrEqual(2);
  // The professional keeps the first exercise: the replan below must not take it away.
  const keep = panel.getByRole("button", { name: /^Manter / });
  const keptName = (await panel.getByRole("heading", { level: 3 }).innerText()).trim();
  await keep.click();
  await expect(panel.getByRole("button", { name: `Destravar ${keptName}` })).toBeVisible({ timeout: 30_000 });

  // The audit tab opens with the "Estratégia" section (on the phone the exercise is a screen of its own: back to the sessions first).
  if (phone) await panel.getByRole("button", { name: "Sessões" }).click();
  await page.getByRole("tab", { name: /Auditoria/ }).click();
  await expect(page.getByRole("heading", { name: "Estratégia · Fase 1" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Aderência do treino A ao foco, rolável para o lado" })).toBeVisible();
  await expect(page.getByText("Diagnóstico, não objetivo")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Voltar às sessões" }).click(); // the audit tab's footer takes back to the sessions (tab bar hidden on the phone)

  // The fixed footer: its guide and ONE primary; it never covers the end of the page.
  const bar = page.locator(".rx-bar");
  await expect(bar.getByText(phone ? "Não aplica, não aprova e não entrega sozinho." : "Proposta editável; não aprova nem altera treinos entregues.")).toBeVisible();
  await expect(bar.getByRole("button", { name: /^Aplicar \d+ sessões? ao rascunho$/ })).toBeVisible();
  await expect(bar.locator(".rx-btn-primary")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Salvar revisão/ })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const barBox = await bar.boundingBox();
  const content = await page.locator(".rx-tabpanel:not([hidden])").boundingBox();
  expect(barBox).not.toBeNull();
  expect(content!.y + content!.height).toBeLessThanOrEqual(barBox!.y + 1);
  if (phone) for (const b of await bar.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // ---- "Rever estratégia": the confirmation lists what is kept and what is replaced, Cancel changes nothing ----
  const openReview = async () => {
    if (phone) {
      await page.getByRole("button", { name: "Mais ações" }).click();
      await page.getByRole("button", { name: /Rever estratégia/ }).click();
    } else await bar.getByRole("button", { name: "Rever estratégia" }).click();
  };
  await openReview();
  const dialog = page.getByRole("dialog", { name: "Rever a estratégia" });
  await expect(dialog.locator("[data-replan-confirm]")).toContainText("Refazer a fase 1 substitui", { timeout: 30_000 });
  await expect(dialog.locator("[data-replan-confirm]")).toContainText(/Serão mantidos: [1-9]\d* travad(o|os), 0 trocados por você, 0 que já estavam no rascunho\./); // locking counts every session of the phase
  await dialog.getByRole("radio", { name: "Todas as fases geradas" }).check();
  await expect(dialog.locator("[data-replan-confirm]")).toContainText("Refazer todas as fases geradas substitui");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await openReview();
  await dialog.getByRole("radio", { name: "Todas as fases geradas" }).check();
  await expect(dialog.locator("[data-replan-confirm]")).toContainText(/Serão mantidos: [1-9]\d* travad/);
  await dialog.getByRole("button", { name: "Refazer" }).click();

  // The strategy step over the open proposal; nothing changes until the last button.
  await expect(page).toHaveURL(/rever=FULL/);
  await expect(page.getByRole("heading", { name: phone ? "Escolher estratégia" : "Escolher estratégia de treino", level: 1 }).first()).toBeVisible();
  await expect(page.locator("[data-replan-notice]")).toContainText("Nada muda na proposta até confirmar");
  await page.getByRole("button", { name: phone ? "Conferir divisão por fase" : "Usar superior / inferior" }).click();
  await page.getByRole("button", { name: "Conferir blueprint" }).click();
  await expect(page.getByRole("heading", { name: "Revisar e gerar", level: 1 }).first()).toBeVisible();
  // Moving between steps keeps the "rever" address: a reload or a refresh must not turn the flow into the proposal page.
  await expect(page).toHaveURL(/rever=FULL.*etapa=previa/);
  await expect(page.locator("summary", { hasText: "Políticas e progressão (opcional)" })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Refazer com a estratégia" }).click();

  // Back on the proposal: the locked exercise is still there, locked, and A and B still differ.
  await expect(page.getByRole("region", { name: "Resumo da proposta" })).toBeVisible({ timeout: 90_000 });
  await expect(page).not.toHaveURL(/rever=/);
  await page.getByRole("navigation", { name: "Sessões da semana 1" }).getByRole("button").nth(0).click();
  const after = page.getByRole("region", { name: /^Semana 1, sessão 1, treino A$/ });
  await expect(after.locator("tbody tr .rx-name").filter({ hasText: keptName }).first()).toBeVisible();
  await after.getByRole("button", { name: new RegExp(`^Por quê\\? \\d+\\. .*${keptName}$`) }).first().click();
  const panelAfter = page.getByRole("complementary", { name: /^Exercício selecionado:/ });
  await expect(panelAfter.getByRole("button", { name: `Destravar ${keptName}` })).toBeVisible();
  if (phone) await panelAfter.getByRole("button", { name: "Sessões" }).click();
  const a2 = await exercises(/^Semana 1, sessão 1, treino A$/, 1);
  const b2 = await exercises(/^Semana 1, sessão 2, treino B$/, 2);
  expect(a2.filter((n) => b2.includes(n)), `A ${a2.join(" | ")} / B ${b2.join(" | ")}`).toEqual([]);
});
