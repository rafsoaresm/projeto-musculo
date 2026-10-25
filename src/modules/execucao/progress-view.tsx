import { Pill } from "@/components/ui";
import type { StudentProgress, CycleProgress } from "@/db/workout-sessions";
import { MetricChart } from "@/modules/avaliacoes/metric-chart";
import { formatCalendarDate } from "@/modules/training/format";
import { closedSummary, type WeekRecord } from "./progress";

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** The same facts for the two readers, in the words that suit each one. */
const COPY = {
  professional: {
    weeksTitle: "Registros por semana",
    weeksIntro:
      "Os treinos que o aluno registrou em cada semana, ao lado dos previstos pelo ciclo entregue. É o que ele registrou: uma semana sem registro não prova que ele não treinou, e a semana em andamento ainda não terminou.",
    noCycle: "Nenhum treino foi entregue a este aluno ainda.",
    loadTitle: "Carga por exercício",
    loadIntro:
      "A maior carga que o aluno anotou em cada dia, por exercício, no último ano. São números digitados por ele: a ferramenta não diz se subir ou descer é melhor, e não muda o treino por causa deles.",
    noExercise: "O aluno ainda não registrou exercícios.",
  },
  student: {
    weeksTitle: "Seus registros por semana",
    weeksIntro:
      "Os treinos que você registrou em cada semana, ao lado dos previstos pelo seu ciclo. Semana sem registro não quer dizer que você não treinou, e a semana em andamento ainda não terminou.",
    noCycle: "Nenhum treino foi liberado para você ainda.",
    loadTitle: "Sua carga por exercício",
    loadIntro:
      "A maior carga que você anotou em cada dia, por exercício, no último ano. São os números que você digitou: a ferramenta não diz se subir ou descer é melhor e não muda o seu treino por causa deles.",
    noExercise: "Você ainda não registrou exercícios.",
  },
} as const;
const SHOWN_WEEKS = 12;
const range = (week: WeekRecord) =>
  `${formatCalendarDate(week.startDate).slice(0, 5)} a ${formatCalendarDate(week.endDate).slice(0, 5)}`;

function WeekRows({ weeks }: { weeks: WeekRecord[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table stack">
        <thead>
          <tr>
            <th scope="col">Semana</th>
            <th scope="col">Fase</th>
            <th scope="col">Previstos</th>
            <th scope="col">Registrados</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={`${week.phaseIndex}-${week.startDate}`}>
              <th scope="row" data-label="Semana">
                {range(week)} {week.inProgress && <Pill tone="brand">Em andamento</Pill>}
              </th>
              <td data-label="Fase">{week.phaseIndex}</td>
              <td data-label="Previstos">
                {week.planned} · {week.workouts.join(", ")}
              </td>
              <td data-label="Registrados">
                {week.recorded}
                {week.recordedWorkouts.length > 0 && ` · ${week.recordedWorkouts.join(", ")}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cycle({ cycle }: { cycle: CycleProgress }) {
  const newest = [...cycle.weeks].reverse();
  const shown = newest.slice(0, SHOWN_WEEKS);
  const earlier = newest.slice(SHOWN_WEEKS);
  return (
    <div className="series-block" role="group" aria-label={`${cycle.planTitle}, revisão ${cycle.revisionNumber}`}>
      <h3>
        {cycle.planTitle}, revisão {cycle.revisionNumber}{" "}
        {cycle.supersededOn ? (
          <Pill>Substituída em {formatCalendarDate(cycle.supersededOn)}</Pill>
        ) : (
          <Pill tone="success">Em uso</Pill>
        )}
      </h3>
      <p className="small muted">
        Entregue em {formatCalendarDate(cycle.deliveredOn)}.{" "}
        {closedSummary(cycle.closed, cycle.outside)}
      </p>
      {cycle.weeks.length === 0 ? (
        <p>Ainda não há semana deste ciclo para mostrar.</p>
      ) : (
        <>
          <WeekRows weeks={shown} />
          {earlier.length > 0 && (
            <details>
              <summary>Ver as {earlier.length} semanas anteriores</summary>
              <WeekRows weeks={earlier} />
            </details>
          )}
        </>
      )}
    </div>
  );
}

/**
 * What the student logged against what the cycle foresaw, and the heaviest load typed per
 * exercise. It counts and lists; it does not grade, and a week without a log is not called a miss.
 */
export function ProgressView({
  progress,
  audience = "professional",
}: {
  progress: StudentProgress;
  audience?: keyof typeof COPY;
}) {
  const copy = COPY[audience];
  return (
    <>
      <section className="panel" aria-labelledby="registros-semana">
        <p className="eyebrow">REGISTROS NO CICLO</p>
        <h2 id="registros-semana">{copy.weeksTitle}</h2>
        <p className="muted">{copy.weeksIntro}</p>
        {progress.cycles.length === 0 ? (
          <p>{copy.noCycle}</p>
        ) : (
          progress.cycles.map((cycle) => <Cycle key={`${cycle.planId}-${cycle.revisionNumber}`} cycle={cycle} />)
        )}
      </section>

      <section className="panel" aria-labelledby="carga-exercicio">
        <p className="eyebrow">CARGA</p>
        <h2 id="carga-exercicio">{copy.loadTitle}</h2>
        <p className="muted">{copy.loadIntro}</p>
        {progress.series.length === 0 && <p>{copy.noExercise}</p>}
        {progress.series.map((item) => {
          const first = item.numeric[0];
          const last = item.numeric[item.numeric.length - 1];
          return (
            <div key={item.key} className="series-block" role="group" aria-label={`Carga: ${item.name}`}>
              <h3>{item.name}</h3>
              <p className="small muted">
                {item.numeric.length === 0
                  ? "Nenhuma carga anotada para este exercício."
                  : item.numeric.length === 1
                    ? `Uma carga anotada: ${number.format(first.maxLoadKg)} kg em ${formatCalendarDate(first.performedOn)}.`
                    : `Primeira: ${number.format(first.maxLoadKg)} kg em ${formatCalendarDate(first.performedOn)}. Última: ${number.format(last.maxLoadKg)} kg em ${formatCalendarDate(last.performedOn)}.`}
              </p>
              {item.numeric.length >= 2 && (
                <MetricChart
                  title={`Carga de ${item.name}`}
                  unit="kg"
                  points={item.numeric.map((point) => ({
                    assessedOn: point.performedOn,
                    value: point.maxLoadKg,
                    text: number.format(point.maxLoadKg),
                  }))}
                />
              )}
              <details>
                <summary>Ver os registros</summary>
                <div className="table-wrap">
                  <table className="data-table stack">
                    <caption className="sr-only">Registros de {item.name}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Data</th>
                        <th scope="col">Maior carga</th>
                        <th scope="col">Séries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.points.map((point) => (
                        <tr key={point.performedOn}>
                          <th scope="row" data-label="Data">
                            {formatCalendarDate(point.performedOn)}
                          </th>
                          <td data-label="Maior carga">
                            {point.maxLoadKg === null
                              ? "Sem carga anotada"
                              : `${number.format(point.maxLoadKg)} kg${point.repsAtMax === null ? "" : ` × ${point.repsAtMax} rep.`}`}
                          </td>
                          <td data-label="Séries">{point.sets}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          );
        })}
      </section>
    </>
  );
}
