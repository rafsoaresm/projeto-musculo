import Link from "next/link";
import { Pill } from "@/components/ui";
import type { AssessmentSnapshot } from "@/db/assessments";
import { formatCalendarDate } from "@/modules/training/format";
import { buildSeries, changesBetween, seriesTitle } from "./evolution";
import { MetricChart } from "./metric-chart";
import { ScreeningPill } from "./screening-pill";

const AREA_LABEL = { SCREENING: "Triagem", POSTURE: "Postura", MOVEMENT: "Movimento" } as const;

/**
 * The history of one student's recorded assessments. It shows what was recorded and what differs
 * between two records. It does not say better or worse, and it does not say resolved.
 */
export function EvolutionView({
  studentId,
  history,
}: {
  studentId: string;
  history: AssessmentSnapshot[];
}) {
  if (history.length === 0)
    return (
      <section className="panel">
        <h2>Nenhuma avaliação registrada.</h2>
        <p>A evolução aparece depois da primeira avaliação registrada.</p>
        <Link className="button primary" href={`/profissional/alunos/${studentId}/avaliacoes`}>
          Abrir as avaliações
        </Link>
      </section>
    );
  const series = buildSeries(history);
  const pairs = history.slice(1).map((after, index) => ({ before: history[index], after })).reverse();
  return (
    <>
      <section className="panel" aria-labelledby="indicadores-evolucao">
        <p className="eyebrow">INDICADORES</p>
        <h2 id="indicadores-evolucao">Medidas ao longo do tempo</h2>
        <p className="muted">
          {history.length} {history.length === 1 ? "avaliação registrada" : "avaliações registradas"}, de{" "}
          {formatCalendarDate(history[0].assessedOn)} a{" "}
          {formatCalendarDate(history[history.length - 1].assessedOn)}. Os valores são os digitados;
          a ferramenta não diz se uma mudança é melhor ou pior.
        </p>
        {series.length === 0 && <p>Nenhum indicador foi registrado nessas avaliações.</p>}
        {series.map((item) => {
          const title = seriesTitle(item);
          const first = item.points[0];
          const last = item.points[item.points.length - 1];
          const unit = item.unit ? ` ${item.unit}` : "";
          return (
            <div key={item.key} className="series-block" role="group" aria-label={title}>
              <h3>
                {title}
                {item.unit && <span className="small muted"> · {item.unit}</span>}
              </h3>
              <p className="small muted">
                {item.points.length === 1
                  ? `Uma medição: ${first.valueText}${unit} em ${formatCalendarDate(first.assessedOn)}.`
                  : `Primeira: ${first.valueText}${unit} em ${formatCalendarDate(first.assessedOn)}. Última: ${last.valueText}${unit} em ${formatCalendarDate(last.assessedOn)}.`}
              </p>
              {item.numeric.length >= 2 && (
                <MetricChart
                  title={title}
                  unit={item.unit}
                  points={item.numeric.map((point) => ({
                    assessedOn: point.assessedOn,
                    value: point.valueNumber as number,
                    text: point.valueText,
                  }))}
                />
              )}
              {item.points.length > 1 && (
                <details>
                  <summary>Ver os valores</summary>
                  <div className="table-wrap">
                    <table className="data-table stack">
                      <caption className="sr-only">Valores de {title}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Data</th>
                          <th scope="col">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.points.map((point) => (
                          <tr key={point.assessmentId}>
                            <th scope="row" data-label="Data">
                              {formatCalendarDate(point.assessedOn)}
                            </th>
                            <td data-label="Valor">
                              {point.valueText}
                              {unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </section>

      <section className="panel" aria-labelledby="linha-do-tempo">
        <p className="eyebrow">TRIAGEM</p>
        <h2 id="linha-do-tempo">Linha do tempo</h2>
        <div className="table-wrap">
          <table className="data-table stack">
            <caption className="sr-only">Avaliações registradas, da mais recente para a mais antiga</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Tipo</th>
                <th scope="col">Triagem</th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((assessment) => (
                <tr key={assessment.id}>
                  <th scope="row" data-label="Data">
                    <Link
                      className="row-link"
                      href={`/profissional/alunos/${studentId}/avaliacoes/${assessment.id}`}
                    >
                      {formatCalendarDate(assessment.assessedOn)}
                    </Link>
                  </th>
                  <td data-label="Tipo">{assessment.kind === "INITIAL" ? "Inicial" : "Reavaliação"}</td>
                  <td data-label="Triagem">
                    <ScreeningPill risk={assessment.riskStatus} reviewed={assessment.reviewed} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="mudancas">
        <p className="eyebrow">COMPARAÇÃO</p>
        <h2 id="mudancas">O que mudou entre avaliações</h2>
        {pairs.length === 0 ? (
          <p className="muted">Há uma avaliação só. A comparação aparece a partir da segunda.</p>
        ) : (
          pairs.map(({ before, after }, index) => {
            const changes = changesBetween(before, after);
            return (
              <details key={after.id} open={index === 0}>
                <summary>
                  De {formatCalendarDate(before.assessedOn)} para {formatCalendarDate(after.assessedOn)}{" "}
                  <Pill tone="neutral">
                    {changes.length === 0
                      ? "Sem diferenças"
                      : `${changes.length} ${changes.length === 1 ? "diferença" : "diferenças"}`}
                  </Pill>
                </summary>
                {changes.length === 0 ? (
                  <p className="muted">
                    A triagem, a postura e o movimento foram registrados do mesmo jeito. Os indicadores
                    estão nos gráficos acima.
                  </p>
                ) : (
                  <ul className="change-list">
                    {changes.map((change) => (
                      <li key={`${change.area}-${change.label}`}>
                        <strong>{AREA_LABEL[change.area]}:</strong> {change.label}. {change.text}.
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })
        )}
      </section>
    </>
  );
}
