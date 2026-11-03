import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow, showStudentTab } from "./helpers";

// The new format of the assessment (handoff V2), step "Medidas", behind ASSESSMENT_V2_ENABLED (on in the local test environment only).
// The figures are the handoff's example (section 8): a man of 27 on the assessment date, 69,1 kg, 1,71 m.
const JP7 = { Peitoral: "12", "Axilar média": "9", "Tríceps": "24", Subescapular: "11", Abdominal: "16", "Supra-ilíaca": "15", Coxa: "35" };

/** A birth date that makes the person `years` old today (three days past the birthday, so the time zone does not matter). */
const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
};
const site = (page: Page, name: string) => page.getByLabel(`${name} (mm)`, { exact: true });
const preview = (page: Page) => page.getByRole("region", { name: "Prévia calculada" });
const result = (page: Page, label: string) => preview(page).locator(".av2-result", { has: page.locator("dt", { hasText: label }) }).locator("dd");

test("the Medidas step of the new format computes the preview, keeps values across protocols, saves and reports a conflict", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da avaliação nova");
  const studentURL = await addStudent(page, "Aluno das medidas");
  await page.getByRole("link", { name: "Preencher a ficha", exact: true }).click();
  await page.getByLabel("Data de nascimento").fill(yearsAgo(27));
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Ficha salva.")).toBeVisible();

  await page.goto(studentURL);
  await showStudentTab(page, "Avaliações");
  // The current assessment stays the default action; the new format is the extra one.
  await expect(page.getByRole("button", { name: "Iniciar avaliação" })).toBeVisible();
  await page.getByRole("button", { name: "Nova avaliação (formato novo)" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação inicial de Aluno das medidas" })).toBeVisible();
  const draftURL = page.url();

  const steps = page.getByRole("navigation", { name: "Etapas da avaliação" });
  await expect(steps.getByRole("button")).toHaveText(["1 Triagem", "2 Medidas", "3 Movimento", "4 Revisão"]);
  await expect(steps.getByRole("button", { name: "2 Medidas" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Sem alterações desde que a página abriu.")).toBeVisible();
  // The other steps are honest placeholders, with no field.
  await steps.getByRole("button", { name: "1 Triagem" }).click();
  await expect(page.getByText("Esta etapa chega numa próxima versão.")).toBeVisible();
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(steps.getByRole("button", { name: "2 Medidas" })).toHaveAttribute("aria-current", "step");

  // Nothing chosen yet: no number, it says what is missing.
  await expect(preview(page).getByText("Escolha o protocolo de dobras para calcular")).toBeVisible();
  await expect(page.getByLabel("Idade na avaliação")).toHaveValue("27 anos");
  await expect(page.getByLabel("Fórmula de conversão")).toHaveValue("Siri (1961)");
  await expect(page.getByLabel("Equação de referência para o cálculo", { exact: true })).toHaveValue("not_selected");

  await page.getByLabel("Peso (kg)").fill("69,1");
  await page.getByLabel("Altura (m)").fill("1,71");
  await page.getByLabel("PAS (mmHg)").fill("120");
  await page.getByLabel("PAD (mmHg)").fill("80");
  await page.getByLabel("FC repouso (bpm)").fill("70");
  await expect(page.getByText("Alterações não salvas.")).toBeVisible();
  await expect(result(page, "IMC")).toHaveText("23,63");

  await page.getByRole("radio", { name: "Jackson & Pollock · 7" }).check();
  await expect(preview(page).getByText("Escolha a equação de referência para calcular")).toBeVisible();
  await page.getByLabel("Equação de referência para o cálculo", { exact: true }).selectOption("male");
  await expect(page.getByRole("heading", { name: "Dobras requeridas • Jackson & Pollock 7" })).toBeVisible();
  for (const [name, value] of Object.entries(JP7)) await site(page, name).fill(value);
  await expect(preview(page).getByText("Fórmula Jackson & Pollock 1978 + Siri 1961; resultado estimado")).toBeVisible();
  await expect(result(page, "Soma das 7 dobras")).toHaveText("122 mm");
  await expect(result(page, "Gordura estimada")).toHaveText("17,3%");
  await expect(result(page, "Massa gorda")).toHaveText("11,9 kg");
  await expect(result(page, "Massa livre")).toHaveText("57,2 kg");
  await noHorizontalOverflow(page);

  // Faulkner asks for 4 of them; the other three stay typed, kept aside, and come back when JP7 is chosen again.
  await page.getByRole("radio", { name: "Faulkner" }).check();
  await expect(page.getByRole("heading", { name: "Dobras requeridas • Faulkner" })).toBeVisible();
  await expect(result(page, "Soma das 4 dobras")).toHaveText("66 mm");
  const others = page.locator("details.av2-others");
  await others.locator("summary").click();
  await expect(others.getByLabel("Peitoral (mm)", { exact: true })).toHaveValue("12");
  await page.getByRole("radio", { name: "Jackson & Pollock · 7" }).check();
  for (const [name, value] of Object.entries(JP7)) await expect(site(page, name)).toHaveValue(value);
  await expect(result(page, "Soma das 7 dobras")).toHaveText("122 mm");

  // A second reading of a site is averaged; an empty one is never a zero.
  await page.getByRole("button", { name: "Adicionar leitura de Coxa" }).click();
  await expect(page.getByLabel("Coxa, leitura 2 (mm)")).toHaveAttribute("placeholder", "Sem aferição");
  await expect(result(page, "Soma das 7 dobras")).toHaveText("122 mm");

  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Rascunho salvo.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("69,1");
  await expect(page.getByLabel("Altura (m)")).toHaveValue("1,71");
  await expect(page.getByLabel("PAS (mmHg)")).toHaveValue("120");
  await expect(page.getByRole("radio", { name: "Jackson & Pollock · 7" })).toBeChecked();
  await expect(page.getByLabel("Equação de referência para o cálculo", { exact: true })).toHaveValue("male");
  for (const [name, value] of Object.entries(JP7)) await expect(site(page, name)).toHaveValue(value);
  await expect(result(page, "Gordura estimada")).toHaveText("17,3%");

  // Another tab opens the same draft; this one saves first, so the other one's save is refused and said, not written over.
  const other = await page.context().newPage();
  await other.goto(draftURL);
  await expect(other.getByLabel("Peso (kg)")).toHaveValue("69,1");
  await page.getByLabel("Peso (kg)").fill("70");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Rascunho salvo.")).toBeVisible();
  await other.getByLabel("Peso (kg)").fill("68");
  await other.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(
    other.getByRole("alert").filter({ hasText: "Esta avaliação foi alterada em outra aba ou por outra pessoa. Recarregue para ver a versão atual." }),
  ).toBeVisible();
  await other.close();
  await page.reload();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("70");

  // The open draft of the new format is the student's one draft: the panel continues it.
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliações");
  await page.getByRole("link", { name: "Continuar o rascunho" }).click();
  await expect(page).toHaveURL(draftURL);
  await expect(page.getByRole("navigation", { name: "Etapas da avaliação" })).toBeVisible();
});

test("a value that is not a number is named and nothing typed is lost", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das medidas erradas");
  await addStudent(page, "Aluna sem nascimento");
  await showStudentTab(page, "Avaliações");
  await page.getByRole("button", { name: "Nova avaliação (formato novo)" }).click();
  await expect(page.getByLabel("Idade na avaliação")).toHaveValue("Sem data de nascimento no cadastro");
  await page.getByLabel("Peso (kg)").fill("sessenta");
  await page.getByRole("radio", { name: "Jackson & Pollock · 3" }).check();
  await page.getByLabel("Equação de referência para o cálculo", { exact: true }).selectOption("female");
  for (const name of ["Tríceps", "Supra-ilíaca", "Coxa"]) await site(page, name).fill("20");
  await expect(preview(page).getByText("Sem idade: o cálculo precisa da data de nascimento")).toBeVisible();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Confira o campo Peso" })).toBeVisible();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("sessenta");
});

test("a draft of the new format is discarded, and the student can start an assessment again", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do rascunho descartado");
  const studentURL = await addStudent(page, "Aluno do descarte");
  await showStudentTab(page, "Avaliações");
  await page.getByRole("button", { name: "Nova avaliação (formato novo)" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação inicial de Aluno do descarte" })).toBeVisible();
  // Cancelled at the question, nothing happens; accepted, the draft goes and the list offers to start again.
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação inicial de Aluno do descarte" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(page.getByRole("button", { name: "Iniciar avaliação" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continuar o rascunho" })).toHaveCount(0);
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliações");
  await expect(page.getByRole("button", { name: "Nova avaliação (formato novo)" })).toBeVisible();
});

test("the current assessment is still the default and opens the earlier form", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do formato atual");
  await addStudent(page, "Aluno do formato atual");
  await showStudentTab(page, "Avaliações");
  const start = page.getByRole("button", { name: "Iniciar avaliação" });
  await expect(start).toHaveClass(/primary/);
  await start.click();
  await expect(page.getByRole("heading", { name: "Avaliação inicial de Aluno do formato atual" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar avaliação" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Etapas da avaliação" })).toHaveCount(0);
});
