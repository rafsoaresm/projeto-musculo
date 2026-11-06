"use client";
import Link from "next/link";
import { useId } from "react";
import { OptionCard } from "./option-card";
import { assumptionLines, whyCards, type StrategyCard, type StrategyChoice } from "./flow-view";
import type { GenerationScreen } from "./service";
import type { StrategyListView } from "@/modules/prescricao/planejador/strategy-view";

/**
 * "Estratégias sugeridas" and "Por que esta sugestão?" (Figma GEN-02, M-01): up to three strategies plus "Personalizar" and "Sem divisão
 * (geração atual)", as a radio group. Choosing one accepts NOTHING: the acceptance is written by "Conferir blueprint" (GEN-03 to GEN-04).
 * A strategy the saved periodization cannot carry is shown disabled with the way to change the periodization. Text of the cards comes from
 * fixed tables and the structure; the only model text is the one-line explanation, rendered as text.
 */
export function StrategyList({
  list, cards, choice, onChoose, screen, periodizationHref,
}: {
  list: StrategyListView;
  cards: StrategyCard[];
  choice: StrategyChoice;
  onChoose: (choice: StrategyChoice) => void;
  screen: GenerationScreen;
  periodizationHref: string;
}) {
  const id = useId();
  const why = whyCards(list, choice, screen.summary, screen.structure);
  const doubts = assumptionLines(list);
  return (
    <div className="fig-gen-cols">
      <section className="fig-gen-card fig-gen-strategies" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="fig-gen-card-title">
          <span className="fig-gen-d">Estratégias sugeridas</span>
          <span className="fig-gen-m">{list.producer === "AI" ? "IA sugere, você decide" : "Padrão por regras, você decide"}</span>
        </h2>
        <p className="fig-gen-sub fig-gen-d">Seleção explícita — nenhuma opção aplicada automaticamente.</p>
        <p className="fig-gen-sub fig-gen-m">Escolha o formato da fase antes de gerar os treinos.</p>
        <p className="fig-gen-hint">{list.label}</p>
        <div role="radiogroup" aria-label="Estratégias sugeridas" className="fig-gen-opts">
          {cards.map((c) => (
            <OptionCard
              key={c.id}
              name="fig-gen-strategy"
              value={c.id}
              checked={choice === c.id}
              disabled={c.disabled}
              onChange={(v) => onChoose(v as StrategyChoice)}
              title={c.title}
              line={c.line}
              meta={c.meta}
              pills={c.pills}
              reason={c.disabledReason}
              reasonId={`${id}-${c.id}-reason`}
            >
              {c.disabled && (
                <Link href={periodizationHref} className="fig-gen-link">
                  Alterar periodização
                </Link>
              )}
            </OptionCard>
          ))}
        </div>
      </section>
      <aside className="fig-gen-card fig-gen-why" aria-labelledby={`${id}-why`}>
        <h2 id={`${id}-why`} className="fig-gen-card-title">
          Por que esta sugestão?
        </h2>
        <p className="fig-gen-sub">Resumo da análise para revisão profissional.</p>
        {why.map((c) => (
          <div key={c.title} className="fig-gen-info" data-highlight={c.highlight ? "true" : undefined}>
            <h3>{c.title}</h3>
            <p>{c.line}</p>
            <p className="fig-gen-info-meta">{c.meta}</p>
          </div>
        ))}
        {doubts.length > 0 && (
          <details className="fig-gen-sub-details">
            <summary>Premissas e dúvidas ({doubts.length})</summary>
            <ul className="auto-list">
              {doubts.map((d, n) => (
                <li key={n} className="small">
                  {d}
                </li>
              ))}
            </ul>
          </details>
        )}
      </aside>
    </div>
  );
}
