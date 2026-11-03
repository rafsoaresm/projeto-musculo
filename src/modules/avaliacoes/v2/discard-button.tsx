"use client";
import { useState, useTransition } from "react";
import { discardAssessmentDraft } from "./actions";

/**
 * Discards an open draft (of either format) after a confirmation and goes back to the student's assessments. The error, when there is one, is
 * shown next to the button, or handed to the caller that has its own status line.
 */
export function DiscardDraftButton({
  studentId,
  assessmentId,
  busy = false,
  onConfirm,
  onError,
}: {
  studentId: string;
  assessmentId: string;
  /** A save is on the way: the button does nothing yet, but stays focusable (aria-disabled), so a save that starts by itself keeps the focus. */
  busy?: boolean;
  /** Called once the person confirmed, before the draft is sent away (the shell stops saving by itself). */
  onConfirm?: () => void;
  onError?: (text: string) => void;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <>
      {!onError && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button secondary"
        disabled={pending}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (busy) return;
          if (!window.confirm("Descartar este rascunho? O que foi digitado nele será apagado.")) return;
          onConfirm?.();
          startTransition(async () => {
            const result = await discardAssessmentDraft(studentId, assessmentId);
            if (result?.error) (onError ?? setError)(result.error);
          });
        }}
      >
        {pending ? "Descartando…" : "Descartar rascunho"}
      </button>
    </>
  );
}
