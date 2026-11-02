/**
 * The "Medidas" step of the new assessment (module "composition", handoff V2 sections 3.2 and 4): what is stored, how the screen's text becomes
 * it, and the preview calculated from it. Pure: no screen and no database here, so the server checks a save with the same rules the screen uses.
 *
 * A measure not taken is absent (null or no readings), never 0. Changing the protocol never deletes what was typed in the other sites.
 */
import { z } from "zod";
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
    aggregation: z.enum(AGGREGATIONS).default("mean"),
    conversion: z.literal("siri_1961").default("siri_1961"),
    skinfolds: z.partialRecord(z.enum(SKINFOLD_SITE_CODES), readings).default({}),
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
  aggregation: AggregationRule;
  /** Up to three readings per site, as typed; a site with no entry was not measured. */
  skinfolds: Partial<Record<SkinfoldSite, string[]>>;
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
    aggregation: payload.aggregation,
    skinfolds: Object.fromEntries(Object.entries(payload.skinfolds).map(([site, values]) => [site, values.map((value) => decimalText(value))])),
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
  const candidate = {
    weightKg: read("weightKg", numberFromText(form.weight)),
    heightCm: read("heightCm", heightFromText(form.height)),
    systolicMmHg: read("systolicMmHg", numberFromText(form.systolic)),
    diastolicMmHg: read("diastolicMmHg", numberFromText(form.diastolic)),
    restingHeartRateBpm: read("restingHeartRateBpm", numberFromText(form.heartRate)),
    protocol: form.protocol,
    equation: form.equation,
    aggregation: form.aggregation,
    conversion: "siri_1961" as const,
    skinfolds,
  };
  if (problems.length > 0) return { payload: null, problems };
  return { payload: compositionSchema.parse(candidate), problems: [] };
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
