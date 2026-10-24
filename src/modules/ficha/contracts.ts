import { z } from "zod";

/**
 * The student's file, with the fields and the allowed values of the master document,
 * sections 6.1 to 6.4. Everything is optional: a professional fills what the student told them.
 * Nothing here is clinical advice, and no field decides a prescription by itself.
 */
export const GENDERS = ["Feminino", "Masculino", "Outro", "Prefere não informar"] as const;
export const GOALS = [
  "Hipertrofia",
  "Força",
  "Condicionamento / emagrecimento",
  "Saúde e aptidão geral",
  "Performance esportiva",
  "Retorno ao treinamento",
] as const;
export const LEVELS = ["Iniciante", "Intermediário", "Avançado"] as const;
/** The suggestions of the document. Any whole number of minutes from 10 to 300 is accepted. */
export const SESSION_MINUTES = [30, 45, 60, 75, 90] as const;

const calendarDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, label)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, label);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
const whole = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullish().transform((value) => value ?? null);

const base = z
  .object({
    birthDate: calendarDate("DATE_INVALID").nullish().transform((value) => value ?? null),
    gender: z.enum(GENDERS).nullish().transform((value) => value ?? null),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .email()
      .nullish()
      .or(z.literal(""))
      .transform((value) => (value ? value : null)),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9 +().-]{6,30}$/)
      .nullish()
      .or(z.literal(""))
      .transform((value) => (value ? value : null)),
    heightCm: whole(50, 260),
    weightKg: z
      .number()
      .min(10)
      .max(500)
      .nullish()
      .transform((value) => (value === null || value === undefined ? null : Math.round(value * 10) / 10)),
    bodyMeasuredOn: calendarDate("DATE_INVALID").nullish().transform((value) => value ?? null),
    goal: z.enum(GOALS).nullish().transform((value) => value ?? null),
    level: z.enum(LEVELS).nullish().transform((value) => value ?? null),
    daysPerWeek: whole(1, 7),
    sessionMinutes: whole(10, 300),
    location: text(120),
    equipment: text(500),
    experience: text(1000),
    injuries: text(1000),
    surgeries: text(1000),
    pains: text(1000),
    limitations: text(1000),
    medicationsConditions: text(1000),
    relevantNotes: text(1000),
    preferredExercises: text(500),
    dislikedExercises: text(500),
    excludedExercises: text(500),
    professionalNotes: text(1000),
  })
  .strict();

export type ProfileInput = z.output<typeof base>;

/** A birth date cannot be in the future and a measurement date cannot either. */
export function parseProfile(raw: unknown, today = new Date()): ProfileInput {
  const limit = today.toISOString().slice(0, 10);
  return base
    .superRefine((value, context) => {
      if (value.birthDate && (value.birthDate > limit || value.birthDate < "1900-01-01"))
        context.addIssue({ code: "custom", path: ["birthDate"], message: "DATE_INVALID" });
      if (value.bodyMeasuredOn && value.bodyMeasuredOn > limit)
        context.addIssue({ code: "custom", path: ["bodyMeasuredOn"], message: "DATE_INVALID" });
    })
    .parse(raw);
}

/** Whole years on a given day, from a calendar date. */
export function ageOn(birthDate: string, day: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export const emptyProfile: ProfileInput = {
  birthDate: null, gender: null, email: null, phone: null, heightCm: null, weightKg: null,
  bodyMeasuredOn: null, goal: null, level: null, daysPerWeek: null, sessionMinutes: null,
  location: null, equipment: null, experience: null, injuries: null, surgeries: null,
  pains: null, limitations: null, medicationsConditions: null, relevantNotes: null,
  preferredExercises: null, dislikedExercises: null, excludedExercises: null, professionalNotes: null,
};
