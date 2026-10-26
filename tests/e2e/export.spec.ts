import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import {
  acceptStudentTerms,
  addStudent,
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
  await acceptStudentTerms(me);
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
  await expect(panel.getByText("O arquivo traz:")).toBeVisible();
  await expect(panel.getByText("Os seus check-ins.")).toBeVisible();
  await expect(panel.getByText("Ele não traz:")).toBeVisible();
  await expect(panel.getByText("A ficha e as avaliações feitas pelo seu profissional.")).toBeVisible();
  await expect(panel.getByText("nunca o conteúdo", { exact: false })).toBeVisible();
  await noHorizontalOverflow(me);

  // The download is a file named with the day, in JSON, with this student's own data.
  const [download] = await Promise.all([me.waitForEvent("download"), panel.getByRole("link", { name: "Baixar meus dados" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^meus-dados-\d{4}-\d{2}-\d{2}\.json$/);
  const copy = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(copy.formato).toBe("meus-dados/1");
  expect(copy.conta).toEqual({ nome: "Aluna da cópia", email });
  expect(copy.aceites).toHaveLength(1);
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
