import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/gestor/inteligencia-artificial" }));
vi.mock("@/modules/gestor/ai-actions", () => {
  const stub = async () => ({ ok: true, message: "" });
  return { connectProvider: stub, removeProvider: stub, testProviderConnection: stub, listProviderModels: stub, testTaskModel: stub, setKillSwitch: stub, saveTask: stub, savePlan: stub, archivePlan: stub, setOrganizationAi: stub };
});

import type { CircuitView, ConnectionRow, OrganizationAiRow, PlanRow, TaskRow, UsageRow } from "@/db/ai-platform";
import { KillSwitchCard } from "@/modules/gestor/ai-kill-switch";
import { ModelsPanel } from "@/modules/gestor/ai-models";
import { OrganizationsPanel } from "@/modules/gestor/ai-organizations";
import { AiPanelFrame } from "@/modules/gestor/ai-panel";
import { PlansPanel } from "@/modules/gestor/ai-plans";
import { ProvidersPanel } from "@/modules/gestor/ai-providers";
import { UsagePanel } from "@/modules/gestor/ai-usage";
import {
  allowanceText, costCapRule, currencyConflicts, failureText, formatMoney, lastTestText, organizationState, organizationUsage, panelBanners, parseCount,
  parsePlanForm, parsePriceMicros, parseTaskForm, priceToField, recentMonths, tabOf, tasksUsing, type PlanFormValues, type TaskFormValues,
} from "@/modules/gestor/ai-view";
import { AI_ORG_ACK_TEXT } from "@/modules/prescricao/planejador/copy";

// View models and components of the gestor's AI panel (sub-stage 1.4). Pure functions are asserted directly; components are rendered to
// static markup with the server actions stubbed. The canary below stands for a provider key: it must be in NO markup.
const CANARY = "sk-test-CANARY-0123456789abcdef";

const connection = (kind: ConnectionRow["kind"], over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  kind, last4: "cdef", connectedAt: "2026-11-05T17:02:00.000Z", connectedByEmail: "gestor@example.test", rotatedAt: null, lastTestAt: null, lastTestOk: null, lastTestCode: null, version: 1, ...over,
});
const task = (t: TaskRow["task"], over: Partial<TaskRow> = {}): TaskRow => ({
  task: t, enabled: false, providerKind: null, modelId: null, maxInputTokens: 12000, maxOutputTokens: 6144, timeoutMs: 25000, maxRetries: 1, currency: null,
  priceInputMicrosPerMillion: null, priceOutputMicrosPerMillion: null, sendSystemExerciseNames: false, version: 1, ...over,
});
const plan = (over: Partial<PlanRow> = {}): PlanRow => ({
  id: "p1", name: "Essencial", mode: "TOTAL", totalTokens: 500_000, inputTokens: null, outputTokens: null, perRequestCapPlanning: 60_000, perRequestCapAdjustment: 20_000,
  requestsPerMinute: 6, costCapMicros: null, costCapCurrency: null, archivedAt: null, organizations: 1, version: 1, ...over,
});
const org = (over: Partial<OrganizationAiRow> = {}): OrganizationAiRow => ({
  organizationId: "o1", organizationName: "Studio A", enabled: true, quotaPlanId: "p1", quotaPlanName: "Essencial", usedTokens: 125_000, usedInput: 100_000, usedOutput: 25_000, reservedTokens: 0, reservedInput: 0, reservedOutput: 0,
  costMicros: 0, reservedCostMicros: 0, costCurrency: null, version: 2, ...over,
});
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("numbers typed by the gestor", () => {
  it("token counts accept plain digits and pt-BR thousands groups, nothing else", () => {
    expect(parseCount("500000", 0, 1e9)).toBe(500000);
    expect(parseCount("500.000", 0, 1e9)).toBe(500000);
    expect(parseCount(" 1 000 000 ", 0, 1e9)).toBe(1_000_000);
    for (const bad of ["", "  ", "1,5", "1.5", "-3", "1e6", "abc", "12 a", "1.00", "٣", "0x10", "999999999999999999"]) expect(parseCount(bad, 0, 1e12), bad).toBeNull();
    expect(parseCount("5", 10, 20)).toBeNull();
    expect(parseCount("25", 10, 20)).toBeNull();
    expect(parseCount(7, 0, 10)).toBe(7);
    expect(parseCount(7.5, 0, 10)).toBeNull();
    expect(parseCount(null, 0, 10)).toBeNull();
  });

  it("a price is a decimal with at most 6 places, stored as integer micro-units; empty is 'not typed', garbage is invalid", () => {
    expect(parsePriceMicros("0,15")).toBe(150_000);
    expect(parsePriceMicros("0.15")).toBe(150_000);
    expect(parsePriceMicros("3")).toBe(3_000_000);
    expect(parsePriceMicros("12,345678")).toBe(12_345_678);
    expect(parsePriceMicros("")).toBeNull();
    expect(parsePriceMicros("   ")).toBeNull();
    for (const bad of ["abc", "-1", "1,2345678", "1e3", "1,2,3", "R$ 3", "1.000,50"]) expect(parsePriceMicros(bad), bad).toBeUndefined();
    expect(priceToField(150_000)).toBe("0,15");
    expect(priceToField(3_000_000)).toBe("3");
    expect(priceToField(null)).toBe("");
    expect(parsePriceMicros(priceToField(12_345_678))).toBe(12_345_678);
  });

  it("money is formatted in the typed currency", () => {
    expect(formatMoney(150_000, "USD")).toMatch(/US\$\s?0,15/);
    expect(formatMoney(25_000_000, "BRL")).toMatch(/R\$\s?25,00/);
  });
});

describe("the task form", () => {
  const form = (over: Partial<TaskFormValues> = {}): TaskFormValues => ({
    enabled: true, providerKind: "mock", modelId: "mock-ok", maxInputTokens: "12000", maxOutputTokens: "6144", timeoutSeconds: "25", maxRetries: "1",
    currency: "USD", priceInput: "", priceOutput: "", sendSystemExerciseNames: false, ...over,
  });
  it("accepts a complete form; no price typed means no prices at all (cost unknown, never zero)", () => {
    const out = parseTaskForm(form());
    expect(out).toMatchObject({ ok: true, value: { providerKind: "mock", modelId: "mock-ok", timeoutMs: 25000, maxRetries: 1, prices: null } });
  });
  it("prices need both sides and a currency, and convert to micros", () => {
    expect(parseTaskForm(form({ priceInput: "0,15", priceOutput: "0,6" }))).toMatchObject({ ok: true, value: { prices: { currency: "USD", inputMicrosPerMillion: 150_000, outputMicrosPerMillion: 600_000 } } });
    expect(parseTaskForm(form({ priceInput: "0,15" }))).toMatchObject({ ok: false });
    expect(parseTaskForm(form({ priceInput: "x", priceOutput: "1" }))).toMatchObject({ ok: false });
    expect(parseTaskForm(form({ priceInput: "1", priceOutput: "1", currency: "XXX" }))).toMatchObject({ ok: false });
  });
  it("provider and model go together; the model id is a plain token; limits are bounded", () => {
    expect(parseTaskForm(form({ providerKind: "", modelId: "" , enabled: false }))).toMatchObject({ ok: true, value: { providerKind: null, modelId: null } });
    expect(parseTaskForm(form({ providerKind: "openai", modelId: "" }))).toMatchObject({ ok: false });
    expect(parseTaskForm(form({ providerKind: "", modelId: "", enabled: true }))).toMatchObject({ ok: false });
    for (const modelId of ["a b", "../x", "m?x=1", "m/y", "m;rm", " ", "-bad"]) expect(parseTaskForm(form({ providerKind: "openai", modelId })), modelId).toMatchObject({ ok: false });
    expect(parseTaskForm(form({ providerKind: "google", modelId: "models/x" }))).toMatchObject({ ok: false });
    expect(parseTaskForm(form({ maxInputTokens: "100" }))).toMatchObject({ ok: false });
    expect(parseTaskForm(form({ maxOutputTokens: "40000" }))).toMatchObject({ ok: false });
    expect(parseTaskForm(form({ timeoutSeconds: "1" }))).toMatchObject({ ok: false });
    expect(parseTaskForm(form({ maxRetries: "2" }))).toMatchObject({ ok: false });
  });
});

describe("the plan form and the cost cap", () => {
  const form = (over: Partial<PlanFormValues> = {}): PlanFormValues => ({
    name: "  Essencial  ", mode: "TOTAL", total: "500.000", input: "", output: "", capPlanning: "60000", capAdjustment: "20000", requestsPerMinute: "6", costCap: "", costCurrency: "USD", ...over,
  });
  it("TOTAL and SPLIT plans; zero is a valid allowance (it means 'IA não incluída')", () => {
    expect(parsePlanForm(form())).toMatchObject({ ok: true, value: { name: "Essencial", allowance: { mode: "TOTAL", total: 500_000 }, costCap: null } });
    expect(parsePlanForm(form({ mode: "SPLIT", input: "300000", output: "100000" }))).toMatchObject({ ok: true, value: { allowance: { mode: "SPLIT", input: 300_000, output: 100_000 } } });
    expect(parsePlanForm(form({ total: "0", capPlanning: "0", capAdjustment: "0" }))).toMatchObject({ ok: true });
  });
  it("refuses invalid names, modes, counts, rates and caps", () => {
    for (const over of [{ name: "  " }, { name: "x".repeat(61) }, { mode: "NOPE" }, { total: "-1" }, { total: "" }, { mode: "SPLIT", input: "1", output: "" }, { capPlanning: "" }, { requestsPerMinute: "0" }, { requestsPerMinute: "121" }, { costCap: "abc" }]) {
      expect(parsePlanForm(form(over as Partial<PlanFormValues>)), JSON.stringify(over)).toMatchObject({ ok: false });
    }
    expect(parsePlanForm(form({ costCap: "25", costCurrency: "XXX" }))).toMatchObject({ ok: false });
    expect(parsePlanForm(form({ costCap: "25,5", costCurrency: "BRL" }))).toMatchObject({ ok: true, value: { costCap: { micros: 25_500_000, currency: "BRL" } } });
  });
  it("a cost cap is allowed only where prices were typed, in the one currency they use", () => {
    expect(costCapRule([task("PLANNER"), task("ADJUSTMENTS")])).toMatchObject({ allowed: false });
    const priced = (currency: "USD" | "BRL") => task("PLANNER", { currency, priceInputMicrosPerMillion: 1, priceOutputMicrosPerMillion: 2 });
    expect(costCapRule([priced("USD"), task("ADJUSTMENTS")])).toEqual({ allowed: true, currency: "USD" });
    expect(costCapRule([priced("USD"), { ...priced("BRL"), task: "ADJUSTMENTS" }])).toMatchObject({ allowed: false });
    expect(currencyConflicts([plan({ costCapMicros: 1, costCapCurrency: "BRL" }), plan({ id: "p2", name: "Ok", costCapMicros: 1, costCapCurrency: "USD" })], [priced("USD")])).toEqual(["Essencial"]);
    expect(currencyConflicts([plan({ costCapMicros: 1, costCapCurrency: "BRL" })], [task("PLANNER")])).toEqual([]);
  });
  it("describes the allowance in words", () => {
    expect(allowanceText(plan())).toBe("500.000 tokens por mês");
    expect(allowanceText(plan({ totalTokens: 0 }))).toContain("IA não incluída");
    expect(allowanceText(plan({ mode: "SPLIT", totalTokens: null, inputTokens: 300_000, outputTokens: 100_000 }))).toBe("300.000 de entrada e 100.000 de saída por mês");
  });
});

describe("organization state and remaining allowance", () => {
  it("is spelled out in words for every case", () => {
    expect(organizationState(org({ enabled: false }), plan())).toMatchObject({ code: "OFF", label: "Desligada" });
    expect(organizationState(org({ quotaPlanId: null }), null)).toMatchObject({ code: "NO_PLAN", label: "IA não incluída no plano" });
    expect(organizationState(org(), plan({ archivedAt: "2026-11-01T00:00:00Z" }))).toMatchObject({ code: "NO_PLAN" });
    expect(organizationState(org(), plan({ totalTokens: 0 }))).toMatchObject({ code: "NOT_INCLUDED", label: "IA não incluída no plano" });
    expect(organizationState(org({ usedTokens: 500_000 }), plan())).toMatchObject({ code: "LIMIT_REACHED", label: "Limite do plano atingido", tone: "danger" });
    expect(organizationState(org({ usedTokens: 400_000, reservedTokens: 100_000 }), plan())).toMatchObject({ code: "LIMIT_REACHED" });
    expect(organizationState(org(), plan())).toMatchObject({ code: "ACTIVE", label: "Ativa", tone: "success" });
  });
  it("SPLIT plans are exhausted by either side", () => {
    const split = plan({ mode: "SPLIT", totalTokens: null, inputTokens: 1000, outputTokens: 200 });
    expect(organizationState(org({ usedInput: 100, usedOutput: 200 }), split).code).toBe("LIMIT_REACHED");
    expect(organizationState(org({ usedInput: 1000, usedOutput: 0 }), split).code).toBe("LIMIT_REACHED");
    expect(organizationState(org({ usedInput: 999, usedOutput: 199 }), split).code).toBe("ACTIVE");
  });
  it("SPLIT plans count what is reserved by calls in flight, and a reached cost cap shows the limit", () => {
    const split = plan({ mode: "SPLIT", totalTokens: null, inputTokens: 1000, outputTokens: 200 });
    expect(organizationState(org({ usedInput: 900, usedOutput: 0, reservedInput: 100 }), split).code).toBe("LIMIT_REACHED");
    expect(organizationState(org({ usedInput: 0, usedOutput: 150, reservedOutput: 50 }), split).code).toBe("LIMIT_REACHED");
    expect(organizationUsage(org({ usedInput: 500, usedOutput: 100, reservedInput: 100 }), split).remainingText).toBe("Restam 400 de entrada e 100 de saída");
    const capped = plan({ costCapMicros: 1_000_000, costCapCurrency: "USD" });
    expect(organizationState(org({ costMicros: 900_000, reservedCostMicros: 100_000, costCurrency: "USD" }), capped).code).toBe("LIMIT_REACHED");
    expect(organizationState(org({ costMicros: 900_000, costCurrency: "USD" }), capped).code).toBe("ACTIVE");
    expect(organizationState(org({ costMicros: 2_000_000, costCurrency: "BRL" }), capped).code).toBe("ACTIVE");
  });
  it("shows used, allowance, percentage and what remains; never a percentage without an allowance", () => {
    expect(organizationUsage(org(), plan())).toEqual({ percent: 25, text: "125.000 de 500.000 tokens", remainingText: "Restam 375.000 tokens" });
    expect(organizationUsage(org({ usedTokens: 900_000 }), plan()).percent).toBe(100);
    expect(organizationUsage(org(), null)).toEqual({ percent: null, text: "125.000 tokens usados no mês", remainingText: null });
    const split = organizationUsage(org({ usedInput: 500, usedOutput: 150 }), plan({ mode: "SPLIT", totalTokens: null, inputTokens: 1000, outputTokens: 200 }));
    expect(split.percent).toBe(75);
    expect(split.text).toBe("Entrada 500 de 1.000 · Saída 150 de 200");
  });
});

describe("messages and banners", () => {
  it("banners come in a fixed order and each only when true", () => {
    expect(panelBanners({ envKill: false, secretsKeyOk: true, panelKill: false, canWrite: true })).toEqual([]);
    const all = panelBanners({ envKill: true, secretsKeyOk: false, panelKill: true, canWrite: false });
    expect(all.map((b) => b.id)).toEqual(["env-kill", "no-secret", "panel-kill", "no-2fa"]);
    expect(all[0].text).toBe("A IA está desligada por variável de ambiente (AI_PLANNER_DISABLED). Nenhuma chamada será feita.");
    expect(all[1].text).toContain("não é possível salvar chaves. Nada foi guardado.");
    expect(all[3].text).toBe("Ative a verificação em duas etapas em Minha conta para alterar a IA.");
  });
  it("a failed test names the code, never the provider's own text", () => {
    expect(failureText("AUTH")).toBe("chave recusada pelo provedor (AUTH)");
    expect(failureText("TIMEOUT")).toContain("(TIMEOUT)");
    expect(lastTestText({ lastTestAt: null, lastTestOk: null, lastTestCode: null }, String)).toBe("Ainda não testada.");
    expect(lastTestText({ lastTestAt: "2026-11-05T12:00:00Z", lastTestOk: false, lastTestCode: "AUTH" }, () => "05/11/2026")).toBe("Conexão testada em 05/11/2026: falhou (AUTH).");
    expect(lastTestText({ lastTestAt: "2026-11-05T12:00:00Z", lastTestOk: true, lastTestCode: null }, () => "05/11/2026")).toBe("Conexão testada em 05/11/2026: ok.");
  });
  it("tabs fall back to the first, months run newest first across years", () => {
    expect(tabOf(undefined)).toBe("provedores");
    expect(tabOf("uso")).toBe("uso");
    expect(tabOf("<script>")).toBe("provedores");
    expect(recentMonths("2026-02", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
    expect(recentMonths("2026-11", 12)).toHaveLength(12);
    expect(tasksUsing("openai", [task("PLANNER", { providerKind: "openai" }), task("ADJUSTMENTS")])).toEqual(["Planejador de treino"]);
  });
});

describe("components never print a key", () => {
  const props = { canWrite: true, secretsOk: true, callsBlocked: false, mockEnabled: false };

  it("provider cards: masked tail, who and when, a write-only password field, no key anywhere", () => {
    const page = html(createElement(ProvidersPanel, { ...props, connections: [connection("openai", { lastTestAt: "2026-11-05T17:10:00.000Z", lastTestOk: true })], tasks: [task("PLANNER", { providerKind: "openai", modelId: "m" }), task("ADJUSTMENTS")] }));
    expect(page).toContain("OpenAI");
    expect(page).toContain("Anthropic");
    expect(page).toContain("Google (Gemini)");
    expect(page).toContain("••••cdef");
    expect(page).toContain("gestor@example.test");
    expect(page).toContain("Conectado");
    expect(page).toContain("Não conectado");
    expect(page).toContain("Usado por");
    expect(page).toContain("Planejador de treino");
    expect(page).not.toContain(CANARY);
    // the two unconnected providers offer "Conectar" with a password field that is never prefilled
    expect(page.match(/type="password"/g)?.length).toBe(2);
    expect(page).not.toMatch(/type="password"[^>]*value="[^"]/);
    expect(page).toContain('autoComplete="off"');
    expect(page).toContain("O valor é gravado cifrado e nunca é mostrado de novo.");
    expect(page).toContain("Testar conexão");
    expect(page).toContain("Remover");
    expect(page).not.toContain("Simulado");
  });
  it("without the server secret or two-factor the fields are disabled; with a kill switch the tests are", () => {
    const base = { connections: [connection("anthropic")], tasks: [task("PLANNER"), task("ADJUSTMENTS")] };
    const noSecret = html(createElement(ProvidersPanel, { ...props, ...base, secretsOk: false }));
    expect(noSecret).toMatch(/<input[^>]*type="password"[^>]*disabled/);
    const no2fa = html(createElement(ProvidersPanel, { ...props, ...base, canWrite: false }));
    expect(no2fa).toMatch(/<input[^>]*type="password"[^>]*disabled/);
    const blocked = html(createElement(ProvidersPanel, { ...props, ...base, callsBlocked: true }));
    expect(blocked).toMatch(/<button[^>]*disabled[^>]*>Testar conexão/);
    expect(blocked).toContain("bloqueados");
  });
  it("the simulated provider card appears only where the environment allows it", () => {
    const withMock = html(createElement(ProvidersPanel, { ...props, mockEnabled: true, connections: [], tasks: [task("PLANNER"), task("ADJUSTMENTS")] }));
    expect(withMock).toContain("Simulado (testes)");
    expect(withMock).toContain("Nunca ligue em produção");
  });

  it("model cards: nothing is prefilled, only connected providers are offered, prices are optional and say what no price means", () => {
    const page = html(createElement(ModelsPanel, { ...props, tasks: [task("PLANNER"), task("ADJUSTMENTS")], connections: [connection("anthropic")] }));
    expect(page).toContain("Planejador de treino");
    expect(page).toContain("Ajustes assistidos");
    expect(page).toContain("Anthropic");
    expect(page).not.toMatch(/<option[^>]*value="openai"/);
    expect(page).not.toMatch(/<option[^>]*value="mock"/);
    expect(page).not.toMatch(/gpt-|claude-|gemini-/i);
    expect(page).toContain("Sem preço digitado, o custo aparece como desconhecido e não há limite por custo.");
    expect(page).toContain("Preço por 1 milhão de tokens (opcional)");
    expect(page).toContain("Listar modelos do provedor");
    expect(page).toContain("Testar modelo");
    expect(page).toContain("sem nenhum dado de aluno");
    expect(page).toContain("Enviar nomes dos exercícios da biblioteca do sistema");
    expect(page.match(/Enviar nomes dos exercícios/g)).toHaveLength(1);
    expect(page).toMatch(/<button[^>]*disabled[^>]*>Listar modelos do provedor/);
    const priced = html(createElement(ModelsPanel, { ...props, tasks: [task("PLANNER", { providerKind: "anthropic", modelId: "x", currency: "USD", priceInputMicrosPerMillion: 150_000, priceOutputMicrosPerMillion: 600_000 }), task("ADJUSTMENTS")], connections: [connection("anthropic")] }));
    expect(priced).toContain("0,15");
    expect(priced).toContain("0,6");
    expect(priced).toContain("o custo passa a ser calculado por chamada");
  });

  it("plans: the cost cap is disabled with its reason until prices exist; a currency conflict is announced", () => {
    const noPrice = html(createElement(PlansPanel, { canWrite: true, plans: [plan()], tasks: [task("PLANNER"), task("ADJUSTMENTS")] }));
    expect(noPrice).toContain("Essencial");
    expect(noPrice).toContain("500.000 tokens por mês");
    expect(noPrice).toContain("Sem limite por custo");
    expect(noPrice).toContain("Quando o plano de cobrança (SaaS) existir");
    const conflict = html(createElement(PlansPanel, { canWrite: true, plans: [plan({ costCapMicros: 5_000_000, costCapCurrency: "BRL" })], tasks: [task("PLANNER", { currency: "USD", priceInputMicrosPerMillion: 1, priceOutputMicrosPerMillion: 1 }), task("ADJUSTMENTS")] }));
    expect(conflict).toContain("moeda diferente");
    expect(html(createElement(PlansPanel, { canWrite: true, plans: [], tasks: [] }))).toContain("Nenhum plano ainda");
  });

  it("enabling an organization whose plan is archived offers the plan select", () => {
    const archived = plan({ id: "old", name: "Antigo", archivedAt: "2026-11-01T00:00:00Z" });
    const page = html(createElement(OrganizationsPanel, { organizations: [org({ quotaPlanId: "old", quotaPlanName: "Antigo", enabled: false })], plans: [archived, plan()], canWrite: true, ackText: AI_ORG_ACK_TEXT }));
    expect(page).toContain("Antigo (arquivado)");
  });

  it("organizations: switch, plan select, progress with text, state in words", () => {
    const page = html(createElement(OrganizationsPanel, { organizations: [org(), org({ organizationId: "o2", organizationName: "Studio B", enabled: false, quotaPlanId: null, quotaPlanName: null, usedTokens: 0, version: 0 })], plans: [plan()], canWrite: true, ackText: AI_ORG_ACK_TEXT }));
    expect(page).toContain("Studio A");
    expect(page).toContain('role="switch"');
    expect(page).toContain("<progress");
    expect(page).toContain("125.000 de 500.000 tokens");
    expect(page).toContain("Restam 375.000 tokens");
    expect(page).toContain("Ativa");
    expect(page).toContain("Desligada");
    expect(page).toContain("Sem plano");
    expect(page).toContain("nunca vê chaves, provedores, modelos nem custos");
    expect(page).not.toContain(AI_ORG_ACK_TEXT); // only after the gestor starts enabling
  });

  it("usage: unknown cost is a dash with its footnote; circuits and the audit trail are listed without any secret", () => {
    const rows: UsageRow[] = [
      { organizationId: "o1", organizationName: "Studio A", task: "PLANNER", requests: 3, cacheHits: 1, errors: 0, inputTokens: 9000, outputTokens: 4000, costMicros: null, currency: null, unpricedCalls: 3, mixedCurrency: false },
      { organizationId: "o2", organizationName: "Studio B", task: "PLANNER", requests: 1, cacheHits: 0, errors: 1, inputTokens: 1000, outputTokens: 500, costMicros: 1_250_000, currency: "USD", unpricedCalls: 0, mixedCurrency: false },
      { organizationId: "o3", organizationName: "Studio C", task: "ADJUSTMENTS", requests: 2, cacheHits: 0, errors: 0, inputTokens: 10, outputTokens: 5, costMicros: 500_000, currency: "USD", unpricedCalls: 1, mixedCurrency: false },
    ];
    const circuits: CircuitView[] = [{ providerKind: "openai", modelId: "m-1", state: "OPEN", consecutiveFailures: 5, since: "2026-11-05T12:00:00.000Z" }];
    const page = html(createElement(UsagePanel, { month: "2026-11", months: recentMonths("2026-11"), rows, circuits, audit: [{ id: "a1", action: "AI_PROVIDER_ROTATED", createdAt: "2026-11-05T12:00:00.000Z", actorEmail: "gestor@example.test", subject: "openai" }] }));
    expect(page).toContain("novembro de 2026");
    expect(page).toContain("custo desconhecido");
    expect(page).toMatch(/Custo[\s\S]*—/);
    expect(page).toMatch(/US\$\s?1,25/);
    expect(page).toMatch(/US\$\s?0,50 \(parcial\)/);
    expect(page).toContain("soma só as chamadas que tinham preço digitado");
    expect(page).toContain("Aberto (chamadas suspensas)");
    expect(page).toContain("Chave trocada");
    expect(page).toContain("nunca entram nele");
    expect(page).not.toContain(CANARY);
  });

  it("the frame explains honestly what is sent and what it costs, and the kill switch shows who and when", () => {
    const frame = html(createElement(AiPanelFrame, { tab: "uso", facts: { envKill: true, secretsKeyOk: false, panelKill: true, canWrite: false }, kill: { byEmail: "gestor@example.test", at: "2026-11-05T12:00:00.000Z" } } as never, createElement("p", null, "conteúdo")));
    expect(frame).toContain("Codificar reduz o risco de reidentificação, mas não garante que ela seja impossível.");
    expect(frame).toContain("sem preço é “desconhecido”, nunca estimado");
    expect(frame).toContain("AI_PLANNER_DISABLED");
    expect(frame).toContain("Interromper todas as chamadas de IA");
    expect(frame).toContain("Interrompida por gestor@example.test");
    expect(frame).toContain('aria-current="page"');
    expect(frame).toContain("conteúdo");
    const on = html(createElement(KillSwitchCard, { on: false, byEmail: null, at: null, canWrite: false }));
    expect(on).toMatch(/<button[^>]*disabled/);
  });
});
