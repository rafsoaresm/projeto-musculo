import { z } from "zod";
import {
  CAUTION_TAGS,
  EQUIPMENT,
  FIELD_LABELS,
  LATERALITY,
  MAX_EQUIPMENT_ALTERNATIVES,
  METADATA_FIELDS,
  METRICS,
  MODALITIES,
  MUSCLES,
  PATTERNS,
  labelFor,
  type MetadataField,
} from "./vocabulary";

/**
 * One schema per field. Values are stored as canonical JSON (lists in vocabulary order, no
 * duplicates), so the same choice always produces the same bytes and an inference run that finds
 * the same value changes nothing.
 */
export type FieldValue = string | number | boolean | string[] | string[][];

const codeList = (map: Record<string, string>) => {
  const order = Object.keys(map);
  return z
    .array(z.enum(order as [string, ...string[]]))
    .max(order.length)
    .transform((list) => order.filter((code) => list.includes(code)));
};
const oneOf = (map: Record<string, string>) =>
  z.enum(Object.keys(map) as [string, ...string[]]);

const equipmentSets = z
  .array(codeList(EQUIPMENT).pipe(z.array(z.string()).min(1)))
  .max(MAX_EQUIPMENT_ALTERNATIVES)
  .transform((sets) => {
    const seen = new Set<string>();
    return sets.filter((set) => {
      const key = set.join(",");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

export const FIELD_SCHEMAS: Record<MetadataField, z.ZodType<FieldValue, unknown>> = {
  modality: oneOf(MODALITIES),
  metric: oneOf(METRICS),
  primary_muscles: codeList(MUSCLES),
  secondary_muscles: codeList(MUSCLES),
  movement_patterns: codeList(PATTERNS),
  equipment: codeList(EQUIPMENT),
  equipment_alternatives: equipmentSets,
  difficulty: z.number().int().min(1).max(5),
  laterality: oneOf(LATERALITY),
  compound: z.boolean(),
  seconds_per_rep: z
    .number()
    .min(0.5)
    .max(60)
    .transform((value) => Math.round(value * 10) / 10),
  caution_tags: codeList(CAUTION_TAGS),
};

export const metadataFieldSchema = z.enum(METADATA_FIELDS);

export function isMetadataField(value: unknown): value is MetadataField {
  return metadataFieldSchema.safeParse(value).success;
}

/** The validated value, or null when it is not a valid value of that field. */
export function parseFieldValue(field: MetadataField, raw: unknown): FieldValue | null {
  const parsed = FIELD_SCHEMAS[field].safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Canonical JSON of a valid value; throws on an invalid one (callers validate first). */
export function canonicalJson(field: MetadataField, raw: unknown): string {
  return JSON.stringify(FIELD_SCHEMAS[field].parse(raw));
}

/** Stored JSON back to a value; anything that no longer validates reads as absent. */
export function readStoredValue(field: MetadataField, json: string | null): FieldValue | null {
  if (json === null) return null;
  try {
    return parseFieldValue(field, JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * The value a field form sent. Lists come as repeated `value` entries; alternative equipment as
 * `set0`..`set2`; the boolean as "true"/"false". An empty scalar is "no value", which the caller
 * refuses: to say "I do not know", mark the field as pending instead.
 */
export function valueFromForm(field: MetadataField, form: FormData): unknown {
  const all = (key: string) =>
    form.getAll(key).filter((item): item is string => typeof item === "string" && item !== "");
  const one = () => {
    const value = form.get("value");
    return typeof value === "string" ? value.trim() : "";
  };
  switch (field) {
    case "primary_muscles":
    case "secondary_muscles":
    case "movement_patterns":
    case "equipment":
    case "caution_tags":
      return all("value");
    case "equipment_alternatives":
      return Array.from({ length: MAX_EQUIPMENT_ALTERNATIVES }, (_, index) => all(`set${index}`)).filter(
        (set) => set.length > 0,
      );
    case "difficulty":
    case "seconds_per_rep": {
      const text = one().replace(",", ".");
      return text === "" ? undefined : Number(text);
    }
    case "compound":
      return one() === "true" ? true : one() === "false" ? false : undefined;
    default:
      return one() || undefined;
  }
}

const listText = (map: Record<string, string>, list: string[], empty: string) =>
  list.length ? list.map((code) => labelFor(map, code)).join(", ") : empty;

/** Readable pt-BR text of a value, for the library and (later) the proposal's "Por quê?". */
export function formatFieldValue(field: MetadataField, value: FieldValue | null): string {
  if (value === null) return "—";
  switch (field) {
    case "modality":
      return labelFor(MODALITIES, String(value));
    case "metric":
      return labelFor(METRICS, String(value));
    case "laterality":
      return labelFor(LATERALITY, String(value));
    case "primary_muscles":
    case "secondary_muscles":
      return listText(MUSCLES, value as string[], "Nenhum");
    case "movement_patterns":
      return listText(PATTERNS, value as string[], "Nenhum");
    case "equipment":
      return listText(EQUIPMENT, value as string[], "Sem equipamento");
    case "caution_tags":
      return listText(CAUTION_TAGS, value as string[], "Nenhum");
    case "equipment_alternatives":
      return (value as string[][]).length
        ? (value as string[][]).map((set) => listText(EQUIPMENT, set, "")).join(" ou ")
        : "Nenhum";
    case "difficulty":
      return `${value} de 5`;
    case "compound":
      return value ? "Sim" : "Não";
    case "seconds_per_rep":
      return `${String(value).replace(".", ",")} s`;
  }
}

export function fieldLabel(field: MetadataField): string {
  return FIELD_LABELS[field];
}
