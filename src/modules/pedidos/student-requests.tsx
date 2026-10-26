"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice, Pill, formatDate } from "@/components/ui";
import type { RequestRow } from "@/db/data-requests";
import { cancelDataRequest, openDataRequest } from "./actions";
import {
  REQUEST_KINDS,
  REQUEST_KIND_HELP,
  REQUEST_KIND_LABEL,
  REQUEST_NOTICE,
  outcomeLabel,
  type RequestKind,
} from "./contracts";

/**
 * What the student can ask about their own data, and where each request stands. Everything is chosen
 * or typed by the student. The tool records the request and the deadline; the answer is the
 * professional's, and the screen says so. The fields are controlled and sent from a handler (React 19
 * resets a form after its action, which would erase the text if the server refuses it).
 */
export function StudentRequests({ studentId, rows }: { studentId: string; rows: RequestRow[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<RequestKind>("ACCESS");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const needsWords = kind === "CORRECTION" || kind === "OTHER";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await openDataRequest(studentId, { kind, message });
      if (result.error || !result.opened) {
        setFailed(true);
        setFeedback(result.error ?? "Não foi possível registrar o pedido. Tente novamente.");
        return;
      }
      setFailed(false);
      setFeedback(`Pedido registrado. O prazo de resposta do seu profissional é ${formatDate(result.opened.dueAt)}.`);
      setMessage("");
      router.refresh();
    });
  }

  function cancel(requestId: string) {
    startTransition(async () => {
      const result = await cancelDataRequest(studentId, requestId);
      setFailed(Boolean(result.error));
      setFeedback(result.error ?? "Pedido cancelado.");
      router.refresh();
    });
  }

  return (
    <div className="stack-form">
      <form className="stack-form" onSubmit={submit} aria-label="Fazer um pedido sobre os meus dados">
        <label>
          O que você quer pedir
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as RequestKind);
              setFeedback("");
            }}
          >
            {REQUEST_KINDS.map((option) => (
              <option key={option} value={option}>
                {REQUEST_KIND_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        <p className="small muted">{REQUEST_KIND_HELP[kind]}</p>
        <label>
          {needsWords ? "Conte o que você precisa" : "Algo mais que o seu profissional deva saber (opcional)"}
          <textarea
            rows={3}
            value={message}
            maxLength={1000}
            required={needsWords}
            onChange={(event) => {
              setMessage(event.target.value);
              setFeedback("");
            }}
          />
        </label>
        {feedback && (
          <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
            {feedback}
          </p>
        )}
        <div className="persist-actions">
          <button className="button" disabled={pending}>
            {pending ? "Enviando…" : "Registrar o pedido"}
          </button>
        </div>
        <p className="small muted">{REQUEST_NOTICE}</p>
      </form>

      <h3>Seus pedidos</h3>
      {rows.length === 0 ? (
        <p className="muted">Você ainda não fez nenhum pedido.</p>
      ) : (
        <ul className="plan-list request-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{REQUEST_KIND_LABEL[row.kind]}</strong>{" "}
                {row.outcome === null ? (
                  row.overdue ? (
                    <Pill tone="warning">Passou do prazo, sem resposta</Pill>
                  ) : (
                    <Pill tone="brand">Em andamento · prazo {formatDate(row.dueAt)}</Pill>
                  )
                ) : (
                  <Pill tone={row.outcome === "FULFILLED" ? "success" : row.outcome === "CANCELLED" ? "neutral" : "warning"}>
                    {outcomeLabel(row.outcome, "student")} em {formatDate(row.decidedAt ?? row.createdAt)}
                  </Pill>
                )}
              </div>
              <p className="small muted">Pedido de {formatDate(row.createdAt)}</p>
              {row.message && <p className="small">Você escreveu: {row.message}</p>}
              {row.outcomeNote && row.outcome !== "CANCELLED" && (
                <p className="small">Resposta do seu profissional: {row.outcomeNote}</p>
              )}
              {row.outcome === null && (
                <button type="button" className="button secondary" disabled={pending} onClick={() => cancel(row.id)}>
                  Cancelar este pedido
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.some((row) => row.overdue) && (
        <Notice tone="warning">
          Um pedido passou do prazo de 15 dias sem resposta. Fale com o seu profissional por outro canal: a
          ferramenta não envia aviso.
        </Notice>
      )}
    </div>
  );
}
