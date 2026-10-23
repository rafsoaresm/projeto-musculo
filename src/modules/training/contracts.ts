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
    exercisesPerSession: z.number().int().min(3).max(8),
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
