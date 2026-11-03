import { z } from "zod";
import { MAX_DAYS_BACK, daysBetween } from "@/modules/execucao/contracts";

/**
 * What a student says in a check-in. Everything here is what the student chose or typed: the tool
 * does not fill, suggest, score or interpret any of it, and a report of discomfort is stored as
 * reported and shown to the professional, never judged. Nothing here changes a plan.
 */

/** How recovered the student feels. The number is what is kept; the words are what the screen shows. */
export const RECOVERY_LABELS: Record<number, string> = {
  1: "Muito cansado(a)",
  2: "Cansado(a)",
  3: "Mais ou menos",
  4: "Recuperado(a)",
  5: "Totalmente recuperado(a)",
};

export const CHECKIN_URGENCY_NOTICE =
  "Este registro avisa o seu profissional, mas não é um canal de urgência: ele lê quando abrir a ferramenta, sem prazo definido. Se estiver com dor forte ou se sentir mal, procure atendimento de saúde.";
export const DISCOMFORT_SAVED_TEXT =
  "Registramos o relato de desconforto e o seu profissional vai poder ler. Ele não é apagado nem alterado depois.";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const whole = (min: number, max: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((value) => value ?? null);

/**
 * What the check-in of a student asks (slice 0.87). The professional chooses which of the existing questions are asked and may add
 * questions of their own, answered with text only: the tool adds no scale. The report of discomfort is always asked, it is not a
 * choice (it is the student's channel for pain, PENDENCIAS T5). A student without a version is asked everything, as before 0.87.
 */
export interface CheckinQuestion {
  id: string;
  text: string;
}
export interface CheckinFormShape {
  askEffort: boolean;
  askRecovery: boolean;
  askNotes: boolean;
  questions: CheckinQuestion[];
}
export const DEFAULT_CHECKIN_FORM: CheckinFormShape = { askEffort: true, askRecovery: true, askNotes: true, questions: [] };
/** Product limits of the form, not clinical ones. */
export const MAX_OWN_QUESTIONS = 5;
export const QUESTION_MAX = 200;
export const ANSWER_MAX = 500;
/** The longest reply of the professional to a check-in (also enforced by migration 0037). A product limit, not a clinical one. */
export const REPLY_MAX = 1000;

const QUESTION_ID = /^[a-z0-9-]{1,40}$/;

const formSchema = z
  .object({
    askEffort: z.boolean(),
    askRecovery: z.boolean(),
    askNotes: z.boolean(),
    questions: z
      .array(
        z
          .object({
            id: z.string().regex(QUESTION_ID).nullish(),
            text: z.string().trim().min(1).max(QUESTION_MAX),
          })
          .strict(),
      )
      .max(MAX_OWN_QUESTIONS),
  })
  .strict();

/**
 * The professional's choice. A question keeps its id when it comes back unchanged in place (so a check-in answered before still
 * finds it in its own version, which is frozen anyway); a new one gets a fresh id. Throws a ZodError otherwise.
 */
export function parseCheckinForm(raw: unknown, newId: () => string = () => crypto.randomUUID()): CheckinFormShape {
  const parsed = formSchema.parse(raw);
  const seen = new Set<string>();
  const questions = parsed.questions.map((question) => {
    let id = question.id ?? newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    return { id, text: question.text };
  });
  return { askEffort: parsed.askEffort, askRecovery: parsed.askRecovery, askNotes: parsed.askNotes, questions };
}

/** Two forms ask the same thing (a save that changes nothing writes no version). */
export function sameCheckinForm(a: CheckinFormShape, b: CheckinFormShape): boolean {
  return (
    a.askEffort === b.askEffort &&
    a.askRecovery === b.askRecovery &&
    a.askNotes === b.askNotes &&
    a.questions.length === b.questions.length &&
    a.questions.every((question, index) => question.text === b.questions[index].text)
  );
}

/** The stored list of questions, read defensively: anything malformed is left out, never guessed. */
export function readQuestions(json: string | null): CheckinQuestion[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) =>
      item && typeof item === "object" && typeof item.id === "string" && typeof item.text === "string"
        ? [{ id: item.id, text: item.text }]
        : [],
    );
  } catch {
    return [];
  }
}

export interface CheckinAnswer {
  questionId: string;
  answer: string;
}
/** The stored answers, read defensively. */
export function readAnswers(json: string | null): CheckinAnswer[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) =>
      item && typeof item === "object" && typeof item.questionId === "string" && typeof item.answer === "string"
        ? [{ questionId: item.questionId, answer: item.answer }]
        : [],
    );
  } catch {
    return [];
  }
}

const checkinSchema = z
  .object({
    effort: whole(0, 10),
    recovery: whole(1, 5),
    discomfort: z.boolean().default(false),
    discomfortNotes: text(500),
    notes: text(500),
    answers: z
      .array(z.object({ questionId: z.string().regex(QUESTION_ID), answer: text(ANSWER_MAX) }).strict())
      .max(MAX_OWN_QUESTIONS)
      .default([]),
  })
  .strict();

export interface CheckinInput {
  effort: number | null;
  recovery: number | null;
  discomfort: boolean;
  /** Only kept together with a report of discomfort. */
  discomfortNotes: string | null;
  notes: string | null;
  /** Text answers to the professional's own questions; an empty answer is left out (not answered, never "0"). */
  answers: CheckinAnswer[];
}

/**
 * A check-in with nothing in it says nothing, so at least one answer is needed: an effort, a recovery, a report of discomfort, a note
 * or an answer to one of the professional's questions. What the form does not ask is not kept. Throws a ZodError otherwise, and for
 * anything outside the scales.
 */
export function parseCheckin(raw: unknown, form: CheckinFormShape = DEFAULT_CHECKIN_FORM): CheckinInput {
  const parsed = checkinSchema.parse(raw);
  const asked = new Set(form.questions.map((question) => question.id));
  const answers = parsed.answers.flatMap((item) =>
    item.answer !== null && asked.has(item.questionId) ? [{ questionId: item.questionId, answer: item.answer }] : [],
  );
  const input: CheckinInput = {
    effort: form.askEffort ? parsed.effort : null,
    recovery: form.askRecovery ? parsed.recovery : null,
    discomfort: parsed.discomfort,
    discomfortNotes: parsed.discomfort ? parsed.discomfortNotes : null,
    notes: form.askNotes ? parsed.notes : null,
    answers: answers.filter((item, index) => answers.findIndex((other) => other.questionId === item.questionId) === index),
  };
  const answered =
    input.effort !== null || input.recovery !== null || input.discomfort || input.notes !== null || input.answers.length > 0;
  if (!answered)
    throw new z.ZodError([{ code: "custom", path: ["checkin"], message: "CHECKIN_EMPTY", input: raw }]);
  return input;
}

/** The day of a check-in: today or one of the last MAX_DAYS_BACK days (the window of the workout log, PENDENCIAS T2). */
export function checkinDayAllowed(day: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day) return false;
  const back = daysBetween(day, today);
  return back >= 0 && back <= MAX_DAYS_BACK;
}

export const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
