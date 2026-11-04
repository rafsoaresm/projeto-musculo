import { z } from "zod";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      value >= "2000-01-01" &&
      value <= "2100-12-31"
    );
  }, "Informe uma data válida entre 2000 e 2100.");

/** "Alvo de exercícios por treino": a target the professional picks, 3 to 20 (user, 03/11/2026; it was 3 to 8 before 0.93). */
export const EXERCISES_PER_SESSION_MIN = 3;
export const EXERCISES_PER_SESSION_MAX = 20;
export const EXERCISES_PER_SESSION_OPTIONS = Array.from(
  { length: EXERCISES_PER_SESSION_MAX - EXERCISES_PER_SESSION_MIN + 1 },
  (_, i) => EXERCISES_PER_SESSION_MIN + i,
);

export const phaseSchema = z
  .object({
    weeks: z.number().int().min(3).max(6),
    sessionsPerWeek: z.number().int().min(1).max(7),
    split: z.enum([
      "Full Body",
      "AB",
      "ABC",
      "ABCD",
      "ABCDE",
      "ABCDEF",
      "ABCDEFG",
    ]),
    exercisesPerSession: z.number().int().min(EXERCISES_PER_SESSION_MIN).max(EXERCISES_PER_SESSION_MAX),
  })
  .strict();

export const periodizationInputSchema = z
  .object({
    startDate: calendarDate,
    phases: z
      .array(phaseSchema)
      .refine((phases) => [3, 6, 12].includes(phases.length), {
        message: "Escolha 3, 6 ou 12 fases.",
      }),
  })
  .strict();

export type PhaseInput = z.infer<typeof phaseSchema>;
export type PeriodizationInput = z.infer<typeof periodizationInputSchema>;
export type PeriodizationSchedule = {
  schemaVersion: 1;
  engineVersion: "0.1.0";
  status: "DRAFT";
  startDate: string;
  endDate: string;
  totalWeeks: number;
  totalSessions: number;
  phases: Array<
    PhaseInput & {
      index: number;
      startDate: string;
      endDate: string;
      microcycles: Array<{
        index: number;
        startDate: string;
        endDate: string;
        sessions: string[];
      }>;
    }
  >;
};
