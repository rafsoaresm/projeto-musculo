import Link from "next/link";
import { Download } from "lucide-react";
import { Pill } from "@/components/ui";
import type { StudentPhase, StudentTrainingPlan } from "@/db/student-plan";
import { describeDose } from "@/modules/prescricao/describe";
import { formatCalendarDate } from "@/modules/training/format";

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
}: {
  plan: StudentTrainingPlan;
  today?: string;
  /** The PDF of this delivered revision, when the page can offer it. */
  pdfHref?: string;
}) {
  const current = plan.phases.find((phase) => phaseStanding(phase, today) === "CURRENT");
  return (
    <section className="panel" aria-labelledby={`plano-${plan.planId}`}>
      <p className="eyebrow">
        REVISÃO {plan.revisionNumber} · {formatCalendarDate(plan.startDate)} A{" "}
        {formatCalendarDate(plan.endDate)}
      </p>
      <h2 id={`plano-${plan.planId}`}>{plan.title}</h2>
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
            open={current ? phase.index === current.index : phase.index === 1}
          >
            <summary>
              <strong>Fase {String(phase.index).padStart(2, "0")}</strong>
              <span className="small muted">
                {formatCalendarDate(phase.startDate)} a {formatCalendarDate(phase.endDate)} ·{" "}
                {phase.weeks} semanas · {phase.sessionsPerWeek}{" "}
                {phase.sessionsPerWeek === 1 ? "sessão" : "sessões"} por semana
                {phase.split === "Full Body" ? "" : ` · divisão ${phase.split}`}
              </span>
              {standing === "CURRENT" && <Pill tone="brand">Fase atual</Pill>}
              {standing === "PAST" && <Pill>Concluída</Pill>}
            </summary>
            <div className="workout-grid">
              {phase.workouts.map((workout) => (
                <section
                  className="workout-card"
                  key={workout.label}
                  aria-label={`Treino ${workout.label}, fase ${phase.index}`}
                >
                  <header>
                    <h3>Treino {workout.label}</h3>
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
