import { z } from "zod";

/**
 * Screening and baseline metrics, with the items of the master document (section 7.1 and 7.2) and
 * nothing else: no item was added and none was reworded into a diagnosis.
 *
 * Any marked item makes the assessment REVIEW_REQUIRED. CLEAR only says that no alert was
 * captured by these items. It is not a clinical clearance and no screen may present it as one.
 */
export const SCREENING_ITEMS = [
  { key: "exertionPain", column: "exertion_pain", label: "Dor durante esforço" },
  { key: "dizzinessFainting", column: "dizziness_fainting", label: "Tontura ou desmaio" },
  { key: "chestPain", column: "chest_pain", label: "Dor torácica relatada" },
  { key: "injuryInTreatment", column: "injury_in_treatment", label: "Lesão em tratamento" },
  { key: "recentSurgery", column: "recent_surgery", label: "Pós-operatório recente" },
  { key: "medicalRestriction", column: "medical_restriction", label: "Restrição médica relatada" },
] as const;
export type ScreeningKey = (typeof SCREENING_ITEMS)[number]["key"];
export type RiskStatus = "CLEAR" | "REVIEW_REQUIRED";

export const riskOf = (flags: Record<ScreeningKey, boolean>): RiskStatus =>
  SCREENING_ITEMS.some((item) => flags[item.key]) ? "REVIEW_REQUIRED" : "CLEAR";

/** The wording the product must use for a flagged assessment. */
export const REVIEW_REQUIRED_TEXT = "Revisão obrigatória antes da entrega.";
export const NOT_CLEARANCE_TEXT = "Isto não é liberação clínica.";
export const CLEAR_TEXT = `Nenhum sinal marcado na triagem. ${NOT_CLEARANCE_TEXT}`;

export const METRIC_TYPES = {
  RESTING_HEART_RATE: { label: "Frequência cardíaca de repouso", unit: "bpm", range: [20, 300] },
  BLOOD_PRESSURE: { label: "Pressão arterial (como registrada)", unit: "mmHg", range: null },
  WAIST: { label: "Cintura", unit: "cm", range: [20, 300] },
  BODY_FAT: { label: "Percentual de gordura", unit: "%", range: [1, 80] },
  CUSTOM: { label: "Outra medida ou teste", unit: null, range: null },
} as const;
export type MetricType = keyof typeof METRIC_TYPES;
export const METRIC_KEYS = Object.keys(METRIC_TYPES) as [MetricType, ...MetricType[]];
export const SIDES = ["LEFT", "RIGHT", "BOTH"] as const;
export const SIDE_LABEL = { LEFT: "Esquerdo", RIGHT: "Direito", BOTH: "Ambos" } as const;
export const MAX_METRICS = 30;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const metricSchema = z
  .object({
    metricType: z.enum(METRIC_KEYS),
    name: z.string().trim().max(80).nullish(),
    value: z.string().trim().min(1).max(40),
    unit: text(20),
    side: z.enum(SIDES).nullish().transform((value) => value ?? null),
    notes: text(500),
  })
  .strict()
  .transform((metric, context) => {
    const kind = METRIC_TYPES[metric.metricType];
    const name = metric.name || (kind.label !== METRIC_TYPES.CUSTOM.label ? kind.label : "");
    if (!name) {
      context.addIssue({ code: "custom", path: ["name"], message: "METRIC_NAME_REQUIRED" });
      return z.NEVER;
    }
    const unit = metric.unit ?? kind.unit;
    const plain = metric.value.replace(",", ".");
    const numeric = /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : null;
    if (metric.metricType === "BLOOD_PRESSURE" && !/^\d{2,3}\s*\/\s*\d{2,3}$/.test(metric.value))
      context.addIssue({ code: "custom", path: ["value"], message: "METRIC_VALUE_INVALID" });
    if (kind.range && (numeric === null || numeric < kind.range[0] || numeric > kind.range[1]))
      context.addIssue({ code: "custom", path: ["value"], message: "METRIC_VALUE_INVALID" });
    return {
      metricType: metric.metricType,
      name,
      valueText: metric.value,
      valueNumber: numeric,
      unit,
      side: metric.side,
      notes: metric.notes,
    };
  });
export type MetricInput = z.output<typeof metricSchema>;

const flag = z.boolean().default(false);
const base = z
  .object({
    assessedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      }, "DATE_INVALID"),
    exertionPain: flag,
    dizzinessFainting: flag,
    chestPain: flag,
    injuryInTreatment: flag,
    recentSurgery: flag,
    medicalRestriction: flag,
    screeningNotes: text(1000),
    notes: text(1000),
    metrics: z.array(metricSchema).max(MAX_METRICS).default([]),
  })
  .strict();
export type AssessmentInput = z.output<typeof base> & { riskStatus: RiskStatus };

/** An assessment date cannot be in the future. The risk status is always computed, never sent. */
export function parseAssessment(raw: unknown, today = new Date()): AssessmentInput {
  const limit = today.toISOString().slice(0, 10);
  const parsed = base
    .superRefine((value, context) => {
      if (value.assessedOn > limit || value.assessedOn < "1900-01-01")
        context.addIssue({ code: "custom", path: ["assessedOn"], message: "DATE_INVALID" });
    })
    .parse(raw);
  return { ...parsed, riskStatus: riskOf(parsed) };
}
