/**
 * The "Testes físicos" step (handoff V2 section 3.5, Figma AV-06), stored as the module "tests" of the draft (page 5 of the PDF), saved with the
 * assessment's revision like the other modules.
 *
 * - Abdominal and upper-limb muscular endurance: the exercise (protocol, variant, version) as written, complete repetitions (an integer, 0
 *   included: a count of none is a result; not done is empty, never 0), the duration when the test has one, conditions and notes. The PDF names
 *   them "potência" (Pollock e Wilmore, 1993); nothing here says power was measured (handoff 11: no time/work parameter).
 * - Cooper, 12 minutes: the distance in metres (the time is fixed for this test), the date, place, conditions and contraindications. The average
 *   speed and the estimated VO₂max come from the versioned formulas (handoff 5) at finalize.
 *
 * Every classification is the professional's text (handoff 3.5: "classificação manual até tabela homologada"); nothing here classifies.
 * Pure: no screen and no database here, so the server checks a save with the same rules the screen uses.
 */
import { z } from "zod";
import { parseDecimal } from "../formulas";
import { MAX_TEXT } from "./screening";

export const TESTS_MODULE = "tests" as const;

/** Technical ceilings of the fields (what the form takes), not plausibility limits nor reference values. */
export const MAX_REPETITIONS = 9999;
export const MAX_DURATION_S = 86_400;
export const MAX_DISTANCE_M = 100_000;
/** The fixed duration of this variant of the Cooper test (handoff 3.5). */
export const COOPER_MINUTES = 12;

const text = z.string().max(MAX_TEXT).default("");
const repetitions = z.number().int().min(0).max(MAX_REPETITIONS).nullable().default(null);
const duration = z.number().int().positive().max(MAX_DURATION_S).nullable().default(null);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date written as YYYY-MM-DD. */
export const isIsoDate = (value: string) => {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const repetitionTest = z
  .object({
    /** The exercise, protocol or variant as the professional writes it (handoff 3.5: "exercício/protocolo/versão", "tipo de exercício/variante"). */
    exercise: text,
    repetitions,
    durationSeconds: duration,
    conditions: text,
    notes: text,
    classificationManual: text,
  })
  .strict();
const EMPTY_REPETITION_TEST = { exercise: "", repetitions: null, durationSeconds: null, conditions: "", notes: "", classificationManual: "" };

export const testsSchema = z
  .object({
    abdominal: repetitionTest.default(EMPTY_REPETITION_TEST),
    upperLimb: repetitionTest.default(EMPTY_REPETITION_TEST),
    cooper: z
      .object({
        distanceM: z.number().finite().positive().max(MAX_DISTANCE_M).nullable().default(null),
        testedOn: z.string().refine(isIsoDate, "date").nullable().default(null),
        location: text,
        conditions: text,
        contraindications: text,
        notes: text,
        classificationManual: text,
      })
      .strict()
      .default({ distanceM: null, testedOn: null, location: "", conditions: "", contraindications: "", notes: "", classificationManual: "" }),
  })
  .strict();
export type TestsPayload = z.infer<typeof testsSchema>;
export type RepetitionTestKey = "abdominal" | "upperLimb";
export const REPETITION_TESTS: readonly RepetitionTestKey[] = ["abdominal", "upperLimb"];
export const EMPTY_TESTS: TestsPayload = testsSchema.parse({});

/** What was stored, read back; anything unknown or invalid reads as the empty module (never as a guess). */
export function readTests(raw: unknown): TestsPayload {
  const parsed = testsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_TESTS;
}

/** The name of each test as shown, and where the PDF's own name comes from (shown as the source says, without claiming a power measurement). */
export const TEST_TITLE: Record<RepetitionTestKey | "cooper", string> = {
  abdominal: "Resistência abdominal",
  upperLimb: "Resistência de membros superiores",
  cooper: "Teste de Cooper · 12 minutos",
};
export const TEST_SOURCE: Record<RepetitionTestKey, string> = {
  abdominal: "No documento de origem: “potência abdominal” (Pollock e Wilmore, 1993). Repetições completas; não mede potência.",
  upperLimb: "No documento de origem, com a mesma atribuição do teste abdominal (Pollock e Wilmore, 1993). Repetições completas; não mede potência.",
};
export const EXERCISE_LABEL: Record<RepetitionTestKey, string> = { abdominal: "Exercício ou protocolo", upperLimb: "Exercício ou variante" };

export const repetitionTestEmpty = (test: TestsPayload[RepetitionTestKey]) =>
  test.repetitions === null &&
  test.durationSeconds === null &&
  [test.exercise, test.conditions, test.notes, test.classificationManual].every((value) => value.trim() === "");
export const cooperEmpty = (cooper: TestsPayload["cooper"]) =>
  cooper.distanceM === null &&
  cooper.testedOn === null &&
  [cooper.location, cooper.conditions, cooper.contraindications, cooper.notes, cooper.classificationManual].every((value) => value.trim() === "");
/** Nothing in the module: the step reads as "Não realizado". */
export const testsEmpty = (payload: TestsPayload) => REPETITION_TESTS.every((key) => repetitionTestEmpty(payload[key])) && cooperEmpty(payload.cooper);

/* ---------- The screen's form ---------- */

export interface RepetitionTestForm {
  exercise: string;
  repetitions: string;
  durationSeconds: string;
  conditions: string;
  notes: string;
  classificationManual: string;
}
export interface TestsForm {
  abdominal: RepetitionTestForm;
  upperLimb: RepetitionTestForm;
  cooper: {
    distanceM: string;
    testedOn: string;
    location: string;
    conditions: string;
    contraindications: string;
    notes: string;
    classificationManual: string;
  };
}

const numberText = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));
const repetitionForm = (test: TestsPayload[RepetitionTestKey]): RepetitionTestForm => ({
  exercise: test.exercise,
  repetitions: numberText(test.repetitions),
  durationSeconds: numberText(test.durationSeconds),
  conditions: test.conditions,
  notes: test.notes,
  classificationManual: test.classificationManual,
});

export const testsFormFrom = (payload: TestsPayload): TestsForm => ({
  abdominal: repetitionForm(payload.abdominal),
  upperLimb: repetitionForm(payload.upperLimb),
  cooper: {
    distanceM: numberText(payload.cooper.distanceM),
    testedOn: payload.cooper.testedOn ?? "",
    location: payload.cooper.location,
    conditions: payload.cooper.conditions,
    contraindications: payload.cooper.contraindications,
    notes: payload.cooper.notes,
    classificationManual: payload.cooper.classificationManual,
  },
});

/**
 * A distance as typed in Brazil: "2200", "2.200" (a dot between thousands, as the PDF writes it) or "2200,5". A dot followed by exactly three
 * digits in groups is read as thousands, never as "2,2 m"; anything else goes through the decimal reader of the formulas.
 */
export function parseDistance(typed: string): number | null {
  const trimmed = typed.trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(trimmed)) return parseDecimal(trimmed.replace(/\./g, ""));
  return parseDecimal(trimmed);
}

/** The labels of the fields, as named in a refused save. */
export const FIELD_LABEL = {
  exercise: "exercício",
  repetitions: "Repetições completas",
  durationSeconds: "Duração",
  conditions: "Condições",
  notes: "Observações",
  classificationManual: "Classificação",
  distanceM: "Distância percorrida",
  testedOn: "Data do teste",
  location: "Local",
  contraindications: "Contraindicações",
} as const;
const fieldName = (test: RepetitionTestKey | "cooper", field: keyof typeof FIELD_LABEL) =>
  `${field === "exercise" ? EXERCISE_LABEL[test as RepetitionTestKey] : FIELD_LABEL[field]} (${test === "cooper" ? "Cooper" : TEST_TITLE[test].toLowerCase()})`;

export type TestsReading = { payload: TestsPayload; problems: [] } | { payload: null; problems: string[] };

/**
 * The screen as the payload to store. A count that is not a whole number from 0, a duration or distance that is not positive, a date that is not
 * a date, or a text above the technical ceiling is a problem named by its field — never a 0, a guess or a cut text. Empty stays empty.
 */
export function testsFromForm(form: TestsForm): TestsReading {
  const problems: string[] = [];
  const checkText = (value: string, name: string) => {
    if (value.length > MAX_TEXT) problems.push(name);
    return value;
  };
  const readInteger = (typed: string, min: number, max: number, name: string) => {
    if (typed.trim() === "") return null;
    const value = parseDecimal(typed);
    if (value === null || !Number.isInteger(value) || value < min || value > max) {
      problems.push(name);
      return null;
    }
    return value;
  };
  const repetition = (key: RepetitionTestKey) => {
    const typed = form[key];
    return {
      exercise: checkText(typed.exercise, fieldName(key, "exercise")),
      repetitions: readInteger(typed.repetitions, 0, MAX_REPETITIONS, fieldName(key, "repetitions")),
      durationSeconds: readInteger(typed.durationSeconds, 1, MAX_DURATION_S, fieldName(key, "durationSeconds")),
      conditions: checkText(typed.conditions, fieldName(key, "conditions")),
      notes: checkText(typed.notes, fieldName(key, "notes")),
      classificationManual: checkText(typed.classificationManual, fieldName(key, "classificationManual")),
    };
  };
  // Read in the order of the screen, so a refused save names the fields as they come.
  const abdominal = repetition("abdominal");
  const upperLimb = repetition("upperLimb");
  const cooper = form.cooper;
  let distanceM: number | null = null;
  if (cooper.distanceM.trim() !== "") {
    const value = parseDistance(cooper.distanceM);
    if (value === null || !Number.isFinite(value) || value <= 0 || value > MAX_DISTANCE_M) problems.push(fieldName("cooper", "distanceM"));
    else distanceM = value;
  }
  let testedOn: string | null = null;
  if (cooper.testedOn.trim() !== "") {
    if (isIsoDate(cooper.testedOn.trim())) testedOn = cooper.testedOn.trim();
    else problems.push(fieldName("cooper", "testedOn"));
  }
  const candidate = {
    abdominal,
    upperLimb,
    cooper: {
      distanceM,
      testedOn,
      location: checkText(cooper.location, fieldName("cooper", "location")),
      conditions: checkText(cooper.conditions, fieldName("cooper", "conditions")),
      contraindications: checkText(cooper.contraindications, fieldName("cooper", "contraindications")),
      notes: checkText(cooper.notes, fieldName("cooper", "notes")),
      classificationManual: checkText(cooper.classificationManual, fieldName("cooper", "classificationManual")),
    },
  };
  if (problems.length > 0) return { payload: null, problems };
  const parsed = testsSchema.safeParse(candidate);
  if (!parsed.success) return { payload: null, problems: testsIssueNames(parsed.error.issues) };
  return { payload: parsed.data, problems: [] };
}

/** The names of the fields a refused payload has wrong (a check on the server, where the payload did not come from this screen). */
export function testsIssueNames(issues: readonly { path: readonly PropertyKey[] }[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const [first, second] = issue.path.map(String);
    if ((first === "abdominal" || first === "upperLimb" || first === "cooper") && second && Object.hasOwn(FIELD_LABEL, second))
      names.add(fieldName(first, second as keyof typeof FIELD_LABEL));
    else names.add("Testes físicos");
  }
  return [...names];
}

export const testsProblemsMessage = (problems: string[]) =>
  problems.length === 0
    ? "Confira os testes físicos: algum valor não é aceito."
    : `Confira ${problems.length === 1 ? "o campo" : "os campos"} ${problems.join(", ")}: repetições são um número inteiro (0 ou mais), duração em segundos e distância em metros são positivas, a data é um dia do calendário e cada texto tem até ${MAX_TEXT} caracteres.`;

/** The line said wherever a test's classification shows: it is the professional's, not the system's. */
export const TESTS_CLASSIFICATION_NOTE =
  "Escrita pelo profissional. As resistências abdominal e de membros superiores não têm tabela de referência; a distância do Cooper é classificada pela tabela de Cooper (1982), em “Resultados”.";
