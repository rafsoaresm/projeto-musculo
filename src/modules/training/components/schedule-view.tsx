"use client";

import { CalendarDays, Download } from "lucide-react";
import type { PeriodizationSchedule } from "../contracts";
import { formatCalendarDate as formatDate } from "../format";

/** Real duration of a calculated cycle. Shared by the planner and saved plans. */
export function ScheduleSummary({
  schedule,
  onDownload,
}: {
  schedule: PeriodizationSchedule;
  onDownload?: () => void;
}) {
  return (
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
        {formatDate(schedule.startDate)} → {formatDate(schedule.endDate)}
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
        Calendário contínuo, sem sobreposição. Datas das sessões e dias de
        descanso serão definidos na prescrição.
      </p>
      {onDownload && (
        <>
          <button
            className="button secondary full-width"
            type="button"
            onClick={onDownload}
          >
            <Download size={17} /> Exportar rascunho JSON
          </button>
          <p className="small muted">
            A exportação contém apenas a estrutura. Não equivale a uma
            prescrição aprovada.
          </p>
        </>
      )}
    </>
  );
}

/** Phase table and weekly rotation of the selected phase. */
export function ScheduleResult({
  schedule,
  selected,
  badge = "Revisão profissional necessária",
}: {
  schedule: PeriodizationSchedule;
  selected: number;
  badge?: string;
}) {
  return (
    <section className="panel schedule-result">
      <div className="section-heading">
        <div>
          <p className="eyebrow">VISUALIZAÇÃO DO RASCUNHO</p>
          <h2>Sequência dos mesociclos</h2>
        </div>
        <span className="pill brand-pill">{badge}</span>
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
  );
}
