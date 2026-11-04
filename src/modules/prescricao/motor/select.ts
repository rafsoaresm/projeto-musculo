/**
 * Seleção determinística por treino de uma fase: gulosa por cobertura marginal dos alvos, com
 * pesos das regras e desempate pelo id (ponto de código). Linhas existentes da revisão são
 * preservadas e contam para a quantidade; itens travados são mantidos.
 */
import { cmp, codeOf, MUSCLE_LABELS, normalizeText, numberText, PATTERN_LABELS } from "./vocabulary";
import type { RuleLog } from "./trace";
import type { Alternative, Basis, CatalogExercise, ExistingItem, Experience, ItemMetadata, Metric, TraceEntry } from "./types";

// ---------- chaves de item ----------

/** Chave estável de um item: array JSON (rótulos livres não a quebram). `k` separa repetições. */
export function slotKeyOf(phaseIndex: number, label: string, exerciseId: string | null, nameKey: string, k: number): string {
  return JSON.stringify([phaseIndex, label, exerciseId ?? `custom:${nameKey}`, k]);
}

export function parseSlotKey(key: string): { phaseIndex: number; label: string; exerciseId: string | null; nameKey: string | null; k: number } | null {
  try {
    const v: unknown = JSON.parse(key);
    if (!Array.isArray(v) || v.length !== 4) return null;
    const [p, label, ref, k] = v as unknown[];
    if (typeof p !== "number" || typeof label !== "string" || typeof ref !== "string" || typeof k !== "number") return null;
    return ref.startsWith("custom:")
      ? { phaseIndex: p, label, exerciseId: null, nameKey: ref.slice(7), k }
      : { phaseIndex: p, label, exerciseId: ref, nameKey: null, k };
  } catch {
    return null;
  }
}

export function metadataOf(e: CatalogExercise | null): ItemMetadata {
  if (!e) return "NOT_APPLICABLE";
  return e.metadataStatus === "REVIEWED" ? "REVIEWED" : e.metadataStatus === "INFERRED" ? "INCLUDES_INFERRED" : "PENDING";
}

export function nameKeyOf(name: string, nameKey?: string): string {
  return nameKey ?? normalizeText(name);
}

// ---------- seleção ----------

export interface Coverage {
  muscles: string[];
  patterns: string[];
  basis: Basis;
  ruleId?: string;
}

export interface SelectionRequest {
  stimulus: string | null;
  pool: CatalogExercise[];
  count: number | "BY_TIME";
  /** Para BY_TIME: minutos estimados com estes exercícios, ou null se incalculável. */
  estimate?: (exercises: CatalogExercise[]) => number | null;
  budgetMinutes?: number | null;
  coverage: Coverage | null;
  /** Já ocupam lugar (preservados, travados): contam para a quantidade e para a cobertura. */
  fixed: CatalogExercise[];
  fixedCount: number;
  preferred: ReadonlySet<string>;
  experience: Experience | null;
  history: ReadonlyMap<string, { exposures: number; pain: boolean }>;
  usedInPhase: ReadonlySet<string>;
  usedInPreviousPhase: ReadonlySet<string>;
  avoid: ReadonlySet<string>;
  maxItems: number;
}

export interface Pick {
  exercise: CatalogExercise;
  score: number;
  trace: TraceEntry[];
  /** Outro candidato tinha a mesma pontuação: o código do exercício desempatou. */
  tie: boolean;
}

const muscle = (m: string) => MUSCLE_LABELS[m] ?? m;
const pattern = (p: string) => PATTERN_LABELS[p] ?? p;

function score(log: RuleLog, e: CatalogExercise, chosen: CatalogExercise[], req: SelectionRequest): { score: number; trace: TraceEntry[] } {
  const W = log.get("SELECTION_WEIGHTS");
  const trace: TraceEntry[] = [];
  let total = 0;
  const add = (value: number, code: string, detail: string, basis?: Basis) => {
    if (!value) return;
    total += value;
    trace.push({ code, basis: basis ?? log.basis("SELECTION_WEIGHTS"), ruleId: "SELECTION_WEIGHTS", detail: `${detail} (${value > 0 ? "+" : ""}${numberText(value)})` });
  };
  const covered = new Map<string, number>();
  const patterns = new Set<string>();
  for (const x of chosen) {
    for (const m of x.primaryMuscles.map(codeOf)) covered.set(m, (covered.get(m) ?? 0) + 1);
    for (const p of x.patterns) patterns.add(codeOf(p));
  }
  const targets = req.coverage;
  const tm = new Set((targets?.muscles ?? []).map(codeOf));
  const tp = new Set((targets?.patterns ?? []).map(codeOf));
  for (const m of e.primaryMuscles.map(codeOf))
    if (tm.has(m)) add(W.primaryTarget / (1 + (covered.get(m) ?? 0) * W.primaryRepeatDivisor), "TARGET_PRIMARY", `Músculo-alvo ${muscle(m)} como principal`);
  for (const m of e.secondaryMuscles.map(codeOf))
    if (tm.has(m)) add(W.secondaryTarget / (1 + (covered.get(m) ?? 0)), "TARGET_SECONDARY", `Músculo-alvo ${muscle(m)} como secundário`);
  for (const p of e.patterns) {
    const c = codeOf(p);
    if (tp.has(c)) add(patterns.has(c) ? W.patternRepeat : W.patternNew, patterns.has(c) ? "TARGET_PATTERN_REPEAT" : "TARGET_PATTERN", `Padrão-alvo ${pattern(c)}`);
  }
  if (!tm.size && !tp.size) {
    add(W.noTargets, "NO_TARGETS", "Treino sem alvos: entra pela elegibilidade");
    // Sem alvos, espalhar os padrões: cada padrão já escolhido neste treino pesa contra (antes, três agachamentos no mesmo treino).
    const repeated = e.patterns.map(codeOf).filter((p) => patterns.has(p));
    if (repeated.length && W.noTargetsPatternRepeat) add(W.noTargetsPatternRepeat * repeated.length, "NO_TARGETS_PATTERN_REPEAT", `Padrão já presente neste treino: ${repeated.map(pattern).join(", ")}`);
  }
  if (e.compound === true && req.stimulus && log.get("COMPOUND_PRIORITY_STIMULI").includes(req.stimulus))
    add(W.compound, "COMPOUND", "Multiarticular num estímulo que os prioriza");
  // Sem equipamento nenhum (nem alternativo), um exercício resistido não recebe carga externa: pesa contra nos estímulos de carga.
  if (W.noExternalLoad && req.stimulus && log.optional("EXTERNAL_LOAD_STIMULI")?.includes(req.stimulus) && e.modality
    && codeOf(e.modality) === "RESISTANCE" && e.equipmentKnown !== false && !e.equipment.length && !e.equipmentAlternatives.some((set) => set.length))
    add(W.noExternalLoad, "NO_EXTERNAL_LOAD", "Sem carga externa num estímulo de carga");
  if (req.preferred.has(e.id)) add(W.preferred, "PREFERRED", "Preferido pelo profissional", "PROFESSIONAL");
  const h = req.history.get(e.id);
  if (h?.pain) add(W.historyPain, "HISTORY_PAIN", "Dor relatada no histórico", "STUDENT_DATA");
  else if (h?.exposures) add(W.historyContinuity, "HISTORY_CONTINUITY", `Já executado pelo aluno (${h.exposures} registro(s))`, "STUDENT_DATA");
  if (req.usedInPhase.has(e.id)) add(W.usedInOtherWorkoutOfPhase, "USED_IN_PHASE", "Já usado em outro treino da fase");
  if (req.usedInPreviousPhase.has(e.id)) add(W.usedInPreviousPhase, "USED_IN_PREVIOUS_PHASE", "Usado na fase anterior (variação)");
  if (e.difficulty !== null) {
    const beginner = req.experience === "BEGINNER";
    add((beginner ? W.beginnerDifficulty : W.otherDifficulty) * e.difficulty, "DIFFICULTY", `Dificuldade ${e.difficulty}${beginner ? " para iniciante" : ""}`);
  }
  if (e.metadataStatus === "INFERRED") add(W.inferredMetadata, "INFERRED_METADATA", "Metadados inferidos (não revisados)");
  if (req.avoid.has(e.id)) add(W.avoidCurrent, "AVOID_CURRENT", "Exercício atual do item (pedido de troca)");
  return { score: total, trace };
}

/** Escolhe exercícios até a quantidade (ou até o tempo, em BY_TIME). Determinística. */
export function selectExercises(log: RuleLog, req: SelectionRequest): Pick[] {
  const picks: Pick[] = [];
  const chosen = [...req.fixed];
  const used = new Set(chosen.map((e) => e.id));
  const pool = [...req.pool].sort((a, b) => cmp(a.id, b.id));
  const target = req.count === "BY_TIME" ? req.maxItems - req.fixedCount : Math.min(req.count, req.maxItems) - req.fixedCount;
  const minimum = req.count === "BY_TIME" ? log.get("COUNT_FROM_TIME").minimum : 0;
  for (let n = 0; n < target; n++) {
    let best: Pick | null = null;
    for (const e of pool) {
      if (used.has(e.id)) continue;
      const s = score(log, e, chosen, req);
      if (!best || s.score > best.score) best = { exercise: e, score: s.score, trace: s.trace, tie: false };
      else if (s.score === best.score) best.tie = true;
    }
    if (!best) break;
    if (req.count === "BY_TIME" && picks.length + req.fixedCount >= minimum) {
      const minutes = req.estimate?.([...chosen, best.exercise]) ?? null;
      if (minutes === null || req.budgetMinutes === null || req.budgetMinutes === undefined || minutes > req.budgetMinutes) break;
    }
    picks.push(best);
    chosen.push(best.exercise);
    used.add(best.exercise.id);
  }
  return picks;
}

// ---------- alternativas ----------

export function rankAlternatives(
  log: RuleLog,
  target: CatalogExercise | null,
  targetMetric: Metric | null,
  pool: CatalogExercise[],
  exclude: ReadonlySet<string>,
  limit: number,
): Alternative[] {
  if (!target) return [];
  const W = log.get("ALTERNATIVE_WEIGHTS");
  const curated = new Set(target.substitutes);
  const primary = new Set(target.primaryMuscles.map(codeOf));
  const patterns = new Set(target.patterns.map(codeOf));
  const out: Alternative[] = [];
  for (const e of pool) {
    if (e.id === target.id || exclude.has(e.id)) continue;
    const reasons: string[] = [];
    let s = 0;
    if (curated.has(e.id)) {
      s += W.curated;
      reasons.push("Substituição indicada na biblioteca");
    }
    const sharedM = e.primaryMuscles.map(codeOf).filter((m) => primary.has(m));
    if (sharedM.length) {
      s += W.sharedPrimary * sharedM.length;
      reasons.push(`Mesmo músculo principal: ${sharedM.map(muscle).join(", ")}`);
    }
    const sharedP = e.patterns.map(codeOf).filter((p) => patterns.has(p));
    if (sharedP.length) {
      s += W.sharedPattern * sharedP.length;
      reasons.push(`Mesmo padrão: ${sharedP.map(pattern).join(", ")}`);
    }
    if (!s) continue;
    if (targetMetric && e.metric === targetMetric) {
      s += W.sameMetric;
      reasons.push("Mesma métrica");
    }
    out.push({ exerciseId: e.id, name: e.name, modality: e.modality, metadata: metadataOf(e), reasons, score: s });
  }
  log.get("ALTERNATIVE_WEIGHTS");
  return out.sort((a, b) => b.score - a.score || cmp(a.exerciseId, b.exerciseId)).slice(0, Math.max(0, limit));
}

/** Linhas existentes de um treino em ordem de posição. */
export function existingFor(existing: ExistingItem[], phaseIndex: number, label: string): ExistingItem[] {
  return existing
    .filter((x) => x.phaseIndex === phaseIndex && x.label === label)
    .sort((a, b) => a.position - b.position || cmp(a.prescribedExerciseId, b.prescribedExerciseId));
}
