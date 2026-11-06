"use client";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Notice } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import type { Flag, FlagDecision, OccurrenceOut, RegenerationScope } from "@/modules/prescricao/motor/types";
import type { ProposalSummary } from "@/db/prescription-proposals";
import type { TargetSuggestion } from "@/modules/prescricao/motor/targets";
import { STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";
import { formatCalendarDate, workoutTitle } from "@/modules/training/format";
import {
  acceptFlagDecision,
  continueProposal,
  discardProposal,
  lockItems,
  rebaseProposal,
  regenerateScope,
  type ProposalActionResult,
} from "./actions";
import { AlertsTab } from "./alerts-tab";
import { ApplyPanel, type ApplyView } from "./apply-panel";
import { AuditPanel } from "./audit-panel";
import { ExercisePanel } from "./exercise-panel";
import { ReplanDialog } from "./replan-dialog";
import {
  phoneReviewCards,
  reviewHeading,
  reviewStage,
  rowPatternLabel,
  rowTitle,
  sessionFocusChip,
  sessionTitle,
  whyCards,
  workoutFocus,
} from "./review-view";
import { ReferenceTab } from "./reference-tab";
import { SubstituteDialog, type LibraryEntry, type SubstituteTarget } from "./substitute-dialog";
import { suggestionAnchor } from "./target-suggestions";
import { NETWORK_ERROR, useIntent } from "./use-intent";
import {
  BASIS_LABELS,
  NOT_UNIVERSAL,
  PROGRESSION_MODEL_LABELS,
  PROPOSAL_ORIGIN_LABELS,
  METADATA_LABELS,
  contributionView,
  itemWhy,
  durationText,
  labelsOf,
  proposalProgression,
  weekTableAudit,
  weekVolume,
  type AuditSource,
  type CoverageAnswer,
  type WorkoutCoverageAnswer,
} from "./view";
import {
  alertRows,
  pickItemKey,
  pickSlot,
  sessionPillLabel,
  sessionPillShort,
  sessionsPerPhase,
  totalWeeks,
  type AlertFilter,
  type RxTab,
} from "./workbench";

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

const VALIDATION: Record<ProposalHeaderView["validation"], string> = {
  PASSED: "Sem avisos",
  WARNINGS: "Com avisos",
  BLOCKED: "Com impedimentos",
};

export interface ProposalViewProps {
  planId: string;
  revisionId: string;
  selfHref: string;
  revisionHref: string;
  studentHref: string;
  /** "XINTUS / HIPERTROFIA AB / 12 SEMANAS / REV. 1": the student, the plan and the revision, as the page knows them. */
  crumb: { student: string; plan: string; revision: number };
  header: ProposalHeaderView;
  summary: ProposalSummary;
  occurrences: OccurrenceOut[];
  phaseIndex: number;
  week: number;
  /** From the address: the tab, the session (slot) and the item (slot key) to restore. */
  initial: { tab: RxTab; slot?: string; item?: string };
  library: LibraryEntry[];
  /** The plan audit: recorded with the proposal, or computed now for one generated before it; null when there is none. */
  audit: AuditSource | null;
  /** Whether the proposal's own rule set can back an accepted suggestion (design V3 §3.9). */
  acceptSuggestions: boolean;
  /** Suggested targets of the phases the audit says have none (computed by the server for this proposal's rules). */
  targetSuggestions?: Array<{ phaseIndex: number; suggestion: TargetSuggestion | null; reason: string | null }>;
  /** What "Aplicar ao rascunho" would write (null when the server could not preview it). */
  apply: ApplyView | null;
  /**
   * Set when the proposal was generated from an accepted strategy: the review then shows each workout's focus, the "Por quê?" cards and
   * "Rever estratégia". `name` is the strategy's display name (null when the proposal cites several); `adherenceMin` is the audit rule's
   * minimum adherence; `patterns` maps an exercise to its movement patterns (from the library). Null for a proposal without a strategy.
   */
  strategy?: { name: string | null; adherenceMin: number | null; patterns: Record<string, string[]> } | null;
}

/** The workbench is rebuilt when the phase changes (its data comes from the server per phase); everything else is state. */
export function ProposalView(props: ProposalViewProps) {
  return <Workbench key={props.phaseIndex} {...props} />;
}

type Detail = Record<RxTab, boolean>;
const WIDE_QUERY = "(min-width: 861px)";

/**
 * The proposal as a workbench (Figma RX-01..RX-11, design §6.1 `proposal-view`): the status and the real counts on top; the tabs
 * Sessões, Alertas, Premissas and Regras; Fase → Semana → Sessão navigation without leaving the page (the address keeps the
 * selection: `fase`, `semana`, `sessao`, `item`, `aba`); the exercises of the session as a table with the selected one's panel
 * (dose, origin, "Por quê?", Manter / Substituir / Trocar); the persistent bar to apply to the draft. Every capability of the
 * proposal stays reachable: regenerate (session, week, workout, phase, from the phase on), the plan audit and its suggested
 * targets, the weekly volume and the progression, the alert decisions, rebase, discard and continue. No dose is edited here.
 */
function Workbench({ planId, revisionId, selfHref, revisionHref, studentHref, crumb, header, summary, occurrences, phaseIndex, week: initialWeek, initial, library, audit, acceptSuggestions, targetSuggestions = [], apply, strategy = null }: ProposalViewProps) {
  const router = useRouter();
  const intent = useIntent();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "notice"; text: string } | null>(null);
  const [substituting, setSubstituting] = useState<SubstituteTarget | null>(null);
  const [menu, setMenu] = useState(false);
  const [replanOpen, setReplanOpen] = useState(false);
  const menuTitle = useId();
  const [tab, setTab] = useState<RxTab>(initial.tab);
  const [week, setWeek] = useState(initialWeek);
  const [slotChoice, setSlotChoice] = useState<number | null>(() => pickSlot(occurrences, initialWeek, initial.slot));
  const [itemChoice, setItemChoice] = useState<string | undefined>(initial.item);
  const [alertKey, setAlertKey] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState<AlertFilter>({ kind: "ALL" });
  const [alertQuery, setAlertQuery] = useState("");
  const [premKey, setPremKey] = useState<string | null>(null);
  const [ruleKey, setRuleKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>({ sessoes: false, alertas: false, premissas: false, regras: false });
  const scrollMemo = useRef<Partial<Record<RxTab, number>>>({});
  const opener = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<HTMLDivElement>(null);

  const phase = summary.phases.find((p) => p.phaseIndex === phaseIndex)!;
  const stale = header.contentVersion !== header.baseContentVersion;
  const missing = summary.phases.filter((p) => !header.phasesGenerated.includes(p.phaseIndex)).length;
  const href = (p: number, w?: number) => `${selfHref}?fase=${p}${w ? `&semana=${w}` : ""}`;
  const ofWeek = useMemo(() => occurrences.filter((o) => o.week === week).sort((a, b) => a.slot - b.slot), [occurrences, week]);
  const slot = pickSlot(occurrences, week, slotChoice ?? undefined);
  const session = ofWeek.find((o) => o.slot === slot) ?? null;
  const itemKey = session ? pickItemKey(session.items, itemChoice) : null;
  const itemIndex = session && itemKey ? session.items.findIndex((i) => i.slotKey === itemKey) : -1;
  const item = session && itemIndex >= 0 ? session.items[itemIndex]! : null;
  const labels = labelsOf(occurrences, phaseIndex);
  const lockedKeys = new Set(occurrences.flatMap((o) => o.items.filter((i) => i.origin === "LOCKED").map((i) => i.slotKey)));
  const cas = { proposalId: header.id, expectedVersion: header.version };
  const rows = useMemo(() => alertRows(summary.flags, summary.issues), [summary.flags, summary.issues]);
  const alertSelected = rows.find((r) => r.key === alertKey)?.key ?? rows[0]?.key ?? null;
  const premSelected = summary.assumptions.find((a) => a.code === premKey)?.code ?? summary.assumptions[0]?.code ?? null;
  const ruleSelected = summary.rulesUsed.find((r) => r.ruleId === ruleKey)?.ruleId ?? summary.rulesUsed[0]?.ruleId ?? null;
  const experienceUnknown = summary.assumptions.some((a) => a.code === "EXPERIENCE_UNKNOWN");
  const cardFor = new Set(acceptSuggestions && audit?.source === "STORED" ? targetSuggestions.map((t) => t.phaseIndex) : []);
  const perPhase = sessionsPerPhase(summary.phases);
  const withStrategy = strategy !== null;
  const heading = reviewHeading(withStrategy, { student: crumb.student, strategyName: strategy?.name ?? null, weeks: totalWeeks(summary.phases) });
  const stage = reviewStage({ complete: header.complete, audited: audit !== null });
  const workoutOf = (label: string) => summary.workouts.find((w) => w.phaseIndex === phaseIndex && w.label === label) ?? null;
  const sessionWorkout = session ? workoutOf(session.label) : null;
  const focusChip = withStrategy && session ? sessionFocusChip(audit?.report.strategy, phaseIndex, session.label, session.week, strategy.adherenceMin) : null;
  const auditWord = withStrategy ? "Auditoria" : "Alertas";

  // The address keeps the selection (tab, phase, week, session and item) without a request: only the query string changes.
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("fase", String(phaseIndex));
    q.set("semana", String(week));
    if (slot !== null) q.set("sessao", String(slot));
    if (itemKey) q.set("item", itemKey);
    if (tab !== "sessoes") q.set("aba", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}${window.location.hash}`);
  }, [phaseIndex, week, slot, itemKey, tab]);

  // A link to the suggested targets (`#alvos-sugeridos-fase-N`) lands on the audit, which lives in the alerts tab.
  useEffect(() => {
    if (window.location.hash.startsWith(`#${suggestionAnchor(0).slice(0, -1)}`)) showTargets(Number(window.location.hash.split("-").pop()));
  }, []);

  function showTargets(p: number) {
    setTab("alertas");
    window.setTimeout(() => document.getElementById(suggestionAnchor(p))?.scrollIntoView({ block: "center" }), 0);
  }

  const wide = () => window.matchMedia(WIDE_QUERY).matches;
  /** On a phone the record is a screen of its own (the list is kept, with its scroll); on a wide screen it is always beside the list. */
  function openDetail(t: RxTab) {
    if (wide()) return;
    scrollMemo.current[t] = window.scrollY;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetail((d) => ({ ...d, [t]: true }));
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  }
  function closeDetail(t: RxTab) {
    setDetail((d) => ({ ...d, [t]: false }));
    if (!wide())
      window.requestAnimationFrame(() => {
        window.scrollTo(0, scrollMemo.current[t] ?? 0);
        opener.current?.focus({ preventScroll: true });
      });
  }
  function chooseTab(next: RxTab) {
    setTab(next);
    setDetail({ sessoes: false, alertas: false, premissas: false, regras: false });
  }
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const tabs = [...(tabRefs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])].filter((t) => t.offsetParent !== null);
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const to = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (at + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[to]!.focus();
    tabs[to]!.click();
  }

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
  const regenerate = (scope: RegenerationScope, what: string) => {
    setMenu(false);
    run(`regen:${what}`, (ids) => regenerateScope(planId, revisionId, { ...cas, idempotencyKey: ids.key, writeId: ids.write, scope }));
  };
  const lock = (key: string, locked: boolean) =>
    run(`lock:${key}:${locked}`, (ids) => lockItems(planId, revisionId, { ...cas, writeId: ids.write, targets: [{ phaseIndex, slotKey: key }], locked }));
  /** Targets of a phase accepted or set on the card: the phase is regenerated with them (merged by phase into the answers). */
  const setTargets = (p: number, coverage: CoverageAnswer | null, byWorkout: WorkoutCoverageAnswer[]) =>
    run(`targets:${p}:${JSON.stringify([coverage, byWorkout])}`, (ids) =>
      regenerateScope(planId, revisionId, {
        ...cas,
        idempotencyKey: ids.key,
        writeId: ids.write,
        scope: { kind: "PHASE", phaseIndex: p },
        answers: { ...(coverage ? { phaseCoverage: [coverage] } : {}), ...(byWorkout.length ? { coverageByWorkout: byWorkout } : {}) },
      }),
    );
  const decide = (flag: Flag, decision: FlagDecision) =>
    run(`flag:${flag.code}:${decision.kind}`, (ids) => acceptFlagDecision(planId, revisionId, { ...cas, writeId: ids.write, flagCode: flag.code, decision }));

  function pickWeekAndSession(w: number) {
    setWeek(w);
    const first = pickSlot(occurrences, w, undefined);
    setSlotChoice(first);
    setItemChoice(undefined);
  }
  function goTo(p: number, w: number) {
    if (p === phaseIndex) {
      pickWeekAndSession(w);
      chooseTab("sessoes");
    } else router.push(href(p, w), { scroll: false });
  }
  const tabId = (t: RxTab) => `rx-tab-${t}`;
  const panelId = (t: RxTab) => `rx-panel-${t}`;
  const reviewCount = rows.length;
  const screen = detail[tab] ? "detail" : "list";
  const phaseName = (p: { phaseIndex: number }) => String(p.phaseIndex).padStart(2, "0");

  const tabs: Array<{ t: RxTab; text: string; short: string }> = [
    { t: "sessoes", text: "Sessões", short: "Sessões" },
    { t: "alertas", text: `${auditWord} (${reviewCount})`, short: `${auditWord} · ${reviewCount}` },
    { t: "premissas", text: `Premissas (${summary.assumptions.length})`, short: "Dados" },
    { t: "regras", text: `Regras (${summary.rulesUsed.length})`, short: "Dados" },
  ];

  const footerBack = (title: string, text: string, label = "Voltar às sessões") => ({ title, text, label, onBack: () => chooseTab("sessoes") });
  const footerDetail = (text: string, label: string) => ({ title: "", text, label, onBack: () => closeDetail(tab) });

  return (
    <div className="rx" data-tab={tab} data-screen={screen}>
      <header className="rx-heading rx-top">
        <p className="rx-crumb">
          {[crumb.student, crumb.plan, `${totalWeeks(summary.phases)} semanas`, `Rev. ${crumb.revision}`].join("  /  ")}
        </p>
        <div className="rx-heading-row">
          <div>
            <h1>
              <span className="rx-desktop">{heading.title}</span>
              <span className="rx-mobile">{heading.phoneTitle}</span>
            </h1>
            <p className="rx-sub rx-desktop">{heading.sub}</p>
            <p className="rx-sub rx-mobile">{withStrategy ? heading.phoneSub : `${crumb.student} • ${crumb.plan} • ${totalWeeks(summary.phases)} semanas`}</p>
          </div>
          <Link href={revisionHref} className="rx-btn rx-btn-line rx-desktop">
            Voltar à revisão
          </Link>
        </div>
      </header>

      <section className="rx-card rx-summary rx-top" aria-label="Resumo da proposta">
        <div className="rx-summary-main">
          <span className="rx-chip rx-chip-brand rx-chip-upper">
            <span className="rx-desktop">Proposta • para revisão</span>
            <span className="rx-mobile">Para revisão</span>
          </span>
          <span className={stage.tone === "brand" ? "rx-chip rx-chip-line rx-chip-upper" : "rx-chip rx-chip-warning rx-chip-upper"} data-stage={stage.id} title={stage.note ?? undefined}>
            {stage.label}
          </span>
          <ul className="rx-metrics">
            <li className="rx-desktop">
              <strong>
                {header.phasesGenerated.length} / {summary.phases.length}
              </strong>{" "}
              {summary.phases.length === 1 ? "fase" : "fases"}
            </li>
            {perPhase !== null && (
              <li className="rx-desktop">
                <strong>{perPhase}</strong> sessões/fase
              </li>
            )}
            {apply && (
              <li className="rx-total">
                <strong>{apply.counts.occurrences}</strong> {apply.counts.occurrences === 1 ? "sessão" : "sessões"}
              </li>
            )}
            {apply && (
              <li className="rx-desktop">
                <strong>{apply.counts.rows}</strong> {apply.counts.rows === 1 ? "exercício novo" : "exercícios novos"}
              </li>
            )}
          </ul>
          <span className={reviewCount > 0 ? "rx-chip rx-chip-warning rx-desktop" : "rx-chip rx-chip-line rx-desktop"}>
            {reviewCount} {reviewCount === 1 ? "alerta" : "alertas"}
          </span>
        </div>
        <p className="rx-sub rx-mobile">
          {header.phasesGenerated.length} de {summary.phases.length} {summary.phases.length === 1 ? "fase" : "fases"}
          {apply ? ` · ${apply.counts.rows} ${apply.counts.rows === 1 ? "exercício novo" : "exercícios novos"}` : ""} · {reviewCount} {reviewCount === 1 ? "alerta" : "alertas"}
        </p>
        <p className="rx-sub proposal-pills">
          <span className="rx-chip rx-chip-brand">Versão {header.version}</span>
          <span className={header.status === "INFEASIBLE" ? "rx-chip rx-chip-danger" : "rx-chip rx-chip-line"}>
            {header.status === "INFEASIBLE" ? "Inviável como está" : "Gerada"} · {VALIDATION[header.validation]}
          </span>
          <span>
            Visualização geral • itens propostos ainda dependem de decisão profissional. Motor {header.engineVersion} · regras {header.rulesId} {header.rulesVersion}
            {audit ? ` · auditoria ${audit.report.auditVersion}${audit.source === "VIEW" ? " (calculada agora)" : ""}` : ""}. {NOT_UNIVERSAL}
          </span>
        </p>
      </section>

      {stale && (
        <Notice tone="warning">
          <div>
            <p>
              <strong>O rascunho mudou desde a geração.</strong> Atualize a proposta com o rascunho atual (as linhas que estão lá são mantidas) ou descarte e gere de novo.
            </p>
            <div className="exercise-actions">
              <button
                type="button"
                className="rx-btn rx-btn-line"
                disabled={pending}
                onClick={() => run("rebase", (ids) => rebaseProposal(planId, revisionId, { ...cas, idempotencyKey: ids.key, writeId: ids.write }))}
              >
                Atualizar com o rascunho atual
              </button>
              <button type="button" className="rx-btn rx-btn-danger" disabled={pending} onClick={() => run("discard", (ids) => discardProposal(planId, revisionId, { ...cas, writeId: ids.write }))}>
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
              className="rx-btn rx-btn-line"
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

      <div className="rx-card rx-tabs rx-top" role="tablist" aria-label="Revisão da proposta" ref={tabRefs} onKeyDown={onTabKey}>
        {tabs.map(({ t, text, short }) => {
          const selected = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              id={tabId(t)}
              aria-selected={selected}
              aria-controls={panelId(t)}
              tabIndex={selected ? 0 : -1}
              className={`${selected ? "rx-pillbtn selected" : "rx-pillbtn"}${t === "premissas" || t === "regras" ? " rx-desktop" : ""}`}
              onClick={() => chooseTab(t)}
            >
              <span className="rx-desktop">{text}</span>
              {t !== "premissas" && t !== "regras" && <span className="rx-mobile">{short}</span>}
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          id="rx-tab-dados"
          aria-selected={tab === "premissas" || tab === "regras"}
          aria-controls={panelId("premissas")}
          tabIndex={tab === "premissas" || tab === "regras" ? 0 : -1}
          className={tab === "premissas" || tab === "regras" ? "rx-pillbtn selected rx-mobile" : "rx-pillbtn rx-mobile"}
          onClick={() => chooseTab("premissas")}
        >
          Dados
        </button>
        <span className="rx-sub rx-tabs-hint rx-desktop">Ver informações completas ao selecionar uma aba</span>
      </div>

      <div role="tabpanel" id={panelId("sessoes")} aria-labelledby={tabId("sessoes")} hidden={tab !== "sessoes"} className="rx-tabpanel">
        <div className="rx-card rx-phasebar rx-top" aria-label="Fase e semana">
          <div className="rx-navgroup rx-desktop">
            <span className="rx-label">Fase</span>
            <nav className="rx-chips" aria-label="Fases da proposta">
              {summary.phases.map((p) =>
                header.phasesGenerated.includes(p.phaseIndex) ? (
                  <Link
                    key={p.phaseIndex}
                    href={`${href(p.phaseIndex)}`}
                    scroll={false}
                    className={p.phaseIndex === phaseIndex ? "rx-pillbtn selected" : "rx-pillbtn"}
                    aria-current={p.phaseIndex === phaseIndex ? "page" : undefined}
                    aria-label={`Fase ${phaseName(p)}${p.name ? `, ${p.name}` : ""}, ${p.weeks} ${p.weeks === 1 ? "semana" : "semanas"}`}
                  >
                    {phaseName(p)}
                    {p.phaseIndex === phaseIndex ? ` · ${p.weeks} sem.` : ""}
                  </Link>
                ) : (
                  <span key={p.phaseIndex} className="rx-pillbtn disabled" aria-disabled="true">
                    {phaseName(p)} (não gerada)
                  </span>
                ),
              )}
            </nav>
            <span className="rx-sep" aria-hidden="true" />
            <span className="rx-label">Semana</span>
            <nav className="rx-chips" aria-label={`Semanas da fase ${phaseIndex}`}>
              {Array.from({ length: phase.weeks }, (_, n) => n + 1).map((w) => (
                <Link
                  key={w}
                  href={href(phaseIndex, w)}
                  scroll={false}
                  className={w === week ? "rx-pillbtn selected soft" : "rx-pillbtn"}
                  aria-current={w === week ? "page" : undefined}
                  aria-label={`Semana ${w}`}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                    event.preventDefault();
                    pickWeekAndSession(w);
                  }}
                >
                  {String(w).padStart(2, "0")}
                </Link>
              ))}
            </nav>
          </div>
          <div className="rx-selects rx-mobile">
            <label>
              <span className="sr-only">Fase</span>
              <select value={phaseIndex} aria-label="Fase" onChange={(e) => router.push(href(Number(e.target.value)), { scroll: false })}>
                {summary.phases.map((p) => (
                  <option key={p.phaseIndex} value={p.phaseIndex} disabled={!header.phasesGenerated.includes(p.phaseIndex)}>
                    Fase {phaseName(p)}
                    {header.phasesGenerated.includes(p.phaseIndex) ? "" : " (não gerada)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Semana</span>
              <select value={week} aria-label="Semana" onChange={(e) => pickWeekAndSession(Number(e.target.value))}>
                {Array.from({ length: phase.weeks }, (_, n) => n + 1).map((w) => (
                  <option key={w} value={w}>
                    Semana {String(w).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <span className="rx-sub rx-desktop">
            {phase.sessionsPerWeek} {phase.sessionsPerWeek === 1 ? "sessão" : "sessões"} por semana ·{" "}
            {phase.progression
              ? `progressão: ${PROGRESSION_MODEL_LABELS[phase.progression.value.model] ?? phase.progression.value.model} (${BASIS_LABELS[phase.progression.basis]})`
              : "sem progressão semanal"}
          </span>
        </div>

        <div className="rx-split" data-detail={detail.sessoes ? "open" : "closed"}>
          <section className="rx-card rx-list rx-sessions" aria-labelledby="rx-semana-titulo">
            <header className="rx-card-head rx-card-head-row">
              <div>
                <h2 id="rx-semana-titulo" className="rx-desktop">
                  Semana {week}
                </h2>
                <h2 className="rx-mobile rx-h-mobile">Sessões da semana</h2>
                <p className="rx-sub rx-desktop">Escolha uma sessão para revisar seus exercícios</p>
                <p className="rx-sub rx-mobile">
                  {ofWeek.length} {ofWeek.length === 1 ? "sessão" : "sessões"}
                </p>
              </div>
              <div className="rx-head-actions">
                <button
                  type="button"
                  className="rx-btn rx-btn-line rx-desktop"
                  disabled={pending}
                  onClick={() => regenerate({ kind: "WEEK", phaseIndex, week }, `week:${phaseIndex}:${week}`)}
                >
                  Regenerar semana
                </button>
                <button type="button" className="rx-btn rx-btn-line" onClick={() => setMenu(true)} aria-haspopup="dialog">
                  Mais ações
                </button>
              </div>
            </header>
            {ofWeek.length === 0 ? (
              <p className="rx-empty">Nenhuma sessão nesta semana.</p>
            ) : (
              <>
                <nav className="rx-chips rx-sessionpills" aria-label={`Sessões da semana ${week}`}>
                  {ofWeek.map((o) => (
                    <button
                      key={o.slot}
                      type="button"
                      className={o.slot === slot ? "rx-pillbtn selected" : "rx-pillbtn"}
                      aria-current={o.slot === slot ? "true" : undefined}
                      onClick={() => {
                        setSlotChoice(o.slot);
                        setItemChoice(undefined);
                      }}
                    >
                      <span className="rx-desktop">{sessionPillLabel(o)}</span>
                      <span className="rx-mobile">{sessionPillShort(o)}</span>
                    </button>
                  ))}
                </nav>
                {session && (
                  <section id={`sessao-${session.week}-${session.slot}`} aria-label={`Semana ${session.week}, sessão ${session.slot}, treino ${session.label}`} className="rx-session">
                    <p className="rx-sessionmeta">
                      <span className="rx-label rx-mobile">
                        {withStrategy ? sessionTitle(session.label, sessionWorkout) : workoutTitle(session.label, sessionWorkout?.name ?? null)}
                      </span>
                      <span className="rx-label rx-mobile">
                        {session.items.length} {session.items.length === 1 ? "exercício" : "exercícios"}
                      </span>
                      <span className="rx-desktop rx-sub">
                        {withStrategy ? sessionTitle(session.label, sessionWorkout) : workoutTitle(session.label, sessionWorkout?.name ?? null)}
                        {session.plannedDate ? ` · ${formatCalendarDate(session.plannedDate)}` : ""}
                        {durationText(session) ? ` · ${durationText(session)}` : ""}
                        {session.stimulus ? ` · ${STIMULUS_LABELS[session.stimulus.value] ?? session.stimulus.value}` : ""}
                      </span>
                    </p>
                    {withStrategy && (
                      <ul className="rx-phonecards rx-mobile" aria-label="Resumo do treino">
                        {phoneReviewCards({
                          workout: sessionWorkout,
                          chip: focusChip,
                          sessionsInWeek: ofWeek.filter((o) => o.label === session.label).length,
                          profileDoses: session.items.some((i) => i.trace.params.some((p) => p.profileId)),
                          audited: audit !== null,
                          durationText: durationText(session),
                        }).map((c) => (
                          <li key={c.id} className={c.highlighted ? "rx-why-card selected" : "rx-why-card"} data-phone-card={c.id}>
                            <h5>{c.title}</h5>
                            <p className="rx-why-lead">{c.line}</p>
                            <p className="rx-why-meta">{c.meta}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {focusChip && (
                      <p className="rx-focusrow">
                        <span className={focusChip.kind === "RESPECTED" ? "rx-chip rx-chip-brand" : "rx-chip rx-chip-warning"} data-focus-chip={focusChip.kind}>
                          {focusChip.kind === "RESPECTED" ? "✓ " : "! "}
                          {focusChip.text}
                        </span>
                        {focusChip.kind === "OFF_FOCUS" && (
                          <button type="button" className="link-button" onClick={() => chooseTab("alertas")}>
                            Ver na {auditWord.toLowerCase()}
                          </button>
                        )}
                      </p>
                    )}
                    {session.items.length === 0 ? (
                      <p className="rx-empty">Nenhum exercício nesta sessão.</p>
                    ) : (
                      <table className="rx-table rx-exercise-table">
                        <thead>
                          <tr>
                            <th scope="col">Exercício</th>
                            <th scope="col">Dosagem proposta</th>
                            <th scope="col">Origem</th>
                            <th scope="col">Ação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {session.items.map((it, n) => {
                            const on = it.slotKey === itemKey;
                            const meta = METADATA_LABELS[it.metadata];
                            const pattern = withStrategy ? rowPatternLabel(it.exerciseId ? strategy.patterns[it.exerciseId] : undefined, workoutFocus(sessionWorkout)?.patterns ?? []) : null;
                            return (
                              <tr key={it.slotKey} className={on ? "selected" : undefined} aria-current={on ? "true" : undefined}>
                                <td className="rx-cell-main">
                                  <div className="rx-cell-flex">
                                    <span className={on ? "rx-order on" : "rx-order"} aria-hidden="true">
                                      {n + 1}
                                    </span>
                                    <span className="rx-nametext">
                                      {pattern && <span className="rx-pattern">{pattern}</span>}
                                      <span className="rx-name">{it.exerciseName}</span>
                                    </span>
                                  </div>
                                </td>
                                <td className="rx-cell-dose">{it.display.doseText || "Dose em branco: você preenche depois de aplicar."}</td>
                                <td className="rx-cell-origin">
                                  <div className="rx-cell-flex rx-cell-wrap">
                                    <span className={it.origin === "ENGINE" ? "rx-chip rx-chip-line" : "rx-chip rx-chip-brand"}>{PROPOSAL_ORIGIN_LABELS[it.origin]}</span>
                                    {meta && <span className="rx-chip rx-chip-warning">{meta}</span>}
                                  </div>
                                </td>
                                <td className="rx-cell-action">
                                  <button
                                    type="button"
                                    className="rx-btn rx-btn-line rx-rowaction"
                                    aria-label={withStrategy ? `Por quê? ${rowTitle(n + 1, it.exerciseName, pattern)}` : `Revisar ${it.exerciseName}`}
                                    onClick={() => {
                                      setItemChoice(it.slotKey);
                                      openDetail("sessoes");
                                    }}
                                  >
                                    <span className="rx-desktop">{withStrategy ? "Por quê?" : "Revisar"}</span>
                                    <ChevronRight size={16} aria-hidden="true" className="rx-chevron" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </section>
                )}
                <WeekVolume rows={weekVolume(summary.volume ?? [], phaseIndex, week, weekTableAudit(audit))} week={week} audited={weekTableAudit(audit) !== null} />
                {phase.weeks > 1 &&
                  labels.map((label) => {
                    const prows = proposalProgression(occurrences, phaseIndex, phase.weeks, label);
                    if (!prows.length) return null;
                    return (
                      <details key={label} className="progression-details">
                        <summary>Progressão nesta fase · Treino {label}</summary>
                        <p className="small muted">
                          Dose da primeira sessão do treino em cada semana. “—”: fora das sessões dessa semana.
                          <span className="scroll-hint"> Deslize a tabela para o lado para ver todas as semanas.</span>
                        </p>
                        <div className="execution-scroll" tabIndex={0} role="region" aria-label={`Progressão do treino ${label}, rolável para o lado`}>
                          <table className="execution-table">
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
                              {prows.map((row) => (
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
              </>
            )}
          </section>
          {session && item ? (
            <ExercisePanel
              item={item}
              position={itemIndex + 1}
              total={session.items.length}
              occurrence={session}
              week={week}
              phaseIndex={phaseIndex}
              experienceUnknown={experienceUnknown}
              contribution={contributionView(item, audit?.report ?? null, phaseIndex, session.week)}
              doseWhy={itemWhy(item, sessionWorkout, audit?.report ?? null, { rulesUsed: summary.rulesUsed, phaseIndex })}
              whyCards={
                withStrategy
                  ? whyCards({
                      why: itemWhy(item, sessionWorkout, audit?.report ?? null, { rulesUsed: summary.rulesUsed, phaseIndex }),
                      workout: sessionWorkout,
                      session: { phaseIndex, week: session.week, slot: session.slot, label: session.label },
                      weekSlots: ofWeek.filter((o) => o.label === session.label).map((o) => o.slot),
                      sessionsPerWeek: phase.sessionsPerWeek,
                      volume: summary.volume ?? [],
                      strategy: audit?.report.strategy,
                      adherenceMin: strategy.adherenceMin,
                    })
                  : undefined
              }
              suggestions={summary.historySuggestions ?? []}
              rulesUsed={summary.rulesUsed}
              locked={lockedKeys.has(item.slotKey) || item.origin === "LOCKED"}
              pending={pending}
              onBack={() => closeDetail("sessoes")}
              onSubstitute={() =>
                setSubstituting({ phaseIndex, slotKey: item.slotKey, week: session.week, slot: session.slot, label: session.label, exerciseId: item.exerciseId, name: item.exerciseName, phaseWeeks: phase.weeks })
              }
              onLock={(locked) => lock(item.slotKey, locked)}
              onAnother={() =>
                regenerate({ kind: "ITEM", phaseIndex, week: session.week, slot: session.slot, slotKey: item.slotKey }, `item:${session.week}:${session.slot}:${item.slotKey}`)
              }
            />
          ) : (
            <aside className="rx-card rx-panel">
              <p className="rx-empty">Selecione um exercício para ver o detalhe.</p>
            </aside>
          )}
        </div>
      </div>

      <div role="tabpanel" id={panelId("alertas")} aria-labelledby={tabId("alertas")} hidden={tab !== "alertas"} className="rx-tabpanel">
        <AlertsTab
          rows={rows}
          selectedKey={alertSelected}
          onSelect={(key) => {
            setAlertKey(key);
            openDetail("alertas");
          }}
          detailOpen={detail.alertas}
          onBack={() => closeDetail("alertas")}
          onBackToSessions={() => chooseTab("sessoes")}
          filter={alertFilter}
          onFilter={setAlertFilter}
          query={alertQuery}
          onQuery={setAlertQuery}
          pending={pending}
          studentHref={studentHref}
          suggestedPhases={cardFor}
          onDecide={decide}
          onGoToWeek={goTo}
          onShowTargets={showTargets}
        >
          {audit && (
            <AuditPanel
              audit={audit}
              engineVersion={header.engineVersion}
              acceptSuggestions={acceptSuggestions}
              phaseIndex={phaseIndex}
              adherenceMin={strategy?.adherenceMin ?? null}
              href={href}
              targets={{
                suggestions: targetSuggestions,
                labelsOf: (p: number) => summary.workouts.filter((w) => w.phaseIndex === p).map((w) => w.label),
                pending,
                onAccept: (entry) => setTargets(entry.phaseIndex, entry, []),
                onApply: setTargets,
              }}
            />
          )}
        </AlertsTab>
      </div>

      {(["premissas", "regras"] as const).map((kind) => (
        <div key={kind} role="tabpanel" id={panelId(kind)} aria-labelledby={tabId(kind)} hidden={tab !== kind} className="rx-tabpanel">
          <ReferenceTab
            kind={kind}
            onKind={(k) => chooseTab(k)}
            assumptions={summary.assumptions}
            rules={summary.rulesUsed}
            selectedKey={kind === "premissas" ? premSelected : ruleSelected}
            onSelect={(key) => {
              if (kind === "premissas") setPremKey(key);
              else setRuleKey(key);
              openDetail(kind);
            }}
            detailOpen={detail[kind]}
            onBack={() => closeDetail(kind)}
            onBackToSessions={() => chooseTab("sessoes")}
          />
        </div>
      ))}

      <ApplyPanel
        planId={planId}
        revisionId={revisionId}
        proposalId={header.id}
        version={header.version}
        apply={apply ? { ...apply, stale } : null}
        strategy={withStrategy}
        onReviewStrategy={withStrategy ? () => setReplanOpen(true) : undefined}
        back={
          detail[tab]
            ? tab === "sessoes"
              ? footerDetail("Alterações individuais não publicam a proposta.", "Voltar às sessões")
              : tab === "alertas"
                ? footerDetail("A validação não equivale à liberação médica.", "Voltar aos alertas")
                : footerDetail("Conteúdo e contagens vêm da geração atual.", "Voltar à lista")
            : tab === "alertas"
              ? footerBack("Revisar registros por prioridade", "Informações não precisam ocupar a grade de exercícios.")
              : tab === "premissas" || tab === "regras"
                ? footerBack("Leitura somente", "Conteúdo e contagens vêm da geração atual.")
                : undefined
        }
      />

      <Sheet open={menu} onClose={() => setMenu(false)} titleId={menuTitle} variant="menu" busy={pending}>
        <h2 id={menuTitle} className="sheet-title">
          Mais ações
        </h2>
        <ul className="sheet-actions">
          {session && (
            <li>
              <button
                type="button"
                className="sheet-action"
                disabled={pending}
                onClick={() => regenerate({ kind: "OCCURRENCE", phaseIndex, week: session.week, slot: session.slot }, `occ:${phaseIndex}:${session.week}:${session.slot}`)}
              >
                <strong>Regenerar esta sessão</strong>
                <span className="small muted">
                  Semana {session.week}, sessão {session.slot} · mantidos, travados e trocados por você continuam.
                </span>
              </button>
            </li>
          )}
          <li>
            <button type="button" className="sheet-action" disabled={pending} onClick={() => regenerate({ kind: "WEEK", phaseIndex, week }, `week:${phaseIndex}:${week}`)}>
              <strong>Regenerar a semana {week}</strong>
            </button>
          </li>
          {labels.map((label) => (
            <li key={label}>
              <button
                type="button"
                className="sheet-action"
                disabled={pending}
                onClick={() => regenerate({ kind: "WORKOUT", phaseIndex, label, ...(week > 1 ? { fromWeek: week } : {}) }, `workout:${phaseIndex}:${label}:${week}`)}
              >
                <strong>
                  Regenerar o treino {label}
                  {week > 1 ? ` a partir da semana ${week}` : ""}
                </strong>
              </button>
            </li>
          ))}
          {withStrategy && (
            <li>
              <button
                type="button"
                className="sheet-action"
                disabled={pending}
                onClick={() => {
                  setMenu(false);
                  setReplanOpen(true);
                }}
              >
                <strong>Rever estratégia</strong>
                <span className="small muted">Volta à escolha da estratégia; mostra o que é mantido antes de refazer.</span>
              </button>
            </li>
          )}
          <li>
            <button type="button" className="sheet-action" disabled={pending} onClick={() => regenerate({ kind: "PHASE", phaseIndex }, `phase:${phaseIndex}`)}>
              <strong>Regenerar a fase {phaseIndex}</strong>
            </button>
          </li>
          {summary.phases.some((p) => p.phaseIndex > phaseIndex) && (
            <li>
              <button type="button" className="sheet-action" disabled={pending} onClick={() => regenerate({ kind: "FROM_PHASE", phaseIndex }, `from:${phaseIndex}`)}>
                <strong>Regenerar desta fase em diante</strong>
              </button>
            </li>
          )}
        </ul>
        <div className="sheet-footer">
          <button type="button" className="button secondary" onClick={() => setMenu(false)}>
            Fechar
          </button>
        </div>
      </Sheet>

      {withStrategy && (
        <ReplanDialog
          open={replanOpen}
          onClose={() => setReplanOpen(false)}
          planId={planId}
          revisionId={revisionId}
          proposalId={header.id}
          selfHref={selfHref}
          phaseIndex={phaseIndex}
          hasLaterPhase={summary.phases.some((p) => p.phaseIndex > phaseIndex)}
        />
      )}

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
    </div>
  );
}

/** Weekly sets per muscle of the selected week (engine volume: direct = principal muscle, indirect = secondary). */
function WeekVolume({ rows, week, audited }: { rows: ReturnType<typeof weekVolume>; week: number; audited: boolean }) {
  if (!rows.length) return null;
  return (
    <details className="progression-details">
      <summary>Volume semanal por músculo · Semana {week}</summary>
      <p className="small muted">
        Séries da semana: diretas (músculo principal) e indiretas (secundário); a ponderada soma as indiretas pelo fator da regra. Conta só doses com séries. É informação para a sua revisão, não
        meta.
        <span className="scroll-hint"> Deslize a tabela para o lado para ver todas as colunas.</span>
      </p>
      <div className="execution-scroll" tabIndex={0} role="region" aria-label={`Volume da semana ${week}, rolável para o lado`}>
        <table className="execution-table">
          <thead>
            <tr>
              <th scope="col">Músculo</th>
              <th scope="col">Diretas</th>
              <th scope="col">Indiretas</th>
              <th scope="col">Ponderadas</th>
              <th scope="col">Sessões</th>
              {audited && <th scope="col">Sessões c/ estímulo direto</th>}
              {audited && <th scope="col">Alvo</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.muscle}>
                <th scope="row">{r.muscle}</th>
                <td>{r.direct}</td>
                <td>{r.indirect}</td>
                <td>{r.weighted}</td>
                <td>{r.sessions}</td>
                {audited && <td>{r.directSessions}</td>}
                {audited && <td>{r.target ?? "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
