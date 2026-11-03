/**
 * The "Revisão" step and the finalize of the Avaliação Física (handoff V2 sections 2, 4, 6 and 7; slice 0.77): what each module holds, what still
 * blocks the finalize, and the results that will be recorded, computed with the versioned formulas. Pure: the screen shows exactly what the server
 * will record, because both call `reviewDraft` with the same payloads.
 *
 * Nothing is invented: a result that cannot be computed (no protocol, a missing site, no birth date...) is not recorded and the reason is said; a
 * value is never a 0 for "not measured"; there is no classification (none is homologated). The PAR-Q never decides: a "Sim" asks for the
 * professional's decision, recorded with who and when at finalize.
 */
import { ANAMNESIS, GOALS, PARQ_DECISIONS } from "../catalog";
import {
  FORMULA_VERSION,
  PROTOCOL_VARIANTS,
  SKINFOLD_SITE_CODES,
  ageOn,
  bmi,
  bodyComposition,
  selectedValue,
  type SiteValues,
  type SkinfoldSite,
} from "../formulas";
import { AGGREGATION_LABEL, EQUATION_LABEL, PROTOCOL_CHIP, SITE_LABEL, requiredSites, type CompositionPayload } from "./composition";
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

/** One row of assessment_results, as it will be written (code, value, unit, method, formula version, inputs and flags). */
export interface ResultDraft {
  code: ResultCode;
  value: number;
  unit: string;
  method: string;
  formulaVersion: string;
  inputs: Record<string, unknown>;
  flags: string[];
}
export const RESULT_CODES = ["sum_skinfolds", "body_density", "body_fat_percent", "fat_mass_kg", "lean_mass_kg", "bmi"] as const;
export type ResultCode = (typeof RESULT_CODES)[number];

export const RESULT_LABEL: Record<string, string> = {
  sum_skinfolds: "Soma das dobras",
  body_density: "Densidade corporal",
  body_fat_percent: "Gordura estimada",
  fat_mass_kg: "Massa gorda",
  lean_mass_kg: "Massa livre de gordura",
  bmi: "IMC",
  waist_hip_ratio: "RCQ",
};

/** The method of a result in words: the protocol and the reference of its equation, or how it was obtained. */
export function methodLabel(method: string): string {
  if (method === "legacy_formula_unknown") return "método desconhecido";
  if (method === "weight_over_height_squared") return "peso ÷ altura²";
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

const DIGITS: Record<string, number> = { sum_skinfolds: 1, body_density: 4, body_fat_percent: 1, fat_mass_kg: 1, lean_mass_kg: 1, bmi: 2, waist_hip_ratio: 3 };

/** A value as the screens show it (rounded only here; the record keeps the full precision), with its unit. */
export function formatResult(code: string, value: number, unit: string | null): string {
  const digits = DIGITS[code] ?? 2;
  const text = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: code === "bmi" ? 2 : 0, maximumFractionDigits: digits }).format(value);
  if (!unit) return text;
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

/** One module of the review: what it holds, in words, and whether it is done, partial, or was not done (never a 0). */
export interface ModuleSummary {
  key: "triagem" | "medidas" | "movimento";
  title: string;
  state: "ready" | "pending" | "partial" | "filled" | "not_done";
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
  assessedOn: string;
  /** From the snapshot the draft took of the student's file. */
  birthDate: string | null;
  /** For an amendment (retificação): the screening of the assessment it amends, as recorded. */
  original?: { screening: ScreeningPayload | null } | null;
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

function compositionResults(composition: CompositionPayload, ageYears: number | null): { results: ResultDraft[]; notComputed: string[] } {
  const results: ResultDraft[] = [];
  const notComputed: string[] = [];
  const index = bmi(composition.weightKg, composition.heightCm);
  if (index !== null)
    results.push({
      code: "bmi",
      value: index,
      unit: "kg/m²",
      method: "weight_over_height_squared",
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
  } else notComputed.push("Massa gorda e massa livre de gordura: falta o peso");
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

function medidasSummary(composition: CompositionPayload | null): ModuleSummary {
  if (!composition) return { key: "medidas", title: "Medidas", state: "not_done", lines: ["Não realizado"] };
  const lines: string[] = [];
  const basics = [
    composition.weightKg !== null ? `peso ${decimal(composition.weightKg)} kg` : null,
    composition.heightCm !== null ? `altura ${decimal(composition.heightCm / 100)} m` : null,
    composition.systolicMmHg !== null || composition.diastolicMmHg !== null
      ? `PAS/PAD ${composition.systolicMmHg !== null ? decimal(composition.systolicMmHg) : "sem aferição"} / ${composition.diastolicMmHg !== null ? decimal(composition.diastolicMmHg) : "sem aferição"} mmHg`
      : null,
    composition.restingHeartRateBpm !== null ? `FC repouso ${decimal(composition.restingHeartRateBpm)} bpm` : null,
  ].filter((item): item is string => item !== null);
  lines.push(basics.length === 0 ? "Medidas básicas: sem aferição" : `Medidas básicas: ${basics.join(" · ")}`);
  const measured = SKINFOLD_SITE_CODES.filter((site) => (composition.skinfolds[site] ?? []).length > 0);
  if (composition.protocol) {
    const required = requiredSites(composition.protocol, composition.equation);
    lines.push(
      `Protocolo: ${PROTOCOL_CHIP[composition.protocol]} · equação ${EQUATION_LABEL[composition.equation].toLowerCase()} · ${AGGREGATION_LABEL[composition.aggregation].toLowerCase()}`,
    );
    lines.push(`Dobras do protocolo: ${required.filter((site) => measured.includes(site)).length} de ${required.length} medidas`);
  } else lines.push("Protocolo de dobras: não escolhido");
  const extra = composition.protocol ? measured.filter((site) => !requiredSites(composition.protocol, composition.equation).includes(site)) : measured;
  if (extra.length > 0) lines.push(`Outras dobras guardadas: ${list(extra.map((site) => SITE_LABEL[site]))}`);
  const empty = basics.length === 0 && measured.length === 0 && composition.protocol === null;
  return { key: "medidas", title: "Medidas", state: empty ? "not_done" : "filled", lines: empty ? ["Não realizado"] : lines };
}

/**
 * The review of a draft: what blocks the finalize (the triagem: every PAR-Q question answered and, with any "Sim", the professional's decision with
 * a note; for an amendment with a new "Sim", that decision looked at again), the results that will be recorded, and why the others are not.
 */
export function reviewDraft(input: ReviewInput): DraftReview {
  const pending = input.screening ? screeningPending(input.screening) : screeningPending(EMPTY_SCREENING);
  if (input.screening && input.original) pending.push(...amendmentPending(input.screening, input.original.screening));
  const ageYears = ageOn(input.birthDate, input.assessedOn);
  const computed = input.composition ? compositionResults(input.composition, ageYears) : { results: [], notComputed: [] };
  return {
    pending,
    results: computed.results,
    notComputed: computed.notComputed,
    riskFlag: input.screening ? parqHasYes(input.screening) : false,
    modules: [
      triagemSummary(input.profile, input.screening, pending),
      medidasSummary(input.composition),
      { key: "movimento", title: "Movimento", state: "not_done", lines: ["Não realizado: esta etapa chega numa próxima versão"] },
    ],
  };
}

/** The screening as it is recorded: the derived flag of any "Sim", and who recorded the decision and when (only when there is one). */
export function recordedScreening(screening: ScreeningPayload, reviewerUserId: string, at: string): ScreeningPayload {
  const review = screening.parq.professionalReview;
  return {
    ...screening,
    parq: {
      ...screening.parq,
      riskFlag: parqHasYes(screening),
      professionalReview: review.decision === null ? { decision: null, notes: review.notes } : { decision: review.decision, notes: review.notes, reviewedAt: at, reviewerUserId },
    },
  };
}
