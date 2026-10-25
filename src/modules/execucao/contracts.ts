import { z } from "zod";

/**
 * What a student logs about a workout. Everything here is what the student typed or ticked:
 * the tool does not fill, suggest or interpret any of it, and a report of pain or discomfort is
 * stored as reported and shown to the professional, never judged.
 */
export const MAX_SETS = 12;
export const MAX_EXERCISES = 30;
/** A log can be made for today or for one of the last days, never for the future. */
export const MAX_DAYS_BACK = 14;
/** The student can correct a log without a report of pain for this long. */
export const EDIT_WINDOW_HOURS = 24;

export const PAIN_ADVICE =
  "Em caso de dor ou desconforto, interrompa o treino e fale com o seu profissional.";
export const PAIN_SAVED_TEXT =
  "Registramos o relato de dor ou desconforto e o seu profissional vai poder ler. Ele não é apagado nem alterado depois.";

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

const setSchema = z
  .object({
    reps: whole(0, 999),
    // One decimal is what a plate or a dial can show.
    loadKg: z
      .number()
      .min(0)
      .max(1000)
      .nullish()
      .transform((value) => (value === null || value === undefined ? null : Math.round(value * 10) / 10)),
  })
  .strict();

const exerciseSchema = z
  .object({
    prescribedExerciseId: z.string().min(1).max(64),
    done: z.boolean().default(false),
    rir: whole(0, 10),
    pain: z.boolean().default(false),
    notes: text(300),
    sets: z.array(setSchema).max(MAX_SETS).default([]),
  })
  .strict();

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const sessionSchema = z
  .object({
    planId: z.string().min(1).max(64),
    phaseIndex: z.number().int().min(1).max(12),
    workoutLabel: z.string().trim().min(1).max(20),
    performedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      }, "DATE_INVALID"),
    effort: whole(0, 10),
    pain: z.boolean().default(false),
    notes: text(500),
    exercises: z.array(exerciseSchema).max(MAX_EXERCISES).default([]),
  })
  .strict();

export interface SessionInput {
  planId: string;
  phaseIndex: number;
  workoutLabel: string;
  performedOn: string;
  effort: number | null;
  /** True when the student reported pain or discomfort for the session or for any exercise. */
  painReported: boolean;
  notes: string | null;
  exercises: Array<{
    prescribedExerciseId: string;
    done: boolean;
    rir: number | null;
    pain: boolean;
    notes: string | null;
    sets: Array<{ reps: number | null; loadKg: number | null }>;
  }>;
}

/**
 * `today` is the calendar day in the student's zone. A row only exists for an exercise the student
 * did, or that carries a note or a report of pain (for example "I skipped it, my shoulder hurt"):
 * the others are left out, which reads as "not logged", not as "not done".
 */
export function parseSession(raw: unknown, today: string): SessionInput {
  const parsed = sessionSchema
    .superRefine((value, context) => {
      const back = daysBetween(value.performedOn, today);
      if (back < 0 || back > MAX_DAYS_BACK)
        context.addIssue({ code: "custom", path: ["performedOn"], message: "DATE_OUT_OF_RANGE" });
      const ids = value.exercises.map((exercise) => exercise.prescribedExerciseId);
      if (new Set(ids).size !== ids.length)
        context.addIssue({ code: "custom", path: ["exercises"], message: "EXERCISE_DUPLICATE" });
    })
    .parse(raw);
  const exercises = parsed.exercises
    .map((exercise) => ({
      prescribedExerciseId: exercise.prescribedExerciseId,
      done: exercise.done,
      // A skipped exercise has no sets and no effort: those only exist for what was done.
      rir: exercise.done ? exercise.rir : null,
      pain: exercise.pain,
      notes: exercise.notes,
      sets: exercise.done
        ? exercise.sets.filter((set) => set.reps !== null || set.loadKg !== null)
        : [],
    }))
    .filter((exercise) => exercise.done || exercise.pain || exercise.notes);
  return {
    planId: parsed.planId,
    phaseIndex: parsed.phaseIndex,
    workoutLabel: parsed.workoutLabel,
    performedOn: parsed.performedOn,
    effort: parsed.effort,
    painReported: parsed.pain || exercises.some((exercise) => exercise.pain),
    notes: parsed.notes,
    exercises,
  };
}

/** The calendar day in the zone the product uses for people. */
export const todayInBrazil = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);

/** A load typed in the browser: "22,5" and "22.5" are the same. Null for anything that is not a number. */
export function parseLoadText(value: string): number | null {
  const plain = value.trim().replace(",", ".");
  return /^\d{1,4}(\.\d{1,2})?$/.test(plain) ? Number(plain) : null;
}
