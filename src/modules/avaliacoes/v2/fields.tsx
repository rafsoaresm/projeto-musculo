"use client";
import { useId } from "react";

/**
 * The fields of a step sit in `.av2-grid`, a grid whose rows are shared by every field of a line (CSS subgrid): the labels of a line take the
 * same height, the controls start on the same line, and a note under a control never moves its neighbours. Each field is three rows: label,
 * control, note (empty when there is none).
 */

/** A number field with its unit drawn inside, as in the Figma frames; the unit is also in the field's name for screen readers. */
export function UnitInput({ label, unit, value, onChange, placeholder }: { label: string; unit: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const id = useId();
  // The unit is drawn inside the field and stays out of the visible label, so the field's name is exactly "Peso (kg)".
  return (
    <span className="av2-unit">
      <label htmlFor={id} className="sr-only">
        {label} ({unit})
      </label>
      <input id={id} inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      <span aria-hidden="true">{unit}</span>
    </span>
  );
}

export function UnitField({ label, unit, value, onChange, placeholder }: { label: string; unit: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <div className="av2-field">
      <label htmlFor={id} className="av2-label">
        {label}
        <span className="sr-only"> ({unit})</span>
      </label>
      {/* A long unit ("por semana") keeps more room at the end of the field, so the typed value never runs under it. */}
      <span className="av2-unit" data-long={unit.length > 5 || undefined}>
        <input id={id} inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        <span aria-hidden="true">{unit}</span>
      </span>
    </div>
  );
}

/** A value the step shows but does not take (age, conversion): it wraps instead of being cut, and is read with its label. */
export function ReadOnlyField({ label, value, note }: { label: string; value: string; note?: string }) {
  const id = useId();
  return (
    <div className="av2-field">
      <span id={id} className="av2-label">
        {label}
      </span>
      <output className="av2-readonly" aria-labelledby={id} aria-describedby={note ? `${id}-nota` : undefined} aria-live="off">
        {value}
      </output>
      {note && (
        <span id={`${id}-nota`} className="av2-note">
          {note}
        </span>
      )}
    </div>
  );
}

/** A field of free text on one line (activities, time of practice), in the grid like the number fields. */
export function TextField({ label, value, onChange, note }: { label: string; value: string; onChange: (value: string) => void; note?: string }) {
  const id = useId();
  return (
    <div className="av2-field">
      <label htmlFor={id} className="av2-label">
        {label}
      </label>
      <input id={id} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={note ? `${id}-nota` : undefined} />
      {note && (
        <span id={`${id}-nota`} className="av2-note">
          {note}
        </span>
      )}
    </div>
  );
}

/**
 * A longer text that takes the whole line of the grid (notes, descriptions). `context` completes the name for screen readers. `required`: needed to
 * finalize (not to save the draft), so it is said to screen readers (aria-required) without the browser's own check on a form.
 */
export function TextAreaField({
  label,
  context,
  value,
  onChange,
  note,
  rows = 2,
  required,
}: {
  label: string;
  context?: string;
  value: string;
  onChange: (value: string) => void;
  note?: string;
  rows?: number;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="av2-field av2-field-wide">
      <label htmlFor={id} className="av2-label">
        {label}
        {context && <span className="sr-only"> {context}</span>}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={note ? `${id}-nota` : undefined}
        aria-required={required || undefined}
      />
      {note && (
        <span id={`${id}-nota`} className="av2-note">
          {note}
        </span>
      )}
    </div>
  );
}

/** A yes/no question in the grid (practises?), with "Selecione" for no answer yet: not answered is never a "Não". */
export function YesNoField({ label, value, onChange }: { label: string; value: "yes" | "no" | null; onChange: (value: "yes" | "no" | null) => void }) {
  const id = useId();
  return (
    <div className="av2-field">
      <label htmlFor={id} className="av2-label">
        {label}
      </label>
      <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : (event.target.value as "yes" | "no"))}>
        <option value="">Selecione</option>
        <option value="yes">Sim</option>
        <option value="no">Não</option>
      </select>
    </div>
  );
}

function PlainInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const id = useId();
  return (
    <span>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input id={id} inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </span>
  );
}

/**
 * A measure taken on each side (handoff 3.2: "cada lado em campo separado"): one label for the pair ("Braço D / E"), two inputs side by side
 * named by their side for screen readers, and a note under them (the bilateral difference) in the note row of the grid.
 */
export function SidedField({
  label,
  rightLabel,
  leftLabel,
  unit,
  value,
  onChange,
  note,
}: {
  label: string;
  rightLabel: string;
  leftLabel: string;
  unit: string;
  value: { right: string; left: string };
  onChange: (value: { right: string; left: string }) => void;
  note?: string | null;
}) {
  const id = useId();
  return (
    <div className="av2-field" role="group" aria-labelledby={id} aria-describedby={note ? `${id}-nota` : undefined}>
      <span id={id} className="av2-label">
        {label} <span className="av2-label-hint">D / E · {unit}</span>
      </span>
      {/* Two inputs share one column: the unit sits in the pair's label and in each input's name, not drawn inside, so the typed value has room. */}
      <span className="av2-pair-fields av2-pair-plain">
        <PlainInput label={`${rightLabel} (${unit})`} value={value.right} placeholder="D" onChange={(right) => onChange({ ...value, right })} />
        <span aria-hidden="true" className="av2-slash">/</span>
        <PlainInput label={`${leftLabel} (${unit})`} value={value.left} placeholder="E" onChange={(left) => onChange({ ...value, left })} />
      </span>
      {note && (
        <span id={`${id}-nota`} className="av2-note">
          {note}
        </span>
      )}
    </div>
  );
}
