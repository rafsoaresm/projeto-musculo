import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import {
  expectNoTermsBox, addStudent,
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
/** Local database only: adds a newer row of an older version, which used to make the person accept again. */
function makeAcceptanceStale(email: string, audience: "STUDENT" | "PROFESSIONAL") {
  const sql = `INSERT INTO consent_acceptances (id, user_id, audience, terms_version, terms_sha256, photos_authorized, accepted_at)
    SELECT lower(hex(randomblob(16))), id, '${audience}', '2020-01-01-versao-antiga', '${"a".repeat(64)}', 0, '${new Date().toISOString()}'
    FROM auth_user WHERE email = '${email}'`;
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", sql], {
    stdio: "ignore",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}


test("an acceptance of an older version sends nobody to accept again: the areas open, and the terms page only shows what was recorded", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  const proEmail = await createProfessional(page, "Estúdio da versão");
  await addStudent(page, "Aluno da versão");
  const { client, email: clientEmail } = await openInvitation(page, browser, baseURL, "Aluno da versão");
  await expectNoTermsBox(client.page);
  await client.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);

  // A row of an older version of the text (the old way to ask again): the next access is not stopped.
  makeAcceptanceStale(clientEmail, "STUDENT");
  await client.page.goto("./aluno/treino");
  await expect(client.page).not.toHaveURL(/\/aceite/);
  await expect(client.page.getByRole("heading", { name: "Treino atual" })).toBeVisible();
  await client.page.goto("./aluno");
  await expect(client.page).toHaveURL(/\/aluno\/?$/);
  // The terms page is for reading: what was recorded, the text in force, and the way back; no button of acceptance.
  await client.page.goto("./aceite?area=aluno");
  await expect(client.page.getByRole("heading", { name: "Termos de uso", exact: true })).toBeVisible();
  await expect(client.page.getByText(/Você registrou o aceite da versão 2020-01-01-versao-antiga/)).toBeVisible();
  await expect(client.page.getByRole("region", { name: "Termos e aviso de privacidade do aluno" })).toBeVisible();
  await expect(client.page.getByRole("button", { name: "Aceitar e continuar" })).toHaveCount(0);
  await expectNoTermsBox(client.page);
  await client.page.getByRole("link", { name: "Voltar" }).click();
  await expect(client.page).toHaveURL(/\/aluno\/?$/);

  // The professional is not stopped either, and the address of the terms page still grants no area.
  makeAcceptanceStale(proEmail, "PROFESSIONAL");
  await page.goto("./profissional/alunos");
  await expect(page).not.toHaveURL(/\/aceite/);
  await expect(page.getByRole("heading", { name: "Alunos" })).toBeVisible();
  await page.goto("./aceite?area=aluno");
  await expect(page).not.toHaveURL(/\/aceite\?area=aluno/);
  await page.goto("./aceite?area=profissional");
  await expect(page.getByRole("heading", { name: "Termos de uso", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar e continuar" })).toHaveCount(0);
  await client.context.close();
});
