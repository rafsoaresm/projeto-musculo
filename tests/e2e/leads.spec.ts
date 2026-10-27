import { test, expect } from "@playwright/test";
import { createProfessional, localIP, noHorizontalOverflow } from "./helpers";

test("a professional registers services and leads, moves them along the funnel, converts a won lead into a student and deletes another", async ({
  page,
}, testInfo) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": localIP() });
  await createProfessional(page, "Estúdio dos leads", "Profissional dos Leads");

  // The menu has the two entries as real pages now, not as "em breve" (on a phone the menu is a sheet).
  if (testInfo.project.name !== "mobile") {
    await page.goto("./profissional");
    const menu = page.getByRole("navigation").first();
    await expect(menu.getByRole("link", { name: "Leads" }).first()).toBeVisible();
    await expect(menu.getByRole("link", { name: "Serviços" }).first()).toBeVisible();
    await expect(menu.getByText("Em breve").filter({ hasText: /^Leads$/ })).toHaveCount(0);
  }

  // Services: created, not repeated, taken off the offer and put back.
  await page.goto("./profissional/servicos");
  await expect(page.getByRole("heading", { name: "Serviços", level: 1 })).toBeVisible();
  await expect(page.getByText("Nenhum serviço cadastrado ainda.", { exact: false })).toBeVisible();
  const newService = page.getByRole("form", { name: "Novo serviço" });
  await newService.getByLabel("Nome do serviço").fill("Consultoria online");
  await newService.getByLabel("Como é entregue").selectOption({ label: "Online" });
  await newService.getByLabel("Descrição (opcional)").fill("Plano mensal com ajustes por vídeo");
  await newService.getByRole("button", { name: "Criar serviço" }).click();
  await expect(page.getByText("Serviço criado.")).toBeVisible();
  const services = page.getByRole("list", { name: "Serviços" });
  await expect(services.getByRole("heading", { name: "Consultoria online" })).toBeVisible();
  await expect(services.getByText("0 leads")).toBeVisible();
  await newService.getByLabel("Nome do serviço").fill("  consultoria   ONLINE ");
  await newService.getByRole("button", { name: "Criar serviço" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Já existe um serviço com esse nome." })).toBeVisible();
  await noHorizontalOverflow(page);

  // Leads: the list starts empty and says what it is for.
  await page.goto("./profissional/leads");
  await expect(page.getByRole("heading", { name: "Leads", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Seu primeiro lead começa aqui." })).toBeVisible();
  await page.getByRole("link", { name: "Novo lead" }).click();
  await expect(page.getByRole("heading", { name: "Novo lead", level: 1 })).toBeVisible();
  await expect(page.getByText("Não registre aqui dados de saúde", { exact: false }).first()).toBeVisible();

  // A lead needs a way to be reached; nothing is saved without it.
  const form = page.getByRole("form", { name: "Novo lead" });
  await form.getByLabel("Nome", { exact: true }).fill("Carla Prado");
  await form.getByRole("button", { name: "Salvar lead" }).click();
  await expect(form.getByRole("alert")).toContainText("Confira os dados");
  await expect(form.getByLabel("Nome", { exact: true })).toHaveValue("Carla Prado");

  await form.getByLabel("E-mail", { exact: true }).fill("Carla.Prado@example.test");
  await form.getByLabel("Telefone ou WhatsApp").fill("(11) 91234-5678");
  await form.getByLabel("De onde veio").selectOption({ label: "WhatsApp" });
  await form.getByLabel("Serviço de interesse").selectOption({ label: "Consultoria online" });
  await form.getByLabel("Primeira anotação (opcional)").fill("Pediu valores pelo direct");
  await form.getByRole("button", { name: "Salvar lead" }).click();
  await expect(page.getByRole("heading", { name: "Carla Prado", level: 1 })).toBeVisible();
  const summary = page.getByRole("region", { name: "Resumo" });
  await expect(summary.getByText("Novo", { exact: true })).toBeVisible();
  await expect(summary.getByText("WhatsApp")).toBeVisible();
  await expect(summary.getByText("Consultoria online")).toBeVisible();
  const timeline = page.getByRole("list", { name: "Histórico do lead" });
  await expect(timeline.getByText("Lead registrado.")).toBeVisible();
  await expect(timeline.getByText("Pediu valores pelo direct")).toBeVisible();
  await noHorizontalOverflow(page);
  const carlaUrl = page.url();

  // The same person is not saved twice without asking, even typed differently.
  await page.goto("./profissional/leads/novo");
  const again = page.getByRole("form", { name: "Novo lead" });
  await again.getByLabel("Nome", { exact: true }).fill("Carla P.");
  await again.getByLabel("Telefone ou WhatsApp").fill("+55 11 91234 5678");
  await again.getByRole("button", { name: "Salvar lead" }).click();
  const warning = again.getByRole("alert").filter({ hasText: "Esta pessoa parece já estar na lista" });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("link", { name: "Carla Prado" })).toBeVisible();
  await warning.getByRole("button", { name: "Voltar e conferir" }).click();
  await expect(warning).toHaveCount(0);

  // A second lead, with a phone only, goes lost with a reason.
  await again.getByLabel("Nome", { exact: true }).fill("Diego Alves");
  await again.getByLabel("Telefone ou WhatsApp").fill("21 98888-7777");
  await again.getByLabel("De onde veio").selectOption({ label: "Indicação" });
  await again.getByRole("button", { name: "Salvar lead" }).click();
  await expect(page.getByRole("heading", { name: "Diego Alves", level: 1 })).toBeVisible();
  const diegoUrl = page.url();
  const move = page.getByRole("form", { name: "Mudar a etapa do lead" });
  await move.getByLabel("Mover para").selectOption({ label: "Perdido" });
  await move.getByLabel("Motivo da perda").selectOption({ label: "Preço" });
  await move.getByLabel("Anotação sobre a mudança (opcional)").fill("Achou caro");
  await move.getByRole("button", { name: "Mudar a etapa" }).click();
  await expect(move.getByText("Etapa atualizada.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumo" }).getByText("Perdido")).toBeVisible();
  await expect(page.getByRole("list", { name: "Histórico do lead" }).getByText("Etapa: Novo → Perdido (Preço).")).toBeVisible();
  await expect(page.getByRole("list", { name: "Histórico do lead" }).getByText("Achou caro")).toBeVisible();

  // The list filters by stage and counts them.
  await page.goto("./profissional/leads?etapa=LOST");
  await expect(page.getByRole("link", { name: "Perdido (1)" })).toHaveAttribute("aria-current", "page");
  const lostRows = page.getByRole("table", { name: /Leads do espaço/ }).getByRole("row");
  await expect(lostRows.filter({ hasText: "Diego Alves" })).toHaveCount(1);
  await expect(lostRows.filter({ hasText: "Carla Prado" })).toHaveCount(0);
  await page.goto("./profissional/leads");
  await expect(page.getByRole("link", { name: "Todos (2)" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Novo (1)" })).toBeVisible();
  await noHorizontalOverflow(page);

  // Carla moves along, gets a note, and cannot become a student before she is won.
  await page.goto(carlaUrl);
  await expect(page.getByText("Marque o lead como “Contratado”", { exact: false })).toBeVisible();
  const carlaMove = page.getByRole("form", { name: "Mudar a etapa do lead" });
  await carlaMove.getByLabel("Mover para").selectOption({ label: "Em contato" });
  await carlaMove.getByRole("button", { name: "Mudar a etapa" }).click();
  await expect(carlaMove.getByText("Etapa atualizada.")).toBeVisible();
  const notes = page.getByRole("form", { name: "Anotar sobre o lead" });
  await notes.getByLabel("Anotação").fill("Combinamos uma conversa na quinta");
  await notes.getByRole("button", { name: "Anotar" }).click();
  await expect(notes.getByText("Anotação salva.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Histórico do lead" }).getByText("Combinamos uma conversa na quinta")).toBeVisible();
  // After a move the selector offers another stage, not the one she is in.
  await expect(carlaMove.getByLabel("Mover para").locator("option", { hasText: "Em contato" })).toHaveCount(0);
  await carlaMove.getByLabel("Mover para").selectOption({ label: "Contratado" });
  await carlaMove.getByRole("button", { name: "Mudar a etapa" }).click();
  await expect(carlaMove.getByText("Etapa atualizada.")).toBeVisible();

  // Won: converted into a student once, and the lead keeps its origin.
  const convert = page.getByRole("region", { name: "Converter em aluno" });
  await convert.getByRole("button", { name: "Converter em aluno" }).click();
  await expect(convert.getByText("Este lead virou aluno.")).toBeVisible();
  await expect(page.getByText("Este lead virou aluno e não muda mais de etapa.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumo" }).getByText("WhatsApp")).toBeVisible();
  await convert.getByRole("link", { name: "Abrir o aluno" }).click();
  await expect(page.getByRole("heading", { name: "Carla Prado", level: 1 })).toBeVisible();
  await page.goto("./profissional/alunos");
  await expect(page.getByRole("heading", { name: "Carla Prado" })).toHaveCount(1);
  await page.goto(carlaUrl);
  await expect(page.getByRole("region", { name: "Converter em aluno" }).getByText("Este lead virou aluno.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apagar este lead" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Corrigir os dados do lead" })).toHaveCount(0);

  // A lead that was lost is deleted on request, and takes its history along.
  await page.goto(diegoUrl);
  await page.getByRole("button", { name: "Apagar este lead" }).click();
  await page.getByRole("button", { name: "Confirmar: apagar Diego Alves" }).click();
  await expect(page).toHaveURL(/\/profissional\/leads\/?$/);
  await expect(page.getByRole("link", { name: "Diego Alves" })).toHaveCount(0);
  expect((await page.request.get(diegoUrl)).status()).toBe(404);

  // A service taken off the offer is not offered to new leads, but stays on the lead that chose it.
  await page.goto("./profissional/servicos");
  await expect(page.getByRole("list", { name: "Serviços" }).getByText("1 lead")).toBeVisible();
  await page.getByRole("button", { name: "Tirar da oferta: Consultoria online" }).click();
  await expect(page.getByText("Serviço fora da oferta.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Serviços" }).getByText("Fora da oferta")).toBeVisible();
  await page.goto("./profissional/leads/novo");
  await expect(page.getByLabel("Serviço de interesse").locator("option", { hasText: "Consultoria online" })).toHaveCount(0);
});
