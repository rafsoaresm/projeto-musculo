import type { Tone } from "@/components/ui";
import { formatFieldValue, type FieldValue } from "./fields";
import { INFERENCE_RULES } from "./inference";
import type { ResolvedField } from "./status";
import {
  CAUTION_TAGS,
  EQUIPMENT,
  FIELD_LABELS,
  LATERALITY,
  METRICS,
  MODALITIES,
  MUSCLES,
  PATTERNS,
  PROVENANCE_LABELS,
  SUMMARY_LABELS,
  type MetadataField,
  type MetadataSummary,
  type Provenance,
} from "./vocabulary";

/** How a field is edited. Pure data, so the client form needs no business rule of its own. */
export type FieldControl =
  | { kind: "select"; options: Array<{ value: string; label: string }> }
  | { kind: "number"; min: number; max: number; step: number }
  | { kind: "checks"; options: Array<{ value: string; label: string }> }
  | { kind: "sets"; options: Array<{ value: string; label: string }>; sets: number };

const options = (map: Record<string, string>) => Object.entries(map).map(([value, label]) => ({ value, label }));

export function controlFor(field: MetadataField): FieldControl {
  switch (field) {
    case "modality":
      return { kind: "select", options: options(MODALITIES) };
    case "metric":
      return { kind: "select", options: options(METRICS) };
    case "laterality":
      return { kind: "select", options: options(LATERALITY) };
    case "compound":
      return { kind: "select", options: [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }] };
    case "difficulty":
      return { kind: "select", options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} de 5` })) };
    case "seconds_per_rep":
      return { kind: "number", min: 0.5, max: 60, step: 0.5 };
    case "primary_muscles":
    case "secondary_muscles":
      return { kind: "checks", options: options(MUSCLES) };
    case "movement_patterns":
      return { kind: "checks", options: options(PATTERNS) };
    case "equipment":
      return { kind: "checks", options: options(EQUIPMENT) };
    case "caution_tags":
      return { kind: "checks", options: options(CAUTION_TAGS) };
    case "equipment_alternatives":
      return { kind: "sets", options: options(EQUIPMENT), sets: 3 };
  }
}

export const PROVENANCE_TONES: Record<Provenance, Tone> = {
  REVIEWED: "success",
  INFERRED: "warning",
  PENDING: "neutral",
};

/** The pill of one field. A missing field reads as pending: nothing is shown as known when it is not. */
export function provenancePill(field: ResolvedField | null): { text: string; tone: Tone } {
  if (!field) return { text: PROVENANCE_LABELS.PENDING, tone: PROVENANCE_TONES.PENDING };
  if (field.provenance === "REVIEWED")
    return {
      text: field.scope === "ORGANIZATION" ? "Revisado pela sua organização" : "Revisado (biblioteca do sistema)",
      tone: PROVENANCE_TONES.REVIEWED,
    };
  return { text: PROVENANCE_LABELS[field.provenance], tone: PROVENANCE_TONES[field.provenance] };
}

export function summaryPill(summary: MetadataSummary): { text: string; tone: Tone } {
  return { text: SUMMARY_LABELS[summary], tone: PROVENANCE_TONES[summary] };
}

/** "Regra PAT_SQUAT (gymgital-library-inference@2026.11.1)" for an inferred value; null otherwise. */
export function ruleText(field: { ruleId: string | null; rulesVersion: string | null; provenance: Provenance } | null): string | null {
  if (!field || field.provenance !== "INFERRED" || !field.ruleId) return null;
  return `Regra ${field.ruleId} (${INFERENCE_RULES.id}@${field.rulesVersion ?? "?"}), heurística operacional pelo nome do exercício`;
}

export function valueText(field: MetadataField, value: FieldValue | null): string {
  return value === null ? "—" : formatFieldValue(field, value);
}

export function fieldTitle(field: MetadataField): string {
  return FIELD_LABELS[field];
}

export const SUMMARY_FILTERS: Array<{ param: string; summary: MetadataSummary; label: string }> = [
  { param: "revisados", summary: "REVIEWED", label: "Revisados" },
  { param: "inferidos", summary: "INFERRED", label: "Inferidos (não revisados)" },
  { param: "pendentes", summary: "PENDING", label: "Pendentes de curadoria" },
];
