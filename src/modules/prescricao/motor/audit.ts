/**
 * Auditoria técnica do plano inteiro (fatia B do handoff V3). Pura e determinística: lê só o conteúdo da proposta (sessões reais
 * de cada semana, itens e doses), os alvos persistidos nos treinos e as regras do conjunto. Nunca muda a proposta, nunca bloqueia,
 * nunca lê texto livre nem a origem dos itens (travar ou destravar não deixa a auditoria velha).
 *
 * Distinções (handoff V3, B): (a) músculo só com estímulo indireto; (b) alvo explícito não atingido; (c) músculo fora dos alvos
 * omitido por escolha do profissional. Faixas só vêm de alvos do profissional, de heurística aceita ou da disponibilidade
 * informada; os limiares do conjunto de regras são heurística operacional (editável) e geram observações, nunca bloqueios.
 * Vazio nunca vira 0: séries não definidas e itens que não puderam ser contados desligam as checagens por séries.
 */
import { intensityText } from "./dose";
import type { AuditThresholds } from "./rules";
import type { RuleLog } from "./trace";
import { cmp, codeOf, labelsOf, MUSCLE_LABELS, numberText, PATTERN_LABELS, STIMULUS_LABELS } from "./vocabulary";
import type {
  AuditFinding, AuditMuscleRow, AuditPatternRow, AuditPhase, AuditRange, AuditReport, AuditTarget,
  AuditWeek, AuditWorkoutRow, Basis, CatalogExercise, CoverageTargets, Dose, ItemOut, OccurrenceOut, PhaseSummary, StructurePhase,
  VolumeRow, WorkoutSummary,
} from "./types";

export const AUDIT_VERSION = "1.0.0";

export interface AuditInput {
  /** As regras da proposta (ou, para propostas antigas sem auditoria gravada, as regras de auditoria atuais). */
  log: RuleLog;
  phases: PhaseSummary[];
  /** Estrutura da entrada; null na leitura de uma proposta gravada (as sessões e as fases bastam). */
  structure: StructurePhase[] | null;
  workouts: WorkoutSummary[];
  /** Sessões já finalizadas (doses, duração estimada, tempo disponível). */
  occurrences: OccurrenceOut[];
  volume: VolumeRow[];
  byId: ReadonlyMap<string, CatalogExercise>;
  /**
   * As regras da PRÓPRIA proposta aceitam os alvos sugeridos (MICROCYCLE_TARGET_SUGGESTIONS)? Só na auditoria calculada na
   * tela para uma proposta antiga (`log` = regras de auditoria atuais): ela regenera com as regras dela, que podem não ter a
   * sugestão, e a ação não pode apontar para um aceite que o servidor recusaria. Omitido = lido de `log`.
   */
  suggestionsAccepted?: boolean;
}

const MAX_RATIONALE = 300;
/**
 * Músculos que a auditoria nunca põe numa observação aberta sem alvos (pedido do usuário, handoff V3 B: não recomendar
 * panturrilha, bíceps e abdominais automaticamente). Seguem na tabela de músculos e na descrição AUDIT_NO_DIRECT_STIMULUS.
 */
const NO_AUTOMATIC_RECOMMENDATION: ReadonlySet<string> = new Set(["CALVES", "BICEPS", "ABS"]);
const MAX_REFS = 12;

// ---------- utilidades ----------

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${numberText(r2(n * 100))}%`;
const muscleText = (m: string) => MUSCLE_LABELS[m] ?? m;
const patternText = (p: string) => PATTERN_LABELS[p] ?? p;

function rangeOf(values: number[]): AuditRange {
  if (!values.length) return { min: 0, max: 0 };
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function setsOf(dose: Dose | null): number | null {
  if (!dose) return null;
  if (dose.metric === "REPS" || dose.metric === "TIME" || dose.metric === "DISTANCE") return dose.sets;
  return null;
}

function cut(text: string): string {
  return text.length <= MAX_RATIONALE ? text : `${text.slice(0, MAX_RATIONALE - 1)}…`;
}

function finding(f: Omit<AuditFinding, "stage" | "sourceRefs" | "rationale"> & { sourceRefs: string[]; rationale: string }): AuditFinding {
  return { ...f, stage: "VALIDATION", sourceRefs: [...new Set(f.sourceRefs)].slice(0, MAX_REFS), rationale: cut(f.rationale) };
}

const rule = (id: string) => `rule:${id}`;

/** "1–4" ou "1, 3, 4". */
function weeksText(weeks: number[]): string {
  if (!weeks.length) return "";
  const contiguous = weeks.every((w, i) => i === 0 || w === weeks[i - 1] + 1);
  return contiguous && weeks.length > 1 ? `${weeks[0]}–${weeks[weeks.length - 1]}` : weeks.join(", ");
}

/** Alguma semana que conta não tem sessão de algum treino de volume (rodízio: AB 1×, ABCD 3×). */
function rotationGap(occs: OccurrenceOut[], volumeLabels: string[], weeks: number[]): boolean {
  return weeks.some((w) => volumeLabels.some((l) => !occs.some((o) => o.week === w && o.label === l)));
}

// ---------- fatos de cada item ----------

interface ItemFact {
  occ: OccurrenceOut;
  item: ItemOut;
  exercise: CatalogExercise | null;
  /** Exercício da biblioteca numa modalidade de volume (VOLUME_MODALITIES). */
  volume: boolean;
  /** Sem exercício da biblioteca, fora da biblioteca ou de volume sem músculos. */
  uncounted: boolean;
  /** Item de volume contado com dose vazia: séries não definidas. */
  unknownSets: boolean;
  sets: number | null;
  primary: string[];
  secondary: string[];
  patterns: string[];
  /** Séries ponderadas do item (diretas + indiretas × fator); null sem séries. */
  weighted: number | null;
}

function itemFacts(a: AuditInput, volumeModalities: ReadonlySet<string>, factor: number): ItemFact[] {
  const out: ItemFact[] = [];
  for (const occ of a.occurrences)
    for (const item of occ.items) {
      const exercise = item.exerciseId ? a.byId.get(item.exerciseId) ?? null : null;
      const volume = Boolean(exercise?.modality && volumeModalities.has(codeOf(exercise.modality)));
      const primary = exercise ? [...new Set(exercise.primaryMuscles.map(codeOf))].sort(cmp) : [];
      const secondary = exercise ? [...new Set(exercise.secondaryMuscles.map(codeOf))].filter((m) => !primary.includes(m)).sort(cmp) : [];
      const uncounted = !exercise || (volume && !primary.length && !secondary.length);
      const sets = setsOf(item.dose);
      const unknownSets = volume && !uncounted && item.dose === null;
      const counted = volume && !uncounted;
      out.push({
        occ, item, exercise, volume: counted, uncounted, unknownSets, sets,
        primary: counted ? primary : [], secondary: counted ? secondary : [],
        patterns: exercise ? [...new Set(exercise.patterns.map(codeOf))].sort(cmp) : [],
        weighted: counted && sets !== null ? sets * (primary.length + secondary.length * factor) : null,
      });
    }
  return out;
}

// ---------- alvos ----------

interface TargetSpec {
  kind: "MUSCLE" | "PATTERN";
  code: string;
  /** null = alvo da fase (vale nas sessões de todos os treinos). */
  label: string | null;
  basis: Basis;
  ruleId?: string;
  origin: "WORKOUT_FOCUS" | "PHASE_COVERAGE";
  minSessions: number;
  minWeighted?: number;
  maxWeighted?: number;
}

function sameCoverage(a: CoverageTargets, b: CoverageTargets): boolean {
  return [...a.muscles].sort(cmp).join() === [...b.muscles].sort(cmp).join() && [...a.patterns].sort(cmp).join() === [...b.patterns].sort(cmp).join() && a.basis === b.basis;
}

function targetsOf(workouts: WorkoutSummary[], structure: StructurePhase | null): TargetSpec[] {
  const covered = workouts.filter((w) => w.coverage);
  // Propostas sem `origin` gravado (antes da auditoria): com a estrutura da entrada, o foco do treino diz a origem (o motor
  // usa o foco no lugar da cobertura da fase); sem ela, o mesmo alvo em todos os treinos da fase é lido como alvo da fase.
  const focused = (label: string): boolean | null => {
    const w = structure?.workouts.find((x) => x.label === label);
    return w ? Boolean(w.focus.muscles?.length || w.focus.patterns?.length) : null;
  };
  const inferred: "WORKOUT_FOCUS" | "PHASE_COVERAGE" =
    covered.length === workouts.length && covered.length > 0 && covered.every((w) => sameCoverage(w.coverage!, covered[0].coverage!)) ? "PHASE_COVERAGE" : "WORKOUT_FOCUS";
  const specs = new Map<string, TargetSpec>();
  const add = (s: TargetSpec) => {
    const key = `${s.kind}|${s.code}|${s.label ?? "*"}`;
    const cur = specs.get(key);
    if (!cur) specs.set(key, s);
    else
      specs.set(key, {
        ...cur,
        minSessions: Math.max(cur.minSessions, s.minSessions),
        ...(s.minWeighted !== undefined ? { minWeighted: s.minWeighted } : {}),
        ...(s.maxWeighted !== undefined ? { maxWeighted: s.maxWeighted } : {}),
      });
  };
  for (const w of covered) {
    const c = w.coverage!;
    const fromStructure = focused(w.label);
    const origin = c.origin ?? (fromStructure === null ? inferred : fromStructure ? "WORKOUT_FOCUS" : "PHASE_COVERAGE");
    const label = origin === "PHASE_COVERAGE" ? null : w.label;
    const base = { basis: c.basis, ...(c.ruleId ? { ruleId: c.ruleId } : {}), origin, label };
    for (const m of c.muscles) add({ kind: "MUSCLE", code: codeOf(m), minSessions: 1, ...base });
    for (const p of c.patterns) add({ kind: "PATTERN", code: codeOf(p), minSessions: 1, ...base });
    for (const ws of c.weeklySets ?? [])
      add({
        kind: "MUSCLE", code: codeOf(ws.muscle), label: null, origin: "PHASE_COVERAGE", basis: ws.basis, ...(ws.ruleId ? { ruleId: ws.ruleId } : {}),
        minSessions: Math.max(1, ws.minDirectSessions ?? 1),
        ...(ws.minWeighted !== undefined ? { minWeighted: ws.minWeighted } : {}),
        ...(ws.maxWeighted !== undefined ? { maxWeighted: ws.maxWeighted } : {}),
      });
  }
  return [...specs.values()].sort((x, y) => cmp(x.kind, y.kind) || cmp(x.code, y.code) || cmp(x.label ?? "", y.label ?? ""));
}

const targetText = (t: AuditTarget) => (t.basis === "HEURISTIC_ACCEPTED" ? "heurística aceita pelo profissional" : t.basis === "STUDENT_DATA" ? "dado do aluno" : "decisão do profissional");

// ---------- auditoria de uma fase ----------

interface PhaseContext {
  a: AuditInput;
  t: AuditThresholds;
  factor: number;
  regions: Record<string, string[]>;
  comprehensiveStimuli: ReadonlySet<string>;
  summary: PhaseSummary;
  facts: ItemFact[];
  occs: OccurrenceOut[];
  workouts: WorkoutSummary[];
  findings: AuditFinding[];
}

/** Sessões distintas (slots) de uma semana em que algum item atende `pred`. */
function sessionsWith(facts: ItemFact[], week: number, pred: (f: ItemFact) => boolean, label: string | null = null): number {
  const slots = new Set<number>();
  for (const f of facts) if (f.occ.week === week && (label === null || f.occ.label === label) && pred(f)) slots.add(f.occ.slot);
  return slots.size;
}

function auditPhase(pc: PhaseContext): AuditPhase {
  const { a, t, summary, facts, occs, findings } = pc;
  const p = summary.phaseIndex;
  const weeks = Array.from({ length: summary.weeks }, (_, i) => i + 1);
  // ---- semanas ----
  const weekRows: AuditWeek[] = weeks.map((week) => {
    const wf = facts.filter((f) => f.occ.week === week);
    const occurrences = occs.filter((o) => o.week === week).length;
    const unknownSetItems = wf.filter((f) => f.unknownSets).length;
    const uncountedItems = wf.filter((f) => f.uncounted).length;
    const direct = new Map<string, Set<number>>();
    for (const f of wf) for (const m of f.primary) (direct.get(m) ?? direct.set(m, new Set()).get(m)!).add(f.occ.slot);
    const directSessions: Record<string, number> = {};
    for (const m of [...direct.keys()].sort(cmp)) directSessions[m] = direct.get(m)!.size;
    const weighted = unknownSetItems > 0 || uncountedItems > 0 ? null : r2(wf.reduce((s, f) => s + (f.weighted ?? 0), 0));
    return { week, occurrences, full: occurrences >= summary.sessionsPerWeek, unknownSetItems, uncountedItems, directSessions, weighted };
  });
  // Séries conhecidas na semana: nenhum item de volume sem séries e nenhum item não contado (§3.5.12).
  const known = (w: number) => weekRows[w - 1]?.unknownSetItems === 0 && weekRows[w - 1]?.uncountedItems === 0;
  /** A semana tem item não contado no escopo (treino do alvo ou fase): uma ausência ali pode ser só o item que não se lê. */
  const uncountedIn = (w: number, label: string | null) => facts.some((f) => f.uncounted && f.occ.week === w && (label === null || f.occ.label === label));
  const fullWeeks = weekRows.filter((w) => w.full).map((w) => w.week);
  const checkWeeks = fullWeeks.length ? fullWeeks : weekRows.filter((w) => w.occurrences > 0).map((w) => w.week);
  const partialWeeks = weekRows.filter((w) => !w.full).map((w) => w.week);
  const anyUnknown = weekRows.some((w) => w.unknownSetItems > 0);
  const anyUncounted = weekRows.some((w) => w.uncountedItems > 0);
  const volumeFacts = facts.filter((f) => f.volume);
  const hasVolume = volumeFacts.length > 0 || facts.some((f) => f.unknownSets);
  const stimuli = [...new Set(occs.map((o) => o.stimulus?.value).filter((s): s is string => Boolean(s)))].sort(cmp);
  const comprehensive = hasVolume && stimuli.some((s) => pc.comprehensiveStimuli.has(s));
  const targets = targetsOf(pc.workouts, pc.a.structure?.find((x) => x.index === p) ?? null);
  const hasTargets = pc.workouts.some((w) => w.coverage);
  const volRows = a.volume.filter((v) => v.phaseIndex === p);
  const volAt = (week: number, m: string) => volRows.find((v) => v.week === week && v.muscle === m);

  // ---- treinos ----
  const labels = [...new Set([...pc.workouts.map((w) => w.label), ...occs.map((o) => o.label)])];
  const exposures = (label: string, weekList: number[]) => weekList.map((w) => occs.filter((o) => o.week === w && o.label === label).length);
  const regionsOf = (fs: ItemFact[]) => Object.entries(pc.regions).filter(([, ms]) => fs.some((f) => f.primary.some((m) => ms.includes(m)))).map(([r]) => r).sort(cmp);
  const workoutRows: AuditWorkoutRow[] = labels.map((label) => {
    const lf = facts.filter((f) => f.occ.label === label);
    const volumeWorkout = lf.some((f) => f.volume || f.unknownSets);
    const lo = occs.filter((o) => o.label === label);
    const complete = lo.filter((o) => o.durationComplete && o.estimatedMinutes !== null).map((o) => o.estimatedMinutes as number);
    return {
      label, exposuresPerWeek: rangeOf(exposures(label, checkWeeks)), volumeWorkout, weightedShare: null,
      regions: volumeWorkout ? regionsOf(lf) : [], minutes: complete.length ? rangeOf(complete) : null, budgetMinutes: lo[0]?.budgetMinutes ?? null,
    };
  });
  const volumeLabels = workoutRows.filter((w) => w.volumeWorkout).map((w) => w.label);
  const knownWeeks = checkWeeks.filter(known);
  if (knownWeeks.length) {
    let total = 0;
    const byLabel = new Map<string, number>();
    for (const f of volumeFacts)
      if (knownWeeks.includes(f.occ.week)) {
        total += f.weighted ?? 0;
        byLabel.set(f.occ.label, (byLabel.get(f.occ.label) ?? 0) + (f.weighted ?? 0));
      }
    for (const w of workoutRows) if (w.volumeWorkout && total > 0) w.weightedShare = r2((byLabel.get(w.label) ?? 0) / total);
  }

  // ---- músculos ----
  const muscleSet = new Set<string>(Object.keys(MUSCLE_LABELS));
  for (const f of facts) for (const m of [...f.primary, ...f.secondary]) muscleSet.add(m);
  for (const s of targets) if (s.kind === "MUSCLE") muscleSet.add(s.code);
  const muscles = [...muscleSet].sort(cmp);
  const primaryIn = new Set(volumeFacts.flatMap((f) => f.primary));
  const secondaryIn = new Set(volumeFacts.flatMap((f) => f.secondary));
  const setRange = (pick: (week: number) => number): AuditRange | null => (anyUnknown || anyUncounted || !weeks.length ? null : rangeOf(weeks.map(pick)));
  const rowTarget = (m: string): AuditTarget | undefined => {
    const specs = targets.filter((s) => s.kind === "MUSCLE" && s.code === m);
    if (!specs.length) return undefined;
    const sets = specs.find((s) => s.minWeighted !== undefined || s.maxWeighted !== undefined);
    const s = sets ?? specs[0];
    return sets
      ? { unit: "WEIGHTED_SETS", ...(s.minWeighted !== undefined ? { min: s.minWeighted } : {}), ...(s.maxWeighted !== undefined ? { max: s.maxWeighted } : {}), basis: s.basis, ...(s.ruleId ? { ruleId: s.ruleId } : {}), origin: s.origin }
      : { unit: "SESSIONS", min: Math.max(...specs.map((x) => x.minSessions)), basis: s.basis, ...(s.ruleId ? { ruleId: s.ruleId } : {}), origin: s.origin };
  };
  const muscleRows: AuditMuscleRow[] = muscles.map((m) => {
    const target = rowTarget(m);
    const classification: AuditMuscleRow["classification"] = primaryIn.has(m) ? "DIRECT" : secondaryIn.has(m) ? "INDIRECT_ONLY" : anyUncounted ? "UNKNOWN" : "NONE";
    return {
      muscle: m, isTarget: Boolean(target),
      direct: setRange((w) => volAt(w, m)?.directSets ?? 0),
      indirect: setRange((w) => volAt(w, m)?.indirectSets ?? 0),
      weighted: setRange((w) => volAt(w, m)?.weightedSets ?? 0),
      directSessions: rangeOf(weekRows.map((w) => w.directSessions[m] ?? 0)),
      classification, ...(target ? { target } : {}),
    };
  });

  // ---- padrões ----
  const patternSet = new Set<string>(Object.keys(PATTERN_LABELS));
  for (const f of facts) for (const x of f.patterns) patternSet.add(x);
  for (const s of targets) if (s.kind === "PATTERN") patternSet.add(s.code);
  const patternRows: AuditPatternRow[] = [...patternSet].sort(cmp).map((pattern) => {
    const pf = facts.filter((f) => f.patterns.includes(pattern));
    const unknown = pf.some((f) => f.sets === null);
    return {
      pattern, isTarget: targets.some((s) => s.kind === "PATTERN" && s.code === pattern),
      sets: unknown || anyUncounted || !weeks.length ? null : rangeOf(weeks.map((w) => pf.filter((f) => f.occ.week === w).reduce((s, f) => s + (f.sets ?? 0), 0))),
      sessions: rangeOf(weeks.map((w) => sessionsWith(pf, w, () => true))),
    };
  });

  // ---- formato observado da divisão (descritivo) ----
  const lowerKeys = ["LOWER"];
  const upperKeys = ["UPPER_PUSH", "UPPER_PULL"];
  const volumeRows = workoutRows.filter((w) => w.volumeWorkout);
  const has = (w: AuditWorkoutRow, keys: string[]) => w.regions.some((r) => keys.includes(r));
  const splitShape: AuditPhase["splitShape"] = !volumeRows.length
    ? null
    : volumeRows.length === 1
      ? "SINGLE"
      : volumeRows.every((w) => has(w, lowerKeys) && has(w, upperKeys))
        ? "FULL_BODY"
        : volumeRows.every((w) => has(w, lowerKeys) !== has(w, upperKeys)) && volumeRows.some((w) => has(w, lowerKeys)) && volumeRows.some((w) => has(w, upperKeys))
          ? "UPPER_LOWER"
          : "OTHER";

  const phase: AuditPhase = {
    phaseIndex: p, weeks: summary.weeks, sessionsPerWeek: summary.sessionsPerWeek,
    occurrencesPerWeek: rangeOf(weekRows.map((w) => w.occurrences)), partialWeeks, stimuli, comprehensive, hasTargets, splitShape,
    weekRows, muscles: muscleRows, patterns: patternRows, workouts: workoutRows,
  };

  // ======== achados ========
  const where = (week?: number) => `Fase ${p}${week ? `, semana ${week}` : ""}`;

  // semanas parciais
  for (const w of partialWeeks) {
    const row = weekRows[w - 1];
    findings.push(finding({
      code: "AUDIT_PARTIAL_WEEK", severity: "INFO", status: "OPEN", phaseIndex: p, week: w,
      measured: { unit: "SESSIONS", value: row.occurrences, detail: { sessionsPerWeek: summary.sessionsPerWeek } },
      sourceRefs: occs.filter((o) => o.week === w).map((o) => `occurrence:${p}:${w}:${o.slot}`),
      rationale: `${where(w)}: ${row.occurrences} de ${summary.sessionsPerWeek} sessões previstas na estrutura. Semana parcial: fica fora das comparações de volume entre semanas.`,
      suggestedAction: "Confirme se a semana parcial é intencional (início ou fim do calendário).",
    }));
  }

  // itens não contados ou sem séries
  if (anyUnknown || anyUncounted) {
    const detail: Record<string, number> = {};
    for (const w of weekRows) {
      if (w.unknownSetItems) detail[`semana ${w.week}: séries não definidas`] = w.unknownSetItems;
      if (w.uncountedItems) detail[`semana ${w.week}: não contados`] = w.uncountedItems;
    }
    const total = weekRows.reduce((s, w) => s + w.unknownSetItems + w.uncountedItems, 0);
    const skipped = [
      anyUnknown ? "com séries não definidas, as checagens por séries (faixas semanais, saltos de volume, passo de séries, concentração e divisão entre treinos) foram puladas nessas semanas; presença e frequência continuam" : null,
      anyUncounted ? "itens fora da biblioteca ou sem músculos não foram contados: músculos sem item ficam como desconhecidos, não como ausentes; nessas semanas as checagens por séries e o equilíbrio entre padrões foram pulados, e um alvo sem item direto não é dado como 0" : null,
    ].filter(Boolean).join("; ");
    findings.push(finding({
      code: "AUDIT_UNCOUNTED_ITEMS", severity: "INFO", status: "DESCRIPTIVE", phaseIndex: p,
      measured: { unit: "ITEMS", value: total, detail },
      sourceRefs: [rule("VOLUME_MODALITIES")],
      rationale: `${where()}: ${skipped}.`,
      suggestedAction: null,
    }));
  }

  // (b) alvos
  for (const s of targets) {
    const scopeFacts = s.label === null ? facts : facts.filter((f) => f.occ.label === s.label);
    const at = s.label ? { label: s.label } : {};
    const refs = [s.label ? `coverage:${p}:${s.label}` : `coverage:${p}:*`, ...(s.ruleId ? [rule(s.ruleId)] : [])];
    const tgt = (unit: AuditTarget["unit"], extra: { min?: number; max?: number }): AuditTarget => ({ unit, ...extra, basis: s.basis, ...(s.ruleId ? { ruleId: s.ruleId } : {}), origin: s.origin });
    const worst = <T extends number>(weekList: number[], value: (w: number) => T, pick: "min" | "max") => {
      let best: { week: number; value: T } | null = null;
      for (const w of weekList) {
        const v = value(w);
        if (!best || (pick === "min" ? v < best.value : v > best.value)) best = { week: w, value: v };
      }
      return best;
    };
    const scopeText = s.label ? `no treino ${s.label}` : "na fase";
    // Alvo do treino: só as semanas em que o calendário dá sessão a esse treino (rotação irregular). Semanas com item não contado
    // no escopo ficam fora da checagem de presença: a ausência ali não é medida (vazio nunca vira 0).
    const presenceWeeks = checkWeeks.filter((w) => (s.label === null || occs.some((o) => o.week === w && o.label === s.label)) && !uncountedIn(w, s.label));
    if (s.kind === "PATTERN") {
      const low = worst(presenceWeeks, (w) => sessionsWith(scopeFacts, w, (f) => f.patterns.includes(s.code)), "min");
      if (low && low.value < 1)
        findings.push(finding({
          code: "AUDIT_TARGET_PATTERN_UNMET", severity: "WARNING", status: "OPEN", phaseIndex: p, week: low.week, pattern: s.code, ...at,
          measured: { unit: "SESSIONS", value: low.value }, target: tgt("SESSIONS", { min: 1 }), sourceRefs: refs,
          rationale: `${where(low.week)}: o padrão-alvo ${patternText(s.code)} não aparece em nenhuma sessão ${scopeText} (alvo: ao menos 1 por semana, ${targetText(tgt("SESSIONS", {}))}).`,
          suggestedAction: `Revise a seleção ${scopeText} ou o alvo de ${patternText(s.code)}.`,
        }));
      continue;
    }
    const sessions = (w: number) => sessionsWith(scopeFacts, w, (f) => f.primary.includes(s.code));
    const low = worst(presenceWeeks, sessions, "min");
    if (low && low.value < s.minSessions) {
      findings.push(finding({
        code: "AUDIT_TARGET_MUSCLE_UNMET", severity: "WARNING", status: "OPEN", phaseIndex: p, week: low.week, muscle: s.code, ...at,
        measured: { unit: "SESSIONS", value: low.value }, target: tgt("SESSIONS", { min: s.minSessions }),
        sourceRefs: [...refs, `volume:${p}:${low.week}:${s.code}`],
        rationale: `${where(low.week)}: ${muscleText(s.code)} tem estímulo direto em ${low.value} sessão(ões) ${scopeText}; o alvo é ao menos ${s.minSessions} por semana (${targetText(tgt("SESSIONS", {}))}).`,
        suggestedAction: `Revise a seleção ${scopeText} ou o alvo de ${muscleText(s.code)}.`,
      }));
      continue;
    }
    if (s.minWeighted === undefined && s.maxWeighted === undefined) continue;
    const setWeeks = checkWeeks.filter(known);
    const weighted = (w: number) => volAt(w, s.code)?.weightedSets ?? 0;
    if (s.minWeighted !== undefined) {
      const lw = worst(setWeeks, weighted, "min");
      if (lw && lw.value < s.minWeighted)
        findings.push(finding({
          code: "AUDIT_TARGET_MUSCLE_UNMET", severity: "WARNING", status: "OPEN", phaseIndex: p, week: lw.week, muscle: s.code,
          measured: { unit: "WEIGHTED_SETS", value: lw.value }, target: tgt("WEIGHTED_SETS", { min: s.minWeighted, ...(s.maxWeighted !== undefined ? { max: s.maxWeighted } : {}) }),
          sourceRefs: [...refs, `volume:${p}:${lw.week}:${s.code}`, rule("INDIRECT_VOLUME_FACTOR")],
          rationale: `${where(lw.week)}: ${muscleText(s.code)} soma ${numberText(lw.value)} séries ponderadas na semana; o alvo mínimo é ${numberText(s.minWeighted)} (${targetText(tgt("WEIGHTED_SETS", {}))}).`,
          suggestedAction: `Revise séries ou exercícios de ${muscleText(s.code)}, ou o alvo semanal.`,
        }));
    }
    if (s.maxWeighted !== undefined) {
      const hw = worst(setWeeks, weighted, "max");
      if (hw && hw.value > s.maxWeighted)
        findings.push(finding({
          code: "AUDIT_TARGET_MUSCLE_ABOVE", severity: "INFO", status: "OPEN", phaseIndex: p, week: hw.week, muscle: s.code,
          measured: { unit: "WEIGHTED_SETS", value: hw.value }, target: tgt("WEIGHTED_SETS", { ...(s.minWeighted !== undefined ? { min: s.minWeighted } : {}), max: s.maxWeighted }),
          sourceRefs: [...refs, `volume:${p}:${hw.week}:${s.code}`, rule("INDIRECT_VOLUME_FACTOR")],
          rationale: `${where(hw.week)}: ${muscleText(s.code)} soma ${numberText(hw.value)} séries ponderadas na semana, acima do máximo de ${numberText(s.maxWeighted)} (${targetText(tgt("WEIGHTED_SETS", {}))}).`,
          suggestedAction: `Confirme se o volume de ${muscleText(s.code)} acima do alvo é intencional.`,
        }));
    }
  }

  // (a) só indireto, (c) omitido por escolha, descrição sem alvos — só em fases com volume; sem alvos, só nas abrangentes
  if (hasVolume && (comprehensive || hasTargets)) {
    const open = comprehensive && !hasTargets;
    // Sem alvos, a observação é aberta ("confirme"): panturrilha, bíceps e abdominais ficam fora dela (não são recomendados).
    const indirectOnly = muscleRows.filter((r) => !r.isTarget && r.classification === "INDIRECT_ONLY" && !(open && NO_AUTOMATIC_RECOMMENDATION.has(r.muscle)));
    if (indirectOnly.length) {
      const detail: Record<string, number> = {};
      for (const r of indirectOnly) detail[r.muscle] = r.indirect ? r.indirect.max : r.directSessions.max;
      const bySets = !anyUnknown && !anyUncounted;
      findings.push(finding({
        code: "AUDIT_INDIRECT_ONLY", severity: "INFO", status: open ? "OPEN" : "BY_DESIGN", phaseIndex: p,
        measured: { unit: bySets ? "INDIRECT_SETS" : "SESSIONS", value: indirectOnly.length, detail: bySets ? detail : Object.fromEntries(indirectOnly.map((r) => [r.muscle, sessionsMax(facts, weeks, r.muscle)])) },
        sourceRefs: [rule("INDIRECT_VOLUME_FACTOR"), ...indirectOnly.slice(0, 8).map((r) => `volume:${p}:${checkWeeks[0] ?? 1}:${r.muscle}`)],
        rationale: `${where()}: ${labelsOf(MUSCLE_LABELS, indirectOnly.map((r) => r.muscle))} recebem só estímulo indireto (como músculo secundário), sem exercício como músculo principal.${open ? "" : " Fora dos alvos definidos: lido como escolha."}`,
        suggestedAction: open ? "Confirme se o estímulo apenas indireto atende ao objetivo da fase." : null,
      }));
    }
    const none = muscleRows.filter((r) => !r.isTarget && r.classification === "NONE" && MUSCLE_LABELS[r.muscle]);
    if (hasTargets && none.length && !anyUncounted)
      findings.push(finding({
        code: "AUDIT_NON_TARGET_OMITTED", severity: "INFO", status: "BY_DESIGN", phaseIndex: p,
        measured: { unit: "SESSIONS", value: 0, detail: Object.fromEntries(none.map((r) => [r.muscle, 0])) },
        sourceRefs: [`coverage:${p}:*`],
        rationale: `${where()}: ${labelsOf(MUSCLE_LABELS, none.map((r) => r.muscle))} não estão nos alvos nem nos exercícios. Coerente com os alvos definidos pelo profissional.`,
        suggestedAction: null,
      }));
    if (!hasTargets && comprehensive && none.length && !anyUncounted)
      findings.push(finding({
        code: "AUDIT_NO_DIRECT_STIMULUS", severity: "INFO", status: "DESCRIPTIVE", phaseIndex: p,
        measured: { unit: "SESSIONS", value: 0, detail: Object.fromEntries(none.map((r) => [r.muscle, 0])) },
        sourceRefs: [rule("AUDIT_COMPREHENSIVE_STIMULI")],
        rationale: `${where()}: sem estímulo direto nem indireto nesta fase: ${labelsOf(MUSCLE_LABELS, none.map((r) => r.muscle))}. Descrição do plano, não uma recomendação.`,
        suggestedAction: null,
      }));
  }
  if (comprehensive && !hasTargets) {
    // Com MICROCYCLE_TARGET_SUGGESTIONS no conjunto da proposta (2026.11.4+), o achado aponta para a mesma sugestão do aviso
    // NO_TARGETS (uma sugestão só, aceite do profissional); sem a regra, o texto de antes.
    const suggests = pc.a.suggestionsAccepted ?? Boolean(pc.a.log.optional("MICROCYCLE_TARGET_SUGGESTIONS"));
    findings.push(finding({
      code: "AUDIT_NO_TARGETS", severity: "INFO", status: "OPEN", phaseIndex: p,
      sourceRefs: suggests ? [rule("AUDIT_COMPREHENSIVE_STIMULI"), rule("MICROCYCLE_TARGET_SUGGESTIONS")] : [rule("AUDIT_COMPREHENSIVE_STIMULI")],
      rationale: `${where()}: fase de ${labelsOf(STIMULUS_LABELS, stimuli)} sem alvos estruturados de músculos ou padrões. A auditoria descreve a distribuição, mas não pode dizer se uma ausência é escolha.`,
      suggestedAction: suggests
        ? "Aceitar os alvos sugeridos (heurística operacional, editável) e regenerar a fase"
        : "Se quiser comparar o plano com alvos, defina músculos ou padrões-alvo da fase.",
    }));
  }

  // equilíbrio entre padrões
  if (comprehensive) {
    const targetPatterns = new Set(targets.filter((s) => s.kind === "PATTERN").map((s) => s.code));
    // Rodízio em que algum treino de volume falta numa semana (AB 1×, ABCD 3×): uma semana sozinha mostra só parte da divisão
    // e o desequilíbrio seria só a rotação. Nesse caso o par é medido na soma das semanas que contam.
    const balanceWeeks = checkWeeks.filter((w) => weekRows[w - 1].uncountedItems === 0);
    const groups: Array<{ week: number | undefined; weeks: number[] }> = rotationGap(occs, volumeLabels, checkWeeks)
      ? (balanceWeeks.length ? [{ week: undefined, weeks: balanceWeeks }] : [])
      : balanceWeeks.map((w) => ({ week: w, weeks: [w] }));
    for (const pair of pc.a.log.optional("AUDIT_BALANCE_PAIRS") ?? []) {
      let best: { week: number | undefined; a: number; b: number; ratio: number; unit: "DIRECT_SETS" | "SESSIONS" } | null = null;
      for (const g of groups) {
        // Item não contado: não se sabe de que lado ele está; a semana fica fora (§3.5.12).
        const side = (codes: string[]) => volumeFacts.filter((f) => g.weeks.includes(f.occ.week) && f.patterns.some((x) => codes.includes(x)));
        const sa = side(pair.a);
        const sb = side(pair.b);
        const bySessions = [...sa, ...sb].some((f) => f.unknownSets);
        const sessionsIn = (fs: ItemFact[]) => g.weeks.reduce((n, w) => n + sessionsWith(fs, w, () => true), 0);
        const va = bySessions ? sessionsIn(sa) : sa.reduce((s, f) => s + (f.sets ?? 0), 0);
        const vb = bySessions ? sessionsIn(sb) : sb.reduce((s, f) => s + (f.sets ?? 0), 0);
        if (va === 0 && vb === 0) continue;
        const ratio = Math.min(va, vb) === 0 ? Number.POSITIVE_INFINITY : Math.max(va, vb) / Math.min(va, vb);
        if (!best || ratio > best.ratio || (ratio === best.ratio && va + vb > best.a + best.b))
          best = { week: g.week, a: va, b: vb, ratio, unit: bySessions ? "SESSIONS" : "DIRECT_SETS" };
      }
      if (!best || best.ratio <= t.balanceRatioMax) continue;
      const dominant = best.a > best.b ? pair.a : pair.b;
      const other = best.a > best.b ? pair.b : pair.a;
      const intended = [...targetPatterns].filter((x) => pair.a.includes(x) || pair.b.includes(x));
      if (intended.length && intended.every((x) => dominant.includes(x)) && !intended.some((x) => other.includes(x))) continue;
      const unitText = best.unit === "SESSIONS" ? "sessões" : "séries";
      const ratioText = Number.isFinite(best.ratio) ? `razão ${numberText(r2(best.ratio))}` : "sem estímulo do outro lado";
      const span = best.week === undefined ? ` na soma das semanas ${weeksText(balanceWeeks)} (nem todo treino aparece em toda semana)` : "";
      findings.push(finding({
        // `pattern` leva o código do par (AUDIT_BALANCE_PAIRS), ex.: KNEE_HIP
        code: "AUDIT_PATTERN_IMBALANCE", severity: "INFO", status: "OPEN", phaseIndex: p, ...(best.week !== undefined ? { week: best.week } : {}), pattern: pair.code,
        measured: { unit: best.unit === "SESSIONS" ? "SESSIONS" : "RATIO", value: Number.isFinite(best.ratio) ? r2(best.ratio) : 0, detail: { a: best.a, b: best.b } },
        sourceRefs: [rule("AUDIT_BALANCE_PAIRS"), `pair:${pair.code}`, rule("AUDIT_THRESHOLDS")],
        rationale: `${where(best.week)}: ${labelsOf(PATTERN_LABELS, pair.a)} somam ${numberText(best.a)} ${unitText}${span} e ${labelsOf(PATTERN_LABELS, pair.b)} somam ${numberText(best.b)} (${ratioText}; limiar ${numberText(t.balanceRatioMax)}, heurística operacional).${phase.splitShape ? ` Formato observado: ${SHAPE_TEXT[phase.splitShape]}.` : ""}`,
        suggestedAction: "Confirme se o desequilíbrio entre os padrões é intencional para o objetivo e a estrutura.",
      }));
    }
  }

  // concentração por região (abrangente, sem alvos)
  if (comprehensive && !hasTargets) {
    let worstRegion: { week: number; region: string; share: number; sets: number; total: number } | null = null;
    for (const w of checkWeeks.filter(known)) {
      const total = weekRows[w - 1].weighted ?? 0;
      if (total <= 0) continue;
      for (const [region, ms] of Object.entries(pc.regions)) {
        const sets = volumeFacts.filter((f) => f.occ.week === w).reduce((s, f) => s + (f.sets ?? 0) * (f.primary.filter((m) => ms.includes(m)).length + f.secondary.filter((m) => ms.includes(m)).length * pc.factor), 0);
        const share = sets / total;
        if (!worstRegion || share > worstRegion.share) worstRegion = { week: w, region, share, sets: r2(sets), total };
      }
    }
    if (worstRegion && worstRegion.share > t.regionShareMax)
      findings.push(finding({
        code: "AUDIT_REGION_CONCENTRATION", severity: "INFO", status: "OPEN", phaseIndex: p, week: worstRegion.week,
        measured: { unit: "SHARE", value: r2(worstRegion.share), detail: { sets: worstRegion.sets, total: worstRegion.total } },
        sourceRefs: [rule("AUDIT_REGIONS"), rule("AUDIT_THRESHOLDS")],
        rationale: `${where(worstRegion.week)}: ${REGION_TEXT[worstRegion.region] ?? worstRegion.region} concentra ${pct(worstRegion.share)} das séries ponderadas da semana (${numberText(worstRegion.sets)} de ${numberText(worstRegion.total)}; limiar ${pct(t.regionShareMax)}, heurística operacional).`,
        suggestedAction: "Confirme se a concentração é intencional; sem alvos, a auditoria não sabe a intenção.",
      }));
  }

  // distribuição entre treinos de volume
  // Medida por sessão (séries ponderadas de uma sessão do treino ÷ soma das sessões típicas de cada treino): um treino que
  // aparece mais vezes na semana (B, A, B) não vira "concentração". Semana que não tem todos os treinos de volume (rodízio)
  // não se mede sozinha: a conta passa à soma das semanas que contam.
  if (volumeLabels.length >= 2) {
    const shareWeeks = checkWeeks.filter(known);
    const gap = rotationGap(occs, volumeLabels, shareWeeks);
    const groups: Array<{ week: number | undefined; weeks: number[] }> = gap
      ? (shareWeeks.length ? [{ week: undefined, weeks: shareWeeks }] : [])
      : shareWeeks.map((w) => ({ week: w, weeks: [w] }));
    const perSession = (label: string, weeksIn: number[]): number | null => {
      const n = weeksIn.reduce((c, w) => c + occs.filter((o) => o.week === w && o.label === label).length, 0);
      if (!n) return null;
      return volumeFacts.filter((f) => weeksIn.includes(f.occ.week) && f.occ.label === label).reduce((s, f) => s + (f.weighted ?? 0), 0) / n;
    };
    for (const label of volumeLabels) {
      let top: { week: number | undefined; share: number; sets: number; total: number } | null = null;
      for (const g of groups) {
        const each = volumeLabels.map((l) => perSession(l, g.weeks));
        if (each.some((v) => v === null)) continue;
        const total = (each as number[]).reduce((s, v) => s + v, 0);
        if (total <= 0) continue;
        const sets = perSession(label, g.weeks) as number;
        if (!top || sets / total > top.share) top = { week: g.week, share: sets / total, sets: r2(sets), total: r2(total) };
      }
      if (top && top.share > t.workoutShareMax) {
        const span = top.week === undefined ? ` (média das semanas ${weeksText(shareWeeks)}: nem todo treino aparece em toda semana)` : "";
        findings.push(finding({
          code: "AUDIT_WORKOUT_SHARE", severity: "INFO", status: "OPEN", phaseIndex: p, ...(top.week !== undefined ? { week: top.week } : {}), label,
          measured: { unit: "SHARE", value: r2(top.share), detail: { sets: top.sets, total: top.total } },
          sourceRefs: [rule("AUDIT_THRESHOLDS"), `coverage:${p}:${label}`],
          rationale: `${where(top.week)}: uma sessão do treino ${label} carrega ${pct(top.share)} das séries ponderadas de uma sessão de cada treino com volume${span} (${numberText(top.sets)} de ${numberText(top.total)}; limiar ${pct(t.workoutShareMax)}).`,
          suggestedAction: "Confirme se a distribuição entre os treinos é intencional.",
        }));
      }
    }
  }

  // mesmo exercício em mais de um treino da fase
  const labelsByExercise = new Map<string, Set<string>>();
  for (const f of facts) if (f.item.exerciseId) (labelsByExercise.get(f.item.exerciseId) ?? labelsByExercise.set(f.item.exerciseId, new Set()).get(f.item.exerciseId)!).add(f.occ.label);
  for (const [id, set] of [...labelsByExercise].sort((x, y) => cmp(x[0], y[0]))) {
    if (set.size < 2) continue;
    const ls = [...set].sort(cmp);
    const perWeek = Math.min(...checkWeeks.map((w) => sessionsWith(facts, w, (f) => f.item.exerciseId === id)));
    const name = pc.a.byId.get(id)?.name ?? facts.find((f) => f.item.exerciseId === id)?.item.exerciseName ?? id;
    findings.push(finding({
      code: "AUDIT_EXERCISE_REPEATED", severity: "INFO", status: "OPEN", phaseIndex: p,
      measured: { unit: "SESSIONS", value: Number.isFinite(perWeek) ? perWeek : 0 },
      sourceRefs: ls.map((l) => `coverage:${p}:${l}`),
      rationale: `${where()}: ${name} aparece nos treinos ${ls.join(", ")} (${Number.isFinite(perWeek) ? perWeek : 0} sessões por semana). Pode ser intencional.`,
      suggestedAction: "Confirme se a repetição entre treinos é intencional.",
    }));
  }

  // mesmo padrão repetido numa sessão (só modalidades de volume)
  const repeated = new Map<string, { label: string; pattern: string; items: number; week: number; slot: number }>();
  for (const o of occs) {
    const counts = new Map<string, number>();
    for (const f of volumeFacts) if (f.occ === o) for (const x of f.patterns) counts.set(x, (counts.get(x) ?? 0) + 1);
    for (const [pattern, n] of counts) {
      if (n < t.patternRepeatInSession) continue;
      const key = `${o.label}|${pattern}`;
      const cur = repeated.get(key);
      if (!cur || n > cur.items) repeated.set(key, { label: o.label, pattern, items: n, week: o.week, slot: o.slot });
    }
  }
  for (const r of [...repeated.values()].sort((x, y) => cmp(x.label, y.label) || cmp(x.pattern, y.pattern)))
    findings.push(finding({
      code: "AUDIT_PATTERN_REPEATED_IN_SESSION", severity: "INFO", status: "OPEN", phaseIndex: p, label: r.label, pattern: r.pattern,
      measured: { unit: "ITEMS", value: r.items },
      sourceRefs: [`occurrence:${p}:${r.week}:${r.slot}`, rule("AUDIT_THRESHOLDS")],
      rationale: `${where()}: o treino ${r.label} tem ${r.items} exercícios do padrão ${patternText(r.pattern)} na mesma sessão (limiar ${t.patternRepeatInSession}, heurística operacional).`,
      suggestedAction: "Confirme se a redundância do padrão na sessão é intencional.",
    }));

  // saltos de volume entre semanas completas
  for (let i = 0; i + 1 < weekRows.length; i++) {
    const from = weekRows[i];
    const to = weekRows[i + 1];
    if (!from.full || !to.full || from.occurrences !== to.occurrences || from.weighted === null || to.weighted === null || from.weighted <= 0) continue;
    // Rotação irregular (ABC em 4 sessões): semanas com treinos diferentes não se comparam; a diferença seria só a rotação.
    if (labelMix(occs, from.week) !== labelMix(occs, to.week)) continue;
    const fraction = (to.weighted - from.weighted) / from.weighted;
    if (fraction <= t.weekJumpFraction) continue;
    findings.push(finding({
      code: "AUDIT_WEEK_VOLUME_JUMP", severity: "WARNING", status: "OPEN", phaseIndex: p, week: from.week, toWeek: to.week,
      measured: { unit: "WEIGHTED_SETS", value: to.weighted, from: from.weighted, detail: { fraction: r2(fraction) } },
      sourceRefs: [rule("AUDIT_THRESHOLDS"), rule("INDIRECT_VOLUME_FACTOR")],
      rationale: `${where()}: o volume semanal passa de ${numberText(from.weighted)} para ${numberText(to.weighted)} séries ponderadas da semana ${from.week} para a ${to.week} (+${pct(fraction)}; limiar ${pct(t.weekJumpFraction)}, heurística operacional).`,
      suggestedAction: "Confirme se o salto de volume é intencional ou distribua o aumento em mais semanas.",
    }));
  }

  // passo de séries uniforme entre semanas
  for (let i = 0; i + 1 < weekRows.length; i++) setStep(pc, p, weekRows[i].week, p, weekRows[i + 1].week);

  // doses uniformes em exercícios diferentes
  doseUniform(pc, p, checkWeeks[0]);
  doseStimulus(pc, p);
  intensityMissing(pc, p);

  // tempo disponível subutilizado
  for (const w of workoutRows) {
    const lo = occs.filter((o) => o.label === w.label);
    if (!lo.length || w.budgetMinutes === null || lo.some((o) => !o.durationComplete || o.estimatedMinutes === null)) continue;
    const max = Math.max(...lo.map((o) => o.estimatedMinutes as number));
    if (max >= t.durationUnderuseFraction * w.budgetMinutes) continue;
    const source = lo[0].budgetSource;
    findings.push(finding({
      code: "AUDIT_DURATION_UNDERUSED", severity: "INFO", status: "OPEN", phaseIndex: p, label: w.label,
      measured: { unit: "MINUTES", value: max },
      // Faixa de uso esperada: de durationUnderuseFraction × tempo disponível (heurística) até o tempo disponível.
      target: { unit: "MINUTES", min: r2(t.durationUnderuseFraction * w.budgetMinutes), max: w.budgetMinutes, basis: source === "PROFILE" ? "STUDENT_DATA" : "PROFESSIONAL", ruleId: "AUDIT_THRESHOLDS", origin: "AVAILABILITY" },
      sourceRefs: [rule("AUDIT_THRESHOLDS"), rule("DURATION"), `coverage:${p}:${w.label}`],
      rationale: `${where()}: as sessões do treino ${w.label} levam no máximo ≈ ${numberText(max)} min de ${numberText(w.budgetMinutes)} min disponíveis (abaixo de ${pct(t.durationUnderuseFraction)}, heurística operacional).`,
      suggestedAction: "Confirme se sobra tempo de propósito; se não, revise quantidade ou doses.",
    }));
  }
  return phase;
}

/** Treinos da semana, com repetição (ex.: "A,A,B,C"). */
function labelMix(occs: OccurrenceOut[], week: number): string {
  return occs.filter((o) => o.week === week).map((o) => o.label).sort(cmp).join();
}

function sessionsMax(facts: ItemFact[], weeks: number[], m: string): number {
  return Math.max(0, ...weeks.map((w) => sessionsWith(facts, w, (f) => f.secondary.includes(m))));
}

const SHAPE_TEXT: Record<NonNullable<AuditPhase["splitShape"]>, string> = {
  FULL_BODY: "corpo inteiro",
  UPPER_LOWER: "superior e inferior",
  SINGLE: "um treino",
  OTHER: "outro",
};

const REGION_TEXT: Record<string, string> = {
  LOWER: "Membros inferiores",
  UPPER_PUSH: "Superiores (empurrar)",
  UPPER_PULL: "Superiores (puxar)",
  TRUNK: "Tronco",
};

/** Primeira sessão de cada treino numa semana: os itens comparáveis entre semanas. */
function firstItemsOf(facts: ItemFact[], phaseIndex: number, week: number): Map<string, ItemFact> {
  const out = new Map<string, ItemFact>();
  const firstSlot = new Map<string, number>();
  for (const f of facts) {
    if (f.occ.phaseIndex !== phaseIndex || f.occ.week !== week) continue;
    const s = firstSlot.get(f.occ.label);
    if (s === undefined || f.occ.slot < s) firstSlot.set(f.occ.label, f.occ.slot);
  }
  const seen = new Map<string, number>();
  for (const f of facts) {
    if (f.occ.phaseIndex !== phaseIndex || f.occ.week !== week || firstSlot.get(f.occ.label) !== f.occ.slot) continue;
    const ref = `${f.occ.label}|${f.item.exerciseId ?? `custom:${f.item.exerciseName}`}`;
    const k = seen.get(ref) ?? 0;
    seen.set(ref, k + 1);
    out.set(`${ref}|${k}`, f);
  }
  return out;
}

/**
 * Passo de séries: entre duas semanas (ou da última semana de uma fase para a primeira da seguinte), a parcela dos itens com
 * séries definidas dos dois lados que muda as séries pelo mesmo delta. Não lê a origem dos itens.
 */
function setStep(pc: PhaseContext, fromPhase: number, fromWeek: number, toPhase: number, toWeek: number, facts: ItemFact[] = pc.facts): void {
  const before = firstItemsOf(facts, fromPhase, fromWeek);
  const after = firstItemsOf(facts, toPhase, toWeek);
  const deltas = new Map<number, { n: number; from: number; to: number }>();
  let total = 0;
  for (const [key, f] of after) {
    const b = before.get(key);
    if (!b || b.sets === null || f.sets === null) continue;
    total++;
    const d = f.sets - b.sets;
    const cur = deltas.get(d);
    deltas.set(d, { n: (cur?.n ?? 0) + 1, from: cur?.from ?? b.sets, to: cur?.to ?? f.sets });
  }
  if (total < pc.t.uniformMinItems) return;
  let best: [number, { n: number; from: number; to: number }] | null = null;
  for (const e of [...deltas].sort((x, y) => x[0] - y[0])) if (e[0] !== 0 && (!best || e[1].n > best[1].n)) best = e;
  if (!best) return;
  const share = best[1].n / total;
  if (share < pc.t.uniformShare) return;
  const [delta, info] = best;
  const crossPhase = fromPhase !== toPhase;
  pc.findings.push(finding({
    code: "AUDIT_UNIFORM_SET_STEP", severity: "INFO", status: "OPEN", phaseIndex: fromPhase, week: fromWeek,
    ...(crossPhase ? { toPhaseIndex: toPhase } : {}), toWeek,
    measured: { unit: "SHARE", value: r2(share), detail: { delta, from: info.from, to: info.to, items: total } },
    sourceRefs: [rule("AUDIT_THRESHOLDS")],
    rationale: `${crossPhase ? `Fase ${fromPhase}, semana ${fromWeek} → fase ${toPhase}, semana ${toWeek}` : `Fase ${fromPhase}, semana ${fromWeek} → ${toWeek}`}: ${best[1].n} de ${total} exercícios mudam as séries em ${delta > 0 ? "+" : ""}${delta} ao mesmo tempo (ex.: ${info.from} → ${info.to}). Passo igual em exercícios diferentes; as doses não foram alteradas.`,
    suggestedAction: "Confirme se o mesmo passo em todos os exercícios é intencional.",
  }));
}

/** Dose do item partiu do profissional? Lido na base do traço da dose (sem traço = dose que não veio do motor). */
function professionalDose(item: ItemOut, params: string[]): boolean {
  const ps = item.trace.params.filter((x) => params.includes(x.param));
  if (!item.trace.params.length) return true;
  return ps.some((x) => x.basis === "PROFESSIONAL");
}

function doseUniform(pc: PhaseContext, p: number, week: number | undefined): void {
  if (week === undefined) return;
  const items = [...firstItemsOf(pc.facts, p, week).values()].filter((f) => f.item.dose?.metric === "REPS");
  if (items.length < pc.t.uniformMinItems) return;
  const sig = (f: ItemFact) => {
    const d = f.item.dose as Extract<Dose, { metric: "REPS" }>;
    return `${d.reps.min}-${d.reps.max}|${intensityText(d.intensity) ?? ""}|${d.restSeconds ?? ""}`;
  };
  const groups = new Map<string, ItemFact[]>();
  for (const f of items) (groups.get(sig(f)) ?? groups.set(sig(f), []).get(sig(f))!).push(f);
  const [, group] = [...groups].sort((x, y) => y[1].length - x[1].length || cmp(x[0], y[0]))[0];
  const share = group.length / items.length;
  if (share < pc.t.uniformShare) return;
  const profile = (f: ItemFact) => `${f.exercise?.compound ?? "?"}|${f.exercise?.laterality ?? "?"}|${f.item.dose?.metric}`;
  const profiles = new Set(group.map(profile)).size;
  if (profiles < 2) return;
  const fromPolicy = group.filter((f) => f.item.trace.params.some((x) => x.param === "repsMin" && x.ruleId === "DOSE_DEFAULTS")).length > group.length / 2;
  const d = group[0].item.dose as Extract<Dose, { metric: "REPS" }>;
  const text = [`${d.reps.min === d.reps.max ? d.reps.min : `${d.reps.min}–${d.reps.max}`} repetições`, intensityText(d.intensity), d.restSeconds !== null ? `descanso ${d.restSeconds} s` : null].filter(Boolean).join(", ");
  pc.findings.push(finding({
    code: "AUDIT_DOSE_UNIFORM", severity: "INFO", status: "OPEN", phaseIndex: p, week,
    measured: { unit: "SHARE", value: r2(share), detail: { items: group.length, total: items.length, profiles } },
    sourceRefs: [rule("AUDIT_THRESHOLDS"), ...(fromPolicy ? [rule("DOSE_DEFAULTS")] : []), ...group.slice(0, 6).map((f) => `item:${p}:${f.item.slotKey}`)],
    rationale: `Fase ${p}: ${group.length} de ${items.length} exercícios com a mesma dose (${text}) em perfis diferentes (multiarticular, isolado, unilateral…).${fromPolicy ? " Os valores vêm da política padrão de doses (heurística operacional), não de uma escolha por exercício." : ""} As doses não foram alteradas.`,
    suggestedAction: "Revise se a mesma dose serve a exercícios tão diferentes.",
  }));
}

function doseStimulus(pc: PhaseContext, p: number): void {
  const defaults = pc.a.log.get("DOSE_DEFAULTS");
  const groups = new Map<string, { stimulus: string; status: "OPEN" | "BY_DESIGN"; keys: Set<string>; first: Record<string, number> }>();
  for (const f of pc.facts) {
    const dose = f.item.dose;
    const stim = f.occ.stimulus?.value;
    if (!dose || dose.metric !== "REPS" || !stim || !f.exercise?.modality) continue;
    const row = defaults.find((d) => d.stimulus === stim && d.modality === codeOf(f.exercise!.modality!) && d.metric === "REPS");
    const bandMin = row?.values.repsMin;
    const bandMax = row?.values.repsMax;
    if (!row || bandMin === undefined || bandMax === undefined) continue;
    const bandRest = row.values.restSeconds;
    const repsOff = dose.reps.max < bandMin || dose.reps.min > bandMax;
    const rest = dose.restSeconds;
    const restOff = rest !== null && bandRest !== undefined && (Math.min(rest, bandRest) === 0 ? rest !== bandRest : Math.max(rest, bandRest) / Math.min(rest, bandRest) > pc.t.doseRestFactorMax);
    if (!repsOff && !restOff) continue;
    const status = professionalDose(f.item, ["repsMin", "repsMax", "restSeconds"]) ? "BY_DESIGN" : "OPEN";
    const key = `${stim}|${status}`;
    const g = groups.get(key) ?? { stimulus: stim, status, keys: new Set<string>(), first: { repsMin: dose.reps.min, repsMax: dose.reps.max, ...(rest !== null ? { rest } : {}), bandMin, bandMax, ...(bandRest !== undefined ? { bandRest } : {}) } };
    g.keys.add(f.item.slotKey);
    groups.set(key, g);
  }
  for (const g of [...groups.values()].sort((x, y) => cmp(x.stimulus, y.stimulus) || cmp(x.status, y.status))) {
    const d = g.first;
    pc.findings.push(finding({
      code: "AUDIT_DOSE_STIMULUS_MISMATCH", severity: "INFO", status: g.status, phaseIndex: p,
      measured: { unit: "ITEMS", value: g.keys.size, detail: { ...d, items: g.keys.size } },
      sourceRefs: [rule("DOSE_DEFAULTS"), rule("AUDIT_THRESHOLDS"), ...[...g.keys].sort(cmp).slice(0, 6).map((k) => `item:${p}:${k}`)],
      rationale: `Fase ${p}: ${g.keys.size} exercício(s) sob ${STIMULUS_LABELS[g.stimulus] ?? g.stimulus} com ${d.repsMin}–${d.repsMax} repetições${d.rest !== undefined ? ` e ${d.rest} s de descanso` : ""}, longe da faixa da política para o estímulo (${d.bandMin}–${d.bandMax}${d.bandRest !== undefined ? `, ${d.bandRest} s` : ""}; heurística operacional).${g.status === "BY_DESIGN" ? " Dose definida pelo profissional." : ""}`,
      suggestedAction: g.status === "BY_DESIGN" ? null : "Confirme se a dose combina com o estímulo da sessão.",
    }));
  }
}

function intensityMissing(pc: PhaseContext, p: number): void {
  const loadStimuli = new Set(pc.a.log.optional("EXTERNAL_LOAD_STIMULI") ?? []);
  if (!loadStimuli.size) return;
  const keys = new Set<string>();
  for (const f of pc.facts)
    if (f.volume && f.item.dose?.metric === "REPS" && !f.item.dose.intensity && f.occ.stimulus && loadStimuli.has(f.occ.stimulus.value)) keys.add(f.item.slotKey);
  if (!keys.size) return;
  pc.findings.push(finding({
    code: "AUDIT_INTENSITY_MISSING", severity: "INFO", status: "OPEN", phaseIndex: p,
    measured: { unit: "ITEMS", value: keys.size },
    sourceRefs: [rule("EXTERNAL_LOAD_STIMULI"), ...[...keys].sort(cmp).slice(0, 8).map((k) => `item:${p}:${k}`)],
    rationale: `Fase ${p}: ${keys.size} exercício(s) por repetições num estímulo de carga sem intensidade (RIR, PSE ou %1RM).`,
    suggestedAction: "Indique a intensidade para orientar a escolha da carga.",
  }));
}

// ---------- plano inteiro ----------

const NO_THRESHOLDS: AuditThresholds = {
  weekJumpFraction: Number.POSITIVE_INFINITY, phaseJumpFraction: Number.POSITIVE_INFINITY, uniformShare: 2, uniformMinItems: Number.POSITIVE_INFINITY,
  balanceRatioMax: Number.POSITIVE_INFINITY, regionShareMax: Number.POSITIVE_INFINITY, workoutShareMax: Number.POSITIVE_INFINITY,
  durationUnderuseFraction: 0, patternRepeatInSession: Number.POSITIVE_INFINITY, doseRestFactorMax: Number.POSITIVE_INFINITY, maxFindings: Number.POSITIVE_INFINITY,
};

/** Auditoria do plano inteiro. Pura: mesma entrada → mesma saída, byte a byte; não altera nada do que recebe. */
export function auditPlan(a: AuditInput): AuditReport {
  const { log } = a;
  const t = log.optional("AUDIT_THRESHOLDS") ?? NO_THRESHOLDS;
  const volumeModalities = new Set(log.get("VOLUME_MODALITIES").map(codeOf));
  const factor = log.get("INDIRECT_VOLUME_FACTOR");
  const regions = log.optional("AUDIT_REGIONS") ?? {};
  const comprehensiveStimuli = new Set(log.optional("AUDIT_COMPREHENSIVE_STIMULI") ?? []);
  const facts = itemFacts(a, volumeModalities, factor);
  const findings: AuditFinding[] = [];
  const phases: AuditPhase[] = [];
  const phasesMissing: number[] = [];
  const contexts: PhaseContext[] = [];
  for (const summary of [...a.phases].sort((x, y) => x.phaseIndex - y.phaseIndex)) {
    const occs = a.occurrences.filter((o) => o.phaseIndex === summary.phaseIndex).sort((x, y) => x.week - y.week || x.slot - y.slot);
    if (!occs.length) {
      phasesMissing.push(summary.phaseIndex);
      continue;
    }
    const pc: PhaseContext = {
      a, t, factor, regions, comprehensiveStimuli, summary, occs, findings,
      facts: facts.filter((f) => f.occ.phaseIndex === summary.phaseIndex),
      workouts: a.workouts.filter((w) => w.phaseIndex === summary.phaseIndex),
    };
    contexts.push(pc);
    phases.push(auditPhase(pc));
  }
  // entre fases: última semana completa de uma fase → primeira completa da seguinte
  for (let i = 0; i + 1 < phases.length; i++) {
    const from = phases[i];
    const to = phases[i + 1];
    if (to.phaseIndex !== from.phaseIndex + 1) continue;
    const last = [...from.weekRows].reverse().find((w) => w.full);
    const first = to.weekRows.find((w) => w.full);
    if (!last || !first) continue;
    setStep(contexts[i], from.phaseIndex, last.week, to.phaseIndex, first.week, facts);
    if (last.weighted === null || first.weighted === null || last.weighted <= 0) continue;
    const fraction = (first.weighted - last.weighted) / last.weighted;
    if (fraction <= t.phaseJumpFraction) continue;
    findings.push(finding({
      code: "AUDIT_PHASE_VOLUME_JUMP", severity: "WARNING", status: "OPEN", phaseIndex: from.phaseIndex, week: last.week, toPhaseIndex: to.phaseIndex, toWeek: first.week,
      measured: { unit: "WEIGHTED_SETS", value: first.weighted, from: last.weighted, detail: { fraction: r2(fraction), fromOccurrences: last.occurrences, toOccurrences: first.occurrences } },
      sourceRefs: [rule("AUDIT_THRESHOLDS"), rule("INDIRECT_VOLUME_FACTOR")],
      rationale: `Da fase ${from.phaseIndex} (semana ${last.week}, ${last.occurrences} sessões) para a fase ${to.phaseIndex} (semana ${first.week}, ${first.occurrences} sessões), o volume semanal passa de ${numberText(last.weighted)} para ${numberText(first.weighted)} séries ponderadas (+${pct(fraction)}; limiar ${pct(t.phaseJumpFraction)}, heurística operacional).`,
      suggestedAction: "Confirme se o salto entre as fases é intencional.",
    }));
  }
  if (phasesMissing.length)
    findings.push(finding({
      code: "AUDIT_PHASES_NOT_GENERATED", severity: "INFO", status: "OPEN",
      measured: { unit: "ITEMS", value: phasesMissing.length, detail: Object.fromEntries(phasesMissing.map((x) => [`fase ${x}`, x])) },
      sourceRefs: [],
      rationale: `Fases ainda sem sessões geradas: ${phasesMissing.join(", ")}. A auditoria cobre só as fases geradas.`,
      suggestedAction: "Continue a geração para auditar o plano inteiro.",
    }));
  return {
    auditVersion: AUDIT_VERSION, rules: { id: log.rules.id, version: log.rules.version },
    phasesAudited: phases.map((x) => x.phaseIndex), phasesMissing,
    occurrences: a.occurrences.length, datesMissing: a.occurrences.filter((o) => o.plannedDate === null).length,
    phases, findings: sortFindings(findings),
  };
}

const SEVERITY_ORDER: Record<AuditFinding["severity"], number> = { WARNING: 0, INFO: 1 };

function sortFindings(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort((x, y) =>
    SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || (x.phaseIndex ?? 0) - (y.phaseIndex ?? 0) || (x.week ?? 0) - (y.week ?? 0) ||
    cmp(x.code, y.code) || cmp(x.muscle ?? x.pattern ?? "", y.muscle ?? y.pattern ?? "") || cmp(x.label ?? "", y.label ?? "") || cmp(x.rationale, y.rationale));
}

/**
 * Limite técnico (summary_json ≤ 500000): os primeiros `maxFindings` achados ficam um a um; o resto é agrupado por severidade,
 * código e fase, com contagem, mais um AUDIT_AGGREGATED com o total agrupado.
 */
export function boundAudit(log: RuleLog, report: AuditReport): AuditReport {
  const max = log.optional("AUDIT_THRESHOLDS")?.maxFindings ?? Number.POSITIVE_INFINITY;
  const ordered = sortFindings(report.findings);
  if (ordered.length <= max) return { ...report, findings: ordered };
  const kept = ordered.slice(0, max);
  const groups = new Map<string, AuditFinding>();
  let total = 0;
  for (const f of ordered.slice(max)) {
    const n = f.count ?? 1;
    total += n;
    const key = `${f.severity}|${f.code}|${f.phaseIndex ?? ""}`;
    const g = groups.get(key);
    if (g) g.count = (g.count ?? 1) + n;
    else
      groups.set(key, {
        code: f.code, severity: f.severity, status: f.status, stage: "VALIDATION", ...(f.phaseIndex !== undefined ? { phaseIndex: f.phaseIndex } : {}),
        sourceRefs: f.sourceRefs.filter((r) => r.startsWith("rule:")), rationale: cut(`${f.rationale} (e outros iguais)`), suggestedAction: f.suggestedAction, count: n,
      });
  }
  return {
    ...report,
    findings: [...kept, ...sortFindings([...groups.values()]), {
      code: "AUDIT_AGGREGATED", severity: "INFO", status: "DESCRIPTIVE", stage: "VALIDATION", count: total, sourceRefs: [rule("AUDIT_THRESHOLDS")],
      rationale: `${total} achados agrupados por código e fase pelo limite técnico.`, suggestedAction: null,
    }],
  };
}
