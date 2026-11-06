import { test, expect } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow } from "./helpers";

// Motor V4, PR 3.3: the dose profiles (rules 2026.11.6) reached through the explicit opt-in of the generation form, on whichever mount
// the run uses. The existing proposal screens show different doses for a heavy compound and an isolation exercise of the same
// session, and "Por quê?" gives rule, profile, reasons and "Muda se". Without the opt-in the default rules keep one dose for all
// (covered by automatic-prescription.spec.ts, which never ticks the box).
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("dose profiles by opt-in: varied doses in the proposal and the dose 'Por quê?'", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio dos perfis de dose");
  const studentURL = await addStudent(page, "Aluno dos perfis");
  await page.goto(studentURL);
  await page.getByRole("tab", { name: "Periodização" }).or(page.getByRole("link", { name: "Periodização" })).first().click();
  await page.getByRole("link", { name: "Novo plano" }).click();
  await page.getByLabel("Nome do plano").fill("Plano com perfis");
  await page.getByLabel("Data de início").fill(yesterday());
  for (const phase of ["Fase 01", "Fase 02", "Fase 03"]) {
    await page.getByRole("group", { name: "Selecionar fase" }).getByRole("button", { name: phase }).click();
    await page.getByLabel("Divisão de treinos").selectOption("Full Body");
    await page.getByLabel("Alvo de exercícios por treino").selectOption("6");
  }
  await page.getByRole("button", { name: "Salvar e prescrever exercícios" }).click();
  await expect(page.getByRole("heading", { name: "Plano com perfis" })).toBeVisible();

  // The phone composition has other labels: walk this path at a desktop width (the phone screens are covered by capture elsewhere).
  const size = page.viewportSize();
  if (size && size.width < 861) await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Gerar prescrição automática" }).click();
  await expect(page.getByRole("heading", { name: /^Gerar prescrição/, level: 1 })).toBeVisible();
  for (const n of [1, 2, 3]) await page.getByLabel(`Estímulo principal da fase ${n}`).selectOption("HYPERTROPHY");
  const equipment = page.getByRole("group", { name: "Equipamentos disponíveis" });
  await equipment.getByRole("button", { name: "Ver lista completa de equipamentos" }).click();
  await equipment.getByRole("button", { name: "Marcar todos" }).click();
  await page.getByRole("button", { name: "Continuar para doses" }).click();
  await page.getByRole("button", { name: "Continuar para progressão" }).click();

  // The opt-in lives in the closed "Ajustes opcionais": unchecked by default.
  await page.locator("summary").filter({ hasText: "Ajustes opcionais (avançado)" }).click();
  const optIn = page.getByLabel("Usar perfis de dose (heurística a validar)");
  await expect(optIn).not.toBeChecked();
  await expect(page.getByText("ainda a validar pelo Técnico", { exact: false })).toBeVisible();
  await optIn.check();
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Gerar prescrição", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resumo da proposta" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Motor 2\.4\.0 · regras gymgital-base 2026\.11\.6/).first()).toBeVisible();

  // The first session: the same screen as always, with a dose per exercise that depends on the kind of exercise.
  const session = page.getByRole("region", { name: /^Semana 1, sessão 1, treino Full Body$/ });
  const rows = session.locator("tbody tr");
  await expect(rows).toHaveCount(6);
  const doses = (await rows.locator(".rx-cell-dose").allInnerTexts()).map((t) => t.trim());
  expect(new Set(doses).size).toBeGreaterThanOrEqual(2);
  expect(doses.every((t) => !/\bkg\b/i.test(t))).toBe(true);
  // The profile table is not the uniform 90 s of the default rules: at least one rest differs from 90 s.
  expect(doses.some((t) => /\b(60|75|120|150) ?s/.test(t))).toBe(true);

  // "Por quê?" of the dose of one exercise: rule, profile, reasons and what would change it.
  const panel = page.locator("aside.rx-exercise");
  await panel.locator(".why-details summary").first().click();
  const doseWhy = panel.getByRole("group", { name: "Por que esta dose" });
  await expect(doseWhy).toBeVisible();
  await expect(doseWhy.locator("[data-dose-why]")).toHaveCount(4);
  await expect(doseWhy.locator('[data-dose-why="rest"]')).toContainText("Regra: Perfis de dose · perfil HYP_");
  await expect(doseWhy.locator('[data-dose-why="rest"]')).toContainText("Motivos:");
  await expect(doseWhy.locator('[data-dose-why="rest"]')).toContainText("Muda se:");
  await expect(doseWhy.locator('[data-dose-why="sets"]')).toContainText("séries");
  await noHorizontalOverflow(page);

  // Another exercise of the same session shows its own profile (the dose differs where the kind of exercise differs).
  const texts: string[] = [];
  for (let n = 0; n < 6; n++) {
    const name = (await rows.nth(n).locator(".rx-name").innerText()).trim();
    await rows.nth(n).getByRole("button", { name: /^Revisar / }).click();
    await expect(panel.locator(".rx-panel-title")).toHaveText(name);
    const details = panel.locator(".why-details").first();
    if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
    texts.push((await panel.locator('[data-dose-why="rest"]').innerText()).replace(/\s+/g, " "));
  }
  expect(new Set(texts.map((t) => /· perfil ([A-Z_]+)/.exec(t)?.[1] ?? "generico")).size, texts.join(" || ")).toBeGreaterThanOrEqual(2);
});
