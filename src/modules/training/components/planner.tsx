"use client";

import { useState, useTransition } from "react";
import { ArrowRight, CalendarDays, Info, RotateCw } from "lucide-react";
import { buildPeriodization } from "../periodization";
import {
  periodizationInputSchema,
  phaseSchema,
  type PhaseInput,
  type PeriodizationInput,
  type PeriodizationSchedule,
} from "../contracts";
import { ScheduleResult, ScheduleSummary } from "./schedule-view";

const defaultPhase = (): PhaseInput => ({
  weeks: 4,
  sessionsPerWeek: 3,
  split: "ABC",
  exercisesPerSession: 5,
});

/** Result of a save requested from the server. An error is a message to show. */
export type PersistResult = { error?: string; saved?: boolean } | void;

export interface PlannerPersistence {
  /** New plans ask for a name; saved drafts keep theirs. */
  askTitle?: boolean;
  saveLabel: string;
  save: (payload: {
    title?: string;
    input: PeriodizationInput;
  }) => Promise<PersistResult>;
  /** Marks the saved draft as structurally ready. Needs everything saved first. */
  ready?: { label: string; action: () => Promise<PersistResult> };
}

export function Planner({
  initial,
  persist,
}: {
  /** Start values when a saved draft is opened. */
  initial?: PeriodizationInput;
  /** Without it, the planner only calculates and exports (no data is stored). */
  persist?: PlannerPersistence;
}) {
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [phases, setPhases] = useState<PhaseInput[]>(() =>
    initial
      ? initial.phases.map((phase) => ({ ...phase }))
      : Array.from({ length: 3 }, defaultPhase),
  );
  const [selected, setSelected] = useState(0);
  const [schedule, setSchedule] = useState<PeriodizationSchedule | null>(() =>
    initial ? buildPeriodization(initial) : null,
  );
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, startSaving] = useTransition();
  const phase = phases[selected];

  function invalidate() {
    setSchedule(null);
    setError("");
    setDirty(true);
    setStatus("");
  }
  function updatePhase(update: Partial<PhaseInput>) {
    setPhases(
      phases.map((value, i) =>
        i === selected ? { ...value, ...update } : value,
      ),
    );
    invalidate();
  }
  function changeCount(count: number) {
    setPhases(
      Array.from({ length: count }, (_, i) =>
        phases[i] ? { ...phases[i] } : defaultPhase(),
      ),
    );
    setSelected(Math.min(selected, count - 1));
    invalidate();
  }
  function calculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = periodizationInputSchema.safeParse({ startDate, phases });
    if (!result.success) {
      setError(
        "Confira a data inicial e os limites de cada fase antes de calcular.",
      );
      return;
    }
    setSchedule(buildPeriodization(result.data));
    setError("");
  }
  function persistNow() {
    const result = periodizationInputSchema.safeParse({ startDate, phases });
    if (!result.success) {
      setError(
        "Confira a data inicial e os limites de cada fase antes de salvar.",
      );
      return;
    }
    if (persist?.askTitle && !title.trim()) {
      setError("Dê um nome ao plano antes de salvar.");
      return;
    }
    setError("");
    startSaving(async () => {
      const outcome = await persist?.save({
        title: persist.askTitle ? title : undefined,
        input: result.data,
      });
      if (outcome?.error) {
        setError(outcome.error);
        return;
      }
      setSchedule(buildPeriodization(result.data));
      setDirty(false);
      setStatus("Rascunho salvo.");
    });
  }
  function markReady() {
    startSaving(async () => {
      const outcome = await persist?.ready?.action();
      if (outcome?.error) setError(outcome.error);
    });
  }
  function download() {
    if (!schedule) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(schedule, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `planejamento-${schedule.startDate}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <div className="notice">
        <Info size={19} />
        <p>
          Este espaço calcula a estrutura do planejamento. Não prescreve
          exercícios nem libera treinos.{" "}
          {persist
            ? "O rascunho fica salvo no cadastro do aluno e só você, com vínculo técnico, o vê. O aluno não o recebe."
            : "As alterações ficam nesta página; exporte o rascunho para guardar o resultado."}
        </p>
      </div>
      <div className="planner-layout">
        <form className="planner-form" onSubmit={calculate}>
          <section className="panel">
            <div className="panel-title">
              <span className="mini-number">1</span>
              <h2>Estrutura do ciclo</h2>
            </div>
            {persist?.askTitle && (
              <label>
                Nome do plano
                <input
                  value={title}
                  maxLength={120}
                  required
                  placeholder="Ex.: Ciclo inicial"
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setStatus("");
                  }}
                />
              </label>
            )}
            <div className="field-grid">
              <label>
                Data de início
                <input
                  type="date"
                  value={startDate}
                  min="2000-01-01"
                  max="2100-12-31"
                  required
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    invalidate();
                  }}
                />
              </label>
              <label>
                Quantidade de fases
                <select
                  value={phases.length}
                  onChange={(event) => changeCount(Number(event.target.value))}
                >
                  {[3, 6, 12].map((count) => (
                    <option key={count} value={count}>
                      {count} mesociclos
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="field-hint">
              Fases não são meses exatos. O calendário considera a quantidade
              real de semanas de cada mesociclo.
            </p>
          </section>
          <section className="panel">
            <div className="panel-title">
              <span className="mini-number">2</span>
              <h2>Configurar cada fase</h2>
            </div>
            <div
              className="phase-tabs"
              role="group"
              aria-label="Selecionar fase"
            >
              {phases.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={selected === i}
                  className={
                    selected === i ? "phase-tab selected" : "phase-tab"
                  }
                  onClick={() => setSelected(i)}
                >
                  Fase {String(i + 1).padStart(2, "0")}
                </button>
              ))}
            </div>
            <div className="phase-heading">
              <strong>Mesociclo {selected + 1}</strong>
              <span className="pill neutral">Edição independente</span>
            </div>
            <div className="field-grid">
              <label>
                Microciclos (semanas)
                <select
                  value={phase.weeks}
                  onChange={(event) =>
                    updatePhase({ weeks: Number(event.target.value) })
                  }
                >
                  {[3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} semanas
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sessões por semana
                <select
                  value={phase.sessionsPerWeek}
                  onChange={(event) =>
                    updatePhase({ sessionsPerWeek: Number(event.target.value) })
                  }
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "sessão" : "sessões"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Divisão de treinos
                <select
                  value={phase.split}
                  onChange={(event) =>
                    updatePhase({
                      split: phaseSchema.shape.split.parse(event.target.value),
                    })
                  }
                >
                  {phaseSchema.shape.split.options.map((split) => (
                    <option key={split}>{split}</option>
                  ))}
                </select>
              </label>
              <label>
                Alvo de exercícios por treino
                <select
                  value={phase.exercisesPerSession}
                  onChange={(event) =>
                    updatePhase({
                      exercisesPerSession: Number(event.target.value),
                    })
                  }
                >
                  {[3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} exercícios
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="rotation-note">
              <RotateCw size={17} />
              <p>
                A rotação continua entre as semanas da mesma fase. ABC em 2 dias
                resulta em A/B, C/A, B/C. Cada nova fase reinicia sua divisão.
              </p>
            </div>
          </section>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <button className="button primary calculate-button" type="submit">
            Calcular planejamento <ArrowRight size={18} />
          </button>
          {persist && (
            <div className="persist-actions">
              <button
                className="button secondary"
                type="button"
                disabled={saving || (!persist.askTitle && !dirty)}
                onClick={persistNow}
              >
                {saving ? "Salvando…" : persist.saveLabel}
              </button>
              {persist.ready && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={saving || dirty}
                  onClick={markReady}
                >
                  {persist.ready.label}
                </button>
              )}
              {dirty && !persist.askTitle && (
                <span className="small muted" role="status">
                  Há alterações não salvas.
                </span>
              )}
              {status && (
                <span className="small muted" role="status">
                  {status}
                </span>
              )}
            </div>
          )}
        </form>
        <aside className="planner-summary" aria-live="polite">
          {schedule ? (
            <ScheduleSummary schedule={schedule} onDownload={download} />
          ) : (
            <div className="summary-empty">
              <span className="icon-tile brand-tile">
                <CalendarDays size={29} />
              </span>
              <h2>Seu ciclo começa aqui.</h2>
              <p>
                Defina uma data e ajuste cada fase para visualizar o
                planejamento completo.
              </p>
              <div className="empty-bars">
                <span />
                <span />
                <span />
              </div>
              <small>O resultado aparece depois de calcular.</small>
            </div>
          )}
        </aside>
      </div>
      {schedule && <ScheduleResult schedule={schedule} selected={selected} />}
    </>
  );
}
