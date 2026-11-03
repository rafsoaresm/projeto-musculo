import { test, expect, type Page, type Request } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow, showStudentTab } from "./helpers";
import { AUTOSAVE_STOPPED, DRAFT_AUTOSAVE_DELAY_MS } from "../../src/modules/avaliacoes/v2/autosave";
import { ANAMNESIS, PARQ } from "../../src/modules/avaliacoes/catalog";

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
const CONFLICT = "Esta avaliação foi alterada em outra aba ou por outra pessoa. Recarregue para ver a versão atual.";
/** The status line after a save, by itself or by the button: "Salvo às 14:05." */
const savedLine = (page: Page) => page.locator(".av2-status").filter({ hasText: /^Salvo às \d{2}:\d{2}\.$/ });
/** Long enough for the pause to pass and the save to come back. */
const BY_ITSELF = DRAFT_AUTOSAVE_DELAY_MS + 10_000;
const pastThePause = (page: Page) => page.waitForTimeout(DRAFT_AUTOSAVE_DELAY_MS + 1500);
/** Sooner than the pause could have saved: what shows up within it came from the button or the step change. */
const BEFORE_THE_PAUSE = DRAFT_AUTOSAVE_DELAY_MS - 300;
/** A save of the draft: the POST of a server action (the page posts to its own address, so this holds under any mount). */
const isSave = (request: Request) => request.method() === "POST" && "next-action" in request.headers();
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

test("the Medidas step of the new format computes the preview, keeps values across protocols and saves itself", async ({ page }) => {
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

  // A new draft opens at step 1, the Triagem.
  const steps = page.getByRole("navigation", { name: "Etapas da avaliação física" });
  await expect(steps.getByRole("button")).toHaveText(["1 Triagem", "2 Medidas", "3 Movimento", "4 Revisão"]);
  await expect(steps.getByRole("button", { name: "1 Triagem" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Sem alterações desde que a página abriu.")).toBeVisible();
  await steps.getByRole("button", { name: "3 Movimento" }).click();
  await expect(page.getByRole("heading", { name: "Postura e movimento" })).toBeVisible();
  await page.getByRole("button", { name: "Voltar" }).click();
  await expect(steps.getByRole("button", { name: "2 Medidas" })).toHaveAttribute("aria-current", "step");
  // The address keeps the step, so a reload (and the other tab below) opens it again.
  await expect(page).toHaveURL(/\?etapa=medidas$/);
  const draftURL = page.url();

  // Nothing chosen yet: no number, it says what is missing.
  await expect(preview(page).getByText("Escolha o protocolo de dobras para calcular")).toBeVisible();
  await expect(page.getByLabel("Idade na avaliação")).toHaveText("27 anos");
  await expect(page.getByLabel("Fórmula de conversão")).toHaveText("Siri (1961)");
  await expect(page.getByLabel("Referência da equação", { exact: true })).toHaveValue("not_selected");
  await expect(page.getByLabel("Referência da equação", { exact: true })).toHaveAccessibleDescription("É a referência da equação, não o gênero da pessoa.");

  await page.getByLabel("Peso (kg)").fill("69,1");
  await expect(page.getByText("Alterações não salvas.")).toBeVisible();
  await page.getByLabel("Altura (m)").fill("1,71");
  await page.getByLabel("PAS (mmHg)").fill("120");
  await page.getByLabel("PAD (mmHg)").fill("80");
  await page.getByLabel("FC repouso (bpm)").fill("70");
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

  // The user's report of 03/11/2026: every line of fields lines up and nothing is cut. On a computer the four basic measures and the four
  // protocol fields are one full line each (no fifth, empty column), and the seven skinfolds wrap as 4 + 3; on a phone, one per line.
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  for (const card of ["Medidas básicas e sinais vitais", "Protocolo de dobras cutâneas", "Dobras requeridas • Jackson & Pollock 7"]) {
    const { lines, cut } = await linesOf(page, card);
    expect(cut, card).toBe(0);
    expect(lines.every((line) => line.aligned), card).toBe(true);
    if (wide) expect(lines.map((line) => line.fields), card).toEqual(card.startsWith("Dobras") ? [4, 3] : [4]);
    else expect(lines.every((line) => line.fields === 1), card).toBe(true);
  }
  // The chips of the steps scroll inside their row; they never make the page wider than the window.
  expect(await page.evaluate(() => document.querySelector(".av2")!.getBoundingClientRect().right <= document.documentElement.clientWidth)).toBe(true);

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
  // The readings of a site keep one width (the first keeps the place of the remove button), and a neighbour's "+ leitura" stays right under
  // its own input when a site of the same line has more readings.
  const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;
  await page.getByRole("button", { name: "Adicionar leitura de Peitoral" }).click();
  const [peitoral, peitoral2, axilar, axilarAdd] = await Promise.all([
    box(site(page, "Peitoral")),
    box(page.getByLabel("Peitoral, leitura 2 (mm)")),
    box(site(page, "Axilar média")),
    box(page.getByRole("button", { name: "Adicionar leitura de Axilar média" })),
  ]);
  expect(Math.abs(peitoral.width - peitoral2.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(peitoral.x - peitoral2.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(peitoral.width - axilar.width)).toBeLessThanOrEqual(1);
  expect(axilarAdd.y - (axilar.y + axilar.height)).toBeLessThanOrEqual(16);
  await page.getByRole("button", { name: "Remover leitura 2 de Peitoral" }).click();
  await expect(page.getByLabel("Peitoral, leitura 2 (mm)")).toHaveCount(0);

  // Slice 0.78: perimeters (each side in its own field) and bone breadths, with the handoff's waist and hip (RCQ ~0,644) and the bilateral
  // difference said as right − left, with no classification. An empty field is "sem aferição", never 0.
  const perimeters = page.getByRole("region", { name: "Perímetros corporais • cm" });
  await expect(perimeters.getByLabel("Relação cintura/quadril")).toHaveText("—");
  await expect(perimeters.getByLabel("Relação cintura/quadril")).toHaveAccessibleDescription("Precisa da cintura e do quadril");
  await perimeters.getByLabel("Cintura (cm)").fill("69,5");
  await expect(perimeters.getByLabel("Relação cintura/quadril")).toHaveAccessibleDescription("Falta o quadril");
  await perimeters.getByLabel("Quadril (cm)").fill("108");
  await expect(perimeters.getByLabel("Relação cintura/quadril")).toHaveText("0,644");
  await perimeters.getByLabel("Coxa direita (cm)").fill("56");
  await expect(perimeters.getByRole("group", { name: "Coxa D / E" })).not.toContainText("D − E");
  // One side only: the pair says which side is missing (as the Revisão does), and the unit is next to the pair, not only in the card title.
  await expect(perimeters.getByRole("group", { name: "Coxa D / E · cm" })).toHaveAccessibleDescription("Falta o lado esquerdo");
  await perimeters.getByLabel("Coxa esquerda (cm)").fill("56,6");
  await expect(perimeters.getByRole("group", { name: "Coxa D / E" })).toHaveAccessibleDescription("D − E = −0,6 cm: esquerdo maior em 0,6 cm");
  await perimeters.getByLabel("Braço direito (cm)", { exact: true }).fill("27");
  await expect(perimeters.getByLabel("Ombro (cm)")).toHaveAttribute("placeholder", "Sem aferição");
  await expect(perimeters).not.toContainText(/significativ|normal|bom|ruim/i);
  const breadths = page.getByRole("region", { name: "Diâmetros ósseos • cm" });
  await breadths.getByLabel("Biepicondilar do úmero (cm)").fill("6,4");
  await breadths.getByLabel("Biestiloide (cm)").fill("5,7");
  // The same alignment rule: 9 perimeters and the ratio are 4 + 4 + 2 on a computer, the 3 breadths one line; one per line on a phone.
  for (const [card, wideLines] of [
    ["Perímetros corporais • cm", [4, 4, 2]],
    ["Diâmetros ósseos • cm", [3]],
  ] as const) {
    const { lines, cut } = await linesOf(page, card);
    expect(cut, card).toBe(0);
    expect(lines.every((line) => line.aligned), card).toBe(true);
    if (wide) expect(lines.map((line) => line.fields), card).toEqual(wideLines);
    else expect(lines.every((line) => line.fields === 1), card).toBe(true);
  }
  await noHorizontalOverflow(page);

  // Nobody clicks "Salvar rascunho": after a pause in the typing the draft saves itself, and a reload brings everything back.
  await expect(savedLine(page)).toBeVisible({ timeout: BY_ITSELF });
  await page.reload();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("69,1");
  await expect(page.getByLabel("Altura (m)")).toHaveValue("1,71");
  await expect(page.getByLabel("PAS (mmHg)")).toHaveValue("120");
  await expect(page.getByRole("radio", { name: "Jackson & Pollock · 7" })).toBeChecked();
  await expect(page.getByLabel("Referência da equação", { exact: true })).toHaveValue("male");
  for (const [name, value] of Object.entries(JP7)) await expect(site(page, name)).toHaveValue(value);
  await expect(result(page, "Gordura estimada")).toHaveText("17,3%");
  await expect(perimeters.getByLabel("Cintura (cm)")).toHaveValue("69,5");
  await expect(perimeters.getByLabel("Coxa esquerda (cm)")).toHaveValue("56,6");
  await expect(perimeters.getByLabel("Braço esquerdo (cm)", { exact: true })).toHaveValue("");
  await expect(perimeters.getByLabel("Relação cintura/quadril")).toHaveText("0,644");
  await expect(breadths.getByLabel("Biestiloide (cm)")).toHaveValue("5,7");
  await expect(breadths.getByLabel("Biepicondilar do fêmur (cm)")).toHaveValue("");
  await expect(page.getByText("Sem alterações desde que a página abriu.")).toBeVisible();

  // Leaving the step saves at once, before the pause would.
  await page.getByLabel("FC repouso (bpm)").fill("72");
  await expect(savedLine(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(savedLine(page)).toBeVisible({ timeout: BEFORE_THE_PAUSE });
  await page.getByRole("button", { name: "Voltar" }).click();
  // The button still saves on its own, before the pause would.
  await page.getByLabel("PAS (mmHg)").fill("118");
  await expect(savedLine(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(savedLine(page)).toBeVisible({ timeout: BEFORE_THE_PAUSE });
  await page.reload();
  await expect(page.getByLabel("FC repouso (bpm)")).toHaveValue("72");
  await expect(page.getByLabel("PAS (mmHg)")).toHaveValue("118");

  // Never two saves at once: while a slow save is on the way, what is asked waits, and only the latest content goes after it. The saves are
  // held on the way here so the second request surely meets the first one in flight.
  let onTheWay = 0;
  let mostAtOnce = 0;
  let sent = 0;
  await page.route("**/*", async (route) => {
    if (!isSave(route.request())) return route.fallback();
    sent += 1;
    onTheWay += 1;
    mostAtOnce = Math.max(mostAtOnce, onTheWay);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await route.fetch();
    onTheWay -= 1;
    await route.fulfill({ response });
  });
  const save = page.getByRole("button", { name: "Salvar rascunho" });
  await page.getByLabel("PAS (mmHg)").fill("119");
  await save.click();
  await expect(page.locator(".av2-status")).toHaveText("Salvando…");
  // The focus stays on the button while it saves, and a click now waits for the save on the way.
  await expect(save).toBeFocused();
  await page.getByLabel("PAS (mmHg)").fill("121");
  await page.getByLabel("PAS (mmHg)").fill("122");
  await save.click();
  await expect(savedLine(page)).toBeVisible({ timeout: 2 * 2500 + 10_000 });
  expect(sent).toBe(2);
  expect(mostAtOnce).toBe(1);
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(page.getByLabel("PAS (mmHg)")).toHaveValue("122");

  // Another tab opens the same draft; this one saves first (by itself), so the other one's save is refused and said, not written over, and the
  // other tab stops saving by itself until it is reloaded.
  const other = await page.context().newPage();
  await other.goto(draftURL);
  await expect(other.getByLabel("Peso (kg)")).toHaveValue("69,1");
  await page.getByLabel("Peso (kg)").fill("70");
  await expect(savedLine(page)).toBeVisible({ timeout: BY_ITSELF });
  let sentByOther = 0;
  other.on("request", (request) => {
    if (isSave(request)) sentByOther += 1;
  });
  await other.getByLabel("Peso (kg)").fill("68");
  const conflict = other.getByRole("alert").filter({ hasText: CONFLICT });
  await expect(conflict).toBeVisible({ timeout: BY_ITSELF });
  await expect(conflict).toContainText(AUTOSAVE_STOPPED);
  await expect(other.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  expect(sentByOther).toBe(1);
  // More typing in the stale tab, a step change and the button: nothing more is sent, the message stays.
  await other.getByLabel("Peso (kg)").fill("67");
  await pastThePause(other);
  await other.getByRole("button", { name: "Próximo" }).click();
  await other.getByRole("button", { name: "Voltar" }).click();
  // aria-disabled (the button keeps the focus): Playwright would wait for it to be enabled, so the click is forced, as a person's click is.
  await other.getByRole("button", { name: "Salvar rascunho" }).click({ force: true });
  await other.waitForTimeout(1000);
  expect(sentByOther).toBe(1);
  await expect(conflict).toBeVisible();
  await expect(savedLine(other)).toHaveCount(0);
  await other.close();
  await page.reload();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("70");

  // The open draft is the student's one draft: the panel continues it.
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("link", { name: "Continuar a avaliação física", exact: true }).click();
  await expect(page).toHaveURL(draftURL.replace(/\?etapa=medidas$/, ""));
  await expect(page.getByRole("navigation", { name: "Etapas da avaliação física" })).toBeVisible();
});

test("a value that is not a number is named, never saved by itself, and nothing typed is lost", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das medidas erradas");
  await addStudent(page, "Aluna sem nascimento");
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await page.getByRole("button", { name: "2 Medidas" }).click();
  // The long read-only value wraps in its box instead of being cut (user's report of 03/11/2026).
  await expect(page.getByLabel("Idade na avaliação")).toHaveText("Sem data de nascimento no cadastro");
  expect((await linesOf(page, "Protocolo de dobras cutâneas")).cut).toBe(0);
  // The wrapped value makes only its own box taller: the selects beside it keep their height.
  const [equation, readings] = await Promise.all([page.locator("#av2-equacao").boundingBox(), page.locator("#av2-leituras").boundingBox()]);
  expect(equation!.height).toBeLessThanOrEqual(56);
  expect(Math.abs(equation!.height - readings!.height)).toBeLessThanOrEqual(1);
  await page.getByLabel("Peso (kg)").fill("sessenta");
  await page.getByRole("radio", { name: "Jackson & Pollock · 3" }).check();
  await page.getByLabel("Referência da equação", { exact: true }).selectOption("female");
  for (const name of ["Tríceps", "Supra-ilíaca", "Coxa"]) await site(page, name).fill("20");
  await expect(preview(page).getByText("Sem idade: o cálculo precisa da data de nascimento")).toBeVisible();
  // After the pause the problem is shown by itself, on the quiet line (the person may still be typing: it does not interrupt), and the typing
  // stays on the screen.
  const quietProblem = page.getByRole("status").filter({ hasText: "Confira o campo Peso" });
  const problem = page.getByRole("alert").filter({ hasText: "Confira o campo Peso" });
  await expect(quietProblem).toBeVisible({ timeout: BY_ITSELF });
  await expect(problem).toHaveCount(0);
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("sessenta");
  await expect(savedLine(page)).toHaveCount(0);
  // Asked for with the button, it is an alert.
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(problem).toBeVisible();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("sessenta");
  // Nothing of it was stored: the same draft opened elsewhere is empty.
  const elsewhere = await page.context().newPage();
  await elsewhere.goto(page.url());
  await expect(elsewhere.getByLabel("Peso (kg)")).toHaveValue("");
  await expect(elsewhere.getByRole("radio", { name: "Jackson & Pollock · 3" })).not.toBeChecked();
  await elsewhere.close();
  // Corrected, it saves by itself.
  await page.getByLabel("Peso (kg)").fill("60");
  await expect(problem).toHaveCount(0);
  await expect(quietProblem).toHaveCount(0);
  await expect(savedLine(page)).toBeVisible({ timeout: BY_ITSELF });
  await page.reload();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("60");
  await expect(page.getByRole("radio", { name: "Jackson & Pollock · 3" })).toBeChecked();
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

/** The answers of a question (a radio group named by the question) start at the same x and have the same width on every line of a card. */
async function answersAligned(page: Page, card: string) {
  return page.getByRole("region", { name: card }).evaluate((region) => {
    const boxes = [...region.querySelectorAll<HTMLElement>(".av2-answers")].map((box) => box.getBoundingClientRect());
    return boxes.length > 0 && boxes.every((box) => Math.abs(box.left - boxes[0].left) <= 1 && Math.abs(box.width - boxes[0].width) <= 1);
  });
}
const question = (page: Page, text: string) => page.getByRole("radiogroup", { name: text, exact: true });

test("the Triagem step takes the goals, the anamnesis, the activity and the PAR-Q, asks for a decision on a Sim, and saves itself", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da triagem");
  await addStudent(page, "Aluno da triagem");
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Decisão profissional" })).toHaveCount(0);

  // Goals: several at once.
  const goals = page.getByRole("group", { name: "Objetivos do treinamento" });
  await expect(goals.getByRole("checkbox")).toHaveCount(7);
  await goals.getByRole("checkbox", { name: "Hipertrofia" }).check();
  await goals.getByRole("checkbox", { name: "Saúde e bem-estar" }).check();
  await page.getByLabel("Objetivos adicionais e notas").fill("Voltar a correr 5 km");

  // Anamnesis: ten questions, nothing answered by itself; a "Sim" opens its description.
  const anamnesis = page.getByRole("region", { name: "Anamnese clínica" });
  await expect(anamnesis.getByRole("radiogroup")).toHaveCount(10);
  await expect(anamnesis.getByRole("radio", { checked: true })).toHaveCount(0);
  await question(page, ANAMNESIS.injuries).getByRole("radio", { name: "Sim" }).check();
  await page.getByLabel(`Descrição de “${ANAMNESIS.injuries}”`).fill("Entorse no tornozelo direito em 2024");
  await question(page, ANAMNESIS.allergies).getByRole("radio", { name: "Não informado" }).check();
  await question(page, ANAMNESIS.smoking).getByRole("radio", { name: "Não", exact: true }).check();

  // Activity: the frequency is a number per week; text such as "3x" is named, never stored.
  const current = page.getByRole("region", { name: "Atividade física atual" });
  await current.getByLabel("Pratica?").selectOption("yes");
  await current.getByLabel("Atividades").fill("Musculação");
  await current.getByLabel("Frequência (por semana)").fill("3x");
  await current.getByLabel("Duração/tempo de prática").fill("60 min, há 2 anos");
  const quietProblem = page.getByRole("status").filter({ hasText: "Confira o campo Frequência (atual)" });
  await expect(quietProblem).toBeVisible({ timeout: BY_ITSELF });
  await current.getByLabel("Frequência (por semana)").fill("3");
  await expect(quietProblem).toHaveCount(0);
  await page.getByRole("region", { name: "Atividade física passada" }).getByLabel("Praticou?").selectOption("no");

  // PAR-Q: seven questions, each "Não respondido" until answered, which is pending, never a "Não".
  const parq = page.getByRole("region", { name: "PAR-Q • 7 perguntas" });
  await expect(parq.getByRole("radiogroup")).toHaveCount(7);
  await expect(parq.getByRole("radio", { name: "Não respondido", checked: true })).toHaveCount(7);
  await expect(parq.getByText("7 de 7 perguntas sem resposta")).toBeVisible();
  for (const text of Object.values(PARQ)) await question(page, text).getByRole("radio", { name: "Não", exact: true }).check();
  await expect(parq.getByText("Todas as perguntas do PAR-Q respondidas.")).toBeVisible();
  // A "Sim" is a flag that asks for the professional's decision: nothing is chosen for them.
  await question(page, PARQ.dizziness).getByRole("radio", { name: "Sim" }).check();
  const decision = page.getByRole("region", { name: "Decisão profissional" });
  await expect(decision.getByText("Atenção: pelo menos uma resposta positiva. Registrar decisão profissional antes de finalizar.")).toBeVisible();
  await expect(decision.getByRole("radio", { checked: true })).toHaveCount(0);
  await decision.getByRole("radio", { name: "Precisa de liberação médica" }).check();
  await decision.getByLabel("Nota da decisão").fill("Encaminhado ao cardiologista antes de treinos intensos.");

  // Every line lines up: the answers of all questions in one column, the fields of the activity cards on one line each (a long note on its own).
  for (const card of ["Anamnese clínica", "PAR-Q • 7 perguntas"]) expect(await answersAligned(page, card), card).toBe(true);
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  for (const card of ["Atividade física atual", "Atividade física passada"]) {
    const { lines } = await linesOf(page, card);
    expect(lines.every((line) => line.aligned), card).toBe(true);
    if (wide) expect(lines.map((line) => line.fields), card).toEqual([4, 1]);
    else expect(lines.every((line) => line.fields === 1), card).toBe(true);
  }
  await noHorizontalOverflow(page);

  // Nobody clicks "Salvar rascunho": it saves itself, and a reload brings everything back.
  await expect(savedLine(page)).toBeVisible({ timeout: BY_ITSELF });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  await expect(goals.getByRole("checkbox", { name: "Hipertrofia" })).toBeChecked();
  await expect(goals.getByRole("checkbox", { name: "Saúde e bem-estar" })).toBeChecked();
  await expect(goals.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(page.getByLabel("Objetivos adicionais e notas")).toHaveValue("Voltar a correr 5 km");
  await expect(question(page, ANAMNESIS.injuries).getByRole("radio", { name: "Sim" })).toBeChecked();
  await expect(page.getByLabel(`Descrição de “${ANAMNESIS.injuries}”`)).toHaveValue("Entorse no tornozelo direito em 2024");
  await expect(question(page, ANAMNESIS.allergies).getByRole("radio", { name: "Não informado" })).toBeChecked();
  await expect(question(page, ANAMNESIS.surgeries).getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(current.getByLabel("Pratica?")).toHaveValue("yes");
  await expect(current.getByLabel("Frequência (por semana)")).toHaveValue("3");
  await expect(current.getByLabel("Duração/tempo de prática")).toHaveValue("60 min, há 2 anos");
  await expect(question(page, PARQ.dizziness).getByRole("radio", { name: "Sim" })).toBeChecked();
  await expect(question(page, PARQ.heart_condition).getByRole("radio", { name: "Não", exact: true })).toBeChecked();
  await expect(decision.getByRole("radio", { name: "Precisa de liberação médica" })).toBeChecked();
  await expect(decision.getByLabel("Nota da decisão")).toHaveValue("Encaminhado ao cardiologista antes de treinos intensos.");

  // The button saves the step at once, before the pause would; the Medidas step is untouched by it.
  await question(page, PARQ.other_reason).getByRole("radio", { name: "Não respondido" }).check();
  await expect(parq.getByText("1 de 7 pergunta sem resposta")).toBeVisible();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(savedLine(page)).toBeVisible({ timeout: BEFORE_THE_PAUSE });
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("Peso (kg)")).toBeVisible();
  await page.getByRole("button", { name: "1 Triagem" }).click();
  await expect(question(page, PARQ.other_reason).getByRole("radio", { name: "Não respondido" })).toBeChecked();
  // "Não respondido" chosen is drawn as no answer (an outline), not as the solid chip of a given answer.
  const blankChip = question(page, PARQ.other_reason).locator("label", { has: page.getByRole("radio", { name: "Não respondido" }) }).locator("span");
  const noChip = question(page, PARQ.heart_condition).locator("label", { has: page.getByRole("radio", { name: "Não", exact: true }) }).locator("span");
  const background = (chip: typeof blankChip) => chip.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await background(blankChip)).not.toBe(await background(noChip));
  await expect(parq.getByRole("radiogroup").first()).toHaveAttribute("aria-required", "true");

  // An invalid value left in Triagem never holds back the Medidas step: its weight saves by itself, the Triagem value is still named.
  await current.getByLabel("Frequência (por semana)").fill("3x");
  await page.getByRole("button", { name: "Próximo" }).click();
  await page.getByLabel("Peso (kg)").fill("69,1");
  await expect(page.getByRole("status").filter({ hasText: "Confira o campo Frequência (atual)" })).toBeVisible({ timeout: BY_ITSELF });
  const other = await page.context().newPage();
  await other.goto(page.url());
  await expect(other.getByLabel("Peso (kg)")).toHaveValue("69,1");
  await other.getByRole("button", { name: "1 Triagem" }).click();
  await expect(other.getByRole("region", { name: "Atividade física atual" }).getByLabel("Frequência (por semana)")).toHaveValue("3");
  await other.close();
});

/**
 * The findings of every region shown in a card line up: the first chip of each region starts at the same x, and every chip has the same width (the
 * columns are the same on every line, whatever the number of findings). Only what is on screen (the open tab) counts.
 */
async function findingsAligned(page: Page, card: string) {
  return page.getByRole("region", { name: card }).evaluate((region) => {
    const chips = [...region.querySelectorAll<HTMLElement>(".av2-finding-options")].filter((box) => box.offsetParent !== null).map((box) => [...box.children] as HTMLElement[]);
    const firsts = chips.map((row) => row[0].getBoundingClientRect());
    const widths = chips.flat().map((chip) => chip.getBoundingClientRect().width);
    return (
      chips.length > 0 &&
      firsts.every((box) => Math.abs(box.left - firsts[0].left) <= 1) &&
      widths.every((width) => Math.abs(width - widths[0]) <= 1)
    );
  });
}
const view = (page: Page, name: string) => page.getByRole("region", { name: "Avaliação postural" }).getByRole("tab", { name: new RegExp(`^${name}`) });

// Slice 0.79: the "Movimento" step, posture in three views and the somatotype (handoff 3.3, Figma AV-05).
test("the Movimento step records the posture in three views and the somatotype, never as a diagnosis nor computed, and saves itself", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da postura");
  await addStudent(page, "Aluno da postura");
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  await page.getByRole("navigation", { name: "Etapas da avaliação física" }).getByRole("button", { name: "3 Movimento" }).click();
  await expect(page.getByRole("heading", { name: "Postura e movimento" })).toBeVisible();

  // Three views as tabs; nothing is observed by itself (a region is never "alinhado" by default).
  const posture = page.getByRole("region", { name: "Avaliação postural" });
  await expect(posture.getByRole("tab")).toHaveText(["Lateral · 0 de 8", "Posterior · 0 de 7", "Anterior · 0 de 4"]);
  await expect(view(page, "Lateral")).toHaveAttribute("aria-selected", "true");
  await expect(posture.getByRole("radiogroup")).toHaveCount(6);
  await expect(posture.getByRole("radio", { name: "Não observado", checked: true })).toHaveCount(6);
  await expect(posture.getByRole("checkbox", { checked: true })).toHaveCount(0);

  // Findings that may coexist are several; the neutral one stands alone.
  const shoulders = posture.getByRole("group", { name: "Ombros (visão lateral)" });
  await expect(shoulders).toHaveAccessibleDescription("Pode marcar mais de um");
  await shoulders.getByRole("checkbox", { name: "Protusos" }).check();
  await shoulders.getByRole("checkbox", { name: "Rotação interna" }).check();
  await expect(shoulders.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await shoulders.getByRole("checkbox", { name: "Alinhados" }).check();
  await expect(shoulders.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await shoulders.getByRole("checkbox", { name: "Protusos" }).check();
  await expect(shoulders.getByRole("checkbox", { name: "Alinhados" })).not.toBeChecked();
  const hip = posture.getByRole("radiogroup", { name: "Quadril (visão lateral)" });
  await hip.getByRole("radio", { name: "Retroversão" }).check();
  await hip.getByRole("radio", { name: "Anteversão" }).check();
  await expect(view(page, "Lateral")).toHaveText("Lateral · 2 de 8");
  // "Não observado" takes a choice back.
  const knees = posture.getByRole("radiogroup", { name: "Joelhos (visão lateral)" });
  await knees.getByRole("radio", { name: "Flexo" }).check();
  await expect(view(page, "Lateral")).toHaveText("Lateral · 3 de 8");
  await knees.getByRole("radio", { name: "Não observado" }).check();
  await expect(view(page, "Lateral")).toHaveText("Lateral · 2 de 8");
  expect(await findingsAligned(page, "Avaliação postural")).toBe(true);
  await noHorizontalOverflow(page);

  // The arrow keys move between the views (the ARIA tab pattern).
  await view(page, "Lateral").focus();
  await page.keyboard.press("ArrowRight");
  await expect(view(page, "Posterior")).toHaveAttribute("aria-selected", "true");
  await expect(view(page, "Posterior")).toBeFocused();
  await posture.getByRole("group", { name: "Escápulas (visão posterior)" }).getByRole("checkbox", { name: "Esquerda alada" }).check();
  await posture.getByRole("radiogroup", { name: "Inclinação da cabeça (visão posterior)" }).getByRole("radio", { name: "Sem desvio observado" }).check();
  await posture.getByLabel("Observações da visão posterior").fill("Escápula esquerda mais afastada");
  expect(await findingsAligned(page, "Avaliação postural")).toBe(true);
  await view(page, "Anterior").click();
  await posture.getByRole("radiogroup", { name: "EIAS (visão anterior)" }).getByRole("radio", { name: "Direita deprimida" }).check();
  await expect(posture.getByRole("tab")).toHaveText(["Lateral · 2 de 8", "Posterior · 2 de 7", "Anterior · 1 de 4"]);

  // The somatotype is the professional's record: the components together, "Misto" alone; the Heath-Carter measures are kept, never computed.
  const somatotype = page.getByRole("region", { name: "Somatotipo" });
  const labels = somatotype.getByRole("group", { name: "Somatotipo" });
  await labels.getByRole("checkbox", { name: "Endomorfo" }).check();
  await labels.getByRole("checkbox", { name: "Mesomorfo" }).check();
  await labels.getByRole("checkbox", { name: "Misto" }).check();
  await expect(labels.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await labels.getByRole("checkbox", { name: "Endomorfo" }).check();
  await labels.getByRole("checkbox", { name: "Mesomorfo" }).check();
  await expect(labels.getByRole("checkbox", { name: "Misto" })).not.toBeChecked();
  await expect(somatotype.getByText(/não é calculado nesta versão/)).toBeVisible();
  const supraspinale = somatotype.getByLabel("Dobra supraespinhal (mm)");
  await expect(supraspinale).toHaveAttribute("placeholder", "Sem aferição");
  // A 0 is named, never stored; the rest still saves.
  await supraspinale.fill("0");
  const quietProblem = page.getByRole("status").filter({ hasText: "Confira o campo Dobra supraespinhal" });
  await expect(quietProblem).toBeVisible({ timeout: BY_ITSELF });
  await supraspinale.fill("8,5");
  await expect(quietProblem).toHaveCount(0);
  await expect(page.locator(".av2-cards")).not.toContainText(/significativ|normal|\bbom\b|ruim|excelente/i);
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  const { lines } = await linesOf(page, "Somatotipo");
  expect(lines.every((line) => line.aligned)).toBe(true);
  if (wide) expect(lines.map((line) => line.fields)).toEqual([1, 2]);
  await noHorizontalOverflow(page);

  // Nobody clicks "Salvar rascunho": it saves itself, and a reload brings everything back on the same step.
  await expect(savedLine(page)).toBeVisible({ timeout: BY_ITSELF });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Postura e movimento" })).toBeVisible();
  await expect(posture.getByRole("tab")).toHaveText(["Lateral · 2 de 8", "Posterior · 2 de 7", "Anterior · 1 de 4"]);
  await expect(shoulders.getByRole("checkbox", { name: "Protusos" })).toBeChecked();
  await expect(hip.getByRole("radio", { name: "Anteversão" })).toBeChecked();
  await expect(knees.getByRole("radio", { name: "Não observado" })).toBeChecked();
  await view(page, "Posterior").click();
  await expect(posture.getByRole("group", { name: "Escápulas (visão posterior)" }).getByRole("checkbox", { name: "Esquerda alada" })).toBeChecked();
  await expect(posture.getByLabel("Observações da visão posterior")).toHaveValue("Escápula esquerda mais afastada");
  await expect(labels.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(supraspinale).toHaveValue("8,5");
  await expect(somatotype.getByLabel("Perímetro do braço flexionado e contraído (cm)")).toHaveValue("");

  // The Revisão says what was observed per view and the somatotype as recorded; nothing of it is a result.
  await page.getByRole("navigation", { name: "Etapas da avaliação física" }).getByRole("button", { name: "4 Revisão" }).click();
  const checklist = page.getByRole("region", { name: "Checklist por etapa" });
  await expect(checklist.getByText("Postura: 5 de 19 regiões observadas (lateral 2 de 8, posterior 2 de 7, anterior 1 de 4)")).toBeVisible();
  await expect(checklist.getByText("Somatotipo (registro do profissional): Endomorfo e Mesomorfo")).toBeVisible();
  await expect(checklist.getByText("Medidas para Heath-Carter guardadas, sem cálculo: dobra supraespinhal")).toBeVisible();
  await expect(checklist.getByText("Com registro")).toBeVisible();
  await expect(page.getByText("Nenhum resultado calculável com o que foi medido.")).toBeVisible();
});
