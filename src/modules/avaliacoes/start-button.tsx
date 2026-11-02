"use client";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { startAssessment } from "./actions";
import { startAssessmentV2 } from "./v2/actions";

export function StartAssessmentButton({
  studentId,
  first,
  newFormat = false,
}: {
  studentId: string;
  first: boolean;
  /** Starts a draft of the new format (still in test, only where the environment opened it). */
  newFormat?: boolean;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const label = newFormat ? "Nova avaliação (formato novo)" : first ? "Iniciar avaliação" : "Iniciar reavaliação";
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={newFormat ? "button secondary small" : "button primary small"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            // On success the action redirects to the new draft (or to the one already open).
            const result = newFormat ? await startAssessmentV2(studentId) : await startAssessment(studentId);
            if (result?.error) setError(result.error);
          })
        }
      >
        <Plus size={16} /> {pending ? "Abrindo…" : label}
      </button>
    </>
  );
}
