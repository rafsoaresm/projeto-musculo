"use client";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { startAssessment } from "./actions";

export function StartAssessmentButton({
  studentId,
  first,
}: {
  studentId: string;
  first: boolean;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button primary small"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            // On success the action redirects to the new draft.
            const result = await startAssessment(studentId);
            if (result?.error) setError(result.error);
          })
        }
      >
        <Plus size={16} /> {pending ? "Abrindo…" : first ? "Iniciar avaliação" : "Iniciar reavaliação"}
      </button>
    </>
  );
}
