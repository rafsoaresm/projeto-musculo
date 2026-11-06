"use client";
import { useId, useState } from "react";
import { Pill } from "@/components/ui";
import type { Assumption } from "@/modules/prescricao/motor/types";
import { baseCells } from "./generation-view";
import type { ConsideredFact, GenerationSummary } from "./service";
import { BASIS_LABELS, BASIS_TONES } from "./view";

/**
 * "BASE UTILIZADA" (Figma GEN-01, 75:875): the five numbers the generation reads, in one compact strip. Every value comes from the
 * screen's summary (nothing typed here); what is unknown shows as unknown, in the warning colour.
 */
export function BaseStrip({ summary }: { summary: GenerationSummary }) {
  return (
    <section className="fig-gen-base" aria-label="Base utilizada">
      <p className="fig-gen-base-title">BASE UTILIZADA</p>
      <dl className="fig-gen-base-cells">
        {baseCells(summary).map((cell) => (
          <div key={cell.label}>
            <dt className="fig-gen-base-label">{cell.label}</dt>
            <dd className={cell.tone === "warning" ? "fig-gen-base-value warn" : "fig-gen-base-value"}>{cell.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * "Ver dados de origem" (the disclosure of the old "Dados do aluno" card, kept under the four context cards of GEN-01): every fact with where
 * it comes from, the free text of the records shown as it is (never interpreted) and the assumptions the tool will make. Reads nothing itself.
 */
export function StudentOrigin({
  considered,
  freeText,
  assumptions,
}: {
  considered: ConsideredFact[];
  freeText: Array<{ label: string; text: string }>;
  assumptions: Assumption[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="fig-gen-student">
      <button type="button" className="fig-gen-btn small" aria-expanded={open} aria-controls={`${id}-origin`} onClick={() => setOpen((v) => !v)}>
        {open ? "Ocultar dados de origem" : "Ver dados de origem"}
      </button>
      {open && (
        <div id={`${id}-origin`} className="fig-gen-origin">
          <p className="fig-gen-muted">A geração usa só o que está registrado. O que falta vira pergunta ou premissa declarada; nada é preenchido por suposição.</p>
          <dl className="fig-gen-facts">
            {considered.map((fact) => (
              <div key={fact.label}>
                <dt>
                  {fact.label} <Pill>{fact.source}</Pill>
                </dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          {freeText.length > 0 && (
            <details className="auto-details">
              <summary>Textos livres da ficha ({freeText.length}) · mostrados, nunca interpretados</summary>
              <dl className="fig-gen-facts">
                {freeText.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd className="free-text">{item.text}</dd>
                  </div>
                ))}
              </dl>
              <p className="fig-gen-muted">Transforme o que for relevante em respostas explícitas (por exemplo, exercícios a evitar).</p>
            </details>
          )}
          <details className="auto-details">
            <summary>Premissas que a ferramenta vai usar ({assumptions.length})</summary>
            <ul className="auto-list">
              {assumptions.map((a) => (
                <li key={a.code}>
                  <Pill tone={BASIS_TONES[a.basis]}>{BASIS_LABELS[a.basis]}</Pill> <span className="small">{a.text}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
