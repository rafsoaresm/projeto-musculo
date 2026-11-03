import { test, expect, type Page } from "@playwright/test";
import { addStudent, createProfessional, localIP, showStudentTab } from "./helpers";
import { PARQ } from "../../src/modules/avaliacoes/catalog";

// TEMPORARY (slice 0.79 visual check): screenshots of the Movimento step, the Revisão and the record at five widths. Removed before finishing.
const DIR = "/tmp/claude-0/-home-user-projeto-musculo/437756eb-90b4-5954-a2ec-e4bf8a130c76/scratchpad/av2-p1";
const step = (page: Page, name: string) => page.getByRole("navigation", { name: "Etapas da avaliação física" }).getByRole("button", { name });

async function shoot(page: Page, name: string, prefix: string) {
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${DIR}/${prefix}-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("screenshots of slice 0.79", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  test.setTimeout(240_000);
  const prefix = process.env.BASE_URL ? "0.79b" : "079";
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio das capturas");
  await addStudent(page, "Aluno das capturas");
  await showStudentTab(page, "Avaliação Física");
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Triagem e segurança" })).toBeVisible();
  for (const text of Object.values(PARQ)) await page.getByRole("radiogroup", { name: text, exact: true }).getByRole("radio", { name: "Não", exact: true }).check();
  await step(page, "3 Movimento").click();
  const posture = page.getByRole("region", { name: "Avaliação postural" });
  const shoulders = posture.getByRole("group", { name: "Ombros (visão lateral)" });
  await shoulders.getByRole("checkbox", { name: "Protusos" }).check();
  await shoulders.getByRole("checkbox", { name: "Rotação interna" }).check();
  await posture.getByRole("radiogroup", { name: "Quadril (visão lateral)" }).getByRole("radio", { name: "Anteversão" }).check();
  await posture.getByRole("radiogroup", { name: "Lordose cervical (visão lateral)" }).getByRole("radio", { name: "Aumentada" }).check();
  await posture.getByRole("group", { name: "Pés (visão lateral)" }).getByRole("checkbox", { name: "Cavo" }).check();
  await posture.getByLabel("Observações da visão lateral").fill("Ombro direito mais protuso que o esquerdo");
  const somatotype = page.getByRole("region", { name: "Somatotipo" });
  await somatotype.getByRole("checkbox", { name: "Endomorfo" }).check();
  await somatotype.getByRole("checkbox", { name: "Mesomorfo" }).check();
  await somatotype.getByLabel("Dobra supraespinhal (mm)").fill("8,5");
  await shoot(page, "movimento-lateral", prefix);
  await posture.getByRole("tab", { name: /^Posterior/ }).click();
  await posture.getByRole("group", { name: "Escápulas (visão posterior)" }).getByRole("checkbox", { name: "Esquerda alada" }).check();
  await posture.getByRole("group", { name: "Coluna (visão posterior)" }).getByRole("checkbox", { name: "Alinhada" }).check();
  await posture.getByRole("radiogroup", { name: "Inclinação da cabeça (visão posterior)" }).getByRole("radio", { name: "Sem desvio observado" }).check();
  await shoot(page, "movimento-posterior", prefix);
  await posture.getByRole("tab", { name: /^Anterior/ }).click();
  await posture.getByRole("radiogroup", { name: "EIAS (visão anterior)" }).getByRole("radio", { name: "Direita deprimida" }).check();
  await shoot(page, "movimento-anterior", prefix);
  await step(page, "4 Revisão").click();
  await expect(page.getByText("Nada pendente: a avaliação pode ser finalizada.")).toBeVisible();
  await shoot(page, "revisao", prefix);
  await page.getByRole("button", { name: "Finalizar avaliação" }).click();
  await page.getByRole("button", { name: "Confirmar e finalizar" }).click();
  await expect(page.getByRole("heading", { name: /^Avaliação física de \d{2}\/\d{2}\/\d{4}$/, level: 1 })).toBeVisible();
  await shoot(page, "registro", prefix);
});
