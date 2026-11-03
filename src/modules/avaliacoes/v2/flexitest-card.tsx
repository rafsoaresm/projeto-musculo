"use client";
import { useId } from "react";
import { FLEXITEST_MOVEMENTS, flexitest, type FlexitestMovement } from "../formulas";
import { TextAreaField, TextField } from "./fields";
import { FLEXITEST_CLASSIFICATION_NOTE, FLEXITEST_LEVELS, filledText, totalText, type MovementForm } from "./flexitest";

/** The blank answer of a movement: no level (not assessed), drawn as an empty outline like "Não observado" and the PAR-Q's blank. */
const NOT_ASSESSED = "Não avaliado";

function Movement({ code, label, level, onChange }: { code: FlexitestMovement; label: string; level: number | undefined; onChange: (level: 1 | 2 | 3 | 4 | undefined) => void }) {
  const id = useId();
  const name = `av2-flexiteste-${code}`;
  return (
    <li className="av2-question-item">
      <fieldset className="av2-question av2-level-question" role="radiogroup" aria-labelledby={id} data-observed={level !== undefined || undefined}>
        <legend id={id} className="av2-question-text">
          {label}
        </legend>
        <div className="av2-answers av2-levels">
          {FLEXITEST_LEVELS.map((value) => (
            <label key={value} className="av2-chip">
              <input type="radio" name={name} checked={level === value} onChange={() => onChange(value)} />
              <span>
                <span className="sr-only">Nível </span>
                {value}
              </span>
            </label>
          ))}
          <label className="av2-chip" data-tone="blank">
            <input type="radio" name={name} checked={level === undefined} onChange={() => onChange(undefined)} />
            <span>{NOT_ASSESSED}</span>
          </label>
        </div>
      </fieldset>
    </li>
  );
}

/**
 * The Flexiteste of the "Movimento" step (handoff 3.4, Figma AV-05): the 15 movements of the PDF, each with a quick choice of level 1 to 4 (touch
 * targets of 44px) or "Não avaliado"; how many are filled and the total, which exists only with all 15 (never a partial sum); the professional's
 * own classification and notes. Nothing is classified by the system: the PDF gives no table.
 */
export function FlexitestCard({ form, onChange }: { form: MovementForm; onChange: (form: MovementForm) => void }) {
  const tally = flexitest(form.levels);
  const set = (patch: Partial<MovementForm>) => onChange({ ...form, ...patch });
  return (
    <section className="panel av2-card" aria-labelledby="av2-flexiteste">
      <h3 id="av2-flexiteste">Flexiteste · 15 movimentos</h3>
      <p className="muted small">
        Nível inteiro de 1 a 4 em cada movimento (versão do PDF). Um movimento sem nível fica como não avaliado, nunca 0; o total só aparece com os 15.
      </p>
      <ul className="av2-questions" aria-label="Movimentos do Flexiteste">
        {FLEXITEST_MOVEMENTS.map((movement) => (
          <Movement
            key={movement.code}
            code={movement.code}
            label={movement.label}
            level={form.levels[movement.code]}
            onChange={(level) => {
              const levels = { ...form.levels };
              if (level === undefined) delete levels[movement.code];
              else levels[movement.code] = level;
              set({ levels });
            }}
          />
        ))}
      </ul>
      <dl className="av2-results av2-flex-tally" aria-label="Resumo do Flexiteste">
        <div className="av2-result">
          <dt>Preenchidos</dt>
          <dd>{filledText(tally.filled)}</dd>
        </div>
        <div className="av2-result">
          <dt>Total</dt>
          <dd>{totalText(tally.total)}</dd>
        </div>
      </dl>
      <div className="av2-grid av2-flex-notes">
        <TextField
          wide
          label="Classificação (manual)"
          value={form.classificationManual}
          onChange={(classificationManual) => set({ classificationManual })}
          note={FLEXITEST_CLASSIFICATION_NOTE}
        />
        <TextAreaField label="Observações do Flexiteste" value={form.notes} onChange={(notes) => set({ notes })} />
      </div>
    </section>
  );
}
