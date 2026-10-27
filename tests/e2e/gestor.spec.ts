import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  addStudent,
  createProfessional,
  newActor,
  noHorizontalOverflow,
  signIn,
  signUp,
  turnOnTwoFactor,
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

  // A professional turns on the second step; a manager can turn it off for someone who lost the phone and
  // the codes. The person is signed out and comes back with the password alone.
  await turnOnTwoFactor(pro.page, "./profissional/conta");
  await manager.page.reload();
  await expect(manager.page.getByText("Duas etapas ativas")).toBeVisible();
  await manager.page.getByRole("button", { name: `Redefinir a verificação em duas etapas de ${person}` }).click();
  await expect(manager.page.getByText("Confirme, por outro canal", { exact: false })).toBeVisible();
  await manager.page.getByRole("button", { name: `Confirmar: redefinir as duas etapas de ${person}` }).click();
  await expect(manager.page.getByText("Verificação em duas etapas redefinida.", { exact: false })).toBeVisible();
  await expect(manager.page.getByText("Duas etapas ativas")).toHaveCount(0);
  await pro.page.goto("./profissional");
  await expect(pro.page).toHaveURL(/\/entrar/);
  await signIn(pro.page, proEmail);
  await expect(pro.page.getByRole("heading", { name: /^Olá, / })).toBeVisible();

  // Both actions are on the audit trail.
  await manager.page.goto("./gestor/auditoria");
  await expect(manager.page.getByText("Acesso bloqueado").first()).toBeVisible();
  await expect(manager.page.getByText("Acesso restabelecido").first()).toBeVisible();
  await expect(manager.page.getByText(proEmail).first()).toBeVisible();
  await expect(manager.page.getByText("Verificação em duas etapas redefinida").first()).toBeVisible();

  // The manager has a page of their own account, with the password and the second step.
  await manager.page.goto("./gestor/conta");
  await expect(manager.page.getByRole("heading", { name: "Minha conta", level: 1 })).toBeVisible();
  await expect(manager.page.getByRole("link", { name: "Minha conta" }).first()).toHaveAttribute("aria-current", "page");
  await expect(manager.page.getByRole("heading", { name: "Alterar a senha" })).toBeVisible();
  await expect(manager.page.getByRole("heading", { name: "Verificação em duas etapas" })).toBeVisible();
  await expect(manager.page.getByRole("heading", { name: "Aparelhos conectados", level: 2 })).toBeVisible();
  await expect(manager.page.getByText("Este aparelho")).toBeVisible();
  await expect(manager.page.getByText("Desativada.")).toBeVisible();
  await noHorizontalOverflow(manager.page);

  // The manager has no workspace and therefore no professional area.
  await manager.page.goto("./profissional");
  await expect(manager.page).toHaveURL(/\/gestor$/);

  // Requests of the data subjects are only counted here: how many are open and how many are past the deadline.
  await expect(manager.page.locator(".kpi", { hasText: "Pedidos de titulares em aberto" }).locator(".kpi-value")).toBeVisible();
  await manager.page.goto("./gestor/organizacoes");
  await expect(manager.page.getByRole("columnheader", { name: "Pedidos de titulares" })).toBeVisible();

  // More than one manager: a single-use link, shown once, and the role comes from the link and the account.
  await manager.page.goto("./gestor/gestores");
  await expect(manager.page.getByRole("heading", { name: "Gestores", level: 1 })).toBeVisible();
  await expect(manager.page.getByRole("link", { name: "Gestores" }).first()).toHaveAttribute("aria-current", "page");
  const ownRow = manager.page.getByRole("row", { name: /Você/ });
  await expect(ownRow.getByText("código de ativação")).toBeVisible();
  await expect(ownRow.getByRole("button", { name: /Encerrar/ })).toHaveCount(0);
  await noHorizontalOverflow(manager.page);
  await manager.page.getByLabel("Lembrete de para quem é (opcional)").fill("Para a segunda pessoa da gestão");
  await manager.page.getByRole("button", { name: "Gerar link de convite" }).click();
  const link = await manager.page.getByLabel("Link de convite de gestor (uso único)").inputValue();
  expect(link).toMatch(/\/gestor\/convite\/[A-Za-z0-9_-]{43}$/);
  await expect(manager.page.getByRole("row", { name: /Para a segunda pessoa da gestão/ }).getByText("Aberto")).toBeVisible();

  // Whoever opens it signs up and accepts with their own account. Nothing about their e-mail matters.
  const colleague = await newActor(browser, baseURL);
  const colleagueName = `Gestão ${crypto.randomUUID().slice(0, 6)}`;
  const colleagueEmail = uniqueEmail("mgr3");
  await colleague.page.goto(link);
  await expect(colleague.page.getByRole("heading", { name: /convidou você/ })).toBeVisible();
  await expect(colleague.page.getByText("Não vê alunos, avaliações nem treinos.", { exact: false })).toBeVisible();
  await colleague.page.getByLabel("Seu nome").fill(colleagueName);
  await colleague.page.getByLabel("E-mail", { exact: true }).fill(colleagueEmail);
  await colleague.page.getByLabel("Senha", { exact: true }).fill("only-for-local-browser-testing");
  await colleague.page.getByRole("button", { name: "Criar minha conta" }).click();
  await expect(colleague.page.getByRole("heading", { name: `Aceitar como ${colleagueName}.` })).toBeVisible();
  await colleague.page.getByRole("button", { name: "Aceitar e tornar-me gestor" }).click();
  await expect(colleague.page.getByRole("heading", { name: "Quem contratou a ferramenta." })).toBeVisible();
  expect(await colleague.page.content()).not.toContain("Aluno confidencial gestor");

  // The link is spent for everyone else, and says the same as one that never existed.
  const third = await newActor(browser, baseURL);
  await third.page.goto(link);
  await expect(third.page.getByRole("heading", { name: "Convite indisponível." })).toBeVisible();
  await third.page.goto(link.replace(/[A-Za-z0-9_-]{43}$/, "A".repeat(43)));
  await expect(third.page.getByRole("heading", { name: "Convite indisponível." })).toBeVisible();
  await third.context.close();

  // The first manager sees the new one and how they came in; the invitation is marked as used.
  await manager.page.reload();
  const newRow = manager.page.getByRole("row", { name: new RegExp(colleagueName) });
  await expect(newRow.getByText("Ativo")).toBeVisible();
  await expect(newRow.getByText(/^convite de /)).toBeVisible();
  await expect(manager.page.getByRole("row", { name: /Para a segunda pessoa da gestão/ }).getByText("Usado")).toBeVisible();

  // Ending the access is confirmed, and takes effect on the very next request.
  await newRow.getByRole("button", { name: `Encerrar o acesso de gestor de ${colleagueName}` }).click();
  await newRow.getByRole("button", { name: `Confirmar: encerrar o acesso de ${colleagueName}` }).click();
  await expect(manager.page.getByText("Acesso de gestor encerrado.")).toBeVisible();
  await colleague.page.goto("./gestor");
  await expect(colleague.page).not.toHaveURL(/\/gestor\/?$/);
  await expect(colleague.page.getByRole("heading", { name: "Quem contratou a ferramenta." })).toHaveCount(0);
  await colleague.context.close();
  await manager.page.goto("./gestor/auditoria");
  await expect(manager.page.getByText("Convite de gestor criado").first()).toBeVisible();
  await expect(manager.page.getByText("Gestor acrescentado").first()).toBeVisible();
  await expect(manager.page.getByText("Acesso de gestor encerrado").first()).toBeVisible();

  // The terms: the text in force is the approved one, and the manager can change it on a page of its own.
  // This is the last thing the scenario does: publishing a text asks everyone to accept again.
  await manager.page.goto("./gestor/termos");
  await expect(manager.page.getByRole("heading", { name: "Termos", level: 1 })).toBeVisible();
  await expect(manager.page.getByRole("link", { name: "Termos do aluno" })).toHaveAttribute("aria-current", "page");
  await expect(manager.page.getByText("Texto inicial, aprovado pelo advogado em 25/10/2026")).toBeVisible();
  const inForce = manager.page.getByRole("region", { name: "Termos do aluno" }).first();
  await expect(inForce.getByText("2026-10-25-base")).toBeVisible();
  await noHorizontalOverflow(manager.page);

  // Nothing is published without reading what changed: the same words are refused, and so is an empty title.
  await manager.page.getByRole("button", { name: "Revisar as alterações" }).click();
  await expect(manager.page.getByText("Nada mudou em relação ao texto em vigor.")).toBeVisible();
  await manager.page.getByLabel("Título", { exact: true }).fill("   ");
  await manager.page.getByRole("button", { name: "Revisar as alterações" }).click();
  await expect(manager.page.locator("p.form-error")).toContainText("nenhum pode ficar vazio");

  // The student's text keeps the photos block: removing it is refused before anything is sent.
  await manager.page.getByLabel("Título", { exact: true }).fill("Termos e aviso de privacidade do aluno");
  await manager.page.getByLabel("Título do bloco").fill("");
  await manager.page.getByRole("button", { name: "Revisar as alterações" }).click();
  await expect(manager.page.locator("p.form-error")).toContainText("nenhum pode ficar vazio");
  await manager.page.getByLabel("Título do bloco").fill("Fotos da sua postura (opcional)");

  // The words can be kept on the server as a draft and thrown away; the editor goes back to the text in force.
  await manager.page.getByLabel("Título do bloco").fill("Fotos da sua postura (escolha opcional)");
  await expect(manager.page.getByText("Há alterações ainda não salvas.")).toBeVisible();
  await manager.page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(manager.page.getByText("Rascunho salvo. Ele não publica nada", { exact: false })).toBeVisible();
  await manager.page.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(manager.page.getByRole("group", { name: "Confirmar o descarte do rascunho" })).toBeVisible();
  await manager.page.getByRole("button", { name: "Sim, descartar" }).click();
  await expect(manager.page.getByText("Rascunho descartado. O editor voltou ao texto em vigor.")).toBeVisible();
  await expect(manager.page.getByLabel("Título do bloco")).toHaveValue("Fotos da sua postura (opcional)");
  await expect(manager.page.getByText("Nenhuma alteração pendente.")).toBeVisible();
  await expect(manager.page.getByRole("button", { name: "Descartar rascunho" })).toHaveCount(0);

  // Change the professional's text: edit, read what changed and how it will look, then publish.
  await manager.page.getByRole("link", { name: "Termos do profissional" }).click();
  await expect(manager.page.getByRole("link", { name: "Termos do profissional" })).toHaveAttribute("aria-current", "page");
  await manager.page.getByLabel("Título", { exact: true }).fill("Termos de uso do profissional (versão 2)");
  await manager.page.getByLabel("Texto da seção 1").fill("A ferramenta organiza o seu atendimento. Texto novo da primeira seção.\n\nSegundo parágrafo.");
  await manager.page.getByRole("button", { name: "Adicionar seção" }).click();
  await manager.page.getByLabel("Título da seção 6").fill("Seção nova");
  await manager.page.getByLabel("Texto da seção 6").fill("Conteúdo da seção nova.");

  // Words that are not ready are kept as a draft on the server and found again after a reload.
  await expect(manager.page.getByText("Há alterações ainda não salvas.")).toBeVisible();
  await manager.page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(manager.page.getByText("Rascunho salvo. Ele não publica nada", { exact: false })).toBeVisible();
  await expect(manager.page.getByText(/Rascunho salvo por .+ em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await manager.page.reload();
  await expect(manager.page.getByText("Continuando o rascunho salvo", { exact: false })).toBeVisible();
  await expect(manager.page.getByLabel("Título", { exact: true })).toHaveValue("Termos de uso do profissional (versão 2)");
  await expect(manager.page.getByLabel("Título da seção 6")).toHaveValue("Seção nova");
  await expect(manager.page.getByText("Nenhuma alteração pendente.")).toBeHidden();
  await noHorizontalOverflow(manager.page);

  // A change that is not saved is flagged, and leaving through a link of the page asks first.
  await manager.page.getByLabel("Texto da seção 6").fill("Conteúdo da seção nova, com mais uma frase.");
  await expect(manager.page.getByText("Há alterações ainda não salvas.")).toBeVisible();
  const asked: string[] = [];
  manager.page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await manager.page.getByRole("link", { name: "Termos do aluno" }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain("ainda não foram salvas");
  await expect(manager.page.getByRole("link", { name: "Termos do profissional" })).toHaveAttribute("aria-current", "page");
  await expect(manager.page.getByLabel("Texto da seção 6")).toHaveValue("Conteúdo da seção nova, com mais uma frase.");
  await manager.page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(manager.page.getByText("Rascunho salvo. Ele não publica nada", { exact: false })).toBeVisible();

  await manager.page.getByRole("button", { name: "Revisar as alterações" }).click();
  const changes = manager.page.getByRole("region", { name: "O que mudou" });
  await expect(changes.getByText("Título alterado")).toBeVisible();
  await expect(changes.getByText("Seção «O que a ferramenta é e não é» alterada")).toBeVisible();
  await expect(changes.getByText("Seção «Seção nova» adicionada")).toBeVisible();
  await expect(manager.page.getByRole("region", { name: "Termos de uso do profissional (versão 2)" })).toBeVisible();
  const publish = manager.page.getByRole("button", { name: "Publicar nova versão" });
  await expect(publish).toBeDisabled();
  await manager.page.getByLabel(/Motivo da alteração/).fill("Ajuste de redação no teste.");
  await manager.page.getByLabel(/revisado e aprovado por quem responde juridicamente/).check();
  await publish.click();
  await expect(manager.page.getByText(/Versão \d{4}-\d{2}-\d{2}-\d{6} publicada\. Todos aceitam de novo no próximo acesso\./)).toBeVisible();

  // The draft went with the publication: nothing is left to continue.
  await manager.page.reload();
  await expect(manager.page.getByText("Continuando o rascunho salvo", { exact: false })).toHaveCount(0);
  await expect(manager.page.getByRole("button", { name: "Descartar rascunho" })).toHaveCount(0);

  // The history keeps both versions, with who published and why; the new one is in force.
  const history = manager.page.getByRole("table", { name: /Versões do texto/ });
  await expect(history.getByRole("row")).toHaveCount(3); // header + new + initial
  await expect(history.getByText("Ajuste de redação no teste.")).toBeVisible();
  await expect(history.getByText("Em vigor")).toHaveCount(1);
  await expect(history.getByText("2026-10-25-base")).toBeVisible();

  // The professional who had accepted the old text is asked again, reads the new one, and gets back in.
  await pro.page.goto("./profissional");
  await expect(pro.page).toHaveURL(/\/aceite\?area=profissional/);
  const reading = pro.page.getByRole("region", { name: "Termos de uso do profissional (versão 2)" });
  await expect(reading).toBeVisible();
  await expect(reading.getByText("Segundo parágrafo.")).toBeVisible();
  await expect(reading.getByRole("heading", { name: "Seção nova" })).toBeVisible();
  await pro.page.getByLabel("Li e aceito os termos de uso.").check();
  await pro.page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(pro.page).toHaveURL(/\/profissional\/?$/);

  // Publishing is on the trail, and the manager can start a new edit from an older version.
  await manager.page.goto("./gestor/auditoria");
  await expect(manager.page.getByText("Termos do profissional publicados").first()).toBeVisible();
  await manager.page.goto("./gestor/termos?publico=profissional");
  await manager.page.getByRole("link", { name: "Editar a partir desta" }).last().click();
  await expect(manager.page.getByLabel("Título", { exact: true })).toHaveValue("Termos de uso do profissional");
  await pro.context.close();
  await manager.context.close();
});
