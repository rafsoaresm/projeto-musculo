/**
 * The "Triagem" step of the new assessment (handoff V2 section 3.1, Figma AV-02), stored as two modules of the draft, each saved with the
 * assessment's revision like "Medidas":
 * - "profile": the goals of the training (several at once) and the free field of additional goals and notes (step 1 of the handoff's table);
 * - "screening": the clinical anamnesis, current and past physical activity, and the PAR-Q of the document with the professional's decision
 *   when any answer is "Sim" (step 2 of the handoff's table).
 * Pure: no screen and no database here, so the server checks a save with the same rules the screen uses. Nothing is decided automatically: a
 * "Sim" is a flag that asks for a human decision; a question not answered is pending, never a "Não". Who decided and when is recorded when the
 * assessment is finalized (slice 0.77), not typed here.
 */
import { z } from "zod";
import {
  ACTIVITY_CURRENT,
  ACTIVITY_PAST,
  ANAMNESIS,
  ANAMNESIS_ANSWERS,
  GOALS,
  PARQ,
  PARQ_ANSWERS,
  PARQ_DECISIONS,
  PARQ_INSTRUMENT,
} from "../catalog";
import { parseDecimal } from "../formulas";
import { MAX_MEASURE } from "./composition";

export const PROFILE_MODULE = "profile" as const;
export const SCREENING_MODULE = "screening" as const;

type Codes<T extends Record<string, string>> = [keyof T & string, ...(keyof T & string)[]];
const codesOf = <T extends Record<string, string>>(record: T) => Object.keys(record) as Codes<T>;

export const GOAL_CODES = codesOf(GOALS);
export const ANAMNESIS_CODES = codesOf(ANAMNESIS);
export const PARQ_CODES = codesOf(PARQ);
export const ANAMNESIS_ANSWER_CODES = codesOf(ANAMNESIS_ANSWERS);
export const PARQ_ANSWER_CODES = codesOf(PARQ_ANSWERS);
export const PARQ_DECISION_CODES = codesOf(PARQ_DECISIONS);
export type GoalCode = (typeof GOAL_CODES)[number];
export type AnamnesisCode = (typeof ANAMNESIS_CODES)[number];
export type ParqCode = (typeof PARQ_CODES)[number];
export type AnamnesisAnswer = (typeof ANAMNESIS_ANSWER_CODES)[number];
export type ParqAnswer = (typeof PARQ_ANSWER_CODES)[number];
export type ParqDecision = (typeof PARQ_DECISION_CODES)[number];

/** A technical ceiling for a free text, so a paste by mistake is not stored; the same size as a review's basis. */
export const MAX_TEXT = 1000;

const text = z.string().max(MAX_TEXT).default("");
const yesNo = z.enum(["yes", "no"]).nullable().default(null);
/** Frequency is a value with its unit (handoff 3.1: "valor + unidade por_semana, não texto livre '3x'"); not informed is null, never 0. */
const frequency = z
  .object({ value: z.number().finite().positive().max(MAX_MEASURE), unit: z.literal("por_semana") })
  .strict()
  .nullable()
  .default(null);

/* ---------- Module "profile" ---------- */

export const profileSchema = z
  .object({
    goals: z
      .array(z.enum(GOAL_CODES))
      .max(GOAL_CODES.length)
      .refine((goals) => new Set(goals).size === goals.length, "Objetivo repetido.")
      .default([]),
    goalNotes: text,
  })
  .strict();
export type ProfilePayload = z.infer<typeof profileSchema>;
export const EMPTY_PROFILE: ProfilePayload = profileSchema.parse({});

/* ---------- Module "screening" ---------- */

const anamnesisEntry = z.object({ answer: z.enum(ANAMNESIS_ANSWER_CODES).nullable().default(null), details: text }).strict();
const currentActivity = z.object({ practices: yesNo, activities: text, frequency, duration: text, notes: text }).strict();
const pastActivity = z.object({ practiced: yesNo, activities: text, totalTime: text, frequency, notes: text }).strict();

export const screeningSchema = z
  .object({
    /** A question with no entry was not answered yet. */
    anamnesis: z.partialRecord(z.enum(ANAMNESIS_CODES), anamnesisEntry).default({}),
    activity: z.object({ current: currentActivity.prefault({}), past: pastActivity.prefault({}) }).strict().prefault({}),
    parq: z
      .object({
        /** The instrument and its version (handoff 3.1 and 6): another instrument is another form, never this one replaced silently. */
        instrument: z.literal(PARQ_INSTRUMENT.id).default(PARQ_INSTRUMENT.id),
        version: z.literal(PARQ_INSTRUMENT.version).default(PARQ_INSTRUMENT.version),
        /** A question with no entry reads as "Não respondido". */
        answers: z.partialRecord(z.enum(PARQ_CODES), z.enum(PARQ_ANSWER_CODES)).default({}),
        /** The professional's decision on a "Sim" (handoff 6: parq.professionalReview); reviewer and time are added at finalize. */
        professionalReview: z
          .object({
            decision: z.enum(PARQ_DECISION_CODES).nullable().default(null),
            notes: text,
            /** Written by the server when the assessment is finalized (who decided and when), never taken from a save: see `draftScreening`. */
            reviewedAt: z.string().max(40).optional(),
            reviewerUserId: z.string().max(80).optional(),
          })
          .strict()
          .prefault({}),
        /** Any "Sim" (handoff 6: parq.riskFlag), derived and written by the server when the assessment is finalized; absent in a draft. */
        riskFlag: z.boolean().optional(),
      })
      .strict()
      .prefault({}),
  })
  .strict();
export type ScreeningPayload = z.infer<typeof screeningSchema>;
export const EMPTY_SCREENING: ScreeningPayload = screeningSchema.parse({});

/** What was stored, read back; anything unknown or invalid reads as the empty module (never as a guess). */
export function readProfile(raw: unknown): ProfilePayload {
  const parsed = profileSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_PROFILE;
}
export function readScreening(raw: unknown): ScreeningPayload {
  const parsed = screeningSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_SCREENING;
}

/**
 * The screening as a draft keeps it: what the server writes at finalize (the derived flag, who decided and when) is never taken from a save, so a
 * screen cannot claim a decision was recorded.
 */
export function draftScreening(payload: ScreeningPayload): ScreeningPayload {
  const { decision, notes } = payload.parq.professionalReview;
  return { ...payload, parq: { instrument: payload.parq.instrument, version: payload.parq.version, answers: payload.parq.answers, professionalReview: { decision, notes } } };
}

/* ---------- The PAR-Q rules ---------- */

export const parqAnswer = (payload: ScreeningPayload, code: ParqCode): ParqAnswer => payload.parq.answers[code] ?? "unanswered";
/** Any "Sim": a flag of attention that asks for the professional's decision; never a verdict of fitness. */
export const parqHasYes = (payload: ScreeningPayload) => PARQ_CODES.some((code) => parqAnswer(payload, code) === "yes");
export const parqUnanswered = (payload: ScreeningPayload) => PARQ_CODES.filter((code) => parqAnswer(payload, code) === "unanswered");

/**
 * What the triagem still lacks to be finalized (used by the review step, slice 0.77): every PAR-Q question answered Sim or Não, and, when any is
 * "Sim", the professional's decision with a note. The anamnesis, the activity and the goals may stay partial.
 */
export function screeningPending(payload: ScreeningPayload): string[] {
  const pending: string[] = [];
  const unanswered = parqUnanswered(payload).length;
  if (unanswered > 0) pending.push(`PAR-Q: ${unanswered} de ${PARQ_CODES.length} ${unanswered === 1 ? "pergunta sem resposta" : "perguntas sem resposta"}`);
  if (parqHasYes(payload)) {
    const review = payload.parq.professionalReview;
    if (review.decision === null) pending.push("PAR-Q com “Sim”: registre a decisão profissional");
    if (review.notes.trim() === "") pending.push("PAR-Q com “Sim”: escreva a nota da decisão");
  }
  return pending;
}

/* ---------- The screen's text ---------- */

/** What the screen holds: the texts as typed and the frequencies as text, so nothing is rounded or lost while typing. */
export interface TriagemForm {
  goals: GoalCode[];
  goalNotes: string;
  anamnesis: Record<AnamnesisCode, { answer: AnamnesisAnswer | null; details: string }>;
  current: { practices: "yes" | "no" | null; activities: string; frequency: string; duration: string; notes: string };
  past: { practiced: "yes" | "no" | null; activities: string; totalTime: string; frequency: string; notes: string };
  parq: Record<ParqCode, ParqAnswer>;
  decision: ParqDecision | null;
  decisionNotes: string;
}

const decimalText = (value: number) => String(value).replace(".", ",");
const frequencyText = (value: { value: number } | null) => (value === null ? "" : decimalText(value.value));

export function triagemFormFrom(profile: ProfilePayload, screening: ScreeningPayload): TriagemForm {
  const { current, past } = screening.activity;
  return {
    goals: GOAL_CODES.filter((code) => profile.goals.includes(code)),
    goalNotes: profile.goalNotes,
    anamnesis: Object.fromEntries(
      ANAMNESIS_CODES.map((code) => [code, { answer: screening.anamnesis[code]?.answer ?? null, details: screening.anamnesis[code]?.details ?? "" }]),
    ) as TriagemForm["anamnesis"],
    current: { practices: current.practices, activities: current.activities, frequency: frequencyText(current.frequency), duration: current.duration, notes: current.notes },
    past: { practiced: past.practiced, activities: past.activities, totalTime: past.totalTime, frequency: frequencyText(past.frequency), notes: past.notes },
    parq: Object.fromEntries(PARQ_CODES.map((code) => [code, parqAnswer(screening, code)])) as TriagemForm["parq"],
    decision: screening.parq.professionalReview.decision,
    decisionNotes: screening.parq.professionalReview.notes,
  };
}

export type ModuleReading<T> = { payload: T; problems: [] } | { payload: null; problems: string[] };

const tooLong = (value: string) => value.length > MAX_TEXT;

export function profileFromForm(form: TriagemForm): ModuleReading<ProfilePayload> {
  if (tooLong(form.goalNotes)) return { payload: null, problems: ["Objetivos adicionais e notas"] };
  return { payload: profileSchema.parse({ goals: GOAL_CODES.filter((code) => form.goals.includes(code)), goalNotes: form.goalNotes }), problems: [] };
}

/**
 * The screening part of the screen as the payload to store. A frequency that is not a positive number, or a text above the technical ceiling,
 * is a problem named by its field, never a 0 or a cut text. A question not touched is left out (it reads as not answered).
 */
export function screeningFromForm(form: TriagemForm): ModuleReading<ScreeningPayload> {
  const problems: string[] = [];
  const checkText = (value: string, name: string) => {
    if (tooLong(value)) problems.push(name);
    return value;
  };
  const readFrequency = (value: string, name: string) => {
    if (value.trim() === "") return null;
    const number = parseDecimal(value);
    if (number === null || !Number.isFinite(number) || number <= 0 || number > MAX_MEASURE) {
      problems.push(name);
      return null;
    }
    return { value: number, unit: "por_semana" as const };
  };
  const anamnesis: Partial<Record<AnamnesisCode, { answer: AnamnesisAnswer | null; details: string }>> = {};
  for (const code of ANAMNESIS_CODES) {
    const entry = form.anamnesis[code];
    if (entry.answer === null && entry.details === "") continue;
    anamnesis[code] = { answer: entry.answer, details: checkText(entry.details, ANAMNESIS[code]) };
  }
  const candidate = {
    anamnesis,
    activity: {
      current: {
        practices: form.current.practices,
        activities: checkText(form.current.activities, `${ACTIVITY_CURRENT.activities} (atual)`),
        frequency: readFrequency(form.current.frequency, `${ACTIVITY_CURRENT.frequency} (atual)`),
        duration: checkText(form.current.duration, ACTIVITY_CURRENT.duration),
        notes: checkText(form.current.notes, `${ACTIVITY_CURRENT.notes} (atividade atual)`),
      },
      past: {
        practiced: form.past.practiced,
        activities: checkText(form.past.activities, `${ACTIVITY_PAST.activities} (passada)`),
        totalTime: checkText(form.past.totalTime, ACTIVITY_PAST.totalTime),
        frequency: readFrequency(form.past.frequency, ACTIVITY_PAST.frequency),
        notes: checkText(form.past.notes, `${ACTIVITY_PAST.notes} (atividade passada)`),
      },
    },
    parq: {
      instrument: PARQ_INSTRUMENT.id,
      version: PARQ_INSTRUMENT.version,
      answers: Object.fromEntries(PARQ_CODES.map((code) => [code, form.parq[code]])),
      professionalReview: { decision: form.decision, notes: checkText(form.decisionNotes, "Nota da decisão") },
    },
  };
  if (problems.length > 0) return { payload: null, problems };
  return { payload: screeningSchema.parse(candidate), problems: [] };
}

/** The message of a refused save, naming the fields. */
export const triagemProblemsMessage = (problems: string[]) =>
  `Confira ${problems.length === 1 ? "o campo" : "os campos"} ${problems.join(", ")}: a frequência é um número positivo de vezes por semana (por exemplo, 3) e cada texto tem até ${MAX_TEXT} caracteres.`;

/** The decision is asked for when any PAR-Q answer is "Sim"; it stays on screen while it holds something, so nothing typed is hidden. */
export const decisionShown = (form: TriagemForm) =>
  PARQ_CODES.some((code) => form.parq[code] === "yes") || form.decision !== null || form.decisionNotes !== "";
