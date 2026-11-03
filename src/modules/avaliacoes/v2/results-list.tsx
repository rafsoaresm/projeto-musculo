import { BEFORE_TABLES, classificationDetail, classificationLevel, isClassifiedCode, type Classification } from "../classifications";
import { FLAG_LABEL, RESULT_LABEL, formatResult, isResultEstimate, methodLabel, resultNote } from "./review";

export interface ResultItem {
  code: string;
  value: number | null;
  unit: string | null;
  method: string;
  formulaVersion: string | null;
  flags: string[];
  /** Slice 0.92: the classification by a reference table; absent or null for a result no table classifies, or one recorded before the tables. */
  classification?: Classification | null;
}

/** The classification line of a result: the level (or what the table does not say) and the table, column, source and precision. */
export function ResultClassification({ result }: { result: Pick<ResultItem, "code" | "classification"> }) {
  if (!isClassifiedCode(result.code)) return null;
  const classification = result.classification ?? null;
  return (
    <span className="av2-result-class">
      <span>
        Classificação: <strong>{classification ? classificationLevel(classification) : BEFORE_TABLES}</strong>
      </span>
      {classification && <span className="small muted">{classificationDetail(classification)}</span>}
    </span>
  );
}

/**
 * The results of an assessment, each with its value, its method and the version of the formula, and the flags of the method (e.g. outside the
 * original validation population). An estimate is said to be one. Slice 0.92: the body fat, BMI, waist-hip ratio, Flexiteste total and Cooper
 * distance carry their classification by the reference table, with the table, the column, the source and the precision of the comparison; one
 * recorded before the tables says so. Used by the "Revisão" step (what will be recorded) and by the recorded assessment (what was).
 */
export function ResultsList({ results, labelledBy }: { results: ResultItem[]; labelledBy?: string }) {
  return (
    <ul className="av2-result-rows" aria-labelledby={labelledBy}>
      {results.map((result) => (
        <li key={result.code} className="av2-result-row">
          <span className="av2-result-name">{RESULT_LABEL[result.code] ?? result.code}</span>
          <strong className="av2-result-value">{result.value === null ? "Sem valor" : formatResult(result.code, result.value, result.unit)}</strong>
          <span className="av2-result-method small muted">
            {resultNote(result.code, result.value) ? `${resultNote(result.code, result.value)} · ` : ""}
            {methodLabel(result.method)}
            {result.formulaVersion ? ` · fórmula ${result.formulaVersion}` : ""}
            {isResultEstimate(result.code, result.method) ? " · estimativa" : ""}
          </span>
          <ResultClassification result={result} />
          {result.flags.length > 0 && (
            <span className="av2-result-flags">
              {result.flags.map((flag) => (
                <span key={flag} className="av2-flag">
                  {FLAG_LABEL[flag] ?? flag}
                </span>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
