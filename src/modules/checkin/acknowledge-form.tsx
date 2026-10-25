"use client";
import { useState, useTransition } from "react";
import { acknowledgeCheckin } from "./actions";

/** The professional's reading of a check-in, with an optional note. It records who read it and when. */
export function AcknowledgeCheckinForm({ checkinId }: { checkinId: string }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await acknowledgeCheckin(checkinId, note);
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "Leitura registrada.");
      if (result.recorded) setNote("");
    });
  }
  return (
    <form className="stack-form execution-ack" onSubmit={submit} aria-label="Registrar a leitura do check-in">
      <label>
        Anotação da leitura (opcional)
        <textarea
          rows={2}
          value={note}
          maxLength={500}
          onChange={(event) => {
            setNote(event.target.value);
            setMessage("");
          }}
        />
      </label>
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      <div className="persist-actions">
        <button className="button secondary" disabled={pending}>
          {pending ? "Registrando…" : "Registrar leitura"}
        </button>
      </div>
      <p className="small muted">
        Registrar a leitura guarda quem leu e quando, e fecha o check-in para novas correções do aluno.
        Ela não altera o treino dele nem libera nada.
      </p>
    </form>
  );
}
