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
  disabled = false,
  onError,
}: {
  studentId: string;
  assessmentId: string;
  disabled?: boolean;
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
        disabled={disabled || pending}
        onClick={() => {
          if (!window.confirm("Descartar este rascunho? O que foi digitado nele será apagado.")) return;
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
