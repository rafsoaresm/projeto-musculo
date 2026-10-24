"use client";
import { useState, useTransition } from "react";
import { Info } from "lucide-react";
import type { PeriodizationSchedule } from "@/modules/training/contracts";
import {
  ScheduleResult,
  ScheduleSummary,
} from "@/modules/training/components/schedule-view";
import type { PlanActionResult } from "./actions";

/**
 * A revision past DRAFT. Nothing here edits it: changes go into a new revision,
 * so what was validated stays exactly as it was.
 */
export function PlanReadOnly({
  schedule,
  createRevision,
}: {
  schedule: PeriodizationSchedule;
  createRevision: () => Promise<PlanActionResult>;
}) {
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <>
      <div className="notice">
        <Info size={19} />
        <p>
          A estrutura e os exercícios desta revisão foram fechados e não podem
          mais ser alterados. Isto não é aprovação nem liberação: o aluno não
          recebe este plano. Para mudar algo, crie uma nova revisão a partir
          dela, que leva os exercícios junto.
        </p>
      </div>
      <div className="planner-layout">
        <section className="panel">
          <div className="panel-title">
            <span className="mini-number">1</span>
            <h2>Fases</h2>
          </div>
          <div className="phase-tabs" role="group" aria-label="Selecionar fase">
            {schedule.phases.map((phase, i) => (
              <button
                key={phase.index}
                type="button"
                aria-pressed={selected === i}
                className={selected === i ? "phase-tab selected" : "phase-tab"}
                onClick={() => setSelected(i)}
              >
                Fase {String(phase.index).padStart(2, "0")}
              </button>
            ))}
          </div>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary"
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const outcome = await createRevision();
                if (outcome?.error) setError(outcome.error);
              })
            }
          >
            {pending ? "Criando…" : "Criar nova revisão"}
          </button>
        </section>
        <aside className="planner-summary" aria-live="polite">
          <ScheduleSummary schedule={schedule} />
        </aside>
      </div>
      <ScheduleResult
        schedule={schedule}
        selected={selected}
        badge="Estrutura validada · não aprovada"
      />
    </>
  );
}
