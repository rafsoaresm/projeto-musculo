/**
 * The "Revisão" step and the finalize of the Avaliação Física (handoff V2 sections 2, 4, 6 and 7; slice 0.77): what each module holds, what still
 * blocks the finalize, and the results that will be recorded, computed with the versioned formulas. Pure: the screen shows exactly what the server
 * will record, because both call `reviewDraft` with the same payloads.
 *
 * Nothing is invented: a result that cannot be computed (no protocol, a missing site, no birth date...) is not recorded and the reason is said; a
 * value is never a 0 for "not measured"; there is no classification (none is homologated). The PAR-Q never decides: a "Sim" asks for the
 * professional's decision, recorded with who and when at finalize.
 */
import {
  ANAMNESIS,
  BONE_BREADTH_CODES,
  GOALS,
  HEATH_CARTER_MEASURES,
  PARQ_DECISIONS,
  PERIMETERS_SIDED_OF,
  POSTURE_REGIONS,
  POSTURE_VIEW_CODES,
  POSTURE_VIEW_SHORT,
  PERIMETER_SIDED_CODES,
  PERIMETER_SINGLE_CODES,
  PERIMETERS_SIDED,
  type PerimeterSided,
} from "../catalog";
import {
  FORMULA_VERSION,
  PROTOCOL_VARIANTS,
  SKINFOLD_SITE_CODES,
  ageOn,
  bilateralDifference,
  bmi,
  bodyComposition,
  cooper,
  selectedValue,
  waistHipRatio,
  type SiteValues,
  type SkinfoldSite,
} from "../formulas";
import { AGGREGATION_LABEL, EQUATION_LABEL, PROTOCOL_CHIP, SITE_LABEL, bilateralObservation, bilateralSigned, requiredSites, type CompositionPayload } from "./composition";
import { heathCarterTyped, observedIn, postureEmpty, regionsOf, somatotypeText, type PosturePayload } from "./posture";
import { FLEXITEST_CODES, FLEXITEST_VARIANT, filledText, flexitestTally, movementEmpty, type MovementPayload } from "./flexitest";
import { COOPER_MINUTES, REPETITION_TESTS, TEST_TITLE, cooperEmpty, repetitionTestEmpty, testsEmpty, type RepetitionTestKey, type TestsPayload } from "./physical-tests";
import {
  ANAMNESIS_CODES,
  EMPTY_SCREENING,
  PARQ_CODES,
  parqAnswer,
  parqHasYes,
  screeningPending,
  type ParqCode,
  type ProfilePayload,
  type ScreeningPayload,
} from "./screening";
import { NOT_INCLUDED, excludedPartsOf, isPartEnabled, isStepEnabled, maskComposition, maskMovement, maskPosture, maskTests, notIncludedLine, stepOrderOf, type EnabledParts } from "./template";

/** One row of assessment_results, as it will be written (code, value, unit, method, formula version, inputs and flags). */
export interface ResultDraft {
  code: ResultCode;
  value: number;
  /** Null for a ratio (no unit). */
  unit: string | null;
  method: string;
  formulaVersion: string;
  inputs: Record<string, unknown>;
  flags: string[];
}
/** The code of the bilateral difference of a sided perimeter (handoff 5: right − left). */
export const bilateralCode = (code: PerimeterSided) => `bilateral_difference_${code}` as const;
export const RESULT_CODES = [
  "sum_skinfolds",
  "body_density",
  "body_fat_percent",
  "fat_mass_kg",
  "lean_mass_kg",
  "bmi",
  "waist_hip_ratio",
  ...PERIMETER_SIDED_CODES.map(bilateralCode),
  "flexitest_total",
  "cooper_speed_kmh",
  "cooper_vo2_estimate",
] as const;
export type ResultCode =
  | "sum_skinfolds"
  | "body_density"
  | "body_fat_percent"
  | "fat_mass_kg"
  | "lean_mass_kg"
  | "bmi"
  | "waist_hip_ratio"
  | ReturnType<typeof bilateralCode>
  | "flexitest_total"
  | "cooper_speed_kmh"
  | "cooper_vo2_estimate";
/** How each computed-by-arithmetic result is obtained (no equation from a study, so never "estimativa"). */
export const EXACT_METHODS = {
  bmi: "weight_over_height_squared",
  waistHip: "waist_over_hip",
  bilateral: "right_minus_left",
  flexitest: "flexitest_sum_of_15_levels",
  cooperSpeed: "cooper_distance_over_200",
} as const;
/** The estimate of VO₂max from the Cooper distance (handoff 5: `(distancia_m - 504.9) / 44.73`, a reference equation; the result is an estimate). */
export const COOPER_VO2_METHOD = "cooper_12min_vo2_504_9_44_73";
const EXACT_METHOD_SET: ReadonlySet<string> = new Set(Object.values(EXACT_METHODS));
/** A result whose method is arithmetic on measures (BMI, waist-hip ratio, bilateral difference) or unknown: not an estimate of a study's equation. */
export const isEstimate = (method: string) => method !== "legacy_formula_unknown" && !EXACT_METHOD_SET.has(method);
/** Whether a recorded result is an estimate: the sum of skinfolds carries the protocol as its method but is the sum of the measured folds, not an estimate. */
export const isResultEstimate = (code: string, method: string) => code !== "sum_skinfolds" && isEstimate(method);

export const RESULT_LABEL: Record<string, string> = {
  sum_skinfolds: "Soma das dobras",
  body_density: "Densidade corporal",
  body_fat_percent: "Gordura estimada",
  fat_mass_kg: "Massa gorda",
  lean_mass_kg: "Massa livre de gordura",
  bmi: "IMC",
  waist_hip_ratio: "RCQ",
  flexitest_total: "Flexiteste, soma dos 15 níveis",
  cooper_speed_kmh: "Cooper, velocidade média",
  cooper_vo2_estimate: "Cooper, VO₂máx estimado",
  ...Object.fromEntries(PERIMETER_SIDED_CODES.map((code) => [bilateralCode(code), `Diferença bilateral ${PERIMETERS_SIDED_OF[code]}`])),
};

/** The method of a result in words: the protocol and the reference of its equation, or how it was obtained. */
export function methodLabel(method: string): string {
  if (method === "legacy_formula_unknown") return "método desconhecido";
  if (method === EXACT_METHODS.bmi) return "peso ÷ altura²";
  if (method === EXACT_METHODS.waistHip) return "cintura ÷ quadril";
  if (method === EXACT_METHODS.bilateral) return "direito − esquerdo";
  if (method === EXACT_METHODS.flexitest) return "soma dos níveis, 15 movimentos de 1 a 4";
  if (method === EXACT_METHODS.cooperSpeed) return "distância ÷ 200 (12 min)";
  if (method === COOPER_VO2_METHOD) return "Cooper 12 min, (distância − 504,9) ÷ 44,73";
  for (const protocol of Object.keys(PROTOCOL_VARIANTS) as (keyof typeof PROTOCOL_VARIANTS)[]) {
    const variants = PROTOCOL_VARIANTS[protocol];
    if (variants.male.id === method && variants.female.id === method) return PROTOCOL_CHIP[protocol];
    if (variants.male.id === method) return `${PROTOCOL_CHIP[protocol]}, equação masculina`;
    if (variants.female.id === method) return `${PROTOCOL_CHIP[protocol]}, equação feminina`;
  }
  return method;
}

export const FLAG_LABEL: Record<string, string> = {
  outside_validation_population: "Fora da faixa original de validação",
  validation_age_unknown: "Sem idade para conferir a faixa original de validação",
  requires_professional_validation: "Exige validação pelo profissional",
  legacy_formula_unknown: "Método desconhecido (formato anterior)",
};

const DIGITS: Record<string, number> = {
  sum_skinfolds: 1,
  body_density: 4,
  body_fat_percent: 1,
  fat_mass_kg: 1,
  lean_mass_kg: 1,
  bmi: 2,
  waist_hip_ratio: 3,
  flexitest_total: 0,
  cooper_speed_kmh: 1,
  cooper_vo2_estimate: 2,
};
const MIN_DIGITS: Record<string, number> = { bmi: 2, waist_hip_ratio: 3, cooper_speed_kmh: 1, cooper_vo2_estimate: 2 };

/** Decimal places a result is shown with, at most (a bilateral difference in cm has two). */
export const resultDigits = (code: string): number => (code.startsWith("bilateral_difference_") ? 2 : (DIGITS[code] ?? 2));

/** A value as the screens show it (rounded only here; the record keeps the full precision), with its unit. */
export function formatResult(code: string, value: number, unit: string | null): string {
  if (code.startsWith("bilateral_difference_")) return bilateralSigned(value);
  const digits = DIGITS[code] ?? 2;
  const text = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: MIN_DIGITS[code] ?? 0, maximumFractionDigits: digits }).format(value);
  if (!unit) return text;
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

/** A line that reads the value (the larger side of a bilateral difference, its absolute value), or null. Never a classification. */
export function resultNote(code: string, value: number | null): string | null {
  if (value === null || !code.startsWith("bilateral_difference_")) return null;
  return bilateralObservation(value);
}

/** One module of the review: what it holds, in words, and whether it is done, partial, or was not done (never a 0). */
export interface ModuleSummary {
  key: "triagem" | "medidas" | "movimento" | "testes";
  title: string;
  /** "not_included": the draft's model leaves the whole step out (slice 0.85), which is not "not_done". */
  state: "ready" | "pending" | "partial" | "filled" | "observed" | "not_done" | "not_included";
  lines: string[];
}

export interface DraftReview {
  /** What blocks the finalize, in words. Empty: the assessment can be finalized. */
  pending: string[];
  /** The results that will be recorded. */
  results: ResultDraft[];
  /** Why a result is not recorded (it is not computable yet); never a blocker: Medidas may be partial. */
  notComputed: string[];
  /** Any PAR-Q "Sim" (handoff 6: parq.riskFlag). */
  riskFlag: boolean;
  modules: ModuleSummary[];
}

export interface ReviewInput {
  profile: ProfilePayload | null;
  screening: ScreeningPayload | null;
  composition: CompositionPayload | null;
  /** The "Movimento" step (module "posture"): posture and somatotype. Absent or null: not done. */
  posture?: PosturePayload | null;
  /** The Flexiteste of the "Movimento" step (module "movement"). Absent or null: not done. */
  movement?: MovementPayload | null;
  /** The "Testes físicos" step (module "tests"). Absent or null: not done. */
  tests?: TestsPayload | null;
  assessedOn: string;
  /** From the snapshot the draft took of the student's file. */
  birthDate: string | null;
  /** For an amendment (retificação): the screening of the assessment it amends, as recorded. */
  original?: { screening: ScreeningPayload | null } | null;
  /** The optional parts the draft's model has on (slice 0.85); absent or null: every part. A part that is off is never read. */
  enabled?: EnabledParts;
}

const decimal = (value: number, digits = 2) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`);

/** The PAR-Q answers that are "Sim" in the amendment and were not "Sim" in the assessment it amends. */
export function newYesAnswers(screening: ScreeningPayload, original: ScreeningPayload | null): ParqCode[] {
  return PARQ_CODES.filter((code) => parqAnswer(screening, code) === "yes" && (original === null || parqAnswer(original, code) !== "yes"));
}

function amendmentPending(screening: ScreeningPayload, original: ScreeningPayload | null): string[] {
  const fresh = newYesAnswers(screening, original);
  if (fresh.length === 0 || original === null) return [];
  const before = original.parq.professionalReview;
  const now = screening.parq.professionalReview;
  // The decision was about the answers of the original: a new "Sim" asks for it to be looked at again (decision 3 of the user).
  if (now.decision === before.decision && now.notes.trim() === before.notes.trim())
    return ["Retificação com nova resposta “Sim” no PAR-Q: revise a decisão profissional e a nota"];
  return [];
}

/** The selected value of each site with its readings, as the formulas take them (a site with no reading is absent). */
function siteValues(composition: CompositionPayload): { values: SiteValues; readings: Partial<Record<SkinfoldSite, number[]>>; manyForSingle: SkinfoldSite[] } {
  const values: SiteValues = {};
  const readings: Partial<Record<SkinfoldSite, number[]>> = {};
  const manyForSingle: SkinfoldSite[] = [];
  for (const site of SKINFOLD_SITE_CODES) {
    const typed = composition.skinfolds[site];
    if (!typed || typed.length === 0) continue;
    readings[site] = typed;
    if (composition.aggregation === "single" && typed.length > 1) manyForSingle.push(site);
    values[site] = selectedValue(typed, composition.aggregation);
  }
  return { values, readings, manyForSingle };
}

/** `basicsOn` false: the model leaves the weight out, so the masses are said to need a part not in the model (never a "falta" the professional cannot fill). */
function compositionResults(composition: CompositionPayload, ageYears: number | null, basicsOn = true): { results: ResultDraft[]; notComputed: string[] } {
  const results: ResultDraft[] = [];
  const notComputed: string[] = [];
  const index = bmi(composition.weightKg, composition.heightCm);
  if (index !== null)
    results.push({
      code: "bmi",
      value: index,
      unit: "kg/m²",
      method: EXACT_METHODS.bmi,
      formulaVersion: FORMULA_VERSION,
      inputs: { weightKg: composition.weightKg, heightCm: composition.heightCm },
      flags: [],
    });
  else if (composition.weightKg !== null || composition.heightCm !== null)
    notComputed.push(`IMC: falta ${composition.weightKg === null ? "o peso" : "a altura"}`);

  const protocol = composition.protocol;
  const { values, readings, manyForSingle } = siteValues(composition);
  if (protocol === null) {
    if (Object.keys(readings).length > 0) notComputed.push("Gordura estimada: escolha o protocolo de dobras");
    return { results, notComputed };
  }
  const required = requiredSites(protocol, composition.equation);
  const single = manyForSingle.filter((site) => required.includes(site));
  if (single.length > 0) {
    notComputed.push(`Gordura estimada: com “Leitura única”, deixe uma só leitura em ${list(single.map((site) => SITE_LABEL[site]))}`);
    return { results, notComputed };
  }
  const outcome = bodyComposition({ protocol, equation: composition.equation, ageYears, weightKg: composition.weightKg, sites: values, conversion: composition.conversion });
  if (outcome.status === "pending") {
    if (outcome.reason === "equation_not_selected") notComputed.push("Gordura estimada: escolha a referência da equação");
    else if (outcome.reason === "missing_age") notComputed.push("Gordura estimada: sem idade, falta a data de nascimento no cadastro");
    else notComputed.push(`Gordura estimada: aguardando medidas de ${list((outcome.missing ?? []).map((site) => SITE_LABEL[site]))}`);
    return { results, notComputed };
  }
  if (outcome.status === "invalid") {
    notComputed.push("Gordura estimada: valores fora do possível, confira as medidas");
    return { results, notComputed };
  }
  const variant = PROTOCOL_VARIANTS[protocol][composition.equation === "not_selected" ? "male" : composition.equation];
  const sites = Object.fromEntries(variant.sites.map((site) => [site, values[site]]));
  const siteReadings = Object.fromEntries(variant.sites.map((site) => [site, readings[site]]));
  const inputs = {
    protocol,
    variant: outcome.variant,
    equation: composition.equation,
    aggregation: composition.aggregation,
    conversion: outcome.conversion,
    ageYears,
    weightKg: composition.weightKg,
    sitesMm: sites,
    readingsMm: siteReadings,
  };
  const row = (code: ResultCode, value: number, unit: string): ResultDraft => ({ code, value, unit, method: outcome.variant, formulaVersion: outcome.formulaVersion, inputs, flags: [...outcome.flags] });
  results.push(row("sum_skinfolds", outcome.sumMm, "mm"));
  if (outcome.density !== null) results.push(row("body_density", outcome.density, "g/cm³"));
  results.push(row("body_fat_percent", outcome.bodyFatPercent, "%"));
  if (outcome.fatMassKg !== null && outcome.fatFreeMassKg !== null) {
    results.push(row("fat_mass_kg", outcome.fatMassKg, "kg"));
    results.push(row("lean_mass_kg", outcome.fatFreeMassKg, "kg"));
  } else
    notComputed.push(
      basicsOn ? "Massa gorda e massa livre de gordura: falta o peso" : `Massa gorda e massa livre de gordura: pedem o peso (${notIncludedLine("basics")})`,
    );
  return { results, notComputed };
}

/**
 * What the perimeters give (handoff 3.2 and 5): the waist-hip ratio when both are measured, and the bilateral difference (right − left) of each
 * sided perimeter with both sides. Plain arithmetic on the measures, versioned like every result; no classification and no "significant" (none
 * is homologated: handoff 11). The bone breadths give no result in this version: they are kept as measured.
 */
function perimeterResults(composition: CompositionPayload): { results: ResultDraft[]; notComputed: string[] } {
  const results: ResultDraft[] = [];
  const notComputed: string[] = [];
  const waist = composition.perimetersCm.waist ?? null;
  const hip = composition.perimetersCm.hip ?? null;
  const index = waistHipRatio(waist, hip);
  if (index !== null)
    results.push({ code: "waist_hip_ratio", value: index, unit: null, method: EXACT_METHODS.waistHip, formulaVersion: FORMULA_VERSION, inputs: { waistCm: waist, hipCm: hip }, flags: [] });
  else if (waist !== null || hip !== null) notComputed.push(`RCQ: falta ${waist === null ? "a cintura" : "o quadril"}`);
  for (const code of PERIMETER_SIDED_CODES) {
    const pair = composition.sidedPerimetersCm[code];
    if (!pair) continue;
    const difference = bilateralDifference(pair.right, pair.left);
    if (difference !== null)
      results.push({
        code: bilateralCode(code),
        value: difference,
        unit: "cm",
        method: EXACT_METHODS.bilateral,
        formulaVersion: FORMULA_VERSION,
        inputs: { rightCm: pair.right, leftCm: pair.left, convention: "right_minus_left" },
        flags: [],
      });
    else notComputed.push(`Diferença bilateral ${PERIMETERS_SIDED_OF[code]}: falta o lado ${pair.right === null ? "direito" : "esquerdo"}`);
  }
  return { results, notComputed };
}

/**
 * What the Flexiteste gives (handoff 3.4 and 5): the sum of the 15 levels, only when all 15 are filled — a partial sum is never a total. Plain
 * arithmetic, versioned; no classification (the PDF gives no table: handoff 3.4).
 */
function flexitestResults(movement: MovementPayload): { results: ResultDraft[]; notComputed: string[] } {
  const tally = flexitestTally(movement);
  if (tally.total !== null)
    return {
      results: [
        {
          code: "flexitest_total",
          value: tally.total,
          unit: "pontos",
          method: EXACT_METHODS.flexitest,
          formulaVersion: FORMULA_VERSION,
          inputs: { variant: FLEXITEST_VARIANT, levels: Object.fromEntries(FLEXITEST_CODES.map((code) => [code, movement.flexitest.levels[code]])) },
          flags: [],
        },
      ],
      notComputed: [],
    };
  if (tally.filled === 0) return { results: [], notComputed: [] };
  return { results: [], notComputed: [`Flexiteste: o total só existe com os ${FLEXITEST_CODES.length} movimentos (${filledText(tally.filled)})`] };
}

/**
 * What the Cooper test gives (handoff 3.5 and 5): the average speed over the fixed 12 minutes (distance ÷ 200, arithmetic) and the estimated VO₂max
 * by the documented equation, versioned and said to be an estimate. A distance for which the equation gives no positive value records no VO₂.
 */
function cooperResults(tests: TestsPayload): { results: ResultDraft[]; notComputed: string[] } {
  const distanceM = tests.cooper.distanceM;
  const outcome = cooper(distanceM);
  if (outcome === null || distanceM === null) return { results: [], notComputed: [] };
  const inputs = { distanceM, durationMin: COOPER_MINUTES, testedOn: tests.cooper.testedOn };
  const results: ResultDraft[] = [
    { code: "cooper_speed_kmh", value: outcome.speedKmh, unit: "km/h", method: EXACT_METHODS.cooperSpeed, formulaVersion: outcome.formulaVersion, inputs, flags: [] },
  ];
  const notComputed: string[] = [];
  if (outcome.vo2Estimate > 0)
    results.push({ code: "cooper_vo2_estimate", value: outcome.vo2Estimate, unit: "ml/kg/min", method: COOPER_VO2_METHOD, formulaVersion: outcome.formulaVersion, inputs, flags: [] });
  else notComputed.push("Cooper, VO₂máx estimado: com esta distância a equação não dá um valor positivo");
  return { results, notComputed };
}

function triagemSummary(profile: ProfilePayload | null, screening: ScreeningPayload | null, pending: string[]): ModuleSummary {
  const lines: string[] = [];
  const goals = profile?.goals ?? [];
  lines.push(goals.length === 0 ? "Objetivos: nenhum selecionado" : `Objetivos: ${goals.map((code) => GOALS[code]).join(", ")}`);
  if (screening) {
    const answered = ANAMNESIS_CODES.filter((code) => screening.anamnesis[code]?.answer);
    const yes = ANAMNESIS_CODES.filter((code) => screening.anamnesis[code]?.answer === "yes");
    lines.push(
      `Anamnese: ${answered.length} de ${ANAMNESIS_CODES.length} respondidas${yes.length > 0 ? `; Sim em ${list(yes.map((code) => ANAMNESIS[code].toLowerCase()))}` : ""}`,
    );
    const { current, past } = screening.activity;
    lines.push(`Atividade física atual: ${current.practices === "yes" ? "pratica" : current.practices === "no" ? "não pratica" : "sem resposta"}`);
    lines.push(`Atividade física passada: ${past.practiced === "yes" ? "praticou" : past.practiced === "no" ? "não praticou" : "sem resposta"}`);
    const answeredParq = PARQ_CODES.filter((code) => parqAnswer(screening, code) !== "unanswered").length;
    const yesParq = PARQ_CODES.filter((code) => parqAnswer(screening, code) === "yes").length;
    lines.push(`PAR-Q: ${answeredParq} de ${PARQ_CODES.length} respondidas; ${yesParq === 0 ? "nenhum “Sim”" : `${yesParq} com “Sim”`}`);
    const decision = screening.parq.professionalReview.decision;
    if (decision) lines.push(`Decisão profissional: ${PARQ_DECISIONS[decision]}`);
  } else lines.push("Anamnese, atividade e PAR-Q: não preenchidos");
  return { key: "triagem", title: "Triagem", state: pending.length === 0 ? "ready" : "pending", lines };
}

function medidasSummary(composition: CompositionPayload | null, enabled: EnabledParts = null): ModuleSummary {
  if (!isStepEnabled(enabled, "medidas")) return { key: "medidas", title: "Medidas", state: "not_included", lines: [NOT_INCLUDED] };
  const excluded = excludedPartsOf(enabled, "medidas").map(notIncludedLine);
  if (!composition) return { key: "medidas", title: "Medidas", state: "not_done", lines: ["Não realizado", ...excluded] };
  const on = (part: "basics" | "skinfolds" | "perimeters" | "breadths") => isPartEnabled(enabled, part);
  const lines: string[] = [];
  const basics = [
    composition.weightKg !== null ? `peso ${decimal(composition.weightKg)} kg` : null,
    composition.heightCm !== null ? `altura ${decimal(composition.heightCm / 100)} m` : null,
    composition.systolicMmHg !== null || composition.diastolicMmHg !== null
      ? `PAS/PAD ${composition.systolicMmHg !== null ? decimal(composition.systolicMmHg) : "sem aferição"} / ${composition.diastolicMmHg !== null ? decimal(composition.diastolicMmHg) : "sem aferição"} mmHg`
      : null,
    composition.restingHeartRateBpm !== null ? `FC repouso ${decimal(composition.restingHeartRateBpm)} bpm` : null,
  ].filter((item): item is string => item !== null);
  if (!on("basics")) lines.push(notIncludedLine("basics"));
  else lines.push(basics.length === 0 ? "Medidas básicas: sem aferição" : `Medidas básicas: ${basics.join(" · ")}`);
  const measured = SKINFOLD_SITE_CODES.filter((site) => (composition.skinfolds[site] ?? []).length > 0);
  if (!on("skinfolds")) lines.push(notIncludedLine("skinfolds"));
  else if (composition.protocol) {
    const required = requiredSites(composition.protocol, composition.equation);
    lines.push(
      `Protocolo: ${PROTOCOL_CHIP[composition.protocol]} · equação ${EQUATION_LABEL[composition.equation].toLowerCase()} · ${AGGREGATION_LABEL[composition.aggregation].toLowerCase()}`,
    );
    lines.push(`Dobras do protocolo: ${required.filter((site) => measured.includes(site)).length} de ${required.length} medidas`);
  } else lines.push("Protocolo de dobras: não escolhido");
  const extra = composition.protocol ? measured.filter((site) => !requiredSites(composition.protocol, composition.equation).includes(site)) : measured;
  if (on("skinfolds") && extra.length > 0) lines.push(`Outras dobras guardadas: ${list(extra.map((site) => SITE_LABEL[site]))}`);
  // A sided perimeter counts as measured only with both sides; one with a single side is named apart, so "9 de 9" never hides a missing side.
  const sidedTyped = PERIMETER_SIDED_CODES.filter((code) => composition.sidedPerimetersCm[code] !== undefined);
  const oneSided = sidedTyped.filter((code) => {
    const pair = composition.sidedPerimetersCm[code]!;
    return pair.right === null || pair.left === null;
  });
  const complete = PERIMETER_SINGLE_CODES.filter((code) => composition.perimetersCm[code] !== undefined).length + sidedTyped.length - oneSided.length;
  const perimeters = complete + oneSided.length;
  const breadths = BONE_BREADTH_CODES.filter((code) => composition.boneBreadthsCm[code] !== undefined).length;
  const perimeterTotal = PERIMETER_SINGLE_CODES.length + PERIMETER_SIDED_CODES.length;
  const oneSidedText = oneSided.length > 0 ? ` · ${list(oneSided.map((code) => PERIMETERS_SIDED[code]))} só com um lado` : "";
  if (!on("perimeters")) lines.push(notIncludedLine("perimeters"));
  else lines.push(perimeters === 0 ? "Perímetros: sem aferição" : `Perímetros: ${complete} de ${perimeterTotal} com medida${oneSidedText}`);
  if (!on("breadths")) lines.push(notIncludedLine("breadths"));
  else lines.push(breadths === 0 ? "Diâmetros ósseos: sem aferição" : `Diâmetros ósseos: ${breadths} de ${BONE_BREADTH_CODES.length} com medida`);
  const empty = basics.length === 0 && measured.length === 0 && composition.protocol === null && perimeters === 0 && breadths === 0;
  if (empty && enabled !== null) return { key: "medidas", title: "Medidas", state: "not_done", lines: ["Não realizado", ...excluded] };
  return { key: "medidas", title: "Medidas", state: empty ? "not_done" : "filled", lines: empty ? ["Não realizado"] : lines };
}

/**
 * The "Movimento" step in words (slices 0.79 and 0.80): how many regions of each view were observed, the somatotype as the professional recorded
 * it, the Heath-Carter measures kept (never a computed somatotype), and how many Flexiteste movements have a level, with the total only when all 15
 * do. Nothing observed is "Não realizado", never "alinhado" nor 0.
 */
function movimentoSummary(posture: PosturePayload | null, movement: MovementPayload | null, enabled: EnabledParts = null): ModuleSummary {
  if (!isStepEnabled(enabled, "movimento")) return { key: "movimento", title: "Movimento", state: "not_included", lines: [NOT_INCLUDED] };
  const noPosture = !posture || postureEmpty(posture);
  const noFlexitest = !movement || movementEmpty(movement);
  const excluded = excludedPartsOf(enabled, "movimento").map(notIncludedLine);
  if (noPosture && noFlexitest) return { key: "movimento", title: "Movimento", state: "not_done", lines: ["Não realizado", ...excluded] };
  const lines: string[] = [];
  if (posture && !noPosture) lines.push(...postureLines(posture, enabled));
  else if (isPartEnabled(enabled, "posture") && isPartEnabled(enabled, "somatotype")) lines.push("Postura e somatotipo: não realizados");
  else if (isPartEnabled(enabled, "posture")) lines.push("Postura: não realizada");
  else if (isPartEnabled(enabled, "somatotype")) lines.push("Somatotipo: não realizado");
  lines.push(...excludedPartsOf(enabled, "movimento").filter((part) => part !== "flexitest").map(notIncludedLine));
  if (!isPartEnabled(enabled, "flexitest")) lines.push(notIncludedLine("flexitest"));
  else if (movement && !noFlexitest) {
    const tally = flexitestTally(movement);
    lines.push(`Flexiteste: ${filledText(tally.filled)}${tally.total !== null ? `; total ${tally.total} pontos` : ""}`);
    if (movement.flexitest.classificationManual.trim() !== "") lines.push(`Classificação do Flexiteste escrita pelo profissional: ${movement.flexitest.classificationManual.trim()}`);
  } else lines.push("Flexiteste: não realizado");
  return { key: "movimento", title: "Movimento", state: "observed", lines };
}

function postureLines(posture: PosturePayload, enabled: EnabledParts = null): string[] {
  const lines: string[] = [];
  if (isPartEnabled(enabled, "posture")) lines.push(...postureViewLines(posture));
  if (isPartEnabled(enabled, "somatotype")) lines.push(...somatotypeLines(posture));
  return lines;
}

function postureViewLines(posture: PosturePayload): string[] {
  const lines: string[] = [];
  const observed = POSTURE_VIEW_CODES.reduce((total, view) => total + observedIn(posture, view), 0);
  lines.push(
    observed === 0
      ? "Postura: nenhuma região observada"
      : `Postura: ${observed} de ${POSTURE_REGIONS.length} regiões observadas (${POSTURE_VIEW_CODES.map((view) => `${POSTURE_VIEW_SHORT[view].toLowerCase()} ${observedIn(posture, view)} de ${regionsOf(view).length}`).join(", ")})`,
  );
  const notes = POSTURE_VIEW_CODES.filter((view) => posture.notes[view].trim() !== "");
  if (notes.length > 0) lines.push(`Observações escritas: ${list(notes.map((view) => POSTURE_VIEW_SHORT[view].toLowerCase()))}`);
  return lines;
}

function somatotypeLines(posture: PosturePayload): string[] {
  const lines: string[] = [];
  const somatotype = somatotypeText(posture.somatotype.labels);
  lines.push(somatotype ? `Somatotipo (registro do profissional): ${somatotype}` : "Somatotipo: não registrado");
  const measures = heathCarterTyped(posture);
  if (measures.length > 0) lines.push(`Medidas para Heath-Carter guardadas, sem cálculo: ${list(measures.map((code) => HEATH_CARTER_MEASURES[code].label.toLowerCase()))}`);
  return lines;
}

/** The "Testes físicos" step in words (slice 0.80): what each test has, as typed; a test not done says so, never 0. No classification by the system. */
function testesSummary(tests: TestsPayload | null, enabled: EnabledParts = null): ModuleSummary {
  if (!isStepEnabled(enabled, "testes")) return { key: "testes", title: "Testes físicos", state: "not_included", lines: [NOT_INCLUDED] };
  const testOn = (key: RepetitionTestKey | "cooper") => isPartEnabled(enabled, key === "upperLimb" ? "upper_limb" : key);
  const excluded = excludedPartsOf(enabled, "testes").map(notIncludedLine);
  if (!tests || testsEmpty(tests)) return { key: "testes", title: "Testes físicos", state: "not_done", lines: ["Não realizado", ...excluded] };
  const lines: string[] = [];
  for (const key of REPETITION_TESTS) {
    const test = tests[key];
    if (!testOn(key)) lines.push(notIncludedLine(key === "upperLimb" ? "upper_limb" : key));
    else if (repetitionTestEmpty(test)) lines.push(`${TEST_TITLE[key]}: não realizado`);
    else
      lines.push(
        `${TEST_TITLE[key]}: ${test.repetitions === null ? "repetições sem registro" : `${test.repetitions} ${test.repetitions === 1 ? "repetição completa" : "repetições completas"}`}${test.exercise.trim() ? ` · ${test.exercise.trim()}` : ""}`,
      );
  }
  const cooperTest = tests.cooper;
  lines.push(
    !testOn("cooper")
      ? notIncludedLine("cooper")
      : cooperEmpty(cooperTest)
      ? "Cooper: não realizado"
      : `Cooper: ${cooperTest.distanceM === null ? "distância sem registro" : `${decimal(cooperTest.distanceM, 1)} m em ${COOPER_MINUTES} min`}`,
  );
  const classified = [...REPETITION_TESTS.map((key) => tests[key].classificationManual), cooperTest.classificationManual].some((value) => value.trim() !== "");
  if (classified) lines.push("Classificação: escrita pelo profissional (nenhuma tabela homologada)");
  return { key: "testes", title: "Testes físicos", state: "observed", lines };
}

/**
 * The review of a draft: what blocks the finalize (the triagem: every PAR-Q question answered and, with any "Sim", the professional's decision with
 * a note; for an amendment with a new "Sim", that decision looked at again), the results that will be recorded, and why the others are not.
 */
export function reviewDraft(input: ReviewInput): DraftReview {
  const pending = input.screening ? screeningPending(input.screening) : screeningPending(EMPTY_SCREENING);
  if (input.screening && input.original) pending.push(...amendmentPending(input.screening, input.original.screening));
  const ageYears = ageOn(input.birthDate, input.assessedOn);
  // A part the model leaves out is never read (it holds nothing: saving refuses it; this keeps the rule in one place).
  const enabled = input.enabled ?? null;
  input = {
    ...input,
    composition: input.composition ? maskComposition(input.composition, enabled) : null,
    posture: input.posture ? maskPosture(input.posture, enabled) : null,
    movement: input.movement ? maskMovement(input.movement, enabled) : null,
    tests: input.tests ? maskTests(input.tests, enabled) : null,
  };
  const skinfold = input.composition ? compositionResults(input.composition, ageYears, isPartEnabled(enabled, "basics")) : { results: [], notComputed: [] };
  const perimeter = input.composition ? perimeterResults(input.composition) : { results: [], notComputed: [] };
  const flexibility = input.movement ? flexitestResults(input.movement) : { results: [], notComputed: [] };
  const cooperTest = input.tests ? cooperResults(input.tests) : { results: [], notComputed: [] };
  const parts = [skinfold, perimeter, flexibility, cooperTest];
  const computed = { results: parts.flatMap((part) => part.results), notComputed: parts.flatMap((part) => part.notComputed) };
  return {
    pending,
    results: computed.results,
    notComputed: computed.notComputed,
    riskFlag: input.screening ? parqHasYes(input.screening) : false,
    // In the order of the model's steps, as the step chips show them (the steps it leaves out come after, in the default order).
    modules: [
      triagemSummary(input.profile, input.screening, pending),
      ...stepOrderOf(enabled).map((step) =>
        step === "medidas"
          ? medidasSummary(input.composition, enabled)
          : step === "movimento"
          ? movimentoSummary(input.posture ?? null, input.movement ?? null, enabled)
          : testesSummary(input.tests ?? null, enabled),
      ),
    ],
  };
}

/**
 * The screening as it is recorded: the derived flag of any "Sim", and who recorded the decision and when (only when there is one). An amendment
 * that carries the original's decision unchanged (same decision, same note) keeps the original's who and when: nobody decided it again, and the
 * amendment must not name its finalizer as the one who did.
 */
export function recordedScreening(screening: ScreeningPayload, reviewerUserId: string, at: string, original: ScreeningPayload | null = null): ScreeningPayload {
  const review = screening.parq.professionalReview;
  const before = original?.parq.professionalReview;
  const carried =
    review.decision !== null &&
    before !== undefined &&
    before.decision === review.decision &&
    before.notes.trim() === review.notes.trim() &&
    typeof before.reviewedAt === "string" &&
    typeof before.reviewerUserId === "string"
      ? { reviewedAt: before.reviewedAt, reviewerUserId: before.reviewerUserId }
      : { reviewedAt: at, reviewerUserId };
  return {
    ...screening,
    parq: {
      ...screening.parq,
      riskFlag: parqHasYes(screening),
      professionalReview: review.decision === null ? { decision: null, notes: review.notes } : { decision: review.decision, notes: review.notes, ...carried },
    },
  };
}
