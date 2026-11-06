/**
 * Revisão opcional por IA (handoff V3 §8, design V3 §6): só contratos. O motor determinístico continua responsável por todo
 * cálculo e geração; nada aqui aprova, entrega ou altera uma proposta. Uma sugestão da IA só valeria depois do aceite do
 * profissional e de uma nova validação do motor (fluxo não construído).
 *
 * Arquivo puro (sem `server-only`, banco, rede ou relógio) para que o servidor e os testes validem a resposta da mesma forma.
 */
import { z } from "zod";
import { MUSCLES, PATTERNS } from "@/modules/biblioteca/metadata/vocabulary";
import { canonicalJson, sha256Hex } from "@/modules/prescricao/motor/hash";
import { DOSE_TEXT, REFERENCE_TEXT } from "@/modules/prescricao/planejador/text-guards";
import type { AuditRange, AuditStatus, AuditUnit, Basis, Severity } from "@/modules/prescricao/motor/types";

/** Versão do texto de instrução (prompt) que acompanharia o resumo. Entra na chave de cache. */
export const AI_PROMPT_VERSION = "2026.11.1";

// ---------- resumo enviado (compacto e sem identificação) ----------

/**
 * Exercício por apelido (`X1`, `X2`…): nem o id nem o nome saem do servidor. A biblioteca é da organização e o nome é digitado
 * pelo profissional (pode carregar qualquer texto); o modelo vê só modalidade, músculos e padrões.
 */
export interface AiSummaryExercise {
  alias: string;
  modality: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  patterns: string[];
}

export interface AiSummaryWorkout {
  /** Apelido do rótulo (`T1`…; o mesmo rótulo tem o mesmo apelido em todas as fases). Rótulo e nome livres não são enviados. */
  label: string;
  modalities: string[];
  exposuresPerWeek: AuditRange | null;
  /** Apelidos dos exercícios do treino, na ordem da primeira sessão em que aparecem. */
  exercises: string[];
  /**
   * Apelidos (subconjunto de `exercises`) que são decisão do profissional em alguma sessão do treino: linha preservada,
   * travada ou substituída. Soberanos: nenhuma sugestão pode apontar para eles.
   */
  fixed: string[];
  /** Linhas sem exercício da biblioteca (não enviadas). */
  unlistedItems: number;
  /** Apelidos de alternativas elegíveis já calculadas pelo motor (no máximo 5). */
  alternatives: string[];
}

export interface AiSummaryMuscleRow {
  muscle: string;
  isTarget: boolean;
  classification: "DIRECT" | "INDIRECT_ONLY" | "NONE" | "UNKNOWN";
  direct: AuditRange | null;
  weighted: AuditRange | null;
  directSessions: AuditRange;
}

export interface AiSummaryPatternRow {
  pattern: string;
  isTarget: boolean;
  sets: AuditRange | null;
  sessions: AuditRange;
}

export interface AiSummaryPhase {
  phaseIndex: number;
  weeks: number;
  sessionsPerWeek: number;
  /** Códigos de estímulo das sessões (nunca o objetivo em texto livre). */
  stimuli: string[];
  workouts: AiSummaryWorkout[];
  /** Vazios quando a proposta não tem auditoria. Linhas só para alvos e para o que tem algum estímulo. */
  muscles: AiSummaryMuscleRow[];
  /** Músculos sem estímulo nenhum na fase (medido, não desconhecido) e que não são alvo: só os códigos. */
  musclesWithoutStimulus: string[];
  patterns: AiSummaryPatternRow[];
  /** Padrões que não aparecem em nenhuma sessão da fase e não são alvo: só os códigos. */
  patternsWithoutStimulus: string[];
}

/** Achado da avaliação por apelido (`F1`…): só código, grau e níveis; sem rótulo, texto, id ou data. */
export interface AiSummaryFinding {
  alias: string;
  kind: string;
  code: string;
  grade?: string;
  readings?: Array<{ code: string; level: number }>;
}

/** Achado da auditoria por apelido (`A1`…): código e números, sem o texto nem as referências internas. */
export interface AiSummaryAuditFinding {
  alias: string;
  code: string;
  severity: "WARNING" | "INFO";
  status: AuditStatus;
  phaseIndex?: number;
  week?: number;
  label?: string;
  muscle?: string;
  pattern?: string;
  measured?: { unit: AuditUnit; value: number; from?: number };
  target?: { unit: AuditUnit; min?: number; max?: number; basis: Basis };
}

/** Aviso do motor por apelido (`I1`…): só ERROR e WARNING. */
export interface AiSummaryIssue {
  alias: string;
  code: string;
  severity: Severity;
  phaseIndex?: number;
  label?: string;
}

export interface AiReviewSummary {
  engineVersion: string;
  /** "<id>@<versão>" do conjunto de regras da proposta. */
  rules: string;
  auditVersion: string | null;
  student: {
    experience: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null;
    sessionMinutes: number | null;
  };
  phases: AiSummaryPhase[];
  findings: AiSummaryFinding[];
  audit: AiSummaryAuditFinding[];
  issues: AiSummaryIssue[];
  exercises: AiSummaryExercise[];
  /** O que o corte por tamanho retirou (o modelo sabe que o resumo não está completo). */
  omitted: { alternatives: number; infoFindings: number; patternRows: number };
}

/** O que a resposta pode citar. Fica no servidor; não vai para o modelo. */
export interface AiAllowedRefs {
  /** phaseIndex → apelidos dos treinos daquela fase. */
  workouts: Record<string, string[]>;
  /**
   * "<phaseIndex>|<apelido do treino>" → apelidos de exercício que uma sugestão pode apontar naquele treino: os do plano
   * escolhidos pelo motor e as alternativas enviadas. Nunca os preservados, travados ou substituídos (ver `fixedByWorkout`).
   */
  eligibleByWorkout: Record<string, string[]>;
  /** "<phaseIndex>|<apelido do treino>" → apelidos que são decisão do profissional naquele treino. */
  fixedByWorkout: Record<string, string[]>;
  /** Apelidos presentes no resumo (F*, A*, I*, X*). */
  refs: string[];
  /** Apelido → id real da biblioteca, para o servidor traduzir uma sugestão aceita. */
  exerciseIds: Record<string, string>;
  /** Apelido do treino → rótulo real. */
  workoutLabels: Record<string, string>;
}

export const workoutKey = (phaseIndex: number, label: string): string => `${phaseIndex}|${label}`;

// ---------- resposta (estrita, limitada, sem campos de dose) ----------

const CODE = /^[A-Z0-9_]{1,60}$/;
const muscleCode = z.enum(Object.keys(MUSCLES) as [string, ...string[]]);
const patternCode = z.enum(Object.keys(PATTERNS) as [string, ...string[]]);
const phaseIndex = z.number().int().min(0).max(1000);
const label = z.string().min(1).max(40);
const text = z.string().trim().min(1).max(400);
const refs = z.array(z.string().min(1).max(20)).max(8);

export const aiReviewResponseSchema = z.strictObject({
  observations: z
    .array(
      z.strictObject({
        code: z.string().regex(CODE),
        target: z.strictObject({
          phaseIndex: phaseIndex.optional(),
          workoutLabel: label.optional(),
          muscle: muscleCode.optional(),
          pattern: patternCode.optional(),
        }),
        message: text,
        evidenceRefs: refs,
        uncertainty: z.enum(["LOW", "MEDIUM", "HIGH"]),
      }),
    )
    .max(20),
  suggestions: z
    .array(
      z.strictObject({
        action: z.enum(["REVIEW_ITEM", "CONSIDER_SUBSTITUTION", "CONSIDER_TARGET", "CONSIDER_DOSE_REVIEW", "NOTE"]),
        exerciseId: z.string().min(1).max(20).optional(),
        phaseIndex: phaseIndex.optional(),
        workoutLabel: label.optional(),
        reason: text,
        sourceRefs: refs,
      }),
    )
    .max(20),
});

export type AiReviewResponse = z.infer<typeof aiReviewResponseSchema>;

export type AiValidation = { ok: true; response: AiReviewResponse } | { ok: false; problems: string[] };

/**
 * Valida a resposta crua do modelo contra o contrato e contra o que o resumo permite citar. Qualquer problema recusa a
 * resposta inteira (nada é aproveitado pela metade).
 */
export function validateAiResponse(raw: unknown, allowed: AiAllowedRefs): AiValidation {
  const parsed = aiReviewResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`) };
  const response = parsed.data;
  const problems: string[] = [];
  const known = new Set(allowed.refs);
  const place = (path: string, p: number | undefined, l: string | undefined) => {
    if (p === undefined) {
      if (l !== undefined) problems.push(`${path}: treino sem fase`);
      return;
    }
    const labels = allowed.workouts[String(p)];
    if (!labels) problems.push(`${path}: fase ${p} não está no plano`);
    else if (l !== undefined && !labels.includes(l)) problems.push(`${path}: treino ${l} não está na fase ${p}`);
  };
  const prose = (path: string, s: string) => {
    if (REFERENCE_TEXT.test(s)) problems.push(`${path}: referência bibliográfica não verificável`);
    if (DOSE_TEXT.test(s)) problems.push(`${path}: número de dose fora do contrato`);
  };
  const cited = (path: string, list: string[]) => {
    for (const r of list) if (!known.has(r)) problems.push(`${path}: referência ${r} não está no resumo`);
  };
  response.observations.forEach((o, i) => {
    const path = `observations.${i}`;
    place(`${path}.target`, o.target.phaseIndex, o.target.workoutLabel);
    prose(`${path}.message`, o.message);
    cited(`${path}.evidenceRefs`, o.evidenceRefs);
  });
  response.suggestions.forEach((s, i) => {
    const path = `suggestions.${i}`;
    place(path, s.phaseIndex, s.workoutLabel);
    prose(`${path}.reason`, s.reason);
    cited(`${path}.sourceRefs`, s.sourceRefs);
    if (s.exerciseId !== undefined) {
      if (s.phaseIndex === undefined || s.workoutLabel === undefined) problems.push(`${path}.exerciseId: exercício sem fase e treino`);
      else if ((allowed.fixedByWorkout[workoutKey(s.phaseIndex, s.workoutLabel)] ?? []).includes(s.exerciseId))
        problems.push(`${path}.exerciseId: ${s.exerciseId} é decisão do profissional (preservado, travado ou substituído) no treino ${s.workoutLabel} da fase ${s.phaseIndex}`);
      else if (!(allowed.eligibleByWorkout[workoutKey(s.phaseIndex, s.workoutLabel)] ?? []).includes(s.exerciseId))
        problems.push(`${path}.exerciseId: ${s.exerciseId} não é elegível no treino ${s.workoutLabel} da fase ${s.phaseIndex}`);
    }
    if ((s.action === "REVIEW_ITEM" || s.action === "CONSIDER_SUBSTITUTION") && s.exerciseId === undefined)
      problems.push(`${path}: ${s.action} sem exercício`);
  });
  return problems.length ? { ok: false, problems } : { ok: true, response };
}

/** Chave de cache: hash do resumo normalizado + modelo + versão do prompt. Uma análise por versão da proposta. */
export function aiCacheKey(summary: AiReviewSummary, modelId: string, promptVersion: string): Promise<string> {
  return sha256Hex(canonicalJson({ summary, modelId, promptVersion }));
}
