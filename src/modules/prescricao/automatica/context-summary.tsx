import { Pill } from "@/components/ui";
import type { Assumption } from "@/modules/prescricao/motor/types";
import type { ConsideredFact } from "./service";
import { BASIS_LABELS, BASIS_TONES } from "./view";

/**
 * "Dados considerados" (design §6.1 `context-summary`): what the generation reads, with where each fact comes from, the free
 * text of the records shown as it is (never interpreted) and the assumptions the tool will make. Reads nothing itself.
 */
export function ContextSummary({
  considered,
  freeText,
  assumptions,
}: {
  considered: ConsideredFact[];
  freeText: Array<{ label: string; text: string }>;
  assumptions: Assumption[];
}) {
  return (
    <section className="panel" aria-labelledby="dados-considerados">
      <p className="eyebrow">ANTES DE GERAR</p>
      <h2 id="dados-considerados">Dados considerados</h2>
      <p className="muted">
        A geração usa só o que está registrado. O que falta vira pergunta ou premissa declarada; nada é preenchido por suposição.
      </p>
      <dl className="considered-list">
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
          <dl className="considered-list">
            {freeText.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd className="free-text">{item.text}</dd>
              </div>
            ))}
          </dl>
          <p className="small muted">Transforme o que for relevante em respostas explícitas abaixo (por exemplo, exercícios a evitar).</p>
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
    </section>
  );
}
