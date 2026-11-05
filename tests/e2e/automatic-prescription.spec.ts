import { test, expect } from "@playwright/test";
import {
  addStudent,
  approveAndDeliver,
  confirmDelivery,
  createProfessional,
  joinStudent,
  localIP,
  newActor,
  noHorizontalOverflow,
  openDeliverDialog,
  openFullPrescription,
  readyPlan,
  showStudentTab,
  signIn,
  signOut,
} from "./helpers";

// Motor S9: the whole path in the real interface, on whichever mount the run uses (root, /treinador, platform mount).
// generate → review ("Por quê?", weeks) → substitute → regenerate one session → apply → edit one session → ready → approve →
// deliver → the student sees the weeks with their progression and logs week 2, session 1. A manual plan delivered before stays
// exactly as it was, and another organization cannot reach the proposal.
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("automatic prescription from the periodization to the student's log", async ({ page, browser, baseURL }) => {
  test.setTimeout(360_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const proEmail = await createProfessional(page, "Estúdio da prescrição automática");
  const studentURL = await addStudent(page, "Aluno da proposta");
  await page.goto(studentURL);
  const studentEmail = await joinStudent(page, browser, baseURL, "Aluno da proposta");

  // A manual plan (one dose per phase, as every plan before the engine), delivered first: it must stay as it is.
  const legacyURL = await readyPlan(page, studentURL, "Plano manual antigo");
  await approveAndDeliver(page);

  // The periodization: three phases of four weeks, Full Body three times a week, three exercises per workout.
  await page.goto(studentURL);
  await showStudentTab(page, "Periodização");
  await page.getByRole("link", { name: "Novo plano" }).click();
  await page.getByLabel("Nome do plano").fill("Plano automático");
  await page.getByLabel("Data de início").fill(yesterday());
  for (const phase of ["Fase 01", "Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar fase" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Divisão de treinos").selectOption("Full Body");
    await page.getByLabel("Alvo de exercícios por treino").selectOption("3");
  }
  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();
  await expect(page.getByRole("heading", { name: "Plano automático" })).toBeVisible();
  const revisionURL = page.url();

  // 1. The way in, on the draft after the structure is saved.
  // The professional path below is the desktop composition (GEN-01..03, RX-01..03); the phone composition (GEN-04..08, RX-04..11) has other labels and
  // its own screens. The phone run walks this path at a desktop width; the phone screens are checked by capture and the approval path by delivery.spec.
  const phoneSize = page.viewportSize();
  const onPhone = Boolean(phoneSize && phoneSize.width < 861);
  if (onPhone) await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Gerar prescrição automática" }).click();
  // Figma GEN-01..08: one header, the compact base, the three steps and the persistent footer.
  await expect(page.getByRole("heading", { name: /^Gerar prescrição/, level: 1 })).toBeVisible();
  const autoURL = page.url();
  await expect(page.getByRole("region", { name: "Base utilizada" })).toContainText("3 fases · 12 semanas");
  await expect(page.getByRole("heading", { name: "Dados do aluno" })).toBeVisible();
  // Nothing pre-selected: the footer says exactly what is missing and the way on waits for it.
  const next = page.getByRole("button", { name: "Continuar para doses" });
  await expect(next).toBeDisabled();
  await expect(page.getByText("4 respostas faltam: 3 estímulos e equipamentos")).toBeVisible();
  // The exact list of pending answers is on the third step, each one a link to its field (which keeps what was chosen).
  await page.getByRole("button", { name: /Progressão/ }).first().click();
  await expect(page.locator(".fig-gen-pill", { hasText: "4 RESPOSTAS PENDENTES" })).toBeVisible();
  await page.getByRole("button", { name: "Estímulo da fase 02" }).click();
  await expect(page.getByLabel("Estímulo principal da fase 2")).toBeFocused();
  await page.getByLabel("Estímulo principal da fase 1").selectOption("HYPERTROPHY");
  await page.getByLabel("Estímulo principal da fase 2").selectOption("STRENGTH");
  await expect(next).toBeDisabled();
  await page.getByLabel("Estímulo principal da fase 3").selectOption("HYPERTROPHY");
  await expect(page.getByText("1 resposta falta: equipamentos")).toBeVisible();
  // "Sem equipamento" is exclusive; the full list opens under "Ver lista completa".
  const equipment = page.getByRole("group", { name: "Equipamentos disponíveis" });
  await equipment.getByLabel("Sem equipamento").check();
  await equipment.getByLabel("Barra", { exact: true }).check();
  await expect(equipment.getByLabel("Sem equipamento")).not.toBeChecked();
  await equipment.getByRole("button", { name: "Ver lista completa de equipamentos" }).click();
  await equipment.getByRole("button", { name: "Marcar todos" }).click();
  await expect(next).toBeEnabled();
  // Second step: the catalogue of the engine's policies, one line each. Nothing has to be edited; editing is by the side panel and is checked.
  await next.click();
  await expect(page.getByRole("heading", { name: "Política de doses" })).toBeVisible();
  await expect(page.getByText("3 × 8–12 • RIR 1–3 • 90 s")).toBeVisible();
  await page.getByRole("tab", { name: "Cardiorrespiratório" }).click();
  await expect(page.getByRole("button", { name: "Editar Resistência aeróbia" })).toBeVisible();
  await page.getByRole("tab", { name: "Treino resistido" }).click();
  await page.getByRole("button", { name: "Editar Hipertrofia" }).click();
  const editor = page.getByLabel("Editar política: Hipertrofia");
  await expect(editor.getByText("Heurística operacional editável")).toBeVisible();
  await editor.getByLabel("Séries").fill("4");
  await expect(editor.getByText("Há ajustes não salvos nesta política.")).toBeVisible();
  await editor.getByLabel("Reps mín.").fill("15");
  await editor.getByRole("button", { name: "Salvar ajustes" }).click();
  await expect(editor.getByText("O mínimo não pode passar do máximo.")).toBeVisible();
  await editor.getByLabel("Reps mín.").fill("8");
  await editor.getByRole("button", { name: "Salvar ajustes" }).click();
  await expect(page.getByText("4 × 8–12 • RIR 1–3 • 90 s")).toBeVisible();
  await editor.getByRole("button", { name: "Restaurar padrão" }).click();
  await expect(page.getByText("3 × 8–12 • RIR 1–3 • 90 s")).toBeVisible();
  await page.getByRole("button", { name: "Continuar para progressão" }).click();
  // Third step: the progression of each phase, with the optional adjustments closed.
  const generate = page.getByRole("button", { name: "Gerar prescrição", exact: true });
  await expect(generate).toBeEnabled();
  const progression = page.getByRole("group", { name: /Progressão da Fase 01/ });
  await progression.getByLabel("Modelo").selectOption("LINEAR");
  await progression.getByLabel("Parâmetro").selectOption("sets");
  await progression.getByLabel("Na semana 1").fill("3");
  await progression.getByLabel("Na semana 4").fill("4");
  // Motor V3 S4: suggested targets per phase (inside the closed "Ajustes opcionais"), offered for acceptance (nothing pre-selected); phase 1 accepted here as is.
  await page.locator("summary").filter({ hasText: "Ajustes opcionais (avançado)" }).click();
  await page.locator("summary").filter({ hasText: "Alvos por fase (opcional)" }).click();
  const formCard = page.getByRole("group", { name: "Alvos sugeridos · Fase 1" });
  await expect(formCard.getByText("Heurística operacional (editável)").first()).toBeVisible();
  await expect(formCard.getByText(/≥ 2 de 3 sessões por semana que a estrutura oferece/)).toBeVisible();
  await formCard.getByRole("button", { name: "Aceitar estes alvos" }).click();
  const accepted = page.getByRole("group", { name: "Alvos da Fase 01" });
  await expect(accepted.getByText("Heurística aceita por você")).toBeVisible();
  await noHorizontalOverflow(page);
  // 2. Processing, then 3. the whole proposal.
  await generate.click();
  // 0.96 (Figma RX): the proposal is a workbench: status and counts on top, the tabs Sessões, Alertas, Premissas and Regras.
  await expect(page.getByRole("region", { name: "Resumo da proposta" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("tablist", { name: "Revisão da proposta" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sessões" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/^3 \/ 3\s+fases$/)).toBeVisible();
  const alertsTab = page.getByRole("tab", { name: /^Alertas \(\d+\)$/ });
  const sessionsTab = page.getByRole("tab", { name: "Sessões" });
  await expect(page.getByRole("tab", { name: /^Premissas \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Regras \(\d+\)$/ })).toBeVisible();

  // Motor V3: the plan audit, recorded with the proposal (rules 2026.11.3), read from the real sessions of each week.
  // The audit is part of the Alertas tab.
  await alertsTab.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("aba")).toBe("alertas");
  const audit = page.locator("section.audit-panel");
  await expect(page.getByRole("heading", { name: "Auditoria técnica do plano" })).toBeVisible();
  await expect(page.getByText(/· auditoria 1\.0\.0\. /)).toBeVisible();
  // Full Body three times a week: three real sessions in every full week.
  await expect(audit.locator(".kpi").filter({ hasText: "Sessões por semana (reais)" }).locator(".kpi-value")).toHaveText("3");
  await expect(audit.locator(".kpi").filter({ hasText: "Fases auditadas" }).locator(".kpi-value")).toHaveText("3 de 3");
  // Hypertrophy phases without structured targets: described, with a link to the phase that navigates (relative to the mount).
  const observations = audit.locator("details.audit-group").filter({ has: page.locator("summary", { hasText: /^Observações/ }) });
  if ((await observations.getAttribute("open")) === null) await observations.locator("summary").click();
  const noTargets = audit.locator(".audit-finding").filter({ hasText: "Fase sem alvos estruturados" });
  // Phase 1's targets were accepted on the form: only phase 3 (hypertrophy, no targets) is described as without them.
  await expect(noTargets).toHaveCount(1);
  await noTargets.getByRole("link", { name: "Ver a fase 3" }).click();
  await expect(page.getByRole("navigation", { name: "Fases da proposta" }).getByRole("link", { name: /^Fase 03/ })).toHaveAttribute("aria-current", "page");
  expect(new URL(page.url()).searchParams.get("fase")).toBe("3");
  // The link goes to the phase's sessions; the audit is one tab away.
  await alertsTab.click();
  await expect(page.getByRole("heading", { name: "Auditoria técnica do plano" })).toBeVisible();
  await audit.locator("summary").filter({ hasText: "Distribuição por músculo · Fase 3" }).click();
  await expect(audit.getByRole("region", { name: "Distribuição por músculo da fase 3, rolável para o lado" })).toBeVisible();
  await noHorizontalOverflow(page);
  // The phase's "sem alvos" warning points at the one card, in the audit; accepting regenerates the phase with the suggestion.
  // The warning is a record of the alerts table (filter "Fase 03"); its panel has the link to the card.
  await page.getByRole("group", { name: "Filtrar alertas" }).getByRole("button", { name: "Fase 03" }).click();
  const records = page.getByRole("button", { name: /^Revisar registro \d+:/ });
  const toTargets = page.getByRole("link", { name: "Ver alvos sugeridos" });
  for (let n = 0, total = await records.count(); n < total && !(await toTargets.isVisible()); n++) await records.nth(n).click();
  await toTargets.click();
  expect(new URL(page.url()).hash).toBe("#alvos-sugeridos-fase-3");
  const card = audit.getByRole("group", { name: "Alvos sugeridos · Fase 3" });
  await expect(card).toBeInViewport();
  await expect(card.getByText("Nada é aplicado sem o seu aceite.", { exact: false })).toBeVisible();
  await noHorizontalOverflow(page);
  const versionBefore = Number(/Versão (\d+)/.exec(await page.locator(".proposal-pills").innerText())![1]);
  await card.getByRole("button", { name: "Aceitar e regenerar a fase" }).click();
  await expect(page.getByText(`Versão ${versionBefore + 1}`, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(audit.locator(".audit-finding").filter({ hasText: "Fase sem alvos estruturados" })).toHaveCount(0);
  await sessionsTab.click();
  await page.getByRole("navigation", { name: "Fases da proposta" }).getByRole("link", { name: /^Fase 01/ }).click();
  await expect(page.getByRole("navigation", { name: "Fases da proposta" }).getByRole("link", { name: /^Fase 01/ })).toHaveAttribute("aria-current", "page");

  // 4–6. Navigation, doses, bases and "Por quê?".
  const weeks = page.getByRole("navigation", { name: "Semanas da fase 1" });
  await weeks.getByRole("link", { name: "Semana 2" }).click();
  await expect(weeks.getByRole("link", { name: "Semana 2" })).toHaveAttribute("aria-current", "page");
  // The week is kept in the address, without a new page.
  await expect.poll(() => new URL(page.url()).searchParams.get("semana")).toBe("2");
  const session = page.getByRole("region", { name: /^Semana 2, sessão 1, treino Full Body$/ });
  await expect(session.locator("tbody tr")).toHaveCount(3);
  // The panel of the selected exercise (the first one by default) holds the dose, the origin and "Por quê?".
  const panel = page.locator("aside.rx-exercise");
  await expect(panel.getByRole("button", { name: /^Manter / })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Substituir / })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Trocar .* por outro$/ })).toBeVisible();
  await panel.locator(".why-details summary").first().click();
  await expect(panel.locator(".why-details").first().getByText("Heurística operacional (editável)").first()).toBeVisible();
  // The item's part of the week's volume, with the week's total from the audit.
  const why = panel.locator(".why-details").first();
  for (const heading of ["Por que este exercício", "Contribuição na semana", /^Por que \d+ séries?$/, "Regras usadas", "O que mudaria esta escolha"])
    await expect(why.getByRole("heading", { name: heading })).toBeVisible();
  await expect(why.getByText(/^Total da semana 2 na fase \(3 sessões\)/)).toBeVisible();
  // The weekly table gains the sessions with direct stimulus.
  await page.locator("summary").filter({ hasText: "Volume semanal por músculo · Semana 2" }).click();
  await expect(page.getByRole("columnheader", { name: "Sessões c/ estímulo direto" })).toBeVisible();
  await expect(alertsTab).toBeVisible();
  await noHorizontalOverflow(page);

  // 8. Substitute the first exercise in the whole phase, with an alternative the tool offers.
  const firstName = (await panel.locator(".rx-panel-title").innerText()).trim();
  await panel.getByRole("button", { name: `Substituir ${firstName}` }).click();
  const dialog = page.getByRole("dialog", { name: "Substituir exercício" });
  // The tool's alternatives (reviewed or inferred), or, when none fits the equipment, any exercise of the library.
  const radios = dialog.locator('input[name="alternativa"]');
  await expect(radios.first().or(dialog.getByText("Nenhuma alternativa compatível", { exact: false }))).toBeVisible({ timeout: 30_000 });
  if (await radios.count()) await radios.first().check();
  else {
    await dialog.getByRole("searchbox", { name: "Buscar nome ou grupo muscular" }).fill("a");
    await dialog.locator('input[name="alternativa"]').first().check();
  }
  await dialog.getByLabel("Na fase inteira").check();
  await dialog.getByRole("button", { name: "Confirmar substituição" }).click();
  await expect(dialog).toBeHidden();
  await expect(session.getByText("Trocado por você").first()).toBeVisible({ timeout: 30_000 });

  // 9. Regenerate one session.
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("dialog", { name: "Mais ações" }).getByRole("button", { name: /^Regenerar esta sessão/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /Proposta atualizada|mudaram/ })).toBeVisible({ timeout: 30_000 });

  // 10. Apply to the draft: the existing flow continues on the revision page.
  await page.getByRole("button", { name: /^Aplicar \d+ sessões ao rascunho$/ }).click();
  const applyDialog = page.getByRole("dialog", { name: "Aplicar proposta ao rascunho" });
  await expect(applyDialog.getByText("A aprovação e a entrega para o aluno permanecem separadas", { exact: false })).toBeVisible();
  // The confirmation waits for the explicit acknowledgement that applying does not publish.
  const confirmApply = applyDialog.getByRole("button", { name: "Confirmar aplicação ao rascunho" });
  await expect(confirmApply).toBeDisabled();
  await applyDialog.getByLabel("Entendi que aplicar ao rascunho não publica os treinos").check();
  await confirmApply.click();
  await expect(page.getByText("Proposta aplicada ao rascunho.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Doses por sessão" })).toBeVisible();
  await expect(page.getByText("Proposta automática").first()).toBeVisible();

  // 7. Manual editing, one session only: week 2, session 1.
  await page.getByRole("navigation", { name: "Semanas da fase 1 (doses por sessão)" }).getByRole("link", { name: "Semana 2" }).click();
  const draftSession = page.locator("#doses-por-sessao").getByRole("region", { name: "Semana 2, sessão 1, treino Full Body" });
  await expect(draftSession).toBeVisible();
  await draftSession.getByRole("button", { name: /^Editar a dose de / }).first().click();
  await draftSession.getByLabel("Séries").fill("5");
  await draftSession.getByLabel("Repetições").fill("6");
  await draftSession.getByRole("button", { name: "Salvar dose" }).click();
  await expect(page.getByText("Dose salva (só nesta sessão).")).toBeVisible();
  await expect(draftSession.getByText("Editada por você").first()).toBeVisible();
  await expect(draftSession.getByText("5 séries × 6 repetições", { exact: false })).toBeVisible();
  // A notes-only save keeps the stored dose of the engine as it was (only the note is added).
  const otherLabel = (await draftSession.getByRole("button", { name: /^Editar a dose de / }).nth(1).getAttribute("aria-label"))!;
  const otherName = otherLabel.replace(/^Editar a dose de /, "").replace(/ na sessão \d+ da semana \d+$/, "");
  const other = draftSession
    .locator("ol.exercise-list > li")
    .filter({ has: page.locator(".exercise-main > strong").getByText(otherName, { exact: true }) })
    .first();
  const doseLine = other.locator(".exercise-main > span").first();
  const doseBefore = await doseLine.innerText();
  await other.getByRole("button", { name: /^Editar a dose de / }).click();
  await other.getByLabel("Observações").fill("Pegada neutra");
  await other.getByRole("button", { name: "Salvar dose" }).click();
  await expect(other.getByText("Obs.: Pegada neutra")).toBeVisible();
  await expect(doseLine).toHaveText(doseBefore);
  await noHorizontalOverflow(page);

  // 11. Ready and approval by the professional; 12. delivery by the existing flow.
  // One strip, one confirmation (0.96): the draft is closed, approved and delivered together.
  const deliverDialog = await openDeliverDialog(page);
  // The edit made in week 2, session 1 only is counted (never "0 editados").
  await expect(deliverDialog.getByText(/exercícios? propostos? automaticamente \([1-9]\d* editados? por você\)/)).toBeVisible();
  await confirmDelivery(page, deliverDialog, true);
  // The history of the proposal stays, read-only.
  await page.goto(autoURL);
  await expect(page.getByRole("heading", { name: "Histórico das propostas" })).toBeVisible();
  await expect(page.getByText("Aplicada ao rascunho", { exact: false }).first()).toBeVisible();

  // The legacy plan is unchanged for the professional: no sessions, no proposal.
  await page.goto(legacyURL);
  await openFullPrescription(page);
  await expect(page.getByRole("region", { name: "Treino Full Body" }).getByText("Agachamento da triagem")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Doses por sessão" })).toHaveCount(0);

  // Another organization cannot reach the proposal (nor the revision).
  const stranger = await newActor(browser, baseURL);
  await createProfessional(stranger.page, "Outro estúdio");
  for (const url of [autoURL, revisionURL]) {
    const refused = await stranger.page.request.get(url);
    expect(refused.status(), url).toBe(404);
  }
  await stranger.context.close();
  await signOut(page);

  // The student: both plans; the automatic one week by week, with its progression, and logs week 2, session 1.
  const me = (await newActor(browser, baseURL)).page;
  await signIn(me, studentEmail);
  await me.goto("./aluno/treino");
  await expect(me.getByRole("heading", { name: "Plano manual antigo" })).toBeVisible();
  await expect(me.getByRole("region", { name: "Treino Full Body, fase 1" }).getByText("Agachamento da triagem")).toBeVisible();
  const auto = me.locator("section.panel").filter({ has: me.getByRole("heading", { name: "Plano automático" }) });
  const studentWeeks = auto.getByRole("navigation", { name: "Semanas da fase 1" });
  await expect(studentWeeks.getByRole("link", { name: "Semana 4" })).toBeVisible();
  await auto.locator(".progression-details summary").first().click();
  const rows = await auto.locator(".progression-details table tbody tr").evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())),
  );
  // Weekly progression as generated: three sets in week 1, four in week 4.
  expect(rows.some((cells) => cells[0]?.startsWith("3 ×") && cells[3]?.startsWith("4 ×"))).toBe(true);
  await studentWeeks.getByRole("link", { name: "Semana 2" }).click();
  await expect(studentWeeks.getByRole("link", { name: "Semana 2" })).toHaveAttribute("aria-current", "page");
  const mine = auto.getByRole("region", { name: "Semana 2, sessão 1, treino Full Body, fase 1" });
  await expect(mine.getByText("5 séries × 6 repetições", { exact: false })).toBeVisible();
  await expect(auto.getByText(/Heurística|Por quê|Proposta automática/)).toHaveCount(0);
  await noHorizontalOverflow(me);
  await mine.getByRole("link", { name: "Registrar semana 2, sessão 1, treino Full Body, fase 1" }).click();
  const first = me.locator(".session-exercise").first();
  await first.getByLabel("Fiz este exercício").check();
  const set1 = first.getByRole("group", { name: "Série 1" });
  await set1.getByRole("textbox", { name: "Repetições", exact: true }).fill("6");
  await set1.getByLabel("Carga (kg)").fill("20");
  // The optional per-set fields of a session-by-session plan (Q7), collapsed until opened.
  await set1.locator("summary").click();
  await set1.getByLabel("Repetições que sobraram (RIR)").selectOption("2");
  await me.getByRole("button", { name: "Salvar registro" }).click();
  await expect(me.getByText("Registro salvo.", { exact: false })).toBeVisible();

  // The professional sees the log against the planned dose of that session.
  await signIn(page, proEmail);
  await page.goto(studentURL);
  await showStudentTab(page, "Treinos");
  await expect(page.getByRole("heading", { name: /O que o aluno registrou/ })).toBeVisible();
});
