"use client";
import { useCallback, useState, useTransition, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { PeriodizationInput } from "@/modules/training/contracts";
import { Planner, type PlannerPersistence } from "@/modules/training/components/planner";
import type { PlanActionResult } from "./actions";

/**
 * A draft revision (0.93): the prescription is the main content and comes first; the structure of the cycle is
 * secondary, folded under it, and the step that closes the draft ("Marcar estrutura como pronta") comes last.
 * Marking ready waits while the folded structure has changes that are not saved, as the planner did before.
 */
export function DraftWorkspace({
  editor,
  input,
  structureSummary,
  save,
  markReady,
}: {
  editor: ReactNode;
  input: PeriodizationInput;
  /** One line about the SAVED structure, shown on the folded header. */
  structureSummary: string;
  save: PlannerPersistence["save"];
  markReady: () => Promise<PlanActionResult>;
}) {
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  return (
    <>
      {editor}
      <details
        className="structure-details"
        open={open}
        onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          <span className="structure-summary-text">
            <strong>Estrutura do ciclo</strong>
            <span className="small muted">{structureSummary}</span>
          </span>
          <span className="structure-summary-action">
            {open ? "Recolher" : "Ver e alterar"} <ChevronDown size={18} aria-hidden="true" />
          </span>
        </summary>
        <div className="structure-body">
          <Planner
            initial={input}
            onDirtyChange={onDirtyChange}
            persist={{ saveLabel: "Salvar alterações", save }}
          />
        </div>
      </details>
      <section className="panel" aria-labelledby="concluir-rascunho">
        <h2 id="concluir-rascunho">Concluir o rascunho</h2>
        <p className="muted">
          Quando a estrutura e os exercícios estiverem certos, marque a estrutura como pronta. Depois disso esta
          revisão não aceita mais edição. Ainda não é aprovação nem liberação: o aluno não recebe nada nesta etapa.
        </p>
        {dirty && (
          <p className="small muted" role="status">
            Salve as mudanças da estrutura do ciclo antes de marcar como pronta.
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <button
          className="button secondary"
          type="button"
          disabled={pending || dirty}
          onClick={() =>
            startTransition(async () => {
              const outcome = await markReady();
              setError(outcome?.error ?? "");
            })
          }
        >
          {pending ? "Marcando…" : "Marcar estrutura como pronta"}
        </button>
      </section>
    </>
  );
}
