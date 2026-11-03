"use client";
import { useId, useState, useTransition } from "react";
import { amendAssessment } from "./actions";

/**
 * "Retificar": a correction of a recorded Avaliação Física is a new assessment that points to it, with the reason written; the recorded one never
 * changes. The reason is asked here (3 to 1000 characters) and checked again on the server.
 */
export function AmendForm({ studentId, assessmentId }: { studentId: string; assessmentId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (!open)
    return (
      <button type="button" className="button secondary" onClick={() => setOpen(true)}>
        Retificar
      </button>
    );
  return (
    <form
      className="av2-amend"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim().length < 3) {
          setError("Escreva o motivo da retificação, com 3 a 1000 caracteres.");
          return;
        }
        startTransition(async () => {
          // On success the action goes to the draft of the amendment.
          const result = await amendAssessment(studentId, assessmentId, reason);
          if (result?.error) setError(result.error);
        });
      }}
    >
      <div className="av2-grid">
        <div className="av2-field av2-field-wide">
          <label htmlFor={id} className="av2-label">
            Motivo da retificação
          </label>
          <textarea id={id} rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby={`${id}-nota`} />
          <span id={`${id}-nota`} className="av2-note">
            Fica registrado com a retificação. A avaliação original continua no histórico, sem mudança.
          </span>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="av2-confirm-actions">
        <button type="button" className="button secondary" disabled={pending} onClick={() => setOpen(false)}>
          Cancelar
        </button>
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? "Abrindo…" : "Criar retificação"}
        </button>
      </div>
    </form>
  );
}
