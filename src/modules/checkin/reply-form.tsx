"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { replyToCheckin } from "./actions";
import { REPLY_MAX } from "./contracts";

/**
 * The professional's reply to a check-in. The student sees it with the name and the time; it is not changed nor deleted afterwards.
 * Replying also registers the reading when nobody had registered it. No e-mail is sent.
 */
export function ReplyCheckinForm({ checkinId, replied }: { checkinId: string; replied: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await replyToCheckin(checkinId, body);
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "Resposta enviada. O aluno vê na tela de check-in.");
      if (result.recorded) {
        setBody("");
        router.refresh();
      }
    });
  }
  return (
    <details className="checkin-reply-form">
      <summary>{replied ? "Responder de novo" : "Responder ao aluno"}</summary>
      <form className="stack-form" onSubmit={submit} aria-label="Responder ao check-in">
        <label>
          Resposta ao aluno
          <textarea
            rows={3}
            value={body}
            maxLength={REPLY_MAX}
            aria-describedby={`resposta-limite-${checkinId}`}
            required
            onChange={(event) => {
              setBody(event.target.value);
              setMessage("");
            }}
          />
        </label>
        <p className="small muted" id={`resposta-limite-${checkinId}`}>
          Até {REPLY_MAX} caracteres ({body.length} usados).
        </p>
        {message && (
          <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
            {message}
          </p>
        )}
        <div className="persist-actions">
          <button className="button secondary" disabled={pending}>
            {pending ? "Enviando…" : "Enviar resposta"}
          </button>
        </div>
        <p className="small muted">
          O aluno vê a resposta, com o seu nome e a hora, no histórico de check-ins, marcada como nova. Ela não é
          enviada por e-mail, não pode ser apagada e fecha o check-in para correções do aluno.
        </p>
      </form>
    </details>
  );
}
