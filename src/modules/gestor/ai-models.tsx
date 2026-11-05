"use client";
import { useId, useState } from "react";
import { Pill } from "@/components/ui";
import type { ConnectionRow, TaskRow } from "@/db/ai-platform";
import { PROVIDER_LABEL } from "@/modules/prescricao/planejador/provedores/labels";
import type { ProviderKind } from "@/modules/prescricao/planejador/provedores/port";
import { listProviderModels, saveTask, testTaskModel } from "./ai-actions";
import { Answer, useRunner } from "./ai-ui";
import { CURRENCIES, TASK_LABEL, priceToField, type TaskFormValues } from "./ai-view";

interface Props {
  tasks: TaskRow[];
  connections: ConnectionRow[];
  mockEnabled: boolean;
  canWrite: boolean;
  callsBlocked: boolean;
  secretsOk: boolean;
}

const TASK_TEXT = {
  PLANNER: "Monta a estratégia do ciclo (divisão por fase, foco de cada treino, candidatos e justificativas) em uma única chamada por planejamento. A IA só sugere: quem aceita e aprova é o profissional.",
  ADJUSTMENTS: "Interpreta um pedido de ajuste escrito pelo profissional e devolve uma sugestão estruturada, que o motor confere antes de qualquer mudança. Ainda não é usada por nenhuma tela.",
} as const;

export function ModelsPanel(props: Props) {
  return (
    <div className="ai-stack">
      {[...props.tasks].sort((a, b) => (a.task === b.task ? 0 : a.task === "PLANNER" ? -1 : 1)).map((task) => (
        <TaskCard key={task.task} row={task} {...props} />
      ))}
    </div>
  );
}

function valuesOf(row: TaskRow): TaskFormValues {
  return {
    enabled: row.enabled,
    providerKind: row.providerKind ?? "",
    modelId: row.modelId ?? "",
    maxInputTokens: String(row.maxInputTokens),
    maxOutputTokens: String(row.maxOutputTokens),
    timeoutSeconds: String(Math.round(row.timeoutMs / 1000)),
    maxRetries: String(row.maxRetries),
    currency: row.currency ?? "USD",
    priceInput: priceToField(row.priceInputMicrosPerMillion),
    priceOutput: priceToField(row.priceOutputMicrosPerMillion),
    sendSystemExerciseNames: row.sendSystemExerciseNames,
  };
}

function TaskCard({ row, connections, mockEnabled, canWrite, callsBlocked, secretsOk }: { row: TaskRow } & Props) {
  const id = useId();
  const save = useRunner();
  const list = useRunner();
  const test = useRunner();
  const [v, setV] = useState<TaskFormValues>(valuesOf(row));
  // The server may clamp limits to the environment ceilings: after a refresh the form shows what was really saved, so it is not left "dirty".
  const [seenVersion, setSeenVersion] = useState(row.version);
  if (seenVersion !== row.version) {
    setSeenVersion(row.version);
    setV(valuesOf(row));
  }
  const [models, setModels] = useState<Array<{ id: string; label: string | null }>>([]);
  const [filter, setFilter] = useState("");
  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => setV((current) => ({ ...current, [key]: value }));
  const connected = new Set(connections.map((c) => c.kind as string));
  const options: ProviderKind[] = [...(["openai", "anthropic", "google"] as const).filter((k) => connected.has(k) || k === row.providerKind), ...(mockEnabled || row.providerKind === "mock" ? (["mock"] as const) : [])];
  const dirty = JSON.stringify(v) !== JSON.stringify(valuesOf(row));
  const real = v.providerKind !== "" && v.providerKind !== "mock";
  const shown = models.filter((m) => !filter || m.id.toLowerCase().includes(filter.toLowerCase()) || (m.label ?? "").toLowerCase().includes(filter.toLowerCase())).slice(0, 200);
  const locked = !canWrite;
  const hasPrices = v.priceInput.trim() !== "" || v.priceOutput.trim() !== "";

  return (
    <article className="panel" aria-labelledby={`${id}-t`} data-task={row.task}>
      <div className="ai-card-head">
        <h3 id={`${id}-t`}>{TASK_LABEL[row.task]}</h3>
        {row.enabled && row.providerKind ? <Pill tone="success">Ligada</Pill> : <Pill>Desligada</Pill>}
      </div>
      <p className="small muted">{TASK_TEXT[row.task]}</p>
      <form
        className="stack-form"
        aria-label={`Configurar ${TASK_LABEL[row.task]}`}
        onSubmit={(event) => {
          event.preventDefault();
          save.run(() => saveTask(row.task, v, row.version));
        }}
      >
        <div className="field-grid">
          <label>
            Provedor
            <select value={v.providerKind} onChange={(e) => (set("providerKind", e.target.value), setModels([]))} disabled={locked}>
              <option value="">Nenhum</option>
              {options.map((k) => (
                <option key={k} value={k}>
                  {PROVIDER_LABEL[k]}
                  {k !== "mock" && !connected.has(k) ? " (sem chave)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Modelo
            <input
              value={v.modelId}
              onChange={(e) => set("modelId", e.target.value)}
              list={`${id}-models`}
              autoComplete="off"
              spellCheck={false}
              maxLength={80}
              disabled={locked}
              aria-describedby={`${id}-model-help`}
            />
            <datalist id={`${id}-models`}>
              {models.slice(0, 500).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ?? m.id}
                </option>
              ))}
            </datalist>
          </label>
        </div>
        <p className="small muted" id={`${id}-model-help`}>
          Nenhum modelo vem preenchido: o identificador é configuração sua. Use “Listar modelos do provedor” ou digite o identificador exato.
        </p>
        <div className="inline-form">
          <button
            type="button"
            className="button secondary small"
            disabled={!real || locked || list.pending || callsBlocked || !secretsOk || !connected.has(v.providerKind)}
            onClick={() => list.run(() => listProviderModels(v.providerKind), (r) => r.ok && "models" in r && setModels(r.models))}
          >
            {list.pending ? "Listando…" : "Listar modelos do provedor"}
          </button>
          {callsBlocked && <span className="small muted">Bloqueado enquanto a IA estiver interrompida.</span>}
        </div>
        <Answer outcome={list.outcome} />
        {models.length > 0 && (
          <div className="ai-models" role="group" aria-label="Modelos do provedor">
            <label>
              Buscar na lista
              <input value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" />
            </label>
            <ul className="ai-model-list">
              {shown.map((m) => (
                <li key={m.id}>
                  <button type="button" className="button secondary small" onClick={() => set("modelId", m.id)} aria-pressed={v.modelId === m.id}>
                    {m.id}
                  </button>
                </li>
              ))}
            </ul>
            {models.length > shown.length && <p className="small muted">Mostrando {shown.length} de {models.length}. Refine a busca.</p>}
          </div>
        )}

        <fieldset className="ai-fieldset" disabled={locked}>
          <legend>Limites</legend>
          <div className="field-grid">
            <label>
              Máximo de tokens de entrada
              <input inputMode="numeric" value={v.maxInputTokens} onChange={(e) => set("maxInputTokens", e.target.value)} />
            </label>
            <label>
              Máximo de tokens de saída
              <input inputMode="numeric" value={v.maxOutputTokens} onChange={(e) => set("maxOutputTokens", e.target.value)} />
            </label>
            <label>
              Tempo limite (segundos)
              <input inputMode="numeric" value={v.timeoutSeconds} onChange={(e) => set("timeoutSeconds", e.target.value)} />
            </label>
            <label>
              Novas tentativas
              <select value={v.maxRetries} onChange={(e) => set("maxRetries", e.target.value)}>
                <option value="0">0 (nenhuma)</option>
                <option value="1">1 (só em falha transitória)</option>
              </select>
            </label>
          </div>
          <p className="small muted">Os tetos do ambiente (tempo e tokens de saída) valem acima destes valores. O pedido é um só por planejamento.</p>
        </fieldset>

        <fieldset className="ai-fieldset" disabled={locked}>
          <legend>Preço por 1 milhão de tokens (opcional)</legend>
          <div className="field-grid">
            <label>
              Moeda
              <select value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <span />
            <label>
              Preço de entrada
              <input inputMode="decimal" value={v.priceInput} onChange={(e) => set("priceInput", e.target.value)} placeholder="não informado" autoComplete="off" />
            </label>
            <label>
              Preço de saída
              <input inputMode="decimal" value={v.priceOutput} onChange={(e) => set("priceOutput", e.target.value)} placeholder="não informado" autoComplete="off" />
            </label>
          </div>
          <p className="small muted">
            {hasPrices
              ? "Com preço digitado, o custo passa a ser calculado por chamada e pode ter limite no plano de IA. O valor é seu: a ferramenta não consulta nem sugere preços."
              : "Sem preço digitado, o custo aparece como desconhecido e não há limite por custo. A ferramenta nunca inventa um preço."}
          </p>
        </fieldset>

        {row.task === "ADJUSTMENTS" && (
          <label className="check-row check-row-tap">
            <input type="checkbox" checked={v.sendSystemExerciseNames} onChange={(e) => set("sendSystemExerciseNames", e.target.checked)} disabled={locked} />
            <span>Enviar nomes dos exercícios da biblioteca do sistema (nomes de exercícios da organização nunca são enviados).</span>
          </label>
        )}
        <label className="check-row check-row-tap">
          <input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} disabled={locked} />
          <span>Tarefa ligada (a organização ainda precisa estar habilitada e ter franquia).</span>
        </label>
        <div className="inline-form">
          <button className="button primary small" disabled={locked || save.pending || !dirty}>
            {save.pending ? "Salvando…" : "Salvar configuração"}
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={locked || test.pending || callsBlocked || dirty || !row.providerKind || (row.providerKind !== "mock" && !secretsOk)}
            onClick={() => test.run(() => testTaskModel(row.task))}
            aria-describedby={`${id}-test-help`}
          >
            {test.pending ? "Testando…" : "Testar modelo"}
          </button>
        </div>
        <p className="small muted" id={`${id}-test-help`}>
          O teste usa a configuração salva e um pedido fixo, sem nenhum dado de aluno; gasta poucos tokens fora da franquia de qualquer organização e fica na auditoria.
          {dirty ? " Salve as mudanças antes de testar." : ""}
        </p>
        <Answer outcome={save.outcome} />
        <Answer outcome={test.outcome} />
      </form>
    </article>
  );
}
