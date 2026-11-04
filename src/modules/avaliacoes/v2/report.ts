/**
 * The report of a recorded Avaliação Física (handoff V2 sections 2, 6 and 9; Figma AV-06 "gerar PDF"), as a list of sections of plain lines that
 * the PDF draws. The same report goes to the professional and to the student (user's decision of 02/11/2026; no lock, decision of 03/11/2026).
 *
 * It prints what was recorded and nothing else: the raw measures, the results as they were computed at finalize (value, method, formula version,
 * flags; never recomputed with today's formulas), the professional's own texts. Something not measured reads "Sem aferição" or "Não realizado",
 * never 0. Slice 0.92: the classification of the body fat, BMI, waist-hip ratio, Flexiteste total and Cooper distance by the reference tables
 * the user sent, as written at finalize (a record made before the tables says so, never classified afterwards); the classification the
 * professional typed stays apart, said to be theirs.
 * The handoff asks for an institutional disclaimer ("não equivale a exame médico") reviewed by whoever is responsible and does not give its text,
 * so the report carries the neutral line `REPORT_NOTICE` instead (it says what the report does not do, without contradicting what it prints: the
 * raw measures are not estimates and a classification the professional typed does appear, as theirs).
 *
 * Pure: no screen and no database here.
 */
import type { ResultRow } from "@/db/assessments";
import { formatCalendarDate } from "@/modules/training/format";
import {
  ACTIVITY_CURRENT,
  ACTIVITY_PAST,
  ANAMNESIS,
  ANAMNESIS_ANSWERS,
  BONE_BREADTHS,
  BONE_BREADTH_CODES,
  GOALS,
  GOALS_NOTES_LABEL,
  HEATH_CARTER_CODES,
  HEATH_CARTER_MEASURES,
  PARQ,
  PARQ_ANSWERS,
  PARQ_DECISIONS,
  PARQ_INSTRUMENT_LABEL,
  PERIMETERS_SIDED,
  PERIMETERS_SINGLE,
  PERIMETER_SIDED_CODES,
  PERIMETER_SINGLE_CODES,
  POSTURE_VIEWS,
  POSTURE_VIEW_CODES,
  postureRegionKey,
} from "../catalog";
import type { RiskStatus } from "../contracts";
import { PROTOCOL_VARIANTS, SKINFOLD_SITE_CODES, selectedValue } from "../formulas";
import { assessmentTitle } from "../names";
import { AGGREGATION_LABEL, CONVERSION_LABEL, EQUATION_LABEL, PROTOCOL_CHIP, SITE_LABEL, requiredSites, type CompositionPayload } from "./composition";
import { CONCLUSION_FIELDS, CONCLUSION_LABEL, conclusionEmpty, type ConclusionPayload } from "./conclusion";
import { FLEXITEST_CLASSIFICATION_NOTE, FLEXITEST_CODES, FLEXITEST_LABEL, FLEXITEST_VARIANT_LABEL, filledText, flexitestTally, movementEmpty, totalText, type MovementPayload } from "./flexitest";
import {
  COOPER_MINUTES,
  EXERCISE_LABEL,
  REPETITION_TESTS,
  TESTS_CLASSIFICATION_NOTE,
  TEST_TITLE,
  EMPTY_TESTS,
  cooperEmpty,
  repetitionTestEmpty,
  testsEmpty,
  type TestsPayload,
} from "./physical-tests";
import { HEATH_CARTER_NOTE, findingsText, postureEmpty, regionsOf, somatotypeText, type PosturePayload } from "./posture";
import { FLAG_LABEL, RESULT_LABEL, formatResult, isResultEstimate, methodLabel, resultNote } from "./review";
import { BEFORE_TABLES, TABLES_NOTE, classificationHeading, classificationLine, isClassifiedCode, recordedTableReference } from "../classifications";
import { ANAMNESIS_CODES, PARQ_CODES, parqAnswer, type ProfilePayload, type ScreeningPayload } from "./screening";
import { photoViewLabel, type PhotoView } from "../photos";
import { recordedPhotoGroups } from "./posture-photos";
import { NOT_INCLUDED, PART_LABEL, excludedPartsOf, isPartEnabled, isStepEnabled, templateLine, type EnabledParts, type TemplatePart } from "./template";

/** The line every report carries in place of the institutional disclaimer the handoff asks for but does not give (handoff 3.5). */
export const REPORT_NOTICE = `${TABLES_NOTE} A classificação é a registrada ao finalizar, com a tabela indicada em cada resultado. Só os resultados marcados “estimativa” vêm de equações.`;
/** The short form of `REPORT_NOTICE`, for the footer of each page. */
export const REPORT_FOOTER_NOTICE = "Classificação só pelas tabelas de referência indicadas.";
/** How an empty field reads in the report, so a reader does not take a blank for a zero. */
export const REPORT_EMPTY_NOTE =
  "Um campo vazio aparece escrito por extenso (como “Sem aferição”, “Sem registro”, “Sem resposta” ou “Não realizado”), nunca como zero nem em branco.";

export type ReportBlock =
  | { kind: "facts"; rows: { label: string; value: string }[] }
  | { kind: "subtitle"; text: string }
  | { kind: "text"; text: string; muted?: boolean }
  | { kind: "results"; rows: { label: string; value: string; detail: string; flags: string[]; classification: string | null }[] }
  /** The posture photos (slice 0.86): the PDF draws the image of each stored one; an erased one is a line that says when. */
  | { kind: "photos"; items: { view: PhotoView; label: string; erasedOn: string | null }[] };
export interface ReportSection {
  title: string;
  blocks: ReportBlock[];
}
export interface AssessmentReport {
  /** "Avaliação física", "Reavaliação física" or "Retificação da avaliação física". */
  title: string;
  /** Who, by whom, when: the header of the first page. */
  facts: { label: string; value: string }[];
  /** A warning under the header (an amended assessment says so), or null. */
  warning: string | null;
  sections: ReportSection[];
}

export interface ReportInput {
  assessment: {
    id: string;
    assessedOn: string;
    kind: "INITIAL" | "REASSESSMENT";
    recordedAt: string | null;
    recordedByName: string | null;
    riskStatus: RiskStatus;
    reviewed: boolean;
    amendsAssessmentId: string | null;
    amendReason: string | null;
    amendedById: string | null;
  };
  /** The date of the assessment this one amends (only for an amendment). */
  amendsAssessedOn: string | null;
  /** When the amendment that corrects this one was recorded (only for an amended one). */
  amendedAt: string | null;
  studentName: string;
  organizationName: string | null;
  results: readonly ResultRow[];
  profile: ProfilePayload | null;
  screening: ScreeningPayload | null;
  composition: CompositionPayload | null;
  posture: PosturePayload | null;
  movement: MovementPayload | null;
  tests: TestsPayload | null;
  conclusion: ConclusionPayload | null;
  /** The name of who recorded the PAR-Q decision, when there is one. */
  decidedBy: string | null;
  /** The model it was made with (slice 0.85); absent or null: every part on. */
  template?: { name: string; version: number } | null;
  /** The optional parts that model had on; a part that is off prints "Não incluído neste modelo", never "Não realizado". */
  enabled?: EnabledParts;
  /**
   * The index of the posture photos (slice 0.86: the student sees their own photos, user's decision of 03/11/2026, and the report goes to both):
   * which views have one, when it was stored and, if erased, when. The image itself is never here.
   */
  photos?: readonly ReportPhoto[];
}

/** One posture photo of a recorded assessment, as the report knows it. */
export interface ReportPhoto {
  view: PhotoView;
  createdAt: string;
  erasedAt: string | null;
}

/** The line under the title of the photos, in the report and on the student's page. */
export const REPORT_PHOTOS_NOTE = "Registro visual, não diagnóstico. Uma foto apagada não volta; fica só a data em que foi apagada.";

const decimal = (value: number, digits = 2) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
const measured = (value: number | null | undefined, unit: string, digits = 2) =>
  value === null || value === undefined ? "Sem aferição" : `${decimal(value, digits)} ${unit}`;
const yesNo = (value: "yes" | "no" | null) => (value === "yes" ? "Sim" : value === "no" ? "Não" : "Sem resposta");
const orEmpty = (text: string) => (text.trim() === "" ? "Sem registro" : text.trim());
const filled = (text: string) => text.trim() !== "";
/** The day of an instant in Brasília time ("03/11/2026"). */
export const reportDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
/** An instant in Brasília time, as the screens show it. */
export const reportDateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const notDone = (text = "Não realizado."): ReportBlock => ({ kind: "text", text, muted: true });
// One form for a part left out, as in the review and the recorded view: "Dobras cutâneas: Não incluído neste modelo." (never declined).
const notIncluded = (what?: string): ReportBlock => ({ kind: "text", text: what ? `${what}: ${NOT_INCLUDED}.` : `${NOT_INCLUDED}.`, muted: true });
const facts = (rows: { label: string; value: string }[]): ReportBlock[] => (rows.length === 0 ? [] : [{ kind: "facts", rows }]);
const row = (label: string, value: string) => ({ label, value });

function parqLine(risk: RiskStatus, reviewed: boolean): string {
  if (risk === "CLEAR") return "PAR-Q sem “Sim”";
  return reviewed ? "PAR-Q com “Sim”, decisão registrada" : "PAR-Q com “Sim”, sem decisão";
}

function screeningSection(input: ReportInput): ReportSection {
  const { profile, screening } = input;
  const blocks: ReportBlock[] = [
    ...facts([
      row("Objetivos", profile && profile.goals.length > 0 ? profile.goals.map((code) => GOALS[code]).join(", ") : "Nenhum selecionado"),
      row(GOALS_NOTES_LABEL, orEmpty(profile?.goalNotes ?? "")),
    ]),
  ];
  if (!screening) return { title: "Triagem", blocks: [...blocks, notDone("Anamnese, atividade física e PAR-Q: não realizados.")] };
  blocks.push({ kind: "subtitle", text: "Anamnese clínica" });
  if (ANAMNESIS_CODES.every((code) => !screening.anamnesis[code])) blocks.push(notDone("Nenhuma pergunta respondida."));
  else
    blocks.push({
      kind: "facts",
      rows: ANAMNESIS_CODES.map((code) => {
        const entry = screening.anamnesis[code];
        const answer = entry?.answer ? ANAMNESIS_ANSWERS[entry.answer] : "Sem resposta";
        return row(ANAMNESIS[code], entry?.details.trim() ? `${answer} — ${entry.details.trim()}` : answer);
      }),
    });
  const { current, past } = screening.activity;
  blocks.push({ kind: "subtitle", text: "Atividade física" });
  blocks.push({
    kind: "facts",
    rows: [
      row(`Atual: ${ACTIVITY_CURRENT.practices.toLowerCase()}`, yesNo(current.practices)),
      row(`Atual: ${ACTIVITY_CURRENT.activities.toLowerCase()}`, orEmpty(current.activities)),
      row(`Atual: ${ACTIVITY_CURRENT.frequency.toLowerCase()}`, current.frequency ? `${decimal(current.frequency.value)} por semana` : "Sem registro"),
      ...(filled(current.duration) ? [row(`Atual: ${ACTIVITY_CURRENT.duration.toLowerCase()}`, current.duration.trim())] : []),
      ...(filled(current.notes) ? [row(`Atual: ${ACTIVITY_CURRENT.notes.toLowerCase()}`, current.notes.trim())] : []),
      row(`Passada: ${ACTIVITY_PAST.practiced.toLowerCase()}`, yesNo(past.practiced)),
      row(`Passada: ${ACTIVITY_PAST.activities.toLowerCase()}`, orEmpty(past.activities)),
      ...(filled(past.totalTime) ? [row(`Passada: ${ACTIVITY_PAST.totalTime.toLowerCase()}`, past.totalTime.trim())] : []),
      ...(past.frequency ? [row(`Passada: ${ACTIVITY_PAST.frequency.toLowerCase()}`, `${decimal(past.frequency.value)} por semana`)] : []),
      ...(filled(past.notes) ? [row(`Passada: ${ACTIVITY_PAST.notes.toLowerCase()}`, past.notes.trim())] : []),
    ],
  });
  blocks.push({ kind: "subtitle", text: `PAR-Q (${PARQ_INSTRUMENT_LABEL})` });
  blocks.push({ kind: "facts", rows: PARQ_CODES.map((code) => row(PARQ[code], PARQ_ANSWERS[parqAnswer(screening, code)])) });
  const review = screening.parq.professionalReview;
  if (review.decision) {
    blocks.push({ kind: "facts", rows: [row("Decisão profissional", PARQ_DECISIONS[review.decision]), row("Nota da decisão", orEmpty(review.notes))] });
    blocks.push({
      kind: "text",
      text: `Registrada${input.decidedBy ? ` por ${input.decidedBy}` : ""}${review.reviewedAt ? ` em ${reportDateTime(review.reviewedAt)}` : ""}. A decisão é do profissional; o sistema não declara aptidão.`,
      muted: true,
    });
  } else if (input.assessment.riskStatus === "REVIEW_REQUIRED")
    // finalize asks for the decision on any "Sim"; a record without one (imported or damaged) says it is missing instead of denying the "Sim".
    blocks.push({ kind: "text", text: "PAR-Q com “Sim”, sem decisão profissional registrada. Isto não é liberação clínica." });
  else blocks.push(notDone("Sem resposta “Sim” no PAR-Q: nenhuma decisão foi pedida. Isto não é liberação clínica."));
  return { title: "Triagem", blocks };
}

function measuresSection(composition: CompositionPayload | null, enabled: EnabledParts = null): ReportSection {
  if (!isStepEnabled(enabled, "medidas")) return { title: "Medidas", blocks: [notIncluded()] };
  if (!composition) return { title: "Medidas", blocks: [notDone(), ...excludedPartsOf(enabled, "medidas").map((part) => notIncluded(PART_LABEL[part]))] };
  const on = (part: TemplatePart) => isPartEnabled(enabled, part);
  const blocks: ReportBlock[] = [
    ...(on("basics") ? [] : [notIncluded(PART_LABEL.basics)]),
    ...facts([
      ...(on("basics")
        ? [
            row("Peso", measured(composition.weightKg, "kg")),
            row("Altura", composition.heightCm === null ? "Sem aferição" : `${decimal(composition.heightCm / 100, 3)} m`),
            row("PAS / PAD", `${measured(composition.systolicMmHg, "mmHg", 0)} / ${measured(composition.diastolicMmHg, "mmHg", 0)}`),
            row("FC repouso", measured(composition.restingHeartRateBpm, "bpm", 0)),
          ]
        : []),
      ...(on("skinfolds")
        ? [
            row("Protocolo de dobras", composition.protocol ? PROTOCOL_CHIP[composition.protocol] : "Não escolhido"),
            row("Referência da equação", EQUATION_LABEL[composition.equation]),
            row("Leituras por dobra", AGGREGATION_LABEL[composition.aggregation]),
            row("Conversão", CONVERSION_LABEL[composition.conversion]),
          ]
        : []),
    ]),
    { kind: "subtitle", text: "Dobras cutâneas" },
  ];
  const sites = SKINFOLD_SITE_CODES.filter((site) => (composition.skinfolds[site] ?? []).length > 0);
  const inProtocol = requiredSites(composition.protocol, composition.equation);
  if (!on("skinfolds")) blocks.push(notIncluded());
  else if (sites.length === 0) blocks.push(notDone("Nenhuma dobra medida."));
  else
    blocks.push({
      kind: "facts",
      rows: sites.map((site) => {
        const readings = composition.skinfolds[site] ?? [];
        const value = selectedValue(readings, composition.aggregation);
        const used = value === null ? "Sem valor" : `${decimal(value)} mm`;
        const detail = readings.length > 1 ? ` (leituras ${readings.map((reading) => `${decimal(reading)} mm`).join(" · ")})` : "";
        return row(`${SITE_LABEL[site]}${inProtocol.includes(site) ? "" : " (fora do protocolo)"}`, `${used}${detail}`);
      }),
    });
  const single = PERIMETER_SINGLE_CODES.filter((code) => composition.perimetersCm[code] !== undefined);
  const sided = PERIMETER_SIDED_CODES.filter((code) => composition.sidedPerimetersCm[code] !== undefined);
  blocks.push({ kind: "subtitle", text: "Perímetros" });
  if (!on("perimeters")) blocks.push(notIncluded());
  else if (single.length + sided.length === 0) blocks.push(notDone("Nenhum perímetro medido."));
  else
    blocks.push({
      kind: "facts",
      rows: [
        ...single.map((code) => row(PERIMETERS_SINGLE[code], measured(composition.perimetersCm[code], "cm"))),
        ...sided.map((code) => {
          const pair = composition.sidedPerimetersCm[code];
          return row(`${PERIMETERS_SIDED[code]} (D / E)`, `D ${measured(pair?.right, "cm")} / E ${measured(pair?.left, "cm")}`);
        }),
      ],
    });
  const breadths = BONE_BREADTH_CODES.filter((code) => composition.boneBreadthsCm[code] !== undefined);
  blocks.push({ kind: "subtitle", text: "Diâmetros ósseos" });
  if (!on("breadths")) blocks.push(notIncluded());
  else if (breadths.length === 0) blocks.push(notDone("Nenhum diâmetro medido."));
  else blocks.push({ kind: "facts", rows: breadths.map((code) => row(BONE_BREADTHS[code], measured(composition.boneBreadthsCm[code], "cm"))) });
  return { title: "Medidas", blocks };
}

/** The results as recorded at finalize: the same words as the screen (value, reading of a bilateral difference, method, formula, estimate, flags). */
export function resultRows(results: readonly ResultRow[]) {
  return results.map((result) => {
    const note = resultNote(result.code, result.value);
    return {
      label: RESULT_LABEL[result.code] ?? result.code,
      value: result.value === null ? "Sem valor" : formatResult(result.code, result.value, result.unit),
      detail: [note, methodLabel(result.method), result.formulaVersion ? `fórmula ${result.formulaVersion}` : null, isResultEstimate(result.code, result.method) ? "estimativa" : null]
        .filter((part): part is string => part !== null)
        .join(" · "),
      flags: result.flags.map((flag) => FLAG_LABEL[flag] ?? flag),
      // Slice 0.92: the classification as written at finalize; a result a table classifies, recorded before the tables, says so.
      classification: !isClassifiedCode(result.code)
        ? null
        : result.classification
          ? `${classificationHeading(result.classification)}: ${classificationLine(result.classification)}`
          : `Classificação: ${BEFORE_TABLES}`,
    };
  });
}

/**
 * The original validation population of each skinfold equation the results used (handoff 4.3: "protocolo, variante, conversão, população original
 * de validação" in the report), read from the method recorded with the result, once per equation.
 */
export function validationLines(results: readonly ResultRow[]): string[] {
  const lines: string[] = [];
  for (const method of new Set(results.map((result) => result.method))) {
    for (const protocol of Object.keys(PROTOCOL_VARIANTS) as (keyof typeof PROTOCOL_VARIANTS)[]) {
      const variant = [PROTOCOL_VARIANTS[protocol].male, PROTOCOL_VARIANTS[protocol].female].find((item) => item.id === method);
      if (variant) {
        lines.push(`População original de validação (${methodLabel(method)}): ${variant.validation.text}`);
        break;
      }
    }
  }
  return lines;
}

function resultsSection(results: readonly ResultRow[]): ReportSection {
  // Slice 0.92: the reference the tables used, as frozen in the classifications (absent on a record made before the tables).
  const reference = recordedTableReference(results.map((result) => result.classification));
  return {
    title: "Resultados",
    blocks: [
      notDone("Calculados ao finalizar, com o método e a versão da fórmula. Só os marcados como estimativa vêm da equação de um estudo."),
      notDone(TABLES_NOTE),
      ...(reference ? facts([row("Referência das tabelas", reference)]) : []),
      results.length > 0 ? { kind: "results", rows: resultRows(results) } : { kind: "text", text: "Nenhum resultado foi calculado." },
      ...validationLines(results).map((text): ReportBlock => ({ kind: "text", text, muted: true })),
    ],
  };
}

function postureBlocks(posture: PosturePayload, enabled: EnabledParts = null): ReportBlock[] {
  const views = isPartEnabled(enabled, "posture");
  const blocks: ReportBlock[] = [views ? notDone("Observações posturais, não diagnóstico clínico.") : notIncluded(PART_LABEL.posture)];
  for (const view of views ? POSTURE_VIEW_CODES : []) {
    const regions = regionsOf(view);
    const observed = regions.filter((region) => findingsText(region, posture.findings[postureRegionKey(region)]) !== null);
    blocks.push({ kind: "subtitle", text: POSTURE_VIEWS[view] });
    if (observed.length === 0) blocks.push(notDone("Nenhuma região observada."));
    else
      blocks.push({
        kind: "facts",
        rows: observed.map((region) =>
          row(region.label, findingsText(region, posture.findings[postureRegionKey(region)], posture.laterality[postureRegionKey(region)]) ?? ""),
        ),
      });
    if (observed.length > 0 && observed.length < regions.length)
      blocks.push(notDone(`Não observadas: ${regions.filter((region) => !observed.includes(region)).map((region) => region.label).join(", ")}.`));
    if (filled(posture.notes[view])) blocks.push({ kind: "text", text: `Observações: ${posture.notes[view].trim()}` });
  }
  const measures = HEATH_CARTER_CODES.filter((code) => posture.somatotype.heathCarter[code] !== null);
  blocks.push({ kind: "subtitle", text: "Somatotipo" });
  if (!isPartEnabled(enabled, "somatotype")) {
    blocks.push(notIncluded());
    return blocks;
  }
  blocks.push({
    kind: "facts",
    rows: [
      row("Registro do profissional", somatotypeText(posture.somatotype.labels) ?? "Não registrado"),
      row("Observações", orEmpty(posture.somatotype.notes)),
      ...measures.map((code) => row(HEATH_CARTER_MEASURES[code].label, measured(posture.somatotype.heathCarter[code], HEATH_CARTER_MEASURES[code].unit))),
    ],
  });
  if (measures.length > 0) blocks.push(notDone(HEATH_CARTER_NOTE));
  return blocks;
}

function flexitestBlocks(movement: MovementPayload, results: readonly ResultRow[]): ReportBlock[] {
  // The total is the one recorded at finalize (with its formula version), never recomputed with today's formula.
  const total = results.find((result) => result.code === "flexitest_total")?.value ?? null;
  const { levels, classificationManual, notes, variant } = movement.flexitest;
  const assessed = FLEXITEST_CODES.filter((code) => levels[code] !== undefined);
  const missing = FLEXITEST_CODES.filter((code) => levels[code] === undefined);
  const blocks: ReportBlock[] = [
    notDone(`${filledText(flexitestTally(movement).filled)} · total: ${totalText(total).toLowerCase()} · ${FLEXITEST_VARIANT_LABEL[variant]}.`),
    ...facts(assessed.map((code) => row(FLEXITEST_LABEL[code], `Nível ${levels[code]}`))),
  ];
  if (assessed.length > 0 && missing.length > 0) blocks.push(notDone(`Não avaliados: ${missing.map((code) => FLEXITEST_LABEL[code]).join(", ")}.`));
  if (filled(classificationManual)) {
    blocks.push({ kind: "facts", rows: [row("Classificação (manual)", classificationManual.trim())] });
    blocks.push(notDone(FLEXITEST_CLASSIFICATION_NOTE));
  }
  if (filled(notes)) blocks.push({ kind: "text", text: `Observações: ${notes.trim()}` });
  return blocks;
}

function movementSection(posture: PosturePayload | null, movement: MovementPayload | null, results: readonly ResultRow[], enabled: EnabledParts = null): ReportSection {
  if (!isStepEnabled(enabled, "movimento")) return { title: "Postura e movimento", blocks: [notIncluded()] };
  const hasPosture = posture !== null && !postureEmpty(posture);
  const hasMovement = movement !== null && !movementEmpty(movement);
  const views = isPartEnabled(enabled, "posture");
  const somatotype = isPartEnabled(enabled, "somatotype");
  const flexitest = isPartEnabled(enabled, "flexitest");
  if (!hasPosture && !hasMovement && enabled === null) return { title: "Postura e movimento", blocks: [notDone()] };
  const emptyPosture: ReportBlock[] =
    views && somatotype
      ? [notDone("Postura e somatotipo: não realizados.")]
      : [views ? notDone("Postura: não realizada.") : notIncluded(PART_LABEL.posture), somatotype ? notDone("Somatotipo: não realizado.") : notIncluded(PART_LABEL.somatotype)];
  return {
    title: "Postura e movimento",
    blocks: [
      ...(hasPosture ? postureBlocks(posture, enabled) : emptyPosture),
      { kind: "subtitle", text: "Flexiteste" },
      ...(!flexitest ? [notIncluded()] : hasMovement ? flexitestBlocks(movement, results) : [notDone()]),
    ],
  };
}

const count = (value: number | null, one: string, many: string) => (value === null ? "Sem registro" : `${value} ${value === 1 ? one : many}`);

function testsSection(tests: TestsPayload | null, enabled: EnabledParts = null): ReportSection {
  if (!isStepEnabled(enabled, "testes")) return { title: "Testes físicos", blocks: [notIncluded()] };
  const on = (key: "abdominal" | "upperLimb" | "cooper") => isPartEnabled(enabled, key === "upperLimb" ? "upper_limb" : key);
  if ((!tests || testsEmpty(tests)) && enabled === null) return { title: "Testes físicos", blocks: [notDone()] };
  tests = tests ?? EMPTY_TESTS;
  const blocks: ReportBlock[] = [];
  for (const key of REPETITION_TESTS) {
    const test = tests[key];
    blocks.push({ kind: "subtitle", text: TEST_TITLE[key] });
    if (!on(key)) {
      blocks.push(notIncluded());
      continue;
    }
    if (repetitionTestEmpty(test)) {
      blocks.push(notDone());
      continue;
    }
    blocks.push({
      kind: "facts",
      rows: [
        row(EXERCISE_LABEL[key], orEmpty(test.exercise)),
        row("Repetições completas", count(test.repetitions, "repetição", "repetições")),
        row("Duração", test.durationSeconds === null ? "Sem registro" : `${test.durationSeconds} s`),
        ...(key === "upperLimb" || filled(test.conditions) ? [row("Condições", orEmpty(test.conditions))] : []),
        ...(filled(test.classificationManual) ? [row("Classificação (manual)", test.classificationManual.trim())] : []),
        ...(filled(test.notes) ? [row("Observações", test.notes.trim())] : []),
      ],
    });
  }
  const { cooper } = tests;
  blocks.push({ kind: "subtitle", text: TEST_TITLE.cooper });
  if (!on("cooper")) blocks.push(notIncluded());
  else if (cooperEmpty(cooper)) blocks.push(notDone());
  else
    blocks.push({
      kind: "facts",
      rows: [
        row("Distância percorrida", cooper.distanceM === null ? "Sem registro" : `${decimal(cooper.distanceM, 1)} m em ${COOPER_MINUTES} min`),
        row("Data do teste", cooper.testedOn ? formatCalendarDate(cooper.testedOn) : "Sem registro"),
        row("Local", orEmpty(cooper.location)),
        row("Condições", orEmpty(cooper.conditions)),
        row("Contraindicações", orEmpty(cooper.contraindications)),
        ...(filled(cooper.classificationManual) ? [row("Classificação (manual)", cooper.classificationManual.trim())] : []),
        ...(filled(cooper.notes) ? [row("Observações", cooper.notes.trim())] : []),
      ],
    });
  const classified = [...REPETITION_TESTS.map((key) => tests[key].classificationManual), cooper.classificationManual].some(filled);
  if (classified) blocks.push(notDone(TESTS_CLASSIFICATION_NOTE));
  if (on("cooper")) blocks.push(notDone("A velocidade média, o VO₂máx estimado e a classificação da distância (Cooper, 1982) estão em “Resultados”."));
  return { title: "Testes físicos", blocks };
}

/** The posture photos of the record, by view of the posture (only when there is at least one, stored or erased). */
function photosSection(photos: readonly ReportPhoto[]): ReportSection {
  return {
    title: "Fotos da postura",
    blocks: [
      { kind: "text", text: REPORT_PHOTOS_NOTE, muted: true },
      {
        kind: "photos",
        items: recordedPhotoGroups(photos).flatMap((group) =>
          group.photos.map((photo) => ({ view: photo.view, label: photoViewLabel(photo.view), erasedOn: photo.erasedAt ? reportDate(photo.erasedAt) : null })),
        ),
      },
    ],
  };
}

function conclusionSection(conclusion: ConclusionPayload | null, enabled: EnabledParts = null): ReportSection {
  if (!isPartEnabled(enabled, "conclusion")) return { title: "Considerações finais", blocks: [notIncluded()] };
  if (!conclusion || conclusionEmpty(conclusion)) return { title: "Considerações finais", blocks: [notDone("Não escritas.")] };
  const blocks: ReportBlock[] = [];
  for (const field of CONCLUSION_FIELDS.filter((item) => filled(conclusion[item]))) {
    blocks.push({ kind: "subtitle", text: CONCLUSION_LABEL[field] });
    blocks.push({ kind: "text", text: conclusion[field].trim() });
  }
  return { title: "Considerações finais", blocks };
}

export function assessmentReport(input: ReportInput): AssessmentReport {
  const { assessment } = input;
  const title = assessmentTitle({ kind: assessment.kind, formatVersion: 2, amendsAssessmentId: assessment.amendsAssessmentId });
  const header = [
    row("Aluno", input.studentName),
    row("Profissional", assessment.recordedByName ?? "Não informado"),
    ...(input.organizationName ? [row("Espaço", input.organizationName)] : []),
    row("Data da avaliação", formatCalendarDate(assessment.assessedOn)),
    row("Registrada em", assessment.recordedAt ? reportDateTime(assessment.recordedAt) : "Sem registro"),
    row("Triagem", parqLine(assessment.riskStatus, assessment.reviewed)),
    ...(input.template ? [row("Modelo", templateLine(input.template).replace(/^Modelo: /, "").replace(/\.$/, ""))] : []),
    ...(assessment.amendsAssessmentId
      ? [
          row("Retifica", input.amendsAssessedOn ? `a avaliação de ${formatCalendarDate(input.amendsAssessedOn)}` : "uma avaliação registrada antes"),
          row("Motivo da retificação", orEmpty(assessment.amendReason ?? "")),
        ]
      : []),
  ];
  const warning = assessment.amendedById
    ? `Retificada por uma retificação registrada ${input.amendedAt ? `em ${reportDateTime(input.amendedAt)}` : "depois"}. Os dados abaixo são os originais, como foram registrados.`
    : null;
  return {
    title,
    facts: header,
    warning,
    sections: [
      screeningSection(input),
      measuresSection(input.composition, input.enabled ?? null),
      resultsSection(input.results),
      movementSection(input.posture, input.movement, input.results, input.enabled ?? null),
      ...(input.photos && input.photos.length > 0 ? [photosSection(input.photos)] : []),
      testsSection(input.tests, input.enabled ?? null),
      conclusionSection(input.conclusion, input.enabled ?? null),
    ],
  };
}

/** "avaliacao-fisica-2026-11-03.pdf" (the date of the assessment; an amendment and a reassessment say so). */
export function reportFileName(assessment: Pick<ReportInput["assessment"], "assessedOn" | "kind" | "amendsAssessmentId">): string {
  const prefix = assessment.amendsAssessmentId ? "retificacao-avaliacao-fisica" : assessment.kind === "INITIAL" ? "avaliacao-fisica" : "reavaliacao-fisica";
  return `${prefix}-${/^\d{4}-\d{2}-\d{2}$/.test(assessment.assessedOn) ? assessment.assessedOn : "registro"}.pdf`;
}

/**
 * SHA-256 over the recorded assessment itself (its identity, the frozen sections and the results as stored at finalize, the PAR-Q decider by user
 * id), not over the printed words: so the same record always carries the same fingerprint, before and after a later amendment is recorded, after
 * a rename of whoever decided, and whatever today's labels say. Names, the amendment warning and the generation date are left out.
 */
export async function reportFingerprint(input: ReportInput): Promise<string> {
  const { assessment } = input;
  const canonical = JSON.stringify([
    assessment.id,
    assessment.kind,
    assessment.assessedOn,
    assessment.recordedAt,
    assessment.amendsAssessmentId,
    assessment.amendReason,
    input.results,
    input.profile,
    input.screening,
    input.composition,
    input.posture,
    input.movement,
    input.tests,
    input.conclusion,
    // The model (slice 0.85) only when there is one, so the fingerprint of every report made before stays the same.
    ...(input.template ? [input.template, input.enabled ?? null] : []),
    // The photos (slice 0.86) are left out: they freeze with the record (migration 0011's triggers), so the assessment id already names them,
    // and a record that had photos before 0.86 keeps the version its earlier PDFs printed. An erasure later prints "Foto apagada em …" under
    // the same version: the version names the record, not every printed page.
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
