"use client";
import { useState } from "react";
import { Pill } from "@/components/ui";
import { MUSCLES, PATTERNS } from "@/modules/biblioteca/metadata/vocabulary";
import type { TargetSuggestion } from "@/modules/prescricao/motor/targets";
import {
  BASIS_LABELS,
  coverageFromEdit,
  editFromSuggestion,
  noSuggestionText,
  suggestionEntry,
  targetSuggestionView,
  type CoverageAnswer,
  type TargetEdit,
  type WorkoutCoverageAnswer,
} from "./view";

/** Anchor of a phase's card, so a "Ver alvos sugeridos" link can point at it. */
export const suggestionAnchor = (phaseIndex: number) => `alvos-sugeridos-fase-${phaseIndex}`;

/**
 * Suggested targets of a phase without targets (design V3 §4.6, §7.4): the one suggestion of the rule set, shown for acceptance
 * and never applied by itself. "Aceitar" sends exactly the suggestion (heurística aceita, with its rule); "Editar antes de
 * aplicar" opens toggles and numbers, and anything changed, removed or set per workout goes as the professional's own targets.
 * With no suggestion (mixed stimuli, a stimulus the rule does not cover), the card says why and still lets the professional set
 * targets. Only draws what `view.ts` returns; the caller decides what accepting does (regenerate the phase, or fill the form).
 */
export function TargetSuggestionCard({
  phaseIndex,
  suggestion,
  reason,
  labels,
  pending,
  acceptText,
  commitText,
  requireTargets = false,
  onAccept,
  onApply,
}: {
  phaseIndex: number;
  suggestion: TargetSuggestion | null;
  /** Why there is no suggestion (null when there is one). */
  reason: string | null;
  /** Workout labels of the phase, for targets per workout. */
  labels: readonly string[];
  pending: boolean;
  acceptText: string;
  /** What happens on acceptance, said before the buttons. */
  commitText: string;
  /** An empty edit is refused (on the proposal it would regenerate the phase for nothing: it has no targets to clear). */
  requireTargets?: boolean;
  onAccept: (entry: CoverageAnswer) => void;
  onApply: (coverage: CoverageAnswer | null, byWorkout: WorkoutCoverageAnswer[]) => void;
}) {
  const [edit, setEdit] = useState<TargetEdit | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const view = suggestion ? targetSuggestionView(suggestion) : null;
  const titleId = `${suggestionAnchor(phaseIndex)}-titulo`;
  const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

  function apply() {
    if (!edit) return;
    const out = coverageFromEdit(phaseIndex, edit, suggestion, { requireTargets });
    if (!out.ok) {
      setErrors(out.errors);
      return;
    }
    setErrors([]);
    onApply(out.coverage, out.byWorkout);
    setEdit(null);
  }

  return (
    <div className="target-card" id={suggestionAnchor(phaseIndex)} role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="small-heading">
        Alvos sugeridos · Fase {phaseIndex}
      </h3>
      {view ? (
        <>
          <p className="small">
            <Pill tone="warning">{BASIS_LABELS.HEURISTIC}</Pill> Sugestão para {view.stimulus}, para você aceitar ou editar. Não é
            recomendação universal.
          </p>
          <div className="target-list">
            <span className="small muted">Músculos</span>
            <ul className="chip-row" aria-label={`Músculos sugeridos da fase ${phaseIndex}`}>
              {view.muscles.map((m) => (
                <li key={m.code} className="target-tag">
                  {m.label}
                </li>
              ))}
            </ul>
            <span className="small muted">Padrões de movimento</span>
            <ul className="chip-row" aria-label={`Padrões sugeridos da fase ${phaseIndex}`}>
              {view.patterns.map((p) => (
                <li key={p.code} className="target-tag">
                  {p.label}
                </li>
              ))}
            </ul>
          </div>
          <p className="small">{view.sessions}</p>
          {view.sets && <p className="small">{view.sets}</p>}
          {labels.length > 1 && (
            <p className="small muted">Para dividir por treino (ex.: superior/inferior), use Editar e marque os músculos de cada treino.</p>
          )}
        </>
      ) : (
        <p className="small muted">{noSuggestionText(reason)}</p>
      )}
      <p className="small">{commitText}</p>
      {!edit && (
        <div className="exercise-actions">
          {suggestion && (
            <button type="button" className="button primary small" disabled={pending} onClick={() => onAccept(suggestionEntry(suggestion))}>
              {acceptText}
            </button>
          )}
          <button type="button" className="button secondary small" disabled={pending} onClick={() => setEdit(editFromSuggestion(suggestion, labels))}>
            {suggestion ? "Editar antes de aplicar" : "Definir alvos"}
          </button>
        </div>
      )}
      {edit && (
        <div className="target-editor">
          <p className="small muted">Qualquer mudança faz destes alvos uma decisão sua (não mais a sugestão da regra).</p>
          <fieldset className="auto-subsection">
            <legend>Músculos-alvo da fase</legend>
            <div className="chip-row">
              {Object.entries(MUSCLES).map(([code, label]) => (
                <button key={code} type="button" className="chip" aria-pressed={edit.muscles.includes(code)} onClick={() => setEdit({ ...edit, muscles: toggle(edit.muscles, code) })}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="auto-subsection">
            <legend>Padrões-alvo da fase</legend>
            <div className="chip-row">
              {Object.entries(PATTERNS).map(([code, label]) => (
                <button key={code} type="button" className="chip" aria-pressed={edit.patterns.includes(code)} onClick={() => setEdit({ ...edit, patterns: toggle(edit.patterns, code) })}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="field-grid">
            <label>
              Séries ponderadas por semana (mínimo)
              <input inputMode="decimal" value={edit.minWeighted} onChange={(e) => setEdit({ ...edit, minWeighted: e.target.value })} />
            </label>
            <label>
              Séries ponderadas por semana (máximo)
              <input inputMode="decimal" value={edit.maxWeighted} onChange={(e) => setEdit({ ...edit, maxWeighted: e.target.value })} />
            </label>
            <label>
              Sessões com estímulo direto por semana (mínimo)
              <input inputMode="numeric" value={edit.minDirectSessions} onChange={(e) => setEdit({ ...edit, minDirectSessions: e.target.value })} />
            </label>
          </div>
          <p className="small muted">Os números valem para cada músculo-alvo marcado; em branco, não entram.</p>
          {labels.length > 1 && (
            <details className="auto-details">
              <summary>Por treino (opcional)</summary>
              <p className="small muted">Os músculos marcados num treino viram o foco dele e vencem os alvos da fase para esse treino.</p>
              {edit.byWorkout.map((w, n) => (
                <fieldset key={w.label} className="auto-subsection">
                  <legend>Treino {w.label}</legend>
                  <div className="chip-row">
                    {Object.entries(MUSCLES).map(([code, label]) => (
                      <button
                        key={code}
                        type="button"
                        className="chip"
                        aria-pressed={w.muscles.includes(code)}
                        aria-label={`${label} no treino ${w.label}`}
                        onClick={() => setEdit({ ...edit, byWorkout: edit.byWorkout.map((x, k) => (k === n ? { ...x, muscles: toggle(x.muscles, code) } : x)) })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
            </details>
          )}
          {errors.length > 0 && (
            <div className="error-message" role="alert">
              {errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}
          <div className="exercise-actions">
            <button type="button" className="button primary small" disabled={pending} onClick={apply}>
              Aplicar estes alvos
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={pending}
              onClick={() => {
                setEdit(null);
                setErrors([]);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
