"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { CAUTION_TAGS, PATTERNS } from "@/modules/biblioteca/metadata/vocabulary";
import type { Flag, FlagDecision } from "@/modules/prescricao/motor/types";
import { suggestionAnchor } from "./target-suggestions";
import { ALERTS_PAGE, alertPhases, filterAlerts, type AlertFilter, type AlertRow } from "./workbench";

export function decisionText(d: FlagDecision): string {
  if (d.kind === "EXCLUDE_PATTERN") return `Evitar o padrão ${PATTERNS[d.pattern] ?? d.pattern}`;
  if (d.kind === "EXCLUDE_CAUTION_TAG") return `Evitar exercícios marcados "${CAUTION_TAGS[d.tag] ?? d.tag}"`;
  if (d.kind === "EXCLUDE_EXERCISE") return "Evitar o exercício indicado";
  return "Ciente, sem mudar a seleção";
}

const FILTER_KEY = (f: AlertFilter) => (f.kind === "PHASE" ? `phase-${f.phaseIndex}` : f.kind);

/**
 * "Alertas" (Figma RX-02 desktop, RX-07 and RX-08 on a phone): the flags and the engine's issues as one table ordered by impact,
 * filters and a search, and the selected record on the right with the decision. Informational records never block anything and
 * the engine's selection never changes on its own: a decision (Ciente, or the suggested exclusion) counts from the next
 * regeneration. The audit of the plan goes below, as children.
 */
export function AlertsTab({
  rows,
  selectedKey,
  onSelect,
  detailOpen,
  onBack,
  onBackToSessions,
  filter,
  onFilter,
  query,
  onQuery,
  pending,
  studentHref,
  suggestedPhases,
  onDecide,
  onGoToWeek,
  onShowTargets,
  children,
}: {
  rows: AlertRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  detailOpen: boolean;
  /** Phone: from the record back to the list. */
  onBack: () => void;
  /** Phone: from the list back to the proposal. */
  onBackToSessions: () => void;
  filter: AlertFilter;
  onFilter: (f: AlertFilter) => void;
  query: string;
  onQuery: (q: string) => void;
  pending: boolean;
  studentHref: string;
  /** Phases whose "alvos sugeridos" card is offered in the audit. */
  suggestedPhases: ReadonlySet<number>;
  onDecide: (flag: Flag, decision: FlagDecision) => void;
  onGoToWeek: (phaseIndex: number, week: number) => void;
  onShowTargets: (phaseIndex: number) => void;
  children?: ReactNode;
}) {
  const [limit, setLimit] = useState(ALERTS_PAGE);
  const visible = filterAlerts(rows, filter, query);
  const shown = visible.slice(0, limit);
  const selected = rows.find((r) => r.key === selectedKey) ?? null;
  const selectedIndex = selected ? rows.indexOf(selected) + 1 : 0;
  const review = rows.filter((r) => r.needsReview).length;
  const phases = alertPhases(rows);
  const filters: Array<{ f: AlertFilter; text: string; short?: string }> = [
    { f: { kind: "ALL" }, text: `Todos os registros · ${rows.length}`, short: "Todos" },
    { f: { kind: "REVIEW" }, text: "Exigem validação", short: "Validação" },
    { f: { kind: "INFO" }, text: "Informativos", short: "Informação" },
    ...phases.map((p) => ({ f: { kind: "PHASE", phaseIndex: p } as AlertFilter, text: `Fase ${String(p).padStart(2, "0")}` })),
  ];
  return (
    <>
      <div className="rx-screenhead rx-mobile">
        <button type="button" className="rx-back" onClick={onBackToSessions}>
          <ChevronLeft size={16} aria-hidden="true" /> Prescrição automática
        </button>
        <h2>Alertas e informações</h2>
        <p className="rx-sub">{rows.length} registros • revisão profissional</p>
        <div className="rx-card rx-summary-mini">
          <p>
            <span className="rx-chip rx-chip-brand">{rows.length} registros</span> <strong>{review} a revisar</strong>
          </p>
          <p className="rx-sub">Sem alterações automáticas na seleção de exercícios.</p>
        </div>
      </div>
      <div className="rx-card rx-filterbar" role="group" aria-label="Filtrar alertas">
        <span className="rx-label rx-desktop">Filtrar</span>
        <div className="rx-chips">
          {filters.map(({ f, text, short }) => (
            <button
              key={FILTER_KEY(f)}
              type="button"
              className={FILTER_KEY(f) === FILTER_KEY(filter) ? "rx-pillbtn selected" : "rx-pillbtn"}
              aria-pressed={FILTER_KEY(f) === FILTER_KEY(filter)}
              onClick={() => {
                onFilter(f);
                setLimit(ALERTS_PAGE);
              }}
            >
              <span className={short ? "rx-desktop" : undefined}>{text}</span>
              {short && <span className="rx-mobile">{short}</span>}
            </button>
          ))}
        </div>
        <label className="rx-search rx-desktop">
          <span className="sr-only">Buscar por origem, exercício ou justificativa</span>
          <input
            type="search"
            value={query}
            placeholder="Busca por origem, exercício ou justificativa"
            onChange={(e) => {
              onQuery(e.target.value);
              setLimit(ALERTS_PAGE);
            }}
          />
        </label>
      </div>
      <div className="rx-split" data-detail={detailOpen ? "open" : "closed"}>
        <section className="rx-card rx-list" aria-labelledby="rx-alertas-titulo">
          <header className="rx-card-head rx-desktop">
            <h2 id="rx-alertas-titulo">Alertas e informações</h2>
            <p className="rx-sub">{rows.length} registros preservados · agrupados por impacto para revisão</p>
          </header>
          <label className="rx-search rx-mobile">
            <span className="sr-only">Buscar nos alertas</span>
            <input type="search" value={query} placeholder="Buscar nos alertas" onChange={(e) => onQuery(e.target.value)} />
          </label>
          {rows.length === 0 ? (
            <p className="rx-empty">Nenhum alerta da triagem, da avaliação, do histórico ou do motor nesta proposta.</p>
          ) : visible.length === 0 ? (
            <p className="rx-empty">Nenhum registro com este filtro.</p>
          ) : (
            <table className="rx-table rx-alert-table">
              <thead>
                <tr>
                  <th scope="col">Registro</th>
                  <th scope="col">Origem</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const n = rows.indexOf(row) + 1;
                  const on = row.key === selectedKey;
                  return (
                    <tr key={row.key} className={on ? "selected" : undefined} aria-current={on ? "true" : undefined}>
                      <td className="rx-cell-main">
                        <div className="rx-cell-flex">
                          <span className={on ? "rx-order on" : "rx-order"} aria-hidden="true">
                            {n}
                          </span>
                          <button type="button" className="rx-rowbtn" onClick={() => onSelect(row.key)} aria-label={`Revisar registro ${n}: ${row.message}`}>
                            <span className="rx-rowtitle">{row.message}</span>
                            <span className="rx-sub rx-mobile">{row.origin}</span>
                          </button>
                        </div>
                      </td>
                      <td className="rx-cell-origin">{row.origin}</td>
                      <td className="rx-cell-status">
                        <span className={`rx-chip rx-chip-${row.tone}`}>{row.statusText}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {visible.length > 0 && (
            <footer className="rx-card-foot">
              <span className="rx-sub" role="status">
                Exibindo {shown.length} de {visible.length} registros
              </span>
              {shown.length < visible.length && (
                <button type="button" className="rx-btn rx-btn-line" onClick={() => setLimit(limit + ALERTS_PAGE)}>
                  Ver os próximos
                </button>
              )}
            </footer>
          )}
        </section>
        <aside className="rx-card rx-panel" aria-label="Registro selecionado">
          {selected ? (
            <AlertDetail
              row={selected}
              index={selectedIndex}
              total={rows.length}
              pending={pending}
              studentHref={studentHref}
              offersTargets={selected.phaseIndex !== null && suggestedPhases.has(selected.phaseIndex)}
              onBack={onBack}
              onDecide={onDecide}
              onGoToWeek={onGoToWeek}
              onShowTargets={onShowTargets}
            />
          ) : (
            <p className="rx-empty">Selecione um registro para ver o detalhe.</p>
          )}
        </aside>
      </div>
      {children}
    </>
  );
}

function AlertDetail({
  row,
  index,
  total,
  pending,
  studentHref,
  offersTargets,
  onBack,
  onDecide,
  onGoToWeek,
  onShowTargets,
}: {
  row: AlertRow;
  index: number;
  total: number;
  pending: boolean;
  studentHref: string;
  offersTargets: boolean;
  onBack: () => void;
  onDecide: (flag: Flag, decision: FlagDecision) => void;
  onGoToWeek: (phaseIndex: number, week: number) => void;
  onShowTargets: (phaseIndex: number) => void;
}) {
  const flag = row.flag;
  const issue = row.issue;
  const weekAt = issue ? Number(/weeks?\.(\d+)/.exec(issue.path)?.[1]) : NaN;
  const open = flag && !flag.decided;
  const source = flag?.source;
  const chipText = row.needsReview ? "Revisão profissional" : row.decided ? "Decidido" : "Informação";
  const link =
    source === "ASSESSMENT"
      ? { href: `${studentHref}/avaliacoes`, text: "Abrir avaliação" }
      : source === "ANAMNESIS" || source === "SCREENING"
        ? { href: `${studentHref}/ficha`, text: "Abrir ficha do aluno" }
        : null;
  return (
    <>
      <button type="button" className="rx-back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" /> Voltar aos alertas
      </button>
      <span className={`rx-chip ${row.needsReview ? "rx-chip-warning" : "rx-chip-brand"}`}>{chipText}</span>
      <h3 className="rx-panel-title">{row.title}</h3>
      <p className="rx-sub">
        Registro {index} de {total} · Origem: {row.origin.toLowerCase()}
      </p>
      <hr className="rx-rule" />
      <h4 className="rx-label">Registro</h4>
      <p className="rx-record">{row.message}</p>
      <div className={row.needsReview ? "rx-note rx-note-warning" : "rx-note"}>
        {flag ? (
          <>
            <strong>{row.needsReview ? "Requer validação do profissional" : row.decided ? "Decisão registrada" : "Informação para a sua revisão"}</strong>
            <p>
              {flag.decided
                ? `Decidido: ${decisionText(flag.decided)}. Vale a partir da próxima regeneração.`
                : "Sinal para revisão do profissional: não exclui nada automaticamente. Uma decisão vale a partir da próxima regeneração."}
            </p>
            {flag.suggestedDecision && flag.suggestedDecision.kind !== "ACKNOWLEDGE" && !flag.decided && (
              <p className="rx-sub">Sugestão: {decisionText(flag.suggestedDecision)}.</p>
            )}
          </>
        ) : (
          <>
            <strong>{row.needsReview ? "Observação do motor para a sua revisão" : "Informação do motor"}</strong>
            <p>Não bloqueia nada e não muda doses.</p>
            {issue?.suggestedAction && <p>{issue.suggestedAction}</p>}
            {issue?.count && issue.count > 1 ? <p className="rx-sub">{issue.count} ocorrências agregadas neste registro.</p> : null}
          </>
        )}
      </div>
      <hr className="rx-rule" />
      <div className="rx-actions">
        {flag && open && flag.suggestedDecision && flag.suggestedDecision.kind !== "ACKNOWLEDGE" && (
          <button type="button" className="rx-btn rx-btn-line" disabled={pending} onClick={() => onDecide(flag, flag.suggestedDecision!)}>
            Aceitar: {decisionText(flag.suggestedDecision)}
          </button>
        )}
        {link && (
          <Link href={link.href} className="rx-btn rx-btn-line">
            {link.text}
          </Link>
        )}
        {issue && issue.phaseIndex && Number.isInteger(weekAt) ? (
          <button type="button" className="rx-btn rx-btn-line" onClick={() => onGoToWeek(issue.phaseIndex!, weekAt)}>
            Ver a semana {weekAt}
          </button>
        ) : null}
        {issue?.code === "NO_TARGETS" && issue.phaseIndex && offersTargets ? (
          <a className="rx-btn rx-btn-line" href={`#${suggestionAnchor(issue.phaseIndex)}`} onClick={() => onShowTargets(issue.phaseIndex!)}>
            Ver alvos sugeridos
          </a>
        ) : null}
        {flag && open && (
          <button type="button" className="rx-btn rx-btn-primary" disabled={pending} onClick={() => onDecide(flag, { kind: "ACKNOWLEDGE" })}>
            Marcar revisado
          </button>
        )}
      </div>
      <p className="rx-sub">
        {flag ? "A decisão fica registrada no histórico da proposta. Validar não equivale à liberação médica." : "O restante dos registros continua na lista."}
      </p>
    </>
  );
}
