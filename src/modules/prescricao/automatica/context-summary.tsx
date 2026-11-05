"use client";
import { useId, useState } from "react";
import { Pill } from "@/components/ui";
import type { Assumption } from "@/modules/prescricao/motor/types";
import { baseCells, studentCard } from "./generation-view";
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
 * "Dados do aluno" (Figma GEN-01, 75:974): a compact card with what the records say and what they do not, and "Ver dados de origem"
 * to open the full list: every fact with where it comes from, the free text of the records shown as it is (never interpreted) and
 * the assumptions the tool will make. Reads nothing itself.
 */
export function StudentCard({
  summary,
  considered,
  freeText,
  assumptions,
}: {
  summary: GenerationSummary;
  considered: ConsideredFact[];
  freeText: Array<{ label: string; text: string }>;
  assumptions: Assumption[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const card = studentCard(summary);
  return (
    <section className="fig-gen-card fig-gen-student" aria-labelledby={`${id}-title`}>
      <div className="fig-gen-student-head">
        <h2 id={`${id}-title`}>Dados do aluno</h2>
        <span className={`fig-gen-pill${card.status === "COMPLETO" ? " ok" : ""}`}>{card.status}</span>
      </div>
      <p className="fig-gen-muted">
        {card.facts.map((fact, index) => (
          <span key={fact.label}>
            {index > 0 && " · "}
            {fact.value === null ? `${fact.label.toLowerCase()} não informado` : `${fact.label}: ${fact.value}`}
          </span>
        ))}
      </p>
      <p className={card.parq.warning ? "fig-gen-strong warn" : "fig-gen-strong"}>{card.parq.text}</p>
      <hr className="fig-gen-rule" />
      <p className="fig-gen-note">{card.findings}</p>
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
    </section>
  );
}
