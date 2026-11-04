import { test, expect, type Page } from "@playwright/test";
import {
  addStudent,
  createProfessional,
  joinStudent,
  localIP,
  newActor,
  noHorizontalOverflow,
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

async function approveAndDeliver(page: Page) {
  await expect(page.getByRole("heading", { name: "Aprovar esta revisão" })).toBeVisible();
  await page.getByLabel(/Confirmo que não há triagem registrada/).check();
  await page.getByRole("button", { name: "Aprovar revisão" }).click();
  await expect(page.getByRole("heading", { name: "Entregar ao aluno" })).toBeVisible();
  await page.getByRole("button", { name: "Entregar ao aluno" }).click();
  await expect(page.getByRole("heading", { name: "Entregue ao aluno" })).toBeVisible();
}

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
  await page.getByRole("link", { name: "Gerar prescrição automática" }).click();
  await expect(page.getByRole("heading", { name: "Prescrição automática", level: 1 })).toBeVisible();
  const autoURL = page.url();
  await expect(page.getByRole("heading", { name: "Dados considerados" })).toBeVisible();
  // Nothing pre-selected: the button waits for the required answers.
  const generate = page.getByRole("button", { name: "Gerar prescrição automática" });
  await expect(generate).toBeDisabled();
  await expect(page.getByText("Os valores padrão desta ferramenta não são recomendação universal.").first()).toBeVisible();
  await page.getByLabel("Estímulo da fase 1").selectOption("HYPERTROPHY");
  await page.getByLabel("Estímulo da fase 2").selectOption("STRENGTH");
  await expect(generate).toBeDisabled();
  await page.getByLabel("Estímulo da fase 3").selectOption("HYPERTROPHY");
  await page.getByRole("group", { name: "Equipamentos disponíveis" }).getByRole("button", { name: "Marcar todos" }).click();
  const progression = page.getByRole("group", { name: /Progressão da Fase 01/ });
  await progression.getByLabel("Modelo").selectOption("LINEAR");
  await progression.getByLabel("Parâmetro").selectOption("sets");
  await progression.getByLabel("Na semana 1").fill("3");
  await progression.getByLabel("Na semana 4").fill("4");
  await noHorizontalOverflow(page);
  // 2. Processing, then 3. the whole proposal.
  await generate.click();
  await expect(page.getByRole("heading", { name: "Proposta de prescrição" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Fases geradas")).toBeVisible();

  // Motor V3: the plan audit, recorded with the proposal (rules 2026.11.3), read from the real sessions of each week.
  const audit = page.locator("section.audit-panel");
  await expect(page.getByRole("heading", { name: "Auditoria técnica do plano" })).toBeVisible();
  await expect(page.getByText(/· auditoria 1\.0\.0\. /)).toBeVisible();
  // Full Body three times a week: three real sessions in every full week.
  await expect(audit.locator(".kpi").filter({ hasText: "Sessões por semana (reais)" }).locator(".kpi-value")).toHaveText("3");
  await expect(audit.locator(".kpi").filter({ hasText: "Fases auditadas" }).locator(".kpi-value")).toHaveText("3 de 3");
  // Hypertrophy phases without structured targets: described, with a link to the phase that navigates (relative to the mount).
  await audit.locator("details.audit-group summary").filter({ hasText: /^Observações/ }).click();
  const noTargets = audit.locator(".audit-finding").filter({ hasText: "Fase sem alvos estruturados" });
  await expect(noTargets.first()).toBeVisible();
  await noTargets.getByRole("link", { name: "Ver a fase 3" }).click();
  await expect(page.getByRole("navigation", { name: "Fases da proposta" }).getByRole("link", { name: /^Fase 03/ })).toHaveAttribute("aria-current", "page");
  expect(new URL(page.url()).searchParams.get("fase")).toBe("3");
  await expect(page.getByRole("heading", { name: "Auditoria técnica do plano" })).toBeVisible();
  await audit.locator("summary").filter({ hasText: "Distribuição por músculo · Fase 3" }).click();
  await expect(audit.getByRole("region", { name: "Distribuição por músculo da fase 3, rolável para o lado" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole("navigation", { name: "Fases da proposta" }).getByRole("link", { name: /^Fase 01/ }).click();
  await expect(page.getByRole("navigation", { name: "Fases da proposta" }).getByRole("link", { name: /^Fase 01/ })).toHaveAttribute("aria-current", "page");

  // 4–6. Navigation, doses, bases and "Por quê?".
  const weeks = page.getByRole("navigation", { name: "Semanas da fase 1" });
  await weeks.getByRole("link", { name: "Semana 2" }).click();
  await expect(weeks.getByRole("link", { name: "Semana 2" })).toHaveAttribute("aria-current", "page");
  const session = page.getByRole("region", { name: /^Semana 2, sessão 1, treino Full Body$/ });
  await expect(session.locator(".exercise-list > li")).toHaveCount(3);
  await session.locator(".why-details summary").first().click();
  await expect(session.locator(".why-details").first().getByText("Heurística operacional (editável)").first()).toBeVisible();
  // The item's part of the week's volume, with the week's total from the audit.
  await expect(session.locator(".why-details").first().getByRole("heading", { name: "Contribuição na semana" })).toBeVisible();
  await expect(session.locator(".why-details").first().getByText(/^Total da semana 2 na fase \(3 sessões\)/)).toBeVisible();
  // The weekly table gains the sessions with direct stimulus.
  await page.locator("summary").filter({ hasText: "Volume semanal por músculo · Semana 2" }).click();
  await expect(page.getByRole("columnheader", { name: "Sessões c/ estímulo direto" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alertas, premissas e avisos" })).toBeVisible();
  await noHorizontalOverflow(page);

  // 8. Substitute the first exercise in the whole phase, with an alternative the tool offers.
  const firstName = (await session.locator(".exercise-list > li strong").first().innerText()).trim();
  await session.getByRole("button", { name: `Substituir ${firstName}` }).click();
  const dialog = page.getByRole("dialog", { name: `Substituir ${firstName}` });
  // The tool's alternatives (reviewed or inferred), or, when none fits the equipment, any exercise of the library.
  const radios = dialog.locator('input[name="alternativa"]');
  await expect(radios.first().or(dialog.getByText("Nenhuma alternativa compatível", { exact: false }))).toBeVisible({ timeout: 30_000 });
  if (await radios.count()) await radios.first().check();
  else await dialog.getByLabel("Ou outro exercício da biblioteca").selectOption({ index: 1 });
  await dialog.getByLabel("Na fase inteira").check();
  await dialog.getByRole("button", { name: "Substituir", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(session.getByText("Trocado por você").first()).toBeVisible({ timeout: 30_000 });

  // 9. Regenerate one session.
  await session.getByRole("button", { name: "Regenerar esta sessão" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Proposta atualizada|mudaram/ })).toBeVisible({ timeout: 30_000 });

  // 10. Apply to the draft: the existing flow continues on the revision page.
  await page.getByRole("button", { name: "Aplicar ao rascunho" }).click();
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
  await page.getByRole("button", { name: "Marcar estrutura como pronta" }).click();
  // The edit made in week 2, session 1 only is counted (never "0 editados").
  await expect(page.getByRole("note").filter({ hasText: /exercícios? propostos? automaticamente \([1-9]\d* editados? por você\)/ })).toBeVisible();
  await approveAndDeliver(page);
  // The history of the proposal stays, read-only.
  await page.goto(autoURL);
  await expect(page.getByRole("heading", { name: "Histórico das propostas" })).toBeVisible();
  await expect(page.getByText("Aplicada ao rascunho", { exact: false }).first()).toBeVisible();

  // The legacy plan is unchanged for the professional: no sessions, no proposal.
  await page.goto(legacyURL);
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
