/**
 * What the proposal review shows about the accepted strategy (Figma RX-01 and M-02, design V4 §7.5): the workout's focus and whether the
 * sessions respect it, the row title by movement pattern, the three "Por quê?" cards (focus, dose, weekly audit) with their provenance
 * pills, the "Estratégia" section of the audit, the stages of a generation and the confirmation before a strategy is redone. Pure: no React,
 * no I/O, no `server-only`. Everything is read from what the proposal and its audit already record; nothing is invented, and no text of a
 * model ever reaches these strings (labels come from fixed tables).
 */
import type { AuditReport, BlueprintSource, StrategyAdherence, VolumeRow, WorkoutSummary } from "../motor/types";
import { MUSCLE_LABELS, PATTERN_LABELS, codeOf, numberText } from "../motor/vocabulary";
import { ORIGIN_LABELS, ROLE_LABELS, type OriginKind } from "./blueprint-view";
import { changeIfText, type ItemWhy, type ProvenancePill } from "./view";

/** True when at least one workout of the proposal was generated from an accepted strategy (the review then shows focus and justifications). */
export function hasStrategy(workouts: readonly Pick<WorkoutSummary, "coverage">[]): boolean {
  return workouts.some((w) => w.coverage?.origin === "BLUEPRINT_FOCUS" && Boolean(w.coverage.blueprint));
}

// ---------- headings ----------

export interface ReviewHeading {
  title: string;
  sub: string;
  phoneTitle: string;
  phoneSub: string;
}

/**
 * H1 of the review. A proposal with a strategy is "Revisar prescrição e justificativas" ("Revisar estratégia e treino" on the phone, M-02);
 * a proposal without one (the previous generation) keeps its heading as it was.
 */
export function reviewHeading(strategy: boolean, ctx: { student: string; strategyName: string | null; weeks: number }): ReviewHeading {
  const weeks = `${ctx.weeks} ${ctx.weeks === 1 ? "semana" : "semanas"}`;
  if (!strategy)
    return {
      title: "Prescrição automática",
      sub: "Proposta gerada para revisão profissional. Nenhuma alteração foi aplicada ao aluno.",
      phoneTitle: "Prescrição automática",
      phoneSub: `${ctx.student} • ${weeks}`,
    };
  return {
    title: "Revisar prescrição e justificativas",
    sub: "Proposta por foco e doses; valores exigem revisão técnica.",
    phoneTitle: "Revisar estratégia e treino",
    phoneSub: [ctx.student, ctx.strategyName, weeks].filter(Boolean).join(" · "),
  };
}

// ---------- stages ----------

export type StageId = "STRATEGY" | "BUILDING" | "AUDIT" | "READY";
export const STAGES: ReadonlyArray<{ id: StageId; label: string }> = [
  { id: "STRATEGY", label: "Gerando estratégia" },
  { id: "BUILDING", label: "Montando prescrição" },
  { id: "AUDIT", label: "Auditoria" },
  { id: "READY", label: "Pronta para revisão" },
];

export interface StageItem {
  id: StageId;
  label: string;
  state: "done" | "current" | "todo";
}

/** The four states of a generation as a list: the ones before `current` are done, `current` is the one running (null = none started). */
export function generationStages(current: StageId | null): StageItem[] {
  const at = current === null ? -1 : STAGES.findIndex((s) => s.id === current);
  return STAGES.map((s, n) => ({ ...s, state: n < at ? "done" : n === at ? "current" : "todo" }));
}

export interface ReviewStage {
  id: StageId;
  label: string;
  tone: "brand" | "warning" | "neutral";
  /** Why, in one sentence, when the proposal is not ready yet. */
  note: string | null;
}

/**
 * Where a proposal stands: still being built (phases missing), waiting for its audit, or ready for the professional's review. "Ready" never
 * means approved or applied: it only says the generation and its audit are complete.
 */
export function reviewStage(input: { complete: boolean; audited: boolean }): ReviewStage {
  if (!input.complete) return { id: "BUILDING", label: "Montando prescrição", tone: "warning", note: "Faltam fases: continue a geração antes de aplicar." };
  if (!input.audited) return { id: "AUDIT", label: "Auditoria", tone: "warning", note: "Auditoria pendente: ela é calculada na tela, sem gravar." };
  return { id: "READY", label: "Pronta para revisão", tone: "brand", note: null };
}

// ---------- the workout's focus ----------

export interface WorkoutFocusView {
  role: string;
  roleLabel: string;
  source: BlueprintSource;
  originLabel: string;
  strategyId: string;
  dominant: string[];
  supporting: string[];
  patterns: string[];
}

const muscleName = (code: string) => MUSCLE_LABELS[codeOf(code)] ?? MUSCLE_LABELS[code] ?? code;
const patternName = (code: string) => PATTERN_LABELS[codeOf(code)] ?? PATTERN_LABELS[code] ?? code;

/** The focus the accepted strategy gave the workout, or null when it has none (workouts of the previous generation, or the strategy left it free). */
export function workoutFocus(workout: Pick<WorkoutSummary, "coverage"> | null): WorkoutFocusView | null {
  const c = workout?.coverage;
  const b = c?.origin === "BLUEPRINT_FOCUS" ? c.blueprint : undefined;
  if (!c || !b) return null;
  return {
    role: b.role,
    roleLabel: ROLE_LABELS[b.role] ?? b.role,
    source: b.source,
    originLabel: ORIGIN_LABELS[b.source],
    strategyId: b.strategyId,
    dominant: c.muscles.map(muscleName),
    supporting: b.supporting.map(muscleName),
    patterns: c.patterns.map(patternName),
  };
}

/** "Treino A · Superior" (title of the session card): the workout's letter and the role of the accepted strategy, only the letter without one. */
export function sessionTitle(label: string, workout: Pick<WorkoutSummary, "coverage" | "name"> | null): string {
  const focus = workoutFocus(workout);
  const named = workout?.name?.trim();
  return `Treino ${label}${focus ? ` · ${focus.roleLabel}` : named ? ` · ${named}` : ""}`;
}

export type FocusChipKind = "RESPECTED" | "OFF_FOCUS";
export interface FocusChip {
  kind: FocusChipKind;
  text: string;
  /** Items of the session that fall outside the focus (the number the warning chip shows). */
  offFocus: number;
}

/**
 * "Foco respeitado" when the week's adherence of this workout reaches the rule's minimum; "Fora do foco: N" (warning) otherwise. Read from the
 * recorded audit (`strategy.workouts[].weeks`); null when the audit has no row for that workout and week (a very long plan keeps the weeks with
 * the lowest adherence only) or the workout has no strategy focus. Never inferred from the session's items here.
 */
export function sessionFocusChip(strategy: StrategyAdherence | undefined, phaseIndex: number, label: string, week: number, adherenceMin: number | null): FocusChip | null {
  const w = strategy?.workouts.find((x) => x.phaseIndex === phaseIndex && x.label === label);
  const row = w?.weeks.find((x) => x.week === week);
  if (!row || row.items === 0) return null;
  const respected = row.adherence !== null && (adherenceMin === null ? row.offFocus === 0 : row.adherence >= adherenceMin);
  return respected ? { kind: "RESPECTED", text: "Foco respeitado", offFocus: row.offFocus } : { kind: "OFF_FOCUS", text: `Fora do foco: ${row.offFocus}`, offFocus: row.offFocus };
}

// ---------- phone summary (M-02) ----------

export interface PhoneReviewCard {
  id: "focus" | "doses";
  title: string;
  line: string;
  meta: string;
  highlighted: boolean;
}

/**
 * The cards of M-02 above the session list: "Foco respeitado" (or "Fora do foco: N") with the workout's patterns and its sessions in the week, and
 * "Doses a revisar". The dose card says "individualizadas" only when some item of the session carries a dose profile in its trace; otherwise it
 * says the doses follow the generic stimulus default. ("Ajustar com IA" is the assisted-adjustment entry of a later sub-stage and is not drawn here.)
 */
export function phoneReviewCards(input: {
  workout: Pick<WorkoutSummary, "coverage"> | null;
  chip: FocusChip | null;
  sessionsInWeek: number;
  profileDoses: boolean;
  audited: boolean;
  durationText: string | null;
}): PhoneReviewCard[] {
  const focus = workoutFocus(input.workout);
  if (!focus) return [];
  const patterns = focus.patterns.slice(0, 2);
  const focusLine = [patterns.length ? patterns.join(" e ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : focus.roleLabel, `${times(input.sessionsInWeek)} na semana`].join(" · ");
  return [
    {
      id: "focus",
      title: input.chip?.text ?? "Foco da estratégia",
      line: focusLine,
      meta: `Origem: ${focus.source === "PROFESSIONAL" ? "decisão do profissional" : "estratégia aceita"}`,
      highlighted: true,
    },
    {
      id: "doses",
      title: "Doses a revisar",
      line: input.profileDoses ? "Repetições, RIR e pausas individualizadas" : "Doses do padrão do estímulo; sem perfil individual",
      meta: input.audited ? (input.durationText ? `Duração estimada: ${input.durationText}` : "Duração sem estimativa") : "Auditoria de duração pendente",
      highlighted: false,
    },
  ];
}

// ---------- rows ----------

/**
 * The movement pattern the row is listed under ("Empurrar horizontal"): the first pattern of the exercise that the workout's focus targets,
 * else the exercise's first pattern; null when the library has none for it (the row then shows only the name; nothing is made up).
 */
export function rowPatternLabel(patterns: readonly string[] | undefined, focusPatterns: readonly string[]): string | null {
  if (!patterns?.length) return null;
  const wanted = new Set(focusPatterns.map((p) => codeOf(p)));
  const codes = patterns.map((p) => codeOf(p));
  const hit = codes.find((c) => wanted.has(c)) ?? codes[0];
  return patternName(hit);
}

/** "1. Empurrar horizontal • Supino reto": position, pattern (when known) and exercise. */
export function rowTitle(position: number, name: string, pattern: string | null): string {
  return pattern ? `${position}. ${pattern} • ${name}` : `${position}. ${name}`;
}

// ---------- "Por quê?" ----------

export type PillTone = "brand" | "neutral" | "success";
export const PROVENANCE_TONES: Record<OriginKind, PillTone> = {
  AI_SUGGESTED: "brand",
  RULES_HEURISTIC: "neutral",
  PROFESSIONAL: "success",
  STUDENT_DATA: "neutral",
};

export interface WhyPill {
  facet: ProvenancePill["facet"];
  /** What the pill is about ("Foco", "Escolha", "Dose", "Dado"), so the same label is not read twice without context. */
  about: string;
  label: string;
  tone: PillTone;
}
export interface WhyCard {
  id: "focus" | "dose" | "audit";
  title: string;
  lead: string;
  meta: string;
  /** The card the wireframe highlights (focus). */
  highlighted: boolean;
  lines: WhyLine[];
  pills: WhyPill[];
}
/** One line of a card; a dose line carries its parameter (sets, reps, rir, rest) so the screen and the tests can find it. */
export interface WhyLine {
  text: string;
  param?: "sets" | "reps" | "rir" | "rest";
  /** The note that the dose profile read library data nobody reviewed yet. */
  note?: "metadata";
}

const FACET_ABOUT: Record<ProvenancePill["facet"], string> = { decidedBy: "Escolha", focus: "Foco", selection: "Ranking", dose: "Dose", studentData: "Dado" };
const pillOf = (p: ProvenancePill): WhyPill => ({ facet: p.facet, about: FACET_ABOUT[p.facet], label: p.label, tone: PROVENANCE_TONES[p.kind] });

const list = (names: readonly string[]) => names.join(", ");
const listAnd = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);
const times = (n: number) => `${n} ${n === 1 ? "vez" : "vezes"}`;
const pct = (share: number) => `${numberText(Math.round(share * 100))}%`;

export interface WhyContext {
  why: ItemWhy;
  workout: Pick<WorkoutSummary, "coverage"> | null;
  /** The session the item belongs to. */
  session: { phaseIndex: number; week: number; slot: number; label: string };
  /** Slots of the workout's sessions in the selected week (the calendar). */
  weekSlots: readonly number[];
  sessionsPerWeek: number;
  volume: readonly VolumeRow[];
  strategy: StrategyAdherence | undefined;
  adherenceMin: number | null;
}

/** The audit lines about the week of one workout: the calendar, the adherence to the focus and the volume of the muscles the focus lists. */
export function weeklyAuditLines(ctx: WhyContext): string[] {
  const { session, workout } = ctx;
  const lines: string[] = [];
  const slots = [...ctx.weekSlots].sort((a, b) => a - b);
  if (slots.length)
    lines.push(`Calendário: o treino ${session.label} acontece ${times(slots.length)} na semana ${session.week} (${slots.length === 1 ? "sessão" : "sessões"} ${listAnd(slots.map(String))}) entre ${ctx.sessionsPerWeek} ${ctx.sessionsPerWeek === 1 ? "sessão" : "sessões"} por semana.`);
  const chip = sessionFocusChip(ctx.strategy, session.phaseIndex, session.label, session.week, ctx.adherenceMin);
  const row = ctx.strategy?.workouts.find((x) => x.phaseIndex === session.phaseIndex && x.label === session.label)?.weeks.find((x) => x.week === session.week);
  if (row && row.items > 0 && chip)
    lines.push(
      `Foco: ${row.items - row.offFocus} de ${row.items} ${row.items === 1 ? "exercício está" : "exercícios estão"} no foco, no apoio ou no transbordo (${pct(row.adherence ?? 0)}${ctx.adherenceMin !== null ? `; mínimo ${pct(ctx.adherenceMin)}, heurística operacional` : ""}).`,
    );
  const focus = workoutFocus(workout);
  const dominant = (workout?.coverage?.muscles ?? []).map(codeOf);
  if (focus && dominant.length) {
    const rows = ctx.volume.filter((v) => v.phaseIndex === session.phaseIndex && v.week === session.week && dominant.includes(codeOf(v.muscle)));
    const shown = [...rows].sort((a, b) => b.weightedSets - a.weightedSets).slice(0, 4);
    if (shown.length)
      lines.push(`Volume da semana ${session.week} (séries ponderadas por músculo do foco): ${shown.map((v) => `${muscleName(v.muscle)} ${numberText(v.weightedSets)}`).join(", ")}. É leitura para a sua revisão, não meta.`);
    else lines.push(`Volume da semana ${session.week}: sem séries registradas para os músculos do foco.`);
  }
  return lines;
}

/**
 * The three cards of "Por que foi selecionado?" for one item: the dominant focus of its workout, the parameters of its dose (the rule and the
 * reasons each value came from, or an honest note when the proposal predates the dose policy) and the weekly audit (calendar, adherence and volume
 * of its week plus the audit findings that name the item). The pills say who is behind each facet: AI suggestion, rules, professional, student data.
 */
export function whyCards(ctx: WhyContext): WhyCard[] {
  const { why, workout, session } = ctx;
  const focus = workoutFocus(workout);
  const byFacet = (...facets: Array<ProvenancePill["facet"]>) => why.selectionPills.filter((p) => facets.includes(p.facet)).map(pillOf);

  const focusLines: WhyLine[] = [];
  let focusLead: string;
  if (focus) {
    const open = focus.role === "FULL_BODY" || (!focus.dominant.length && !focus.supporting.length);
    focusLead = open
      ? `Treino ${session.label}: ${focus.roleLabel.toLowerCase()}; sem um foco dominante único.`
      : `Treino ${session.label}: ${focus.roleLabel.toLowerCase()}; músculos de outros grupos só entram como apoio ou complemento, com motivo.`;
    if (focus.dominant.length) focusLines.push({ text: `Músculos dominantes: ${list(focus.dominant)}.` });
    if (focus.supporting.length) focusLines.push({ text: `Músculos de apoio: ${list(focus.supporting)}.` });
    if (focus.patterns.length) focusLines.push({ text: `Padrões do foco: ${list(focus.patterns)}.` });
    focusLines.push({ text: `Origem do foco: ${focus.originLabel}. Origem da escolha deste exercício: ${why.selectionPills.find((p) => p.facet === "decidedBy")?.label ?? ORIGIN_LABELS.RULES_HEURISTIC}.` });
  } else {
    focusLead = `Treino ${session.label}: sem estratégia aceita; o foco vem das regras da fase.`;
    focusLines.push({ text: "Esta proposta não foi gerada com uma divisão aceita." });
  }
  const studentPill = why.selectionPills.find((p) => p.facet === "studentData");
  if (studentPill) focusLines.push({ text: "A escolha levou em conta dado do aluno (histórico ou cautela registrada)." });

  const doseLines: WhyLine[] = why.dose.map((d) => ({
    param: d.param,
    text: `${d.question} ${d.text}. Regra: ${d.rule}${d.profile ? ` · perfil ${d.profile}` : ""}.${d.reasons.length ? ` Motivos: ${d.reasons.join(", ")}.` : ""}${d.changeIf ? ` ${changeIfText(d.changeIf)}` : ""}`,
  }));
  if (!why.dose.length) doseLines.push({ text: "Esta proposta foi gerada antes da política de doses: não há justificativa por parâmetro para exibir." });
  if (why.metadataNote) doseLines.push({ text: why.metadataNote, note: "metadata" });

  const auditLines: WhyLine[] = [...weeklyAuditLines(ctx), ...why.auditLines].map((text) => ({ text }));

  return [
    {
      id: "focus",
      title: "Foco dominante",
      lead: focusLead,
      meta: focus ? "Blueprint aceito" : "Sem blueprint",
      highlighted: true,
      lines: focusLines,
      pills: byFacet("focus", "decidedBy", "studentData"),
    },
    {
      id: "dose",
      title: "Parâmetros da dose",
      lead: "Doses específicas e progressão por semana; não aplicar um padrão único.",
      meta: why.dose.length ? "Política versionada" : "Sem política de doses",
      highlighted: false,
      lines: doseLines,
      pills: byFacet("dose"),
    },
    {
      id: "audit",
      title: "Auditoria semanal",
      lead: "Conferir volume, padrões, frequência e duração antes de aplicar.",
      meta: "Avisos não substituem revisão",
      highlighted: false,
      lines: auditLines.length ? auditLines : [{ text: "Sem leitura de auditoria para esta semana." }],
      pills: byFacet("selection"),
    },
  ];
}

// ---------- audit: "Estratégia" ----------

const REGION_LABELS: Record<string, string> = { LOWER: "Inferiores", UPPER_PUSH: "Superiores (empurrar)", UPPER_PULL: "Superiores (puxar)", TRUNK: "Tronco" };

export interface StrategyAuditView {
  /** Where the focus of the workouts came from (fixed labels; the internal strategy codes are not shown). */
  summary: string;
  workouts: Array<{
    label: string;
    roleLabel: string;
    originLabel: string;
    weeks: Array<{ week: number; items: number; offFocus: number; share: string; respected: boolean | null }>;
    omitted: number;
  }>;
  overlaps: string[];
  exposures: string[];
  note: string;
}

/**
 * The "Estratégia" section of the audit tab for one phase: adherence per workout and week, the overlap between workouts (a diagnosis, never a
 * target) and the exposures per region on the real calendar. Null when the proposal has no strategy audit.
 */
export function strategyAuditView(report: Pick<AuditReport, "strategy"> | null, phaseIndex: number, adherenceMin: number | null): StrategyAuditView | null {
  const s = report?.strategy;
  if (!s) return null;
  const workouts = s.workouts
    .filter((w) => w.phaseIndex === phaseIndex)
    .map((w) => ({
      label: w.label,
      roleLabel: ROLE_LABELS[w.role] ?? w.role,
      originLabel: ORIGIN_LABELS[w.source],
      weeks: w.weeks.map((x) => ({
        week: x.week,
        items: x.items,
        offFocus: x.offFocus,
        share: x.adherence === null ? "—" : pct(x.adherence),
        respected: x.adherence === null ? null : adherenceMin === null ? x.offFocus === 0 : x.adherence >= adherenceMin,
      })),
      omitted: w.weeksOmitted ?? 0,
    }));
  const overlaps = s.overlaps
    .filter((o) => o.phaseIndex === phaseIndex)
    .map((o) => `Semana ${o.week}: os treinos ${o.a} e ${o.b} compartilham ${pct(o.jaccard)} dos músculos principais.${o.byDesign ? " Esperado num treino de corpo inteiro." : ""}`);
  const exposures = s.exposures
    .filter((e) => e.phaseIndex === phaseIndex)
    .map((e) => `${REGION_LABELS[e.region] ?? e.region}: ${e.perWeek.min === e.perWeek.max ? numberText(e.perWeek.min) : `${numberText(e.perWeek.min)}–${numberText(e.perWeek.max)}`} ${e.perWeek.max === 1 ? "sessão" : "sessões"} com estímulo direto por semana (${e.weeksCounted} ${e.weeksCounted === 1 ? "semana contada" : "semanas contadas"}).`);
  return {
    summary: `Estratégia aceita · origem do foco: ${[...new Set(s.sources.map((x) => ORIGIN_LABELS[x]))].join(", ")}`,
    workouts,
    overlaps,
    exposures,
    note: "Diagnóstico, não objetivo: a sobreposição entre treinos descreve a proposta e não é meta.",
  };
}

// ---------- "Rever estratégia" ----------

export type ReplanScope = { kind: "PHASE"; phaseIndex: number } | { kind: "FROM_PHASE"; phaseIndex: number } | { kind: "FULL" };

/** The scope in the address (`rever=FULL`, `rever=PHASE:2`, `rever=FROM:2`); null for anything else (an unknown value never reaches the server). */
export function parseReplanScope(raw: string | undefined): ReplanScope | null {
  if (raw === "FULL") return { kind: "FULL" };
  const m = /^(PHASE|FROM):([1-9]|1[0-2])$/.exec(raw ?? "");
  if (!m) return null;
  return m[1] === "PHASE" ? { kind: "PHASE", phaseIndex: Number(m[2]) } : { kind: "FROM_PHASE", phaseIndex: Number(m[2]) };
}
export function replanScopeKey(scope: ReplanScope): string {
  return scope.kind === "FULL" ? "FULL" : scope.kind === "PHASE" ? `PHASE:${scope.phaseIndex}` : `FROM:${scope.phaseIndex}`;
}
export function replanScopeLabel(scope: ReplanScope): string {
  return scope.kind === "FULL" ? "todas as fases geradas" : scope.kind === "PHASE" ? `a fase ${scope.phaseIndex}` : `a partir da fase ${scope.phaseIndex}`;
}

export interface ReplanPreviewCounts {
  replaced: number;
  locked: number;
  substituted: number;
  preserved: number;
  phases: number[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The confirmation before a strategy is redone: what is replaced (the tool's own picks in the scope) and what is kept (locked by the professional,
 * replaced by the professional, and rows that were already in the draft). Words of design V4 §7.0.
 */
export function replanConfirmText(scope: ReplanScope, c: ReplanPreviewCounts): { title: string; body: string; kept: string[] } {
  const what = scope.kind === "FULL" ? "Refazer todas as fases geradas" : scope.kind === "PHASE" ? `Refazer a fase ${scope.phaseIndex}` : `Refazer a partir da fase ${scope.phaseIndex}`;
  const replaced = c.replaced === 0 ? "não substitui nenhum exercício proposto pela ferramenta" : `substitui ${plural(c.replaced, "exercício proposto", "exercícios propostos")} pela ferramenta`;
  const kept = [
    plural(c.locked, "travado", "travados"),
    plural(c.substituted, "trocado por você", "trocados por você"),
    `${c.preserved} que ${c.preserved === 1 ? "já estava" : "já estavam"} no rascunho`,
  ];
  return {
    title: "Rever a estratégia",
    body: `${what} ${replaced}. Serão mantidos: ${kept.join(", ")}.`,
    kept,
  };
}

/** The address of the strategy step of an open proposal (the flow in "rever" mode): same page, `rever` says the scope. */
export function replanHref(selfHref: string, scope: ReplanScope, step: "estrategia" = "estrategia"): string {
  return `${selfHref}?rever=${encodeURIComponent(replanScopeKey(scope))}&etapa=${step}`;
}

/** Footer of the review (design V4 §7.5): the guide and the one primary; "Rever estratégia" is a secondary, only with a strategy. */
export function reviewFooter(input: { strategy: boolean; phone: boolean }): { guide: string; primary: string; secondary: string | null } {
  return {
    guide: input.phone ? "Não aplica, não aprova e não entrega sozinho." : "Proposta editável; não aprova nem altera treinos entregues.",
    primary: "Aplicar ao rascunho",
    secondary: input.strategy ? "Rever estratégia" : null,
  };
}
