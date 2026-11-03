import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow, showStudentTab } from "./helpers";

// The Avaliação Física (handoff V2; the only assessment since the user's decision of 03/11/2026), step "Medidas".
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
/**
 * Every line of fields of a card lines up: the controls of the fields that share a line start at the same height, and no value shown in a
 * read-only box is cut. Returns how many fields each line has, top to bottom.
 */
async function linesOf(page: Page, card: string) {
  return page.getByRole("region", { name: card }).evaluate((region) => {
    const lines = new Map<number, number[]>();
    for (const field of region.querySelectorAll<HTMLElement>(":scope > .av2-grid > .av2-field")) {
      if (field.offsetParent === null) continue;
      const top = Math.round(field.getBoundingClientRect().top);
      const control = field.children[1] as HTMLElement;
      lines.set(top, [...(lines.get(top) ?? []), Math.round(control.getBoundingClientRect().top)]);
    }
    const cut = [...region.querySelectorAll<HTMLElement>(".av2-readonly")].filter((box) => box.scrollWidth > box.clientWidth + 1).length;
    return { lines: [...lines.values()].map((tops) => ({ fields: tops.length, aligned: tops.every((top) => Math.abs(top - tops[0]) <= 1) })), cut };
  });
}
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
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação física de Aluno das medidas" })).toBeVisible();
  const draftURL = page.url();

  const steps = page.getByRole("navigation", { name: "Etapas da avaliação física" });
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
  await expect(page.getByLabel("Idade na avaliação")).toHaveText("27 anos");
  await expect(page.getByLabel("Fórmula de conversão")).toHaveText("Siri (1961)");
  await expect(page.getByLabel("Referência da equação", { exact: true })).toHaveValue("not_selected");
  await expect(page.getByLabel("Referência da equação", { exact: true })).toHaveAccessibleDescription("É a referência da equação, não o gênero da pessoa.");

  await page.getByLabel("Peso (kg)").fill("69,1");
  await page.getByLabel("Altura (m)").fill("1,71");
  await page.getByLabel("PAS (mmHg)").fill("120");
  await page.getByLabel("PAD (mmHg)").fill("80");
  await page.getByLabel("FC repouso (bpm)").fill("70");
  await expect(page.getByText("Alterações não salvas.")).toBeVisible();
  await expect(result(page, "IMC")).toHaveText("23,63");

  await page.getByRole("radio", { name: "Jackson & Pollock · 7" }).check();
  await expect(preview(page).getByText("Escolha a equação de referência para calcular")).toBeVisible();
  await page.getByLabel("Referência da equação", { exact: true }).selectOption("male");
  await expect(page.getByRole("heading", { name: "Dobras requeridas • Jackson & Pollock 7" })).toBeVisible();
  for (const [name, value] of Object.entries(JP7)) await site(page, name).fill(value);
  await expect(preview(page).getByText("Fórmula Jackson & Pollock 1978 + Siri 1961; resultado estimado")).toBeVisible();
  await expect(result(page, "Soma das 7 dobras")).toHaveText("122 mm");
  await expect(result(page, "Gordura estimada")).toHaveText("17,3%");
  await expect(result(page, "Massa gorda")).toHaveText("11,9 kg");
  await expect(result(page, "Massa livre")).toHaveText("57,2 kg");
  await noHorizontalOverflow(page);

  // The user's report of 03/11/2026: every line of fields lines up, with no empty column at the end of a line and nothing cut. On a computer
  // the four basic measures and the four protocol fields are one line each, and the seven skinfolds are 4 + 3; on a phone, one per line.
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  for (const card of ["Medidas básicas e sinais vitais", "Protocolo de dobras cutâneas", "Dobras requeridas • Jackson & Pollock 7"]) {
    const { lines, cut } = await linesOf(page, card);
    expect(cut, card).toBe(0);
    expect(lines.every((line) => line.aligned), card).toBe(true);
    if (wide) expect(lines.map((line) => line.fields), card).toEqual(card.startsWith("Dobras") ? [4, 3] : [4]);
    else expect(lines.every((line) => line.fields === 1), card).toBe(true);
  }

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
  await expect(page.getByLabel("Referência da equação", { exact: true })).toHaveValue("male");
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

  // The open draft is the student's one draft: the panel continues it.
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("link", { name: "Continuar a avaliação física", exact: true }).click();
  await expect(page).toHaveURL(draftURL);
  await expect(page.getByRole("navigation", { name: "Etapas da avaliação física" })).toBeVisible();
});

test("a value that is not a number is named and nothing typed is lost", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das medidas erradas");
  await addStudent(page, "Aluna sem nascimento");
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  // The long read-only value wraps in its box instead of being cut (user's report of 03/11/2026).
  await expect(page.getByLabel("Idade na avaliação")).toHaveText("Sem data de nascimento no cadastro");
  expect((await linesOf(page, "Protocolo de dobras cutâneas")).cut).toBe(0);
  await page.getByLabel("Peso (kg)").fill("sessenta");
  await page.getByRole("radio", { name: "Jackson & Pollock · 3" }).check();
  await page.getByLabel("Referência da equação", { exact: true }).selectOption("female");
  for (const name of ["Tríceps", "Supra-ilíaca", "Coxa"]) await site(page, name).fill("20");
  await expect(preview(page).getByText("Sem idade: o cálculo precisa da data de nascimento")).toBeVisible();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Confira o campo Peso" })).toBeVisible();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("sessenta");
});

test("a draft is discarded, and the student can start the Avaliação Física again", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio do rascunho descartado");
  const studentURL = await addStudent(page, "Aluno do descarte");
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação física de Aluno do descarte" })).toBeVisible();
  // Cancelled at the question, nothing happens; accepted, the draft goes and the list offers to start again.
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação física de Aluno do descarte" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(page.getByRole("button", { name: "Iniciar avaliação física" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continuar a avaliação física", exact: true })).toHaveCount(0);
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await expect(page.getByRole("button", { name: "Iniciar avaliação física" })).toBeVisible();
});

test("there is one assessment, the Avaliação Física: the earlier format is not offered anywhere", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da avaliação única");
  await addStudent(page, "Aluno da avaliação única");
  await showStudentTab(page, "Avaliação Física");
  await expect(page.getByRole("heading", { name: "Avaliação Física", exact: true })).toBeVisible();
  await expect(page.getByText("Este aluno ainda não tem avaliação física.", { exact: false })).toBeVisible();
  // One way to start, named after it; nothing of the earlier format (its button, its form, its screening of six items, its photos).
  const start = page.getByRole("button", { name: /Iniciar/ });
  await expect(start).toHaveCount(1);
  await expect(start).toHaveText(/Iniciar avaliação física/);
  await expect(page.getByRole("button", { name: /formato novo|Nova avaliação/ })).toHaveCount(0);
  await start.click();
  await expect(page.getByRole("heading", { name: "Avaliação física de Aluno da avaliação única" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Etapas da avaliação física" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar avaliação" })).toHaveCount(0);
  await expect(page.getByText("Fotos da postura")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Dor torácica relatada" })).toHaveCount(0);
  await page.goto("./profissional/avaliacoes");
  await expect(page.getByRole("heading", { name: "Avaliação Física", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Aluno da avaliação única/ }).getByRole("link", { name: "Continuar" })).toBeVisible();
});
