"use client";
import { useId, type ReactNode } from "react";
import { PROFILE_TEXT } from "./flow-copy";
import type { DosingChoice, InfoCard, WeekTypeCard } from "./flow-view";

/**
 * "Semana-tipo" and "Antes de gerar" (Figma GEN-04): the first week of the selected phase as the blueprint places it (day, workout, role,
 * patterns, "Foco principal"), the data the generation will read, what to review and the mandatory validation. Below, the disclosure
 * "Políticas e progressão (opcional)": the planner's dose and progression suggestions as UNCHECKED boxes (only what is ticked reaches the
 * acceptance) and, as children, the existing dose policy and weekly progression sections. Nothing here changes the saved plan.
 */
export function BlueprintPreview({
  title, subtitle, phases, phase, onPhase, cards, before, suggestions, dosing, onDosing, children, strategyLabel, open, onOpen,
}: {
  title: string;
  subtitle: string;
  phases: number[];
  phase: number;
  onPhase: (phaseIndex: number) => void;
  cards: WeekTypeCard[];
  before: InfoCard[];
  suggestions: DosingChoice;
  dosing: DosingChoice;
  onDosing: (next: DosingChoice) => void;
  children: ReactNode;
  strategyLabel: string;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const id = useId();
  const hasSuggestions = suggestions.byClass.length > 0 || suggestions.progression.length > 0;
  return (
    <div className="fig-gen-preview">
      <div className="fig-gen-cols">
        <section className="fig-gen-card fig-gen-week" aria-labelledby={`${id}-title`}>
          <h2 id={`${id}-title`} className="fig-gen-card-title">
            {title}
          </h2>
          <p className="fig-gen-sub">{subtitle}</p>
          {phases.length > 1 && (
            <div role="radiogroup" aria-label="Fase da semana-tipo" className="fig-gen-pills-row">
              {phases.map((p) => (
                <label key={p} className="fig-gen-phase-chip" data-selected={p === phase ? "true" : undefined}>
                  <input type="radio" name="fig-gen-preview-phase" className="fig-gen-sr" checked={p === phase} onChange={() => onPhase(p)} />
                  <span>Fase {p}</span>
                </label>
              ))}
            </div>
          )}
          <ol className="fig-gen-week-list" aria-label={`Semana-tipo, fase ${phase}`}>
            {cards.map((c, n) => (
              <li key={n} className="fig-gen-info" data-highlight={c.highlight ? "true" : undefined}>
                <h3>{c.title}</h3>
                <p>{c.line}</p>
                <p className="fig-gen-info-meta">{c.meta}</p>
              </li>
            ))}
          </ol>
          <p className="fig-gen-hint">{strategyLabel}</p>
        </section>
        <aside className="fig-gen-card fig-gen-before" aria-labelledby={`${id}-before`}>
          <h2 id={`${id}-before`} className="fig-gen-card-title">
            Antes de gerar
          </h2>
          <p className="fig-gen-sub">O blueprint não modifica sozinho o plano salvo.</p>
          {before.map((c) => (
            <div key={c.title} className="fig-gen-info" data-highlight={c.highlight ? "true" : undefined}>
              <h3>{c.title}</h3>
              <p>{c.line}</p>
              <p className="fig-gen-info-meta">{c.meta}</p>
            </div>
          ))}
        </aside>
      </div>
      <details className="fig-gen-card fig-gen-adv-card" open={open} onToggle={(e) => onOpen(e.currentTarget.open)}>
        <summary>Políticas e progressão (opcional)</summary>
        {hasSuggestions && (
          <fieldset className="fig-gen-fieldset">
            <legend>Sugestões do planejamento (nada marcado por padrão)</legend>
            <div className="fig-gen-checks">
              {suggestions.progression.map((p) => {
                const on = dosing.progression.some((d) => d.phaseIndex === p.phaseIndex && d.intent === p.intent);
                return (
                  <label key={`p-${p.phaseIndex}`} className="fig-gen-check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => onDosing({ ...dosing, progression: e.target.checked ? [...dosing.progression, p] : dosing.progression.filter((d) => !(d.phaseIndex === p.phaseIndex && d.intent === p.intent)) })}
                    />
                    <span>
                      Usar sugestão: progressão {PROFILE_TEXT.intent(p.intent)} na fase {p.phaseIndex}
                    </span>
                  </label>
                );
              })}
              {suggestions.byClass.map((d) => {
                const on = dosing.byClass.some((x) => x.exerciseClass === d.exerciseClass && x.profileCode === d.profileCode);
                return (
                  <label key={`c-${d.exerciseClass}`} className="fig-gen-check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => onDosing({ ...dosing, byClass: e.target.checked ? [...dosing.byClass, d] : dosing.byClass.filter((x) => !(x.exerciseClass === d.exerciseClass && x.profileCode === d.profileCode)) })}
                    />
                    <span>
                      Usar sugestão: {PROFILE_TEXT.exerciseClass(d.exerciseClass)} com perfil {PROFILE_TEXT.profile(d.profileCode)}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="fig-gen-hint">Só o que você marcar entra no aceite; a sugestão da IA não altera a dose sozinha.</p>
          </fieldset>
        )}
        {children}
      </details>
    </div>
  );
}
