import { expect, type Page } from "@playwright/test";
import { noHorizontalOverflow, turnOnTwoFactor } from "./helpers";

/**
 * The gestor's "Inteligência artificial" panel (sub-stage 1.4), as one scenario that runs inside the gestor spec: the first manager can be
 * activated only once per database, so the scenario borrows that manager instead of activating another. Only the simulated provider is
 * ever called (AI_MOCK_ENABLED, set by `npm run auth:setup:local`); no real provider is contacted, not even to test a connection.
 *
 * The key typed here is a canary: it must be in no HTML, no RSC payload and no script the browser receives.
 */
export const KEY_CANARY = "sk-e2e-CANARY-0123456789abcdef-ZZ";

export async function aiPanelScenario(manager: Page, professional: Page, studio: string) {
  const tab = (name: string) => manager.getByRole("navigation", { name: "Seções da inteligência artificial" }).getByRole("link", { name, exact: true });
  // everything the browser receives from now on is searched for the canary
  const leaks: string[] = [];
  const seen = new Set<string>();
  manager.on("response", async (response) => {
    try {
      const type = response.headers()["content-type"] ?? "";
      if (!/text|json|javascript|x-component/.test(type) || seen.has(response.url())) return;
      seen.add(response.url());
      if ((await response.text()).includes(KEY_CANARY)) leaks.push(response.url());
    } catch {
      /* a response that is gone with the navigation */
    }
  });

  // The item is in the manager's navigation and the page is the manager's alone.
  await manager.goto("./gestor");
  const menu = manager.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();
  await expect(manager.getByRole("link", { name: "Inteligência artificial" })).toBeVisible();
  if (await menu.isVisible()) await manager.keyboard.press("Escape");
  await professional.goto("./gestor/inteligencia-artificial");
  await expect(professional.getByRole("heading", { name: "Inteligência artificial", level: 1 })).toHaveCount(0);
  expect(await professional.content()).not.toContain("Provedores");

  // Without two-factor the manager can read but not change anything, and is told how to fix it.
  await manager.goto("./gestor/inteligencia-artificial");
  await expect(manager.getByRole("heading", { name: "Inteligência artificial", level: 1 })).toBeVisible();
  await expect(manager.getByText("Ative a verificação em duas etapas em Minha conta para alterar a IA.")).toBeVisible();
  const openai = manager.getByRole("article", { name: "OpenAI" });
  await expect(openai.getByLabel("Chave da API (OpenAI)")).toBeDisabled();
  await expect(manager.getByText("O que a IA recebe.", { exact: false })).toBeVisible();
  await expect(manager.getByText("não garante que ela seja impossível", { exact: false })).toBeVisible();
  await noHorizontalOverflow(manager);

  await turnOnTwoFactor(manager, "./gestor/conta");
  await manager.goto("./gestor/inteligencia-artificial");
  await expect(manager.getByText("Ative a verificação em duas etapas", { exact: false })).toHaveCount(0);
  await expect(manager.getByText("AI_PLANNER_DISABLED")).toHaveCount(0);
  await expect(manager.getByText("Simulado (testes)")).toBeVisible();

  // Providers: a key is written once, shown only as its masked tail, replaceable and removable.
  const key = openai.getByLabel("Chave da API (OpenAI)");
  await expect(key).toBeEnabled();
  await expect(key).toHaveAttribute("type", "password");
  await key.fill(KEY_CANARY);
  await openai.getByRole("button", { name: "Conectar" }).click();
  await expect(openai.getByText("Provedor conectado.", { exact: false })).toBeVisible();
  await expect(openai.getByText("Conectado", { exact: true })).toBeVisible();
  await expect(openai.getByText("••••Z-ZZ".slice(0, 4) + KEY_CANARY.slice(-4))).toBeVisible();
  await expect(openai.getByText(/Conectada/)).toBeVisible();
  await expect(openai.getByLabel("Chave da API (OpenAI)")).toHaveCount(0);
  expect(await manager.content()).not.toContain(KEY_CANARY);
  await manager.reload();
  expect(await manager.content()).not.toContain(KEY_CANARY);
  await expect(openai.getByRole("button", { name: "Testar conexão" })).toBeEnabled(); // not clicked: no real provider is contacted from the browser tests
  await openai.getByRole("button", { name: "Trocar chave" }).click();
  await openai.getByLabel("Chave da API (OpenAI)").fill(`${KEY_CANARY}-v2`);
  await openai.getByRole("button", { name: "Trocar chave" }).last().click();
  await expect(openai.getByText("Chave trocada.", { exact: false })).toBeVisible();
  await noHorizontalOverflow(manager);

  // Models: the simulated provider for the planner; nothing is prefilled; a typed price becomes cost; no price stays unknown.
  await tab("Modelos").click();
  const planner = manager.getByRole("article", { name: "Planejador de treino" });
  await expect(planner.getByLabel("Modelo", { exact: true })).toHaveValue("");
  await expect(planner.getByText("Sem preço digitado, o custo aparece como desconhecido", { exact: false })).toBeVisible();
  await planner.getByLabel("Provedor").selectOption({ label: "Simulado (testes)" });
  await planner.getByLabel("Modelo", { exact: true }).fill("mock-ok");
  await planner.getByLabel(/Tarefa ligada/).check();
  await planner.getByLabel("Preço de entrada").fill("0,15");
  await planner.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(planner.getByText("Digite os dois preços", { exact: false })).toBeVisible();
  await planner.getByLabel("Preço de saída").fill("0,6");
  await planner.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(planner.getByText("Configuração salva.")).toBeVisible();
  await manager.reload();
  await expect(planner.getByLabel("Preço de entrada")).toHaveValue("0,15");
  await expect(planner.getByText("o custo passa a ser calculado por chamada", { exact: false })).toBeVisible();
  await planner.getByRole("button", { name: "Testar modelo" }).click();
  await expect(planner.getByText("Modelo respondeu em", { exact: false })).toBeVisible();
  await planner.getByRole("button", { name: "Testar modelo" }).click();
  await expect(planner.getByText("Aguarde alguns segundos", { exact: false })).toBeVisible();
  await noHorizontalOverflow(manager);

  // The provider that the task uses cannot be removed (OpenAI is not used: it can).
  await tab("Provedores").click();
  await expect(manager.getByRole("article", { name: "Simulado (testes)" })).toBeVisible();

  // Plans: a cost cap is offered only now that a price was typed (USD); zero means "not included".
  await tab("Planos de IA").click();
  await expect(manager.getByRole("heading", { name: "Planos de IA", level: 2 })).toBeVisible();
  await manager.getByRole("button", { name: "Novo plano" }).click();
  const planName = `Plano E2E ${crypto.randomUUID().slice(0, 6)}`;
  const form = manager.getByRole("form", { name: "Novo plano de IA" });
  await form.getByLabel("Nome do plano").fill(planName);
  await form.getByLabel("Tokens por mês").fill("100.000");
  await form.getByLabel("Planejamento (tokens por pedido)").fill("30000");
  await form.getByLabel("Ajuste assistido (tokens por pedido)").fill("10000");
  await expect(form.getByLabel("Valor por mês")).toBeEnabled();
  await form.getByLabel("Valor por mês").fill("25,50");
  await form.getByRole("button", { name: "Salvar plano" }).click();
  await expect(manager.getByText("Plano criado.")).toBeVisible();
  const planRow = manager.getByRole("row", { name: new RegExp(planName) });
  await expect(planRow.getByText("100.000 tokens por mês")).toBeVisible();
  await expect(planRow.getByText(/US\$\s?25,50/)).toBeVisible();
  await noHorizontalOverflow(manager);
  // a second plan, with zero allowance, is created and archived
  await manager.getByRole("button", { name: "Novo plano" }).click();
  const zeroName = `Sem IA ${crypto.randomUUID().slice(0, 6)}`;
  const zeroForm = manager.getByRole("form", { name: "Novo plano de IA" });
  await zeroForm.getByLabel("Nome do plano").fill(zeroName);
  await zeroForm.getByLabel("Tokens por mês").fill("0");
  await zeroForm.getByLabel("Planejamento (tokens por pedido)").fill("0");
  await zeroForm.getByLabel("Ajuste assistido (tokens por pedido)").fill("0");
  await zeroForm.getByRole("button", { name: "Salvar plano" }).click();
  const zeroRow = manager.getByRole("row", { name: new RegExp(zeroName) });
  await expect(zeroRow.getByText("IA não incluída").first()).toBeVisible();
  await zeroRow.getByRole("button", { name: `Arquivar o plano ${zeroName}` }).click();
  await zeroRow.getByRole("button", { name: `Confirmar: arquivar ${zeroName}` }).click();
  await expect(zeroRow.getByText("Arquivado")).toBeVisible();

  // Organizations: off by default; enabling asks for the notice and a plan; the state is in words, the use is measured.
  await tab("Organizações").click();
  const orgRow = manager.getByRole("row", { name: new RegExp(studio) });
  await expect(orgRow.getByText("Desligada")).toBeVisible();
  await expect(manager.getByText("nunca vê chaves, provedores, modelos nem custos", { exact: false })).toBeVisible();
  await orgRow.getByRole("switch", { name: `IA ativa para ${studio}` }).click();
  const enabling = manager.getByRole("form", { name: `Habilitar a IA para ${studio}` });
  await expect(enabling.getByText("Confirmo que li o aviso", { exact: false })).toBeVisible();
  await expect(enabling.getByRole("button", { name: "Habilitar a IA" })).toBeDisabled();
  await enabling.getByLabel("Plano de IA").selectOption({ label: planName });
  await enabling.getByLabel(/Confirmo que li o aviso/).check();
  await enabling.getByRole("button", { name: "Habilitar a IA" }).click();
  await expect(manager.getByText("IA habilitada para a organização.")).toBeVisible();
  await expect(orgRow.getByText("Ativa")).toBeVisible();
  await expect(orgRow.getByText("0 de 100.000 tokens")).toBeVisible();
  await expect(orgRow.getByText("Restam 100.000 tokens")).toBeVisible();
  await expect(orgRow.locator("progress")).toHaveCount(1);
  await noHorizontalOverflow(manager);
  // choosing in the select only stages: nothing is saved until "Aplicar plano"
  await orgRow.getByLabel(`Plano de IA de ${studio}`).selectOption({ label: "Sem plano" });
  await expect(orgRow.getByText("IA não incluída no plano")).toHaveCount(0);
  await orgRow.getByRole("button", { name: `Aplicar plano de IA a ${studio}` }).click();
  await expect(orgRow.getByText("IA não incluída no plano")).toBeVisible();
  await orgRow.getByLabel(`Plano de IA de ${studio}`).selectOption({ label: planName });
  await orgRow.getByRole("button", { name: `Aplicar plano de IA a ${studio}` }).click();
  await expect(orgRow.getByText("Ativa")).toBeVisible();

  // The general switch stops everything, panel tests included, and says who and when.
  await manager.getByRole("button", { name: "Interromper todas as chamadas de IA" }).click();
  await manager.getByRole("button", { name: "Confirmar: interromper" }).click();
  await expect(manager.getByText("A IA está interrompida pelo interruptor geral", { exact: false })).toBeVisible();
  await expect(manager.getByText("Interrompida por", { exact: false })).toBeVisible();
  await tab("Modelos").click();
  await expect(manager.getByRole("article", { name: "Planejador de treino" }).getByRole("button", { name: "Testar modelo" })).toBeDisabled();
  await manager.getByRole("button", { name: "Liberar as chamadas de IA" }).click();
  await manager.getByRole("button", { name: "Confirmar: liberar" }).click();
  await expect(manager.getByText("A IA está interrompida pelo interruptor geral")).toHaveCount(0);

  // Usage and the trail of changes (no key in either).
  await tab("Uso").click();
  await expect(manager.getByRole("heading", { name: /^Uso em / })).toBeVisible();
  await expect(manager.getByText("Nenhum uso de IA registrado neste mês.")).toBeVisible();
  await expect(manager.getByRole("heading", { name: "Últimas alterações" })).toBeVisible();
  await expect(manager.getByRole("cell", { name: "Provedor conectado" }).first()).toBeVisible();
  await expect(manager.getByRole("cell", { name: "Chave trocada" }).first()).toBeVisible();
  await expect(manager.getByRole("cell", { name: "IA habilitada para uma organização" }).first()).toBeVisible();
  await expect(manager.getByRole("cell", { name: studio }).first()).toBeVisible();
  await noHorizontalOverflow(manager);

  // Removing the unused key; the shared trail lists the changes as well.
  await tab("Provedores").click();
  await openai.getByRole("button", { name: "Remover" }).click();
  await openai.getByRole("button", { name: "Confirmar: remover chave de OpenAI" }).click();
  await expect(openai.getByText("Chave removida.")).toBeVisible();
  await expect(openai.getByText("Não conectado")).toBeVisible();
  await manager.goto("./gestor/auditoria");
  await expect(manager.getByText("Provedor de IA conectado").first()).toBeVisible();
  await expect(manager.getByText("Plano de IA salvo").first()).toBeVisible();
  await expect(manager.getByText("IA interrompida em toda a plataforma").first()).toBeVisible();

  // The key typed above reached the server and nothing else: not a page, not a payload, not a script.
  expect(await manager.content()).not.toContain(KEY_CANARY);
  expect(leaks).toEqual([]);
}
