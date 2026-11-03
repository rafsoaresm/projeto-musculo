import Link from "next/link";
import { Pill } from "@/components/ui";
import type { AssessmentSnapshot } from "@/db/assessments";
import { formatCalendarDate } from "@/modules/training/format";
import { buildSeries, changesBetween, seriesTitle } from "./evolution";
import { MetricChart } from "./metric-chart";
import { PhotoImage } from "./photo-image";
import { PHOTO_VIEWS } from "./photos";
import { ScreeningPill } from "./screening-pill";
import { LEGACY_METHOD } from "./v2/evolution";
import { ResultsEvolution } from "./v2/results-evolution";

const AREA_LABEL = { SCREENING: "Triagem", POSTURE: "Postura", MOVEMENT: "Movimento" } as const;

/**
 * An earlier-format assessment without the body fat that migration 0033 copied into its results (the first BODY_FAT with that value), so the
 * value is not listed twice when the evolution also shows the results. Anything else typed stays.
 */
function withoutCopiedBodyFat(assessment: AssessmentSnapshot): AssessmentSnapshot {
  if (assessment.formatVersion === 2) return assessment;
  const copied = assessment.results.find((result) => result.code === "body_fat_percent" && result.method === LEGACY_METHOD);
  if (!copied) return assessment;
  const index = assessment.metrics.findIndex((metric) => metric.metricType === "BODY_FAT" && metric.valueNumber === copied.value);
  return index === -1 ? assessment : { ...assessment, metrics: assessment.metrics.filter((_, position) => position !== index) };
}

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
          Abrir a avaliação física
        </Link>
      </section>
    );
  // The item-by-item comparison reads the screening, posture and movement of the earlier format; the Avaliação Física keeps them in its
  // modules, so a pair with one of it is not compared here (saying "no differences" would be false).
  const earlier = history.filter((assessment) => assessment.formatVersion === null);
  const pairs = earlier.slice(1).map((after, index) => ({ before: earlier[index], after })).reverse();
  // Slice 0.82: the results of the Avaliação Física in comparable series. Only an Avaliação Física brings them in: with the earlier format
  // alone the page stays as it was, even though migration 0033 copied each earlier body fat into the results as "método desconhecido".
  // With both, that copy is listed apart in the results ("Formato anterior · método desconhecido") and the same typed value is taken out of
  // the earlier measures, so it shows once.
  const withResults = history.some((assessment) => assessment.formatVersion === 2);
  const measured = withResults ? history.map(withoutCopiedBodyFat) : history;
  const series = buildSeries(measured);
  // Slice 0.84: two assessments of the same date are drawn side by side, each dated with the time it was recorded.
  const recordedAt = new Map(history.map((assessment) => [assessment.id, assessment.recordedAt]));
  const withMetrics = !withResults || measured.some((assessment) => assessment.metrics.length > 0);
  const counted = `${history.length} ${history.length === 1 ? "avaliação registrada" : "avaliações registradas"}, de ${formatCalendarDate(history[0].assessedOn)} a ${formatCalendarDate(history[history.length - 1].assessedOn)}.`;
  return (
    <>
      <p className="muted evolution-count">{counted}</p>
      {withResults && <ResultsEvolution history={history} />}
      {withMetrics && (
        <section className="panel" aria-labelledby="indicadores-evolucao">
          <p className="eyebrow">{withResults ? "FORMATO ANTERIOR" : "INDICADORES"}</p>
          <h2 id="indicadores-evolucao">{withResults ? "Medidas do formato anterior" : "Medidas ao longo do tempo"}</h2>
          <p className="muted">
            {withResults
              ? "Digitadas nas avaliações do formato anterior, sem método registrado: não se misturam com os resultados acima. "
              : ""}
            Os valores são os digitados; a ferramenta não diz se uma mudança é melhor ou pior.
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
                      recordedAt: recordedAt.get(point.assessmentId) ?? null,
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
      )}

      {history.some((assessment) => assessment.photos.length > 0) && (
        <section className="panel" aria-labelledby="fotos-evolucao">
          <p className="eyebrow">FOTOS</p>
          <h2 id="fotos-evolucao">Fotos da postura ao longo do tempo</h2>
          <p className="muted">
            Registro visual, não diagnóstico. Cada linha é uma vista, da mais antiga para a mais recente, com as
            últimas quatro avaliações que têm foto. As fotos só aparecem para você.
          </p>
          {PHOTO_VIEWS.map((view) => {
            const shots = history
              .filter((assessment) => assessment.photos.some((photo) => photo.view === view.key))
              .slice(-4);
            return shots.length === 0 ? null : (
              <div key={view.key} role="group" aria-label={`Fotos ${view.label.toLowerCase()}`}>
                <h3>{view.label}</h3>
                <div className="photo-grid">
                  {shots.map((assessment) => (
                    <figure key={assessment.id} className="photo-slot">
                      <PhotoImage
                        studentId={studentId}
                        assessmentId={assessment.id}
                        view={view.key}
                        stamp={assessment.photos.find((photo) => photo.view === view.key)?.createdAt ?? ""}
                        erasedAt={assessment.photos.find((photo) => photo.view === view.key)?.erasedAt ?? null}
                        alt={`Foto ${view.label.toLowerCase()} de ${formatCalendarDate(assessment.assessedOn)}`}
                      />
                      <figcaption>{formatCalendarDate(assessment.assessedOn)}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

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
                  <td data-label="Tipo">
                    {assessment.kind === "INITIAL" ? "Inicial" : "Reavaliação"}
                    {assessment.formatVersion === null ? " (formato anterior)" : ""}
                  </td>
                  <td data-label="Triagem">
                    <ScreeningPill risk={assessment.riskStatus} reviewed={assessment.reviewed} parq={assessment.formatVersion === 2} />
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
        {withResults && (
          <p className="muted">
            A comparação item a item da triagem, da postura e do movimento lê só as avaliações do formato anterior. As da Avaliação Física têm
            os resultados nas séries acima, e cada registro abre pela linha do tempo.
          </p>
        )}
        {pairs.length === 0 ? (
          withResults ? null : <p className="muted">Há uma avaliação só. A comparação aparece a partir da segunda.</p>
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
