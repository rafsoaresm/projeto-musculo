"use client";
import { useState } from "react";
import { Pill, formatDateTime } from "@/components/ui";
import type { ConnectionRow, TaskRow } from "@/db/ai-platform";
import { PROVIDER_LABEL } from "@/modules/prescricao/planejador/provedores/labels";
import { connectProvider, removeProvider, testProviderConnection } from "./ai-actions";
import { Answer, useRunner } from "./ai-ui";
import { PROVIDER_ORDER, lastTestText, tasksUsing } from "./ai-view";

interface Props {
  connections: ConnectionRow[];
  tasks: TaskRow[];
  mockEnabled: boolean;
  /** An active manager with two-factor on. */
  canWrite: boolean;
  /** `AI_SECRETS_KEY` is configured: without it nothing can be stored. */
  secretsOk: boolean;
  /** Either kill switch is on: tests are blocked. */
  callsBlocked: boolean;
}

/**
 * Three provider cards. A key is WRITE-ONLY: the field takes it, the server stores it encrypted, and the card only ever shows the masked
 * tail, when it was connected and by whom. The typed value is cleared as soon as the form is sent.
 */
export function ProvidersPanel({ connections, tasks, mockEnabled, canWrite, secretsOk, callsBlocked }: Props) {
  return (
    <>
      <div className="ai-cards">
        {PROVIDER_ORDER.map((kind) => (
          <ProviderCard
            key={kind}
            kind={kind}
            connection={connections.find((c) => c.kind === kind) ?? null}
            using={tasksUsing(kind, tasks)}
            canWrite={canWrite}
            secretsOk={secretsOk}
            callsBlocked={callsBlocked}
          />
        ))}
        {mockEnabled && (
          <article className="panel ai-card" aria-labelledby="ai-p-mock">
            <div className="ai-card-head">
              <h3 id="ai-p-mock">{PROVIDER_LABEL.mock}</h3>
              <Pill tone="neutral">Só para testes</Pill>
            </div>
            <p className="small muted">
              Disponível porque AI_MOCK_ENABLED está ligado neste ambiente. Não usa chave, não chama nenhum serviço externo e devolve respostas fixas. Nunca ligue em produção.
            </p>
          </article>
        )}
      </div>
    </>
  );
}

function ProviderCard({
  kind, connection, using, canWrite, secretsOk, callsBlocked,
}: { kind: (typeof PROVIDER_ORDER)[number]; connection: ConnectionRow | null; using: string[]; canWrite: boolean; secretsOk: boolean; callsBlocked: boolean }) {
  const { pending, outcome, run, clear } = useRunner();
  const [apiKey, setApiKey] = useState("");
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const label = PROVIDER_LABEL[kind];
  const formVisible = !connection || open;
  const locked = !canWrite || !secretsOk;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = apiKey;
    setApiKey(""); // the typed value never stays in the page
    run(() => connectProvider(kind, typed), (result) => result.ok && setOpen(false));
  }

  return (
    <article className="panel ai-card" aria-labelledby={`ai-p-${kind}`} data-provider={kind}>
      <div className="ai-card-head">
        <h3 id={`ai-p-${kind}`}>{label}</h3>
        {connection ? <Pill tone="success">Conectado</Pill> : <Pill>Não conectado</Pill>}
      </div>
      {connection ? (
        <dl className="detail-list ai-detail">
          <div>
            <dt>Chave</dt>
            <dd>
              <span aria-label={`terminada em ${connection.last4}`}>••••{connection.last4}</span>
            </dd>
          </div>
          <div>
            <dt>Conectada</dt>
            <dd>
              {formatDateTime(connection.connectedAt)}
              {connection.connectedByEmail ? ` por ${connection.connectedByEmail}` : ""}
            </dd>
          </div>
          {connection.rotatedAt && (
            <div>
              <dt>Trocada</dt>
              <dd>{formatDateTime(connection.rotatedAt)}</dd>
            </div>
          )}
          <div>
            <dt>Teste</dt>
            <dd>{lastTestText(connection, formatDateTime)}</dd>
          </div>
          {using.length > 0 && (
            <div>
              <dt>Usado por</dt>
              <dd>{using.join(", ")}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="small muted">Sem chave, este provedor não pode ser escolhido para nenhuma tarefa.</p>
      )}

      {formVisible ? (
        <form className="stack-form" onSubmit={submit} aria-label={connection ? `Trocar a chave de ${label}` : `Conectar ${label}`}>
          <label>
            Chave da API ({label})
            <input
              type="password"
              name="apiKey"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              minLength={8}
              maxLength={512}
              disabled={locked || pending}
              data-1p-ignore
              aria-describedby={`ai-p-${kind}-help`}
            />
          </label>
          <span className="small muted" id={`ai-p-${kind}-help`}>
            O valor é gravado cifrado e nunca é mostrado de novo.
          </span>
          <div className="inline-form">
            <button className="button primary small" disabled={locked || pending || apiKey.trim().length < 8}>
              {pending ? "Gravando…" : connection ? "Trocar chave" : "Conectar"}
            </button>
            {connection && (
              <button type="button" className="button secondary small" disabled={pending} onClick={() => (setApiKey(""), setOpen(false))}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="inline-form">
          <button type="button" className="button secondary small" disabled={!canWrite || !secretsOk} onClick={() => (clear(), setOpen(true))}>
            Trocar chave
          </button>
          <button type="button" className="button secondary small" disabled={!canWrite || pending || callsBlocked || !secretsOk} onClick={() => run(() => testProviderConnection(kind))}>
            {pending ? "Testando…" : "Testar conexão"}
          </button>
          {removing ? (
            using.length > 0 ? (
              <span className="small" role="alert">
                Este provedor é usado por: {using.join(", ")}. Escolha outro provedor em Modelos antes de remover.{" "}
                <button type="button" className="button secondary small" onClick={() => setRemoving(false)}>
                  Entendi
                </button>
              </span>
            ) : (
              <>
                <button type="button" className="button danger-outline small" disabled={pending || !canWrite} onClick={() => run(() => removeProvider(kind), () => setRemoving(false))}>
                  Confirmar: remover chave de {label}
                </button>
                <button type="button" className="button secondary small" disabled={pending} onClick={() => setRemoving(false)}>
                  Voltar
                </button>
              </>
            )
          ) : (
            <button type="button" className="button danger-outline small" disabled={!canWrite || pending} onClick={() => setRemoving(true)}>
              Remover
            </button>
          )}
        </div>
      )}
      {connection && callsBlocked && <p className="small muted">Os testes estão bloqueados enquanto a IA estiver interrompida.</p>}
      <Answer outcome={outcome} />
    </article>
  );
}
