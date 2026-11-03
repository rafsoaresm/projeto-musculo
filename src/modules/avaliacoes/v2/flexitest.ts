/**
 * The Flexiteste of the "Movimento" step (handoff V2 section 3.4, Figma AV-05), stored as the module "movement" of the draft (page 4 of the PDF),
 * saved with the assessment's revision like the other modules.
 *
 * The PDF's version of the instrument: 15 movements, each at an integer level 1 to 4 (`variant: "pdf_15_movements_1_to_4"`, handoff 6). A movement
 * not assessed is absent, never 0. The total is the sum of the 15 levels and exists only when all 15 are filled (handoff 5: "total só quando
 * completo"). There is no classification table (handoff 3.4: the PDF gives none), so the classification is only what the professional writes.
 *
 * Pure: no screen and no database here, so the server checks a save with the same rules the screen uses.
 */
import { z } from "zod";
import { FLEXITEST_MOVEMENTS, flexitest, type FlexitestLevel, type FlexitestMovement } from "../formulas";
import { MAX_TEXT } from "./screening";

export const MOVEMENT_MODULE = "movement" as const;
/** The variant of the instrument (handoff 6): a test of another number of movements or another scale is never summed with this one. */
export const FLEXITEST_VARIANT = "pdf_15_movements_1_to_4" as const;
/** How each stored variant is named on screen. */
export const FLEXITEST_VARIANT_LABEL: Record<typeof FLEXITEST_VARIANT, string> = { [FLEXITEST_VARIANT]: "versão do PDF, 15 movimentos de 1 a 4" };
export const FLEXITEST_LEVELS = [1, 2, 3, 4] as const satisfies readonly FlexitestLevel[];
export const FLEXITEST_CODES = FLEXITEST_MOVEMENTS.map((movement) => movement.code) as [FlexitestMovement, ...FlexitestMovement[]];
export const FLEXITEST_LABEL = Object.fromEntries(FLEXITEST_MOVEMENTS.map((movement) => [movement.code, movement.label])) as Record<FlexitestMovement, string>;

const text = z.string().max(MAX_TEXT).default("");
const level = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const movementSchema = z
  .object({
    flexitest: z
      .object({
        variant: z.literal(FLEXITEST_VARIANT).default(FLEXITEST_VARIANT),
        /** The level of each movement assessed; a movement not assessed is absent (never 0). */
        levels: z.partialRecord(z.enum(FLEXITEST_CODES), level).default({}),
        /** Handoff 6: `classificationManual?` — what the professional writes, never computed (no table is homologated). */
        classificationManual: text,
        notes: text,
      })
      .strict()
      .default({ variant: FLEXITEST_VARIANT, levels: {}, classificationManual: "", notes: "" }),
  })
  .strict();
export type MovementPayload = z.infer<typeof movementSchema>;
export const EMPTY_MOVEMENT: MovementPayload = movementSchema.parse({});

/** What was stored, read back; anything unknown or invalid reads as the empty module (never as a guess). */
export function readMovement(raw: unknown): MovementPayload {
  const parsed = movementSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_MOVEMENT;
}

/** How many movements have a level, and the total only when all 15 have one (the formula of 0.68, versioned). */
export const flexitestTally = (payload: MovementPayload) => flexitest(payload.flexitest.levels);

/** Nothing in the module: the Flexiteste reads as "Não realizado". */
export function movementEmpty(payload: MovementPayload): boolean {
  const { levels, classificationManual, notes } = payload.flexitest;
  return Object.keys(levels).length === 0 && classificationManual.trim() === "" && notes.trim() === "";
}

/* ---------- The screen's form ---------- */

export interface MovementForm {
  levels: Partial<Record<FlexitestMovement, FlexitestLevel>>;
  classificationManual: string;
  notes: string;
}

export const movementFormFrom = (payload: MovementPayload): MovementForm => ({
  levels: { ...payload.flexitest.levels },
  classificationManual: payload.flexitest.classificationManual,
  notes: payload.flexitest.notes,
});

export const FLEXITEST_CLASSIFICATION_LABEL = "Classificação do Flexiteste";
export const FLEXITEST_NOTES_LABEL = "Observações do Flexiteste";

export type MovementReading = { payload: MovementPayload; problems: [] } | { payload: null; problems: string[] };

/** The screen as the payload to store. A text above the technical ceiling is a problem named by its field, never a cut text. */
export function movementFromForm(form: MovementForm): MovementReading {
  const problems: string[] = [];
  if (form.classificationManual.length > MAX_TEXT) problems.push(FLEXITEST_CLASSIFICATION_LABEL);
  if (form.notes.length > MAX_TEXT) problems.push(FLEXITEST_NOTES_LABEL);
  if (problems.length > 0) return { payload: null, problems };
  const levels: Partial<Record<FlexitestMovement, FlexitestLevel>> = {};
  for (const code of FLEXITEST_CODES) {
    const value = form.levels[code];
    if (value !== undefined) levels[code] = value;
  }
  const parsed = movementSchema.safeParse({ flexitest: { variant: FLEXITEST_VARIANT, levels, classificationManual: form.classificationManual, notes: form.notes } });
  if (!parsed.success) return { payload: null, problems: movementIssueNames(parsed.error.issues) };
  return { payload: parsed.data, problems: [] };
}

/** The names of the fields a refused payload has wrong (a check on the server, where the payload did not come from this screen). */
export function movementIssueNames(issues: readonly { path: readonly PropertyKey[] }[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const [, second, third] = issue.path.map(String);
    if (second === "levels" && third && Object.hasOwn(FLEXITEST_LABEL, third)) names.add(FLEXITEST_LABEL[third as FlexitestMovement]);
    else if (second === "classificationManual") names.add(FLEXITEST_CLASSIFICATION_LABEL);
    else if (second === "notes") names.add(FLEXITEST_NOTES_LABEL);
    else names.add("Flexiteste");
  }
  return [...names];
}

export const movementProblemsMessage = (problems: string[]) =>
  problems.length === 0
    ? "Confira o Flexiteste: algum valor não é aceito."
    : `Confira ${problems.length === 1 ? "o campo" : "os campos"} ${problems.join(", ")}: cada movimento tem nível de 1 a 4 ou fica sem nível, e cada texto tem até ${MAX_TEXT} caracteres.`;

/** "15 de 15 preenchidos". */
export const filledText = (filled: number) => `${filled} de ${FLEXITEST_CODES.length} ${filled === 1 ? "preenchido" : "preenchidos"}`;
/** "32 pontos", or why there is no total yet. */
export const totalText = (total: number | null) => (total === null ? `Só com os ${FLEXITEST_CODES.length} movimentos` : `${total} ${total === 1 ? "ponto" : "pontos"}`);

/** The line said wherever a Flexiteste classification shows: it is the professional's, not the system's. */
export const FLEXITEST_CLASSIFICATION_NOTE =
  "Escrita pelo profissional. O sistema não classifica: o PDF não traz a tabela, que depende de homologação (escala, faixa etária, sexo e versão).";
