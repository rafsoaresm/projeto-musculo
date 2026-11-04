/**
 * Limites técnicos (não de produto): cada um existe porque o valor é gravado numa coluna com
 * CHECK de tamanho (migrations 0041–0042) ou porque uma tabela existente já o impõe. O motor
 * aplica os limites antes de qualquer gravação e diz o que resumiu; nunca falha por isso.
 */
import { MAX_PER_WORKOUT } from "@/modules/prescricao/contracts";
import { canonicalJson } from "./hash";
import { cmp } from "./vocabulary";
import type { DisplayFields, EngineResult, Issue, ItemOut } from "./types";

export const TECHNICAL_LIMITS = {
  /** `prescribed_exercises.phase_index` (0006) e `workout_sessions` (0012) têm CHECK 1..12; refazer não é aditivo (Q4). */
  MAX_PHASES: 12,
  /** Duas sessões por dia na semana: estrutura v2 (sessionsPerWeek ≤ 14). */
  MAX_SESSIONS_PER_WEEK: 14,
  /** `MAX_PER_WORKOUT` da prescrição e `MAX_EXERCISES` da execução: 30 até medição (Q10). */
  MAX_ITEMS_PER_WORKOUT: MAX_PER_WORKOUT,
  /** `proposal_items.trace_json` ≤ 8000 caracteres. */
  MAX_TRACE_JSON: 8000,
  /** `proposal_items.alternatives_json` ≤ 4000 caracteres. */
  MAX_ALTERNATIVES_JSON: 4000,
  MAX_ALTERNATIVES: 8,
  /** `slot_key` ≤ 300 caracteres. */
  MAX_SLOT_KEY: 300,
  /** Avisos listados um a um (erros primeiro); acima disso, agrupados por código e fase com contagem (summary_json ≤ 500000). */
  MAX_ISSUES: 300,
  /** Colunas de exibição (0006/0041): sets 20, reps 40, load_instruction 120, cadence 40, rest_text 40, dose_text 300. */
  DISPLAY: { sets: 20, reps: 40, loadInstruction: 120, cadence: 40, restText: 40, doseText: 300 },
} as const;

function cut(text: string | null, max: number): { text: string | null; cut: boolean } {
  if (text === null || text.length <= max) return { text, cut: false };
  return { text: `${text.slice(0, max - 1)}…`, cut: true };
}

export function boundDisplay(display: DisplayFields): { display: DisplayFields; truncated: boolean } {
  const L = TECHNICAL_LIMITS.DISPLAY;
  const parts = {
    sets: cut(display.sets, L.sets),
    reps: cut(display.reps, L.reps),
    loadInstruction: cut(display.loadInstruction, L.loadInstruction),
    cadence: cut(display.cadence, L.cadence),
    restText: cut(display.restText, L.restText),
    doseText: cut(display.doseText, L.doseText),
  };
  return {
    display: {
      ...display,
      sets: parts.sets.text,
      reps: parts.reps.text,
      loadInstruction: parts.loadInstruction.text,
      cadence: parts.cadence.text,
      restText: parts.restText.text,
      doseText: parts.doseText.text ?? "",
    },
    truncated: Object.values(parts).some((p) => p.cut),
  };
}

function boundItem(item: ItemOut, path: string, issues: Issue[]): ItemOut {
  let next = item;
  const alternatives = item.alternatives.slice(0, TECHNICAL_LIMITS.MAX_ALTERNATIVES);
  while (alternatives.length && JSON.stringify(alternatives).length > TECHNICAL_LIMITS.MAX_ALTERNATIVES_JSON) alternatives.pop();
  if (alternatives.length !== item.alternatives.length) next = { ...next, alternatives };
  if (JSON.stringify(next.trace).length > TECHNICAL_LIMITS.MAX_TRACE_JSON) {
    const selection = [...next.trace.selection];
    const params = [...next.trace.params];
    while (JSON.stringify({ selection, params }).length > TECHNICAL_LIMITS.MAX_TRACE_JSON - 200 && (selection.length > 1 || params.length)) {
      if (selection.length > 1) selection.pop();
      else params.pop();
    }
    selection.push({ code: "TRACE_TRUNCATED", basis: "HEURISTIC", detail: "Justificativa resumida pelo limite técnico de armazenamento." });
    next = { ...next, trace: { selection, params } };
    issues.push({ severity: "INFO", code: "TRACE_TRUNCATED", path, message: "A justificativa deste item foi resumida pelo limite técnico de armazenamento.", stage: "VALIDATION" });
  }
  const bounded = boundDisplay(next.display);
  if (bounded.truncated) {
    next = { ...next, display: bounded.display };
    issues.push({ severity: "WARNING", code: "DISPLAY_TRUNCATED", path, message: "O texto da dose passou do tamanho que a ficha grava e foi resumido; revise o item.", stage: "VALIDATION" });
  }
  if (next.slotKey.length > TECHNICAL_LIMITS.MAX_SLOT_KEY)
    issues.push({ severity: "ERROR", code: "SLOT_KEY_TOO_LONG", path, message: "A chave do item passa do limite técnico; encurte o nome do exercício.", stage: "VALIDATION" });
  return next;
}

const SEVERITY_ORDER: Record<Issue["severity"], number> = { ERROR: 0, WARNING: 1, INFO: 2 };

/**
 * Acima do limite, os primeiros `MAX_ISSUES` (erros antes de alertas e informações) ficam um a um;
 * o resto é agrupado por severidade, código, etapa e fase, com contagem. Erros agrupados continuam
 * ERROR (o estado da proposta não muda) e a fase fica no grupo (regenerar a fase o substitui).
 */
export function boundIssues(issues: Issue[]): Issue[] {
  if (issues.length <= TECHNICAL_LIMITS.MAX_ISSUES) return issues;
  const ordered = issues.map((i, n) => ({ i, n })).sort((a, b) => SEVERITY_ORDER[a.i.severity] - SEVERITY_ORDER[b.i.severity] || a.n - b.n).map((x) => x.i);
  const kept = ordered.slice(0, TECHNICAL_LIMITS.MAX_ISSUES);
  const rest = ordered.slice(TECHNICAL_LIMITS.MAX_ISSUES);
  const groups = new Map<string, Issue>();
  let total = 0;
  for (const i of rest) {
    total += i.count ?? 1;
    const key = `${i.severity}|${i.code}|${i.stage}|${i.phaseIndex ?? ""}`;
    const g = groups.get(key);
    if (g) g.count = (g.count ?? 1) + (i.count ?? 1);
    else groups.set(key, {
      severity: i.severity, code: i.code, path: i.phaseIndex === undefined ? "*" : `phases.${i.phaseIndex}`,
      message: i.message.endsWith("(e outros iguais)") ? i.message : `${i.message} (e outros iguais)`, count: i.count ?? 1, stage: i.stage,
      ...(i.phaseIndex !== undefined ? { phaseIndex: i.phaseIndex } : {}),
    });
  }
  const grouped = [...groups.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || cmp(a.code, b.code) || (a.phaseIndex ?? 0) - (b.phaseIndex ?? 0));
  return [...kept, ...grouped, {
    severity: "INFO", code: "ISSUES_AGGREGATED", path: "*", stage: "VALIDATION",
    message: `${total} avisos agrupados por código pelo limite técnico.`, count: total,
  }];
}

export function applyBounds(result: EngineResult): EngineResult {
  const extra: Issue[] = [];
  const occurrences = result.occurrences.map((o) => ({
    ...o,
    items: o.items.map((item) => boundItem(item, `occurrences.${o.phaseIndex}.${o.week}.${o.slot}.${item.slotKey}`, extra)),
  }));
  return { ...result, occurrences, issues: boundIssues([...result.issues, ...extra]) };
}

/** Tamanho do resumo canônico (para o chamador conferir antes de gravar). */
export function summarySize(result: EngineResult): number {
  return canonicalJson(result).length;
}
