import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  addStudent,
  createProfessional,
  newActor,
  signUp,
  uniqueEmail,
} from "./helpers";

function setupToken() {
  const fromEnv = process.env.E2E_PLATFORM_SETUP_TOKEN;
  if (fromEnv) return fromEnv;
  const match = readFileSync(".dev.vars", "utf8").match(
    /^PLATFORM_SETUP_TOKEN=(.+)$/m,
  );
  if (!match) throw new Error("PLATFORM_SETUP_TOKEN missing: run npm run auth:setup:local");
  return match[1];
}

test("the platform manager is activated once and manages organizations without seeing students", async ({
  browser,
  baseURL,
}) => {
  // A professional with an organization and a student that must stay private.
  // Unique names: the local database keeps organizations from earlier runs.
  const studio = `Estúdio do gestor ${crypto.randomUUID().slice(0, 8)}`;
  const person = `Profissional ${crypto.randomUUID().slice(0, 8)}`;
  const pro = await newActor(browser, baseURL);
  const proEmail = await createProfessional(pro.page, studio, person);
  await addStudent(pro.page, "Aluno confidencial gestor");

  // The manager signs up like anyone and activates with the operator token.
  const manager = await newActor(browser, baseURL);
  await signUp(
    manager.page,
    "Gestão E2E",
    uniqueEmail("mgr"),
    "./cadastro?area=gestor",
  );
  await expect(
    manager.page.getByRole("heading", { name: "Ative a gestão da plataforma." }),
  ).toBeVisible();
  await manager.page.getByLabel("Código de ativação").fill("x".repeat(40));
  await manager.page.getByRole("button", { name: "Ativar como gestor" }).click();
  await expect(manager.page.getByText("Código inválido.")).toBeVisible();
  await manager.page.getByLabel("Código de ativação").fill(setupToken());
  await manager.page.getByRole("button", { name: "Ativar como gestor" }).click();
  await expect(
    manager.page.getByRole("heading", { name: "Quem contratou a ferramenta." }),
  ).toBeVisible();

  // Organizations are listed; students are only counted, never named.
  await manager.page.goto("./gestor/organizacoes");
  await expect(manager.page.getByText(studio, { exact: true })).toBeVisible();
  await manager.page
    .getByRole("link", { name: `Ver detalhes de ${studio}` })
    .click();
  await expect(
    manager.page.getByRole("heading", { name: studio }),
  ).toBeVisible();
  expect(await manager.page.content()).not.toContain("Aluno confidencial gestor");

  // Only one manager can be activated with the token.
  const second = await newActor(browser, baseURL);
  await signUp(second.page, "Segundo", uniqueEmail("mgr2"), "./cadastro?area=gestor");
  await second.page.getByLabel("Código de ativação").fill(setupToken());
  await second.page.getByRole("button", { name: "Ativar como gestor" }).click();
  await expect(second.page.getByText("Já existe um gestor ativo.")).toBeVisible();
  await second.context.close();

  // Blocking takes effect on the very next request of the professional.
  await manager.page
    .getByRole("button", { name: `Bloquear o acesso de ${person}` })
    .click();
  await expect(manager.page.getByText("Acesso bloqueado.")).toBeVisible();
  await pro.page.goto("./profissional");
  await expect(
    pro.page.getByText("Esta conta está bloqueada."),
  ).toBeVisible();
  await manager.page
    .getByRole("button", {
      name: `Restabelecer o acesso de ${person}`,
    })
    .click();
  await expect(manager.page.getByText("Acesso restabelecido.")).toBeVisible();
  await pro.page.goto("./profissional");
  await expect(pro.page.getByRole("heading", { name: /^Olá, / })).toBeVisible();

  // Both actions are on the audit trail.
  await manager.page.goto("./gestor/auditoria");
  await expect(manager.page.getByText("Acesso bloqueado").first()).toBeVisible();
  await expect(manager.page.getByText("Acesso restabelecido").first()).toBeVisible();
  await expect(manager.page.getByText(proEmail).first()).toBeVisible();

  // The manager has no workspace and therefore no professional area.
  await manager.page.goto("./profissional");
  await expect(manager.page).toHaveURL(/\/gestor$/);
  await pro.context.close();
  await manager.context.close();
});
