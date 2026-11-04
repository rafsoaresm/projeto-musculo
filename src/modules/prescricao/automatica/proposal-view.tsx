"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HelpCircle, Lock, RefreshCw, Repeat, Shuffle, Unlock } from "lucide-react";
import { Kpi, Notice, Pill } from "@/components/ui";
import { CAUTION_TAGS, PATTERNS } from "@/modules/biblioteca/metadata/vocabulary";
import { ISSUE_LABELS, STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";
import type { Flag, FlagDecision, ItemOut, OccurrenceOut, RegenerationScope } from "@/modules/prescricao/motor/types";
import type { ProposalSummary } from "@/db/prescription-proposals";
import { workoutTitle } from "@/modules/training/format";
import { formatCalendarDate } from "@/modules/training/format";
import {
  acceptFlagDecision,
  continueProposal,
  discardProposal,
  lockItems,
  rebaseProposal,
  regenerateScope,
  type ProposalActionResult,
} from "./actions";
import { SubstituteDialog, type SubstituteTarget } from "./substitute-dialog";
import { NETWORK_ERROR, useIntent } from "./use-intent";
import {
  BASIS_LABELS,
  BASIS_TONES,
  METADATA_LABELS,
  NOT_UNIVERSAL,
  PROPOSAL_ORIGIN_LABELS,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  durationText,
  issuesOfPhase,
  itemBases,
  labelsOf,
  proposalProgression,
  traceParamLabel,
  traceValue,
} from "./view";

/** The proposal header fields the screen needs (no answers, no ledger references). */
export interface ProposalHeaderView {
  id: string;
  version: number;
  baseContentVersion: number;
  contentVersion: number;
  status: "SUCCEEDED" | "INFEASIBLE";
  validation: "PASSED" | "WARNINGS" | "BLOCKED";
  complete: boolean;
  phasesGenerated: number[];
  engineVersion: string;
  rulesId: string;
  rulesVersion: string;
  createdAt: string;
  updatedAt: string;
}

const VALIDATION: Record<ProposalHeaderView["validation"], { text: string; tone: "success" | "warning" | "danger" }> = {
  PASSED: { text: "Sem avisos", tone: "success" },
  WARNINGS: { text: "Com avisos", tone: "warning" },
  BLOCKED: { text: "Com impedimentos", tone: "danger" },
};

function decisionText(d: FlagDecision): string {
  if (d.kind === "EXCLUDE_PATTERN") return `Evitar o padrão ${PATTERNS[d.pattern] ?? d.pattern}`;
  if (d.kind === "EXCLUDE_CAUTION_TAG") return `Evitar exercícios marcados "${CAUTION_TAGS[d.tag] ?? d.tag}"`;
  if (d.kind === "EXCLUDE_EXERCISE") return "Evitar o exercício indicado";
  return "Ciente, sem mudar a seleção";
}

const sessionId = (o: Pick<OccurrenceOut, "week" | "slot">) => `sessao-${o.week}-${o.slot}`;

/**
 * The proposal (design §6.1 `proposal-view`, UI items 3 to 6, 8 and 9): status, versions and counts; navigation by links from
 * phase to week to sessions; each exercise with its stored dose, the bases of its values, "Por quê?" (the trace), and the engine
 * operations: substitute, keep (lock), another exercise, regenerate the session, the week, the workout from a week on, the phase,
 * or from the phase on. No dose is edited here: manual editing happens after the apply, in the draft's editor.
 */
export function ProposalView({
  planId,
  revisionId,
  selfHref,
  header,
  summary,
  occurrences,
  phaseIndex,
  week,
  library,
}: {
  planId: string;
  revisionId: string;
  selfHref: string;
  header: ProposalHeaderView;
  summary: ProposalSummary;
  occurrences: OccurrenceOut[];
  phaseIndex: number;
  week: number;
  library: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const intent = useIntent();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "notice"; text: string } | null>(null);
  const [substituting, setSubstituting] = useState<SubstituteTarget | null>(null);
  const phase = summary.phases.find((p) => p.phaseIndex === phaseIndex)!;
  const stale = header.contentVersion !== header.baseContentVersion;
  const ofWeek = occurrences.filter((o) => o.week === week).sort((a, b) => a.slot - b.slot);
  const labels = labelsOf(occurrences, phaseIndex);
  const missing = summary.phases.filter((p) => !header.phasesGenerated.includes(p.phaseIndex)).length;
  const href = (p: number, w?: number) => `${selfHref}?fase=${p}${w ? `&semana=${w}` : ""}`;
  const phaseIssues = issuesOfPhase(summary.issues, phaseIndex);
  const lockedKeys = new Set(occurrences.flatMap((o) => o.items.filter((i) => i.origin === "LOCKED").map((i) => i.slotKey)));
  const cas = { proposalId: header.id, expectedVersion: header.version };

  function run(what: string, task: (ids: { key: string; write: string }) => Promise<ProposalActionResult>) {
    setMessage(null);
    startTransition(async () => {
      try {
        const ids = intent.take(`${what}:${header.version}`);
        const result = await task(ids);
        intent.done();
        if (result.error) setMessage({ tone: "error", text: result.error });
        else setMessage({ tone: "notice", text: result.notice ?? "Proposta atualizada." });
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: NETWORK_ERROR });
      }
    });
  }
  const regenerate = (scope: RegenerationScope, what: string) =>
    run(`regen:${what}`, (ids) => regenerateScope(planId, revisionId, { ...cas, idempotencyKey: ids.key, writeId: ids.write, scope }));
  const lock = (item: ItemOut, locked: boolean) =>
    run(`lock:${item.slotKey}:${locked}`, (ids) => lockItems(planId, revisionId, { ...cas, writeId: ids.write, targets: [{ phaseIndex, slotKey: item.slotKey }], locked }));
  const decide = (flag: Flag, decision: FlagDecision) =>
    run(`flag:${flag.code}:${decision.kind}`, (ids) => acceptFlagDecision(planId, revisionId, { ...cas, writeId: ids.write, flagCode: flag.code, decision }));

  return (
    <>
      <section className="panel" aria-labelledby="proposta-titulo">
        <p className="eyebrow">PROPOSTA AUTOMÁTICA · PARA REVISÃO</p>
        <h2 id="proposta-titulo">Proposta de prescrição</h2>
        <p className="small proposal-pills">
          <Pill tone={header.status === "INFEASIBLE" ? "danger" : "success"}>{header.status === "INFEASIBLE" ? "Inviável como está" : "Gerada"}</Pill>
          <Pill tone={VALIDATION[header.validation].tone}>{VALIDATION[header.validation].text}</Pill>
          <Pill tone="brand">Versão {header.version}</Pill>
        </p>
        <div className="kpi-grid compact">
          <Kpi label="Fases geradas" value={`${header.phasesGenerated.length} de ${summary.phases.length}`} />
          <Kpi label="Sessões nesta fase" value={String(occurrences.length)} />
          <Kpi label="Avisos" value={String(summary.issues.filter((i) => i.severity !== "INFO").length)} />
          <Kpi label="Alertas" value={String(summary.flags.length)} />
        </div>
        <p className="small muted">
          Motor {header.engineVersion} · regras {header.rulesId} {header.rulesVersion}. {NOT_UNIVERSAL} Nada aqui está no rascunho até você
          aplicar; a aprovação continua sendo sua.
        </p>
        {stale && (
          <Notice tone="warning">
            <div>
              <p>
                <strong>O rascunho mudou desde a geração.</strong> Atualize a proposta com o rascunho atual (as linhas que estão lá são
                mantidas) ou descarte e gere de novo.
              </p>
              <div className="exercise-actions">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={pending}
                  onClick={() => run("rebase", (ids) => rebaseProposal(planId, revisionId, { ...cas, idempotencyKey: ids.key, writeId: ids.write }))}
                >
                  Atualizar com o rascunho atual
                </button>
                <button
                  type="button"
                  className="button danger-outline small"
                  disabled={pending}
                  onClick={() => run("discard", (ids) => discardProposal(planId, revisionId, { ...cas, writeId: ids.write }))}
                >
                  Descartar e gerar de novo
                </button>
              </div>
            </div>
          </Notice>
        )}
        {missing > 0 && (
          <Notice tone="warning">
            <div>
              <p>
                Faltam {missing} {missing === 1 ? "fase" : "fases"} (limite técnico por pedido). Continue a geração antes de aplicar.
              </p>
              <button
                type="button"
                className="button secondary small"
                disabled={pending}
                onClick={() => run("continue", (ids) => continueProposal(planId, revisionId, { ...cas, idempotencyKey: ids.key, writeId: ids.write }))}
              >
                Continuar geração
              </button>
            </div>
          </Notice>
        )}
        <div className="auto-progress" role="status" aria-live="polite">
          {pending && (
            <>
              <span className="spinner" aria-hidden="true" /> Processando…
            </>
          )}
          {!pending && message?.tone === "notice" && message.text}
        </div>
        {!pending && message?.tone === "error" && (
          <p className="error-message" role="alert">
            {message.text}{" "}
            <button type="button" className="link-button" onClick={() => router.refresh()}>
              Recarregar
            </button>
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="alertas-titulo">
        <h2 id="alertas-titulo">Alertas, premissas e avisos</h2>
        {summary.flags.length > 0 ? (
          <>
            <p className="small muted">Sinal para revisão do profissional — não exclui nada automaticamente. Uma decisão vale a partir da próxima regeneração.</p>
            <ul className="auto-list">
              {summary.flags.map((flag) => (
                <li key={flag.code} className="flag-row">
                  <span>
                    <Pill tone={SEVERITY_TONES[flag.severity]}>{SEVERITY_LABELS[flag.severity]}</Pill> {flag.message}
                    {flag.decided && <span className="small muted"> · Decidido: {decisionText(flag.decided)}</span>}
                  </span>
                  {!flag.decided && (
                    <span className="exercise-actions">
                      {flag.suggestedDecision && flag.suggestedDecision.kind !== "ACKNOWLEDGE" && (
                        <button type="button" className="button secondary small" disabled={pending} onClick={() => decide(flag, flag.suggestedDecision!)}>
                          Aceitar: {decisionText(flag.suggestedDecision)}
                        </button>
                      )}
                      <button type="button" className="button secondary small" disabled={pending} onClick={() => decide(flag, { kind: "ACKNOWLEDGE" })}>
                        Ciente
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="small muted">Nenhum alerta da triagem, da avaliação ou do histórico.</p>
        )}
        {phaseIssues.length > 0 && (
          <details className="auto-details" open={phaseIssues.some((i) => i.severity === "ERROR")}>
            <summary>
              Avisos desta fase ({phaseIssues.length})
            </summary>
            <ul className="auto-list">
              {phaseIssues.map((issue, n) => {
                const at = /weeks?\.(\d+)/.exec(issue.path)?.[1];
                return (
                  <li key={`${issue.code}-${issue.path}-${n}`} className="small">
                    <Pill tone={SEVERITY_TONES[issue.severity]}>{ISSUE_LABELS[issue.code] ?? issue.code}</Pill> {issue.message}
                    {issue.suggestedAction && <span className="muted"> {issue.suggestedAction}</span>}
                    {issue.count && issue.count > 1 ? <span className="muted"> ({issue.count} ocorrências)</span> : null}
                    {at && issue.phaseIndex ? (
                      <>
                        {" "}
                        <Link href={href(issue.phaseIndex, Number(at))} scroll={false}>
                          Ver a semana {at}
                        </Link>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        <details className="auto-details">
          <summary>Premissas usadas ({summary.assumptions.length})</summary>
          <ul className="auto-list">
            {summary.assumptions.map((a) => (
              <li key={a.code}>
                <Pill tone={BASIS_TONES[a.basis]}>{BASIS_LABELS[a.basis]}</Pill> <span className="small">{a.text}</span>
              </li>
            ))}
          </ul>
        </details>
        <details className="auto-details">
          <summary>Regras usadas ({summary.rulesUsed.length})</summary>
          <ul className="auto-list">
            {summary.rulesUsed.map((r) => (
              <li key={r.ruleId} className="small">
                <Pill tone={BASIS_TONES[r.basis]}>{BASIS_LABELS[r.basis]}</Pill> {r.label} <span className="muted">({r.ruleId})</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="panel" aria-labelledby="sessoes-titulo">
        <h2 id="sessoes-titulo">Fases, semanas e sessões</h2>
        <nav className="phase-tabs" aria-label="Fases da proposta">
          {summary.phases.map((p) =>
            header.phasesGenerated.includes(p.phaseIndex) ? (
              <Link
                key={p.phaseIndex}
                href={href(p.phaseIndex)}
                scroll={false}
                className={p.phaseIndex === phaseIndex ? "phase-tab selected" : "phase-tab"}
                aria-current={p.phaseIndex === phaseIndex ? "page" : undefined}
              >
                Fase {String(p.phaseIndex).padStart(2, "0")}
                {p.name ? ` · ${p.name}` : ""}
              </Link>
            ) : (
              <span key={p.phaseIndex} className="phase-tab disabled" aria-disabled="true">
                Fase {String(p.phaseIndex).padStart(2, "0")} (não gerada)
              </span>
            ),
          )}
        </nav>
        <p className="small muted">
          {phase.weeks} {phase.weeks === 1 ? "semana" : "semanas"} · {phase.sessionsPerWeek} {phase.sessionsPerWeek === 1 ? "sessão" : "sessões"} por semana
          {phase.progression ? ` · progressão: ${phase.progression.value.model === "NONE" ? "sem progressão" : phase.progression.value.model.toLowerCase()} (${BASIS_LABELS[phase.progression.basis]})` : " · sem progressão semanal"}
        </p>
        <div className="exercise-actions proposal-controls">
          <button type="button" className="button secondary small" disabled={pending} onClick={() => regenerate({ kind: "PHASE", phaseIndex }, `phase:${phaseIndex}`)}>
            <RefreshCw size={15} aria-hidden="true" /> Regenerar a fase {phaseIndex}
          </button>
          {summary.phases.some((p) => p.phaseIndex > phaseIndex) && (
            <button type="button" className="button secondary small" disabled={pending} onClick={() => regenerate({ kind: "FROM_PHASE", phaseIndex }, `from:${phaseIndex}`)}>
              <RefreshCw size={15} aria-hidden="true" /> Regenerar desta fase em diante
            </button>
          )}
        </div>
        <nav className="week-nav" aria-label={`Semanas da fase ${phaseIndex}`}>
          {Array.from({ length: phase.weeks }, (_, n) => n + 1).map((w) => (
            <Link key={w} href={href(phaseIndex, w)} scroll={false} aria-current={w === week ? "page" : undefined}>
              Semana {w}
            </Link>
          ))}
        </nav>
        <div className="exercise-actions proposal-controls">
          <button type="button" className="button secondary small" disabled={pending} onClick={() => regenerate({ kind: "WEEK", phaseIndex, week }, `week:${phaseIndex}:${week}`)}>
            <RefreshCw size={15} aria-hidden="true" /> Regenerar a semana {week}
          </button>
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              className="button secondary small"
              disabled={pending}
              onClick={() => regenerate({ kind: "WORKOUT", phaseIndex, label, ...(week > 1 ? { fromWeek: week } : {}) }, `workout:${phaseIndex}:${label}:${week}`)}
            >
              <RefreshCw size={15} aria-hidden="true" /> Regenerar o treino {label}
              {week > 1 ? ` a partir da semana ${week}` : ""}
            </button>
          ))}
        </div>
        {ofWeek.length === 0 ? (
          <p className="small muted">Nenhuma sessão nesta semana.</p>
        ) : (
          <div className="workout-grid proposal-grid">
            {ofWeek.map((o) => {
              const duration = durationText(o);
              return (
                <section key={sessionId(o)} id={sessionId(o)} className="workout-card proposal-session" aria-label={`Semana ${o.week}, sessão ${o.slot}, treino ${o.label}`}>
                  <header>
                    <h3>
                      Sessão {o.slot} · {workoutTitle(o.label, summary.workouts.find((w) => w.phaseIndex === phaseIndex && w.label === o.label)?.name ?? null)}
                    </h3>
                    {o.plannedDate && <span className="small muted">{formatCalendarDate(o.plannedDate)}</span>}
                    {duration && (
                      <Pill tone={o.budgetMinutes && o.estimatedMinutes && o.estimatedMinutes > o.budgetMinutes ? "warning" : "neutral"}>{duration}</Pill>
                    )}
                    {o.stimulus && <Pill>{STIMULUS_LABELS[o.stimulus.value] ?? o.stimulus.value}</Pill>}
                  </header>
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={pending}
                    onClick={() => regenerate({ kind: "OCCURRENCE", phaseIndex, week: o.week, slot: o.slot }, `occ:${phaseIndex}:${o.week}:${o.slot}`)}
                  >
                    <RefreshCw size={15} aria-hidden="true" /> Regenerar esta sessão
                  </button>
                  {o.items.length === 0 ? (
                    <p className="small muted">Nenhum exercício nesta sessão.</p>
                  ) : (
                    <ol className="exercise-list">
                      {o.items.map((item) => (
                        <ProposalItem
                          key={item.slotKey}
                          item={item}
                          locked={lockedKeys.has(item.slotKey) || item.origin === "LOCKED"}
                          pending={pending}
                          onSubstitute={() => setSubstituting({ phaseIndex, slotKey: item.slotKey, week: o.week, slot: o.slot, name: item.exerciseName, phaseWeeks: phase.weeks })}
                          onLock={(locked) => lock(item, locked)}
                          onAnother={() =>
                            regenerate({ kind: "ITEM", phaseIndex, week: o.week, slot: o.slot, slotKey: item.slotKey }, `item:${o.week}:${o.slot}:${item.slotKey}`)
                          }
                        />
                      ))}
                    </ol>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {phase.weeks > 1 &&
          labels.map((label) => {
            const rows = proposalProgression(occurrences, phaseIndex, phase.weeks, label);
            if (!rows.length) return null;
            return (
              <details key={label} className="progression-details">
                <summary>Progressão nesta fase · Treino {label}</summary>
                <div className="execution-scroll">
                  <table className="execution-table">
                    <caption className="small muted">Dose da primeira sessão do treino em cada semana. “—”: fora das sessões dessa semana.</caption>
                    <thead>
                      <tr>
                        <th scope="col">Exercício</th>
                        {Array.from({ length: phase.weeks }, (_, n) => (
                          <th scope="col" key={n}>
                            Semana {n + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.slotKey}>
                          <th scope="row">{row.name}</th>
                          {row.cells.map((cell, n) => (
                            <td key={n}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
      </section>
      {substituting && (
        <SubstituteDialog
          planId={planId}
          revisionId={revisionId}
          proposal={cas}
          target={substituting}
          library={library}
          onClose={(result) => {
            setSubstituting(null);
            if (result) {
              setMessage(result.error ? { tone: "error", text: result.error } : { tone: "notice", text: result.notice ?? "Exercício substituído." });
              router.refresh();
            }
          }}
        />
      )}
    </>
  );
}

function ProposalItem({
  item,
  locked,
  pending,
  onSubstitute,
  onLock,
  onAnother,
}: {
  item: ItemOut;
  locked: boolean;
  pending: boolean;
  onSubstitute: () => void;
  onLock: (locked: boolean) => void;
  onAnother: () => void;
}) {
  const bases = itemBases(item);
  const meta = METADATA_LABELS[item.metadata];
  const preserved = item.origin === "PRESERVED";
  return (
    <li>
      <div className="exercise-main">
        <strong>{item.exerciseName}</strong>
        <span className="small">{item.display.doseText || "Dose em branco: você preenche depois de aplicar."}</span>
        <span className="pill-row">
          <Pill tone={item.origin === "ENGINE" ? "neutral" : "brand"}>{PROPOSAL_ORIGIN_LABELS[item.origin]}</Pill>
          {meta && <Pill tone="warning">{meta}</Pill>}
          {bases.map((b) => (
            <Pill key={b} tone={BASIS_TONES[b]}>
              {BASIS_LABELS[b]}
            </Pill>
          ))}
        </span>
      </div>
      <details className="why-details">
        <summary>
          <HelpCircle size={15} aria-hidden="true" /> Por quê?
        </summary>
        <ul className="auto-list">
          {item.trace.selection.map((t, n) => (
            <li key={`${t.code}-${n}`} className="small">
              <Pill tone={BASIS_TONES[t.basis]}>{BASIS_LABELS[t.basis]}</Pill> {t.detail}
              {t.ruleId && <span className="muted"> ({t.ruleId})</span>}
            </li>
          ))}
        </ul>
        {item.trace.params.length > 0 && (
          <div className="execution-scroll">
            <table className="execution-table">
              <thead>
                <tr>
                  <th scope="col">Valor</th>
                  <th scope="col">Proposto</th>
                  <th scope="col">Base</th>
                </tr>
              </thead>
              <tbody>
                {item.trace.params.map((p, n) => (
                  <tr key={`${p.param}-${n}`}>
                    <th scope="row">{traceParamLabel(p.param)}</th>
                    <td>{traceValue(p.value, p.param)}</td>
                    <td>
                      {BASIS_LABELS[p.basis]}
                      {p.ruleId ? ` (${p.ruleId})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
      {!preserved && (
        <div className="exercise-actions">
          <button type="button" className="button secondary small" disabled={pending} onClick={onSubstitute} aria-label={`Substituir ${item.exerciseName}`}>
            <Repeat size={15} aria-hidden="true" /> Substituir
          </button>
          <button type="button" className="button secondary small" disabled={pending} onClick={() => onLock(!locked)} aria-label={`${locked ? "Destravar" : "Manter"} ${item.exerciseName}`}>
            {locked ? <Unlock size={15} aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />} {locked ? "Destravar" : "Manter"}
          </button>
          {!locked && (
            <button type="button" className="button secondary small" disabled={pending} onClick={onAnother} aria-label={`Trocar ${item.exerciseName} por outro`}>
              <Shuffle size={15} aria-hidden="true" /> Trocar por outro
            </button>
          )}
        </div>
      )}
    </li>
  );
}
