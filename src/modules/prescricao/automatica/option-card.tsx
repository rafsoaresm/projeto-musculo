"use client";
import type { ReactNode } from "react";
import type { Pill } from "./flow-view";

/**
 * A choice drawn as a card (Figma GEN-01 "Modo de montagem", GEN-02 "Estratégias sugeridas", M-01): a `<label>` around a native radio, so the
 * arrow keys, the focus ring and the screen reader's group count come from the browser. Title (14), line (12 muted) and meta (11) as in the
 * frames; the selected card is the brand-subtle one with the 1.5 px brand border. A card that cannot be chosen stays readable and says why.
 */
export function OptionCard({
  name, value, checked, disabled = false, onChange, title, line, meta, pills = [], reason, reasonId, children,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  title: string;
  line: string;
  meta: string;
  pills?: Pill[];
  reason?: string | null;
  reasonId?: string;
  children?: ReactNode;
}) {
  const describedBy = reason && reasonId ? reasonId : undefined;
  return (
    <div className="fig-gen-opt-wrap">
      <label className="fig-gen-opt" data-selected={checked ? "true" : undefined} data-disabled={disabled ? "true" : undefined} aria-disabled={disabled ? "true" : undefined}>
        <input type="radio" name={name} value={value} checked={checked} disabled={disabled} aria-describedby={describedBy} onChange={() => onChange(value)} />
        <span className="fig-gen-opt-title">{title}</span>
        <span className="fig-gen-opt-line">{line}</span>
        <span className="fig-gen-opt-meta">{meta}</span>
        {pills.length > 0 && (
          <span className="fig-gen-opt-pills">
            {pills.map((p) => (
              <span key={p.text} className={`fig-gen-tag ${p.tone}`}>
                {p.text}
              </span>
            ))}
          </span>
        )}
      </label>
      {reason && (
        <p id={reasonId} className="fig-gen-opt-reason warn">
          {reason}
        </p>
      )}
      {children}
    </div>
  );
}
