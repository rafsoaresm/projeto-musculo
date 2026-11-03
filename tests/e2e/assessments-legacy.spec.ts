import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { addStudent, createProfessional, localIP, noHorizontalOverflow, readyPlan, showStudentTab } from "./helpers";

/**
 * The earlier format of the assessment can no longer be started, filled or recorded (user's decision of 03/11/2026: only the Avaliação
 * Física). Its records exist in production and stay: readable in the history under their own name, an unreviewed alert among them still holds
 * a plan approval until the professional reviews it, and an open draft of it can only be discarded. No screen can make such rows any more, so
 * this scenario writes them to the LOCAL database from outside the worker, as the application wrote them until 0.73; like `consent-stale`, it
 * runs alone, after the other scenarios (project `assessments-legacy`), because a write from another process while others read can make the
 * local worker answer a request with a server error. Production never has a second process on the database.
 */
// One after the other in one worker: two writers on the local database at once can lock each other.
test.describe.configure({ mode: "default" });

function sql(command: string) {
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", command], {
    stdio: "ignore",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
const studentIdOf = (url: string) => new URL(url).pathname.split("/").filter(Boolean).at(-1)!;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const brazilian = (iso: string) => iso.split("-").reverse().join("/");
const ALL_ANSWERED = `'["exertionPain","dizzinessFainting","chestPain","injuryInTreatment","recentSurgery","medicalRestriction"]'`;

/** A recorded assessment of the earlier format with the chest pain marked (an alert) and a waist of 80 cm, as 0.60 to 0.73 recorded it. */
function recordedAlert(email: string, studentURL: string, id: string, assessedOn: string) {
  const student = quote(studentIdOf(studentURL));
  const who = `(SELECT id FROM auth_user WHERE email = ${quote(email)})`;
  const org = `(SELECT organization_id FROM students WHERE id = ${student})`;
  sql(
    `INSERT INTO assessments (id, organization_id, student_id, assessed_on, kind, state, chest_pain, screening_notes, risk_status, created_by_user_id, screening_answered)
       VALUES ('${id}', ${org}, ${student}, '${assessedOn}', 'INITIAL', 'DRAFT', 1, 'Relatou aperto no peito ao subir escada', 'REVIEW_REQUIRED', ${who}, ${ALL_ANSWERED});
     INSERT INTO assessment_metrics (id, organization_id, assessment_id, metric_type, name, value_text, value_number, unit, position)
       VALUES ('${id}-m1', ${org}, '${id}', 'WAIST', 'Cintura', '80', 80, 'cm', 1);
     UPDATE assessments SET state = 'RECORDED', recorded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), recorded_by_user_id = ${who} WHERE id = '${id}';`,
  );
}

/** An open draft of the earlier format, as a professional could have left it before 0.74. */
function earlierDraft(email: string, studentURL: string, id: string) {
  const student = quote(studentIdOf(studentURL));
  sql(
    `INSERT INTO assessments (id, organization_id, student_id, assessed_on, kind, state, risk_status, created_by_user_id, screening_answered)
       VALUES ('${id}', (SELECT organization_id FROM students WHERE id = ${student}), ${student}, '${daysAgo(3)}', 'INITIAL', 'DRAFT', 'CLEAR',
         (SELECT id FROM auth_user WHERE email = ${quote(email)}), '[]');
     INSERT INTO assessment_metrics (id, organization_id, assessment_id, metric_type, name, value_text, value_number, unit, position)
       VALUES ('${id}-m1', (SELECT organization_id FROM students WHERE id = ${student}), '${id}', 'RESTING_HEART_RATE', 'Frequência cardíaca de repouso', '62', 62, 'bpm', 1);`,
  );
}

test("a recorded assessment of the earlier format stays readable under its own name, and its unreviewed alert holds the plan until reviewed", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const email = await createProfessional(page, "Estúdio do formato anterior");
  const studentURL = await addStudent(page, "Aluna do formato anterior");
  const revisionURL = await readyPlan(page, studentURL, "Plano do formato anterior");
  const id = crypto.randomUUID();
  const assessedOn = daysAgo(10);
  recordedAlert(email, studentURL, id, assessedOn);

  // The history names it apart from the Avaliação Física, and the next one is a reassessment of the new format.
  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  const item = page.getByRole("link", { name: `Avaliação (formato anterior) de ${brazilian(assessedOn)}` });
  await expect(item).toBeVisible();
  await expect(page.getByText("Revisão obrigatória", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar reavaliação física" })).toBeVisible();

  // The plan cannot be approved while the alert has no review, and says where to record it.
  await page.goto(revisionURL);
  await expect(page.getByText("Revisão obrigatória antes da entrega.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar revisão" })).toBeDisabled();
  await expect(page.getByLabel(/Confirmo que não há triagem registrada/)).toHaveCount(0);
  await page.getByRole("link", { name: "Registrar a revisão" }).click();

  // The record reads as it was recorded, and takes the review.
  await expect(page.getByRole("heading", { name: `Avaliação (formato anterior) de ${brazilian(assessedOn)}`, level: 1 })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Dor torácica relatada" }).first()).toBeVisible();
  await expect(page.getByText("Relatou aperto no peito ao subir escada")).toBeVisible();
  await expect(page.getByRole("cell", { name: "80 cm" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Salvar rascunho|Registrar avaliação/ })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.getByLabel("Base da sua revisão").fill("Liberação médica anexada ao prontuário da aluna");
  await page.getByRole("button", { name: "Registrar revisão" }).click();
  await expect(page.getByText("Revisão registrada.")).toBeVisible();
  await expect(page.getByText("Alerta com revisão registrada")).toBeVisible();

  // Reviewed: the plan is approved, recording that assessment, with no acknowledgement asked.
  await page.goto(revisionURL);
  await expect(page.getByText("Alerta da triagem com revisão registrada")).toBeVisible();
  await page.getByRole("button", { name: "Aprovar revisão" }).click();
  await expect(page.getByRole("heading", { name: "Entregar ao aluno" })).toBeVisible();

  // The evolution still reads it.
  await page.goto(`${studentURL}/evolucao`);
  await expect(page.getByText("1 avaliação registrada", { exact: false })).toBeVisible();
});

test("an open draft of the earlier format cannot be filled any more: it is discarded, and the Avaliação Física starts in its place", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const email = await createProfessional(page, "Estúdio do rascunho anterior");
  const studentURL = await addStudent(page, "Aluno do rascunho anterior");
  earlierDraft(email, studentURL, crypto.randomUUID());

  await page.goto(studentURL);
  await showStudentTab(page, "Avaliação Física");
  await expect(page.getByRole("link", { name: /^Rascunho do formato anterior de / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar avaliação física" })).toHaveCount(0);
  await page.getByRole("link", { name: "Abrir o rascunho do formato anterior" }).click();
  await expect(page.getByRole("heading", { name: "Rascunho do formato anterior de Aluno do rascunho anterior" })).toBeVisible();
  await expect(page.getByText("Ele não pode ser preenchido nem registrado.", { exact: false })).toBeVisible();
  // None of the earlier form is there.
  await expect(page.getByRole("button", { name: /Registrar avaliação|Salvar rascunho|Adicionar indicador/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Dor torácica relatada" })).toHaveCount(0);
  await noHorizontalOverflow(page);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação Física de Aluno do rascunho anterior" })).toBeVisible();
  await page.getByRole("button", { name: "Iniciar avaliação física" }).click();
  await expect(page.getByRole("heading", { name: "Avaliação física de Aluno do rascunho anterior" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Etapas da avaliação física" })).toBeVisible();
});
