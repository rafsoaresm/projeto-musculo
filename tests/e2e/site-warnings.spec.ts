import { test, expect } from "@playwright/test";
import { createProfessional, localIP, newActor } from "./helpers";
import { addAtEnd, closeEditor, editor, inspector, openEditor, panel, state, showTab, asLegacySite } from "./site-helpers";

test("warnings do not stop a publication: the page goes live with 'Publicar mesmo assim', a testimony needs no authorization mark", async ({ page, browser, baseURL }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const unique = crypto.randomUUID().slice(0, 8);
  await createProfessional(page, `Estúdio ${unique}`, "Marina Avisos");
  const slug = `estudio-${unique}`;

  await page.goto("./profissional/meu-site");
  await page.getByRole("button", { name: "Escolher Editor Guiado" }).click();
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("radio", { name: /^Uma página só/ }).check();
  await page.getByRole("form", { name: "Criar o meu site" }).getByRole("button", { name: "Confirmar e criar site" }).click();
  await expect(page.getByRole("heading", { name: "Meu Site", level: 1 })).toBeVisible();
  await asLegacySite(page, slug);
  await showTab(page, "Publicação");
  await expect(state(page).getByText("Fora do ar")).toBeVisible();

  // From the state of the site: the loose ends are warnings, with the way out beside them. Nothing is live until the choice is made.
  await showTab(page, "Publicação");
  await state(page).getByRole("button", { name: "Publicar", exact: true }).click();
  await showTab(page, "Publicação");
  await expect(state(page).getByRole("list", { name: "Avisos antes de publicar" })).toContainText("WhatsApp");
  await showTab(page, "Publicação");
  await expect(state(page).getByRole("list", { name: "O que falta para publicar" })).toHaveCount(0);
  await showTab(page, "Publicação");
  await expect(state(page).getByText("Fora do ar")).toBeVisible();
  const anonymous = await newActor(browser, baseURL);
  expect((await anonymous.page.request.get(`./s/${slug}`)).status()).toBe(404);

  await showTab(page, "Publicação");
  await state(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await showTab(page, "Publicação");
  await expect(state(page).getByText("Publicado: o site está no ar na versão 1.")).toBeVisible();
  await showTab(page, "Publicação");
  await expect(state(page).getByText("No ar", { exact: true })).toBeVisible();
  await showTab(page, "Publicação");
  await expect(state(page).getByRole("list", { name: "Avisos antes de publicar" })).toHaveCount(0);
  await anonymous.page.goto(`./s/${slug}`);
  await expect(anonymous.page.getByRole("heading", { level: 1 })).toBeVisible();

  // From the editor: a testimony needs no authorization mark; only warnings are left, and the editor offers to publish anyway.
  await openEditor(page);
  await addAtEnd(page, "Depoimento");
  await panel(page, "Propriedades");
  await inspector(page).getByLabel("Depoimento", { exact: true }).fill("Treino que cabe na rotina.");
  await inspector(page).getByLabel("Quem deu o depoimento").fill("Ana, aluna");
  await expect(inspector(page).getByText("Tenho a autorização da pessoa para publicar este depoimento.")).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(editor(page).getByText("Rascunho salvo.")).toBeVisible();
  await editor(page).getByRole("button", { name: "Publicar nova versão", exact: true }).click();
  await expect(editor(page).getByRole("list", { name: "O que falta para publicar" })).toHaveCount(0);
  await expect(editor(page).getByRole("list", { name: "Avisos antes de publicar" })).toContainText("WhatsApp");
  await expect(editor(page).getByRole("list", { name: "Avisos antes de publicar" })).not.toContainText("autoriz");
  await editor(page).getByRole("button", { name: "Publicar mesmo assim" }).click();
  await expect(editor(page).getByText("Publicado: o site está no ar na versão 2.")).toBeVisible();
  await closeEditor(page);
  await anonymous.page.reload();
  await expect(anonymous.page.getByText("Treino que cabe na rotina.")).toBeVisible();
  await anonymous.context.close();
});
