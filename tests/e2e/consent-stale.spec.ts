import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import {
  acceptProfessionalTerms,
  acceptStudentTerms,
  addStudent,
  createProfessional,
  localIP,
  openInvitation,
} from "./helpers";

/**
 * This scenario runs alone, after every other one (see the `consent-stale` project): it has to write
 * to the LOCAL database from outside the running worker, and a write from another process while the
 * other scenarios read can make the local worker answer a request with a server error. Measured: one
 * page in about seventy under that write, none in over a hundred and seventy without it. The
 * application is not involved; production never has a second process on the database.
 */
/** Local database only: the test makes an acceptance stale by adding a newer, older-version row. */
function makeAcceptanceStale(email: string, audience: "STUDENT" | "PROFESSIONAL") {
  const sql = `INSERT INTO consent_acceptances (id, user_id, audience, terms_version, terms_sha256, photos_authorized, accepted_at)
    SELECT lower(hex(randomblob(16))), id, '${audience}', '2020-01-01-versao-antiga', '${"a".repeat(64)}', 0, '${new Date().toISOString()}'
    FROM auth_user WHERE email = '${email}'`;
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", sql], {
    stdio: "ignore",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}


test("a stale acceptance sends each person to accept again, and only to the area they really have", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const proEmail = await createProfessional(page, "Estúdio da versão");
  await addStudent(page, "Aluno da versão");
  const { client, email: clientEmail } = await openInvitation(page, browser, baseURL, "Aluno da versão");
  await acceptStudentTerms(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);

  // A new version of the text is a newer row of an older version: the next access asks again.
  makeAcceptanceStale(clientEmail, "STUDENT");
  await client.page.goto("./aluno/treino");
  await expect(client.page).toHaveURL(/\/aceite\?area=aluno/);
  await expect(client.page.getByRole("heading", { name: "Leia e aceite os termos." })).toBeVisible();
  await expect(client.page.getByRole("region", { name: "Termos e aviso de privacidade do aluno" })).toBeVisible();
  // Nothing of the area is reachable meanwhile, and the page cannot be used to get in without ticking.
  await client.page.goto("./aluno");
  await expect(client.page).toHaveURL(/\/aceite\?area=aluno/);
  await client.page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(client.page).toHaveURL(/\/aceite\?area=aluno/);
  await acceptStudentTerms(client.page);
  await client.page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);
  await client.page.goto("./aluno/treino");
  await expect(client.page.getByRole("heading", { name: "Treino atual" })).toBeVisible();

  // The professional is asked the same way, and the address of the acceptance page grants no area.
  makeAcceptanceStale(proEmail, "PROFESSIONAL");
  await page.goto("./profissional/alunos");
  await expect(page).toHaveURL(/\/aceite\?area=profissional/);
  await page.goto("./aceite?area=aluno");
  await expect(page).not.toHaveURL(/\/aceite\?area=aluno/);
  await page.goto("./aceite?area=profissional");
  await acceptProfessionalTerms(page);
  await page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(page).toHaveURL(/\/profissional\/?$/);
  await page.goto("./profissional/alunos");
  await expect(page.getByRole("heading", { name: "Alunos" })).toBeVisible();
  await client.context.close();
});
