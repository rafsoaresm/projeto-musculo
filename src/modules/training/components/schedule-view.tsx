"use client";

import { CalendarDays } from "lucide-react";
import type { PeriodizationSchedule } from "../contracts";
import { formatCalendarDate as formatDate } from "../format";
import { phaseDivisionText, phaseName, phaseTargetText } from "../periodization";

/** Real duration of a calculated cycle. Shared by the planner and saved plans. */
export function ScheduleSummary({ schedule }: { schedule: PeriodizationSchedule }) {
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
                <th scope="row">
                  {String(item.index).padStart(2, "0")}
                  {phaseName(item) && <span className="small muted"> · {phaseName(item)}</span>}
                </th>
                <td>
                  {formatDate(item.startDate)} — {formatDate(item.endDate)}
                </td>
                <td>{item.weeks}</td>
                <td>{item.sessionsPerWeek}</td>
                <td>
                  <span className="pill neutral">{phaseDivisionText(item)}</span>
                </td>
                <td>{phaseTargetText(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="microcycle-title">Rotação da fase {selected + 1}</h3>
      <div className="microcycles">
        {(schedule.phases[selected] ?? schedule.phases[0]).microcycles.map((week) => {
          const dated = "slots" in week ? week.slots.filter((slot) => slot.plannedDate) : [];
          return (
            <div key={week.index}>
              <span>Semana {week.index}</span>
              <strong>{week.sessions.join(" / ")}</strong>
              <small>
                {dated.length
                  ? dated.map((slot) => `${slot.label} ${formatDate(slot.plannedDate as string).slice(0, 5)}`).join(" · ")
                  : formatDate(week.startDate)}
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
