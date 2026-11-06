/**
 * Assisted adjustments, contracts (design V4 §6.2, sub-stage 4.3a). Pure: no `server-only`, database, network or clock.
 *
 * v1 is STRUCTURED-ONLY toward a provider: the professional builds the request from controls (the selected item, an operation, numbers,
 * constraint chips). There is NO free-text field anywhere in these contracts: every string is an enum, a vocabulary code, an alias or a
 * regex-bound server-issued key (a static test walks the schemas and fails on any unbounded `z.string()`). The sentences the screen
 * shows ("Trocar Puxada vertical por uma alternativa em máquina ...") are BUILT BY THE SERVER from fixed templates (`requestSentence`).
 *
 * Two schemas, two directions: `adjustmentRequestSchema` (client -> server action, never sent to a provider) and
 * `modelAdjustmentSchema` (the model's wire response: aliases, enums and small integers, no prose, no `oneOf`). The model's output is
 * untrusted data; `validateModelAdjustment` (server) binds it to the aliases of the compact context before anything is simulated.
 */
import { z } from "zod";
import { EQUIPMENT, MUSCLES } from "@/modules/biblioteca/metadata/vocabulary";
import type { DosePatch, SubstitutionTarget } from "@/modules/prescricao/motor/types";
import { EQUIPMENT_CODES, MUSCLE_CODES } from "./vocab";

export const ADJUST_OPS = ["SUBSTITUTE_EXERCISE", "CHANGE_SETS", "CHANGE_REPS", "CHANGE_REST", "CHANGE_RIR"] as const;
export type AdjustOp = (typeof ADJUST_OPS)[number];
export const DOSE_OPS = ["CHANGE_SETS", "CHANGE_REPS", "CHANGE_REST", "CHANGE_RIR"] as const;
export const isDoseOp = (op: AdjustOp): op is (typeof DOSE_OPS)[number] => op !== "SUBSTITUTE_EXERCISE";

export const ADJUST_REASON_CODES = ["SAME_PATTERN", "EQUIPMENT_MATCH", "VOLUME_KEPT", "DURATION_KEPT", "SIMILAR_DIFFICULTY", "OTHER"] as const;
export type AdjustReasonCode = (typeof ADJUST_REASON_CODES)[number];
export const CLARIFICATIONS = ["AMBIGUOUS_TARGET", "NO_ELIGIBLE_ALTERNATIVE", "OUT_OF_SCOPE"] as const;
export type Clarification = (typeof CLARIFICATIONS)[number];
export const CONSTRAINT_KINDS = ["NO_WEEKLY_SETS_INCREASE", "MAX_WEEKLY_SETS", "NO_DURATION_INCREASE", "MAX_SESSION_MINUTES", "SAME_PATTERN", "EQUIPMENT_CLASS"] as const;
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

/** The most operations a response (or a request) may carry. */
export const ADJUST_MAX_OPS = 2;
/** Suggestions older than this are not applicable (design §6.6). */
export const ADJUST_SUGGESTION_TTL_MS = 24 * 3_600_000;
/** Engine-ranked eligible alternatives the compact context carries per item. */
export const ADJUST_MAX_ALTERNATIVES = 8;
/** Changed volume rows kept in a diff. */
export const ADJUST_DIFF_MAX_VOLUME_ROWS = 60;
/** Largest model response (JSON characters) the validator takes: a response is two small operations. */
export const ADJUST_MAX_RESPONSE_CHARS = 4_000;

const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const intentId = z.string().regex(/^[A-Za-z0-9-]{16,64}$/);
const phaseIndex = z.number().int().min(1).max(12);
/** A workout label as the saved periodization names it (the engine bounds it at 20 characters). */
const label = z.string().regex(/^[^"\\\u0000-\u001f]{1,20}$/u);
/** The item key issued by the engine: `[phase,"label","exerciseId",k]`. */
export const SLOT_KEY_RE = /^\[\d{1,2},"[^"\\]{1,20}","[^"\\]{1,100}",\d{1,3}\]$/;
const slotKey = z.string().regex(SLOT_KEY_RE);
const scope = z.enum(["OCCURRENCE", "FROM_WEEK", "PHASE"]);
const muscle = z.enum(MUSCLE_CODES);
const exerciseId = z.string().regex(/^[A-Za-z0-9:_-]{1,80}$/);

export const constraintSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("NO_WEEKLY_SETS_INCREASE"), muscles: z.array(muscle).min(1).max(6) }),
  z.strictObject({ kind: z.literal("MAX_WEEKLY_SETS"), muscles: z.array(muscle).min(1).max(6), maxWeighted: z.number().min(0).max(60) }),
  z.strictObject({ kind: z.literal("NO_DURATION_INCREASE") }),
  z.strictObject({ kind: z.literal("MAX_SESSION_MINUTES"), minutes: z.number().int().min(5).max(240) }),
  z.strictObject({ kind: z.literal("SAME_PATTERN") }),
  z.strictObject({ kind: z.literal("EQUIPMENT_CLASS"), equipment: z.enum(EQUIPMENT_CODES) }),
]);
export type AdjustConstraint = z.infer<typeof constraintSchema>;

const valuesSchema = z.strictObject({
  sets: z.number().int().min(1).max(8).optional(),
  repsMin: z.number().int().min(1).max(100).optional(),
  repsMax: z.number().int().min(1).max(100).optional(),
  restSeconds: z.number().int().min(0).max(600).optional(),
  rirMin: z.number().int().min(0).max(10).optional(),
  rirMax: z.number().int().min(0).max(10).optional(),
});

const REQUIRED_VALUES: Record<(typeof DOSE_OPS)[number], ReadonlyArray<keyof z.infer<typeof valuesSchema>>> = {
  CHANGE_SETS: ["sets"], CHANGE_REPS: ["repsMin", "repsMax"], CHANGE_REST: ["restSeconds"], CHANGE_RIR: ["rirMin", "rirMax"],
};

export const intentSchema = z
  .strictObject({
    op: z.enum(ADJUST_OPS),
    target: z.strictObject({ phaseIndex, label, slotKey, week: z.number().int().min(1).max(504).optional(), slot: z.number().int().min(1).max(14).optional() }),
    /** Substitutions: the three scopes of the engine's `SubstitutionTarget`. Dose operations: PHASE only (D8). */
    scope,
    values: valuesSchema.nullable(),
    constraints: z.array(constraintSchema).max(4),
    /** The replacement the professional picked from the engine's list (no provider involved); an id of the library, verified on the server. */
    replacementExerciseId: exerciseId.nullable(),
    /** True only for SUBSTITUTE_EXERCISE with the gate READY: the provider picks among the engine's alternatives. */
    useAi: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: path ? [path] : [], message });
    if (v.op === "SUBSTITUTE_EXERCISE") {
      if (v.values !== null) bad("values", "Trocar exercício não leva valores de dose.");
      if (v.scope === "FROM_WEEK" && v.target.week === undefined) bad("scope", "Informe a semana.");
      if (v.scope === "OCCURRENCE" && (v.target.week === undefined || v.target.slot === undefined)) bad("scope", "Informe a semana e a sessão.");
      if (v.useAi && v.replacementExerciseId !== null) bad("useAi", "Escolha a alternativa na lista ou peça à IA, não os dois.");
      return;
    }
    if (v.useAi) bad("useAi", "Só a troca de exercício usa IA.");
    if (v.replacementExerciseId !== null) bad("replacementExerciseId", "Alterar dose não leva exercício novo.");
    if (v.scope !== "PHASE") bad("scope", "A dose vale para a fase inteira.");
    const values = v.values;
    if (!values) return bad("values", "Informe os valores.");
    const required = REQUIRED_VALUES[v.op];
    for (const key of required) if (values[key] === undefined) bad("values", "Faltam valores para esta dose.");
    for (const key of Object.keys(values) as Array<keyof typeof values>) if (values[key] !== undefined && !required.includes(key)) bad("values", "Valor que esta operação não usa.");
    if (values.repsMin !== undefined && values.repsMax !== undefined && values.repsMin > values.repsMax) bad("values", "As repetições mínimas passam das máximas.");
    if (values.rirMin !== undefined && values.rirMax !== undefined && values.rirMin > values.rirMax) bad("values", "O RIR mínimo passa do máximo.");
  });
export type AdjustIntent = z.infer<typeof intentSchema>;

/** Client -> server (NOT the model contract). */
export const adjustmentRequestSchema = z.strictObject({
  proposalId: id,
  expectedVersion: z.number().int().min(1),
  idempotencyKey: intentId,
  intent: intentSchema,
});
export type AdjustmentRequest = z.infer<typeof adjustmentRequestSchema>;
export type AdjustmentRequestInput = z.input<typeof adjustmentRequestSchema>;

export const adjustmentDecisionSchema = z.strictObject({ adjustmentId: id });
export const adjustmentApplySchema = z.strictObject({
  adjustmentId: id,
  proposalId: id,
  expectedVersion: z.number().int().min(1),
  writeId: intentId,
  idempotencyKey: intentId,
  /** The professional ticked "aplicar mesmo sem poder verificar": needed when a constraint is UNCHECKABLE. */
  acknowledgeUncheckable: z.boolean(),
});
export type AdjustmentApply = z.infer<typeof adjustmentApplySchema>;

const aliasT = z.string().regex(/^T[1-9][0-9]{0,2}$/);
const aliasX = z.string().regex(/^X[1-9][0-9]{0,2}$/);

/** The model's wire response: NO prose, NO `oneOf`. `constraintsEcho` is the model's own list of the constraint kinds it says it respected. */
export const modelAdjustmentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operations: z
    .array(
      z.strictObject({
        target: z.strictObject({ phase: z.number().int().min(1).max(12), workout: aliasT, item: aliasX }),
        scope,
        week: z.number().int().min(1).max(504).nullable(),
        slot: z.number().int().min(1).max(14).nullable(),
        replacement: aliasX,
      }),
    )
    .max(ADJUST_MAX_OPS),
  reasonCodes: z.array(z.enum(ADJUST_REASON_CODES)).max(3),
  constraintsEcho: z.array(z.enum(CONSTRAINT_KINDS)).max(CONSTRAINT_KINDS.length),
  clarification: z.enum(CLARIFICATIONS).nullable(),
});
export type ModelAdjustment = z.infer<typeof modelAdjustmentSchema>;

// ---------- resolved operations (real ids, server side only; types live in the pure motor) ----------
export type { ResolvedOp, ResolvedConstraint, ConstraintCheck, AdjustOverride } from "@/modules/prescricao/motor/adjust";
export { mergeDoseOverrides, overrideKey, overrideOf } from "@/modules/prescricao/motor/adjust";

export function substitutionTargetOf(intent: Pick<AdjustIntent, "target" | "scope">): SubstitutionTarget | null {
  const { target, scope: s } = intent;
  if (s === "PHASE") return { phaseIndex: target.phaseIndex, slotKey: target.slotKey, applies: { kind: "PHASE" } };
  if (s === "FROM_WEEK") return target.week === undefined ? null : { phaseIndex: target.phaseIndex, slotKey: target.slotKey, applies: { kind: "FROM_WEEK", week: target.week } };
  return target.week === undefined || target.slot === undefined
    ? null
    : { phaseIndex: target.phaseIndex, slotKey: target.slotKey, applies: { kind: "OCCURRENCE", week: target.week, slot: target.slot } };
}

/** The dose patch a dose operation stands for (typed numbers; the engine revalidates the dose). */
export function dosePatchOf(intent: Pick<AdjustIntent, "op" | "values">): DosePatch | null {
  const v = intent.values;
  if (!v) return null;
  switch (intent.op) {
    case "CHANGE_SETS": return v.sets === undefined ? null : { values: { sets: v.sets } };
    case "CHANGE_REPS": return v.repsMin === undefined || v.repsMax === undefined ? null : { values: { repsMin: v.repsMin, repsMax: v.repsMax } };
    case "CHANGE_REST": return v.restSeconds === undefined ? null : { values: { restSeconds: v.restSeconds } };
    case "CHANGE_RIR": return v.rirMin === undefined || v.rirMax === undefined ? null : { values: { rirMin: v.rirMin, rirMax: v.rirMax } };
    default: return null;
  }
}

// ---------- fixed texts (pt-BR) ----------

export const REASON_TEXT: Record<AdjustReasonCode, string> = {
  SAME_PATTERN: "Mesmo padrão de movimento",
  EQUIPMENT_MATCH: "Equipamento pedido",
  VOLUME_KEPT: "Volume semanal mantido",
  DURATION_KEPT: "Duração mantida",
  SIMILAR_DIFFICULTY: "Dificuldade parecida",
  OTHER: "Outro motivo",
};
export const CLARIFICATION_TEXT: Record<Clarification, string> = {
  AMBIGUOUS_TARGET: "Não ficou claro qual exercício trocar. Escolha o item na lista e peça de novo.",
  NO_ELIGIBLE_ALTERNATIVE: "Sem alternativa elegível para este item com as restrições marcadas.",
  OUT_OF_SCOPE: "Este pedido está fora do que o assistente ajusta.",
};
export const OP_LABEL: Record<AdjustOp, string> = {
  SUBSTITUTE_EXERCISE: "Trocar exercício", CHANGE_SETS: "Séries", CHANGE_REPS: "Repetições", CHANGE_RIR: "RIR", CHANGE_REST: "Pausa",
};
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`);
const muscleText = (codes: readonly string[]) => list(codes.map((m) => (MUSCLES[m] ?? m).toLowerCase()));

/** One constraint, as the professional reads it (also the checkbox label). */
export function constraintText(c: AdjustConstraint): string {
  switch (c.kind) {
    case "NO_WEEKLY_SETS_INCREASE": return `Sem aumentar o volume semanal de ${muscleText(c.muscles)}`;
    case "MAX_WEEKLY_SETS": return `No máximo ${c.maxWeighted} séries ponderadas por semana de ${muscleText(c.muscles)}`;
    case "NO_DURATION_INCREASE": return "Sem aumentar a duração";
    case "MAX_SESSION_MINUTES": return `Máximo de ${c.minutes} min por sessão`;
    case "SAME_PATTERN": return "Mesmo padrão de movimento";
    case "EQUIPMENT_CLASS": return `Equipamento: ${(EQUIPMENT[c.equipment] ?? c.equipment).toLowerCase()}`;
  }
}

/** "Profissional" card: built from the chips and the exercise names resolved on the server, from fixed templates. */
export function requestSentence(intent: AdjustIntent, names: { item: string; workout: string; replacement?: string | null }): string {
  const equipment = intent.constraints.find((c): c is Extract<AdjustConstraint, { kind: "EQUIPMENT_CLASS" }> => c.kind === "EQUIPMENT_CLASS");
  const rest = intent.constraints.filter((c) => c.kind !== "EQUIPMENT_CLASS").map((c) => constraintText(c).replace(/^./, (x) => x.toLowerCase()));
  const tail = rest.length ? ` · ${rest.join(" · ")}` : "";
  const v = intent.values;
  switch (intent.op) {
    case "SUBSTITUTE_EXERCISE": {
      const what = names.replacement ? names.replacement : equipment ? `uma alternativa ${equipmentPhrase(equipment.equipment)}` : "uma alternativa";
      return `Trocar ${names.item} por ${what} · Treino ${names.workout}${tail}`;
    }
    case "CHANGE_SETS": return `Ajustar ${names.item} para ${v?.sets} séries · Treino ${names.workout}, fase toda${tail}`;
    case "CHANGE_REPS": return `Ajustar ${names.item} para ${v?.repsMin}–${v?.repsMax} repetições · Treino ${names.workout}, fase toda${tail}`;
    case "CHANGE_RIR": return `Ajustar ${names.item} para RIR ${v?.rirMin}–${v?.rirMax} · Treino ${names.workout}, fase toda${tail}`;
    case "CHANGE_REST": return `Ajustar ${names.item} para ${v?.restSeconds} s de pausa · Treino ${names.workout}, fase toda${tail}`;
  }
}
/** "em máquina", "no cabo", "com halteres": the preposition belongs to the sentence, not to the vocabulary. */
function equipmentPhrase(code: string): string {
  if (code === "MACHINE") return "em máquina";
  if (code === "CABLE") return "no cabo";
  return `com ${(EQUIPMENT[code] ?? code).toLowerCase()}`;
}

export const scopeText = (s: AdjustIntent["scope"], t: { week?: number; slot?: number }): string =>
  s === "PHASE" ? "na fase toda" : s === "FROM_WEEK" ? `da semana ${t.week} em diante` : `só na semana ${t.week}, sessão ${t.slot}`;
