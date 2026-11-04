import type { Tone } from "@/components/ui";
import { NONE_LABELS, formatFieldValue, isMetadataField, type FieldValue } from "./fields";
import { INFERENCE_RULES } from "./inference";
import type { ResolvedField } from "./status";
import {
  CAUTION_TAGS,
  EQUIPMENT,
  FIELD_LABELS,
  LATERALITY,
  MAX_EQUIPMENT_ALTERNATIVES,
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
  | { kind: "checks"; options: Array<{ value: string; label: string }>; noneLabel: string | null }
  | { kind: "sets"; options: Array<{ value: string; label: string }>; sets: number; noneLabel: string | null };

const options = (map: Record<string, string>) => Object.entries(map).map(([value, label]) => ({ value, label }));

export function controlFor(field: MetadataField): FieldControl {
  const noneLabel = NONE_LABELS[field] ?? null;
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
      return { kind: "checks", options: options(MUSCLES), noneLabel };
    case "movement_patterns":
      return { kind: "checks", options: options(PATTERNS), noneLabel };
    case "equipment":
      return { kind: "checks", options: options(EQUIPMENT), noneLabel };
    case "caution_tags":
      return { kind: "checks", options: options(CAUTION_TAGS), noneLabel };
    case "equipment_alternatives":
      return { kind: "sets", options: options(EQUIPMENT), sets: MAX_EQUIPMENT_ALTERNATIVES, noneLabel };
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

const HISTORY_ACTIONS: Record<string, string> = {
  SET: "valor salvo como revisado",
  REVIEWED: "valor confirmado como revisado",
  PENDING: "marcado como pendente",
  INFERRED: "valor inferido pela regra",
  RELATION_ADDED: "alternativa adicionada",
  RELATION_REMOVED: "alternativa removida",
};
const historyDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export interface HistoryEventView {
  field: string;
  action: string;
  ruleId: string | null;
  /** Non-null only on events the inference wrote. */
  rulesVersion: string | null;
  scope: string;
  actor: string | null;
  createdAt: string;
}

/**
 * One line of the metadata history. An inference event is credited to the rule, never to the person
 * who clicked "Inferir" (or renamed the exercise): that person only started the run.
 */
export function historyText(event: HistoryEventView): string {
  const field = isMetadataField(event.field) ? fieldTitle(event.field) : "Alternativas";
  const automatic = event.rulesVersion !== null;
  const action = automatic && event.action === "PENDING"
    ? "valor inferido retirado (a regra não o produz mais), pendente de curadoria"
    : (HISTORY_ACTIONS[event.action] ?? event.action);
  const rule = event.ruleId ? ` (${event.ruleId})` : "";
  const who = automatic
    ? event.actor
      ? `regra de inferência ${INFERENCE_RULES.id}@${event.rulesVersion}, execução iniciada por ${event.actor}`
      : `regra de inferência ${INFERENCE_RULES.id}@${event.rulesVersion} (semente da biblioteca do sistema)`
    : (event.actor ?? (event.scope === "SYSTEM" ? "biblioteca do sistema" : "pessoa sem nome de exibição"));
  return `${historyDate.format(new Date(event.createdAt))} · ${field}: ${action}${rule} · ${who}`;
}
