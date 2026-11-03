import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, showStudentTab } from "./helpers";
import { ANAMNESIS, PARQ } from "../../src/modules/avaliacoes/catalog";

const OUT = "/tmp/claude-0/-home-user-projeto-musculo/437756eb-90b4-5954-a2ec-e4bf8a130c76/scratchpad/av2-core";
const q = (page: Page, text: string) => page.getByRole("radiogroup", { name: text, exact: true });

test("shots 0.76 triagem", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das capturas da triagem");
  await addStudent(page, "Aluno das capturas da triagem");
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${OUT}/076-vazia-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("checkbox", { name: "Hipertrofia" }).check();
  await page.getByRole("checkbox", { name: "Emagrecimento" }).check();
  await q(page, ANAMNESIS.injuries).getByRole("radio", { name: "Sim" }).check();
  await page.getByLabel(`Descrição de “${ANAMNESIS.injuries}”`).fill("Entorse no tornozelo direito em 2024");
  await q(page, ANAMNESIS.family_diseases).getByRole("radio", { name: "Não", exact: true }).check();
  await page.getByLabel("Pratica?").selectOption("yes");
  await page.getByRole("region", { name: "Atividade física atual" }).getByLabel("Atividades").fill("Musculação e corrida");
  await page.getByLabel("Frequência (por semana)").fill("3");
  await page.getByLabel("Duração/tempo de prática").fill("60 min por sessão, há 2 anos");
  for (const text of Object.values(PARQ)) await q(page, text).getByRole("radio", { name: "Não", exact: true }).check();
  await q(page, PARQ.dizziness).getByRole("radio", { name: "Sim" }).check();
  await page.getByRole("radio", { name: "Precisa de liberação médica" }).check();
  await page.getByLabel("Nota da decisão").fill("Encaminhado ao cardiologista antes de treinos intensos.");
  await expect(page.locator(".av2-status")).toHaveText(/Salvo às/, { timeout: 15_000 });
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${OUT}/076-triagem-${width}.png`, fullPage: true });
  }
});
