/**
 * View models and form parsing of the gestor's "Inteligência artificial" panel (design V4 §3.12). Pure: no React, no database, no network.
 * Everything a component prints about state (organization state, remaining allowance, provider test messages, banners) is decided here so
 * it is tested without a browser; nothing here ever receives or returns a provider key.
 */
import type { OrganizationAiRow, PlanRow, TaskRow } from "@/db/ai-platform";
import type { ProviderErrorCode, RealProviderKind } from "@/modules/prescricao/planejador/provedores/port";
import type { Currency } from "@/modules/prescricao/planejador/quota";

export const CURRENCIES: readonly Currency[] = ["BRL", "USD", "EUR"];

const nf = new Intl.NumberFormat("pt-BR");
export const formatTokens = (n: number): string => nf.format(Math.max(0, Math.trunc(n)));

/** "1.000.000", "1 000 000" and "1000000" are the same number; anything else (decimals, signs, letters, empty) is not a token count. */
export function parseCount(text: unknown, min: number, max: number): number | null {
  if (typeof text === "number") return Number.isInteger(text) && text >= min && text <= max ? text : null;
  if (typeof text !== "string") return null;
  const t = text.trim().replace(/\s+/g, "");
  if (t === "") return null;
  const digits = /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : /^\d+$/.test(t) ? t : null;
  if (digits === null || digits.length > 15) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * A price typed by the gestor ("0,15" or "0.15" or "3") -> integer micro-units of the currency per 1M tokens. At most 6 decimals, never
 * negative, never an exponent. Empty means "not typed" (null), invalid means `undefined` so the caller can tell the two apart.
 */
export function parsePriceMicros(text: unknown): number | null | undefined {
  if (text === null || text === undefined) return null;
  if (typeof text !== "string") return undefined;
  const t = text.trim();
  if (t === "") return null;
  const m = /^(\d{1,9})(?:[.,](\d{1,6}))?$/.exec(t);
  if (!m) return undefined;
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  return Number.isSafeInteger(micros) && micros <= 1e12 ? micros : undefined;
}

export const priceToField = (micros: number | null): string => {
  if (micros === null) return "";
  const whole = Math.floor(micros / 1_000_000);
  const frac = String(micros % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole},${frac}` : String(whole);
};

export function formatMoney(micros: number, currency: Currency): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(micros / 1_000_000);
}

// ---------- forms -> repository inputs ----------

export interface TaskFormValues {
  enabled: boolean;
  providerKind: string;
  modelId: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  /** Seconds, as typed. */
  timeoutSeconds: string;
  maxRetries: string;
  currency: string;
  priceInput: string;
  priceOutput: string;
  sendSystemExerciseNames: boolean;
}
export type ParsedTask =
  | {
      ok: true;
      value: {
        enabled: boolean; providerKind: string | null; modelId: string | null; maxInputTokens: number; maxOutputTokens: number; timeoutMs: number;
        maxRetries: 0 | 1; prices: { currency: Currency; inputMicrosPerMillion: number; outputMicrosPerMillion: number } | null; sendSystemExerciseNames: boolean;
      };
    }
  | { ok: false; error: string };

export function parseTaskForm(v: TaskFormValues): ParsedTask {
  const providerKind = v.providerKind.trim() || null;
  const modelId = v.modelId.trim() || null;
  if ((providerKind === null) !== (modelId === null)) return { ok: false, error: "Escolha o provedor e informe o modelo, ou deixe os dois vazios." };
  if (v.enabled && providerKind === null) return { ok: false, error: "Para ligar a tarefa, escolha o provedor e o modelo." };
  if (modelId !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(modelId)) return { ok: false, error: "O identificador do modelo só pode ter letras, números e . _ : - (até 80 caracteres)." };
  const maxInputTokens = parseCount(v.maxInputTokens, 500, 200_000);
  if (maxInputTokens === null) return { ok: false, error: "Máximo de tokens de entrada: um número inteiro de 500 a 200.000." };
  const maxOutputTokens = parseCount(v.maxOutputTokens, 100, 32_000);
  if (maxOutputTokens === null) return { ok: false, error: "Máximo de tokens de saída: um número inteiro de 100 a 32.000." };
  const seconds = parseCount(v.timeoutSeconds, 2, 120);
  if (seconds === null) return { ok: false, error: "Tempo limite: de 2 a 120 segundos." };
  if (v.maxRetries !== "0" && v.maxRetries !== "1") return { ok: false, error: "Novas tentativas: 0 ou 1." };
  const input = parsePriceMicros(v.priceInput);
  const output = parsePriceMicros(v.priceOutput);
  if (input === undefined || output === undefined) return { ok: false, error: "Preço: use números como 0,15 (até 6 casas decimais)." };
  if ((input === null) !== (output === null)) return { ok: false, error: "Digite os dois preços (entrada e saída) ou nenhum." };
  let prices: { currency: Currency; inputMicrosPerMillion: number; outputMicrosPerMillion: number } | null = null;
  if (input !== null && output !== null) {
    if (!(CURRENCIES as readonly string[]).includes(v.currency)) return { ok: false, error: "Escolha a moeda dos preços." };
    prices = { currency: v.currency as Currency, inputMicrosPerMillion: input, outputMicrosPerMillion: output };
  }
  return {
    ok: true,
    value: {
      enabled: v.enabled, providerKind, modelId, maxInputTokens, maxOutputTokens, timeoutMs: seconds * 1000, maxRetries: v.maxRetries === "1" ? 1 : 0, prices,
      sendSystemExerciseNames: v.sendSystemExerciseNames,
    },
  };
}

export interface PlanFormValues {
  name: string;
  mode: string;
  total: string;
  input: string;
  output: string;
  capPlanning: string;
  capAdjustment: string;
  requestsPerMinute: string;
  /** Empty = no cost cap. */
  costCap: string;
  costCurrency: string;
}
export type ParsedPlan =
  | {
      ok: true;
      value: {
        name: string;
        allowance: { mode: "TOTAL"; total: number } | { mode: "SPLIT"; input: number; output: number };
        perRequestCapPlanning: number; perRequestCapAdjustment: number; requestsPerMinute: number;
        costCap: { micros: number; currency: Currency } | null;
      };
    }
  | { ok: false; error: string };

export function parsePlanForm(v: PlanFormValues): ParsedPlan {
  const name = v.name.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 60) return { ok: false, error: "O nome do plano tem de 1 a 60 caracteres." };
  const cap = (value: string) => parseCount(value, 0, 1e9);
  const capPlanning = cap(v.capPlanning);
  const capAdjustment = cap(v.capAdjustment);
  if (capPlanning === null || capAdjustment === null) return { ok: false, error: "Limite por pedido: número inteiro de tokens (0 = tarefa não incluída)." };
  const rpm = parseCount(v.requestsPerMinute, 1, 120);
  if (rpm === null) return { ok: false, error: "Pedidos por minuto: de 1 a 120." };
  let allowance: { mode: "TOTAL"; total: number } | { mode: "SPLIT"; input: number; output: number };
  if (v.mode === "SPLIT") {
    const input = parseCount(v.input, 0, 1e12);
    const output = parseCount(v.output, 0, 1e12);
    if (input === null || output === null) return { ok: false, error: "Franquia mensal: informe tokens de entrada e de saída (inteiros, 0 permitido)." };
    allowance = { mode: "SPLIT", input, output };
  } else if (v.mode === "TOTAL") {
    const total = parseCount(v.total, 0, 1e12);
    if (total === null) return { ok: false, error: "Franquia mensal: número inteiro de tokens (0 = IA não incluída)." };
    allowance = { mode: "TOTAL", total };
  } else {
    return { ok: false, error: "Escolha o tipo de franquia." };
  }
  let costCap: { micros: number; currency: Currency } | null = null;
  const typed = parsePriceMicros(v.costCap);
  if (typed === undefined) return { ok: false, error: "Limite de custo mensal: use números como 25,00." };
  if (typed !== null) {
    if (!(CURRENCIES as readonly string[]).includes(v.costCurrency)) return { ok: false, error: "Escolha a moeda do limite de custo." };
    costCap = { micros: typed, currency: v.costCurrency as Currency };
  }
  return { ok: true, value: { name, allowance, perRequestCapPlanning: capPlanning, perRequestCapAdjustment: capAdjustment, requestsPerMinute: rpm, costCap } };
}

// ---------- cost cap rules ----------

/** Currencies of the tasks that have typed prices. A cost cap is only meaningful (and only allowed) when exactly one currency is in use. */
export function pricedCurrencies(tasks: readonly TaskRow[]): Currency[] {
  const set = new Set<Currency>();
  for (const t of tasks) if (t.currency && t.priceInputMicrosPerMillion !== null) set.add(t.currency);
  return [...set].sort();
}
export type CostCapRule = { allowed: true; currency: Currency } | { allowed: false; reason: string };
export function costCapRule(tasks: readonly TaskRow[]): CostCapRule {
  const currencies = pricedCurrencies(tasks);
  if (currencies.length === 0) {
    return { allowed: false, reason: "Sem preço digitado em Modelos o custo é desconhecido, então não há limite por custo. Digite os preços de uma tarefa para liberar este campo." };
  }
  if (currencies.length > 1) {
    return { allowed: false, reason: `As tarefas têm preços em moedas diferentes (${currencies.join(" e ")}). O limite por custo exige uma só moeda.` };
  }
  return { allowed: true, currency: currencies[0] };
}
/** Plans whose cost cap is in a currency other than the one the tasks are priced in: the gate would refuse them ("IA não incluída"). */
export function currencyConflicts(plans: readonly PlanRow[], tasks: readonly TaskRow[]): string[] {
  const currencies = pricedCurrencies(tasks);
  if (currencies.length === 0) return [];
  return plans.filter((p) => !p.archivedAt && p.costCapMicros !== null && p.costCapCurrency !== null && !(currencies.length === 1 && currencies[0] === p.costCapCurrency)).map((p) => p.name);
}

// ---------- plans ----------

export function allowanceText(plan: Pick<PlanRow, "mode" | "totalTokens" | "inputTokens" | "outputTokens">): string {
  if (plan.mode === "TOTAL") return (plan.totalTokens ?? 0) === 0 ? "0 tokens (IA não incluída)" : `${formatTokens(plan.totalTokens ?? 0)} tokens por mês`;
  return `${formatTokens(plan.inputTokens ?? 0)} de entrada e ${formatTokens(plan.outputTokens ?? 0)} de saída por mês`;
}
export const planIsZero = (plan: Pick<PlanRow, "mode" | "totalTokens" | "inputTokens" | "outputTokens">): boolean =>
  plan.mode === "TOTAL" ? (plan.totalTokens ?? 0) <= 0 : (plan.inputTokens ?? 0) <= 0 || (plan.outputTokens ?? 0) <= 0;

// ---------- organizations ----------

export type OrgStateCode = "ACTIVE" | "OFF" | "NO_PLAN" | "NOT_INCLUDED" | "LIMIT_REACHED";
export interface OrgState {
  code: OrgStateCode;
  label: string;
  tone: "success" | "neutral" | "warning" | "danger";
}
export interface OrgUsage {
  /** 0..100, or null when there is no allowance to measure against. */
  percent: number | null;
  /** "12.400 de 500.000 tokens" / "Entrada 1.000 de 2.000 · Saída 300 de 800". */
  text: string;
  remainingText: string | null;
}

export function organizationUsage(org: OrganizationAiRow, plan: PlanRow | null): OrgUsage {
  if (!plan || planIsZero(plan)) return { percent: null, text: `${formatTokens(org.usedTokens)} tokens usados no mês`, remainingText: null };
  if (plan.mode === "TOTAL") {
    const total = plan.totalTokens ?? 0;
    const left = Math.max(0, total - org.usedTokens - org.reservedTokens);
    return {
      percent: Math.min(100, Math.round(((org.usedTokens + org.reservedTokens) / total) * 100)),
      text: `${formatTokens(org.usedTokens)} de ${formatTokens(total)} tokens`,
      remainingText: `Restam ${formatTokens(left)} tokens`,
    };
  }
  const input = plan.inputTokens ?? 0;
  const output = plan.outputTokens ?? 0;
  const worst = Math.max(org.usedInput / input, org.usedOutput / output);
  return {
    percent: Math.min(100, Math.round(worst * 100)),
    text: `Entrada ${formatTokens(org.usedInput)} de ${formatTokens(input)} · Saída ${formatTokens(org.usedOutput)} de ${formatTokens(output)}`,
    remainingText: `Restam ${formatTokens(Math.max(0, input - org.usedInput))} de entrada e ${formatTokens(Math.max(0, output - org.usedOutput))} de saída`,
  };
}

export function organizationState(org: OrganizationAiRow, plan: PlanRow | null): OrgState {
  if (!org.enabled) return { code: "OFF", label: "Desligada", tone: "neutral" };
  if (!plan || plan.archivedAt) return { code: "NO_PLAN", label: "IA não incluída no plano", tone: "warning" };
  if (planIsZero(plan)) return { code: "NOT_INCLUDED", label: "IA não incluída no plano", tone: "warning" };
  const exhausted =
    plan.mode === "TOTAL"
      ? org.usedTokens + org.reservedTokens >= (plan.totalTokens ?? 0)
      : org.usedInput >= (plan.inputTokens ?? 0) || org.usedOutput >= (plan.outputTokens ?? 0);
  if (exhausted) return { code: "LIMIT_REACHED", label: "Limite do plano atingido", tone: "danger" };
  return { code: "ACTIVE", label: "Ativa", tone: "success" };
}

// ---------- providers: what a test says ----------

const TEST_REASON: Record<ProviderErrorCode, string> = {
  AUTH: "chave recusada pelo provedor",
  RATE_LIMIT: "limite de pedidos do provedor",
  PROVIDER_QUOTA: "saldo ou cota do provedor esgotados",
  TIMEOUT: "o provedor não respondeu a tempo",
  NETWORK: "não foi possível alcançar o provedor",
  BAD_REQUEST: "pedido recusado pelo provedor",
  MODEL_NOT_FOUND: "modelo não encontrado neste provedor",
  INVALID_JSON: "resposta fora do formato esperado",
  TRUNCATED: "resposta cortada pelo limite de tokens de saída",
  REFUSED: "o provedor se recusou a responder",
  SERVER_ERROR: "erro no serviço do provedor",
  UNKNOWN: "falha desconhecida",
};
export const failureText = (code: ProviderErrorCode): string => `${TEST_REASON[code] ?? TEST_REASON.UNKNOWN} (${code})`;

export function lastTestText(row: { lastTestAt: string | null; lastTestOk: boolean | null; lastTestCode: string | null }, formatDateTime: (iso: string) => string): string {
  if (!row.lastTestAt) return "Ainda não testada.";
  return row.lastTestOk ? `Conexão testada em ${formatDateTime(row.lastTestAt)}: ok.` : `Conexão testada em ${formatDateTime(row.lastTestAt)}: falhou${row.lastTestCode ? ` (${row.lastTestCode})` : ""}.`;
}

/** Which tasks use a provider (the panel refuses to remove a key that is in use). */
export function tasksUsing(kind: string, tasks: readonly TaskRow[]): string[] {
  return tasks.filter((t) => t.providerKind === kind).map((t) => TASK_LABEL[t.task]);
}
export const TASK_LABEL = { PLANNER: "Planejador de treino", ADJUSTMENTS: "Ajustes assistidos" } as const;
export const PROVIDER_ORDER: readonly RealProviderKind[] = ["openai", "anthropic", "google"];

// ---------- banners ----------

export interface PanelFacts {
  envKill: boolean;
  secretsKeyOk: boolean;
  panelKill: boolean;
  canWrite: boolean;
}
export interface Banner {
  id: string;
  tone: "info" | "warning";
  text: string;
}
/** In this order; each is shown only when true. Calls to a provider are blocked while the first or the third is on. */
export function panelBanners(f: PanelFacts): Banner[] {
  const out: Banner[] = [];
  if (f.envKill) out.push({ id: "env-kill", tone: "warning", text: "A IA está desligada por variável de ambiente (AI_PLANNER_DISABLED). Nenhuma chamada será feita." });
  if (!f.secretsKeyOk) {
    out.push({
      id: "no-secret",
      tone: "warning",
      text: "A chave de criptografia do servidor (AI_SECRETS_KEY) não está configurada: não é possível salvar chaves. Nada foi guardado.",
    });
  }
  if (f.panelKill) out.push({ id: "panel-kill", tone: "warning", text: "A IA está interrompida pelo interruptor geral abaixo. Nenhuma chamada será feita, nem os testes deste painel." });
  if (!f.canWrite) out.push({ id: "no-2fa", tone: "warning", text: "Ative a verificação em duas etapas em Minha conta para alterar a IA." });
  return out;
}
/** Provider calls (tests, model list) are blocked by either switch. */
export const callsBlocked = (f: Pick<PanelFacts, "envKill" | "panelKill">): boolean => f.envKill || f.panelKill;

// ---------- months ----------

/** The last `count` month keys ending at `current` (YYYY-MM), newest first. */
export function recentMonths(current: string, count = 12): string[] {
  const [y, m] = current.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}
export const monthLabel = (key: string): string => {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
};

export const TABS = [
  { slug: "provedores", label: "Provedores" },
  { slug: "modelos", label: "Modelos" },
  { slug: "planos", label: "Planos de IA" },
  { slug: "organizacoes", label: "Organizações" },
  { slug: "uso", label: "Uso" },
] as const;
export type TabSlug = (typeof TABS)[number]["slug"];
export const tabOf = (raw: string | undefined): TabSlug => TABS.find((t) => t.slug === raw)?.slug ?? "provedores";
