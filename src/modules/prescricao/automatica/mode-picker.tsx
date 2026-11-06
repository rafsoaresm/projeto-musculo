"use client";
import { useId } from "react";
import { OptionCard } from "./option-card";
import type { Mode, ModePanel } from "./flow-view";

/**
 * "Modo de montagem" (Figma GEN-01): Assistida por IA or Por regras. The AI card is available only when the whole gate is open (the server
 * says so; this component draws it); otherwise it stays readable with the honest reason and the rules card is the selection. Never a
 * provider, model, key or cost here: only the tokens line when the plan has an allowance.
 */
export function ModePicker({ panel, mode, onChange }: { panel: ModePanel; mode: Mode; onChange: (mode: Mode) => void }) {
  const id = useId();
  return (
    <section className="fig-gen-card fig-gen-mode" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="fig-gen-card-title">
        Modo de montagem
      </h2>
      <p className="fig-gen-sub" id={`${id}-sub`}>
        O motor continua disponível sem IA.
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-title`} aria-describedby={`${id}-sub`} className="fig-gen-opts">
        {panel.options.map((o) => (
          <OptionCard
            key={o.id}
            name="fig-gen-mode"
            value={o.id}
            checked={mode === o.id}
            disabled={o.disabled}
            onChange={(v) => onChange(v as Mode)}
            title={o.title}
            line={o.description}
            meta={o.meta}
            reason={o.reason}
            reasonId={`${id}-${o.id}-reason`}
          />
        ))}
      </div>
      {panel.usageLine && <p className="fig-gen-hint">{panel.usageLine}</p>}
      {!panel.options[0].disabled && <p className="fig-gen-hint">{panel.notice}</p>}
    </section>
  );
}
