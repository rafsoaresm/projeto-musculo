/**
 * Seleção por microciclo (regra MICROCYCLE_SELECTION, 2026.11.4+): a fase inteira é escolhida de uma vez, sabendo quantas
 * vezes cada treino aparece na semana e quanto falta para os alvos semanais do profissional. Pura e determinística.
 *
 * Passo 1: para cada treino, a biblioteca elegível e o que já está fixo (preservados, travados, trocas mantidas numa
 * regeneração, treinos mantidos inteiros). Passo 2: guloso entre todos os treinos de volume, pela pontuação marginal
 * (termos fixos do exercício + déficit semanal, frequência, redundância de padrão e mesmo exercício em outro treino), com
 * desempate estável (ordem dos treinos, depois o código do exercício) e um limite técnico de passos. Treinos de cardio,
 * mobilidade e equilíbrio seguem a seleção antiga: nenhum alvo de hipertrofia pesa neles.
 */
import { resolveDose } from "./dose";
import {
  choiceEntries, completeWorkout, dosePreview, legacyPicks, prepareWorkout, openSlots,
  type EngineContext, type WorkoutDraft, type WorkoutPlan,
} from "./generate";
import { checkWeeksOf, exposuresOf, occurrenceStimulus, indexInWeek, progressionFor, roundExposure, weeklyExposureOf } from "./occurrence";
import { staticTerms, type StaticRequest } from "./select";
import { cmp, codeOf, MUSCLE_LABELS, numberText, PATTERN_LABELS } from "./vocabulary";
import type { CatalogExercise, Dose, Issue, OccurrenceOut, StructurePhase, TraceEntry } from "./types";
import type { MicrocycleSelection } from "./rules";

// ---------- opções (internas: não fazem parte de EngineInput, não mudam o hash da entrada) ----------

/** Contribuição semanal de um treino mantido como está numa regeneração parcial, lida das sessões gravadas (pior semana). */
export interface FixedWorkout {
  exposures: number;
  /** Séries ponderadas por músculo; null = algum item sem séries definidas (vazio nunca é 0). */
  weighted: Record<string, number | null>;
  /** Sessões com o músculo como principal. */
  directSessions: Record<string, number>;
  /** Sessões com o padrão (itens de volume). */
  patterns: Record<string, number>;
  /** Sessões com o exercício. */
  exercises: Record<string, number>;
  /**
   * Exercícios da biblioteca do treino, na ordem da primeira sessão, quando todas as sessões dele na fase têm o mesmo conjunto
   * (o treino como a seleção o deixou). Com isso a seleção refaz as escolhas dele no mesmo passo em que a geração as fez, e
   * regenerar sem mudar nada devolve o mesmo plano. null = sessões diferentes entre si (troca parcial) ou item fora da
   * biblioteca: o treino entra no estado da semana pela soma acima.
   */
  replay: string[] | null;
}

/** Troca do profissional presente em todas as sessões do escopo de uma regeneração: ocupa a vaga e conta no estado. */
export interface ReservedSubstitution {
  exerciseId: string;
  /** O exercício que a troca tirou (decisão do profissional): não volta pela seleção deste treino. */
  replaces: string | null;
}

export interface GenerateOptions {
  /** `fase|treino` → trocas mantidas (só no microciclo). */
  reserved?: ReadonlyMap<string, ReservedSubstitution[]>;
  /** `fase|treino` → treino mantido como está (só no microciclo; regenerações de treino ou sessão). */
  fixedWorkouts?: ReadonlyMap<string, FixedWorkout>;
  /** Índice da fase → exercícios gravados dela, para a variação da fase seguinte quando ela não é planejada nesta chamada. */
  previousPhaseExercises?: ReadonlyMap<number, string[]>;
}

export const laneKey = (phaseIndex: number, label: string) => `${phaseIndex}|${label}`;

// ---------- leitura das sessões ----------

function setsOf(dose: Dose | null): number | null {
  if (!dose) return null;
  return dose.metric === "REPS" || dose.metric === "TIME" || dose.metric === "DISTANCE" ? dose.sets : null;
}

function volumeSet(ctx: EngineContext): ReadonlySet<string> {
  return new Set(ctx.log.get("VOLUME_MODALITIES").map(codeOf));
}

const isVolume = (e: CatalogExercise, vol: ReadonlySet<string>) => Boolean(e.modality && vol.has(codeOf(e.modality)));

/** Músculos e padrões normalizados de um exercício, calculados uma vez (a pontuação roda milhares de vezes por fase). */
interface Shape {
  primary: string[];
  secondary: string[];
  patterns: string[];
}
const shapes = new WeakMap<CatalogExercise, Shape>();
function shapeOf(e: CatalogExercise): Shape {
  let s = shapes.get(e);
  if (!s) {
    const primary = [...new Set(e.primaryMuscles.map(codeOf))].sort(cmp);
    const p = new Set(primary);
    s = { primary, secondary: [...new Set(e.secondaryMuscles.map(codeOf))].filter((m) => !p.has(m)).sort(cmp), patterns: [...new Set(e.patterns.map(codeOf))].sort(cmp) };
    shapes.set(e, s);
  }
  return s;
}
const primaryOf = (e: CatalogExercise) => shapeOf(e).primary;
const secondaryOf = (e: CatalogExercise) => shapeOf(e).secondary;
const patternsOf = (e: CatalogExercise) => shapeOf(e).patterns;

/**
 * O que um treino mantido contribui por semana, a partir das sessões gravadas: em cada semana que conta, a soma das séries e
 * as sessões; depois o menor valor entre as semanas (a mesma regra das exposições). Uma troca que só existe a partir da
 * semana 3 não conta na pior semana. Quando o treino falta em alguma semana que conta (ABCD 3×/semana), a pior semana
 * seria vazia: a conta passa a ser a pior sessão do treino × a média de sessões por semana (`weeklyExposureOf`).
 */
export function fixedWorkoutFrom(ctx: EngineContext, phase: StructurePhase, label: string, occurrences: OccurrenceOut[]): FixedWorkout {
  const vol = volumeSet(ctx);
  const factor = ctx.log.get("INDIRECT_VOLUME_FACTOR");
  const weeks = checkWeeksOf(phase);
  const everyWeek = exposuresOf(phase, label, weeks) > 0;
  const inWeeks = new Set(weeks);
  // Unidades comparadas: as semanas que contam ou, se o treino falta em alguma, cada sessão dele nessas semanas.
  const units: Array<(o: OccurrenceOut) => boolean> = everyWeek
    ? weeks.map((week) => (o: OccurrenceOut) => o.week === week)
    : occurrences
        .filter((o) => o.phaseIndex === phase.index && o.label === label && inWeeks.has(o.week))
        .map((occ) => (o: OccurrenceOut) => o === occ);
  const scale = everyWeek ? 1 : weeklyExposureOf(phase, label, weeks);
  const perWeek = units.map((inUnit) => {
    const weighted = new Map<string, number | null>();
    const direct = new Map<string, Set<number>>();
    const patterns = new Map<string, Set<number>>();
    const exercises = new Map<string, Set<number>>();
    for (const o of occurrences) {
      if (o.phaseIndex !== phase.index || o.label !== label || !inUnit(o)) continue;
      for (const item of o.items) {
        const e = item.exerciseId ? ctx.byId.get(item.exerciseId) : undefined;
        if (!e) continue;
        (exercises.get(e.id) ?? exercises.set(e.id, new Set()).get(e.id)!).add(o.slot);
        if (!isVolume(e, vol)) continue;
        const sets = setsOf(item.dose);
        const bump = (m: string, f: number) => {
          const cur = weighted.has(m) ? weighted.get(m)! : 0;
          weighted.set(m, cur === null || sets === null ? null : cur + sets * f);
        };
        for (const m of primaryOf(e)) {
          bump(m, 1);
          (direct.get(m) ?? direct.set(m, new Set()).get(m)!).add(o.slot);
        }
        for (const m of secondaryOf(e)) bump(m, factor);
        for (const p of patternsOf(e)) (patterns.get(p) ?? patterns.set(p, new Set()).get(p)!).add(o.slot);
      }
    }
    return { weighted, direct, patterns, exercises };
  });
  const minOf = <T,>(pick: (w: (typeof perWeek)[number]) => Map<string, T>, value: (v: T) => number | null) => {
    const keys = [...new Set(perWeek.flatMap((w) => [...pick(w).keys()]))].sort(cmp);
    const out: Record<string, number | null> = {};
    for (const k of keys) {
      let min: number | null = Infinity;
      for (const w of perWeek) {
        const m = pick(w);
        const v = m.has(k) ? value(m.get(k) as T) : 0;
        if (v === null || min === null) min = null;
        else min = Math.min(min, v);
      }
      out[k] = min === Infinity ? 0 : min === null ? null : roundExposure(min * scale);
    }
    return out;
  };
  const counts = (r: Record<string, number | null>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? 0])) as Record<string, number>;
  return {
    replay: replayOf(ctx, occurrences.filter((o) => o.phaseIndex === phase.index && o.label === label)),
    exposures: weeklyExposureOf(phase, label, weeks),
    weighted: minOf((w) => w.weighted, (v) => v),
    directSessions: counts(minOf((w) => w.direct, (v) => v.size)),
    patterns: counts(minOf((w) => w.patterns, (v) => v.size)),
    exercises: counts(minOf((w) => w.exercises, (v) => v.size)),
  };
}

/** Lista para refazer as escolhas de um treino mantido (ver `FixedWorkout.replay`). */
function replayOf(ctx: EngineContext, occs: OccurrenceOut[]): string[] | null {
  if (!occs.length) return null;
  const idsOf = (o: OccurrenceOut): string[] | null => {
    const ids: string[] = [];
    for (const item of o.items) {
      if (!item.exerciseId || !ctx.byId.has(item.exerciseId)) return null;
      ids.push(item.exerciseId);
    }
    return ids;
  };
  const first = idsOf(occs[0]);
  if (!first) return null;
  const key = [...first].sort(cmp).join("|");
  for (const o of occs.slice(1)) {
    const ids = idsOf(o);
    if (!ids || [...ids].sort(cmp).join("|") !== key) return null;
  }
  return first;
}

// ---------- estado da semana ----------

interface MuscleTarget {
  muscle: string;
  /** Treinos (índices) em que o alvo pesa: os que têm o músculo na própria cobertura. */
  scope: Set<number>;
  minWeighted?: number;
  maxWeighted?: number;
  minSessions: number;
  /** O alvo vale só em parte dos treinos de volume (foco do treino): mantém o foco depois do déficit atendido. */
  focused: boolean;
}

interface Lane {
  i: number;
  draft: WorkoutDraft;
  vol: boolean;
  x: number;
  remaining: number;
  fixed: FixedWorkout | null;
  /**
   * Treino mantido cujas escolhas são refeitas no guloso: só os exercícios gravados podem ser escolhidos, mas todos os
   * candidatos são pontuados (o empate e a ordem dos passos ficam como na geração). Nada dele sai na regeneração.
   */
  replay: boolean;
  /** Exercícios que um treino em `replay` pode escolher (os gravados). */
  allowed: ReadonlySet<string> | null;
  /** Exercícios da biblioteca no treino (fixos e escolhidos), na ordem. */
  chosen: CatalogExercise[];
  ids: Set<string>;
  picks: Array<{ exercise: CatalogExercise; selection: TraceEntry[] }>;
  candidates: CatalogExercise[];
  primaryHere: Set<string>;
  /** Padrões dos exercícios já no treino (fixos e escolhidos). */
  patternsHere: Set<string>;
  /** Treino de volume sem nenhum alvo no seu escopo: soma o termo "sem alvos" (como antes). */
  noTargets: boolean;
  staticMemo: Map<string, { score: number; trace: TraceEntry[] }>;
  setsMemo: Map<string, number | null>;
  refOcc: { week: number; stimulus: string | null } | null;
}

class WeekState {
  readonly weighted = new Map<string, number>();
  readonly unknown = new Set<string>();
  readonly directSessions = new Map<string, number>();
  readonly patternExposure = new Map<string, number>();
  /** Exercício → exposições semanais por treino (índice). */
  readonly holders = new Map<string, Map<number, number>>();

  w(m: string): number {
    return this.weighted.get(m) ?? 0;
  }
  ds(m: string): number {
    return this.directSessions.get(m) ?? 0;
  }
  pe(p: string): number {
    return this.patternExposure.get(p) ?? 0;
  }
  hold(id: string, lane: number, x: number): void {
    const m = this.holders.get(id) ?? this.holders.set(id, new Map()).get(id)!;
    m.set(lane, roundExposure((m.get(lane) ?? 0) + x));
  }
  /** Somas arredondadas (exposições podem ser frações: treino que não aparece toda semana). */
  addWeighted(m: string, v: number): void {
    this.weighted.set(m, roundExposure(this.w(m) + v));
  }
  addDirect(m: string, v: number): void {
    this.directSessions.set(m, roundExposure(this.ds(m) + v));
  }
  addPattern(p: string, v: number): void {
    this.patternExposure.set(p, roundExposure(this.pe(p) + v));
  }
  otherHolders(id: string, lane: number): number {
    const m = this.holders.get(id);
    if (!m) return 0;
    let n = 0; // a ordem dos treinos é fixa (inserção): a soma é a mesma a cada execução
    for (const [l, x] of m) if (l !== lane) n += x;
    return roundExposure(n);
  }
}

// ---------- pontuação ----------

const muscleText = (m: string) => MUSCLE_LABELS[m] ?? m;
const patternText = (p: string) => PATTERN_LABELS[p] ?? p;
/** Exposição fracionária = treino que não aparece em toda semana: o texto diz que é uma média. */
const avg = (n: number) => (Number.isInteger(n) ? "" : " em média");
const sessions = (n: number) => `${numberText(n)} ${n === 1 ? "sessão" : "sessões"}${avg(n)}`;
const weeklySessions = (n: number) => `${numberText(n)} ${n === 1 ? "sessão semanal" : "sessões semanais"}${avg(n)}`;

interface Scored {
  score: number;
  trace: TraceEntry[];
}

/**
 * Termos que dependem do estado da semana. Sem `withTrace`, só a soma (o texto de cada termo só é montado para a escolha
 * feita, com os mesmos números: a pontuação é a mesma nos dois modos).
 */
function dynamicTerms(
  ctx: EngineContext, M: MicrocycleSelection, lane: Lane, e: CatalogExercise, s: number | null, state: WeekState,
  muscles: ReadonlyMap<string, MuscleTarget>, patterns: ReadonlyMap<string, Set<number>>, spw: number, factor: number, withTrace: boolean,
): Scored {
  const trace: TraceEntry[] = [];
  let total = 0;
  const basis = ctx.log.basis("MICROCYCLE_SELECTION");
  const add = (value: number, code: string, detail: () => string) => {
    if (!value) return;
    total += value;
    if (withTrace) trace.push({ code, basis, ruleId: "MICROCYCLE_SELECTION", detail: `${detail()} (${value > 0 ? "+" : ""}${numberText(value)})` });
  };
  const { x } = lane;
  const label = lane.draft.workout.label;
  const primary = primaryOf(e);
  const secondary = secondaryOf(e);
  for (const m of primary) {
    const t = muscles.get(m);
    if (!t || !t.scope.has(lane.i)) continue;
    const setsKnown = t.minWeighted !== undefined && s !== null && !state.unknown.has(m);
    if (setsKnown) {
      const min = t.minWeighted as number;
      const deficit = roundExposure(Math.max(0, min - state.w(m)));
      const adds = roundExposure(x * (s as number));
      const gain = Math.min(adds, deficit);
      if (gain > 0)
        add(M.weeklyDeficit * gain / Math.max(1, min), "MICRO_TARGET_DEFICIT",
          () => `${muscleText(m)} abaixo do alvo semanal: faltavam ${numberText(deficit)} séries ponderadas; este exercício soma ${numberText(adds)} (${sessions(x)} do treino ${label} × ${numberText(s as number)} séries)`);
      const ds = state.ds(m);
      if (ds < t.minSessions && !lane.primaryHere.has(m)) {
        const g = roundExposure(Math.min(x, t.minSessions - ds));
        add(M.frequencyGap * g, "MICRO_FREQUENCY", () => `${muscleText(m)}: ${numberText(ds)} de ${numberText(t.minSessions)} sessões semanais com estímulo direto; o treino ${label} soma ${numberText(g)}`);
      }
    } else if (!lane.primaryHere.has(m)) {
      // Alvo de presença (ou séries desconhecidas): o déficit é em sessões com estímulo direto na semana.
      const deficit = roundExposure(Math.max(0, t.minSessions - state.ds(m)));
      const g = roundExposure(Math.min(x, deficit));
      const unknownNote = t.minWeighted !== undefined ? "; séries não definidas: alvo de séries não usado" : "";
      // Cada sessão semanal que falta vale um déficit inteiro (como um alvo de uma sessão).
      if (g > 0)
        add(M.weeklyDeficit * g, "MICRO_TARGET_DEFICIT",
          () => `${muscleText(m)}: ${deficit === 1 ? "faltava" : "faltavam"} ${weeklySessions(deficit)} com estímulo direto; o treino ${label} soma ${numberText(g)} (aparece ${numberText(x)}× por semana${avg(x)})${unknownNote}`);
    }
  }
  const own = primary.filter((m) => { const t = muscles.get(m); return t?.focused && t.scope.has(lane.i); });
  if (own.length) add(M.targetAffinity, "MICRO_TARGET_AFFINITY", () => `Mantém o foco do treino ${label} (músculo-alvo dele): ${own.map(muscleText).join(", ")}`);
  for (const m of secondary) {
    const t = muscles.get(m);
    if (!t || !t.scope.has(lane.i) || t.minWeighted === undefined || s === null || state.unknown.has(m)) continue;
    const deficit = roundExposure(Math.max(0, t.minWeighted - state.w(m)));
    const adds = roundExposure(x * s * factor);
    const gain = Math.min(adds, deficit);
    if (gain > 0)
      add(M.weeklyDeficit * gain / Math.max(1, t.minWeighted), "MICRO_TARGET_DEFICIT_SECONDARY",
        () => `${muscleText(m)} (secundário) abaixo do alvo semanal: faltavam ${numberText(deficit)} séries ponderadas; este exercício soma ${numberText(adds)} (peso ${numberText(factor)})`);
  }
  if (s !== null)
    for (const m of [...primary, ...secondary]) {
      const max = muscles.get(m)?.maxWeighted;
      if (max === undefined || state.unknown.has(m)) continue;
      const adds = roundExposure(x * s * (primary.includes(m) ? 1 : factor));
      const excess = roundExposure(Math.min(adds, Math.max(0, state.w(m) + adds - max)));
      if (excess > 0)
        add(M.overTarget * excess / Math.max(1, max), "MICRO_OVER_TARGET",
          () => `${muscleText(m)} passaria do máximo semanal de ${numberText(max)} séries ponderadas em ${numberText(excess)}`);
    }
  const here = lane.patternsHere;
  for (const p of patternsOf(e)) {
    const exposure = state.pe(p);
    const scope = patterns.get(p);
    if (scope?.has(lane.i)) {
      if (exposure === 0) add(M.weeklyPatternNew, "MICRO_PATTERN_NEW", () => `Padrão-alvo ${patternText(p)} ainda sem sessão na semana`);
      else add(M.weeklyPatternRepeat, "MICRO_PATTERN_REPEAT", () => `Padrão-alvo ${patternText(p)} já presente em ${sessions(exposure)} da semana`);
    } else if (exposure > 0) {
      // Repetir o padrão na mesma sessão pesa o dobro: as sessões deste treino já o têm (o que a auditoria descreve como repetição na sessão).
      const sameSession = here.has(p) ? x : 0;
      add(M.weeklyPatternRedundancy * (exposure + sameSession) / Math.max(1, spw), "MICRO_REDUNDANCY",
        () => `Padrão ${patternText(p)} (fora dos alvos) já presente em ${sessions(exposure)} da semana, de ${numberText(spw)}${sameSession ? `, inclusive neste treino` : ""}`);
    }
  }
  const others = state.otherHolders(e.id, lane.i);
  if (others > 0) add(M.sameExerciseWeekly * others, "MICRO_SAME_EXERCISE", () => `Já está em outro treino da fase (${sessions(others)} por semana); repetir é permitido`);
  return { score: total, trace };
}

// ---------- fase ----------

export interface MicrocyclePlan {
  plans: WorkoutPlan[];
  /** Avisos da fase (alvos da fase conferidos uma vez na fase). */
  issues: Issue[];
  /** Passos do guloso (para teste e medição): nunca passa de MICROCYCLE_SELECTION.maxSteps. */
  steps: number;
}

/**
 * Planeja todos os treinos de uma fase. `usedInPreviousPhase` = exercícios da fase anterior (variação). Treinos em
 * `options.fixedWorkouts` não recebem escolhas: entram só no estado da semana, com o que está gravado.
 */
export function planPhaseMicrocycle(ctx: EngineContext, phase: StructurePhase, usedInPreviousPhase: ReadonlySet<string>, options: GenerateOptions = {}): MicrocyclePlan {
  const { input, log } = ctx;
  const M = log.optional("MICROCYCLE_SELECTION") as MicrocycleSelection;
  const W = log.get("SELECTION_WEIGHTS");
  const factor = log.get("INDIRECT_VOLUME_FACTOR");
  const vol = volumeSet(ctx);
  const spw = Math.max(1, phase.sessionsPerWeek);
  const weeks = checkWeeksOf(phase);
  const staticReq = (draft: WorkoutDraft): StaticRequest => ({
    stimulus: draft.stimulus?.value ?? null, preferred: new Set(input.parameters.preferredExerciseIds), experience: ctx.experience,
    history: ctx.history, usedInPreviousPhase, avoid: new Set(),
  });

  // ---- passo 1: rascunhos, exposições, fixos ----
  const lanes: Lane[] = phase.workouts.map((workout, i) => {
    const key = laneKey(phase.index, workout.label);
    const fixed = options.fixedWorkouts?.get(key) ?? null;
    const draft = prepareWorkout(ctx, phase, workout, fixed ? [] : options.reserved?.get(key) ?? []);
    const volLane = Boolean(draft.modalities?.value.some((m) => vol.has(codeOf(m))));
    const occ0 = draft.occs[0];
    const stim0 = occ0 ? occurrenceStimulus(input, phase, workout, occ0.week, indexInWeek(phase, occ0)) : null;
    const candidates = draft.pool.filter((e) => !draft.taken.has(e.id) && !draft.blocked.has(e.id));
    let remaining = fixed ? 0 : openSlots(draft);
    let replay = false;
    let allowed: Set<string> | null = null;
    // Treino mantido igual em todas as sessões: as escolhas dele são refeitas só entre os exercícios gravados, no passo em
    // que a seleção as faria. Sem isso, a soma dele entraria inteira antes do guloso e os outros treinos escolheriam diferente
    // da geração com a mesma entrada. Se algum exercício gravado não é mais candidato, a soma (`fixed`) vale.
    if (fixed?.replay && volLane && draft.runnable) {
      const want = fixed.replay.filter((id) => !draft.taken.has(id));
      const wanted = new Set(want);
      const restricted = candidates.filter((e) => wanted.has(e.id));
      if (want.length === wanted.size && restricted.length === wanted.size) {
        allowed = wanted;
        remaining = restricted.length;
        replay = true;
      }
    }
    return {
      i, draft, vol: volLane, x: weeklyExposureOf(phase, workout.label, weeks), remaining, fixed, replay, allowed,
      chosen: draft.slots.map((s) => s.exercise).filter((e): e is CatalogExercise => e !== null),
      ids: new Set(draft.taken), picks: [],
      candidates,
      primaryHere: new Set(), patternsHere: new Set(draft.slots.flatMap((sl) => (sl.exercise ? patternsOf(sl.exercise) : []))), noTargets: false, staticMemo: new Map(), setsMemo: new Map(),
      refOcc: occ0 ? { week: occ0.week, stimulus: stim0?.value ?? null } : null,
    };
  });
  const refSets = (lane: Lane, e: CatalogExercise): number | null => {
    if (lane.setsMemo.has(e.id)) return lane.setsMemo.get(e.id) as number | null;
    const ref = lane.refOcc;
    const v = ref
      ? setsOf(resolveDose(log, input.parameters, {
          exercise: e, stimulus: ref.stimulus, phaseIndex: phase.index, label: lane.draft.workout.label, week: ref.week,
          phaseWeeks: phase.weeks, progression: progressionFor(input, phase),
        }).dose)
      : null;
    lane.setsMemo.set(e.id, v);
    return v;
  };

  // Alvos da fase, com o escopo de cada um: os treinos de volume cuja própria cobertura tem o músculo ou o padrão.
  const muscles = new Map<string, MuscleTarget>();
  const weeklyScope = new Map<string, Set<number>>();
  const patternTargets = new Map<string, Set<number>>();
  for (const lane of lanes) {
    const c = lane.draft.coverage;
    if (!c || !lane.vol) continue;
    for (const m of c.muscles.map(codeOf)) {
      const t = muscles.get(m) ?? muscles.set(m, { muscle: m, scope: new Set(), minSessions: 1, focused: false }).get(m)!;
      t.scope.add(lane.i);
    }
    for (const p of c.patterns.map(codeOf)) (patternTargets.get(p) ?? patternTargets.set(p, new Set()).get(p)!).add(lane.i);
    for (const ws of c.weeklySets ?? []) {
      const m = codeOf(ws.muscle);
      const t = muscles.get(m) ?? muscles.set(m, { muscle: m, scope: new Set(), minSessions: 1, focused: false }).get(m)!;
      if (ws.minWeighted !== undefined) t.minWeighted = ws.minWeighted;
      if (ws.maxWeighted !== undefined) t.maxWeighted = ws.maxWeighted;
      t.minSessions = Math.max(1, ws.minDirectSessions ?? 1);
      (weeklyScope.get(m) ?? weeklyScope.set(m, new Set()).get(m)!).add(lane.i);
    }
  }
  // Um músculo só com alvo semanal (sem estar na lista de músculos) pesa nos treinos que receberam esse alvo.
  for (const [m, t] of muscles) if (!t.scope.size) for (const i of weeklyScope.get(m) ?? []) t.scope.add(i);
  const volumeCount = lanes.filter((l) => l.vol).length;
  for (const t of muscles.values()) t.focused = t.scope.size < volumeCount;
  for (const lane of lanes)
    lane.noTargets = lane.vol && ![...muscles.values()].some((t) => t.scope.has(lane.i)) && ![...patternTargets.values()].some((s) => s.has(lane.i));

  // Estado da semana com o que já está fixo: linhas preservadas (séries gravadas), travados e trocas (séries da semana de
  // referência) e treinos mantidos inteiros (o que está gravado). Séries vazias contam só como presença.
  const state = new WeekState();
  const put = (lane: Lane, e: CatalogExercise, sets: number | null) => {
    state.hold(e.id, lane.i, lane.x);
    if (!lane.vol || !isVolume(e, vol)) return;
    for (const m of primaryOf(e)) {
      if (sets === null) state.unknown.add(m);
      else state.addWeighted(m, lane.x * sets);
      if (!lane.primaryHere.has(m)) {
        lane.primaryHere.add(m);
        state.addDirect(m, lane.x);
      }
    }
    for (const m of secondaryOf(e)) {
      if (sets === null) state.unknown.add(m);
      else state.addWeighted(m, lane.x * sets * factor);
    }
    for (const p of patternsOf(e)) state.addPattern(p, lane.x);
  };
  for (const lane of lanes) {
    if (lane.fixed && !lane.replay) {
      const f = lane.fixed;
      for (const [id, n] of Object.entries(f.exercises)) state.hold(id, lane.i, n);
      if (!lane.vol) continue;
      for (const [m, v] of Object.entries(f.weighted)) {
        if (v === null) state.unknown.add(m);
        else state.addWeighted(m, v);
      }
      for (const [m, n] of Object.entries(f.directSessions)) {
        if (n > 0) lane.primaryHere.add(m);
        state.addDirect(m, n);
      }
      for (const [p, n] of Object.entries(f.patterns)) state.addPattern(p, n);
      continue;
    }
    for (const slot of lane.draft.slots) {
      if (!slot.exercise) continue;
      put(lane, slot.exercise, slot.existing ? setsOf(slot.existing.dose) : refSets(lane, slot.exercise));
    }
  }

  // ---- passo 2: guloso entre os treinos de volume ----
  const minimum = log.get("COUNT_FROM_TIME").minimum;
  const volumeLanes = lanes.filter((l) => l.vol && (!l.fixed || l.replay) && l.draft.runnable);
  let steps = 0;
  const scoreOf = (lane: Lane, e: CatalogExercise, withTrace: boolean): Scored & { parts: TraceEntry[] } => {
    let st = lane.staticMemo.get(e.id);
    if (!st) {
      st = staticTerms(log, e, staticReq(lane.draft));
      lane.staticMemo.set(e.id, st);
    }
    const noT: TraceEntry[] = lane.noTargets && W.noTargets
      ? [{ code: "NO_TARGETS", basis: log.basis("SELECTION_WEIGHTS"), ruleId: "SELECTION_WEIGHTS", detail: `Treino sem alvos: entra pela elegibilidade (+${numberText(W.noTargets)})` }]
      : [];
    const dyn = isVolume(e, vol)
      ? dynamicTerms(ctx, M, lane, e, refSets(lane, e), state, muscles, patternTargets, spw, factor, withTrace)
      : { score: 0, trace: [] };
    return { score: dyn.score + (lane.noTargets ? W.noTargets : 0) + st.score, trace: [], parts: withTrace ? [...dyn.trace, ...noT, ...st.trace] : [] };
  };
  while (steps < M.maxSteps) {
    type Best = { lane: Lane; e: CatalogExercise; score: number; parts: TraceEntry[]; tie: boolean };
    // `top`: o melhor entre todos os candidatos (como na geração); `best`: o melhor que pode ser escolhido (um treino mantido
    // só escolhe os exercícios gravados). Sem mudança na entrada, os dois coincidem; com mudança, vale o que pode ser escolhido.
    let top: Best | null = null;
    let best: Best | null = null;
    for (const lane of volumeLanes) {
      if (lane.remaining <= 0) continue;
      let any = false;
      for (const e of lane.candidates) {
        if (lane.ids.has(e.id)) continue;
        const s = scoreOf(lane, e, false);
        if (!top || s.score > top.score) top = { lane, e, score: s.score, parts: s.parts, tie: false };
        else if (s.score === top.score) top.tie = true;
        if (lane.allowed && !lane.allowed.has(e.id)) continue;
        any = true;
        if (!best || s.score > best.score) best = { lane, e, score: s.score, parts: s.parts, tie: false };
        else if (s.score === best.score) best.tie = true;
      }
      if (!any) lane.remaining = 0;
    }
    if (!best) break;
    if (top && top.lane === best.lane && top.e === best.e) best = top;
    steps++;
    const { lane, e } = best;
    const draft = lane.draft;
    if (!lane.replay && draft.count === "BY_TIME" && lane.picks.length + draft.slots.length >= minimum) {
      const minutes = dosePreview(ctx, { phase, workout: draft.workout }, [...lane.chosen, e], draft.preserved);
      if (minutes === null || !draft.budget || minutes > draft.budget.minutes) {
        lane.remaining = 0;
        continue;
      }
    }
    const rank = lane.picks.length + 1;
    best.parts = lane.replay ? [] : scoreOf(lane, e, true).parts;
    lane.picks.push({
      exercise: e,
      selection: lane.replay ? [] : [
        ...choiceEntries(ctx, draft, e), ...best.parts,
        { code: "RANK", basis: log.basis("MICROCYCLE_SELECTION"), ruleId: "MICROCYCLE_SELECTION",
          detail: `Escolha ${rank} do treino ${draft.workout.label} pela pontuação ${numberText(best.score)} (seleção da fase inteira, passo ${steps})${best.tie ? "; empate desfeito pela ordem dos treinos e pelo código do exercício" : ""}.` },
      ],
    });
    lane.chosen.push(e);
    lane.ids.add(e.id);
    for (const p of patternsOf(e)) lane.patternsHere.add(p);
    lane.remaining--;
    put(lane, e, refSets(lane, e));
  }
  const stepLimited = new Set(volumeLanes.filter((l) => !l.fixed && l.remaining > 0 && l.candidates.some((e) => !l.ids.has(e.id))).map((l) => l.i));

  // ---- treinos que não são de volume: seleção antiga, na ordem da estrutura ----
  const usedInPhase = new Set<string>();
  for (const lane of lanes) for (const e of lane.chosen) if (lane.vol || lane.fixed) usedInPhase.add(e.id);
  for (const lane of lanes) {
    if (lane.vol || lane.fixed) continue;
    lane.picks = legacyPicks(ctx, lane.draft, usedInPhase, usedInPreviousPhase);
    for (const s of lane.draft.slots) if (s.exercise) usedInPhase.add(s.exercise.id);
    for (const p of lane.picks) usedInPhase.add(p.exercise.id);
  }

  const plans = lanes.map((lane) =>
    completeWorkout(ctx, lane.draft, lane.picks, { phaseTargets: "SKIP", stepLimited: stepLimited.has(lane.i), fixed: lane.fixed !== null }));

  // ---- alvos da fase: conferidos uma vez na fase (em algum treino) ----
  const issues: Issue[] = [];
  const inPhase: CatalogExercise[] = [];
  for (const [n, lane] of lanes.entries()) {
    if (lane.fixed) for (const id of Object.keys(lane.fixed.exercises).sort(cmp)) {
      const e = ctx.byId.get(id);
      if (e && lane.fixed.exercises[id] > 0) inPhase.push(e);
    }
    else for (const s of plans[n].slots) if (s.exercise) inPhase.push(s.exercise);
  }
  const phaseMuscles = new Set<string>();
  const phasePatterns = new Set<string>();
  for (const lane of lanes) {
    const c = lane.draft.coverage;
    if (c?.origin !== "PHASE_COVERAGE") continue;
    c.muscles.forEach((m) => phaseMuscles.add(codeOf(m)));
    c.patterns.forEach((p) => phasePatterns.add(codeOf(p)));
  }
  const path = `phases.${phase.index}.coverage`;
  const at = { phaseIndex: phase.index, stage: "SELECTION" as const };
  for (const m of [...phaseMuscles].sort(cmp))
    if (!inPhase.some((e) => primaryOf(e).includes(m)))
      issues.push({ severity: "WARNING", code: "MUSCLE_NOT_COVERED", path, ...at, message: `Fase ${phase.index}: ${muscleText(m)} sem exercício como músculo principal em nenhum treino.` });
  for (const p of [...phasePatterns].sort(cmp))
    if (!inPhase.some((e) => patternsOf(e).includes(p)))
      issues.push({ severity: "WARNING", code: "PATTERN_NOT_COVERED", path, ...at, message: `Fase ${phase.index}: padrão ${patternText(p)} sem exercício em nenhum treino.` });
  return { plans, issues, steps };
}
