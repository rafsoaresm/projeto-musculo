import { TriangleAlert } from "lucide-react";
import { Pill } from "@/components/ui";
import { dateLabels } from "../evolution";
import { MetricChart } from "../metric-chart";
import { CONVERSION_LABEL } from "./composition";
import { BREAK_LABEL, resultEvolution, type ComparableSeries, type EvolutionPoint, type EvolutionSource, type ResultEvolution } from "./evolution";
import { FLAG_LABEL, RESULT_LABEL, formatResult, isResultEstimate, methodLabel, resultDigits } from "./review";
import { BEFORE_TABLES, classificationDetail, classificationLevel, classificationSubject, CLASSIFIED_CODES, isClassifiedCode } from "../classifications";

const valueText = (code: string, point: Pick<EvolutionPoint, "value" | "unit">) =>
  point.value === null ? "Sem valor" : formatResult(code, point.value, point.unit);
const conversionText = (conversion: string | null) =>
  conversion === null ? null : (CONVERSION_LABEL[conversion as keyof typeof CONVERSION_LABEL] ?? conversion);

/** How a series was obtained, in words: formula version, conversion, estimate. The classification of each value is in the table of values. */
function methodLine(code: string, series: Pick<ComparableSeries, "method" | "formulaVersion" | "conversion">) {
  const parts = [series.formulaVersion ? `fórmula ${series.formulaVersion}` : null, conversionText(series.conversion) ? `conversão ${conversionText(series.conversion)}` : null];
  if (isResultEstimate(code, series.method)) parts.push("estimativa");
  return parts.filter(Boolean).join(" · ");
}

/** The handoff's warning (4.3), verbatim for the body fat; for the other results the same sentence with the result's name. */
const HANDOFF_WARNING = "Metodologias diferentes; comparação de % de gordura pode não ser equivalente";
function warning(group: ResultEvolution, title: string) {
  if (!group.methodsDiffer) return `Mesmo método, com versão da fórmula, conversão ou unidade diferente; comparação de “${title}” pode não ser equivalente. Cada uma tem a sua série.`;
  if (group.code === "body_fat_percent") return `${HANDOFF_WARNING}. Cada método tem a sua série.`;
  return `Metodologias diferentes; comparação de “${title}” pode não ser equivalente. Cada método tem a sua série.`;
}

/** The date of each value of a result, keyed by assessment: with the time it was recorded when another value of the result shares the date. */
type DateOf = (point: EvolutionPoint, compact?: boolean) => string;
function datesOf(points: EvolutionPoint[]): DateOf {
  const labels = dateLabels(points);
  const compactLabels = dateLabels(points, true);
  const byAssessment = new Map(points.map((point, index) => [point.assessmentId, [labels[index], compactLabels[index]] as const]));
  return (point, compact = false) => byAssessment.get(point.assessmentId)?.[compact ? 1 : 0] ?? dateLabels([point], compact)[0];
}

function summary(code: string, points: EvolutionPoint[], dateOf: DateOf) {
  const first = points[0];
  const last = points[points.length - 1];
  return points.length === 1
    ? `Um valor: ${valueText(code, first)} em ${dateOf(first)}.`
    : `${points.length} valores. Primeiro: ${valueText(code, first)} em ${dateOf(first)}. Último: ${valueText(code, last)} em ${dateOf(last)}.`;
}

function Series({ group, series, title, dateOf }: { group: ResultEvolution; series: ComparableSeries; title: string; dateOf: DateOf }) {
  const digits = resultDigits(group.code);
  const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits });
  const label = `${title}, ${methodLabel(series.method)}`;
  return (
    <div className="av2-evolution-series" role="group" aria-label={label}>
      <p className="av2-evolution-method">
        <strong>{methodLabel(series.method)}</strong>
        {methodLine(group.code, series) && <span className="small muted"> · {methodLine(group.code, series)}</span>}
        {group.mixed && series.latest && (
          <>
            {" "}
            <Pill tone="neutral">Método da avaliação mais recente</Pill>
          </>
        )}
      </p>
      <p className="small muted">{summary(group.code, series.points, dateOf)}</p>
      {series.numeric.length >= 2 && (
        <MetricChart
          title={label}
          unit={series.unit}
          digits={digits}
          points={series.numeric.map((point) => ({
            assessedOn: point.assessedOn,
            recordedAt: point.recordedAt,
            value: point.value as number,
            text: number.format(point.value as number),
            // The same date as the summary and the table: worked out over every value of the result, not only this series'.
            label: dateOf(point),
            axisLabel: dateOf(point, true),
          }))}
        />
      )}
    </div>
  );
}

/**
 * The results of the Avaliação Física over time (handoff 4.3, 5 and 9): per result, one series per way of obtaining it, each with its own
 * line; a change of protocol, of formula version or of conversion is marked where it happens and never joined to the values before it. The
 * values of the earlier format (method unknown) are listed apart. A rise or fall is never called better or worse. Two assessments of the same
 * date are in the order they were recorded and dated with the time (slice 0.84). The same panel serves the student's area (slice 0.84), read
 * only, with its own heading id and title when the login is linked to more than one student.
 */
export function ResultsEvolution({ history, headingId = "resultados-evolucao", heading = "Resultados ao longo do tempo" }: { history: EvolutionSource[]; headingId?: string; heading?: string }) {
  const groups = resultEvolution(history);
  return (
    <section className="panel" aria-labelledby={headingId}>
      <p className="eyebrow">RESULTADOS</p>
      <h2 id={headingId}>{heading}</h2>
      <p className="muted">
        Cada série reúne só valores obtidos do mesmo jeito: o mesmo método ou protocolo, a mesma versão da fórmula e a mesma conversão. Um
        protocolo diferente começa outra série, com a sua própria linha. Os valores são os registrados ao finalizar cada avaliação, com a
        classificação registrada naquele momento pela tabela de referência indicada, quando há; a ferramenta não diz se uma mudança é melhor ou pior.
      </p>
      {groups.length === 0 && <p>Nenhum resultado foi calculado nessas avaliações.</p>}
      {groups.map((group) => {
        const title = RESULT_LABEL[group.code] ?? group.code;
        const dateOf = datesOf(group.timeline);
        const legacyDates = dateLabels(group.legacy);
        return (
          <div key={group.code} className="series-block av2-evolution" role="group" aria-label={title}>
            <h3>{title}</h3>
            {group.mixed && (
              <p className="av2-attention av2-evolution-warning">
                <TriangleAlert size={18} aria-hidden="true" />
                <span>{warning(group, title)}</span>
              </p>
            )}
            {group.series.map((series) => (
              <Series key={series.key} group={group} series={series} title={title} dateOf={dateOf} />
            ))}
            {group.timeline.length > 1 && (
              <details>
                <summary>Ver os valores</summary>
                <div className="table-wrap">
                  <table className="data-table stack">
                    <caption className="sr-only">Valores de {title}, do mais antigo ao mais recente</caption>
                    <thead>
                      <tr>
                        <th scope="col">Data</th>
                        <th scope="col">Valor</th>
                        <th scope="col">Método</th>
                        {isClassifiedCode(group.code) && <th scope="col">{CLASSIFIED_CODES[group.code] === "cooper_12min" ? "Classificação da distância" : "Classificação"}</th>}
                        <th scope="col">Comparação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.timeline.map((point, index) => (
                        <tr key={`${point.assessmentId}-${index}`} data-break={point.break ?? undefined}>
                          <th scope="row" data-label="Data">
                            {dateOf(point)}
                          </th>
                          <td data-label="Valor">{valueText(group.code, point)}</td>
                          <td data-label="Método">
                            <span className="av2-evolution-method-cell">
                              <span>
                                {methodLabel(point.method)}
                                {point.formulaVersion ? ` · fórmula ${point.formulaVersion}` : ""}
                                {conversionText(point.conversion) ? ` · conversão ${conversionText(point.conversion)}` : ""}
                              </span>
                              {point.flags.map((flag) => (
                                <span key={flag} className="av2-flag av2-evolution-flag">
                                  {FLAG_LABEL[flag] ?? flag}
                                </span>
                              ))}
                            </span>
                          </td>
                          {isClassifiedCode(group.code) && (
                            <td data-label={CLASSIFIED_CODES[group.code] === "cooper_12min" ? "Classificação da distância" : "Classificação"}>
                              {point.classification ? (
                                <span className="av2-evolution-method-cell">
                                  <span>
                                    {classificationSubject(point.classification) && `${point.classification.value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m: `}
                                    <strong>{classificationLevel(point.classification)}</strong>
                                  </span>
                                  <span className="small muted">{classificationDetail(point.classification)}</span>
                                </span>
                              ) : (
                                <span className="muted">{BEFORE_TABLES}</span>
                              )}
                            </td>
                          )}
                          <td data-label="Comparação">
                            {index === 0 ? (
                              <span className="muted">Primeiro valor</span>
                            ) : point.break ? (
                              <Pill tone="warning">{BREAK_LABEL[point.break]}</Pill>
                            ) : (
                              "Mesmo método do valor anterior"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {group.legacy.length > 0 && (
              <div className="av2-evolution-series av2-evolution-legacy" role="group" aria-label={`${title}, formato anterior`}>
                <p className="av2-evolution-method">
                  <strong>Formato anterior · método desconhecido</strong>
                </p>
                <p className="small muted">
                  Digitado na avaliação do formato anterior, sem protocolo conhecido: não entra nas séries acima e não se compara com elas.
                </p>
                <ul className="av2-evolution-list">
                  {group.legacy.map((point, index) => (
                    <li key={`${point.assessmentId}-${index}`}>
                      {legacyDates[index]}: <strong>{valueText(group.code, point)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
