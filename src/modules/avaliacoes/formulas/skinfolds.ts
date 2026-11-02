/**
 * Skinfold aggregation and body composition (handoff section 4.1–4.2).
 * Full precision throughout; rounding is a presentation concern only.
 * A missing value is never treated as zero, and impossible results are reported
 * as invalid instead of being clamped.
 */
import { FORMULA_VERSION } from "./version";
import {
  variantFor,
  type EquationSelection,
  type ProtocolId,
  type ProtocolVariant,
  type SkinfoldSite,
  type VariantId,
} from "./protocols";

export type AggregationRule = "mean" | "median" | "single";
export type ConversionFormula = "siri_1961";

/**
 * A body fat percentage outside 0..100 is impossible, so it is invalid (never clamped to fit). A narrower "plausible" range is not in the
 * handoff: it waits for the technical reviewer (PENDENCIAS B47), and no made-up bound is used meanwhile.
 */
export const MAX_PLAUSIBLE_FAT_PERCENT = 100;

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Selected value of one site from 1–3 readings in mm. Returns null when the
 * readings are empty, more than three, contain a non-positive or non-finite
 * value, or when "single" is asked with more than one reading.
 */
export function selectedValue(readings: readonly number[], rule: AggregationRule): number | null {
  if (readings.length < 1 || readings.length > 3) return null;
  if (!readings.every(isPositiveFinite)) return null;
  if (rule === "single") return readings.length === 1 ? readings[0] : null;
  if (rule === "mean") return readings.reduce((total, value) => total + value, 0) / readings.length;
  const sorted = [...readings].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type SiteValues = Partial<Record<SkinfoldSite, number | null | undefined>>;

export type SumResult = {
  /** Sum of the variant's required sites; null when any is missing or invalid. */
  sumMm: number | null;
  /** Required sites with no value. */
  missing: SkinfoldSite[];
  /** Required sites whose value is zero, negative or non-finite. */
  invalid: SkinfoldSite[];
};

/** Sum of the sites the variant requires; extra sites are ignored. */
export function sumFor(variant: ProtocolVariant, values: SiteValues): SumResult {
  const missing: SkinfoldSite[] = [];
  const invalid: SkinfoldSite[] = [];
  let sum = 0;
  for (const site of variant.sites) {
    const value = values[site];
    if (value === null || value === undefined) missing.push(site);
    else if (!isPositiveFinite(value)) invalid.push(site);
    else sum += value;
  }
  return { sumMm: missing.length === 0 && invalid.length === 0 ? sum : null, missing, invalid };
}

/** Body density (g/cm³) for a density-based variant. */
export function densityFor(variantId: VariantId, sumMm: number, ageYears: number | null): number | null {
  const S = sumMm;
  const I = ageYears;
  switch (variantId) {
    case "guedes_3_1985_male":
      return 1.17136 - 0.06706 * Math.log10(S);
    case "guedes_3_1985_female":
      return 1.1665 - 0.07063 * Math.log10(S);
    case "jackson_pollock_3_1978_male":
      return I === null ? null : 1.10938 - 0.0008267 * S + 0.0000016 * S * S - 0.0002574 * I;
    case "jackson_pollock_3_1980_female":
      return I === null ? null : 1.0994921 - 0.0009929 * S + 0.0000023 * S * S - 0.0001392 * I;
    case "jackson_pollock_7_1978_male":
      return I === null ? null : 1.112 - 0.00043499 * S + 0.00000055 * S * S - 0.00028826 * I;
    case "jackson_pollock_7_1980_female":
      return I === null ? null : 1.097 - 0.00046971 * S + 0.00000056 * S * S - 0.00012828 * I;
    case "faulkner_4_1968":
      return null;
  }
}

/** Siri (1961): % fat from body density. */
export function siriPercent(density: number): number {
  return 495 / density - 450;
}

/** Faulkner (1968): % fat directly from the sum of four skinfolds. */
export function faulknerPercent(sumMm: number): number {
  return 0.153 * sumMm + 5.783;
}

export type BodyCompositionInput = {
  protocol: ProtocolId;
  equation: EquationSelection;
  /** Full years on the assessment date; null when unknown. */
  ageYears: number | null;
  weightKg: number | null;
  sites: SiteValues;
  conversion: ConversionFormula;
};

export type ValidationFlag =
  | "outside_validation_population"
  | "validation_age_unknown"
  | "requires_professional_validation";

export type BodyCompositionOk = {
  status: "ok";
  sumMm: number;
  density: number | null;
  bodyFatPercent: number;
  fatMassKg: number | null;
  fatFreeMassKg: number | null;
  variant: VariantId;
  formulaVersion: string;
  conversion: ConversionFormula | null;
  flags: ValidationFlag[];
};

export type BodyCompositionPending = {
  status: "pending";
  reason: "equation_not_selected" | "missing_sites" | "missing_age";
  missing?: SkinfoldSite[];
};

export type BodyCompositionInvalid = {
  status: "invalid";
  reason: "invalid_site_value" | "invalid_age" | "invalid_density" | "implausible_fat_percent" | "non_finite_result";
  sites?: SkinfoldSite[];
};

export type BodyCompositionResult = BodyCompositionOk | BodyCompositionPending | BodyCompositionInvalid;

/**
 * Body composition for the selected protocol. Only the automatic calculation is
 * blocked when data is missing; raw measurements are kept by the caller.
 */
export function bodyComposition(input: BodyCompositionInput): BodyCompositionResult {
  if (input.equation === "not_selected") return { status: "pending", reason: "equation_not_selected" };
  const variant = variantFor(input.protocol, input.equation);

  const sum = sumFor(variant, input.sites);
  if (sum.invalid.length > 0) return { status: "invalid", reason: "invalid_site_value", sites: sum.invalid };
  if (sum.sumMm === null) return { status: "pending", reason: "missing_sites", missing: sum.missing };
  const sumMm = sum.sumMm;

  const age = input.ageYears;
  if (age !== null && (!Number.isInteger(age) || age < 0)) return { status: "invalid", reason: "invalid_age" };
  if (variant.requiresAge && age === null) return { status: "pending", reason: "missing_age" };

  let density: number | null = null;
  let bodyFatPercent: number;
  let conversion: ConversionFormula | null = null;
  if (variant.output === "percent") {
    bodyFatPercent = faulknerPercent(sumMm);
  } else {
    density = densityFor(variant.id, sumMm, age);
    if (density === null) return { status: "pending", reason: "missing_age" };
    if (!Number.isFinite(density)) return { status: "invalid", reason: "non_finite_result" };
    if (density <= 0) return { status: "invalid", reason: "invalid_density" };
    conversion = input.conversion;
    bodyFatPercent = siriPercent(density);
  }
  if (!Number.isFinite(bodyFatPercent)) return { status: "invalid", reason: "non_finite_result" };
  if (bodyFatPercent <= 0 || bodyFatPercent >= MAX_PLAUSIBLE_FAT_PERCENT) {
    return { status: "invalid", reason: "implausible_fat_percent" };
  }

  const weight = isPositiveFinite(input.weightKg) ? input.weightKg : null;
  const fatMassKg = weight === null ? null : (weight * bodyFatPercent) / 100;
  const fatFreeMassKg = weight === null || fatMassKg === null ? null : weight - fatMassKg;

  return {
    status: "ok",
    sumMm,
    density,
    bodyFatPercent,
    fatMassKg,
    fatFreeMassKg,
    variant: variant.id,
    formulaVersion: FORMULA_VERSION,
    conversion,
    flags: validationFlags(variant, age),
  };
}

function validationFlags(variant: ProtocolVariant, age: number | null): ValidationFlag[] {
  const flags: ValidationFlag[] = [];
  const { ageMin, ageMax } = variant.validation;
  if (ageMin === null && ageMax === null) {
    flags.push("requires_professional_validation");
  } else if (age === null) {
    flags.push("validation_age_unknown");
  } else if ((ageMin !== null && age < ageMin) || (ageMax !== null && age > ageMax)) {
    flags.push("outside_validation_population");
  }
  return flags;
}
