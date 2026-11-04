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

/** How a load typed by the student was counted (0043). Optional, never filled in. */
export const LOAD_BASES = ["TOTAL", "PER_HAND", "PER_SIDE", "MACHINE_STACK", "BODYWEIGHT", "ASSISTANCE", "NONE"] as const;
export type LoadBasis = (typeof LOAD_BASES)[number];
export const LOAD_BASIS_LABEL: Record<LoadBasis, string> = {
  TOTAL: "Total",
  PER_HAND: "Por mão",
  PER_SIDE: "Por lado",
  MACHINE_STACK: "Placas da máquina",
  BODYWEIGHT: "Peso do corpo",
  ASSISTANCE: "Assistência",
  NONE: "Sem carga",
};

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
    // Optional per-set fields of 0043 (decided 04/11/2026, Q7: optional and collapsed). Absent is "not informed", never 0.
    rir: whole(0, 10),
    durationSeconds: whole(0, 86_400),
    distanceMeters: z
      .number()
      .min(0)
      .max(1_000_000)
      .nullish()
      .transform((value) => (value === null || value === undefined ? null : Math.round(value * 10) / 10)),
    loadBasis: z.enum(LOAD_BASES).nullish().transform((value) => value ?? null),
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

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const sessionSchema = z
  .object({
    planId: z.string().min(1).max(64),
    /** The session of the week being logged: required for OCCURRENCE revisions, refused for TEMPLATE ones (0043). */
    occurrenceId: z
      .string()
      .min(1)
      .max(64)
      .nullish()
      .transform((value) => value ?? null),
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

export interface SetInput {
  reps: number | null;
  loadKg: number | null;
  rir: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  loadBasis: LoadBasis | null;
}
export interface SessionInput {
  planId: string;
  occurrenceId: string | null;
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
    sets: SetInput[];
  }>;
}

/** A set row is kept when the student typed anything in it. */
const typedSomething = (set: SetInput) =>
  set.reps !== null || set.loadKg !== null || set.rir !== null || set.durationSeconds !== null || set.distanceMeters !== null;

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
        ? exercise.sets.filter(typedSomething)
        : [],
    }))
    .filter((exercise) => exercise.done || exercise.pain || exercise.notes);
  return {
    planId: parsed.planId,
    occurrenceId: parsed.occurrenceId,
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

/**
 * The optional per-set fields the student typed (0043), in words, for the screens and the copy of the data: "RIR 2 · 45 s · 400 m ·
 * carga por mão". Empty when none was typed (nothing is said, never 0).
 */
export function setExtrasText(set: {
  rir?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  loadBasis?: LoadBasis | null;
}): string {
  const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  return [
    set.rir !== null && set.rir !== undefined ? `RIR ${set.rir}` : null,
    set.durationSeconds !== null && set.durationSeconds !== undefined ? `${set.durationSeconds} s` : null,
    set.distanceMeters !== null && set.distanceMeters !== undefined ? `${number.format(set.distanceMeters)} m` : null,
    set.loadBasis ? `carga: ${LOAD_BASIS_LABEL[set.loadBasis].toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Optional per-set fields offered to the student (Q7: optional, collapsed). */
export type ExtraSetField = "rir" | "durationSeconds" | "distanceMeters" | "loadBasis";

/**
 * Which optional per-set fields the form offers for one exercise, from the metric of its stored dose (0043). TEMPLATE revisions offer
 * none (their form stays as it was). A session dose without a structured metric (typed by the professional) is read as repetitions.
 */
export function extraSetFields(perSession: boolean, metric: string | null | undefined): ExtraSetField[] {
  if (!perSession) return [];
  switch (metric) {
    case "TIME":
      return ["durationSeconds", "rir"];
    case "DISTANCE":
      return ["distanceMeters", "durationSeconds"];
    case "INTERVALS":
    case "CONTINUOUS":
      return ["durationSeconds", "distanceMeters"];
    default:
      return ["rir", "loadBasis"];
  }
}
