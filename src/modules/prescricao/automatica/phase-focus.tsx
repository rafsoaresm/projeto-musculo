"use client";
import Link from "next/link";
import { useId } from "react";
import { MUSCLE_LABELS, PATTERN_LABELS } from "@/modules/prescricao/motor/vocabulary";
import { MUSCLE_CODES, PATTERN_CODES, WORKOUT_ROLES } from "@/modules/prescricao/planejador/vocab";
import { OptionCard } from "./option-card";
import {
  applyToOtherPhases, draftProblems, isWorkoutRole, LIST_KEYS, LIST_TITLE, phaseCards, restoreWorkout, ROLE_TITLE, setRole, toggleItem, workoutCards,
  type AcceptanceDraft, type ListKey,
} from "./flow-view";
import type { GenerationScreen } from "./service";

const CODES: Record<ListKey, readonly string[]> = { dominantMuscles: MUSCLE_CODES, supportingMuscles: MUSCLE_CODES, targetPatterns: PATTERN_CODES, allowedSpilloverPatterns: PATTERN_CODES };
const NAMES: Record<ListKey, Record<string, string>> = { dominantMuscles: MUSCLE_LABELS, supportingMuscles: MUSCLE_LABELS, targetPatterns: PATTERN_LABELS, allowedSpilloverPatterns: PATTERN_LABELS };

/**
 * "Blueprint da divisão" and "Focos do Treino A / B" (Figma GEN-03): one card per phase on the left, one card per workout of the selected
 * phase on the right, each with who decided its focus. "Editar foco" opens the editor (inline on the desktop, a full-screen sheet on the
 * phone, Esc closes it). A workout whose focus the saved periodization holds is READ-ONLY, with the link to change the periodization: that
 * focus wins at generation and an edit here would be dropped silently. Editing marks the workout "Decisão do profissional".
 */
export function PhaseFocus({
  draft, onChange, structure, phase, onPhase, editing, onEdit, producerLabel, periodizationHref, aiMode,
}: {
  draft: AcceptanceDraft;
  onChange: (next: AcceptanceDraft) => void;
  structure: GenerationScreen["structure"];
  phase: number;
  onPhase: (phaseIndex: number) => void;
  editing: string | null;
  onEdit: (label: string | null) => void;
  producerLabel: string;
  periodizationHref: string;
  aiMode: boolean;
}) {
  const id = useId();
  const phases = phaseCards(draft, structure, producerLabel);
  const current = phases.find((p) => p.phaseIndex === phase) ?? phases[0];
  const cards = current ? workoutCards(draft, current.phaseIndex) : [];
  const problems = draftProblems(draft);
  const labels = cards.map((c) => c.label);
  return (
    <div className="fig-gen-cols">
      <section className="fig-gen-card fig-gen-phases-card" aria-labelledby={`${id}-left`}>
        <h2 id={`${id}-left`} className="fig-gen-card-title">
          Blueprint da divisão
        </h2>
        <p className="fig-gen-sub">Cada fase possui divisão e focos editáveis.</p>
        <div role="radiogroup" aria-label="Fases" className="fig-gen-opts">
          {phases.map((p) => (
            <OptionCard key={p.phaseIndex} name="fig-gen-phase" value={String(p.phaseIndex)} checked={current?.phaseIndex === p.phaseIndex} onChange={() => onPhase(p.phaseIndex)} title={p.title} line={p.line} meta={p.meta} />
          ))}
        </div>
        <div className="fig-gen-info">
          <h3>Regras de composição</h3>
          <p>Conservar exercícios travados e decisões manuais.</p>
          <p className="fig-gen-info-meta">Qualquer alteração estrutural precisa de aceite</p>
        </div>
      </section>
      <aside className="fig-gen-card fig-gen-focus-side" aria-labelledby={`${id}-right`}>
        <h2 id={`${id}-right`} className="fig-gen-card-title">
          Focos do Treino {labels.join(" / ")}
        </h2>
        <p className="fig-gen-sub">Visualização do efeito da divisão.</p>
        {cards.map((c) => {
          const w = draft.workouts.find((x) => x.phaseIndex === c.phaseIndex && x.label === c.label)!;
          const open = editing === c.label && !c.locked;
          return (
            <div key={c.label} className="fig-gen-info fig-gen-wcard" data-highlight="true" role="group" aria-label={c.title}>
              <h3>{c.title}</h3>
              <p>{c.line}</p>
              <p className="fig-gen-info-meta">{c.meta}</p>
              <p>
                <span className={`fig-gen-tag ${c.pill.tone}`}>{c.pill.text}</span>
                {c.edited.length > 0 && <span className="fig-gen-hint"> · alterado: {c.edited.join(", ")}</span>}
              </p>
              {c.locked ? (
                <Link href={periodizationHref} className="fig-gen-link">
                  Alterar periodização
                </Link>
              ) : (
                <button type="button" className="fig-gen-btn small" aria-expanded={open} aria-label={`Editar foco do treino ${c.label}`} onClick={() => onEdit(open ? null : c.label)}>
                  {open ? "Fechar edição" : "Editar foco"}
                </button>
              )}
              {open && (
                <div className="fig-gen-editor-sheet" role="group" aria-label={`Editar foco do treino ${c.label}`}>
                  <div className="fig-gen-sheet-head fig-gen-m">
                    <button type="button" className="fig-gen-backlink" onClick={() => onEdit(null)}>
                      ‹ Voltar aos focos
                    </button>
                    <h3>Editar foco do treino {c.label}</h3>
                  </div>
                  <div className="fig-gen-field">
                    <label htmlFor={`${id}-role-${c.label}`} className="fig-gen-field-label">
                      Papel do treino
                    </label>
                    <div className="fig-gen-select">
                      <select id={`${id}-role-${c.label}`} value={w.role} onChange={(e) => isWorkoutRole(e.target.value) && onChange(setRole(draft, c.phaseIndex, c.label, e.target.value))}>
                        {WORKOUT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_TITLE[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {LIST_KEYS.map((list) => (
                    <fieldset key={list} className="fig-gen-fieldset">
                      <legend>{LIST_TITLE[list]}</legend>
                      <div className="fig-gen-checks">
                        {CODES[list].map((code) => (
                          <label key={code} className="fig-gen-check">
                            <input type="checkbox" checked={w[`focus`][list].includes(code)} onChange={(e) => onChange(toggleItem(draft, c.phaseIndex, c.label, list, code, e.target.checked))} />
                            <span>{NAMES[list][code] ?? code}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <div className="fig-gen-editor-actions">
                    <button type="button" className="fig-gen-btn small" onClick={() => onChange(restoreWorkout(draft, c.phaseIndex, c.label))}>
                      Restaurar sugestão
                    </button>
                    {phases.length > 1 && (
                      <button type="button" className="fig-gen-btn small" onClick={() => onChange(applyToOtherPhases(draft, c.phaseIndex, c.label))}>
                        Aplicar às outras fases
                      </button>
                    )}
                    <button type="button" className="fig-gen-btn small primary fig-gen-m" onClick={() => onEdit(null)}>
                      Concluir
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {problems.length > 0 && (
          <div className="fig-gen-errors" role="alert">
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        )}
        <p className="fig-gen-hint">{aiMode ? "A IA sugere; o foco final é sua decisão." : "Padrão por regras: heurística operacional, editável."}</p>
      </aside>
    </div>
  );
}
