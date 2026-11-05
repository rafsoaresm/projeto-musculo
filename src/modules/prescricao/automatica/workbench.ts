import type { Flag, Issue, OccurrenceOut, Severity } from "@/modules/prescricao/motor/types";
import { ISSUE_LABELS } from "@/modules/prescricao/motor/vocabulary";

/**
 * Pure rules of the proposal workbench (Figma RX-01..11): which tab, session and item are selected, and how the alerts (the
 * triage/assessment flags and the engine's issues) become one table. No React and no data of its own: everything comes from the
 * proposal, and an empty proposal gives empty lists, never a placeholder row.
 */

export type RxTab = "sessoes" | "alertas" | "premissas" | "regras";
export const RX_TABS: readonly RxTab[] = ["sessoes", "alertas", "premissas", "regras"];

/** The tab in the address (`aba`); the sessions when absent or unknown. */
export function pickTab(raw: string | undefined): RxTab {
  return RX_TABS.find((t) => t === raw) ?? "sessoes";
}

/** The session (slot) chosen in the address among the week's sessions: the first one when absent or not in the week. */
export function pickSlot(occurrences: readonly Pick<OccurrenceOut, "week" | "slot">[], week: number, raw: string | number | undefined): number | null {
  const slots = occurrences.filter((o) => o.week === week).map((o) => o.slot).sort((a, b) => a - b);
  const n = Number(raw);
  return slots.includes(n) ? n : (slots[0] ?? null);
}

/** The item chosen among a session's items: the first one when absent or not there. */
export function pickItemKey(items: readonly { slotKey: string }[], raw: string | undefined): string | null {
  return items.find((i) => i.slotKey === raw)?.slotKey ?? items[0]?.slotKey ?? null;
}

/** "Sessão 1 · Treino A" (desktop) and "S1 · A" (phone). */
export const sessionPillLabel = (o: Pick<OccurrenceOut, "slot" | "label">) => `Sessão ${o.slot} · Treino ${o.label}`;
export const sessionPillShort = (o: Pick<OccurrenceOut, "slot" | "label">) => `S${o.slot} · ${o.label}`;

/** Total weeks of the plan, from the phases the proposal carries. */
export const totalWeeks = (phases: readonly { weeks: number }[]) => phases.reduce((sum, p) => sum + p.weeks, 0);

/** Sessions per phase, only when the phases agree ("16"); otherwise null (the bar does not invent an average). */
export function sessionsPerPhase(phases: readonly { weeks: number; sessionsPerWeek: number }[]): number | null {
  const counts = [...new Set(phases.map((p) => p.weeks * p.sessionsPerWeek))];
  return counts.length === 1 ? counts[0]! : null;
}

// ---------- alerts ----------

export const FLAG_SOURCE_LABELS: Record<Flag["source"], string> = {
  SCREENING: "Triagem",
  ASSESSMENT: "Avaliação",
  ANAMNESIS: "Anamnese",
  HISTORY: "Histórico",
};
const FLAG_TITLES: Record<Flag["source"], string> = {
  SCREENING: "Alerta da triagem",
  ASSESSMENT: "Alerta da avaliação",
  ANAMNESIS: "Alerta da anamnese",
  HISTORY: "Alerta do histórico",
};

export type AlertFilter = { kind: "ALL" } | { kind: "REVIEW" } | { kind: "INFO" } | { kind: "PHASE"; phaseIndex: number };

export interface AlertRow {
  key: string;
  kind: "FLAG" | "ISSUE";
  severity: Severity;
  /** Needs the professional's look: an undecided flag that is not just information, or an issue that is not information. */
  needsReview: boolean;
  decided: boolean;
  /** Short title of the record (the issue's label, or the flag's source: the message is the body). */
  title: string;
  /** The record's own text. */
  message: string;
  origin: string;
  statusText: string;
  tone: "warning" | "danger" | "brand" | "neutral";
  phaseIndex: number | null;
  flag?: Flag;
  issue?: Issue;
}

const SEVERITY_RANK: Record<Severity, number> = { ERROR: 0, WARNING: 1, INFO: 2 };

/** The flags and the issues as one list, ordered by impact for the review (what needs a look first, information last). */
export function alertRows(flags: readonly Flag[], issues: readonly Issue[]): AlertRow[] {
  const rows: AlertRow[] = [
    ...flags.map((flag): AlertRow => {
      const needsReview = !flag.decided && flag.severity !== "INFO";
      return {
        key: `flag:${flag.code}`,
        kind: "FLAG",
        severity: flag.severity,
        needsReview,
        decided: Boolean(flag.decided),
        title: FLAG_TITLES[flag.source],
        message: flag.message,
        origin: FLAG_SOURCE_LABELS[flag.source],
        statusText: flag.decided ? "Decidido" : flag.severity === "INFO" ? "Informação" : "Validar",
        tone: flag.decided ? "brand" : flag.severity === "INFO" ? "neutral" : flag.severity === "ERROR" ? "danger" : "warning",
        phaseIndex: null,
        flag,
      };
    }),
    ...issues.map((issue, n): AlertRow => ({
      key: `issue:${issue.code}:${issue.path}:${n}`,
      kind: "ISSUE",
      severity: issue.severity,
      needsReview: issue.severity !== "INFO",
      decided: false,
      title: ISSUE_LABELS[issue.code] ?? issue.code,
      message: issue.message,
      origin: issue.phaseIndex ? `Motor · fase ${issue.phaseIndex}` : "Motor",
      statusText: issue.severity === "ERROR" ? "Impede" : issue.severity === "WARNING" ? "Atenção" : "Informação",
      tone: issue.severity === "ERROR" ? "danger" : issue.severity === "WARNING" ? "warning" : "neutral",
      phaseIndex: issue.phaseIndex ?? null,
      issue,
    })),
  ];
  const group = (r: AlertRow) => (r.needsReview ? 0 : r.decided ? 1 : 2);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => group(a.row) - group(b.row) || SEVERITY_RANK[a.row.severity] - SEVERITY_RANK[b.row.severity] || a.index - b.index)
    .map((x) => x.row);
}

/** Lower-case, accents removed, for the search boxes. */
export const searchKey = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export function filterAlerts(rows: readonly AlertRow[], filter: AlertFilter, query: string): AlertRow[] {
  const q = searchKey(query);
  return rows.filter((r) => {
    if (filter.kind === "REVIEW" && !r.needsReview) return false;
    if (filter.kind === "INFO" && r.severity !== "INFO") return false;
    if (filter.kind === "PHASE" && r.phaseIndex !== filter.phaseIndex) return false;
    return !q || searchKey(`${r.title} ${r.message} ${r.origin} ${r.issue?.suggestedAction ?? ""}`).includes(q);
  });
}

/** Phases that have at least one issue (the "Fase 01" filters of the alerts). */
export const alertPhases = (rows: readonly AlertRow[]): number[] => [...new Set(rows.map((r) => r.phaseIndex).filter((p): p is number => p !== null))].sort((a, b) => a - b);

/** Rows of a list that match a search box on the given text of each row. */
export function filterByText<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  const q = searchKey(query);
  return q ? items.filter((i) => searchKey(text(i)).includes(q)) : [...items];
}

export const ALERTS_PAGE = 6;
