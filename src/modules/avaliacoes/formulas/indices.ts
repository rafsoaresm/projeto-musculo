/**
 * Complementary indices (handoff section 5). Every function returns null when an
 * input is missing or invalid; null is never replaced by zero. No rounding.
 */

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(text: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = typeof text === "string" ? DATE.exec(text) : null;
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { y, m, d };
}

/**
 * Full years on `onDate` ("YYYY-MM-DD"). The birthday itself counts. A 29 February
 * birthday completes the year on 1 March in non-leap years. Null when either date
 * is invalid or the birth is after the date.
 */
export function ageOn(birthDate: string | null | undefined, onDate: string | null | undefined): number | null {
  const birth = parseDate(birthDate);
  const on = parseDate(onDate);
  if (!birth || !on) return null;
  let age = on.y - birth.y;
  if (on.m < birth.m || (on.m === birth.m && on.d < birth.d)) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * Parses a decimal typed by a person: "12,5", "12.5", " 12 ", "-3". Null for empty
 * text and for anything else (thousand separators, letters, "1,2,3", ",5").
 */
export function parseDecimal(text: string | null | undefined): number | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** Normalizes a height to centimetres. */
export function heightToCm(value: number | null | undefined, unit: "m" | "cm"): number | null {
  if (!isPositiveFinite(value)) return null;
  return unit === "m" ? value * 100 : value;
}

/** Body mass index: kg / m². */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!isPositiveFinite(weightKg) || !isPositiveFinite(heightCm)) return null;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

/** Waist-to-hip ratio, both in cm. */
export function waistHipRatio(waistCm: number | null | undefined, hipCm: number | null | undefined): number | null {
  if (!isPositiveFinite(waistCm) || !isPositiveFinite(hipCm)) return null;
  return waistCm / hipCm;
}

/** Bilateral difference, convention right − left (cm). No significance judgement. */
export function bilateralDifference(rightCm: number | null | undefined, leftCm: number | null | undefined): number | null {
  if (!isPositiveFinite(rightCm) || !isPositiveFinite(leftCm)) return null;
  return rightCm - leftCm;
}
