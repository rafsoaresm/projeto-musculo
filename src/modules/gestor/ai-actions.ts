"use server";
import { revalidatePath } from "next/cache";
import { aiPlatformFor } from "@/db/ai-platform";
import { isPlatformAdmin } from "@/db/platform";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { AI_ORG_ACK_VERSION } from "@/modules/prescricao/planejador/copy";
import { loadAiEnv } from "@/modules/prescricao/planejador/env";
import { costCapRule, parsePlanForm, parseTaskForm, type PlanFormValues, type TaskFormValues } from "./ai-view";
import { gestorAi, type ServiceResult } from "./ai-service";

/**
 * Server actions of the gestor's "Inteligência artificial" panel. Every one asks the session for an ACTIVE platform manager first (the
 * page is not trusted: a layout does not re-run on client navigation) and the repository checks the manager again in every statement.
 * Writes also need two-factor on the actor's account. Arguments are untrusted: they are validated here and again by the repository and
 * the database. No answer ever contains a key, a fragment of one or a message from a provider.
 */
export type ActionResult<T = Record<never, never>> = ({ ok: true; message: string } & T) | { ok: false; message: string };

const PATH = "/gestor/inteligencia-artificial";
const NO_2FA = "Ative a verificação em duas etapas em Minha conta para alterar a IA.";
const DENIED = "Sem permissão.";
const done = () => revalidatePath(PATH);
const strip = <T extends Record<string, unknown>>(r: ServiceResult<T>): ActionResult<Omit<T, "message" | "ok">> =>
  r.ok ? ({ ...r } as ActionResult<Omit<T, "message" | "ok">>) : { ok: false, message: r.message };

async function writerOrMessage(): Promise<{ ok: true; repo: ReturnType<typeof aiPlatformFor>; db: Awaited<ReturnType<typeof requirePlatformAdmin>>["db"]; context: { userId: string } } | { ok: false; message: string }> {
  const { db, context } = await requirePlatformAdmin();
  const repo = aiPlatformFor(db, context);
  if (await repo.canWrite()) return { ok: true, repo, db, context };
  return { ok: false, message: (await isPlatformAdmin(db, context.userId)) ? NO_2FA : DENIED };
}

// ---------- provider keys ----------

/** Connects the provider (first time) or rotates its key. The key is only read from this call and only kept encrypted. */
export async function connectProvider(kind: string, apiKey: string): Promise<ActionResult<{ rotated: boolean }>> {
  const { db, context } = await requirePlatformAdmin();
  const result = await gestorAi(db, context).connect(kind, apiKey);
  if (result.ok) done();
  return strip(result);
}
export async function removeProvider(kind: string): Promise<ActionResult> {
  const { db, context } = await requirePlatformAdmin();
  const result = await gestorAi(db, context).remove(kind);
  if (result.ok) done();
  return strip(result);
}
export async function testProviderConnection(kind: string): Promise<ActionResult<{ models: number }>> {
  const { db, context } = await requirePlatformAdmin();
  const result = await gestorAi(db, context).testConnection(kind);
  done();
  return strip(result);
}
export async function listProviderModels(kind: string): Promise<ActionResult<{ models: Array<{ id: string; label: string | null }> }>> {
  const { db, context } = await requirePlatformAdmin();
  const result = await gestorAi(db, context).listModels(kind);
  done();
  return strip(result);
}
export async function testTaskModel(task: string): Promise<ActionResult<{ latencyMs: number; inputTokens: number | null; outputTokens: number | null }>> {
  const { db, context } = await requirePlatformAdmin();
  const result = await gestorAi(db, context).testModel(task);
  done();
  return strip(result);
}

// ---------- kill switch ----------

export async function setKillSwitch(on: boolean): Promise<ActionResult> {
  const w = await writerOrMessage();
  if (!w.ok) return w;
  const changed = await w.repo.setKillSwitch(on === true, new Date());
  done();
  return changed
    ? { ok: true, message: on === true ? "Todas as chamadas de IA foram interrompidas." : "As chamadas de IA foram liberadas." }
    : { ok: false, message: DENIED };
}

// ---------- tasks ----------

export async function saveTask(task: string, values: TaskFormValues, expectedVersion: number): Promise<ActionResult> {
  const w = await writerOrMessage();
  if (!w.ok) return w;
  if (task !== "PLANNER" && task !== "ADJUSTMENTS") return { ok: false, message: "Tarefa desconhecida." };
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return { ok: false, message: "Atualize a página e tente de novo." };
  const parsed = parseTaskForm({
    enabled: values?.enabled === true, providerKind: String(values?.providerKind ?? ""), modelId: String(values?.modelId ?? ""),
    maxInputTokens: String(values?.maxInputTokens ?? ""), maxOutputTokens: String(values?.maxOutputTokens ?? ""), timeoutSeconds: String(values?.timeoutSeconds ?? ""),
    maxRetries: String(values?.maxRetries ?? ""), currency: String(values?.currency ?? ""), priceInput: String(values?.priceInput ?? ""),
    priceOutput: String(values?.priceOutput ?? ""), sendSystemExerciseNames: task === "ADJUSTMENTS" && values?.sendSystemExerciseNames === true,
  });
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const env = await loadAiEnv();
  const outcome = await w.repo.saveTask(
    task,
    { ...parsed.value, ceilings: { maxOutputTokens: env.hardMaxOutputTokens, timeoutMs: env.hardTimeoutMs }, mockAllowed: env.mockEnabled },
    expectedVersion,
    new Date(),
  );
  done();
  if (outcome === "saved") return { ok: true, message: "Configuração salva." };
  if (outcome === "conflict") return { ok: false, message: "Outro gestor alterou estas configurações. Atualize a página." };
  if (outcome === "provider_not_connected") return { ok: false, message: "Esse provedor não tem chave conectada. Conecte-o na aba Provedores." };
  return { ok: false, message: "Confira os campos: provedor, modelo e limites." };
}

// ---------- quota plans ----------

export async function savePlan(planId: string | null, values: PlanFormValues, expectedVersion: number | null): Promise<ActionResult<{ id: string }>> {
  const w = await writerOrMessage();
  if (!w.ok) return w;
  if (planId !== null && (typeof planId !== "string" || planId.length > 64)) return { ok: false, message: "Plano não encontrado." };
  if (planId !== null && (!Number.isInteger(expectedVersion) || (expectedVersion ?? 0) < 1)) return { ok: false, message: "Atualize a página e tente de novo." };
  const parsed = parsePlanForm({
    name: String(values?.name ?? ""), mode: String(values?.mode ?? ""), total: String(values?.total ?? ""), input: String(values?.input ?? ""),
    output: String(values?.output ?? ""), capPlanning: String(values?.capPlanning ?? ""), capAdjustment: String(values?.capAdjustment ?? ""),
    requestsPerMinute: String(values?.requestsPerMinute ?? ""), costCap: String(values?.costCap ?? ""), costCurrency: String(values?.costCurrency ?? ""),
  });
  if (!parsed.ok) return { ok: false, message: parsed.error };
  if (parsed.value.costCap) {
    // a cost cap exists only where prices were typed, in the one currency they use (never invented)
    const rule = costCapRule(await w.repo.getTasks());
    if (!rule.allowed) return { ok: false, message: rule.reason };
    if (rule.currency !== parsed.value.costCap.currency) return { ok: false, message: `O limite de custo deve estar em ${rule.currency}, a moeda dos preços digitados em Modelos.` };
  }
  const outcome = await w.repo.savePlan(planId, parsed.value, planId === null ? null : expectedVersion, new Date());
  done();
  if (outcome.ok) return { ok: true, id: outcome.id, message: planId === null ? "Plano criado." : "Plano salvo." };
  const text = {
    conflict: "Outro gestor alterou este plano. Atualize a página.",
    name_taken: "Já existe um plano com esse nome.",
    currency_mismatch: "A moeda do limite de custo difere da moeda dos preços digitados em Modelos.",
    not_found: "Este plano não existe ou já foi arquivado.",
    invalid: "Confira os campos do plano.",
  }[outcome.reason];
  return { ok: false, message: text };
}

export async function archivePlan(planId: string): Promise<ActionResult> {
  const w = await writerOrMessage();
  if (!w.ok) return w;
  if (typeof planId !== "string" || planId.length > 64) return { ok: false, message: "Plano não encontrado." };
  const archived = await w.repo.archivePlan(planId, new Date());
  done();
  return archived ? { ok: true, message: "Plano arquivado. Organizações que o usam ficam sem IA até receberem outro plano." } : { ok: false, message: "Este plano já estava arquivado ou não existe." };
}

// ---------- organizations ----------

export interface OrganizationChange {
  enabled?: boolean;
  /** `null` removes the plan; omitted leaves it. */
  quotaPlanId?: string | null;
  /** The gestor ticked the notice. Only the current version counts. */
  acknowledged?: boolean;
}

export async function setOrganizationAi(organizationId: string, change: OrganizationChange, expectedVersion: number): Promise<ActionResult> {
  const w = await writerOrMessage();
  if (!w.ok) return w;
  if (typeof organizationId !== "string" || organizationId.length === 0 || organizationId.length > 64) return { ok: false, message: "Organização não encontrada." };
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return { ok: false, message: "Atualize a página e tente de novo." };
  const next: { enabled?: boolean; quotaPlanId?: string | null; ackVersion?: string } = {};
  if (change?.enabled !== undefined) {
    next.enabled = change.enabled === true;
    if (next.enabled && change.acknowledged === true) next.ackVersion = AI_ORG_ACK_VERSION;
  }
  if (change?.quotaPlanId !== undefined) {
    if (change.quotaPlanId !== null && (typeof change.quotaPlanId !== "string" || change.quotaPlanId.length > 64)) return { ok: false, message: "Plano não encontrado." };
    next.quotaPlanId = change.quotaPlanId;
  }
  if (next.enabled === undefined && next.quotaPlanId === undefined) return { ok: false, message: "Nada para alterar." };
  const outcome = await w.repo.setOrganization(organizationId, next, expectedVersion, AI_ORG_ACK_VERSION, new Date());
  done();
  if (outcome === "saved") {
    return { ok: true, message: next.enabled === true ? "IA habilitada para a organização." : next.enabled === false ? "IA desligada para a organização. O histórico foi mantido." : "Plano de IA atribuído." };
  }
  const text = {
    conflict: "Outro gestor alterou esta organização. Atualize a página.",
    plan_required: "Escolha um plano de IA (não arquivado) antes de habilitar.",
    ack_required: "Confirme o aviso de anonimização para habilitar a IA.",
    not_found: "Organização não encontrada.",
  }[outcome];
  return { ok: false, message: text };
}
