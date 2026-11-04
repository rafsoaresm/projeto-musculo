import Link from "next/link";
import { ClipboardPen, Download } from "lucide-react";
import { Pill, formatDate } from "@/components/ui";
import { deliveredByText } from "@/modules/configuracoes/delivered-by";
import type { StudentExercise, StudentPhase, StudentTrainingPlan } from "@/db/student-plan";
import { describeDose, storedDoseText } from "@/modules/prescricao/describe";
import { progressionOf, selectedWeek, sessionName } from "./weeks";
import { divisionSuffix, formatCalendarDate, phaseTitle, workoutTitle } from "@/modules/training/format";

/** Today as a calendar date in the organization's usual zone, to mark the current phase. */
export const todayInBrazil = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export function phaseStanding(phase: StudentPhase, today: string) {
  if (today < phase.startDate) return "FUTURE" as const;
  if (today > phase.endDate) return "PAST" as const;
  return "CURRENT" as const;
}

/**
 * The delivered training, read only. The doses are exactly what the professional typed:
 * an empty field is left out, never replaced by a suggestion.
 */
export function StudentTraining({
  plan,
  today = todayInBrazil(),
  pdfHref,
  logBase,
  asked,
  selfHref = "/aluno/treino",
}: {
  plan: StudentTrainingPlan;
  today?: string;
  /** The PDF of this delivered revision, when the page can offer it. */
  pdfHref?: string;
  /** Where the student logs a workout of this plan: this address, then `/phase/workout`. */
  logBase?: string;
  /** OCCURRENCE revisions: the phase and week asked for in the address (`?plano=&fase=&semana=`). */
  asked?: { phase: number | null; week: number | null };
  /** The page itself, for the week links. */
  selfHref?: string;
}) {
  const current = plan.phases.find((phase) => phaseStanding(phase, today) === "CURRENT");
  const perSession = plan.prescriptionModel === "OCCURRENCE";
  const selection = perSession ? selectedWeek(plan, today, asked) : null;
  const openPhase = selection?.phase ?? (current ? current.index : 1);
  return (
    <section className="panel" aria-labelledby={`plano-${plan.planId}`}>
      <p className="eyebrow">
        REVISÃO {plan.revisionNumber} · {formatCalendarDate(plan.startDate)} A{" "}
        {formatCalendarDate(plan.endDate)}
      </p>
      <h2 id={`plano-${plan.planId}`}>{plan.title}</h2>
      <p className="small muted">
        Entregue em {formatDate(plan.deliveredAt)}
        {deliveredByText(plan.deliveredBy, plan.deliveredOrganizationName)}.
      </p>
      {pdfHref && (
        <p>
          <Link className="button secondary small" href={pdfHref} download prefetch={false}>
            <Download size={16} /> Baixar PDF do treino
          </Link>
        </p>
      )}
      {today < plan.startDate && (
        <p className="muted">
          O ciclo começa em {formatCalendarDate(plan.startDate)}.
        </p>
      )}
      {today > plan.endDate && (
        <p className="muted">
          Este ciclo terminou em {formatCalendarDate(plan.endDate)}. Fale com o
          seu profissional sobre o próximo.
        </p>
      )}
      {plan.phases.map((phase) => {
        const standing = phaseStanding(phase, today);
        return (
          <details
            key={phase.index}
            className="phase-details"
            open={phase.index === openPhase}
          >
            <summary>
              <strong>{phaseTitle(phase.index, phase.name)}</strong>
              <span className="small muted">
                {formatCalendarDate(phase.startDate)} a {formatCalendarDate(phase.endDate)} ·{" "}
                {phase.weeks} {phase.weeks === 1 ? "semana" : "semanas"} · {phase.sessionsPerWeek}{" "}
                {phase.sessionsPerWeek === 1 ? "sessão" : "sessões"} por semana
                {divisionSuffix(phase.split)}
              </span>
              {standing === "CURRENT" && <Pill tone="brand">Fase atual</Pill>}
              {standing === "PAST" && <Pill>Concluída</Pill>}
            </summary>
            {perSession ? (
              <OccurrencePhase
                plan={plan}
                phase={phase}
                week={selection?.phase === phase.index ? selection.week : (phase.weeksDetail?.[0]?.index ?? 1)}
                selfHref={selfHref}
                logBase={logBase}
              />
            ) : (
            <div className="workout-grid">
              {phase.workouts.map((workout) => (
                <section
                  className="workout-card"
                  key={workout.label}
                  aria-label={`Treino ${workout.label}, fase ${phase.index}`}
                >
                  <header>
                    <h3>{workoutTitle(workout.label, workout.name)}</h3>
                    {logBase && workout.exercises.length > 0 && (
                      <Link
                        className="button secondary small"
                        href={`${logBase}/${phase.index}/${encodeURIComponent(workout.label)}`}
                        aria-label={`Registrar treino ${workout.label}, fase ${phase.index}`}
                      >
                        <ClipboardPen size={16} /> Registrar este treino
                      </Link>
                    )}
                  </header>
                  {workout.exercises.length === 0 ? (
                    <p className="small muted">Nenhum exercício neste treino.</p>
                  ) : (
                    <ol className="exercise-list">
                      {workout.exercises.map((exercise, index) => (
                        <li key={index}>
                          <div className="exercise-main">
                            <strong>{exercise.name}</strong>
                            <span className="small muted">
                              {describeDose(exercise) || "Sem parâmetros definidos"}
                            </span>
                            {exercise.notes && (
                              <span className="small muted">Obs.: {exercise.notes}</span>
                            )}
                            {exercise.videoUrl && (
                              <span className="small">
                                <a
                                  href={exercise.videoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {exercise.videoStatus === "SEARCH_LINK"
                                    ? "Buscar vídeos de execução"
                                    : "Ver vídeo"}
                                </a>
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              ))}
            </div>
            )}
          </details>
        );
      })}
      <p className="small muted">
        Este é o treino que o seu profissional aprovou e entregou. Em caso de
        dor ou desconforto, interrompa e fale com ele.{" "}
        <Link className="account-link" href="/aluno">
          Voltar ao início
        </Link>
      </p>
    </section>
  );
}

function ExerciseItems({ exercises }: { exercises: StudentExercise[] }) {
  return (
    <ol className="exercise-list">
      {exercises.map((exercise, index) => (
        <li key={index}>
          <div className="exercise-main">
            <strong>{exercise.name}</strong>
            <span className="small muted">{storedDoseText(exercise) || "Sem parâmetros definidos"}</span>
            {exercise.notes && <span className="small muted">Obs.: {exercise.notes}</span>}
            {exercise.videoUrl && (
              <span className="small">
                <a href={exercise.videoUrl} target="_blank" rel="noopener noreferrer">
                  {exercise.videoStatus === "SEARCH_LINK" ? "Buscar vídeos de execução" : "Ver vídeo"}
                </a>
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * One phase of a revision written session by session (motor S8): the weeks as links (one address per week, so several plans on the
 * page never collide), the sessions of the chosen week with their stored doses, and the progression of each workout across the weeks.
 * Only what was delivered: no basis, trace or alert of the automatic prescription reaches the student.
 */
function OccurrencePhase({
  plan,
  phase,
  week,
  selfHref,
  logBase,
}: {
  plan: StudentTrainingPlan;
  phase: StudentPhase;
  week: number;
  selfHref: string;
  logBase?: string;
}) {
  const weeks = phase.weeksDetail ?? [];
  const shown = weeks.find((item) => item.index === week) ?? weeks[0];
  const href = (index: number) =>
    `${selfHref}?plano=${encodeURIComponent(plan.planId)}&fase=${phase.index}&semana=${index}#plano-${plan.planId}`;
  return (
    <div className="occurrence-phase">
      <nav className="week-nav" aria-label={`Semanas da fase ${phase.index}`}>
        {weeks.map((item) => (
          <Link key={item.index} href={href(item.index)} aria-current={item.index === shown?.index ? "page" : undefined} scroll={false}>
            Semana {item.index}
          </Link>
        ))}
      </nav>
      {shown && (
        <>
          <p className="small muted">
            Semana {shown.index}: {formatCalendarDate(shown.startDate)} a {formatCalendarDate(shown.endDate)}
          </p>
          {shown.sessions.length === 0 ? (
            <p className="small muted">Nenhuma sessão nesta semana.</p>
          ) : (
            <div className="workout-grid">
              {shown.sessions.map((session) => (
                <section
                  className="workout-card"
                  key={session.id}
                  aria-label={`${sessionName(session)}, treino ${session.label}, fase ${phase.index}`}
                >
                  <header>
                    <h3>
                      {sessionName(session)} · {workoutTitle(session.label, session.name)}
                    </h3>
                    {session.plannedDate && (
                      <span className="small muted">Previsto para {formatCalendarDate(session.plannedDate)}</span>
                    )}
                    {logBase && session.exercises.length > 0 && (
                      <Link
                        className="button secondary small"
                        href={`${logBase}/${phase.index}/${encodeURIComponent(session.label)}?ocorrencia=${encodeURIComponent(session.id)}`}
                        aria-label={`Registrar ${sessionName(session).toLowerCase()}, treino ${session.label}, fase ${phase.index}`}
                      >
                        <ClipboardPen size={16} /> Registrar esta sessão
                      </Link>
                    )}
                  </header>
                  {session.exercises.length === 0 ? (
                    <p className="small muted">Nenhum exercício nesta sessão.</p>
                  ) : (
                    <ExerciseItems exercises={session.exercises} />
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {phase.workouts.map((workout) => {
        const rows = progressionOf(weeks, workout.label);
        if (rows.length === 0 || weeks.length < 2) return null;
        return (
          <details key={workout.label} className="progression-details">
            <summary>Progressão nesta fase · {workoutTitle(workout.label, workout.name)}</summary>
            <div className="execution-scroll">
              <table className="execution-table">
                <caption className="small muted">
                  A dose de cada semana, como o seu profissional entregou. “—”: o exercício não está nas sessões dessa semana.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Exercício</th>
                    {weeks.map((item) => (
                      <th scope="col" key={item.index}>
                        Semana {item.index}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.exerciseId}>
                      <th scope="row">{row.name}</th>
                      {row.cells.map((cell, index) => (
                        <td key={index}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
