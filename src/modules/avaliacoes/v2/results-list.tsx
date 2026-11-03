import { FLAG_LABEL, RESULT_LABEL, formatResult, isEstimate, methodLabel, resultNote } from "./review";

export interface ResultItem {
  code: string;
  value: number | null;
  unit: string | null;
  method: string;
  formulaVersion: string | null;
  flags: string[];
}

/**
 * The results of an assessment, each with its value, its method and the version of the formula, and the flags of the method (e.g. outside the
 * original validation population). An estimate is said to be one; there is no classification (none is homologated). Used by the "Revisão" step
 * (what will be recorded) and by the recorded assessment (what was).
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
            {isEstimate(result.method) ? " · estimativa" : ""}
          </span>
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
