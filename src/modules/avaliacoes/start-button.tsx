"use client";
import { useId, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { startAssessment } from "./v2/actions";
import { DEFAULT_TEMPLATE_LABEL } from "./v2/template";

/** A model the organization offers when an assessment starts (slice 0.85). */
export interface TemplateOption {
  id: string;
  name: string;
  version: number;
}

/**
 * Starts the Avaliação Física (the only assessment there is: user's decision of 03/11/2026), or a reassessment when one was recorded. When the
 * organization has models (slice 0.85), the professional picks one first; the default is every module, as before.
 */
export function StartAssessmentButton({ studentId, first, templates = [] }: { studentId: string; first: boolean; templates?: TemplateOption[] }) {
  const [error, setError] = useState("");
  const [template, setTemplate] = useState("");
  const [pending, startTransition] = useTransition();
  const id = useId();
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {templates.length > 0 && (
        <label className="assessment-template-pick" htmlFor={id}>
          Modelo da avaliação
          <select id={id} value={template} onChange={(event) => setTemplate(event.target.value)} disabled={pending}>
            <option value="">{DEFAULT_TEMPLATE_LABEL}</option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} (versão {item.version})
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="button primary small"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            // On success the action redirects to the new draft (or to the one already open).
            const chosen = templates.find((item) => item.id === template) ?? null;
            const result = await startAssessment(studentId, chosen?.id ?? null, chosen?.version ?? null);
            if (result?.error) setError(result.error);
          })
        }
      >
        <Plus size={16} /> {pending ? "Abrindo…" : first ? "Iniciar avaliação física" : "Iniciar reavaliação física"}
      </button>
    </>
  );
}
