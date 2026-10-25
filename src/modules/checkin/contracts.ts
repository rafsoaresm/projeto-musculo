import { z } from "zod";

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

const checkinSchema = z
  .object({
    effort: whole(0, 10),
    recovery: whole(1, 5),
    discomfort: z.boolean().default(false),
    discomfortNotes: text(500),
    notes: text(500),
  })
  .strict();

export interface CheckinInput {
  effort: number | null;
  recovery: number | null;
  discomfort: boolean;
  /** Only kept together with a report of discomfort. */
  discomfortNotes: string | null;
  notes: string | null;
}

/**
 * A check-in with nothing in it says nothing, so at least one answer is needed: an effort, a
 * recovery, a report of discomfort or a note. Throws a ZodError otherwise, and for anything outside
 * the scales.
 */
export function parseCheckin(raw: unknown): CheckinInput {
  const parsed = checkinSchema
    .superRefine((value, context) => {
      const answered =
        value.effort !== null || value.recovery !== null || value.discomfort || value.notes !== null;
      if (!answered) context.addIssue({ code: "custom", path: ["checkin"], message: "CHECKIN_EMPTY" });
    })
    .parse(raw);
  return {
    effort: parsed.effort,
    recovery: parsed.recovery,
    discomfort: parsed.discomfort,
    discomfortNotes: parsed.discomfort ? parsed.discomfortNotes : null,
    notes: parsed.notes,
  };
}
