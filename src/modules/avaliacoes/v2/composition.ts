/**
 * The "Medidas" step of the new assessment (module "composition", handoff V2 sections 3.2 and 4): what is stored, how the screen's text becomes
 * it, and the preview calculated from it. Pure: no screen and no database here, so the server checks a save with the same rules the screen uses.
 *
 * A measure not taken is absent (null or no readings), never 0. Changing the protocol never deletes what was typed in the other sites.
 */
import { z } from "zod";
import {
  BONE_BREADTHS,
  BONE_BREADTH_CODES,
  PERIMETERS_SIDED,
  PERIMETERS_SINGLE,
  PERIMETER_SIDED_CODES,
  PERIMETER_SINGLE_CODES,
  type BoneBreadth,
  type PerimeterSided,
  type PerimeterSingle,
} from "../catalog";
import {
  PROTOCOL_IDS,
  PROTOCOL_VARIANTS,
  SKINFOLD_SITES,
  SKINFOLD_SITE_CODES,
  ageOn,
  bmi,
  bodyComposition,
  heightToCm,
  parseDecimal,
  selectedValue,
  type AggregationRule,
  type EquationSelection,
  type ProtocolId,
  type ProtocolVariant,
  type SiteValues,
  type SkinfoldSite,
  waistHipRatio,
} from "../formulas";

export const COMPOSITION_MODULE = "composition" as const;

/**
 * A technical ceiling for a typed number, so a slip of the keyboard (an extra zero) is not stored. It is not a clinical range: plausible ranges
 * wait for the technical reviewer (PENDENCIAS B47).
 */
export const MAX_MEASURE = 1000;
export const MAX_READINGS = 3;

const measure = z.number().finite().positive().max(MAX_MEASURE).nullable().default(null);
const readings = z.array(z.number().finite().positive().max(MAX_MEASURE)).min(1).max(MAX_READINGS);
const centimetres = z.number().finite().positive().max(MAX_MEASURE);
/** A perimeter on each side (handoff 3.2: each side in a field of its own); a side not measured is null, and a stored pair has at least one. */
const sides = z
  .object({ right: centimetres.nullable().default(null), left: centimetres.nullable().default(null) })
  .strict()
  .refine((pair) => pair.right !== null || pair.left !== null);

export const EQUATIONS = ["male", "female", "not_selected"] as const;
export const AGGREGATIONS = ["mean", "median", "single"] as const;

export const compositionSchema = z
  .object({
    weightKg: measure,
    heightCm: measure,
    systolicMmHg: measure,
    diastolicMmHg: measure,
    restingHeartRateBpm: measure,
    protocol: z.enum(PROTOCOL_IDS).nullable().default(null),
    /** The physiological reference of the equation, not the person's gender (decision of the user, 02/11/2026). */
    equation: z.enum(EQUATIONS).default("not_selected"),
    /**
     * Slice 0.92: the reference (masculina/feminina) of the classification tables when the equation above is not set (e.g. no skinfolds), chosen
     * by the professional in "Revisão"; never inferred from the gender (user's decision 2). Absent: not chosen (absent, not a default, so what
     * was stored before reads exactly as it was).
     */
    tableReference: z.enum(["male", "female"]).optional(),
    aggregation: z.enum(AGGREGATIONS).default("mean"),
    conversion: z.literal("siri_1961").default("siri_1961"),
    skinfolds: z.partialRecord(z.enum(SKINFOLD_SITE_CODES), readings).default({}),
    /** Perimeters without a side (cm), handoff 3.2 and 6 (anthropometry.circumferencesCm). A perimeter not measured is absent. */
    perimetersCm: z.partialRecord(z.enum(PERIMETER_SINGLE_CODES), centimetres).default({}),
    /** Perimeters on each side (cm): right and left kept apart, never averaged. */
    sidedPerimetersCm: z.partialRecord(z.enum(PERIMETER_SIDED_CODES), sides).default({}),
    /** Bone breadths (cm), handoff 3.2 and 6 (anthropometry.boneBreadthsCm). */
    boneBreadthsCm: z.partialRecord(z.enum(BONE_BREADTH_CODES), centimetres).default({}),
  })
  .strict();
export type CompositionPayload = z.infer<typeof compositionSchema>;

export const EMPTY_COMPOSITION: CompositionPayload = compositionSchema.parse({});

/** What was stored, read back; anything unknown or invalid reads as the empty step (never as a guess). */
export function readComposition(raw: unknown): CompositionPayload {
  const parsed = compositionSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_COMPOSITION;
}

/* ---------- Labels ---------- */

export const PROTOCOL_CHIP: Record<ProtocolId, string> = {
  faulkner_4: "Faulkner",
  guedes_3: "Guedes · 3",
  jackson_pollock_7: "Jackson & Pollock · 7",
  jackson_pollock_3: "Jackson & Pollock · 3",
};
export const protocolTitle = (protocol: ProtocolId) => PROTOCOL_CHIP[protocol].replace(" · ", " ");
export const EQUATION_LABEL: Record<EquationSelection, string> = { male: "Masculina", female: "Feminina", not_selected: "Não selecionada" };
export const AGGREGATION_LABEL: Record<AggregationRule, string> = { mean: "Média", median: "Mediana", single: "Leitura única" };
export const CONVERSION_LABEL = { siri_1961: "Siri (1961)" } as const;
export const SITE_LABEL = Object.fromEntries(SKINFOLD_SITES.map((site) => [site.code, site.label])) as Record<SkinfoldSite, string>;
export const SIDE_LABEL = { right: "direito", left: "esquerdo" } as const;
/** "Braço direito", "Coxa esquerda": the name of one side's field. */
export function sideFieldLabel(code: PerimeterSided, side: "right" | "left"): string {
  const feminine = code === "thigh" || code === "calf";
  const word = side === "right" ? (feminine ? "direita" : "direito") : feminine ? "esquerda" : "esquerdo";
  return `${PERIMETERS_SIDED[code]} ${word}`;
}

/* ---------- The screen's text ---------- */

/** What the screen holds: the text as typed, so nothing is rounded or lost while typing. */
export interface CompositionForm {
  weight: string;
  height: string;
  systolic: string;
  diastolic: string;
  heartRate: string;
  protocol: ProtocolId | null;
  equation: EquationSelection;
  /** Slice 0.92: "Referência das tabelas" chosen in Revisão (used only when the equation is not set); null: not chosen. */
  tableReference: "male" | "female" | null;
  aggregation: AggregationRule;
  /** Up to three readings per site, as typed; a site with no entry was not measured. */
  skinfolds: Partial<Record<SkinfoldSite, string[]>>;
  perimeters: Partial<Record<PerimeterSingle, string>>;
  sidedPerimeters: Partial<Record<PerimeterSided, { right: string; left: string }>>;
  breadths: Partial<Record<BoneBreadth, string>>;
}

const decimalText = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));

export function formFromPayload(payload: CompositionPayload): CompositionForm {
  return {
    weight: decimalText(payload.weightKg),
    // Height is typed in metres (1,71), as on the paper form; it is stored in centimetres.
    height: payload.heightCm === null ? "" : decimalText(Number((payload.heightCm / 100).toFixed(4))),
    systolic: decimalText(payload.systolicMmHg),
    diastolic: decimalText(payload.diastolicMmHg),
    heartRate: decimalText(payload.restingHeartRateBpm),
    protocol: payload.protocol,
    equation: payload.equation,
    tableReference: payload.tableReference ?? null,
    aggregation: payload.aggregation,
    skinfolds: Object.fromEntries(Object.entries(payload.skinfolds).map(([site, values]) => [site, values.map((value) => decimalText(value))])),
    perimeters: Object.fromEntries(Object.entries(payload.perimetersCm).map(([code, value]) => [code, decimalText(value)])),
    sidedPerimeters: Object.fromEntries(
      Object.entries(payload.sidedPerimetersCm).map(([code, pair]) => [code, { right: decimalText(pair.right), left: decimalText(pair.left) }]),
    ),
    breadths: Object.fromEntries(Object.entries(payload.boneBreadthsCm).map(([code, value]) => [code, decimalText(value)])),
  };
}

/**
 * A height typed in metres ("1,71") or centimetres ("171"). Nobody measures 3 m or less than 3 cm, so the number itself says the unit.
 * Null for empty text; NaN for text that is not a number.
 */
export function heightFromText(text: string): number | null {
  if (text.trim() === "") return null;
  const value = parseDecimal(text);
  if (value === null || value <= 0) return Number.NaN;
  return heightToCm(value, value < 3 ? "m" : "cm");
}

/** Null for empty text, NaN for text that is not a number. */
function numberFromText(text: string): number | null {
  if (text.trim() === "") return null;
  return parseDecimal(text) ?? Number.NaN;
}

export const FIELD_LABEL = {
  weightKg: "Peso",
  heightCm: "Altura",
  systolicMmHg: "PAS",
  diastolicMmHg: "PAD",
  restingHeartRateBpm: "FC repouso",
} as const;

export type FormReading = { payload: CompositionPayload; problems: [] } | { payload: null; problems: string[] };

/**
 * The text of the screen as the payload to store. Empty readings are left out; a site with none is not measured. A text that is not a positive
 * number (or is above the technical ceiling) is a problem named by its field, never a 0.
 */
export function payloadFromForm(form: CompositionForm): FormReading {
  const problems: string[] = [];
  const read = (key: keyof typeof FIELD_LABEL, value: number | null) => {
    if (value === null) return null;
    if (!Number.isFinite(value) || value <= 0 || value > MAX_MEASURE) {
      problems.push(FIELD_LABEL[key]);
      return null;
    }
    return value;
  };
  const skinfolds: Partial<Record<SkinfoldSite, number[]>> = {};
  for (const site of SKINFOLD_SITE_CODES) {
    const typed = (form.skinfolds[site] ?? []).filter((text) => text.trim() !== "");
    if (typed.length === 0) continue;
    const values = typed.map((text) => numberFromText(text) ?? Number.NaN);
    if (values.length > MAX_READINGS || values.some((value) => !Number.isFinite(value) || value <= 0 || value > MAX_MEASURE)) {
      problems.push(SITE_LABEL[site]);
      continue;
    }
    skinfolds[site] = values;
  }
  /** One centimetre field: null when empty; a text that is not a positive number is a problem named by its field. */
  const cm = (name: string, text: string | undefined): number | null => {
    const value = numberFromText(text ?? "");
    if (value === null) return null;
    if (!Number.isFinite(value) || value <= 0 || value > MAX_MEASURE) {
      problems.push(name);
      return null;
    }
    return value;
  };
  const perimetersCm: Partial<Record<PerimeterSingle, number>> = {};
  for (const code of PERIMETER_SINGLE_CODES) {
    const value = cm(PERIMETERS_SINGLE[code], form.perimeters[code]);
    if (value !== null) perimetersCm[code] = value;
  }
  const sidedPerimetersCm: Partial<Record<PerimeterSided, { right: number | null; left: number | null }>> = {};
  for (const code of PERIMETER_SIDED_CODES) {
    const pair = form.sidedPerimeters[code];
    const right = cm(sideFieldLabel(code, "right"), pair?.right);
    const left = cm(sideFieldLabel(code, "left"), pair?.left);
    if (right !== null || left !== null) sidedPerimetersCm[code] = { right, left };
  }
  const boneBreadthsCm: Partial<Record<BoneBreadth, number>> = {};
  for (const code of BONE_BREADTH_CODES) {
    const value = cm(BONE_BREADTHS[code], form.breadths[code]);
    if (value !== null) boneBreadthsCm[code] = value;
  }
  const candidate = {
    weightKg: read("weightKg", numberFromText(form.weight)),
    heightCm: read("heightCm", heightFromText(form.height)),
    systolicMmHg: read("systolicMmHg", numberFromText(form.systolic)),
    diastolicMmHg: read("diastolicMmHg", numberFromText(form.diastolic)),
    restingHeartRateBpm: read("restingHeartRateBpm", numberFromText(form.heartRate)),
    protocol: form.protocol,
    equation: form.equation,
    ...(form.tableReference ? { tableReference: form.tableReference } : {}),
    aggregation: form.aggregation,
    conversion: "siri_1961" as const,
    skinfolds,
    perimetersCm,
    sidedPerimetersCm,
    boneBreadthsCm,
  };
  if (problems.length > 0) return { payload: null, problems };
  return { payload: compositionSchema.parse(candidate), problems: [] };
}

/**
 * The names of the fields a refused payload has wrong (a check on the server, where the payload did not come from this screen): the same names
 * the screen uses.
 */
export function issueNames(issues: readonly { path: readonly PropertyKey[] }[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const [first, second, third] = issue.path.map(String);
    if (first === "skinfolds" && second && second in SITE_LABEL) names.add(SITE_LABEL[second as SkinfoldSite]);
    else if (first === "perimetersCm" && second && second in PERIMETERS_SINGLE) names.add(PERIMETERS_SINGLE[second as PerimeterSingle]);
    else if (first === "sidedPerimetersCm" && second && second in PERIMETERS_SIDED)
      names.add(third === "right" || third === "left" ? sideFieldLabel(second as PerimeterSided, third) : PERIMETERS_SIDED[second as PerimeterSided]);
    else if (first === "boneBreadthsCm" && second && second in BONE_BREADTHS) names.add(BONE_BREADTHS[second as BoneBreadth]);
    else if (first && first in FIELD_LABEL) names.add(FIELD_LABEL[first as keyof typeof FIELD_LABEL]);
  }
  return [...names];
}

/** The message of a refused save, naming the fields. */
export const problemsMessage = (problems: string[]) =>
  `Confira ${problems.length === 1 ? "o campo" : "os campos"} ${problems.join(", ")}: use números positivos, com vírgula ou ponto (por exemplo, 69,1).`;

/* ---------- Which sites ---------- */

/** The sites the selected protocol asks for. With no equation chosen, both variants' sites (Guedes and JP3 differ by reference). */
export function requiredSites(protocol: ProtocolId | null, equation: EquationSelection): SkinfoldSite[] {
  if (protocol === null) return [];
  const variants: ProtocolVariant[] = equation === "not_selected" ? [PROTOCOL_VARIANTS[protocol].male, PROTOCOL_VARIANTS[protocol].female] : [PROTOCOL_VARIANTS[protocol][equation]];
  const wanted = new Set(variants.flatMap((variant) => variant.sites));
  // In the order the variant lists them (the order of measurement), then the other variant's.
  return [...wanted];
}

export function otherSites(protocol: ProtocolId | null, equation: EquationSelection): SkinfoldSite[] {
  const required = new Set(requiredSites(protocol, equation));
  return SKINFOLD_SITE_CODES.filter((site) => !required.has(site));
}

/* ---------- The preview ---------- */

const one = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const two = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface CompositionPreview {
  /** "Soma das 7 dobras" when the protocol is known. */
  sumLabel: string;
  sum: string | null;
  fatPercent: string | null;
  fatMass: string | null;
  fatFree: string | null;
  bmi: string | null;
  /** "Fórmula Jackson & Pollock 1978 + Siri 1961; resultado estimado", from the variant's data. */
  method: string | null;
  /** Why there is no result yet, or why it is not possible. */
  status: string | null;
  /** The limits of the method for this person (validation population). */
  flag: string | null;
}

/** "Jackson e Pollock (1978); Topend..." → "Jackson & Pollock 1978". */
function authorsOf(variant: ProtocolVariant): string {
  const match = /^(.+?) \((\d{4})\)/.exec(variant.source);
  const authors = match ? `${match[1]} ${match[2]}` : variant.source;
  return authors.replace(/ e /g, " & ");
}

export function methodLine(variant: ProtocolVariant): string {
  const conversion = variant.output === "density" ? ` + ${CONVERSION_LABEL.siri_1961.replace(/[()]/g, "")}` : "";
  return `Fórmula ${authorsOf(variant)}${conversion}; resultado estimado`;
}

const withoutStop = (text: string) => text.replace(/\.$/, "");

/** The selected value of each site, from the text: NaN when a reading is not a positive number, null when not measured or not selectable. */
function siteValues(form: CompositionForm): { values: SiteValues; manyForSingle: SkinfoldSite[] } {
  const values: SiteValues = {};
  const manyForSingle: SkinfoldSite[] = [];
  for (const site of SKINFOLD_SITE_CODES) {
    const typed = (form.skinfolds[site] ?? []).filter((text) => text.trim() !== "");
    if (typed.length === 0) continue;
    const readingsOf = typed.map((text) => numberFromText(text) ?? Number.NaN);
    if (readingsOf.some((value) => !Number.isFinite(value) || value <= 0)) {
      values[site] = Number.NaN;
      continue;
    }
    if (form.aggregation === "single" && readingsOf.length > 1) manyForSingle.push(site);
    values[site] = selectedValue(readingsOf, form.aggregation);
  }
  return { values, manyForSingle };
}

/** Age on the assessment date from the snapshot's birth date; null when either is missing. */
export const ageAtAssessment = (birthDate: string | null | undefined, assessedOn: string) => ageOn(birthDate ?? null, assessedOn);

/**
 * The preview of the screen, computed with the same formulas the record will use. Every number is an estimate; there is no classification
 * (none is homologated). A missing input says what is missing instead of showing a number.
 */
export function compositionPreview(form: CompositionForm, ageYears: number | null): CompositionPreview {
  const weight = numberFromText(form.weight);
  const height = heightFromText(form.height);
  const bodyMassIndex = bmi(weight, height);
  const base: CompositionPreview = {
    sumLabel: "Soma das dobras",
    sum: null,
    fatPercent: null,
    fatMass: null,
    fatFree: null,
    bmi: bodyMassIndex === null ? null : two.format(bodyMassIndex),
    method: null,
    status: null,
    flag: null,
  };
  if (form.protocol === null) return { ...base, status: "Escolha o protocolo de dobras para calcular" };
  const protocol = form.protocol;
  const required = requiredSites(protocol, form.equation);
  const { values, manyForSingle } = siteValues(form);
  if (form.equation !== "not_selected") {
    const chosen = PROTOCOL_VARIANTS[protocol][form.equation];
    base.sumLabel = `Soma das ${chosen.sites.length} dobras`;
    base.method = methodLine(chosen);
  }
  const single = manyForSingle.filter((site) => required.includes(site));
  if (single.length > 0)
    return { ...base, status: `Leitura única: deixe só uma leitura em ${single.map((site) => SITE_LABEL[site]).join(", ")}` };
  const result = bodyComposition({
    protocol,
    equation: form.equation,
    ageYears,
    weightKg: weight !== null && Number.isFinite(weight) ? weight : null,
    sites: values,
    conversion: "siri_1961",
  });
  if (result.status === "pending") {
    if (result.reason === "equation_not_selected") return { ...base, status: "Escolha a equação de referência para calcular" };
    if (result.reason === "missing_age") return { ...base, status: "Sem idade: o cálculo precisa da data de nascimento" };
    return { ...base, status: `Aguardando medidas: ${(result.missing ?? []).map((site) => SITE_LABEL[site]).join(", ")}` };
  }
  if (result.status === "invalid") return { ...base, status: "Valores fora do possível: confira as medidas" };
  const variant = PROTOCOL_VARIANTS[protocol][form.equation === "not_selected" ? "male" : form.equation];
  const text = withoutStop(variant.validation.text);
  const flag = result.flags.includes("outside_validation_population")
    ? `Fora da faixa original de validação (${text})`
    : result.flags.includes("validation_age_unknown")
      ? `Sem idade para conferir a faixa original de validação (${text})`
      : result.flags.includes("requires_professional_validation")
        ? `Validação: ${text}`
        : null;
  return {
    ...base,
    sum: `${one.format(result.sumMm)} mm`,
    fatPercent: `${one.format(result.bodyFatPercent)}%`,
    fatMass: result.fatMassKg === null ? null : `${one.format(result.fatMassKg)} kg`,
    fatFree: result.fatFreeMassKg === null ? null : `${one.format(result.fatFreeMassKg)} kg`,
    flag,
  };
}

/* ---------- Perimeters: the waist-hip ratio and the bilateral difference ---------- */

const ratio = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const centimetresText = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** A typed centimetre value, or null when empty or not a positive number (the screen names the problem elsewhere). */
function typedCentimetres(text: string | undefined): number | null {
  const value = numberFromText(text ?? "");
  return value !== null && Number.isFinite(value) && value > 0 && value <= MAX_MEASURE ? value : null;
}

/** The waist-hip ratio of the screen (handoff 5: waist ÷ hip, both valid), or what is missing. Never a classification. */
export function waistHipPreview(form: CompositionForm): { value: string | null; status: string } {
  const waist = typedCentimetres(form.perimeters.waist);
  const hip = typedCentimetres(form.perimeters.hip);
  const value = waistHipRatio(waist, hip);
  if (value !== null) return { value: ratio.format(value), status: "Cintura ÷ quadril" };
  if (waist === null && hip === null) return { value: null, status: "Precisa da cintura e do quadril" };
  return { value: null, status: waist === null ? "Falta a cintura" : "Falta o quadril" };
}

/**
 * The bilateral difference in words (handoff 3.2 and 5): the convention right − left, the absolute value and which side is larger. No
 * "significant" or "not significant": there is no validated reference for it (handoff 11).
 */
export function bilateralText(differenceCm: number): string {
  return `D − E = ${bilateralSigned(differenceCm)}: ${bilateralObservation(differenceCm)}`;
}

/** Below half a hundredth the sides are equal: 56 − 56,6 is −0,600000…1 in floating point, and the screens show two decimals at most. */
const isEqual = (differenceCm: number) => Math.abs(differenceCm) < 0.005;

/** Between a number and its unit, so "cm" never wraps alone to the next line. */
const NBSP = "\u00a0";

/** The difference with its sign (convention right − left): "+1,25 cm", "−0,6 cm", "0 cm". */
export function bilateralSigned(differenceCm: number): string {
  if (isEqual(differenceCm)) return `0${NBSP}cm`;
  return `${differenceCm > 0 ? "+" : "−"}${centimetresText.format(Math.abs(differenceCm))}${NBSP}cm`;
}

/** Which side is larger and by how much (the absolute value), or equal sides. */
export function bilateralObservation(differenceCm: number): string {
  if (isEqual(differenceCm)) return "lados iguais";
  return `${differenceCm > 0 ? "direito" : "esquerdo"} maior em ${centimetresText.format(Math.abs(differenceCm))}${NBSP}cm`;
}

/** The note under a sided perimeter: the difference when both sides are measured, the missing side when only one is, or nothing. */
export function bilateralNote(pair: { right: string; left: string } | undefined): string | null {
  const right = typedCentimetres(pair?.right);
  const left = typedCentimetres(pair?.left);
  if (right === null && left === null) return null;
  if (right === null) return "Falta o lado direito";
  if (left === null) return "Falta o lado esquerdo";
  return bilateralText(right - left);
}
