"use client";

import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Download,
  Info,
  RotateCw,
} from "lucide-react";
import { buildPeriodization } from "../periodization";
import {
  periodizationInputSchema,
  phaseSchema,
  type PhaseInput,
  type PeriodizationSchedule,
} from "../contracts";

const defaultPhase = (): PhaseInput => ({
  weeks: 4,
  sessionsPerWeek: 3,
  split: "ABC",
  exercisesPerSession: 5,
});
const formatDate = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );

export function Planner() {
  const [startDate, setStartDate] = useState("");
  const [phases, setPhases] = useState<PhaseInput[]>(() =>
    Array.from({ length: 3 }, defaultPhase),
  );
  const [selected, setSelected] = useState(0);
  const [schedule, setSchedule] = useState<PeriodizationSchedule | null>(null);
  const [error, setError] = useState("");
  const phase = phases[selected];

  function invalidate() {
    setSchedule(null);
    setError("");
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
          exercícios nem libera treinos. As alterações ficam nesta página;
          exporte o rascunho para guardar o resultado.
        </p>
      </div>
      <div className="planner-layout">
        <form className="planner-form" onSubmit={calculate}>
          <section className="panel">
            <div className="panel-title">
              <span className="mini-number">1</span>
              <h2>Estrutura do ciclo</h2>
            </div>
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
        </form>
        <aside className="planner-summary" aria-live="polite">
          {schedule ? (
            <>
              <div className="summary-top">
                <span className="eyebrow">DURAÇÃO REAL</span>
                <CalendarDays size={23} />
              </div>
              <div className="big-stat">
                {schedule.totalWeeks}
                <span>semanas</span>
              </div>
              <p className="date-range">
                {formatDate(schedule.startDate)} →{" "}
                {formatDate(schedule.endDate)}
              </p>
              <div className="summary-stats">
                <div>
                  <strong>{schedule.phases.length}</strong>
                  <span>fases</span>
                </div>
                <div>
                  <strong>{schedule.totalSessions}</strong>
                  <span>sessões previstas</span>
                </div>
              </div>
              <p className="summary-caption">
                Calendário contínuo, sem sobreposição. Datas das sessões e dias
                de descanso serão definidos na prescrição.
              </p>
              <button
                className="button secondary full-width"
                type="button"
                onClick={download}
              >
                <Download size={17} /> Exportar rascunho JSON
              </button>
              <p className="small muted">
                A exportação contém apenas a estrutura. Não equivale a uma
                prescrição aprovada.
              </p>
            </>
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
      {schedule && (
        <section className="panel schedule-result">
          <div className="section-heading">
            <div>
              <p className="eyebrow">VISUALIZAÇÃO DO RASCUNHO</p>
              <h2>Sequência dos mesociclos</h2>
            </div>
            <span className="pill brand-pill">
              Revisão profissional necessária
            </span>
          </div>
          <div className="schedule-table-wrap">
            <table>
              <caption className="sr-only">
                Datas e configuração de todas as fases
              </caption>
              <thead>
                <tr>
                  <th>Fase</th>
                  <th>Período</th>
                  <th>Semanas</th>
                  <th>Sessões / semana</th>
                  <th>Divisão</th>
                  <th>Exercícios / treino</th>
                </tr>
              </thead>
              <tbody>
                {schedule.phases.map((item) => (
                  <tr key={item.index}>
                    <th scope="row">{String(item.index).padStart(2, "0")}</th>
                    <td>
                      {formatDate(item.startDate)} — {formatDate(item.endDate)}
                    </td>
                    <td>{item.weeks}</td>
                    <td>{item.sessionsPerWeek}</td>
                    <td>
                      <span className="pill neutral">{item.split}</span>
                    </td>
                    <td>{item.exercisesPerSession}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="microcycle-title">Rotação da fase {selected + 1}</h3>
          <div className="microcycles">
            {schedule.phases[selected].microcycles.map((week) => (
              <div key={week.index}>
                <span>Semana {week.index}</span>
                <strong>{week.sessions.join(" / ")}</strong>
                <small>{formatDate(week.startDate)}</small>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
