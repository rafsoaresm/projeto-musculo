import { expect, type Page } from "@playwright/test";
import { answerRequired, fillXintusPlan } from "./v4-flow";

/**
 * The AI path of the generation flow (Motor V4, PR 4.1), as one scenario of the gestor spec: the platform manager has just connected the simulated
 * provider, mapped the planner to it, enabled the professional's organization with a plan (ai-gestor.ts), so this runs on whichever mount the run uses.
 * Only the simulated provider answers (AI_MOCK_ENABLED): no real provider is contacted. The student needs a birth date (a minor, or an unknown age,
 * is planned by rules). The AI only suggests: the professional chooses, accepts at "Conferir blueprint" and generates; nothing is approved or delivered.
 */
export async function aiFlowScenario(pro: Page, studentName: string) {
  await pro.setViewportSize({ width: 1440, height: 900 });
  await pro.goto("./profissional/alunos");
  await pro.getByRole("link", { name: studentName }).first().click();
  await pro.waitForURL(/\/profissional\/alunos\/(?!novo)[^/?]+$/);
  await expect(pro.getByRole("heading", { name: studentName })).toBeVisible();
  const studentURL = pro.url();
  await pro.getByRole("link", { name: "Preencher a ficha", exact: true }).click();
  const born = new Date();
  born.setFullYear(born.getFullYear() - 30);
  await pro.getByLabel("Data de nascimento").fill(born.toISOString().slice(0, 10));
  await pro.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(pro.getByText("Ficha salva.")).toBeVisible();
  await fillXintusPlan(pro, studentURL);
  await pro.getByRole("link", { name: "Gerar prescrição automática" }).click();

  // GEN-01: the AI card is available and selected, with the read-only usage (tokens only) and the privacy notice.
  const modes = pro.getByRole("radiogroup", { name: "Modo de montagem" });
  await expect(modes.getByRole("radio", { name: /Assistida por IA/ })).toBeEnabled();
  await expect(modes.getByRole("radio", { name: /Assistida por IA/ })).toBeChecked();
  await expect(pro.getByText(/^Uso de IA neste mês: [\d.]+ de 100\.000 tokens$/)).toBeVisible();
  await expect(pro.getByText(/resumo codificado e anonimizado/)).toBeVisible();
  await expect(pro.getByText(/R\$|US\$|custo/i)).toHaveCount(0);
  await answerRequired(pro);
  await pro.getByRole("button", { name: "Continuar para estratégia" }).click();

  // GEN-02: strategies from the (simulated) planner, labelled as the AI's, never applied until the footer click.
  const list = pro.getByRole("radiogroup", { name: "Estratégias sugeridas" });
  await expect(list.getByText("Sugestão da IA").first()).toBeVisible({ timeout: 30_000 });
  await expect(pro.getByText("IA não aprova nem entrega")).toBeVisible();
  await expect(list.getByText("Recomendada")).toBeVisible();
  await pro.getByRole("button", { name: /^Usar / }).click();
  await expect(pro.getByRole("heading", { name: "Definir focos por fase", level: 1 })).toBeVisible();
  await expect(pro.getByText("A IA sugere. A geração só começa depois de aceitar esta organização.").first()).toBeVisible();
  await pro.getByRole("button", { name: "Conferir blueprint" }).click();
  await expect(pro.getByRole("heading", { name: "Revisar e gerar", level: 1 })).toBeVisible();
  await expect(pro.getByText("Estrutura proposta pela IA; os cálculos e exercícios ainda serão validados pelo motor.").first()).toBeVisible();
  await pro.getByRole("button", { name: "Gerar proposta" }).click();
  await expect(pro.getByRole("region", { name: "Resumo da proposta" })).toBeVisible({ timeout: 90_000 });
}
