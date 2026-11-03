"use client";
import { useState, useTransition } from "react";
import { archiveAssessmentTemplate } from "./template-actions";

/** Archives a model (no longer offered when an assessment starts; what was made with it stays) or brings it back. */
export function TemplateArchiveButton({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className="button secondary small"
        disabled={pending}
        aria-label={`${archived ? "Reativar" : "Arquivar"} o modelo ${name}`}
        onClick={() =>
          start(async () => {
            const result = await archiveAssessmentTemplate(id, !archived);
            setError(result.error ?? null);
          })
        }
      >
        {archived ? "Reativar" : "Arquivar"}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
