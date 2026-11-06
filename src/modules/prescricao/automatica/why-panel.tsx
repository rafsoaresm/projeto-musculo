import type { WhyCard, WhyPill } from "./review-view";

const PILL_CLASS: Record<WhyPill["tone"], string> = {
  brand: "rx-chip rx-chip-brand",
  neutral: "rx-chip rx-chip-neutral",
  success: "rx-chip rx-chip-success",
};

/** The provenance pills of a card ("Sugestão da IA", "Padrão por regras", "Decisão do profissional", "Dado do aluno"); the label is text, never colour alone. */
export function ProvenancePills({ pills }: { pills: readonly WhyPill[] }) {
  if (!pills.length) return null;
  return (
    <ul className="rx-why-pills" aria-label="Origem">
      {pills.map((p) => (
        <li key={p.facet}>
          <span className="rx-sub">{p.about}:</span> <span className={PILL_CLASS[p.tone]} data-provenance={p.facet}>{p.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Por que foi selecionado?" (Figma RX-01 right column): the three cards — focus, dose parameters and weekly audit — each with the origin of
 * what it says. All text comes from `whyCards`; the panel only draws. The dose card keeps the group name and the `data-dose-why` markers the
 * dose "Por quê?" has always had.
 */
export function WhyPanel({ cards, itemName }: { cards: readonly WhyCard[]; itemName: string }) {
  return (
    <section className="rx-whypanel" aria-labelledby="rx-whypanel-title">
      <h4 id="rx-whypanel-title" className="rx-whypanel-title">
        Por que foi selecionado?
      </h4>
      <p className="rx-sub">Justificativas rastreáveis da avaliação ao exercício. {itemName}.</p>
      {cards.map((card) => (
        <article
          key={card.id}
          className={card.highlighted ? "rx-why-card selected" : "rx-why-card"}
          data-why={card.id}
          {...(card.id === "dose" ? { role: "group", "aria-label": "Por que esta dose" } : { "aria-label": card.title })}
        >
          <h5>{card.title}</h5>
          <p className="rx-why-lead">{card.lead}</p>
          <p className="rx-why-meta">{card.meta}</p>
          <ProvenancePills pills={card.pills} />
          {card.lines.length > 0 && (
            <ul className="rx-why-lines">
              {card.lines.map((line, n) => (
                <li key={n} className="small" {...(line.param ? { "data-dose-why": line.param } : {})} {...(line.note ? { "data-dose-note": line.note } : {})}>
                  {line.text}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
