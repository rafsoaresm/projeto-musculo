/**
 * The classifications of the Avaliação Física by the reference tables the user sent (slice 0.92): which recorded result each table classifies,
 * and the reference (masculina/feminina) a sex-dependent table uses. Pure.
 *
 * - "body_fat_percent" by the body fat table (Pollock & Wilmore, 1993; 7 to 17 years, Gaithersburg et al., 1989);
 * - "bmi" by the BMI table (no age, no reference);
 * - "waist_hip_ratio" by the waist-hip ratio table (Bray et Gray, 1988);
 * - "flexitest_total" by the Flexiteste table (only exists with the 15 movements; no age, no reference);
 * - "cooper_speed_kmh" carries the Cooper 12 min classification of the distance run (the distance is in its inputs): the Cooper test records no
 *   result of its own for the distance, and the speed is always recorded with it.
 *
 * The other results (density, masses, sum of skinfolds, bilateral differences, VO₂ estimate) and the endurance tests have no table.
 */
import { classify, type Classification, type ReferenceOrigin } from "./classify";
import type { TableId, TableSex } from "./tables";

export * from "./classify";
export * from "./tables";

export const CLASSIFIED_CODES: Readonly<Record<string, TableId>> = {
  body_fat_percent: "body_fat",
  bmi: "bmi",
  waist_hip_ratio: "waist_hip",
  flexitest_total: "flexitest",
  cooper_speed_kmh: "cooper_12min",
};
export const isClassifiedCode = (code: string) => Object.prototype.hasOwnProperty.call(CLASSIFIED_CODES, code);

/** The reference of the tables: the skinfold equation when it is set; otherwise the one chosen in Revisão; otherwise none (never the gender). */
export function tableReference(equation: "male" | "female" | "not_selected" | null | undefined, chosen: TableSex | null | undefined): { sex: TableSex | null; from: ReferenceOrigin | null } {
  if (equation === "male" || equation === "female") return { sex: equation, from: "equation" };
  if (chosen === "male" || chosen === "female") return { sex: chosen, from: "chosen" };
  return { sex: null, from: null };
}

export interface ClassifyContext {
  ageYears: number | null;
  sex: TableSex | null;
  referenceFrom: ReferenceOrigin | null;
}

/** The classification of one result, or null for a result no table classifies (or a Cooper speed without its distance). */
export function classifyResult(code: string, value: number, inputs: Record<string, unknown> | null, context: ClassifyContext): Classification | null {
  const table = CLASSIFIED_CODES[code];
  if (!table) return null;
  const classified = table === "cooper_12min" ? inputs?.distanceM : value;
  if (typeof classified !== "number" || !Number.isFinite(classified)) return null;
  return classify({ table, value: classified, ageYears: context.ageYears, sex: context.sex, referenceFrom: context.referenceFrom });
}
