import type { FieldValue } from "./fields";
import {
  METADATA_FIELDS,
  REQUIRED_FIELDS,
  type MetadataField,
  type MetadataSummary,
  type Provenance,
} from "./vocabulary";

/**
 * One field as the library resolved it for an organization. `value` is null when the field is
 * pending (a person said it needs curation, or nothing valid is stored).
 */
export interface ResolvedField {
  value: FieldValue | null;
  provenance: Provenance;
  scope: "SYSTEM" | "ORGANIZATION";
  ruleId: string | null;
  rulesVersion: string | null;
  reviewedAt: string | null;
}

export interface ResolvedAlternative {
  exerciseId: string;
  name: string;
  provenance: Provenance;
  scope: "SYSTEM" | "ORGANIZATION";
}

export interface ResolvedMetadata {
  exerciseId: string;
  fields: Partial<Record<MetadataField, ResolvedField>>;
  alternatives: ResolvedAlternative[];
  summary: MetadataSummary;
}

/**
 * Precedence between the rows of one field (lower wins): the organization's own review, then the
 * organization saying "pending", then the system's review, then inferences. A reviewed value always
 * beats an inferred one; inference never hides a person's decision. Same order as the SQL in
 * `src/db/exercise-metadata.ts` (a test keeps them equal).
 */
export function precedence(scope: "SYSTEM" | "ORGANIZATION", provenance: Provenance): number {
  if (scope === "ORGANIZATION")
    return provenance === "REVIEWED" ? 1 : provenance === "PENDING" ? 2 : 4;
  return provenance === "REVIEWED" ? 3 : provenance === "PENDING" ? 5 : 6;
}

/**
 * Per exercise:
 * - PENDING ("Pendente de curadoria") when a field the engine needs is missing or pending;
 * - INFERRED ("Inferido (não revisado)") when every needed field has a value and any field in use
 *   is inferred;
 * - REVIEWED when every field in use was reviewed by a person.
 * An optional field marked pending is simply not used; it does not block the exercise.
 */
export function summarize(fields: Partial<Record<MetadataField, ResolvedField>>): MetadataSummary {
  for (const field of REQUIRED_FIELDS) {
    const entry = fields[field];
    if (!entry || entry.value === null || entry.provenance === "PENDING") return "PENDING";
  }
  for (const field of METADATA_FIELDS) {
    const entry = fields[field];
    if (entry && entry.value !== null && entry.provenance === "INFERRED") return "INFERRED";
  }
  return "REVIEWED";
}

export const SUMMARY_TONES: Record<MetadataSummary, "success" | "warning" | "neutral"> = {
  REVIEWED: "success",
  INFERRED: "warning",
  PENDING: "neutral",
};
