/**
 * Physical tests (handoff sections 3.4, 3.5 and 5). Classifications are manual
 * until a reference table is approved; nothing here labels a result.
 */
import { FORMULA_VERSION } from "./version";

export type CooperResult = {
  /** Average speed over the fixed 12 minutes: distance_m / 200 (km/h). */
  speedKmh: number;
  /** Estimated VO2max (ml/kg/min): (distance_m - 504.9) / 44.73. An estimate, not a measurement. */
  vo2Estimate: number;
  formulaVersion: string;
};

export function cooper(distanceM: number | null | undefined): CooperResult | null {
  if (typeof distanceM !== "number" || !Number.isFinite(distanceM) || distanceM <= 0) return null;
  return { speedKmh: distanceM / 200, vo2Estimate: (distanceM - 504.9) / 44.73, formulaVersion: FORMULA_VERSION };
}

/** The 15 Flexiteste movements of the source PDF (page 4), in order. */
export const FLEXITEST_MOVEMENTS = [
  { code: "shoulder_horizontal_abduction", label: "Abdução horizontal dos ombros" },
  { code: "shoulder_abduction", label: "Abdução do ombro" },
  { code: "elbow_flexion", label: "Flexão do cotovelo" },
  { code: "elbow_hyperextension", label: "Hiperextensão do cotovelo" },
  { code: "wrist_flexion", label: "Flexão do punho" },
  { code: "wrist_extension", label: "Extensão do punho" },
  { code: "hip_flexion", label: "Flexão do quadril" },
  { code: "trunk_hyperextension", label: "Hiperextensão do tronco" },
  { code: "trunk_lateral_flexion", label: "Flexão lateral do tronco" },
  { code: "thigh_flexion", label: "Flexão da coxa" },
  { code: "thigh_extension", label: "Extensão da coxa" },
  { code: "knee_flexion", label: "Flexão do joelho" },
  { code: "knee_hyperextension", label: "Hiperextensão do joelho" },
  { code: "ankle_dorsiflexion", label: "Dorsiflexão plantar" },
  { code: "ankle_plantar_flexion", label: "Flexão plantar" },
] as const;
export type FlexitestMovement = (typeof FLEXITEST_MOVEMENTS)[number]["code"];
export type FlexitestLevel = 1 | 2 | 3 | 4;
export type FlexitestLevels = Partial<Record<FlexitestMovement, FlexitestLevel | null>>;

export type FlexitestResult = {
  filled: number;
  /** Sum of the 15 levels; null until all 15 are filled. */
  total: number | null;
  complete: boolean;
};

const isLevel = (value: unknown): value is FlexitestLevel =>
  value === 1 || value === 2 || value === 3 || value === 4;

/** Empty or out-of-scale entries count as not filled, never as zero. */
export function flexitest(levels: FlexitestLevels): FlexitestResult {
  let filled = 0;
  let sum = 0;
  for (const { code } of FLEXITEST_MOVEMENTS) {
    const level = levels[code];
    if (isLevel(level)) {
      filled += 1;
      sum += level;
    }
  }
  const complete = filled === FLEXITEST_MOVEMENTS.length;
  return { filled, total: complete ? sum : null, complete };
}
