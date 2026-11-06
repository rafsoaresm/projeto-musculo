/**
 * The proposal workflow of the automatic prescription (motor S6, design §4.8): generate, continue, regenerate a scope, substitute,
 * rebase, lock, decide an alert, discard, and apply to the draft (motor S7). Business rules live here, not in the server actions
 * (which only add the session and revalidate) nor in components. Nothing here approves or delivers: after the apply the
 * professional reviews, edits, marks ready, approves and delivers through the existing flow.
 *
 * Every call takes the verified session context (organization and user from `requireWorkspace`); ids come from the route and
 * every payload is parsed strictly. Each run reads the student's real data again through the gated repositories, so access
 * revoked meanwhile answers "not found". Idempotency: the client sends one key (and one write id) per intent and reuses them on
 * a retry after a network error; the same key with a different payload is refused.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { z, ZodError } from "zod";
import { exercisesFor } from "@/db/exercises";
import {
  GENERATION_INPUT_MAX,
  MAX_LOCK_TARGETS,
  proposalsFor,
  type ApplyCounts,
  type ApplyOutcome,
  type ApplyPreview,
  type ManualWorkout,
  type GenerateOutcome,
  type GenerationRecord,
  type GenerationScopeKind,
  type MutateOutcome,
  type ProposalHeader,
} from "@/db/prescription-proposals";
import type { AuthenticatedContext } from "@/db/students";
import { generate, workUnits } from "@/modules/prescricao/motor/generate";
import { canonicalInput, canonicalJson, canonicalRequest, sha256Hex } from "@/modules/prescricao/motor/hash";
import { evaluateConstraints, overrideOf, simulateAdjustments, type ResolvedConstraint, type ResolvedOp } from "@/modules/prescricao/motor/adjust";
import { alternativesFor, rebase, regenerate, substitute } from "@/modules/prescricao/motor/regenerate";
import { DEFAULT_RULESET, getRuleSet, rulesetForNewGeneration } from "@/modules/prescricao/motor/rules";
import { cmp, STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";
import { mergeDoseOverrides } from "@/modules/prescricao/motor/adjust";
import { structureFingerprint } from "@/modules/prescricao/planejador/hashes";
import { proposalBlueprintView, type ProposalBlueprintView } from "./blueprint-view";
import { ruleLogFor, uniqueIssues } from "@/modules/prescricao/motor/trace";
import { auditPlan, boundAudit } from "@/modules/prescricao/motor/audit";
import { targetSuggestion, type TargetSuggestion, type TargetSuggestionOutcome } from "@/modules/prescricao/motor/targets";
import { volumeFor } from "@/modules/prescricao/motor/volume";
import type {
  AuditReport,
  CatalogExercise,
  EngineInput,
  EngineOutcome,
  EngineResult,
  ItemTarget,
  RegenerationScope,
  RuleSetRef,
  StructureFacts,
  SubstitutionTarget,
} from "@/modules/prescricao/motor/types";
import { ADAPTER_ASSUMPTION_CODES, ADAPTER_ISSUE_CODES, buildEngineInput, goalSuggestions, suggestedTargets } from "./build-input";
import { loadCatalogForPlan, loadGenerationContext, loadScheduleForPlan } from "./context";
import {
  flagCodeSchema,
  flagDecisionSchema,
  parseGenerationAnswers,
  carriesBlueprint,
  CLIENT_BLUEPRINT_REFUSED,
  type GenerationAnswers,
  type GenerationFactRefs,
  type GenerationQuestion,
} from "./contracts";
import { structureFacts, studentFacts, type GenerationContext } from "./facts";
import { policyRows, type PolicyRow } from "./view";
import { WORK_UNITS_PER_REQUEST } from "./limits";

// ---------- payloads ----------

/** A key or write id made by the browser (`crypto.randomUUID()`), one per intent. Never used for authorization. */
const intentId = z.string().regex(/^[A-Za-z0-9-]{16,64}$/);
const version = z.number().int().min(1);
const phaseIndex = z.number().int().min(1).max(12);
const week = z.number().int().min(1).max(504);
const slot = z.number().int().min(1).max(14);
const slotKey = z.string().min(1).max(300);
const label = z.string().trim().min(1).max(20);

const regenerationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ITEM"), phaseIndex, week, slot, slotKey }).strict(),
  z.object({ kind: z.literal("OCCURRENCE"), phaseIndex, week, slot }).strict(),
  z.object({ kind: z.literal("WEEK"), phaseIndex, week }).strict(),
  z.object({ kind: z.literal("WORKOUT"), phaseIndex, label, fromWeek: week.optional() }).strict(),
  z.object({ kind: z.literal("PHASE"), phaseIndex }).strict(),
  z.object({ kind: z.literal("FROM_PHASE"), phaseIndex }).strict(),
]);
const substitutionTargetSchema = z
  .object({
    phaseIndex,
    slotKey,
    applies: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("OCCURRENCE"), week, slot }).strict(),
      z.object({ kind: z.literal("FROM_WEEK"), week }).strict(),
      z.object({ kind: z.literal("PHASE") }).strict(),
    ]),
  })
  .strict();

/** `rulesVersion`: adesão explícita a uma versão publicada que não é o padrão (hoje só a das doses por perfil); ausente = o padrão. */
const generateSchema = z.object({ idempotencyKey: intentId, baseContentVersion: z.number().int().min(0), answers: z.unknown(), rulesVersion: z.string().trim().min(1).max(40).optional() }).strict();
const continueSchema = z.object({ proposalId: z.string().min(1).max(64), idempotencyKey: intentId, writeId: intentId, expectedVersion: version }).strict();
const regenerateSchema = continueSchema.extend({ scope: regenerationScopeSchema, answers: z.unknown().optional() }).strict();
/** "Voltar à estratégia": the scope is a phase, from a phase on, or the whole proposal. The compiled block is NOT part of it (server-side only). */
const replanSchema = continueSchema
  .extend({ scope: z.discriminatedUnion("kind", [z.object({ kind: z.literal("PHASE"), phaseIndex }).strict(), z.object({ kind: z.literal("FROM_PHASE"), phaseIndex }).strict(), z.object({ kind: z.literal("FULL") }).strict()]) })
  .strict();
const substituteSchema = continueSchema.extend({ target: substitutionTargetSchema, newExerciseId: z.string().trim().min(1).max(80) }).strict();
const casSchema = z.object({ proposalId: z.string().min(1).max(64), writeId: intentId, expectedVersion: version }).strict();
const lockSchema = casSchema
  .extend({ targets: z.array(z.object({ phaseIndex, slotKey }).strict()).min(1).max(MAX_LOCK_TARGETS), locked: z.boolean() })
  .strict();
const flagSchema = casSchema.extend({ flagCode: flagCodeSchema, decision: flagDecisionSchema }).strict();

const applySchema = z
  .object({
    proposalId: z.string().min(1).max(64),
    idempotencyKey: intentId,
    expectedVersion: version,
    conflictMode: z.enum(["PRESERVE", "REPLACE_CONFIRMED"]),
    confirmedWorkouts: z.array(z.object({ phaseIndex, label }).strict()).max(200),
    confirmInfeasible: z.boolean(),
  })
  .strict();

const alternativesSchema = z
  .object({ proposalId: z.string().min(1).max(64), phaseIndex, slotKey, week: week.optional(), slot: slot.optional() })
  .strict();

export type GeneratePayload = z.input<typeof generateSchema>;
export type AlternativesPayload = z.input<typeof alternativesSchema>;
export type ApplyPayload = z.input<typeof applySchema>;
export type ContinuePayload = z.input<typeof continueSchema>;
export type RegeneratePayload = z.input<typeof regenerateSchema>;
export type ReplanPayload = z.input<typeof replanSchema>;
export type SubstitutePayload = z.input<typeof substituteSchema>;
export type CasPayload = z.input<typeof casSchema>;
export type LockPayload = z.input<typeof lockSchema>;
export type FlagPayload = z.input<typeof flagSchema>;

// ---------- outcomes ----------

export type ProposalFailure =
  | "invalid"
  | "not_found"
  | "not_open"
  | "closed"
  | "conflict"
  | "revision_changed"
  | "open_exists"
  | "key_reused"
  | "questions"
  | "unknown_exercise"
  | "invalid_target"
  | "engine_refused"
  | "incomplete"
  | "already_complete"
  | "structure_changed"
  | "blueprint_invalid"
  | "too_large"
  | "adjustment_blocked";

export type ProposalOutcome =
  | {
      ok: true;
      proposalId: string;
      version: number;
      complete: boolean;
      replayed: boolean;
      notice?: string;
      /** Phases with sessions in the proposal now, of all phases of the structure: the processing indicator ("3 de 8 fases"). */
      progress?: { generated: number; total: number };
    }
  | {
      ok: false;
      reason: ProposalFailure;
      /** pt-BR, shown as is: no plan data, no health text. */
      message: string;
      questions?: GenerationQuestion[];
      version?: number;
      contentVersion?: number;
      proposalId?: string;
    };

export type ApplyFailure =
  | "invalid"
  | "not_found"
  | "not_open"
  | "closed"
  | "proposal_conflict"
  | "revision_changed"
  | "incomplete"
  | "infeasible_confirmation_required"
  | "confirmation_required"
  | "catalog_changed"
  | "key_reused"
  | "too_large";

export type ApplyServiceOutcome =
  | { ok: true; applicationId: string; replayed: boolean; counts: ApplyCounts | null }
  | {
      ok: false;
      reason: ApplyFailure;
      /** pt-BR, shown as is: no plan data, no health text. */
      message: string;
      workouts?: ManualWorkout[];
      exerciseIds?: string[];
      phasesMissing?: number[];
      version?: number;
      contentVersion?: number;
    };

const APPLY_MESSAGES: Record<ApplyFailure, string> = {
  invalid: "Pedido inválido. Recarregue a página e tente de novo.",
  not_found: "Plano, revisão ou proposta não encontrados para você.",
  not_open: "A revisão não está mais em rascunho: a proposta não pode ser aplicada. Revisões aprovadas e entregues não mudam.",
  closed: "Esta proposta já foi fechada (aplicada, descartada ou substituída ao marcar a revisão como pronta).",
  proposal_conflict: "A proposta mudou enquanto você revisava. Recarregue para ver a versão atual antes de aplicar.",
  revision_changed:
    "O rascunho mudou desde a geração (prescrição ou estrutura editadas). Atualize a proposta com o rascunho atual antes de aplicar.",
  incomplete: "A proposta ainda não tem todas as fases. Continue a geração antes de aplicar.",
  infeasible_confirmation_required:
    "A proposta tem impedimentos (inviável). Para aplicar mesmo assim, confirme explicitamente: a confirmação fica registrada.",
  confirmation_required:
    "Há treinos com exercícios já prescritos no rascunho. Eles são mantidos; para substituí-los, confirme exatamente os treinos listados.",
  catalog_changed: "Um exercício da proposta não está mais disponível na biblioteca: regenere as partes indicadas antes de aplicar.",
  key_reused: "Esta ação já foi enviada com outros dados. Recarregue a página.",
  too_large: "A cópia dos exercícios substituídos passa do limite técnico do registro. Substitua menos treinos por vez.",
};

function fromApply(out: ApplyOutcome): ApplyServiceOutcome {
  switch (out.status) {
    case "applied":
    case "replayed":
      return { ok: true, applicationId: out.applicationId, replayed: out.status === "replayed", counts: out.counts };
    case "proposal_conflict":
      return { ok: false, reason: out.status, message: APPLY_MESSAGES[out.status], version: out.version };
    case "revision_changed":
      return { ok: false, reason: out.status, message: APPLY_MESSAGES[out.status], contentVersion: out.contentVersion };
    case "incomplete":
      return { ok: false, reason: out.status, message: APPLY_MESSAGES[out.status], phasesMissing: out.phasesMissing };
    case "confirmation_required":
      return { ok: false, reason: out.status, message: APPLY_MESSAGES[out.status], workouts: out.workouts };
    case "catalog_changed":
      return { ok: false, reason: out.status, message: APPLY_MESSAGES[out.status], exerciseIds: out.exerciseIds };
    default:
      return { ok: false, reason: out.status, message: APPLY_MESSAGES[out.status] };
  }
}

const MESSAGES: Record<ProposalFailure, string> = {
  invalid: "Pedido inválido. Recarregue a página e tente de novo.",
  not_found: "Plano, revisão ou proposta não encontrados para você.",
  not_open: "A revisão não está mais em rascunho: a proposta não pode ser gerada nem alterada.",
  closed: "Esta proposta já foi fechada (aplicada, descartada ou substituída ao marcar a revisão como pronta).",
  conflict: "A proposta mudou enquanto você revisava. Recarregue para ver a versão atual.",
  revision_changed:
    "A revisão em rascunho mudou desde a geração (prescrição ou estrutura editadas). Atualize a proposta com as linhas atuais antes de seguir.",
  open_exists: "Já existe uma proposta aberta para esta revisão. Revise-a ou descarte-a antes de gerar outra.",
  key_reused: "Esta ação já foi enviada com outros dados. Recarregue a página.",
  questions: "Responda as perguntas obrigatórias antes de gerar.",
  unknown_exercise: "Algum exercício escolhido não está na biblioteca visível para você.",
  invalid_target: "O item, a sessão ou o alerta escolhido não está nesta proposta.",
  engine_refused: "O motor não conseguiu fazer esta operação.",
  incomplete: "A proposta ainda não tem todas as fases. Continue a geração antes de regenerar desta fase em diante.",
  already_complete: "A proposta já tem todas as fases.",
  structure_changed: "A periodização mudou depois da geração: descarte esta proposta e gere de novo.",
  blueprint_invalid: "O aceite da estratégia não pertence a esta revisão ou não existe mais. Aceite a estratégia de novo antes de gerar.",
  too_large:
    "A operação passa do limite técnico de um pedido. Regenere uma fase por vez; se for a geração completa, reduza a quantidade de sessões ou de exercícios ou desmarque os perfis de dose.",
  adjustment_blocked: "O ajuste não pode ser aplicado como foi simulado. Peça de novo para ver o efeito atual.",
};

export const fail = (reason: ProposalFailure, extra: Partial<Extract<ProposalOutcome, { ok: false }>> = {}): ProposalOutcome => ({
  ok: false,
  reason,
  message: extra.message ?? MESSAGES[reason],
  ...extra,
});

function fromGenerate(out: GenerateOutcome, notice?: string): ProposalOutcome {
  switch (out.status) {
    case "created":
    case "replayed":
      return { ok: true, proposalId: out.proposalId, version: out.version, complete: out.complete, replayed: out.status === "replayed", ...(notice ? { notice } : {}) };
    case "revision_changed":
      return fail("revision_changed", { contentVersion: out.contentVersion });
    case "open_exists":
      return fail("open_exists", { proposalId: out.proposalId });
    default:
      return fail(out.status);
  }
}

function fromMutate(proposalId: string, out: MutateOutcome, complete: boolean, notice?: string): ProposalOutcome {
  switch (out.status) {
    case "saved":
      return { ok: true, proposalId, version: out.version, complete, replayed: out.replayed, ...(notice ? { notice } : {}) };
    case "conflict":
      return fail("conflict", { version: out.version });
    case "revision_changed":
      return fail("revision_changed", { contentVersion: out.contentVersion });
    default:
      return fail(out.status);
  }
}

// ---------- what the screens read ----------

/** One fact the generation will read, as the "Dados considerados" list shows it (no health free text here). */
export interface ConsideredFact {
  label: string;
  value: string;
  source: "Ficha" | "Avaliação" | "Periodização" | "Biblioteca" | "Histórico" | "Rascunho";
}

/** The few counts and facts the compact "Base utilizada" strip and the student card read, as data (never parsed from the texts above). */
export interface GenerationSummary {
  phases: number;
  weeks: number;
  catalogTotal: number;
  catalogInferred: number;
  catalogPending: number;
  /** ISO date (yyyy-mm-dd) of the most recent assessment, or null when none is recorded. */
  assessedOn: string | null;
  parq: "CLEAR" | "POSITIVE" | "NOT_DONE";
  findings: number;
  /** Exercises already in the draft, which the generation preserves. */
  preserved: number;
  level: string | null;
  goal: string | null;
  daysPerWeek: number | null;
  sessionMinutes: number | null;
}

/** Everything the generation form needs, read again on every visit through the gated repositories. */
export interface GenerationScreen {
  contentVersion: number;
  summary: GenerationSummary;
  structure: Array<{
    index: number;
    name: string | null;
    weeks: number;
    sessionsPerWeek: number;
    /** The sessions of the phase's first week with sessions, in order: the workout label and the weekday (0 = Sunday) when the structure has dates. */
    weekSlots: Array<{ label: string; weekday: number | null }>;
    workouts: Array<{ label: string; name: string | null; target: number | null; /** The saved periodization already holds this workout's focus (muscles or patterns): it wins and is not edited in the flow. */ focusSaved: boolean }>;
  }>;
  /** What the records do not say, with the current (empty) answers: required ones block "Gerar". */
  questions: GenerationQuestion[];
  assumptions: EngineResult["assumptions"];
  issues: EngineResult["issues"];
  considered: ConsideredFact[];
  /** Free text of the student's records, shown next to the questions and never interpreted (design §2.2). */
  freeText: Array<{ label: string; text: string }>;
  /** Stimulus chips from the goal text (rule GOAL_STIMULUS_HINTS): nothing pre-selected. */
  suggestions: Array<{ value: string; ruleId: string; label: string }>;
  stimulusOptions: Array<{ value: string; label: string }>;
  policy: PolicyRow[];
  rules: { id: string; version: string };
  library: Array<{ id: string; name: string; metadata: "REVIEWED" | "INFERRED" | "PENDING" }>;
  lastAnswers: { createdAt: string; answers: unknown } | null;
  /**
   * Suggested targets per phase (rule MICROCYCLE_TARGET_SUGGESTIONS of the default rule set; empty without it): one outcome per
   * stimulus the form may choose, and the one with no stimulus answered. The suggestion depends on the stimulus, which the form
   * picks on screen; the server recomputes it from the answers on "Gerar" and refuses anything else as "aceita".
   */
  targetSuggestions: PhaseTargetSuggestions[];
}

export interface PhaseTargetSuggestions {
  phaseIndex: number;
  /** No stimulus answered for the phase (the periodization's own, if any). */
  asIs: TargetSuggestionOutcome;
  byStimulus: Record<string, TargetSuggestionOutcome>;
}

/** The suggested targets of each phase the rule set can suggest for, as the form needs them (see `GenerationScreen`). */
export function screenTargetSuggestions(input: EngineInput, rules: RuleSetRef = DEFAULT_RULESET): PhaseTargetSuggestions[] {
  const table = getRuleSet(rules)?.rules.MICROCYCLE_TARGET_SUGGESTIONS?.value;
  if (!table) return [];
  return input.structure.phases.map((phase) => {
    const others = input.parameters.stimulusByPhase.filter((s) => s.phaseIndex !== phase.index);
    const asIs = targetSuggestion(rules, phase, { parameters: { ...input.parameters, stimulusByPhase: others } });
    const byStimulus: Record<string, TargetSuggestionOutcome> = {};
    for (const stimulus of Object.keys(table).sort())
      byStimulus[stimulus] = targetSuggestion(rules, phase, {
        parameters: { ...input.parameters, stimulusByPhase: [...others, { phaseIndex: phase.index, value: stimulus, basis: "PROFESSIONAL" }] },
      });
    return { phaseIndex: phase.index, asIs, byStimulus };
  });
}

const PROFILE_TEXT: Array<[keyof NonNullable<GenerationContext["profile"]>, string]> = [
  ["equipment", "Equipamentos (ficha)"],
  ["location", "Local de treino"],
  ["experience", "Experiência"],
  ["preferredExercises", "Exercícios preferidos"],
  ["dislikedExercises", "Exercícios que não gosta"],
  ["excludedExercises", "Exercícios a evitar"],
  ["injuries", "Lesões"],
  ["surgeries", "Cirurgias"],
  ["pains", "Dores"],
  ["limitations", "Limitações"],
  ["medicationsConditions", "Medicamentos e condições"],
  ["relevantNotes", "Observações relevantes"],
  ["professionalNotes", "Notas do profissional"],
];

const PARQ_TEXT = { CLEAR: "Sem \"Sim\" no PAR-Q", POSITIVE: "PAR-Q com \"Sim\"", NOT_DONE: "Não feita" } as const;

/** The first week with sessions of a phase, as label + weekday (0 = Sunday, null without a planned date). */
function weekSlotsOf(occurrences: ReadonlyArray<{ week: number; slot: number; label: string; plannedDate: string | null }>): GenerationScreen["structure"][number]["weekSlots"] {
  if (!occurrences.length) return [];
  const first = Math.min(...occurrences.map((o) => o.week));
  return occurrences
    .filter((o) => o.week === first)
    .sort((a, b) => a.slot - b.slot)
    .map((o) => ({ label: o.label, weekday: o.plannedDate && /^\d{4}-\d{2}-\d{2}/.test(o.plannedDate) ? new Date(`${o.plannedDate.slice(0, 10)}T12:00:00Z`).getUTCDay() : null }));
}

function screenOf(ctx: GenerationContext, built: Built | Extract<ReturnType<typeof buildEngineInput>, { ok: true }>): Omit<GenerationScreen, "lastAnswers"> {
  const rules = getRuleSet(DEFAULT_RULESET)!;
  const student = studentFacts(ctx.profile, ctx.assessment);
  const p = ctx.profile;
  const w = ctx.history.window;
  const counts = { REVIEWED: 0, INFERRED: 0, PENDING: 0 };
  for (const e of ctx.catalog) counts[e.metadataStatus] += 1;
  const considered: ConsideredFact[] = [
    { label: "Nível", value: p?.level ?? "Não informado", source: "Ficha" },
    { label: "Objetivo", value: student.goal?.value ?? "Não informado", source: student.goal?.source === "ASSESSMENT" ? "Avaliação" : "Ficha" },
    { label: "Dias por semana", value: p?.daysPerWeek ? String(p.daysPerWeek) : "Não informado", source: "Ficha" },
    { label: "Tempo por sessão", value: p?.sessionMinutes ? `${p.sessionMinutes} min` : "Não informado", source: "Ficha" },
    {
      label: "Avaliação mais recente",
      value: ctx.assessment ? `${ctx.assessment.assessedOn.slice(8, 10)}/${ctx.assessment.assessedOn.slice(5, 7)}/${ctx.assessment.assessedOn.slice(0, 4)}` : "Nenhuma registrada",
      source: "Avaliação",
    },
    { label: "Triagem (PAR-Q)", value: PARQ_TEXT[student.screening.parq], source: "Avaliação" },
    { label: "Achados da avaliação", value: student.findings.length ? `${student.findings.length} (contexto, não contraindicação)` : "Nenhum", source: "Avaliação" },
    {
      label: "Periodização salva",
      value: `${ctx.revision.schedule.phases.length} ${ctx.revision.schedule.phases.length === 1 ? "fase" : "fases"} · ${ctx.revision.schedule.totalWeeks} semanas`,
      source: "Periodização",
    },
    { label: "Biblioteca", value: `${ctx.catalog.length} exercícios: ${counts.REVIEWED} revisados, ${counts.INFERRED} inferidos, ${counts.PENDING} pendentes`, source: "Biblioteca" },
    { label: "Histórico de execução", value: w.sessions ? `${w.sessions} ${w.sessions === 1 ? "sessão" : "sessões"} em ${w.sinceDays} dias` : `Nenhuma sessão em ${w.sinceDays} dias`, source: "Histórico" },
    { label: "Exercícios já no rascunho", value: ctx.existing.length ? `${ctx.existing.length} (preservados)` : "Nenhum", source: "Rascunho" },
  ];
  const freeText = p ? PROFILE_TEXT.flatMap(([key, label]) => (typeof p[key] === "string" && (p[key] as string).trim() ? [{ label, text: p[key] as string }] : [])) : [];
  const structure = built.input.structure.phases.map((ph) => ({
    index: ph.index,
    name: ph.name,
    weeks: ph.weeks,
    sessionsPerWeek: ph.sessionsPerWeek,
    weekSlots: weekSlotsOf(ph.occurrences),
    workouts: ph.workouts.map((wk) => ({ label: wk.label, name: wk.name, target: wk.exerciseTarget, focusSaved: Boolean(wk.focus.muscles?.length || wk.focus.patterns?.length) })),
  }));
  const summary: GenerationSummary = {
    phases: ctx.revision.schedule.phases.length,
    weeks: ctx.revision.schedule.totalWeeks,
    catalogTotal: ctx.catalog.length,
    catalogInferred: counts.INFERRED,
    catalogPending: counts.PENDING,
    assessedOn: ctx.assessment ? ctx.assessment.assessedOn.slice(0, 10) : null,
    parq: student.screening.parq,
    findings: student.findings.length,
    preserved: ctx.existing.length,
    level: p?.level ?? null,
    goal: student.goal?.value ?? null,
    daysPerWeek: p?.daysPerWeek ?? null,
    sessionMinutes: p?.sessionMinutes ?? null,
  };
  return {
    contentVersion: ctx.revision.contentVersion,
    summary,
    structure,
    questions: built.questions,
    assumptions: built.assumptions,
    issues: built.issues,
    considered,
    freeText,
    suggestions: goalSuggestions(student.goal?.value ?? null),
    stimulusOptions: Object.entries(STIMULUS_LABELS).map(([value, label]) => ({ value, label })),
    policy: policyRows(rules),
    rules: { id: rules.id, version: rules.version },
    library: ctx.catalog.map((e) => ({ id: e.id, name: e.name, metadata: e.metadataStatus })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    targetSuggestions: screenTargetSuggestions(built.input),
  };
}

// ---------- helpers ----------

function progressOf(result: EngineResult): { generated: number; total: number } {
  const done = new Set(result.occurrences.map((o) => o.phaseIndex));
  return { generated: result.phases.filter((p) => done.has(p.phaseIndex)).length, total: result.phases.length };
}

const requestHash = (kind: string, payload: unknown) => sha256Hex(canonicalRequest(kind, payload));

/** The adapter's assumptions and issues, current, merged into an engine result (replacing any earlier ones from the adapter). */
export function withAdapter(result: EngineResult, built: { assumptions: EngineResult["assumptions"]; issues: EngineResult["issues"] }): EngineResult {
  const assumptionCodes = new Set<string>(ADAPTER_ASSUMPTION_CODES);
  const issueCodes = new Set<string>(ADAPTER_ISSUE_CODES);
  const issues = uniqueIssues([...built.issues, ...result.issues.filter((i) => !issueCodes.has(i.code))]);
  const errors = issues.some((i) => i.severity === "ERROR");
  return {
    ...result,
    assumptions: [...built.assumptions, ...result.assumptions.filter((a) => !assumptionCodes.has(a.code))],
    issues,
    status: errors ? "INFEASIBLE" : "SUCCEEDED",
    validation: errors ? "BLOCKED" : issues.some((i) => i.severity === "WARNING") ? "WARNINGS" : "PASSED",
  };
}

/** Phases (in order) whose work fits one request; always at least one. */
export function phasesThatFit(input: EngineInput, candidates: number[], budget = WORK_UNITS_PER_REQUEST): number[] {
  const picked: number[] = [];
  let used = 0;
  for (const index of candidates) {
    const units = workUnits({ ...input, scope: { kind: "PHASES", phaseIndexes: [index] } });
    if (picked.length && used + units > budget) break;
    picked.push(index);
    used += units;
  }
  return picked;
}

export function lockedOf(result: EngineResult): ItemTarget[] {
  const seen = new Map<string, ItemTarget>();
  for (const o of result.occurrences)
    for (const i of o.items) if (i.origin === "LOCKED") seen.set(`${o.phaseIndex}|${i.slotKey}`, { phaseIndex: o.phaseIndex, slotKey: i.slotKey });
  return [...seen.values()];
}

/** What changed in the records since the latest generation of the proposal (references only), for a notice. */
function factsChanged(before: unknown, now: GenerationFactRefs): boolean {
  if (!before || typeof before !== "object") return false;
  const b = before as Partial<GenerationFactRefs>;
  const pick = (f: Partial<GenerationFactRefs>) => canonicalJson({ profile: f.profile, assessment: f.assessment, catalog: f.catalog?.hash, history: f.history && { sessions: f.history.sessions, logs: f.history.logs } });
  return pick(b) !== pick(now);
}
const FACTS_NOTICE = "Os dados do aluno, a biblioteca ou o histórico mudaram desde a geração anterior: esta operação usou os dados atuais.";

async function record(
  kind: GenerationScopeKind,
  key: { idempotencyKey: string; requestHash: string },
  input: EngineInput,
  ctx: GenerationContext,
  facts: GenerationFactRefs,
  answers: GenerationAnswers,
  scopeJson: unknown,
  baseContentVersion: number,
  adapter: { assumptions: EngineResult["assumptions"]; issues: EngineResult["issues"] },
): Promise<GenerationRecord> {
  const text = canonicalInput(input);
  // What a replay needs: the engine input and what the adapter added to the result (assumptions, issues; dates and counts only).
  const stored = `{"adapter":${canonicalJson(adapter)},"input":${text}}`;
  return {
    idempotencyKey: key.idempotencyKey,
    requestHash: key.requestHash,
    scope: kind,
    scopeJson,
    baseContentVersion,
    catalogHash: ctx.catalogHash,
    inputHash: await sha256Hex(text),
    facts,
    studentId: facts.plan.studentId,
    inputJson: stored.length <= GENERATION_INPUT_MAX ? stored : null,
    parameters: answers,
    ...(answers.blueprint
      ? { blueprintLink: { compiledHash: await sha256Hex(canonicalJson(answers.blueprint)), acceptances: answers.blueprint.acceptances.map((a) => ({
          acceptanceId: a.acceptanceId, runId: a.runId, acceptanceHash: a.acceptanceHash, blueprintHash: a.blueprintHash, structureFingerprint: answers.blueprint!.structureFingerprint,
        })) } }
      : {}),
  };
}

export function parseAnswers(raw: unknown): GenerationAnswers | null {
  try {
    return parseGenerationAnswers(raw);
  } catch (error) {
    if (error instanceof ZodError) return null;
    throw error;
  }
}

export type Built = Extract<ReturnType<typeof buildEngineInput>, { ok: true }>;

const BLUEPRINT_STALE = "A periodização salva mudou depois que a estratégia foi aceita. Aceite a estratégia de novo antes de gerar.";
const RULES_GONE = "As regras com que esta proposta foi gerada não estão mais disponíveis. Descarte e gere de novo.";

/** The rule set a proposal was born with: every later change of it runs with the same one (docs/MOTOR-PRESCRICAO.md). */
export const rulesOf = (header: Pick<ProposalHeader, "rulesId" | "rulesVersion">): RuleSetRef => ({ id: header.rulesId, version: header.rulesVersion });

/**
 * Reads the real data again and builds the engine input; any failure is an outcome. `rules`: the default for a new proposal, the
 * proposal's own rule set for every change of an open one (continue, regenerate, substitute, rebase, alternatives).
 */
export async function prepare(
  db: D1Database,
  context: AuthenticatedContext,
  planId: string,
  revisionId: string,
  answers: GenerationAnswers,
  locked: ItemTarget[],
  now: Date,
  rules: RuleSetRef = DEFAULT_RULESET,
): Promise<{ ok: true; ctx: GenerationContext; built: Built } | { ok: false; outcome: ProposalOutcome; ctx?: GenerationContext }> {
  // A proposal recorded with rules this code no longer has cannot be changed: never run it with other rules.
  if (!getRuleSet(rules)) return { ok: false, outcome: fail("invalid", { message: RULES_GONE }) };
  const loaded = await loadGenerationContext(db, context, planId, revisionId, { now, rules });
  if (loaded.status === "not_found") return { ok: false, outcome: fail("not_found") };
  if (loaded.status === "not_open") return { ok: false, outcome: fail("not_open") };
  const built = buildEngineInput(loaded.context, answers, { locked, rules });
  if (!built.ok) {
    if (built.code === "UNKNOWN_EXERCISE") return { ok: false, outcome: fail("unknown_exercise") };
    if (built.code === "UNKNOWN_TARGET") return { ok: false, outcome: fail("invalid_target", { message: "Alguma resposta cita uma fase ou um treino que não existe na periodização salva." }) };
    if (built.code === "UNSUPPORTED_RULESET") return { ok: false, ctx: loaded.context, outcome: fail("invalid", { message: built.message }) };
    // The context goes back with this refusal: a change checks first whether the revision moved (see `change`).
    return { ok: false, ctx: loaded.context, outcome: fail("invalid", { message: "Uma resposta marcada como sugestão aceita não corresponde a uma sugestão da regra. Escolha de novo." }) };
  }
  if (!built.ready) return { ok: false, outcome: fail("questions", { questions: built.questions }) };
  // The compiled strategy was planned for one saved periodization: if it moved since the acceptance, the block is stale (never applied silently).
  if (answers.blueprint && answers.blueprint.structureFingerprint !== (await structureFingerprint(built.input.structure)))
    return { ok: false, ctx: loaded.context, outcome: fail("blueprint_invalid", { message: BLUEPRINT_STALE }) };
  return { ok: true, ctx: loaded.context, built };
}

/**
 * `answersPatch` of a regeneration: the fields it sends replace the stored ones, the others stay. Lists keyed by what they are
 * about are merged by that key, never dropped by a patch that omits them: the alert decisions the professional already recorded
 * ("acceptFlagDecision") by alert code, the coverage of a phase by phase (accepting the targets of phase 2 keeps those of phase 1)
 * and the targets of a workout by phase and workout. A patch that is not an object is passed on as is, so the strict parse
 * refuses it.
 */
export function patchAnswers(stored: unknown, patch: unknown, options: { replaceBlueprint?: boolean; mergePolicyOverrides?: boolean } = {}): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const base = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const next = patch as Record<string, unknown>;
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown> | null>) : []);
  /**
   * Stored rows whose key the patch does not send, then the patch's rows; absent from the patch = the stored list as is. A field
   * the patch sends as something other than a list is passed on as sent, so the strict parse refuses it (never read as "keep
   * the stored list").
   */
  const merge = (field: string, key: (row: Record<string, unknown> | null) => string) => {
    if (!(field in next)) return {};
    if (!Array.isArray(next[field])) return { [field]: next[field] };
    const incoming = rows(next[field]);
    const keys = new Set(incoming.map(key));
    return { [field]: [...rows(base[field]).filter((r) => !keys.has(key(r))), ...incoming] };
  };
  return {
    ...base,
    ...next,
    acceptedFlagDecisions: [
      ...rows(base.acceptedFlagDecisions).filter((d) => !new Set(rows(next.acceptedFlagDecisions).map((x) => x?.flagCode)).has(d?.flagCode)),
      ...rows(next.acceptedFlagDecisions),
    ],
    ...("acceptedFlagDecisions" in next && !Array.isArray(next.acceptedFlagDecisions) ? { acceptedFlagDecisions: next.acceptedFlagDecisions } : {}),
    ...merge("phaseCoverage", (r) => JSON.stringify(r?.phaseIndex ?? null)),
    ...merge("coverageByWorkout", (r) => JSON.stringify([r?.phaseIndex ?? null, r?.label ?? null])),
    // Only an assisted adjustment merges the dose adjustments (by item, phase, workout and parameters); a form patch still replaces the list.
    ...(options.mergePolicyOverrides === true && Array.isArray(next.policyOverrides)
      ? { policyOverrides: mergeDoseOverrides(rows(base.policyOverrides) as never[], rows(next.policyOverrides) as never[]) }
      : {}),
    ...("blueprint" in next ? { blueprint: mergeBlueprint(base.blueprint, next.blueprint, options.replaceBlueprint === true) } : {}),
  };
}

/**
 * The compiled strategy block of a patch (only the server's own path sends one, never the client). A partial replan (one phase, or
 * from a phase on) MERGES: the workouts of the patch replace those with the same (phase, label), the others keep their own entry and
 * their own `acceptanceId`; acceptances are merged by id and the ones no workout cites are dropped. A full replan (`replace`)
 * takes the patch as it is. Dosing: the patch's when it sends one, else the stored. Anything that is not a block is passed on
 * as sent, so the strict parse refuses it.
 */
export function mergeBlueprint(stored: unknown, patch: unknown, replace: boolean): unknown {
  const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  if (replace || !isObject(patch) || !isObject(stored)) return patch;
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  const wkey = (w: Record<string, unknown>) => JSON.stringify([w?.phaseIndex ?? null, w?.label ?? null]);
  const incoming = rows(patch.workouts);
  const replaced = new Set(incoming.map(wkey));
  const workouts = [...rows(stored.workouts).filter((w) => !replaced.has(wkey(w))), ...incoming].sort(
    (a, b) => Number(a?.phaseIndex ?? 0) - Number(b?.phaseIndex ?? 0) || cmp(String(a?.label ?? ""), String(b?.label ?? "")),
  );
  const cited = new Set(workouts.map((w) => w?.acceptanceId));
  const byId = new Map<unknown, Record<string, unknown>>();
  for (const a of [...rows(stored.acceptances), ...rows(patch.acceptances)]) byId.set(a?.acceptanceId, a);
  const acceptances = [...byId.values()].filter((a) => cited.has(a?.acceptanceId)).sort((a, b) => cmp(String(a?.acceptanceId ?? ""), String(b?.acceptanceId ?? "")));
  const dosing = "dosing" in patch ? patch.dosing : stored.dosing;
  return { ...stored, ...patch, workouts, acceptances, ...(dosing === undefined ? {} : { dosing }) };
}

/**
 * Rebase only brings the draft's current rows in; it never re-plans sessions. So it is refused unless the saved periodization
 * still has exactly the same phases (order, index, name, weeks, sessions per week) and, in every generated phase, exactly the same sessions (week, slot,
 * label, week start and planned date), in both directions: no session gone, moved or renamed, and none added.
 */
function sameShape(structure: StructureFacts, previous: EngineResult, phasesGenerated: number[]): boolean {
  const phase = (p: { phaseIndex: number; name: string | null; weeks: number; sessionsPerWeek: number }) => `${p.phaseIndex}|${p.name ?? ""}|${p.weeks}|${p.sessionsPerWeek}`;
  const now = structure.phases.map((p) => phase({ phaseIndex: p.index, name: p.name, weeks: p.weeks, sessionsPerWeek: p.sessionsPerWeek }));
  const before = previous.phases.map(phase);
  if (now.length !== before.length || now.some((k, n) => before[n] !== k)) return false;
  const generated = new Set(phasesGenerated);
  const sig = (phaseIndex: number, o: { week: number; slot: number; label: string; weekStart: string; plannedDate: string | null }) =>
    `${phaseIndex}|${o.week}|${o.slot}|${o.label}|${o.weekStart}|${o.plannedDate ?? ""}`;
  const want = structure.phases.filter((ph) => generated.has(ph.index)).flatMap((ph) => ph.occurrences.map((o) => sig(ph.index, o))).sort();
  const have = previous.occurrences.map((o) => sig(o.phaseIndex, o)).sort();
  return want.length === have.length && want.every((k, n) => have[n] === k);
}

function engineOk(out: EngineOutcome): { ok: true; result: EngineResult } | { ok: false; outcome: ProposalOutcome } {
  if (out.ok) return { ok: true, result: out.result };
  if (out.code === "TARGET_NOT_FOUND" || out.code === "SCOPE_NOT_FOUND") return { ok: false, outcome: fail("invalid_target", { message: out.message }) };
  return { ok: false, outcome: fail("engine_refused", { message: out.message }) };
}

// ---------- the audit of a proposal recorded before the audit (design V3 §3.9) ----------

/** The rules of an audit computed at view time: the current default (it carries the audit rules). */
export const AUDIT_RULESET: RuleSetRef = DEFAULT_RULESET;

/**
 * The plan audit of a stored proposal that has none (generated before engine 2.1.0), from its stored content and today's
 * library, with the audit rules of `rules`. Pure: the proposal is not changed and nothing is written back. Exercises no longer
 * in the library count as "não contado". Before 2.1.0 the adapter sent only minutes as a workout's focus (`facts.ts`), so every
 * stored target came from the phase coverage: it is read as a phase target. Null when `rules` has no audit rules.
 */
export function auditOfStored(result: Pick<EngineResult, "phases" | "workouts" | "occurrences"> & Partial<Pick<EngineResult, "rules">>, catalog: readonly CatalogExercise[], rules: RuleSetRef = AUDIT_RULESET): AuditReport | null {
  const log = ruleLogFor(rules);
  if (!log || !log.optional("AUDIT_THRESHOLDS")) return null;
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const workouts = result.workouts.map((w) => (w.coverage && !w.coverage.origin ? { ...w, coverage: { ...w.coverage, origin: "PHASE_COVERAGE" as const } } : w));
  const volume = volumeFor(log, result.occurrences, byId);
  // The suggested action of AUDIT_NO_TARGETS follows the proposal's OWN rules (a regeneration runs with them and refuses an
  // acceptance they cannot back): no suggestion unless they carry MICROCYCLE_TARGET_SUGGESTIONS (design V3 §3.9).
  const own = result.rules ? ruleLogFor(result.rules) : null;
  const suggestionsAccepted = Boolean(own?.optional("MICROCYCLE_TARGET_SUGGESTIONS"));
  return boundAudit(log, auditPlan({ log, phases: result.phases, structure: null, workouts, occurrences: result.occurrences, volume, byId, suggestionsAccepted }));
}

export type BlueprintOutcome = { status: "ok"; blueprint: ProposalBlueprintView | null } | { status: "not_found" };

export type AuditOutcome = { status: "ok"; audit: AuditReport; source: "STORED" | "VIEW"; rules: RuleSetRef } | { status: "not_found" };

/**
 * Audits computed at view time, kept in the isolate's memory so that phase and week clicks on a proposal recorded before the
 * audit do not read the whole proposal and recompute it on every render (design V3 §3.9; ≈ 35–55 ms of CPU locally for 12 phases
 * × 4 weeks × 7 sessions and 200 exercises). The key is the organization, the proposal, its version and a digest of the library
 * as read now, so any change to the proposal or to the library computes it again. It is consulted only after the gated reads
 * (header and library) succeed, so it never answers for someone who no longer reaches the proposal. Bounded, least recently
 * used first out; it lives only as long as the isolate and is never written anywhere.
 */
const VIEW_AUDIT_MEMO_LIMIT = 16;
const viewAuditMemo = new Map<string, AuditReport>();

function rememberViewAudit(key: string, audit: AuditReport): void {
  viewAuditMemo.delete(key);
  viewAuditMemo.set(key, audit);
  while (viewAuditMemo.size > VIEW_AUDIT_MEMO_LIMIT) viewAuditMemo.delete(viewAuditMemo.keys().next().value as string);
}

/** Test seam: how many view-time audits are remembered (and a way to forget them). */
export const viewAuditMemoForTests = { size: () => viewAuditMemo.size, clear: () => viewAuditMemo.clear() };

// ---------- the service ----------

/**
 * The compiled strategy (`answers.blueprint`) for a generation, built by the server from a stored acceptance (`planejador/compile.ts`,
 * sub-stage 2.3). It is a separate argument of `generate`, not part of the payload: actions and the browser cannot reach it, and a
 * payload that carries a `blueprint` is refused. Every acceptance it cites must belong to this revision (the write fails whole otherwise).
 */
export interface InternalBlueprint {
  blueprint: unknown;
}

export function proposalService(
  db: D1Database,
  context: AuthenticatedContext,
  options: { now?: () => Date; workUnitsPerRequest?: number } = {},
) {
  const repo = proposalsFor(db, context);
  const clock = options.now ?? (() => new Date());
  const budget = options.workUnitsPerRequest ?? WORK_UNITS_PER_REQUEST;

  /** Shared path of every keyed engine run on an open proposal. */
  async function change(
    planId: string,
    revisionId: string,
    p: { proposalId: string; idempotencyKey: string; writeId: string; expectedVersion: number },
    kind: string,
    hashPayload: unknown,
    run: (args: {
      header: ProposalHeader;
      previous: EngineResult;
      ctx: GenerationContext;
      built: Built;
      answers: GenerationAnswers;
    }) => { ok: true; scope: GenerationScopeKind; scopeJson: unknown; input: EngineInput; result: EngineResult; target: unknown } | { ok: false; outcome: ProposalOutcome },
    opts: { answersPatch?: unknown; rebase?: boolean; replaceBlueprint?: boolean; mergePolicyOverrides?: boolean } = {},
  ): Promise<ProposalOutcome> {
    const now = clock();
    const key = { idempotencyKey: p.idempotencyKey, requestHash: await requestHash(kind, { planId, revisionId, ...(hashPayload as object) }) };
    const replay = await repo.mutationReplay(planId, revisionId, p.proposalId, key, p.writeId);
    if (replay) return fromMutate(p.proposalId, replay, (await repo.header(planId, revisionId, p.proposalId, "ANY"))?.complete ?? false);
    const snap = await repo.asEngineResult(planId, revisionId, p.proposalId);
    if (!snap) return fail("not_found");
    const { header, result: previous } = snap;
    if (header.state !== "OPEN") return fail("closed");
    if (header.version !== p.expectedVersion) return fail("conflict", { version: header.version });
    const answers = parseAnswers(opts.answersPatch === undefined ? header.parameters : patchAnswers(header.parameters, opts.answersPatch, { replaceBlueprint: opts.replaceBlueprint === true, mergePolicyOverrides: opts.mergePolicyOverrides === true }));
    if (!answers) return fail("invalid", { message: "As respostas desta proposta não são mais aceitas pelas regras atuais. Descarte e gere de novo." });
    const prepared = await prepare(db, context, planId, revisionId, answers, lockedOf(previous), now, rulesOf(header));
    if (!prepared.ok) {
      // An accepted suggestion stops matching when the periodization changed (sessions per week, workouts): that change is the
      // answer, as it would be once the answers were built, not "escolha de novo".
      const moved = prepared.ctx;
      if (moved && !opts.rebase && moved.revision.contentVersion !== header.baseContentVersion)
        return fail("revision_changed", { contentVersion: moved.revision.contentVersion });
      if (moved && opts.rebase && !sameShape(structureFacts(moved.revision.schedule), previous, header.phasesGenerated)) return fail("structure_changed");
      return prepared.outcome;
    }
    const { ctx, built } = prepared;
    if (!opts.rebase && ctx.revision.contentVersion !== header.baseContentVersion)
      return fail("revision_changed", { contentVersion: ctx.revision.contentVersion });
    const ran = run({ header, previous, ctx, built, answers });
    if (!ran.ok) return ran.outcome;
    const result = withAdapter(ran.result, built);
    const base = opts.rebase ? ctx.revision.contentVersion : header.baseContentVersion;
    const rec = await record(ran.scope, key, ran.input, ctx, built.facts, answers, ran.scopeJson, base, built);
    const out = await repo.recordChange(planId, revisionId, p.proposalId, { expectedVersion: p.expectedVersion, writeId: p.writeId }, rec, previous, result, { target: ran.target }, now);
    const complete = result.phases.every((ph) => result.occurrences.some((o) => o.phaseIndex === ph.phaseIndex));
    const outcome = fromMutate(p.proposalId, out, complete, factsChanged(header.lastFacts, built.facts) ? FACTS_NOTICE : undefined);
    return outcome.ok && !outcome.replayed ? { ...outcome, progress: progressOf(result) } : outcome;
  }

  /** The engine step of a regeneration of `typed` (shared by `regenerate` and `replan`): the touched phases must exist, be generated and fit one request. */
  function regenerateStep(typed: RegenerationScope, opts: { generatedOnly?: boolean } = {}) {
    return ({ header, previous, built }: { header: ProposalHeader; previous: EngineResult; built: Built }) => {
      const order = built.input.structure.phases.map((ph) => ph.index);
      const touched = typed.kind === "FROM_PHASE" ? order.slice(Math.max(0, order.indexOf(typed.phaseIndex))) : [typed.phaseIndex];
      if (!order.includes(typed.phaseIndex)) return { ok: false as const, outcome: fail("invalid_target") };
      // "The whole proposal" (replan FULL) means the phases that exist: a proposal cut short by the work budget keeps its ungenerated ones.
      const scoped = opts.generatedOnly ? touched.filter((i) => header.phasesGenerated.includes(i)) : touched;
      if (opts.generatedOnly && !scoped.length) return { ok: false as const, outcome: fail("incomplete") };
      if (scoped.some((i) => !header.phasesGenerated.includes(i)))
        return { ok: false as const, outcome: typed.kind === "FROM_PHASE" ? fail("incomplete") : fail("invalid_target", { message: "Esta fase ainda não foi gerada: continue a geração primeiro." }) };
      if ((typed.kind === "PHASE" || typed.kind === "FROM_PHASE") && workUnits({ ...built.input, scope: { kind: "PHASES", phaseIndexes: scoped } }) > budget && scoped.length > 1)
        return { ok: false as const, outcome: fail("too_large") };
      let out = engineOk(regenerate(built.input, previous, opts.generatedOnly && scoped.length < touched.length ? { kind: "PHASE", phaseIndex: scoped[0] } : typed));
      if (!out.ok) return out;
      if (opts.generatedOnly && scoped.length < touched.length)
        for (const index of scoped.slice(1)) {
          out = engineOk(regenerate(built.input, out.result, { kind: "PHASE", phaseIndex: index }));
          if (!out.ok) return out;
        }
      return { ok: true as const, scope: typed.kind as GenerationScopeKind, scopeJson: typed as unknown, input: built.input, result: out.result, target: typed as unknown };
    };
  }

  return {
    /**
     * "Gerar prescrição automática": reads the real data, asks what is missing, runs the engine on the phases that fit one
     * request and records a new OPEN proposal. Never writes the prescription.
     */
    async generate(planId: string, revisionId: string, payload: GeneratePayload, internal?: InternalBlueprint): Promise<ProposalOutcome> {
      const parsed = generateSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      if (carriesBlueprint(parsed.data.answers)) return fail("invalid", { message: CLIENT_BLUEPRINT_REFUSED });
      // The compiled strategy only enters through the server's own argument (never the payload): see `InternalBlueprint`.
      const answers = parseAnswers(internal ? { ...(parsed.data.answers ?? {}), blueprint: internal.blueprint } : parsed.data.answers);
      if (!answers) return fail("invalid", { message: "Confira as respostas: algum valor não é aceito (código, número ou lista)." });
      // Só o padrão ou uma versão de adesão publicada: qualquer outra é recusada (nunca uma versão antiga por engano).
      const rules = rulesetForNewGeneration(parsed.data.rulesVersion);
      if (!rules) return fail("invalid", { message: "Versão de regras não disponível para novas gerações." });
      const now = clock();
      const key = {
        idempotencyKey: parsed.data.idempotencyKey,
        // A versão entra na impressão só quando difere do padrão: pedidos antigos continuam com o mesmo hash.
        requestHash: await requestHash("GENERATE", { planId, revisionId, baseContentVersion: parsed.data.baseContentVersion, answers, ...(rules.version !== DEFAULT_RULESET.version ? { rulesVersion: rules.version } : {}) }),
      };
      const replay = await repo.replayOf(planId, revisionId, key);
      if (replay) return fromGenerate(replay);
      const prepared = await prepare(db, context, planId, revisionId, answers, [], now, rules);
      if (!prepared.ok) return prepared.outcome;
      const { ctx, built } = prepared;
      if (ctx.revision.contentVersion !== parsed.data.baseContentVersion) return fail("revision_changed", { contentVersion: ctx.revision.contentVersion });
      const open = await repo.open(planId, revisionId);
      if (open) return fail("open_exists", { proposalId: open.id });
      const all = built.input.structure.phases.map((ph) => ph.index);
      const picked = phasesThatFit(built.input, all, budget);
      const input: EngineInput = { ...built.input, scope: picked.length === all.length ? { kind: "FULL" } : { kind: "PHASES", phaseIndexes: picked } };
      const result = withAdapter(generate(input), built);
      const rec = await record("FULL", key, input, ctx, built.facts, answers, { phases: picked }, ctx.revision.contentVersion, built);
      const out = await repo.recordGeneration(planId, revisionId, rec, result, now);
      const generated = fromGenerate(out, picked.length < all.length ? `Geradas ${picked.length} de ${all.length} fases (limite técnico por pedido). Continue a geração para as demais.` : undefined);
      return generated.ok && !generated.replayed ? { ...generated, progress: progressOf(result) } : generated;
    },

    /** "Continuar a geração": the next phases that fit, with the same answers and the current data. */
    async continue(planId: string, revisionId: string, payload: ContinuePayload): Promise<ProposalOutcome> {
      const parsed = continueSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const { proposalId, expectedVersion } = parsed.data;
      return change(planId, revisionId, parsed.data, "CONTINUE", { proposalId, expectedVersion }, ({ header, previous, built }) => {
        const missing = built.input.structure.phases.map((ph) => ph.index).filter((i) => !header.phasesGenerated.includes(i));
        if (!missing.length) return { ok: false, outcome: fail("already_complete") };
        const picked = phasesThatFit(built.input, missing, budget);
        let result = previous;
        for (const index of picked) {
          const out = engineOk(regenerate(built.input, result, { kind: "PHASE", phaseIndex: index }));
          if (!out.ok) return out;
          result = out.result;
        }
        return { ok: true, scope: "CONTINUE", scopeJson: { phases: picked }, input: { ...built.input, scope: { kind: "PHASES", phaseIndexes: picked } }, result, target: { phases: picked } };
      });
    },

    /** Regenerates one item, session, week, workout (from a week on), phase, or from a phase on. Locked and preserved items stay. */
    async regenerate(planId: string, revisionId: string, payload: RegeneratePayload): Promise<ProposalOutcome> {
      const parsed = regenerateSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const { proposalId, expectedVersion, scope, answers } = parsed.data;
      if (carriesBlueprint(answers)) return fail("invalid", { message: CLIENT_BLUEPRINT_REFUSED });
      const typed = scope as RegenerationScope;
      return change(planId, revisionId, parsed.data, "REGENERATE", { proposalId, expectedVersion, scope, answers: answers ?? null }, regenerateStep(typed), { answersPatch: answers });
    },

    /**
     * "Voltar à estratégia" (design §4.6): applies a compiled strategy to a phase, from a phase on, or to the whole proposal, regenerating
     * the touched phases. Same path as `regenerate` (locked, preserved and substituted items stay; the answers keep every earlier decision),
     * with the compiled block merged into the stored one by (phase, label) and by acceptance (a FULL replan replaces the block). The block is
     * the server's own argument, like `generate`'s: never in the payload.
     */
    async replan(planId: string, revisionId: string, payload: ReplanPayload, internal: InternalBlueprint): Promise<ProposalOutcome> {
      const parsed = replanSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const { proposalId, expectedVersion, scope } = parsed.data;
      const blueprintDigest = await sha256Hex(canonicalJson(internal.blueprint));
      return change(
        planId,
        revisionId,
        parsed.data,
        "REPLAN",
        { proposalId, expectedVersion, scope, blueprint: blueprintDigest },
        (args) => {
          // FULL = every generated phase: from the first one on.
          const order = args.built.input.structure.phases.map((ph) => ph.index);
          const first = order.find((i) => args.header.phasesGenerated.includes(i));
          const typed: RegenerationScope = scope.kind === "FULL" ? { kind: "FROM_PHASE", phaseIndex: first ?? order[0] } : scope;
          return regenerateStep(typed, { generatedOnly: scope.kind === "FULL" })(args);
        },
        { answersPatch: { blueprint: internal.blueprint }, replaceBlueprint: scope.kind === "FULL" },
      );
    },

    /** Substitutes the exercise of an item in one session, from a week on, or in the whole phase, by one the professional chose. */
    async substitute(planId: string, revisionId: string, payload: SubstitutePayload): Promise<ProposalOutcome> {
      const parsed = substituteSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const { proposalId, expectedVersion, target, newExerciseId } = parsed.data;
      return change(planId, revisionId, parsed.data, "SUBSTITUTE", { proposalId, expectedVersion, target, newExerciseId }, ({ ctx, previous, built }) => {
        // Only an exercise of the library visible to this organization (not archived): never a foreign id.
        if (!ctx.catalog.some((e) => e.id === newExerciseId)) return { ok: false, outcome: fail("unknown_exercise") };
        const out = engineOk(substitute(built.input, previous, target as SubstitutionTarget, newExerciseId));
        if (!out.ok) return out;
        return { ok: true, scope: "SUBSTITUTE", scopeJson: { target, newExerciseId }, input: built.input, result: out.result, target: { target, newExerciseId } };
      });
    },

    /**
     * "Aplicar ajuste à proposta" (assisted adjustments, design V4 §6.6): applies ONLY the point change the professional saw, as a new version of the
     * proposal through the same compare-and-set path as a substitution, without regenerating anything else. The operations are re-simulated on the
     * CURRENT stored proposal (the stored diff is never trusted): a violated constraint, an operation without effect, or an unchecked constraint the
     * professional did not acknowledge refuses the write. Dose operations are also appended to `answers.policyOverrides`, so a later regeneration
     * keeps them. It never approves, applies to the draft or delivers; a delivered revision is `not_open`.
     */
    async applyAdjustment(
      planId: string,
      revisionId: string,
      payload: { proposalId: string; idempotencyKey: string; writeId: string; expectedVersion: number },
      adjustment: { adjustmentId: string; ops: readonly ResolvedOp[]; constraints: readonly ResolvedConstraint[]; acknowledgeUncheckable: boolean },
    ): Promise<ProposalOutcome> {
      const parsed = continueSchema.safeParse(payload);
      if (!parsed.success || !adjustment.ops.length) return fail("invalid");
      const { proposalId, expectedVersion } = parsed.data;
      const doseOps = adjustment.ops.filter((o): o is Extract<ResolvedOp, { kind: "DOSE" }> => o.kind === "DOSE");
      return change(
        planId,
        revisionId,
        parsed.data,
        "ADJUST",
        { proposalId, expectedVersion, adjustmentId: adjustment.adjustmentId },
        ({ ctx, previous, built }) => {
          const sim = simulateAdjustments(built.input, previous, adjustment.ops);
          if (!sim.ok) return { ok: false, outcome: fail("engine_refused", { message: sim.message }) };
          if (sim.noEffect.length) return { ok: false, outcome: fail("adjustment_blocked", { message: "A progressão da fase define este valor: o ajuste não teria efeito." }) };
          const checks = evaluateConstraints(previous, sim.result, adjustment.constraints, new Map(ctx.catalog.map((e) => [e.id, e])), adjustment.ops);
          if (checks.some((c) => c.status === "VIOLATED"))
            return { ok: false, outcome: fail("adjustment_blocked", { message: checks.find((c) => c.status === "VIOLATED")?.detail ?? MESSAGES.adjustment_blocked }) };
          if (checks.some((c) => c.status === "UNCHECKABLE") && !adjustment.acknowledgeUncheckable)
            return { ok: false, outcome: fail("adjustment_blocked", { message: "Há restrições que não puderam ser verificadas: confirme para aplicar mesmo assim." }) };
          return {
            ok: true,
            scope: doseOps.length ? "ITEM" : "SUBSTITUTE",
            scopeJson: { adjustment: adjustment.adjustmentId, operations: adjustment.ops.length },
            input: built.input,
            result: sim.result,
            target: { adjustment: adjustment.adjustmentId },
          };
        },
        doseOps.length ? { answersPatch: { policyOverrides: doseOps.map(overrideOf) }, mergePolicyOverrides: true } : {},
      );
    },

    /**
     * "Atualizar com as linhas atuais da revisão": after the draft changed, brings its current rows into the proposal as
     * preserved, revalidates and moves the proposal's base to the current content version. Refused when the structure changed.
     */
    async rebase(planId: string, revisionId: string, payload: ContinuePayload): Promise<ProposalOutcome> {
      const parsed = continueSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const { proposalId, expectedVersion } = parsed.data;
      return change(
        planId,
        revisionId,
        parsed.data,
        "REBASE",
        { proposalId, expectedVersion },
        ({ header, previous, built, ctx }) => {
          if (!sameShape(built.input.structure, previous, header.phasesGenerated)) return { ok: false, outcome: fail("structure_changed") };
          const out = engineOk(rebase(built.input, previous));
          if (!out.ok) return out;
          return { ok: true, scope: "REBASE", scopeJson: { contentVersion: ctx.revision.contentVersion }, input: built.input, result: out.result, target: { contentVersion: ctx.revision.contentVersion } };
        },
        { rebase: true },
      );
    },

    /** Locks or unlocks items (by slot key, every session of the phase): the next regeneration keeps a locked item as it is. */
    async lock(planId: string, revisionId: string, payload: LockPayload): Promise<ProposalOutcome> {
      const parsed = lockSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const { proposalId, writeId, expectedVersion, targets, locked } = parsed.data;
      const out = await repo.setLocked(planId, revisionId, proposalId, { expectedVersion, writeId }, targets, locked, clock());
      return fromMutate(proposalId, out, (await repo.header(planId, revisionId, proposalId, "ANY"))?.complete ?? false);
    },

    /** Records the professional's decision about an alert, used by the next regeneration. */
    async acceptFlagDecision(planId: string, revisionId: string, payload: FlagPayload): Promise<ProposalOutcome> {
      const parsed = flagSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const { proposalId, writeId, expectedVersion, flagCode, decision } = parsed.data;
      if (decision.kind === "EXCLUDE_EXERCISE" && !(await exercisesFor(db, context).list({})).some((e) => e.id === decision.exerciseId))
        return fail("unknown_exercise");
      const out = await repo.acceptFlagDecision(planId, revisionId, proposalId, { expectedVersion, writeId }, flagCode, decision, clock());
      return fromMutate(proposalId, out, (await repo.header(planId, revisionId, proposalId, "ANY"))?.complete ?? false,
        out.status === "saved" && !out.replayed ? "Decisão registrada. Ela vale a partir da próxima regeneração." : undefined);
    },

    /** Discards an open proposal: nothing of it reaches the draft; its history stays. */
    async discard(planId: string, revisionId: string, payload: CasPayload): Promise<ProposalOutcome> {
      const parsed = casSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const { proposalId, writeId, expectedVersion } = parsed.data;
      const out = await repo.discard(planId, revisionId, proposalId, { expectedVersion, writeId }, clock());
      return fromMutate(proposalId, out, (await repo.header(planId, revisionId, proposalId, "ANY"))?.complete ?? false);
    },

    /**
     * The generation form's data (design §6.1 `generation-form`, `context-summary`): the structure, the questions still open
     * with no answer yet, the adapter's assumptions, the facts that will be read, the dose policy table and the previous answers.
     * Reads only; nothing is generated.
     */
    async screen(planId: string, revisionId: string): Promise<{ status: "ok"; screen: GenerationScreen } | { status: "not_found" | "not_open" }> {
      const loaded = await loadGenerationContext(db, context, planId, revisionId, { now: clock() });
      if (loaded.status !== "ok") return { status: loaded.status };
      const built = buildEngineInput(loaded.context, parseGenerationAnswers({}));
      if (!built.ok) return { status: "not_found" };
      const last = await repo.lastAnswers(planId);
      return { status: "ok", screen: { ...screenOf(loaded.context, built), lastAnswers: last ? { createdAt: last.createdAt, answers: last.answers } : null } };
    },

    /**
     * Alternatives for one item of the open proposal (design §6.1 `substitute-dialog`): ranked by the engine from the visible
     * library with the proposal's answers, each labelled reviewed or inferred. Empty when nothing compatible is left.
     */
    async alternatives(
      planId: string,
      revisionId: string,
      raw: { proposalId: string; phaseIndex: number; slotKey: string; week?: number; slot?: number },
    ): Promise<{ status: "ok"; alternatives: Array<{ exerciseId: string; name: string; metadata: string; reasons: string[] }> } | { status: "not_found" | "invalid" }> {
      const parsed = alternativesSchema.safeParse(raw);
      if (!parsed.success) return { status: "invalid" };
      const snap = await repo.asEngineResult(planId, revisionId, parsed.data.proposalId);
      if (!snap || snap.header.state !== "OPEN") return { status: "not_found" };
      const answers = parseAnswers(snap.header.parameters);
      if (!answers) return { status: "invalid" };
      const prepared = await prepare(db, context, planId, revisionId, answers, lockedOf(snap.result), clock(), rulesOf(snap.header));
      if (!prepared.ok) return { status: "not_found" };
      const { proposalId, ...target } = parsed.data;
      void proposalId;
      const rules = getRuleSet(prepared.built.input.rules);
      const limit = rules?.rules.ALTERNATIVES_LIMIT.value ?? 8;
      const list = alternativesFor(prepared.built.input, snap.result, target, limit);
      return { status: "ok", alternatives: list.map((a) => ({ exerciseId: a.exerciseId, name: a.name, metadata: a.metadata, reasons: a.reasons })) };
    },

    /**
     * The strategy a proposal was generated with (design V4 §4.7): the compiled block stored in its answers plus the recorded links
     * (acceptance, planner run, blueprint and response hashes). Null block for a proposal with no strategy. Read-only, gated.
     */
    async blueprint(planId: string, revisionId: string, proposalId: string): Promise<BlueprintOutcome> {
      // Gated reads only (the header carries the stored answers, the links are gated by the same proposal); nothing is computed or written.
      const head = await repo.summary(planId, revisionId, proposalId);
      if (!head) return { status: "not_found" };
      const links = await repo.blueprintLinks(planId, revisionId, proposalId);
      return { status: "ok", blueprint: proposalBlueprintView(head.header.parameters, links) };
    },

    /**
     * Movement patterns of the given exercises, from the library as this organization sees it (gated like the audit's library read): the
     * review lists each row under its pattern ("Empurrar horizontal • Supino"). Only the asked ids come back; an id outside the library is absent.
     */
    async patternsOf(planId: string, revisionId: string, exerciseIds: readonly string[]): Promise<{ status: "ok"; byId: Record<string, string[]> } | { status: "not_found" }> {
      const loaded = await loadCatalogForPlan(db, context, planId, revisionId);
      if (loaded.status !== "ok") return { status: "not_found" };
      const wanted = new Set(exerciseIds.slice(0, 500));
      const byId: Record<string, string[]> = {};
      for (const e of loaded.catalog) if (wanted.has(e.id) && e.patterns.length) byId[e.id] = [...e.patterns];
      return { status: "ok", byId };
    },

    /** Primary muscles of the listed exercises (the constraint chips of the assisted adjustments: "sem aumentar o volume semanal de ..."). Gated read. */
    async musclesOf(planId: string, revisionId: string, exerciseIds: readonly string[]): Promise<{ status: "ok"; byId: Record<string, string[]> } | { status: "not_found" }> {
      const loaded = await loadCatalogForPlan(db, context, planId, revisionId);
      if (loaded.status !== "ok") return { status: "not_found" };
      const wanted = new Set(exerciseIds.slice(0, 500));
      const byId: Record<string, string[]> = {};
      for (const e of loaded.catalog) if (wanted.has(e.id) && e.primaryMuscles.length) byId[e.id] = [...e.primaryMuscles];
      return { status: "ok", byId };
    },

    /**
     * The plan audit of an open proposal (design V3 §3.9). A proposal generated with the audit rules carries it in its summary
     * (the page reads it from there, with no call here). One generated before has none: it is computed now from the whole stored
     * proposal (one gated read) and the library (gated `loadCatalogForPlan`), labelled with the rules used, and never written back.
     */
    async viewAudit(planId: string, revisionId: string, proposalId: string): Promise<AuditOutcome> {
      // Gated reads first: the header (with the summary, on a DRAFT revision as the full read below) and the library. The memo is
      // consulted only after both succeed.
      const head = await repo.summary(planId, revisionId, proposalId);
      if (!head || head.header.revisionState !== "DRAFT") return { status: "not_found" };
      if (head.summary.audit) return { status: "ok", audit: head.summary.audit, source: "STORED", rules: head.summary.audit.rules };
      const loaded = await loadCatalogForPlan(db, context, planId, revisionId);
      if (loaded.status !== "ok") return { status: "not_found" };
      const library = await sha256Hex(canonicalJson([...loaded.catalog].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))));
      const key = `${context.organizationId}|${proposalId}|${head.header.version}|${AUDIT_RULESET.id}@${AUDIT_RULESET.version}|${library}`;
      const remembered = viewAuditMemo.get(key);
      if (remembered) {
        rememberViewAudit(key, remembered);
        return { status: "ok", audit: remembered, source: "VIEW", rules: remembered.rules };
      }
      const snap = await repo.asEngineResult(planId, revisionId, proposalId);
      if (!snap) return { status: "not_found" };
      const audit = auditOfStored(snap.result, loaded.catalog);
      if (!audit) return { status: "not_found" };
      // Remembered only when the content read is the version of the key (a write in between computes it again next time).
      if (snap.header.version === head.header.version) rememberViewAudit(key, audit);
      return { status: "ok", audit, source: "VIEW", rules: audit.rules };
    },

    /**
     * The suggested targets of phases of an open proposal (design V3 §4.6, §7.4), for the card of a phase without targets. Only
     * when the proposal's own rule set has the suggestion rule (a regeneration runs with it and would refuse anything else).
     * Computed from the proposal's answers and the saved periodization (one gated read, `loadScheduleForPlan`) with the same
     * pure pieces a regeneration uses to check an acceptance (`suggestedTargets`), so "Aceitar" sends exactly what the server
     * checks; no library, history or student data is read on render. Nothing is written.
     */
    async targetSuggestions(
      planId: string,
      revisionId: string,
      proposalId: string,
      phaseIndexes: number[],
    ): Promise<{ status: "ok"; suggestions: Array<{ phaseIndex: number; suggestion: TargetSuggestion | null; reason: string | null }> } | { status: "not_found" }> {
      const head = await repo.summary(planId, revisionId, proposalId);
      if (!head || head.header.state !== "OPEN" || head.header.revisionState !== "DRAFT") return { status: "not_found" };
      const rules = rulesOf(head.header);
      if (!getRuleSet(rules)?.rules.MICROCYCLE_TARGET_SUGGESTIONS || !phaseIndexes.length) return { status: "ok", suggestions: [] };
      const answers = parseAnswers(head.header.parameters);
      if (!answers) return { status: "ok", suggestions: [] };
      const loaded = await loadScheduleForPlan(db, context, planId, revisionId);
      if (loaded.status !== "ok") return { status: "not_found" };
      return { status: "ok", suggestions: suggestedTargets(loaded.schedule, answers, rules, phaseIndexes) };
    },

    /** What "Aplicar ao rascunho" would write and what it asks first. Null when the proposal is not reachable. */
    async previewApply(planId: string, revisionId: string, proposalId: string): Promise<ApplyPreview | null> {
      return repo.applyPreview(planId, revisionId, proposalId);
    },

    /**
     * "Aplicar ao rascunho": writes the proposal into the same DRAFT revision (one batch), keeping every row already there unless
     * the professional confirmed, workout by workout, that those rows are replaced. An INFEASIBLE proposal needs its explicit
     * confirmation (Q8). Approval stays the professional's own act, afterwards, through the existing flow.
     */
    async apply(planId: string, revisionId: string, payload: ApplyPayload): Promise<ApplyServiceOutcome> {
      const parsed = applySchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: "invalid", message: APPLY_MESSAGES.invalid };
      const { proposalId, idempotencyKey, expectedVersion, conflictMode, confirmedWorkouts, confirmInfeasible } = parsed.data;
      const workouts = [...new Set(confirmedWorkouts.map((w) => `${w.phaseIndex}|${w.label}`))].sort();
      if (conflictMode === "PRESERVE" && workouts.length) return { ok: false, reason: "invalid", message: APPLY_MESSAGES.invalid };
      const hash = await requestHash("APPLY", { planId, revisionId, proposalId, expectedVersion, conflictMode, workouts, confirmInfeasible });
      const out = await repo.apply(
        planId,
        revisionId,
        proposalId,
        { idempotencyKey, requestHash: hash, expectedVersion, conflictMode, confirmedWorkouts, confirmInfeasible },
        clock(),
      );
      return fromApply(out);
    },
  };
}
