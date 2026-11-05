import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import { aiPlatformFor, type TaskRow } from "@/db/ai-platform";
import { aiPlatformKeyFor } from "@/db/ai-planning";
import { isPlatformAdmin } from "@/db/platform";
import type { AiEnv } from "@/modules/prescricao/planejador/config";
import { loadAiEnv } from "@/modules/prescricao/planejador/env";
import { buildProviderPayload } from "@/modules/prescricao/planejador/privacy";
import { MODEL_TEST_SCHEMA, MODEL_TEST_SCHEMA_NAME, MODEL_TEST_SYSTEM_PROMPT, MODEL_TEST_USER } from "@/modules/prescricao/planejador/prompt";
import { callWithPolicy } from "@/modules/prescricao/planejador/provedores/policy";
import { isRealProvider, type AiTask, type CallSettings, type PlannerProvider, type ProviderKind, type RealProviderKind } from "@/modules/prescricao/planejador/provedores/port";
import { providerFor } from "@/modules/prescricao/planejador/provedores/registry";
import { openSecret, sealSecret, SecretsError, validApiKey } from "@/modules/prescricao/planejador/secrets";
import { failureText } from "./ai-view";

/**
 * What the gestor panel does with a provider: store a key, test it, list models, test a model. None of these calls carries student data:
 * "Testar conexão" and "Listar modelos" are body-less GETs of the models endpoint; "Testar modelo" sends a constant prompt that asks for
 * `{"ok":true}`, built through the same privacy choke point as every other request (an empty deny-list, because there is no student).
 *
 * Both kill switches (environment and panel) block every call made here. A key is decrypted only inside the function that uses it and is
 * never part of a return value, an error or a log; messages carry a provider error CODE, never text from the provider.
 */
export interface GestorAiDeps {
  env?: AiEnv;
  fetchImpl?: typeof fetch;
  providers?: Partial<Record<ProviderKind, PlannerProvider>>;
  now?: () => Date;
}
export type ServiceResult<T = Record<never, never>> = ({ ok: true; message: string } & T) | { ok: false; message: string; reason: ServiceFailure };
export type ServiceFailure = "denied" | "no_two_factor" | "blocked" | "no_secret" | "not_connected" | "unreadable" | "invalid" | "too_soon" | "not_mapped" | "failed";

/** One model test per task every few seconds: each one spends tokens outside any organization's ledger. */
export const MODEL_TEST_INTERVAL_MS = 10_000;

export function gestorAi(db: D1Database, context: { userId: string }, deps: GestorAiDeps = {}) {
  const repo = aiPlatformFor(db, context);
  const now = () => (deps.now ?? (() => new Date()))();
  const envOf = async (): Promise<AiEnv> => deps.env ?? (await loadAiEnv());
  const providerOf = (kind: ProviderKind): PlannerProvider => deps.providers?.[kind] ?? providerFor(kind);

  /** An active manager with two-factor; otherwise says which of the two is missing. */
  async function writer(): Promise<{ ok: true } | { ok: false; reason: ServiceFailure; message: string }> {
    if (await repo.canWrite()) return { ok: true };
    return (await isPlatformAdmin(db, context.userId))
      ? { ok: false, reason: "no_two_factor", message: "Ative a verificação em duas etapas em Minha conta para alterar a IA." }
      : { ok: false, reason: "denied", message: "Sem permissão." };
  }

  /** Common preconditions of a provider call: a writer, and neither switch on. */
  async function ready(): Promise<{ ok: true; env: AiEnv } | { ok: false; reason: ServiceFailure; message: string }> {
    const w = await writer();
    if (!w.ok) return w;
    const env = await envOf();
    if (env.killSwitch) return { ok: false, reason: "blocked", message: "A IA está desligada por variável de ambiente (AI_PLANNER_DISABLED). Nenhuma chamada foi feita." };
    if ((await repo.getSettings()).killSwitch) return { ok: false, reason: "blocked", message: "A IA está interrompida pelo interruptor geral. Nenhuma chamada foi feita." };
    return { ok: true, env };
  }

  async function keyFor(kind: RealProviderKind, env: AiEnv): Promise<{ ok: true; apiKey: string } | { ok: false; reason: ServiceFailure; message: string }> {
    if (!env.secrets) return { ok: false, reason: "no_secret", message: "A chave de criptografia do servidor (AI_SECRETS_KEY) não está configurada. Nenhuma chamada foi feita." };
    const sealed = await aiPlatformKeyFor(db, context).readKeyForTest(kind);
    if (!sealed) return { ok: false, reason: "not_connected", message: "Este provedor não tem chave conectada." };
    try {
      return { ok: true, apiKey: await openSecret(sealed, kind, env.secrets) };
    } catch {
      return { ok: false, reason: "unreadable", message: "Não foi possível ler a chave guardada (a chave de criptografia do servidor mudou?). Cole a chave de novo para trocá-la." };
    }
  }

  return {
    /** Stores (or rotates) a key. Nothing is stored without `AI_SECRETS_KEY`; the key never appears in the answer. */
    async connect(kind: unknown, apiKey: unknown): Promise<ServiceResult<{ rotated: boolean }>> {
      if (typeof kind !== "string" || !isRealProvider(kind)) return { ok: false, reason: "invalid", message: "Provedor desconhecido." };
      const w = await writer();
      if (!w.ok) return w;
      const env = await envOf();
      if (!env.secrets) {
        return { ok: false, reason: "no_secret", message: "A chave de criptografia do servidor (AI_SECRETS_KEY) não está configurada: não é possível salvar chaves. Nada foi guardado." };
      }
      if (validApiKey(apiKey) === null) return { ok: false, reason: "invalid", message: "A chave não parece válida: uma única sequência de 8 a 512 caracteres, sem espaços." };
      let sealed;
      try {
        sealed = await sealSecret(apiKey, kind, env.secrets);
      } catch (error) {
        return { ok: false, reason: error instanceof SecretsError && error.code === "INPUT_INVALID" ? "invalid" : "no_secret", message: "Não foi possível cifrar a chave. Nada foi guardado." };
      }
      const outcome = await repo.saveConnection(kind, sealed, now());
      if (outcome === "denied") return { ok: false, reason: "denied", message: "Sem permissão." };
      return { ok: true, rotated: outcome === "rotated", message: outcome === "rotated" ? "Chave trocada. O valor foi gravado cifrado e não será mostrado de novo." : "Provedor conectado. O valor foi gravado cifrado e não será mostrado de novo." };
    },

    async remove(kind: unknown): Promise<ServiceResult> {
      if (typeof kind !== "string" || !isRealProvider(kind)) return { ok: false, reason: "invalid", message: "Provedor desconhecido." };
      const w = await writer();
      if (!w.ok) return w;
      const outcome = await repo.removeConnection(kind);
      if (outcome === "removed") return { ok: true, message: "Chave removida." };
      if (outcome === "mapped") {
        const tasks = await repo.getTasks();
        const using = tasks.filter((t) => t.providerKind === kind).map((t) => (t.task === "PLANNER" ? "Planejador de treino" : "Ajustes assistidos"));
        return { ok: false, reason: "invalid", message: `Este provedor é usado por: ${using.join(", ")}. Escolha outro provedor na aba Modelos antes de remover.` };
      }
      return { ok: false, reason: outcome === "not_found" ? "not_connected" : "denied", message: outcome === "not_found" ? "Este provedor já não tem chave." : "Sem permissão." };
    },

    /** "Testar conexão": list the provider's models. No student data, no body. The result is kept on the connection and audited. */
    async testConnection(kind: unknown): Promise<ServiceResult<{ models: number }>> {
      if (typeof kind !== "string" || !isRealProvider(kind)) return { ok: false, reason: "invalid", message: "Provedor desconhecido." };
      const pre = await ready();
      if (!pre.ok) return pre;
      const key = await keyFor(kind, pre.env);
      if (!key.ok) return key;
      const result = await providerOf(kind).listModels(key.apiKey, deps.fetchImpl, AbortSignal.timeout(pre.env.hardTimeoutMs));
      await repo.recordTest(kind, result.ok, result.ok ? null : result.code, now());
      if (!result.ok) return { ok: false, reason: "failed", message: `Falhou: ${failureText(result.code)}.` };
      return { ok: true, models: result.models.length, message: `Conexão ok: ${result.models.length} ${result.models.length === 1 ? "modelo listado" : "modelos listados"}.` };
    },

    /** "Listar modelos do provedor": ids and labels for the model field. Free text is always accepted too. */
    async listModels(kind: unknown): Promise<ServiceResult<{ models: Array<{ id: string; label: string | null }> }>> {
      if (typeof kind !== "string" || !isRealProvider(kind)) return { ok: false, reason: "invalid", message: "Provedor desconhecido." };
      const pre = await ready();
      if (!pre.ok) return pre;
      const key = await keyFor(kind, pre.env);
      if (!key.ok) return key;
      const result = await providerOf(kind).listModels(key.apiKey, deps.fetchImpl, AbortSignal.timeout(pre.env.hardTimeoutMs));
      await repo.recordTest(kind, result.ok, result.ok ? null : result.code, now());
      if (!result.ok) return { ok: false, reason: "failed", message: `Falhou: ${failureText(result.code)}.` };
      const models = result.models.slice(0, 500).sort((a, b) => a.id.localeCompare(b.id));
      return { ok: true, models, message: `${models.length} ${models.length === 1 ? "modelo listado" : "modelos listados"}.` };
    },

    /**
     * "Testar modelo": the SAVED mapping of a task answers a constant prompt. It spends a few tokens outside any organization's ledger, so
     * the audit row is written BEFORE the call (and a second test of the same task within seconds is refused).
     */
    async testModel(task: unknown): Promise<ServiceResult<{ latencyMs: number; inputTokens: number | null; outputTokens: number | null }>> {
      if (task !== "PLANNER" && task !== "ADJUSTMENTS") return { ok: false, reason: "invalid", message: "Tarefa desconhecida." };
      const pre = await ready();
      if (!pre.ok) return pre;
      const row: TaskRow | undefined = (await repo.getTasks()).find((t) => t.task === task);
      if (!row?.providerKind || !row.modelId) return { ok: false, reason: "not_mapped", message: "Salve o provedor e o modelo da tarefa antes de testar." };
      const kind = row.providerKind as ProviderKind;
      if (kind === "mock" && !pre.env.mockEnabled) return { ok: false, reason: "not_mapped", message: "O provedor simulado só funciona onde AI_MOCK_ENABLED está ligado." };
      let apiKey: string | null = null;
      if (kind !== "mock") {
        const key = await keyFor(kind as RealProviderKind, pre.env);
        if (!key.ok) return key;
        apiKey = key.apiKey;
      }
      const last = await repo.lastModelTestAt(task);
      if (last && now().getTime() - Date.parse(last) < MODEL_TEST_INTERVAL_MS) {
        return { ok: false, reason: "too_soon", message: "Aguarde alguns segundos entre dois testes da mesma tarefa." };
      }
      await repo.recordModelTest(task as AiTask);
      const request = await buildProviderPayload(
        task as AiTask,
        { kind, system: MODEL_TEST_SYSTEM_PROMPT, user: MODEL_TEST_USER, schema: { ...MODEL_TEST_SCHEMA }, schemaName: MODEL_TEST_SCHEMA_NAME },
        { values: [], tokens: [], prose: [] },
      );
      const settings: CallSettings = {
        kind, modelId: row.modelId, maxOutputTokens: Math.min(row.maxOutputTokens, 1024), timeoutMs: Math.min(row.timeoutMs, pre.env.hardTimeoutMs), apiKey,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      };
      const { result } = await callWithPolicy(providerOf(kind), request, settings, { maxRetries: 0 });
      if (!result.ok) return { ok: false, reason: "failed", message: `Falhou: ${failureText(result.code)}.` };
      const answered = typeof result.json === "object" && result.json !== null && (result.json as { ok?: unknown }).ok === true;
      if (!answered) return { ok: false, reason: "failed", message: `Falhou: ${failureText("INVALID_JSON")}.` };
      const { inputTokens, outputTokens } = result.usage;
      const tokens = inputTokens === null && outputTokens === null ? "tokens não informados pelo provedor" : `entrada ${inputTokens ?? "?"} · saída ${outputTokens ?? "?"} tokens${result.usage.source === "ESTIMATE" ? " (estimados)" : ""}`;
      return { ok: true, latencyMs: result.latencyMs, inputTokens, outputTokens, message: `Modelo respondeu em ${result.latencyMs} ms; ${tokens}.` };
    },
  };
}
