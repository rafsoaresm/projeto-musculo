"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Info, ListChecks, RotateCw } from "lucide-react";
import { buildPeriodization, convertV1ToV2, convertV2ToV1 } from "../periodization";
import {
  EXERCISES_PER_SESSION_OPTIONS,
  isV2Input,
  periodizationInputSchemaV1,
  periodizationInputSchemaV2,
  phaseSchema,
  type PhaseInput,
  type PhaseInputV2,
  type PeriodizationInput,
  type PeriodizationSchedule,
} from "../contracts";
import { PHASE_COUNT_OPTIONS, defaultPhaseV2, structureIssueMessage } from "../structure-draft";
import { PhaseEditorV2 } from "./phase-editor-v2";
import { ScheduleResult, ScheduleSummary } from "./schedule-view";

/** "Divisão padrão" is the v1 structure (A, AB, ABC…); "Estrutura livre" is v2. */
type Mode = "V1" | "V2";

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
  /**
   * A new plan (0.93): saving is the way to the prescription, so the save becomes the primary action of a third step,
   * "Prescrever exercícios", and the calculation stays a secondary preview.
   */
  prescribeNext?: boolean;
}

export function Planner({
  initial,
  persist,
  onDirtyChange,
  newPlanHref,
}: {
  /** Start values when a saved draft is opened. */
  initial?: PeriodizationInput;
  /** Without it, the planner only calculates (no data is stored). */
  persist?: PlannerPersistence;
  /** Told whenever the form gains or loses changes that are not saved yet. */
  onDirtyChange?: (dirty: boolean) => void;
  /** The simulator points to "Novo plano" (choose the student) for keeping a plan. Absent when the role cannot prescribe. */
  newPlanHref?: string;
}) {
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [mode, setMode] = useState<Mode>(initial && isV2Input(initial) ? "V2" : "V1");
  const [phases, setPhases] = useState<PhaseInput[]>(() =>
    initial && !isV2Input(initial)
      ? initial.phases.map((phase) => ({ ...phase }))
      : Array.from({ length: 3 }, defaultPhase),
  );
  const [phasesV2, setPhasesV2] = useState<PhaseInputV2[]>(() =>
    initial && isV2Input(initial) ? initial.phases.map((phase) => ({ ...phase })) : [],
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
  const phase = phases[Math.min(selected, phases.length - 1)];
  const count = mode === "V2" ? phasesV2.length : phases.length;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
  function updatePhaseV2(next: PhaseInputV2) {
    setPhasesV2(phasesV2.map((value, i) => (i === selected ? next : value)));
    invalidate();
  }
  function changeCount(next: number) {
    if (mode === "V2")
      setPhasesV2(Array.from({ length: next }, (_, i) => (phasesV2[i] ? { ...phasesV2[i] } : defaultPhaseV2())));
    else
      setPhases(
        Array.from({ length: next }, (_, i) =>
          phases[i] ? { ...phases[i] } : defaultPhase(),
        ),
      );
    setSelected(Math.min(selected, next - 1));
    invalidate();
  }
  /**
   * Switching to the free structure keeps everything (labels, targets, rotation, so every prescribed exercise
   * stays in its workout). Going back to the standard split only works when the free structure fits in it.
   */
  function changeMode(next: Mode) {
    if (next === mode) return;
    if (next === "V2") {
      setPhasesV2(convertV1ToV2({ startDate, phases }).phases);
    } else {
      const parsed = periodizationInputSchemaV2.safeParse({ schemaVersion: 2, startDate: startDate || "2000-01-01", phases: phasesV2 });
      const back = parsed.success ? convertV2ToV1(parsed.data) : null;
      if (!back) {
        setError(
          "Esta estrutura usa recursos da estrutura livre (nomes, alvos diferentes, rótulos próprios, rotação, dias ou quantidades fora da divisão padrão) e não cabe na divisão padrão.",
        );
        return;
      }
      setPhases(back.phases);
    }
    setMode(next);
    setSelected(0);
    invalidate();
  }
  /** The structure as typed, validated; an error message otherwise. */
  function validInput(action: "calcular" | "salvar"): PeriodizationInput | string {
    if (mode === "V2") {
      const result = periodizationInputSchemaV2.safeParse({ schemaVersion: 2, startDate, phases: phasesV2 });
      return result.success ? result.data : structureIssueMessage(result.error);
    }
    const result = periodizationInputSchemaV1.safeParse({ startDate, phases });
    return result.success
      ? result.data
      : `Confira a data inicial e os limites de cada fase antes de ${action}.`;
  }
  function calculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validInput("calcular");
    if (typeof result === "string") {
      setError(result);
      return;
    }
    setSchedule(buildPeriodization(result));
    setError("");
  }
  function persistNow() {
    const result = validInput("salvar");
    if (typeof result === "string") {
      setError(result);
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
        input: result,
      });
      if (outcome?.error) {
        setError(outcome.error);
        return;
      }
      setSchedule(buildPeriodization(result));
      setDirty(false);
      setStatus("Rascunho salvo.");
    });
  }

  return (
    <>
      <div className="notice">
        <Info size={19} />
        <p>
          {/* Handoff V4, A01: the plan does hold the prescription; the simulator saves nothing. */}
          {persist ? (
            "Rascunho visível apenas para você. Configure o ciclo e os exercícios; o aluno verá somente a revisão entregue."
          ) : newPlanHref ? (
            <>
              Simulação: nada aqui é salvo. Para guardar um plano no cadastro de um aluno, use{" "}
              <Link href={newPlanHref}>Novo plano</Link> e escolha o aluno.
            </>
          ) : (
            "Simulação: nada aqui é salvo."
          )}
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
                  value={count}
                  onChange={(event) => changeCount(Number(event.target.value))}
                >
                  {(mode === "V2" ? PHASE_COUNT_OPTIONS : [3, 6, 12]).map((n) => (
                    <option key={n} value={n}>
                      {mode === "V2" ? `${n} ${n === 1 ? "fase" : "fases"}` : `${n} mesociclos`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="structure-mode">
              <legend>Modelo da estrutura</legend>
              <label className="check-row">
                <input
                  type="radio"
                  name="modelo-estrutura"
                  checked={mode === "V1"}
                  onChange={() => changeMode("V1")}
                />
                Divisão padrão (A, AB, ABC…)
              </label>
              <label className="check-row">
                <input
                  type="radio"
                  name="modelo-estrutura"
                  checked={mode === "V2"}
                  onChange={() => changeMode("V2")}
                />
                Estrutura livre: rótulos próprios, semanas e sessões à vontade, alvo por treino, rotação e dias
              </label>
            </fieldset>
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
              {Array.from({ length: count }, (_, i) => (
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
            {mode === "V2" ? (
              <PhaseEditorV2
                key={selected}
                phase={phasesV2[Math.min(selected, phasesV2.length - 1)]}
                phaseNumber={selected + 1}
                startDate={startDate}
                onChange={updatePhaseV2}
              />
            ) : (
            <>
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
                  {EXERCISES_PER_SESSION_OPTIONS.map((n) => (
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
            </>
            )}
          </section>
          <button
            className={
              persist ? "button secondary calculate-button" : "button primary calculate-button"
            }
            type="submit"
          >
            Calcular planejamento <ArrowRight size={18} />
          </button>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {persist?.prescribeNext && (
            <section className="panel prescribe-step" aria-labelledby="etapa-prescrever">
              <div className="panel-title">
                <span className="mini-number">3</span>
                <h2 id="etapa-prescrever">Prescrever exercícios</h2>
              </div>
              <p>
                Os exercícios de cada treino são escolhidos logo depois de salvar: o botão abaixo salva
                o rascunho e abre a prescrição, fase por fase e treino por treino.
              </p>
              <button
                className="button primary prescribe-button"
                type="button"
                disabled={saving}
                onClick={persistNow}
              >
                <ListChecks size={18} /> {saving ? "Salvando…" : persist.saveLabel}
              </button>
            </section>
          )}
          {persist && !persist.prescribeNext && (
            <div className="persist-actions">
              <button
                className="button primary"
                type="button"
                disabled={saving || (!persist.askTitle && !dirty)}
                onClick={persistNow}
              >
                {saving ? "Salvando…" : persist.saveLabel}
              </button>
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
            <ScheduleSummary schedule={schedule} />
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
      {schedule && <ScheduleResult schedule={schedule} selected={Math.min(selected, schedule.phases.length - 1)} />}
    </>
  );
}
