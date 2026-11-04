/**
 * The classification of a value by a reference table (slice 0.92), literally: the value is rounded to the decimals the table prints (17,3% is
 * compared as 17%; the waist-hip ratio with 2 decimals, the BMI with 1, Cooper in whole metres) and looked up in the column of its reference
 * (masculina/feminina) and age. What the table does not decide is said, never closed by a rule of ours:
 *
 * - in a gap between two levels: "entre A e B (fora das faixas da tabela)";
 * - in an overlap of two levels: both, "A / B";
 * - below the first or above the last range, or an age without a column: "sem faixa na tabela", with the reason;
 * - no age (no birth date): "sem idade, sem classificação"; no reference for a table that depends on it: "sem referência escolhida".
 *
 * The result is what finalize stores with the result (frozen: never recomputed with a later table) and what the screens print.
 *
 * Pure: no screen and no database here.
 */
import { z } from "zod";
import { CLASSIFICATION_VERSION, REFERENCE_TABLES, type Band, type Column, type ReferenceTable, type TableId, type TableSex } from "./tables";

export const CLASSIFICATION_STATUSES = ["in_range", "gap", "overlap", "out_of_table", "no_age", "no_reference"] as const;
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];

/** Where the reference of a sex-dependent table came from: the skinfold equation, or the choice "Referência das tabelas" in Revisão. */
export type ReferenceOrigin = "equation" | "chosen";

export const classificationSchema = z
  .object({
    table: z.enum(["body_fat", "bmi", "cooper_12min", "waist_hip", "flexitest"]),
    version: z.string().min(1).max(40),
    status: z.enum(CLASSIFICATION_STATUSES),
    /** in_range: one; overlap: every level that holds the value (table order); gap: the level below and the level above; otherwise none. */
    levels: z.array(z.string().max(80)).max(7),
    /** The value as the result holds it (Cooper: the distance in metres). */
    value: z.number().finite(),
    /** The value rounded to the table's decimals, as compared; null when nothing was compared (no age, no reference, no column). */
    comparedValue: z.number().finite().nullable(),
    decimals: z.number().int().min(0).max(4),
    /** The column used ("homens, 26 a 35 anos"); null for a table with one column, or when none was used. */
    column: z.string().max(80).nullable(),
    source: z.string().max(120),
    sex: z.enum(["male", "female"]).nullable(),
    referenceFrom: z.enum(["equation", "chosen"]).nullable(),
    ageYears: z.number().int().min(0).max(150).nullable(),
    /** Why there is no level (out_of_table), in words. */
    reason: z.string().max(160).nullable(),
  })
  .strict();
export type Classification = z.infer<typeof classificationSchema>;

/** A stored classification read back; anything else (absent, damaged) is null, never a guess. */
export function readClassification(raw: unknown): Classification | null {
  const parsed = classificationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Rounds half up at the given decimals, on the decimal text (so 0.645 is 0.65 and 1.005 is 1.01, not their binary neighbours). */
export function roundTo(value: number, decimals: number): number {
  const shifted = Math.round(Number(`${Math.abs(value)}e${decimals}`));
  return Math.sign(value) * Number(`${shifted}e-${decimals}`);
}

const inBand = (band: Band, value: number) =>
  (band.min === null || value > band.min.value || (band.min.inclusive && value === band.min.value)) &&
  (band.max === null || value < band.max.value || (band.max.inclusive && value === band.max.value));
/** The whole band lies below the value. */
const bandBelow = (band: Band, value: number) => band.max !== null && (value > band.max.value || (value === band.max.value && !band.max.inclusive));
/** The whole band lies above the value. */
const bandAbove = (band: Band, value: number) => band.min !== null && (value < band.min.value || (value === band.min.value && !band.min.inclusive));

const ageText = (age: number) => `${age} ${age === 1 ? "ano" : "anos"}`;

function columnFor(table: ReferenceTable, sex: TableSex | null, age: number | null): Column | null {
  return (
    table.columns.find(
      (column) =>
        (column.sex === null || column.sex === sex) &&
        (column.ageMin === null || (age !== null && age >= column.ageMin)) &&
        (column.ageMax === null || (age !== null && age <= column.ageMax)),
    ) ?? null
  );
}

/** The ages the table has columns for, in words ("de 7 a 17 e de 18 anos em diante"), for the reason of an age without a column. */
function agesCovered(table: ReferenceTable, sex: TableSex | null): string {
  const columns = table.columns.filter((column) => column.sex === null || column.sex === sex);
  const min = Math.min(...columns.map((column) => column.ageMin ?? 0));
  const max = columns.some((column) => column.ageMax === null) ? null : Math.max(...columns.map((column) => column.ageMax ?? 0));
  return max === null ? `de ${min} anos em diante` : `de ${min} a ${max} anos`;
}

export interface ClassifyInput {
  table: TableId;
  value: number;
  /** Age in whole years on the assessment date; null without a birth date. */
  ageYears: number | null;
  sex: TableSex | null;
  referenceFrom: ReferenceOrigin | null;
}

export function classify(input: ClassifyInput): Classification {
  const table = REFERENCE_TABLES[input.table];
  const sex = table.dependsOnSex ? input.sex : null;
  const ageYears = table.dependsOnAge ? input.ageYears : null;
  const base = {
    table: table.id,
    version: CLASSIFICATION_VERSION,
    value: input.value,
    sex,
    referenceFrom: table.dependsOnSex && sex !== null ? input.referenceFrom : null,
    ageYears,
  };
  const none = (status: ClassificationStatus, reason: string | null, decimals: number, source: string): Classification => ({
    ...base,
    status,
    levels: [],
    comparedValue: null,
    decimals,
    column: null,
    source,
    reason,
  });
  const first = table.columns[0];
  if (table.dependsOnSex && sex === null) return none("no_reference", null, first.decimals, first.source);
  if (table.dependsOnAge && ageYears === null) return none("no_age", null, first.decimals, first.source);
  const column = columnFor(table, sex, ageYears);
  if (!column) {
    const covered = agesCovered(table, sex);
    const source = table.columns.find((item) => item.sex === null || item.sex === sex)?.source ?? first.source;
    return none("out_of_table", `idade de ${ageText(ageYears ?? 0)}; a tabela tem colunas ${covered}`, first.decimals, source);
  }
  const compared = roundTo(input.value, column.decimals);
  const found = { ...base, comparedValue: compared, decimals: column.decimals, column: column.label, source: column.source };
  const matches = column.bands.filter((band) => inBand(band, compared));
  if (matches.length === 1) return { ...found, status: "in_range", levels: [matches[0].level], reason: null };
  if (matches.length > 1) return { ...found, status: "overlap", levels: matches.map((band) => band.level), reason: null };
  const lower = column.bands.filter((band) => bandBelow(band, compared));
  const upper = column.bands.filter((band) => bandAbove(band, compared));
  if (lower.length === 0) return { ...found, status: "out_of_table", levels: [], reason: "abaixo da primeira faixa da tabela" };
  if (upper.length === 0) return { ...found, status: "out_of_table", levels: [], reason: "acima da última faixa da tabela" };
  // The nearest level on each side: below, the one that ends highest (the last in the table's order on a tie); above, the one that starts lowest.
  const below = lower.reduce((best, band) => ((band.max as NonNullable<Band["max"]>).value >= (best.max as NonNullable<Band["max"]>).value ? band : best));
  const above = upper.reduce((best, band) => ((band.min as NonNullable<Band["min"]>).value < (best.min as NonNullable<Band["min"]>).value ? band : best));
  return { ...found, status: "gap", levels: [below.level, above.level], reason: null };
}

/* ---------- In words ---------- */

const number = (value: number, decimals: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
/**
 * The value with one decimal more than the table, as the result rows show it (17,3%; 0,737; 23,63). When that rounds to the compared value
 * itself (16,96%, 0,7399), the trailing zero is kept (17,0%; 0,740), so the rounding stays visible and never reads "17% comparado como 17%".
 */
const rawNumber = (value: number, decimals: number) =>
  new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: roundTo(value, decimals + 1) === roundTo(value, decimals) ? decimals + 1 : 0,
    maximumFractionDigits: decimals + 1,
  }).format(value);

/** The level (or what the table does not say), as the screens and the report print it. */
export function classificationLevel(classification: Classification): string {
  const [a, b] = classification.levels;
  switch (classification.status) {
    case "in_range":
      return a ?? "";
    case "overlap":
      return classification.levels.join(" / ");
    case "gap":
      return `entre ${a} e ${b} (fora das faixas da tabela)`;
    case "out_of_table":
      return `sem faixa na tabela (${classification.reason ?? "fora das faixas"})`;
    case "no_age":
      return "sem idade, sem classificação";
    case "no_reference":
      return "sem referência escolhida";
  }
}

export const REFERENCE_LABEL: Record<TableSex, string> = { male: "masculina", female: "feminina" };

/**
 * The table, its column, the source and the precision of the comparison, in words: "Percentual de gordura, homens, 26 a 35 anos · Pollock &
 * Wilmore, 1993 · 17,3% comparado como 17% · referência masculina (da equação)".
 */
export function classificationDetail(classification: Classification): string {
  const table = REFERENCE_TABLES[classification.table];
  const parts: string[] = [classification.column ? `${table.title}, ${classification.column}` : table.title, classification.source];
  if (classification.comparedValue !== null) {
    const compared = `${number(classification.comparedValue, classification.decimals)}${table.unit}`;
    const raw = `${rawNumber(classification.value, classification.decimals)}${table.unit}`;
    parts.push(roundTo(classification.value, 4) === classification.comparedValue ? `comparado como ${compared}` : `${raw} comparado como ${compared}`);
  }
  if (classification.status === "no_reference") parts.push("escolha a referência das tabelas (masculina ou feminina) na Revisão");
  // The age comes from the student's data as the assessment took them when it started: a birth date filled in afterwards does not reach it.
  if (classification.status === "no_age") parts.push("a avaliação não tem data de nascimento (o cadastro não tinha quando ela começou)");
  if (classification.sex) parts.push(`referência ${REFERENCE_LABEL[classification.sex]}${classification.referenceFrom === "equation" ? " (da equação das dobras)" : ""}`);
  parts.push(`tabela ${classification.version}`);
  return parts.join(" · ");
}

/**
 * What the classification is of, when it is not the value of the row it sits on: the Cooper 12 min table classifies the distance run, shown on
 * the row of the average speed (the test records no result of its own for the distance). Null for the others.
 */
export function classificationSubject(classification: Classification): string | null {
  return classification.table === "cooper_12min" ? `da distância (${number(classification.value, 0)} m)` : null;
}

/** "Classificação" or "Classificação da distância (1.800 m)", before the level. */
export const classificationHeading = (classification: Classification | null) => {
  const subject = classification ? classificationSubject(classification) : null;
  return subject ? `Classificação ${subject}` : "Classificação";
};

/** The one line of the report and of the evolution table: "Acima da Média — Percentual de gordura, homens, …". */
export const classificationLine = (classification: Classification) => `${classificationLevel(classification)} — ${classificationDetail(classification)}`;

/** A result recorded before the tables (slice 0.92) is never classified afterwards (handoff 6: no retroactive recalculation). */
export const BEFORE_TABLES = "registrada antes das tabelas de referência";

/** What the screens and the report say about the classification (slice 0.92), in one place. */
export const TABLES_NOTE =
  "Gordura, IMC, RCQ, Cooper 12 min e Flexiteste são classificados pelas tabelas de referência da ferramenta (versão ref-2026-11-03), com o valor comparado na precisão que a tabela imprime. Resistência abdominal, resistência de membros superiores e VO₂ não têm tabela.";
