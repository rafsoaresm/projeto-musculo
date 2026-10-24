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

/**
 * Postural analysis (master document, section 8): a visual record and a working hypothesis,
 * never a diagnosis. These are the items of the document and nothing else. Marking one does not
 * change the risk status, which only the screening items decide.
 */
export const POSTURE_VIEWS = [
  {
    key: "ANTERIOR",
    label: "Vista anterior",
    items: [
      { key: "ANTERIOR.HEAD_TILT", label: "Inclinação da cabeça" },
      { key: "ANTERIOR.SHOULDER_ASYMMETRY", label: "Assimetria de ombros" },
      { key: "ANTERIOR.PELVIS_ASYMMETRY", label: "Assimetria de pelve" },
      { key: "ANTERIOR.KNEE_VALGUS", label: "Valgo aparente de joelhos" },
      { key: "ANTERIOR.KNEE_VARUS", label: "Varo aparente de joelhos" },
      { key: "ANTERIOR.FOOT_ASYMMETRY", label: "Assimetria dos pés" },
    ],
  },
  {
    key: "LATERAL",
    label: "Vista lateral",
    items: [
      { key: "LATERAL.FORWARD_HEAD", label: "Cabeça anteriorizada" },
      { key: "LATERAL.FORWARD_SHOULDERS", label: "Ombros anteriorizados" },
      { key: "LATERAL.KYPHOSIS", label: "Aumento aparente de cifose" },
      { key: "LATERAL.LORDOSIS", label: "Aumento aparente de lordose" },
      { key: "LATERAL.ANTERIOR_PELVIS", label: "Pelve anteriorizada" },
      { key: "LATERAL.KNEE_HYPEREXTENSION", label: "Joelho hiperestendido" },
    ],
  },
  {
    key: "POSTERIOR",
    label: "Vista posterior",
    items: [
      { key: "POSTERIOR.SCAPULAR_ASYMMETRY", label: "Assimetria escapular" },
      { key: "POSTERIOR.LATERAL_DEVIATION", label: "Desvio lateral aparente" },
      { key: "POSTERIOR.PELVIC_ASYMMETRY", label: "Assimetria pélvica" },
      { key: "POSTERIOR.CALCANEUS_ASYMMETRY", label: "Assimetria de calcâneo" },
      { key: "POSTERIOR.ASYMMETRIC_SUPPORT", label: "Apoio assimétrico" },
      { key: "POSTERIOR.OTHER_VISUAL", label: "Outro achado visual" },
    ],
  },
] as const;
export type PostureKey = (typeof POSTURE_VIEWS)[number]["items"][number]["key"];
export const POSTURE_KEYS = POSTURE_VIEWS.flatMap((view) => view.items.map((item) => item.key)) as [
  PostureKey,
  ...PostureKey[],
];
/** The stored item that carries the free postural notes. */
export const POSTURE_NOTES_ITEM = "NOTES";

/** Movement, mobility and control (section 9): the nine tests and the five-step scale. */
export const MOVEMENT_TESTS = [
  { key: "SQUAT", label: "Agachamento" },
  { key: "HIP_HINGE", label: "Dobradiça de quadril" },
  { key: "LUNGE", label: "Avanço / passada" },
  { key: "PUSH", label: "Empurrar" },
  { key: "PULL", label: "Puxar" },
  { key: "CORE_STABILITY", label: "Estabilidade do core" },
  { key: "SINGLE_LEG_BALANCE", label: "Equilíbrio unipodal" },
  { key: "ANKLE_MOBILITY", label: "Mobilidade de tornozelo" },
  { key: "SHOULDER_MOBILITY", label: "Mobilidade de ombro" },
] as const;
export type MovementKey = (typeof MOVEMENT_TESTS)[number]["key"];
export const MOVEMENT_KEYS = MOVEMENT_TESTS.map((test) => test.key) as [MovementKey, ...MovementKey[]];
export const MOVEMENT_GRADES = [
  { key: "NOT_ASSESSED", label: "Não avaliado" },
  { key: "NO_LIMITATION", label: "Sem limitação observada" },
  { key: "MILD", label: "Limitação leve" },
  { key: "MODERATE", label: "Limitação moderada" },
  { key: "STOPPED_BY_PAIN", label: "Interrompido por dor/desconforto" },
] as const;
export type MovementGrade = (typeof MOVEMENT_GRADES)[number]["key"];
export const GRADE_KEYS = MOVEMENT_GRADES.map((grade) => grade.key) as [MovementGrade, ...MovementGrade[]];

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

const postureSchema = z
  .object({
    findings: z
      .array(z.enum(POSTURE_KEYS))
      .max(POSTURE_KEYS.length)
      .default([])
      .transform((keys) => [...new Set(keys)]),
    notes: text(1000),
  })
  .strict();
const movementSchema = z
  .array(
    z
      .object({ test: z.enum(MOVEMENT_KEYS), grade: z.enum(GRADE_KEYS), notes: text(500) })
      .strict(),
  )
  .max(MOVEMENT_KEYS.length)
  .superRefine((rows, context) => {
    if (new Set(rows.map((row) => row.test)).size !== rows.length)
      context.addIssue({ code: "custom", message: "MOVEMENT_DUPLICATE" });
  });

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
    posture: postureSchema.default({ findings: [], notes: null }),
    movement: movementSchema.default([]),
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
