import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import {
  expectNoTermsBox, addStudent,
  createProfessional,
  localIP,
  newActor,
  noHorizontalOverflow,
  openInvitation,
} from "./helpers";

test("a student downloads a copy of what the tool shows them, and nobody else can get it", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da cópia");
  await addStudent(page, "Aluna da cópia");
  const { client, email } = await openInvitation(page, browser, baseURL, "Aluna da cópia");
  const me = client.page;
  await expectNoTermsBox(me);
  await me.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(me).toHaveURL(/\/aluno\/?$/);

  // Something of the student's own to find in the file.
  await me.goto("./aluno/check-in");
  const form = me.locator("form", { has: me.getByText("Como você está hoje") });
  await form.getByLabel(/Esforço percebido nos últimos dias/).selectOption("6");
  await form.getByLabel("Observações").fill("Marcador da cópia.");
  await form.getByRole("button", { name: "Salvar check-in" }).click();
  await expect(me.getByText("Check-in salvo. Você pode corrigi-lo ainda hoje.")).toBeVisible();

  // The account says what the file holds and what it does not, and where to ask for the rest.
  await me.goto("./aluno/conta");
  const panel = me.locator("#baixar");
  await expect(panel.getByRole("heading", { name: "Baixar uma cópia dos meus dados" })).toBeVisible();
  await expect(panel.getByText("A cópia traz:")).toBeVisible();
  await expect(panel.getByText("Os seus check-ins.")).toBeVisible();
  await expect(panel.getByText("Ela não traz:")).toBeVisible();
  await expect(panel.getByText("A ficha e as avaliações feitas pelo seu profissional.")).toBeVisible();
  await expect(panel.getByText("nunca o conteúdo", { exact: false })).toBeVisible();
  await noHorizontalOverflow(me);

  // The download is a file named with the day, in JSON, with this student's own data.
  const [download] = await Promise.all([me.waitForEvent("download"), panel.getByRole("link", { name: "Baixar em JSON" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^meus-dados-\d{4}-\d{2}-\d{2}\.json$/);
  const copy = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(copy.formato).toBe("meus-dados/1");
  expect(copy.conta).toEqual({ nome: "Aluna da cópia", email });
  // Joining no longer records an acceptance (nothing to tick), so the copy lists none.
  expect(copy.aceites).toHaveLength(0);
  expect(copy.vinculos).toHaveLength(1);
  expect(copy.vinculos[0]).toMatchObject({ organizacao: "Estúdio da cópia", aluno: "Aluna da cópia" });
  expect(copy.vinculos[0].checkIns.registros).toEqual([
    expect.objectContaining({ esforco: 6, observacoes: "Marcador da cópia.", desconforto: false, lidoPeloProfissional: false }),
  ]);
  expect(copy.sobreEsteArquivo.naoIncluido.join(" ")).toContain("ficha e as avaliações");

  // The answer is not stored by the browser, and says what it is.
  const again = await me.request.get("./aluno/conta/meus-dados");
  expect(again.status()).toBe(200);
  expect(again.headers()["content-type"]).toContain("application/json");
  expect(again.headers()["cache-control"]).toContain("no-store");
  expect(again.headers()["content-disposition"]).toMatch(/^attachment; filename="meus-dados-/);
  expect(again.headers()["x-content-type-options"]).toBe("nosniff");

  // Someone who is not signed in, and the professional (who has no student login), get no file.
  const stranger = await newActor(browser, baseURL);
  const anonymous = await stranger.page.request.get("./aluno/conta/meus-dados");
  expect(anonymous.headers()["content-type"] ?? "").not.toContain("application/json");
  expect(await anonymous.text()).not.toContain("Marcador da cópia.");
  const professional = await page.request.get("./aluno/conta/meus-dados");
  expect(professional.headers()["content-type"] ?? "").not.toContain("application/json");
  expect(await professional.text()).not.toContain("Marcador da cópia.");
  await stranger.context.close();

  // The hourly limit holds: two copies were made, four more fit, the next one waits.
  for (let n = 0; n < 4; n++) expect((await me.request.get("./aluno/conta/meus-dados")).status()).toBe(200);
  const refused = await me.request.get("./aluno/conta/meus-dados");
  expect(refused.status()).toBe(429);
  expect(await refused.text()).toContain("Você já baixou os seus dados várias vezes na última hora");
  await client.context.close();
});

test("a student reads the same copy on screen and downloads it as a PDF", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio da cópia legível");
  await addStudent(page, "Aluna da cópia legível");
  const { client } = await openInvitation(page, browser, baseURL, "Aluna da cópia legível");
  const me = client.page;
  await expectNoTermsBox(me);
  await me.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(me).toHaveURL(/\/aluno\/?$/);

  await me.goto("./aluno/check-in");
  const form = me.locator("form", { has: me.getByText("Como você está hoje") });
  await form.getByLabel(/Esforço percebido nos últimos dias/).selectOption("6");
  await form.getByLabel("Observações").fill("Marcador da cópia legível.");
  await form.getByRole("button", { name: "Salvar check-in" }).click();
  await expect(me.getByText("Check-in salvo. Você pode corrigi-lo ainda hoje.")).toBeVisible();

  // From Minha conta, the three formats sit side by side; the page opens under the app's own address.
  await me.goto("./aluno/conta");
  const panel = me.locator("#baixar");
  await expect(panel.getByText("As três trazem o mesmo conteúdo.", { exact: false })).toBeVisible();
  await panel.getByRole("link", { name: "Ver na tela" }).click();
  await expect(me).toHaveURL(/\/aluno\/conta\/meus-dados\/ver$/);
  await expect(me.getByRole("heading", { level: 1, name: "Cópia dos meus dados" })).toBeVisible();
  // The same warning as the panel of Minha conta and the footer of the PDF.
  await expect(me.getByText("A cópia tem dados de saúde: guarde-a em um lugar seguro.", { exact: false })).toBeVisible();
  const index = me.getByRole("navigation", { name: "Seções da cópia" });
  for (const name of ["Sobre esta cópia", "Seus dados de acesso", "Check-ins", "Treinos que você registrou", "Treino entregue", "Pedidos sobre os seus dados"])
    await expect(index.getByRole("link", { name, exact: true })).toBeVisible();
  const checkins = me.locator("#check-ins");
  await expect(checkins.getByText("Esforço percebido", { exact: true })).toBeVisible();
  await expect(checkins.getByText("6 de 10")).toBeVisible();
  await expect(checkins.getByText("Marcador da cópia legível.")).toBeVisible();
  // An empty answer is written out, never shown as 0.
  await expect(checkins.locator("dd", { hasText: /^Não informado$/ })).toHaveCount(1);
  await expect(me.locator("#treinos-registrados").getByText("Nenhum treino registrado.")).toBeVisible();
  await expect(me.locator("#sobre").getByText("A ficha e as avaliações feitas pelo seu profissional.")).toBeVisible();
  await noHorizontalOverflow(me);

  // The PDF carries the same copy, with the day in its name.
  const [download] = await Promise.all([me.waitForEvent("download"), me.getByRole("link", { name: "Baixar em PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^meus-dados-\d{4}-\d{2}-\d{2}\.pdf$/);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const pdf = await me.request.get("./aluno/conta/meus-dados/pdf");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["cache-control"]).toContain("no-store");
  expect(pdf.headers()["content-disposition"]).toMatch(/^attachment; filename="meus-dados-.*\.pdf"$/);

  // The back link returns to the panel, under any mount.
  await me.goto("./aluno/conta/meus-dados/ver");
  await me.getByRole("link", { name: "Voltar à Minha conta" }).click();
  await expect(me).toHaveURL(/\/aluno\/conta#baixar$/);

  // Page, PDF and JSON share one allowance: four generated so far, two more fit, then the page says to wait.
  for (let n = 0; n < 2; n++) expect((await me.request.get("./aluno/conta/meus-dados/pdf")).status()).toBe(200);
  expect((await me.request.get("./aluno/conta/meus-dados/pdf")).status()).toBe(429);
  await me.goto("./aluno/conta/meus-dados/ver");
  await expect(me.getByText("Você já gerou a cópia dos seus dados várias vezes na última hora.")).toBeVisible();
  await expect(me.getByText("Marcador da cópia legível.")).toHaveCount(0);

  // Nobody else reads it: neither a visitor nor the professional.
  const stranger = await newActor(browser, baseURL);
  for (const path of ["./aluno/conta/meus-dados/ver", "./aluno/conta/meus-dados/pdf"]) {
    const response = await stranger.page.request.get(path);
    expect(response.headers()["content-type"] ?? "").not.toContain("application/pdf");
    expect(await response.text()).not.toContain("Marcador da cópia legível.");
    const professional = await page.request.get(path);
    expect(professional.headers()["content-type"] ?? "").not.toContain("application/pdf");
    expect(await professional.text()).not.toContain("Marcador da cópia legível.");
  }
  await stranger.context.close();
  await client.context.close();
});
