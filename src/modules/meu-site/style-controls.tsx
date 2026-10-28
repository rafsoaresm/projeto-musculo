"use client";
import { useId, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { themeAttributes, type Theme } from "./site-theme";
import { COLOR_TOKENS, COLOR_TOKEN_LABEL, UNITS, isHexColor, lengthFits, parseLength, type Color, type LengthSpec, type Unit } from "./style";

/**
 * The controls of the style panel. Each one offers only what the contract accepts (a length in the units and the range of
 * its property, a value from a list, a color of the theme or `#rrggbb`), says nothing when it is cleared (the property
 * leaves the document) and keeps what is being typed apart from the document until it is a valid value.
 */

function Reset({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="ve-reset" aria-label={`${label}: voltar ao padrão`} title="Voltar ao padrão" onClick={onClick}>
      <RotateCcw size={14} aria-hidden="true" />
    </button>
  );
}

const UNIT_LABEL: Record<Unit | "auto", string> = { px: "px", "%": "%", rem: "rem", vw: "vw", vh: "vh", auto: "auto" };

/** A length: a number and a unit, in the range of the property. Cleared with the button, or by emptying the number. */
export function LengthField({ label, name = label, value, inherited, spec, onChange }: { label: string; /** What assistive technology says (the visible label may be short because a group names it). */ name?: string; value: string | undefined; /** The value comes from a larger size of the screen: it is shown, and there is nothing of this size to take back. */ inherited?: boolean; spec: LengthSpec; onChange: (value: string | undefined) => void }) {
  const id = useId();
  const units = UNITS.filter((unit) => spec[unit] !== undefined);
  const parsed = value && value !== "auto" ? parseLength(value) : null;
  // The unit chosen while there is no number yet, and what has been typed that is not (yet) a valid length.
  const [pending, setPending] = useState<Unit>(units[0]);
  const [draft, setDraft] = useState<string | null>(null);
  const unit: Unit | "auto" = value === "auto" ? "auto" : parsed?.unit ?? pending;
  const range = unit === "auto" ? undefined : spec[unit];
  const shown = draft ?? (parsed ? String(parsed.amount) : "");

  const typed = (text: string) => {
    if (text === "") {
      setDraft(null);
      onChange(undefined);
      return;
    }
    const candidate = `${text}${unit === "auto" ? units[0] : unit}`;
    if (lengthFits(candidate, spec)) {
      setDraft(null);
      onChange(candidate);
    } else {
      setDraft(text);
    }
  };
  const chose = (next: Unit | "auto") => {
    setDraft(null);
    if (next === "auto") {
      onChange("auto");
      return;
    }
    setPending(next);
    const limits = spec[next]!;
    if (parsed) onChange(`${Math.min(Math.max(parsed.amount, limits[0]), limits[1])}${next}`);
    else if (value === "auto") onChange(undefined);
  };
  return (
    <div className="ve-length" data-invalid={draft !== null || undefined} data-inherited={inherited || undefined}>
      <div className="ve-length-head">
        <label htmlFor={id}>{label}</label>
        {value !== undefined && !inherited && (
          <Reset
            label={name}
            onClick={() => {
              setDraft(null);
              onChange(undefined);
            }}
          />
        )}
      </div>
      <div className="ve-length-inputs">
        <input
          id={id}
          aria-label={name}
          type="number"
          inputMode="decimal"
          step={unit === "rem" ? 0.1 : 1}
          min={range?.[0]}
          max={range?.[1]}
          value={shown}
          disabled={unit === "auto"}
          placeholder={unit === "auto" ? "auto" : "—"}
          title={range ? `De ${range[0]} a ${range[1]} ${unit}` : undefined}
          aria-invalid={draft !== null || undefined}
          onChange={(event) => typed(event.target.value)}
          onBlur={() => setDraft(null)}
        />
        <select aria-label={`${name}: unidade`} value={unit} onChange={(event) => chose(event.target.value as Unit | "auto")}>
          {units.map((option) => (
            <option key={option} value={option}>
              {UNIT_LABEL[option]}
            </option>
          ))}
          {spec.auto && <option value="auto">auto</option>}
        </select>
      </div>
    </div>
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** One of a short list, as buttons. Pressing the one that is chosen takes the choice back. */
export function ChoiceField<T extends string | number>({ label, value, inherited, options, onChange }: { label: string; value: T | undefined; inherited?: boolean; options: readonly Option<T>[]; onChange: (value: T | undefined) => void }) {
  return (
    <div className="ve-choice-field" role="group" aria-label={label} data-inherited={inherited || undefined}>
      <span className="ve-field-label" aria-hidden="true">
        {label}
      </span>
      <div className="ve-choices">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            title={option.label}
            aria-label={`${label}: ${option.label}`}
            onClick={() => {
              // Pressing the choice that is on takes it back, unless it is not this size's: then there is nothing to take back.
              if (value !== option.value) onChange(option.value);
              else if (!inherited) onChange(undefined);
            }}
          >
            {option.icon ?? option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One of a long list, as a menu; the empty choice is "no value" (the page's own). */
export function SelectField<T extends string | number>({ label, value, inherited, options, onChange, empty = "Padrão" }: { label: string; value: T | undefined; inherited?: boolean; options: readonly Option<T>[]; onChange: (value: T | undefined) => void; empty?: string }) {
  return (
    <label className="ve-select-field" data-inherited={inherited || undefined}>
      {label}
      <select
        value={value === undefined ? "" : String(value)}
        onChange={(event) => {
          const chosen = options.find((option) => String(option.value) === event.target.value);
          onChange(chosen?.value);
        }}
      >
        <option value="">{empty}</option>
        {options.map((option) => (
          <option key={option.value} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A number in a range that `valid` decides (whole, in steps...). Emptying it takes the value back. */
export function NumberField({ label, value, inherited, valid, min, max, step = 1, onChange }: { label: string; value: number | undefined; inherited?: boolean; valid: (value: number) => boolean; min: number; max: number; step?: number; onChange: (value: number | undefined) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="ve-length" data-invalid={draft !== null || undefined} data-inherited={inherited || undefined}>
      <div className="ve-length-head">
        <label htmlFor={id}>{label}</label>
        {value !== undefined && !inherited && (
          <Reset
            label={label}
            onClick={() => {
              setDraft(null);
              onChange(undefined);
            }}
          />
        )}
      </div>
      <div className="ve-length-inputs">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={draft ?? (value === undefined ? "" : String(value))}
          placeholder="—"
          title={`De ${min} a ${max}`}
          aria-invalid={draft !== null || undefined}
          onChange={(event) => {
            const text = event.target.value;
            if (text === "") {
              setDraft(null);
              onChange(undefined);
              return;
            }
            const number = Number(text);
            if (Number.isFinite(number) && valid(number)) {
              setDraft(null);
              onChange(number);
            } else {
              setDraft(text);
            }
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
    </div>
  );
}

/**
 * A color: the theme's own names (drawn with the page's colors, so they follow light and dark), or `#rrggbb` from the
 * browser's picker or typed as `#rrggbb` or `#rrggbbaa`. Nothing else is accepted.
 */
export function ColorField({ label, value, inherited, theme, onChange }: { label: string; value: Color | undefined; inherited?: boolean; theme: Theme; onChange: (value: Color | undefined) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const custom = value !== undefined && isHexColor(value) ? value : undefined;
  return (
    <div className="ve-color-field" role="group" aria-label={label} data-inherited={inherited || undefined}>
      <span className="ve-field-label" aria-hidden="true">
        {label}
      </span>
      <div className="ve-colors" {...themeAttributes(theme)}>
        {COLOR_TOKENS.map((token) => (
          <button
            key={token}
            type="button"
            className="ve-color"
            data-token={token}
            aria-pressed={value === token}
            title={COLOR_TOKEN_LABEL[token]}
            aria-label={`${label}: ${COLOR_TOKEN_LABEL[token]}`}
            onClick={() => {
              if (value !== token) onChange(token);
              else if (!inherited) onChange(undefined);
            }}
          />
        ))}
      </div>
      <div className="ve-color-custom">
        <input
          type="color"
          aria-label={`${label}: escolher uma cor`}
          value={custom && custom.length === 7 ? custom.toLowerCase() : "#000000"}
          onChange={(event) => onChange(event.target.value as Color)}
        />
        <input
          type="text"
          aria-label={`${label}: código da cor (#rrggbb)`}
          placeholder="#rrggbb"
          maxLength={9}
          spellCheck={false}
          value={draft ?? custom ?? ""}
          aria-invalid={draft !== null || undefined}
          onChange={(event) => {
            const text = event.target.value.trim();
            if (text === "") {
              setDraft(null);
              onChange(undefined);
            } else if (isHexColor(text)) {
              setDraft(null);
              onChange(text.toLowerCase() as Color);
            } else {
              setDraft(text);
            }
          }}
          onBlur={() => setDraft(null)}
        />
        {value !== undefined && !inherited && (
          <Reset
            label={label}
            onClick={() => {
              setDraft(null);
              onChange(undefined);
            }}
          />
        )}
      </div>
    </div>
  );
}

/** A group of the panel that opens and closes. */
export function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="ve-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="ve-section-body">{children}</div>
    </details>
  );
}
