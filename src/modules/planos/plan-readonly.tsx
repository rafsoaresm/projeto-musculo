"use client";
import { useState } from "react";
import type { PeriodizationSchedule } from "@/modules/training/contracts";
import {
  ScheduleResult,
  ScheduleSummary,
} from "@/modules/training/components/schedule-view";
import { phaseTitle } from "@/modules/training/format";
import { phaseName } from "@/modules/training/periodization";

/**
 * A revision past DRAFT. Nothing here edits it: changes go into a new revision,
 * so what was validated stays exactly as it was. The status and the way to a new revision are in the strip above (0.96).
 */
export function PlanReadOnly({
  schedule,
}: {
  schedule: PeriodizationSchedule;
}) {
  const [selected, setSelected] = useState(0);
  return (
    <>
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
                {phaseTitle(phase.index, phaseName(phase))}
              </button>
            ))}
          </div>
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
