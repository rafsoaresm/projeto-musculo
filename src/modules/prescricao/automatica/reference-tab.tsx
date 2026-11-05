"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Assumption, RuleUse } from "@/modules/prescricao/motor/types";
import { BASIS_LABELS, ruleLabel } from "./view";
import { filterByText } from "./workbench";

type Kind = "premissas" | "regras";

interface Row {
  key: string;
  title: string;
  basis: Assumption["basis"];
  /** The stable identifier the engine records (the rule id), shown as it is. */
  ruleId: string | null;
}

/**
 * "Premissas" and "Regras" (Figma RX-09 and RX-10): what the generation assumed and the rules the engine used, read from the proposal
 * itself (`assumptions` and `rulesUsed`), numbered by their order. Nothing is written here: it is the traceability of the generation.
 * On a wide screen the list and the selected record sit side by side; on a phone each is a screen, with the other kind one tap away.
 */
export function ReferenceTab({
  kind,
  onKind,
  assumptions,
  rules,
  selectedKey,
  onSelect,
  detailOpen,
  onBack,
  onBackToSessions,
}: {
  kind: Kind;
  onKind: (kind: Kind) => void;
  assumptions: readonly Assumption[];
  rules: readonly RuleUse[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  detailOpen: boolean;
  onBack: () => void;
  onBackToSessions: () => void;
}) {
  const [query, setQuery] = useState("");
  const isRules = kind === "regras";
  const all: Row[] = isRules
    ? rules.map((r) => ({ key: r.ruleId, title: r.label, basis: r.basis, ruleId: r.ruleId }))
    : assumptions.map((a) => ({ key: a.code, title: a.text, basis: a.basis, ruleId: a.ruleId ?? null }));
  const visible = filterByText(all, query, (r) => `${r.title} ${BASIS_LABELS[r.basis]} ${r.ruleId ?? ""}`);
  const selected = all.find((r) => r.key === selectedKey) ?? null;
  const number = (r: Row) => String(all.indexOf(r) + 1).padStart(2, "0");
  const noun = isRules ? "Regra" : "Premissa";
  const titleId = `rx-${kind}-titulo`;
  return (
    <>
      <div className="rx-screenhead rx-mobile">
        <button type="button" className="rx-back" onClick={onBackToSessions}>
          <ChevronLeft size={16} aria-hidden="true" /> Voltar à prescrição
        </button>
        <h2>{isRules ? "Regras usadas" : "Premissas usadas"}</h2>
        <p className="rx-sub">
          {all.length} {isRules ? (all.length === 1 ? "regra" : "regras") : all.length === 1 ? "premissa" : "premissas"} •{" "}
          {isRules ? "transparência da prescrição" : "resultados dependem do motor"}
        </p>
        <div className="rx-note rx-note-brand">
          <strong>{isRules ? "Como o motor decidiu?" : "Rastreabilidade da geração"}</strong>
          <p>
            {isRules
              ? "As regras e seus efeitos ficam acessíveis sob demanda, com vínculo ao resultado da geração."
              : "Consulte os dados que sustentaram cada decisão, sem sobrecarregar a revisão de exercícios."}
          </p>
        </div>
        <div className="rx-card rx-segment" role="group" aria-label="Premissas ou regras">
          <button type="button" className={!isRules ? "rx-pillbtn selected" : "rx-pillbtn"} aria-pressed={!isRules} onClick={() => onKind("premissas")}>
            Premissas · {assumptions.length}
          </button>
          <button type="button" className={isRules ? "rx-pillbtn selected" : "rx-pillbtn"} aria-pressed={isRules} onClick={() => onKind("regras")}>
            Regras · {rules.length}
          </button>
        </div>
      </div>
      <div className="rx-split" data-detail={detailOpen ? "open" : "closed"}>
        <section className="rx-card rx-list" aria-labelledby={titleId}>
          <header className="rx-card-head rx-desktop">
            <h2 id={titleId}>{isRules ? "Regras usadas pelo motor" : "Premissas usadas"}</h2>
            <p className="rx-sub">
              {all.length} {isRules ? "regras" : "premissas"} desta geração · leitura somente
            </p>
          </header>
          <label className="rx-search">
            <span className="sr-only">{isRules ? "Buscar por regra ou decisão" : "Buscar nas premissas"}</span>
            <input type="search" value={query} placeholder={isRules ? "Buscar por regra ou decisão" : "Buscar nas premissas"} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <p className="rx-label rx-mobile">{isRules ? "Regras aplicadas / disponíveis" : "Origem e fundamentação"}</p>
          {all.length === 0 ? (
            <p className="rx-empty">{isRules ? "Esta proposta não registrou regras." : "Esta proposta não registrou premissas."}</p>
          ) : visible.length === 0 ? (
            <p className="rx-empty">Nada encontrado para a busca.</p>
          ) : (
            <ul className="rx-reflist">
              {visible.map((r) => (
                <li key={r.key}>
                  <button type="button" className={r.key === selectedKey ? "rx-refrow selected" : "rx-refrow"} aria-current={r.key === selectedKey ? "true" : undefined} onClick={() => onSelect(r.key)}>
                    <span className="rx-badge" aria-hidden="true">
                      {number(r)}
                    </span>
                    <span className="rx-refbody">
                      <span className="rx-rowtitle">{r.title}</span>
                      <span className="rx-sub">{BASIS_LABELS[r.basis]}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" className="rx-chevron" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="rx-card rx-panel" aria-label={`${noun} selecionada`}>
          <button type="button" className="rx-back" onClick={onBack}>
            <ChevronLeft size={16} aria-hidden="true" /> {isRules ? "Regras" : "Premissas"}
          </button>
          {selected ? (
            <>
              <span className="rx-chip rx-chip-brand">
                {noun} {number(selected)}
              </span>
              <h3 className="rx-panel-title">{selected.title}</h3>
              <hr className="rx-rule" />
              <h4 className="rx-label">Origem e fundamentação</h4>
              <p className="rx-record">{BASIS_LABELS[selected.basis]}</p>
              {selected.ruleId && (
                <>
                  <h4 className="rx-label">{isRules ? "Identificador da regra" : "Regra associada"}</h4>
                  <p className="rx-record">
                    {isRules ? selected.ruleId : ruleLabel(rules, selected.ruleId)} <span className="rx-sub">({selected.ruleId})</span>
                  </p>
                </>
              )}
              <p className="rx-sub">Visualização somente leitura: o conteúdo e as contagens vêm da geração atual.</p>
            </>
          ) : (
            <p className="rx-empty">Selecione {isRules ? "uma regra" : "uma premissa"} para ver o detalhe.</p>
          )}
        </aside>
      </div>
    </>
  );
}
