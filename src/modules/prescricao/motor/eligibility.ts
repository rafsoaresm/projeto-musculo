/**
 * Elegibilidade de um exercício para um treino. Nada é inventado: sem equipamento informado, só
 * entram exercícios sem equipamento; modalidade nunca é preenchida com outra; metadados PENDING
 * não entram na seleção automática; INFERRED só entra se o profissional confiou neles.
 */
import { codeOf } from "./vocabulary";
import type { CatalogExercise, EngineInput } from "./types";

export type IneligibleReason =
  | "ARCHIVED"
  | "METADATA_PENDING"
  | "METADATA_INFERRED"
  | "MODALITY"
  | "EQUIPMENT"
  | "EXCLUDED_EXERCISE"
  | "EXCLUDED_PATTERN"
  | "EXCLUDED_CAUTION";

export const INELIGIBLE_TEXT: Record<IneligibleReason, string> = {
  ARCHIVED: "arquivado",
  METADATA_PENDING: "metadados pendentes de curadoria",
  METADATA_INFERRED: "metadados apenas inferidos (o profissional pediu só revisados)",
  MODALITY: "modalidade diferente",
  EQUIPMENT: "equipamento indisponível",
  EXCLUDED_EXERCISE: "excluído pelo profissional",
  EXCLUDED_PATTERN: "padrão excluído pelo profissional",
  EXCLUDED_CAUTION: "cuidado excluído pelo profissional",
};

export interface EligibilityContext {
  /** null = equipamentos não informados. */
  equipment: Set<string> | null;
  excludedIds: Set<string>;
  excludedPatterns: Set<string>;
  excludedTags: Set<string>;
  trust: EngineInput["parameters"]["metadataTrust"];
}

/** Exclusões do profissional: parâmetros + decisões de alerta aceitas. */
export function eligibilityContext(input: EngineInput): EligibilityContext {
  const P = input.parameters;
  const excludedIds = new Set(P.excludedExerciseIds);
  const excludedPatterns = new Set(P.excludedPatterns.map(codeOf));
  const excludedTags = new Set(P.excludedCautionTags.map(codeOf));
  for (const { decision } of P.acceptedFlagDecisions) {
    if (decision.kind === "EXCLUDE_EXERCISE") excludedIds.add(decision.exerciseId);
    if (decision.kind === "EXCLUDE_PATTERN") excludedPatterns.add(codeOf(decision.pattern));
    if (decision.kind === "EXCLUDE_CAUTION_TAG") excludedTags.add(codeOf(decision.tag));
  }
  return {
    equipment: P.availableEquipment === null ? null : new Set(P.availableEquipment.map(codeOf)),
    excludedIds, excludedPatterns, excludedTags, trust: P.metadataTrust,
  };
}

export function equipmentOk(e: CatalogExercise, available: Set<string> | null): boolean {
  const has = (set: string[]) => set.every((x) => available?.has(codeOf(x)) ?? false);
  if (!e.equipment.length) return true;
  if (available === null) return e.equipmentAlternatives.some((s) => s.length === 0);
  return has(e.equipment) || e.equipmentAlternatives.some(has);
}

export function ineligibleReason(
  e: CatalogExercise,
  ctx: EligibilityContext,
  modalities: Set<string> | null,
  workoutExcluded: ReadonlySet<string>,
  options: { ignoreMetadata?: boolean } = {},
): IneligibleReason | null {
  if (e.archived) return "ARCHIVED";
  if (!options.ignoreMetadata) {
    if (e.metadataStatus === "PENDING") return "METADATA_PENDING";
    if (e.metadataStatus === "INFERRED" && ctx.trust === "REVIEWED_ONLY") return "METADATA_INFERRED";
  }
  if (modalities && !(e.modality && modalities.has(codeOf(e.modality)))) return "MODALITY";
  if (ctx.excludedIds.has(e.id) || workoutExcluded.has(e.id)) return "EXCLUDED_EXERCISE";
  if (e.patterns.some((p) => ctx.excludedPatterns.has(codeOf(p)))) return "EXCLUDED_PATTERN";
  if (e.cautionTags.some((t) => ctx.excludedTags.has(codeOf(t)))) return "EXCLUDED_CAUTION";
  if (!equipmentOk(e, ctx.equipment)) return "EQUIPMENT";
  return null;
}
