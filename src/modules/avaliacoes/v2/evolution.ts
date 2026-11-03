import type { ResultRow } from "@/db/assessments";
import { RESULT_CODES } from "./review";
import type { Classification } from "../classifications";

/**
 * The evolution of the results of the Avaliação Física (handoff 4.3, 5 and 9): one series per result and per way of obtaining it. Two values are
 * in the same series only when they share the code, the method (protocol and equation variant, or the arithmetic), the version of the formula,
 * the conversion (Siri) and the unit; anything else starts another series and is never drawn on the same line. The results of the earlier format
 * (method unknown, `legacy_formula_unknown`) are kept apart. A value carries the classification written when it was recorded (slice 0.92), never
 * one computed now; a value that was not computed stays empty, never 0.
 */
export const LEGACY_METHOD = "legacy_formula_unknown";

/** One recorded assessment as the evolution reads it: its date, its format and the results written when it was finalized. */
export interface EvolutionSource {
  id: string;
  assessedOn: string;
  /** When it was recorded (ISO): orders two assessments of the same date and dates their values with the time (slice 0.84). */
  recordedAt?: string | null;
  formatVersion: number | null;
  results: ResultRow[];
}

export interface EvolutionPoint {
  assessmentId: string;
  assessedOn: string;
  recordedAt: string | null;
  /** Null when the record holds no value: shown as "Sem valor", never as 0. */
  value: number | null;
  unit: string | null;
  method: string;
  formulaVersion: string | null;
  /** The conversion from density to % fat written in the inputs (e.g. "siri_1961"); null when the result has none. */
  conversion: string | null;
  flags: string[];
  /** Slice 0.92: the classification written at finalize, or null (no table, or recorded before the tables). */
  classification: Classification | null;
}

/** Values of one result obtained the same way: the only ones that are compared with each other. */
export interface ComparableSeries {
  key: string;
  method: string;
  formulaVersion: string | null;
  conversion: string | null;
  unit: string | null;
  points: EvolutionPoint[];
  /** The points that can be drawn (with a value). */
  numeric: EvolutionPoint[];
  /** The series of the newest assessment that has this result. */
  latest: boolean;
}

/** Why a value is not comparable with the one before it in time. */
export type BreakReason = "method" | "formula" | "conversion" | "unit";

export interface TimelinePoint extends EvolutionPoint {
  seriesKey: string;
  /** Set when this value starts a stretch obtained differently from the previous value (in time) of the same result. */
  break: BreakReason | null;
}

export interface ResultEvolution {
  code: string;
  /** New-format values, one series per way of obtaining them, in the order they first appear. */
  series: ComparableSeries[];
  /** Every new-format value in time order, with the breaks marked. */
  timeline: TimelinePoint[];
  /** More than one series: the values are obtained in more than one way and are not equivalent. */
  mixed: boolean;
  /** More than one method (protocol or equation variant) among the series; false when only the formula version, conversion or unit differ. */
  methodsDiffer: boolean;
  /** Values of the earlier format or of an unknown method, oldest first, never in a series with the others. */
  legacy: EvolutionPoint[];
}

const comparableKey = (point: Pick<EvolutionPoint, "method" | "formulaVersion" | "conversion" | "unit">) =>
  JSON.stringify([point.method, point.formulaVersion, point.conversion, point.unit]);

function breakBetween(before: EvolutionPoint, after: EvolutionPoint): BreakReason | null {
  if (before.method !== after.method) return "method";
  if (before.formulaVersion !== after.formulaVersion) return "formula";
  if (before.conversion !== after.conversion) return "conversion";
  if (before.unit !== after.unit) return "unit";
  return null;
}

/**
 * The results that the conversion (Siri) turns density into: the % fat and the masses computed from it (handoff 4.2). The sum of skinfolds (mm)
 * and the density (g/cm³) share the inputs of the composition, conversion included, but are not converted, so the conversion is not theirs.
 */
const CONVERTED_CODES: ReadonlySet<string> = new Set(["body_fat_percent", "fat_mass_kg", "lean_mass_kg"]);
const conversionOf = (code: string, inputs: Record<string, unknown> | null) =>
  CONVERTED_CODES.has(code) && inputs && typeof inputs.conversion === "string" ? inputs.conversion : null;
const isLegacy = (source: EvolutionSource, result: ResultRow) => source.formatVersion !== 2 || result.method === LEGACY_METHOD;
const ORDER: readonly string[] = RESULT_CODES;

/** Two of the same date: the one recorded first comes first; without both times, the order given. */
const byRecorded = (a: string | null | undefined, b: string | null | undefined) => (a && b ? a.localeCompare(b) : 0);

/**
 * The history of results, grouped by result (in the order the assessment lists them), each split in comparable series. `history` is oldest
 * first; two assessments of the same date are ordered by the time they were recorded (slice 0.84).
 */
export function resultEvolution(history: EvolutionSource[]): ResultEvolution[] {
  const sorted = [...history]
    .map((source, index) => ({ source, index }))
    .sort((a, b) => a.source.assessedOn.localeCompare(b.source.assessedOn) || byRecorded(a.source.recordedAt, b.source.recordedAt) || a.index - b.index);
  const byCode = new Map<string, { fresh: EvolutionPoint[]; legacy: EvolutionPoint[] }>();
  for (const { source } of sorted) {
    for (const result of source.results) {
      const point: EvolutionPoint = {
        assessmentId: source.id,
        assessedOn: source.assessedOn,
        recordedAt: source.recordedAt ?? null,
        value: typeof result.value === "number" && Number.isFinite(result.value) ? result.value : null,
        unit: result.unit,
        method: result.method,
        formulaVersion: result.formulaVersion,
        conversion: conversionOf(result.code, result.inputs),
        flags: result.flags,
        classification: result.classification ?? null,
      };
      const entry = byCode.get(result.code) ?? { fresh: [], legacy: [] };
      (isLegacy(source, result) ? entry.legacy : entry.fresh).push(point);
      byCode.set(result.code, entry);
    }
  }
  const rank = (code: string) => (ORDER.includes(code) ? ORDER.indexOf(code) : ORDER.length);
  return [...byCode.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([code, { fresh, legacy }]) => {
      const groups = new Map<string, ComparableSeries>();
      const timeline: TimelinePoint[] = fresh.map((point, index) => {
        const key = comparableKey(point);
        let series = groups.get(key);
        if (!series) {
          series = { key, method: point.method, formulaVersion: point.formulaVersion, conversion: point.conversion, unit: point.unit, points: [], numeric: [], latest: false };
          groups.set(key, series);
        }
        series.points.push(point);
        if (point.value !== null) series.numeric.push(point);
        return { ...point, seriesKey: key, break: index === 0 ? null : breakBetween(fresh[index - 1], point) };
      });
      const series = [...groups.values()];
      const newest = timeline.at(-1);
      for (const item of series) item.latest = newest !== undefined && item.key === newest.seriesKey;
      return { code, series, timeline, mixed: series.length > 1, methodsDiffer: new Set(series.map((item) => item.method)).size > 1, legacy };
    });
}

export const BREAK_LABEL: Record<BreakReason, string> = {
  method: "Método diferente do valor anterior",
  formula: "Versão da fórmula diferente do valor anterior",
  conversion: "Conversão diferente do valor anterior",
  unit: "Unidade diferente do valor anterior",
};
