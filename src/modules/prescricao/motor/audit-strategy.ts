/**
 * Aderência à estratégia aceita (auditoria 1.1.0, design V4 §4.8). Pura e determinística: lê só o que a proposta grava (o foco de cada
 * treino em `coverage.blueprint`, as sessões reais de cada semana com seus itens) e os limiares `AUDIT_STRATEGY` do conjunto de regras.
 * Nunca muda a proposta, nunca bloqueia, nunca lê texto livre.
 *
 * - Aderência: por treino e semana, a fração dos exercícios de volume que ficam no foco, no apoio ou no transbordo. Conta itens (não
 *   séries), então funciona com dose vazia. Treino de corpo inteiro não tem "fora do foco".
 * - Sobreposição entre treinos é DIAGNÓSTICO: descreve, nunca vira meta nem é minimizada em lugar nenhum.
 * - Exposições são contadas nas ocorrências reais do calendário: "ABC com 2 sessões por semana" nunca mostra 3 exposições.
 * - Origem do item: "travar" não muda a leitura (um item travado do motor segue ENGINE); só a troca do profissional e a linha já
 *   existente na revisão (PRESERVED) tornam um item fora do foco uma decisão do profissional (BY_DESIGN).
 * Tudo é heurística operacional editável (regra AUDIT_STRATEGY), para o Técnico validar.
 */
import type { AuditStrategy } from "./rules";
import { cmp, codeOf, MUSCLE_LABELS, numberText, PATTERN_LABELS } from "./vocabulary";
import type {
  AuditFinding, AuditItemOrigin, AuditPhase, AuditRange, BlueprintRole, BlueprintSource, CatalogExercise, FocusClass, ItemOut, OccurrenceOut,
  PhaseSummary, StrategyAdherence, StrategyWeek, WorkoutSummary,
} from "./types";

/** O que o foco de um treino separa. */
export interface FocusSets {
  dominant: ReadonlySet<string>;
  supporting: ReadonlySet<string>;
  targetPatterns: ReadonlySet<string>;
  spillover: ReadonlySet<string>;
  /** Corpo inteiro ou foco vazio: não há "fora do foco". */
  open: boolean;
}

/**
 * Classe de um exercício frente ao foco: ON_FOCUS se um músculo principal é dominante; senão SUPPORTING se é de apoio; senão
 * SPILLOVER se um padrão é alvo ou de transbordo; senão OFF_FOCUS. Mesma partição do desconto `MICRO_OFF_FOCUS` do motor.
 */
export function classifyFocus(focus: FocusSets, primary: readonly string[], patterns: readonly string[]): FocusClass {
  if (focus.open) return "ON_FOCUS";
  if (primary.some((m) => focus.dominant.has(m))) return "ON_FOCUS";
  if (primary.some((m) => focus.supporting.has(m))) return "SUPPORTING";
  if (patterns.some((p) => focus.targetPatterns.has(p) || focus.spillover.has(p))) return "SPILLOVER";
  return "OFF_FOCUS";
}

/** Origem para a auditoria: independe de travar/destravar (o armazenamento não recalcula a auditoria nessas ações). */
export function auditOriginOf(item: Pick<ItemOut, "origin" | "trace">): AuditItemOrigin {
  if (item.origin === "PRESERVED") return "PRESERVED";
  if (item.origin === "SUBSTITUTED" || item.trace.selection.some((t) => t.code === "PROFESSIONAL_SUBSTITUTION")) return "SUBSTITUTED";
  return "ENGINE";
}

/** O foco do treino a partir do que a proposta grava; null se o treino não é de estratégia. */
export function focusOfWorkout(w: WorkoutSummary): { focus: FocusSets; role: BlueprintRole; source: BlueprintSource; strategyId: string } | null {
  const c = w.coverage;
  const b = c?.origin === "BLUEPRINT_FOCUS" ? c.blueprint : undefined;
  if (!c || !b) return null;
  const dominant = new Set(c.muscles.map(codeOf));
  const supporting = new Set(b.supporting.map(codeOf));
  const targetPatterns = new Set(c.patterns.map(codeOf));
  const spillover = new Set(b.spillover.map(codeOf));
  const empty = !dominant.size && !supporting.size && !targetPatterns.size && !spillover.size;
  return { focus: { dominant, supporting, targetPatterns, spillover, open: b.role === "FULL_BODY" || empty }, role: b.role, source: b.source, strategyId: b.strategyId };
}

export interface StrategyAuditInput {
  rule: AuditStrategy;
  /** AUDIT_REGIONS da proposta (região → músculos). */
  regions: Record<string, string[]>;
  volumeModalities: ReadonlySet<string>;
  phases: PhaseSummary[];
  workouts: WorkoutSummary[];
  occurrences: OccurrenceOut[];
  byId: ReadonlyMap<string, CatalogExercise>;
  /** Fases já auditadas: semanas completas e itens não contados. */
  auditedPhases: AuditPhase[];
  /** Alvos aceitos da fase (a entrada da geração); sem eles, só os alvos semanais gravados nos treinos. */
  phaseTargets?: Array<{ phaseIndex: number; muscles: string[]; patterns: string[] }>;
  /** Monta um achado com os campos padrão da auditoria. */
  mk: (f: Omit<AuditFinding, "stage" | "sourceRefs" | "rationale"> & { sourceRefs: string[]; rationale: string }) => AuditFinding;
}

interface CountedItem {
  occ: OccurrenceOut;
  primary: string[];
  patterns: string[];
  origin: AuditItemOrigin;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const roleText = (role: string) => role.toLowerCase().replace(/_/g, " ");
const muscleText = (m: string) => MUSCLE_LABELS[m] ?? m;

function rangeOf(values: number[]): AuditRange {
  if (!values.length) return { min: 0, max: 0 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Itens de volume contados (biblioteca, modalidade de volume, com músculos), como a auditoria do plano os conta. */
function countedItems(a: StrategyAuditInput): CountedItem[] {
  const out: CountedItem[] = [];
  for (const occ of a.occurrences)
    for (const item of occ.items) {
      const e = item.exerciseId ? a.byId.get(item.exerciseId) : undefined;
      if (!e?.modality || !a.volumeModalities.has(codeOf(e.modality))) continue;
      const primary = [...new Set(e.primaryMuscles.map(codeOf))].sort(cmp);
      if (!primary.length && !e.secondaryMuscles.length) continue;
      out.push({ occ, primary, patterns: [...new Set(e.patterns.map(codeOf))].sort(cmp), origin: auditOriginOf(item) });
    }
  return out;
}

const emptyByOrigin = (): Record<AuditItemOrigin, number> => ({ ENGINE: 0, PRESERVED: 0, SUBSTITUTED: 0 });

export function strategyAudit(a: StrategyAuditInput): { strategy: StrategyAdherence; findings: AuditFinding[] } | null {
  const lanes = a.workouts.map((w) => ({ w, f: focusOfWorkout(w) })).filter((x): x is { w: WorkoutSummary; f: NonNullable<ReturnType<typeof focusOfWorkout>> } => x.f !== null);
  if (!lanes.length) return null;
  const items = countedItems(a);
  const findings: AuditFinding[] = [];
  const workoutsOut: StrategyAdherence["workouts"] = [];
  const overlaps: StrategyAdherence["overlaps"] = [];
  const exposures: StrategyAdherence["exposures"] = [];
  const basisOf = (source: BlueprintSource) => (source === "PROFESSIONAL" ? ("PROFESSIONAL" as const) : ("HEURISTIC_ACCEPTED" as const));

  for (const summary of [...a.phases].sort((x, y) => x.phaseIndex - y.phaseIndex)) {
    const p = summary.phaseIndex;
    const audited = a.auditedPhases.find((x) => x.phaseIndex === p);
    const phaseLanes = lanes.filter((l) => l.w.phaseIndex === p);
    if (!audited || !phaseLanes.length) continue;
    const phaseItems = items.filter((i) => i.occ.phaseIndex === p);
    const fullWeeks = audited.weekRows.filter((w) => w.full).map((w) => w.week);
    const checkWeeks = fullWeeks.length ? fullWeeks : audited.weekRows.filter((w) => w.occurrences > 0).map((w) => w.week);
    const uncounted = (week: number) => (audited.weekRows[week - 1]?.uncountedItems ?? 0) > 0;

    // ---- aderência por treino e semana ----
    for (const { w, f } of [...phaseLanes].sort((x, y) => cmp(x.w.label, y.w.label))) {
      const mine = phaseItems.filter((i) => i.occ.label === w.label);
      const weekNumbers = [...new Set(a.occurrences.filter((o) => o.phaseIndex === p && o.label === w.label).map((o) => o.week))].sort((x, y) => x - y);
      const weeks: StrategyWeek[] = weekNumbers.map((week) => {
        const here = mine.filter((i) => i.occ.week === week);
        const row: StrategyWeek = { week, items: here.length, onFocus: 0, supporting: 0, spillover: 0, offFocus: 0, adherence: null, offFocusByOrigin: emptyByOrigin() };
        for (const i of here) {
          const c = classifyFocus(f.focus, i.primary, i.patterns);
          if (c === "ON_FOCUS") row.onFocus += 1;
          else if (c === "SUPPORTING") row.supporting += 1;
          else if (c === "SPILLOVER") row.spillover += 1;
          else {
            row.offFocus += 1;
            row.offFocusByOrigin[i.origin] += 1;
          }
        }
        row.adherence = row.items ? r2((row.items - row.offFocus) / row.items) : null;
        return row;
      });
      const rates = weeks.filter((x) => x.items > 0).map((x) => (x.items - x.offFocus) / x.items);
      workoutsOut.push({
        phaseIndex: p, label: w.label, role: f.role, source: f.source, strategyId: f.strategyId, weeks,
        adherenceMin: rates.length ? r2(Math.min(...rates)) : null,
      });
      const at = { phaseIndex: p, label: w.label };
      const refs = [`rule:AUDIT_STRATEGY`, `coverage:${p}:${w.label}`];
      const low = weeks.filter((x) => x.items > 0 && (x.items - x.offFocus) / x.items < a.rule.adherenceMin);
      const engineOff = weeks.reduce((s, x) => s + x.offFocusByOrigin.ENGINE, 0);
      const offTotal = weeks.reduce((s, x) => s + x.offFocus, 0);
      if (low.length) {
        const worst = low.reduce((x, y) => ((x.items - x.offFocus) / x.items <= (y.items - y.offFocus) / y.items ? x : y));
        const lowEngine = low.reduce((s, x) => s + x.offFocusByOrigin.ENGINE, 0);
        findings.push(a.mk({
          code: "AUDIT_STRATEGY_ADHERENCE_LOW", severity: "WARNING", status: lowEngine === 0 ? "BY_DESIGN" : "OPEN", ...at, week: worst.week,
          measured: { unit: "SHARE", value: worst.adherence ?? 0, detail: { semanasAbaixo: low.length, foraDoFoco: worst.offFocus, itens: worst.items } },
          target: { unit: "SHARE", min: a.rule.adherenceMin, basis: basisOf(f.source), ruleId: "AUDIT_STRATEGY", origin: "BLUEPRINT_FOCUS" },
          sourceRefs: [...refs, `occurrence:${p}:${worst.week}`],
          rationale: `Fase ${p}, treino ${w.label} (${roleText(f.role)}), semana ${worst.week}: ${worst.items - worst.offFocus} de ${worst.items} exercícios no foco, no apoio ou no transbordo (${numberText(r2((worst.adherence ?? 0) * 100))}%; mínimo ${numberText(r2(a.rule.adherenceMin * 100))}%, heurística operacional).${lowEngine === 0 ? " Os itens fora do foco são escolhas do profissional." : ""}`,
          suggestedAction: lowEngine === 0 ? null : "Confira a oferta de exercícios no foco deste treino ou ajuste o foco da estratégia.",
        }));
      } else if (offTotal > 0 && engineOff === 0) {
        findings.push(a.mk({
          code: "AUDIT_STRATEGY_OFF_FOCUS_ITEMS", severity: "INFO", status: "BY_DESIGN", ...at,
          measured: { unit: "ITEMS", value: offTotal, detail: Object.fromEntries((["PRESERVED", "SUBSTITUTED"] as const).map((o) => [o, weeks.reduce((s, x) => s + x.offFocusByOrigin[o], 0)])) },
          sourceRefs: refs,
          rationale: `Fase ${p}, treino ${w.label} (${roleText(f.role)}): ${offTotal} exercício(s) fora do foco por escolha do profissional (troca ou linha já existente na revisão).`,
          suggestedAction: null,
        }));
      }
      if (engineOff > 0)
        findings.push(a.mk({
          code: "AUDIT_STRATEGY_SUPPLY_LOW", severity: "INFO", status: "DESCRIPTIVE", ...at,
          measured: { unit: "ITEMS", value: engineOff },
          sourceRefs: refs,
          rationale: `Fase ${p}, treino ${w.label} (${roleText(f.role)}): o motor escolheu ${engineOff} exercício(s) fora do foco nas sessões. Isso costuma indicar pouca oferta elegível no foco (biblioteca, equipamento ou exclusões); a seleção só desconta o que está fora do foco, não proíbe.`,
          suggestedAction: null,
        }));
    }

    // ---- sobreposição (diagnóstico) ----
    const labelRole = new Map(phaseLanes.map((l) => [l.w.label, l.f.role] as const));
    const labels = [...labelRole.keys()].sort(cmp);
    const musclesOf = (label: string, week: number) =>
      new Set(phaseItems.filter((i) => i.occ.label === label && i.occ.week === week).flatMap((i) => i.primary));
    const present = (label: string, week: number) => a.occurrences.some((o) => o.phaseIndex === p && o.label === label && o.week === week);
    for (let x = 0; x < labels.length; x++)
      for (let y = x + 1; y < labels.length; y++) {
        const [la, lb] = [labels[x], labels[y]];
        if (labelRole.get(la) === labelRole.get(lb)) continue;
        let best: { week: number; jaccard: number } | null = null;
        for (const week of fullWeeks) {
          if (!present(la, week) || !present(lb, week)) continue;
          const [sa, sb] = [musclesOf(la, week), musclesOf(lb, week)];
          const union = new Set([...sa, ...sb]);
          if (!union.size) continue;
          const jaccard = [...sa].filter((m) => sb.has(m)).length / union.size;
          if (!best || jaccard > best.jaccard) best = { week, jaccard };
        }
        if (!best) continue;
        const byDesign = labelRole.get(la) === "FULL_BODY" || labelRole.get(lb) === "FULL_BODY";
        const jaccard = r2(best.jaccard);
        overlaps.push({ phaseIndex: p, week: best.week, a: la, b: lb, jaccard, byDesign });
        if (best.jaccard > a.rule.overlapNote)
          findings.push(a.mk({
            code: "AUDIT_STRATEGY_OVERLAP", severity: "INFO", status: byDesign ? "BY_DESIGN" : "DESCRIPTIVE", phaseIndex: p, week: best.week,
            measured: { unit: "RATIO", value: jaccard },
            sourceRefs: [`rule:AUDIT_STRATEGY`, `coverage:${p}:${la}`, `coverage:${p}:${lb}`],
            rationale: `Fase ${p}, semana ${best.week}: os treinos ${la} (${roleText(labelRole.get(la)!)}) e ${lb} (${roleText(labelRole.get(lb)!)}) compartilham ${numberText(r2(jaccard * 100))}% dos músculos principais.${byDesign ? " Esperado num treino de corpo inteiro." : " É só uma descrição: sobreposição não é meta nem erro."}`,
            suggestedAction: null,
          }));
      }

    // ---- exposições reais por região ----
    const dominantAll = new Set(phaseLanes.flatMap((l) => [...l.f.focus.dominant]));
    for (const [region, muscles] of Object.entries(a.regions).sort(([x], [y]) => cmp(x, y))) {
      if (!muscles.some((m) => dominantAll.has(m))) continue;
      const counted = checkWeeks.filter((w) => !uncounted(w));
      const perWeek = counted.map((week) => new Set(phaseItems.filter((i) => i.occ.week === week && i.primary.some((m) => muscles.includes(m))).map((i) => i.occ.slot)).size);
      if (!counted.length) continue;
      const range = rangeOf(perWeek);
      exposures.push({ phaseIndex: p, region, perWeek: range, weeksCounted: counted.length });
      if (range.min < a.rule.exposureMinPerWeek) {
        const week = counted[perWeek.indexOf(range.min)];
        findings.push(a.mk({
          code: "AUDIT_STRATEGY_EXPOSURE", severity: "WARNING", status: "OPEN", phaseIndex: p, week,
          measured: { unit: "SESSIONS", value: range.min },
          target: { unit: "SESSIONS", min: a.rule.exposureMinPerWeek, basis: "HEURISTIC_ACCEPTED", ruleId: "AUDIT_STRATEGY", origin: "BLUEPRINT_FOCUS" },
          sourceRefs: [`rule:AUDIT_STRATEGY`, `rule:AUDIT_REGIONS`, `occurrence:${p}:${week}`],
          rationale: `Fase ${p}, semana ${week}: a região ${region} tem estímulo direto em ${range.min} sessão(ões) do calendário real (mínimo ${a.rule.exposureMinPerWeek} por semana, heurística operacional); a divisão entre os treinos depende da rotação e da frequência salvas.`,
          suggestedAction: "Confira a rotação e a frequência da periodização salva: o calendário real define quantas vezes cada região aparece.",
        }));
      }
    }

    // ---- alvo aceito da fase que nenhum treino lista ----
    const listedMuscles = new Set(phaseLanes.flatMap((l) => [...l.f.focus.dominant, ...l.f.focus.supporting]));
    const listedPatterns = new Set(phaseLanes.flatMap((l) => [...l.f.focus.targetPatterns, ...l.f.focus.spillover]));
    const accepted = a.phaseTargets?.find((t) => t.phaseIndex === p);
    const wantedMuscles = new Set([...(accepted?.muscles ?? []), ...phaseLanes.flatMap((l) => (l.w.coverage?.weeklySets ?? []).map((s) => s.muscle))].map(codeOf));
    const wantedPatterns = new Set((accepted?.patterns ?? []).map(codeOf));
    const outM = [...wantedMuscles].filter((m) => !listedMuscles.has(m)).sort(cmp);
    const outP = [...wantedPatterns].filter((x) => !listedPatterns.has(x)).sort(cmp);
    if (outM.length || outP.length)
      findings.push(a.mk({
        code: "AUDIT_STRATEGY_PHASE_TARGET_OUTSIDE", severity: "INFO", status: "DESCRIPTIVE", phaseIndex: p,
        measured: { unit: "ITEMS", value: outM.length + outP.length },
        sourceRefs: [`rule:AUDIT_STRATEGY`, `coverage:${p}:*`],
        rationale: `Fase ${p}: ${[...outM.map(muscleText), ...outP.map((x) => PATTERN_LABELS[x] ?? x)].join(", ")} ${outM.length + outP.length === 1 ? "é alvo aceito" : "são alvos aceitos"} da fase, mas nenhum treino ${outM.length + outP.length === 1 ? "o" : "os"} lista no foco da estratégia; o alvo semanal vale em todos os treinos de volume.`,
        suggestedAction: null,
      }));
  }
  if (!workoutsOut.length) return null;
  return {
    strategy: {
      strategyIds: [...new Set(lanes.map((l) => l.f.strategyId))].sort(cmp),
      sources: [...new Set(lanes.map((l) => l.f.source))].sort(cmp),
      workouts: workoutsOut,
      overlaps,
      exposures,
    },
    findings,
  };
}
