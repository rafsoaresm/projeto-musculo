/**
 * The models (templates) of the Avaliação Física (handoff V2 section 2: "Permitir reordenar ou desativar módulos opcionais por template, sem apagar
 * avaliações anteriores"; section 6: templateId, templateVersion, enabledModules; slice 0.85). Pure: no screen and no database here, so the
 * server checks a save with the same rule the screen uses to hide a part.
 *
 * A model says which optional parts of the guided flow are on, and in which order the three middle steps come. The Triagem (anamnese and PAR-Q)
 * is never optional: it gates the plans. "Revisão" is always last. A part that is off is hidden in the guided flow, reads "Não incluído neste
 * modelo" in the review, the recorded view and the PDF (never "Não realizado", which is a part that was on and not filled), and never blocks the
 * finalize. An assessment without a model (every assessment made before 0.85, and "Todos os módulos") has every part on, as before.
 */
import { z } from "zod";
import type { AssessmentModule } from "../catalog";
import type { CompositionPayload } from "./composition";
import { EMPTY_CONCLUSION, type ConclusionPayload } from "./conclusion";
import { EMPTY_MOVEMENT, type MovementPayload } from "./flexitest";
import { EMPTY_TESTS, type TestsPayload } from "./physical-tests";
import { EMPTY_POSTURE, type PosturePayload } from "./posture";
import type { StepKey } from "./steps";

/** The optional parts, as stored (stable codes), in the canonical order of the guided flow. */
export const TEMPLATE_PARTS = [
  "basics",
  "skinfolds",
  "perimeters",
  "breadths",
  "posture",
  "somatotype",
  "flexitest",
  "abdominal",
  "upper_limb",
  "cooper",
  "conclusion",
] as const;
export type TemplatePart = (typeof TEMPLATE_PARTS)[number];
export const isTemplatePart = (value: unknown): value is TemplatePart => typeof value === "string" && (TEMPLATE_PARTS as readonly string[]).includes(value);

export const PART_LABEL: Record<TemplatePart, string> = {
  basics: "Medidas básicas e sinais vitais",
  skinfolds: "Dobras cutâneas",
  perimeters: "Perímetros corporais",
  breadths: "Diâmetros ósseos",
  posture: "Avaliação postural",
  somatotype: "Somatotipo",
  flexitest: "Flexiteste",
  abdominal: "Resistência abdominal",
  upper_limb: "Resistência de membros superiores",
  cooper: "Teste de Cooper · 12 minutos",
  conclusion: "Considerações finais",
};
/** What each part holds, for the editor of a model. */
export const PART_HINT: Record<TemplatePart, string> = {
  basics: "Peso, altura, pressão arterial e frequência cardíaca de repouso",
  skinfolds: "Protocolo, dobras requeridas e prévia calculada",
  perimeters: "Perímetros com e sem lateralidade e a relação cintura/quadril",
  breadths: "Diâmetros ósseos, guardados sem cálculo",
  posture: "Vistas lateral, posterior e anterior, com fotos opcionais",
  somatotype: "Registro do profissional e medidas de Heath-Carter",
  flexitest: "Os 15 movimentos, níveis de 1 a 4",
  abdominal: "Repetições completas",
  upper_limb: "Repetições completas",
  cooper: "Distância em 12 minutos",
  conclusion: "Considerações, recomendações, limitações e encaminhamentos",
};

/** The steps whose order a model may change: Triagem stays first and Revisão last (handoff 2: the flow starts at the triagem and ends at the delivery). */
export const ORDERABLE_STEPS = ["medidas", "movimento", "testes"] as const satisfies readonly StepKey[];
export type OrderableStep = (typeof ORDERABLE_STEPS)[number];
export const isOrderableStep = (value: unknown): value is OrderableStep => typeof value === "string" && (ORDERABLE_STEPS as readonly string[]).includes(value);
export const ORDERABLE_STEP_LABEL: Record<OrderableStep, string> = { medidas: "Medidas", movimento: "Movimento", testes: "Testes" };

/** The step that shows each part. */
export const PART_STEP: Record<TemplatePart, StepKey> = {
  basics: "medidas",
  skinfolds: "medidas",
  perimeters: "medidas",
  breadths: "medidas",
  posture: "movimento",
  somatotype: "movimento",
  flexitest: "movimento",
  abdominal: "testes",
  upper_limb: "testes",
  cooper: "testes",
  conclusion: "revisao",
};
/** The module (section) that stores each part. */
export const PART_MODULE: Record<TemplatePart, AssessmentModule> = {
  basics: "composition",
  skinfolds: "composition",
  perimeters: "composition",
  breadths: "composition",
  posture: "posture",
  somatotype: "posture",
  flexitest: "movement",
  abdominal: "tests",
  upper_limb: "tests",
  cooper: "tests",
  conclusion: "conclusion",
};
export const partsOfStep = (step: StepKey) => TEMPLATE_PARTS.filter((part) => PART_STEP[part] === step);

/** The parts that are on: null is "every part" (no model, or an assessment made before the models). */
export type EnabledParts = readonly TemplatePart[] | null;
export const isPartEnabled = (enabled: EnabledParts, part: TemplatePart) => enabled === null || enabled.includes(part);
/** A step shows when it has a part on; Triagem and Revisão always show (the finalize lives in Revisão). */
export const isStepEnabled = (enabled: EnabledParts, step: StepKey) =>
  step === "triagem" || step === "revisao" || partsOfStep(step).some((part) => isPartEnabled(enabled, part));

/**
 * The list as stored: the parts that are on, without repeats, ordered by the order of the steps (then canonical within a step, conclusion last).
 * The order of the list is the order of the steps (a step with no part on is not shown, so its place does not matter).
 */
export function normalizeParts(parts: readonly TemplatePart[], stepOrder: readonly OrderableStep[] = ORDERABLE_STEPS): TemplatePart[] {
  const order = completeOrder(stepOrder);
  const rank = (part: TemplatePart) => {
    const step = PART_STEP[part];
    return step === "revisao" ? order.length : order.indexOf(step as OrderableStep);
  };
  return TEMPLATE_PARTS.filter((part) => parts.includes(part)).sort((left, right) => rank(left) - rank(right) || TEMPLATE_PARTS.indexOf(left) - TEMPLATE_PARTS.indexOf(right));
}

/** An order of the middle steps, completed with the missing ones in the default order (never repeated). */
function completeOrder(stepOrder: readonly OrderableStep[]): OrderableStep[] {
  const seen = stepOrder.filter((step, index) => isOrderableStep(step) && stepOrder.indexOf(step) === index);
  return [...seen, ...ORDERABLE_STEPS.filter((step) => !seen.includes(step))];
}

/** The order of the middle steps that a stored list says (the first part of each step); steps with no part on keep the default order after. */
export function stepOrderOf(enabled: EnabledParts): OrderableStep[] {
  if (enabled === null) return [...ORDERABLE_STEPS];
  const found: OrderableStep[] = [];
  for (const part of enabled) {
    const step = PART_STEP[part];
    if (isOrderableStep(step) && !found.includes(step)) found.push(step);
  }
  return completeOrder(found);
}

/** The steps of the guided flow, in the model's order, only those that show. */
export function visibleSteps(enabled: EnabledParts): StepKey[] {
  return ["triagem" as const, ...stepOrderOf(enabled), "revisao" as const].filter((step) => isStepEnabled(enabled, step));
}

/** A stored list read back: null when absent; anything unknown is dropped (a part that is not known is not on). */
export function readEnabledParts(raw: unknown): EnabledParts {
  if (raw === null || raw === undefined) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(isTemplatePart).filter((part, index, list) => list.indexOf(part) === index);
}

/* ---------- The editor of a model ---------- */

export const MAX_TEMPLATE_NAME = 80;
export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME),
    parts: z.array(z.enum(TEMPLATE_PARTS)).max(TEMPLATE_PARTS.length),
    stepOrder: z.array(z.enum(ORDERABLE_STEPS)).length(ORDERABLE_STEPS.length),
  })
  .strict()
  .refine((input) => new Set(input.stepOrder).size === ORDERABLE_STEPS.length, { path: ["stepOrder"], message: "order" })
  .refine((input) => new Set(input.parts).size === input.parts.length, { path: ["parts"], message: "repeat" });
export type TemplateInput = z.infer<typeof templateInputSchema>;
/** What a model stores from what the editor sends: the name, and the list of parts on in the order of the steps. */
export function templateRecord(input: TemplateInput): { name: string; enabled: TemplatePart[] } {
  return { name: input.name.trim(), enabled: normalizeParts(input.parts, input.stepOrder) };
}

/** "8 de 11 partes" for a list. */
export const partsCountText = (enabled: EnabledParts) => {
  const on = enabled === null ? TEMPLATE_PARTS.length : enabled.length;
  return `${on} de ${TEMPLATE_PARTS.length} partes opcionais`;
};

/** The default choice when starting an assessment: everything on, the order of the handoff. */
export const DEFAULT_TEMPLATE_LABEL = "Todos os módulos (padrão)";
export const NOT_INCLUDED = "Não incluído neste modelo";
/** "Modelo: Corrida (versão 2)." or the default, for the heading of a draft and the record. */
export const templateLine = (template: { name: string; version: number } | null) =>
  template ? `Modelo: ${template.name} (versão ${template.version}).` : `Modelo: ${DEFAULT_TEMPLATE_LABEL.toLowerCase()}.`;

/* ---------- What a part that is off may hold: nothing ---------- */

/** The composition with what belongs to the parts that are off emptied (the protocol settings stay: they hold no measure). */
export function maskComposition(payload: CompositionPayload, enabled: EnabledParts): CompositionPayload {
  if (enabled === null) return payload;
  const next = { ...payload };
  if (!isPartEnabled(enabled, "basics"))
    Object.assign(next, { weightKg: null, heightCm: null, systolicMmHg: null, diastolicMmHg: null, restingHeartRateBpm: null });
  if (!isPartEnabled(enabled, "skinfolds")) Object.assign(next, { protocol: null, skinfolds: {} });
  if (!isPartEnabled(enabled, "perimeters")) Object.assign(next, { perimetersCm: {}, sidedPerimetersCm: {} });
  if (!isPartEnabled(enabled, "breadths")) Object.assign(next, { boneBreadthsCm: {} });
  return next;
}
export function maskPosture(payload: PosturePayload, enabled: EnabledParts): PosturePayload {
  if (enabled === null) return payload;
  const next = { ...payload };
  if (!isPartEnabled(enabled, "posture")) Object.assign(next, { findings: {}, laterality: {}, notes: EMPTY_POSTURE.notes });
  if (!isPartEnabled(enabled, "somatotype")) Object.assign(next, { somatotype: EMPTY_POSTURE.somatotype });
  return next;
}
export const maskMovement = (payload: MovementPayload, enabled: EnabledParts): MovementPayload =>
  isPartEnabled(enabled, "flexitest") ? payload : { ...payload, flexitest: EMPTY_MOVEMENT.flexitest };
export function maskTests(payload: TestsPayload, enabled: EnabledParts): TestsPayload {
  if (enabled === null) return payload;
  return {
    ...payload,
    abdominal: isPartEnabled(enabled, "abdominal") ? payload.abdominal : EMPTY_TESTS.abdominal,
    upperLimb: isPartEnabled(enabled, "upper_limb") ? payload.upperLimb : EMPTY_TESTS.upperLimb,
    cooper: isPartEnabled(enabled, "cooper") ? payload.cooper : EMPTY_TESTS.cooper,
  };
}
export const maskConclusion = (payload: ConclusionPayload, enabled: EnabledParts): ConclusionPayload =>
  isPartEnabled(enabled, "conclusion") ? payload : EMPTY_CONCLUSION;

/** A module's payload with the parts that are off emptied; a module without optional parts (profile, screening) is as it is. */
export function maskSection(module: AssessmentModule, payload: unknown, enabled: EnabledParts): unknown {
  if (enabled === null) return payload;
  if (module === "composition") return maskComposition(payload as CompositionPayload, enabled);
  if (module === "posture") return maskPosture(payload as PosturePayload, enabled);
  if (module === "movement") return maskMovement(payload as MovementPayload, enabled);
  if (module === "tests") return maskTests(payload as TestsPayload, enabled);
  if (module === "conclusion") return maskConclusion(payload as ConclusionPayload, enabled);
  return payload;
}

/** Whether a value holds something: a number, a non-blank text, or a list/object with such a thing inside (null, "", [] and {} hold nothing). */
function holds(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(holds);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(holds);
  return false;
}
/** Where each part keeps its data in its module's payload (the settings of a protocol, a variant or a method are not data). */
const PART_FIELDS: Record<TemplatePart, (payload: Record<string, unknown>) => unknown[]> = {
  basics: (p) => [p.weightKg, p.heightCm, p.systolicMmHg, p.diastolicMmHg, p.restingHeartRateBpm],
  skinfolds: (p) => [p.protocol, p.skinfolds],
  perimeters: (p) => [p.perimetersCm, p.sidedPerimetersCm],
  breadths: (p) => [p.boneBreadthsCm],
  posture: (p) => [p.findings, p.laterality, p.notes],
  somatotype: (p) => {
    const somatotype = (p.somatotype ?? {}) as Record<string, unknown>;
    return [somatotype.labels, somatotype.notes, somatotype.heathCarter];
  },
  flexitest: (p) => {
    const flexitest = (p.flexitest ?? {}) as Record<string, unknown>;
    return [flexitest.levels, flexitest.classificationManual, flexitest.notes];
  },
  abdominal: (p) => [p.abdominal],
  upper_limb: (p) => [p.upperLimb],
  cooper: (p) => [p.cooper],
  conclusion: (p) => [p],
};

/** The parts that are off and still hold something in a payload of the module (a save with one is refused: the guided flow never shows them). */
export function excludedWithData(module: AssessmentModule, payload: unknown, enabled: EnabledParts): TemplatePart[] {
  if (enabled === null || payload === null || typeof payload !== "object") return [];
  const fields = payload as Record<string, unknown>;
  return TEMPLATE_PARTS.filter((part) => PART_MODULE[part] === module && !isPartEnabled(enabled, part) && PART_FIELDS[part](fields).some(holds));
}
