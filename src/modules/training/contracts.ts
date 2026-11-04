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

/**
 * Estrutura v1 (até a 0.93): divisão por letras, 3–6 semanas, 3, 6 ou 12 fases. Continua sendo lida e gravada
 * exatamente como antes; nenhuma revisão salva muda de formato sozinha.
 */
export const phaseSchemaV1 = z
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

export const periodizationInputSchemaV1 = z
  .object({
    startDate: calendarDate,
    phases: z
      .array(phaseSchemaV1)
      .refine((phases) => [3, 6, 12].includes(phases.length), {
        message: "Escolha 3, 6 ou 12 fases.",
      }),
  })
  .strict();

/** Nomes antigos: continuam apontando para a v1. */
export const phaseSchema = phaseSchemaV1;
export type PhaseInputV1 = z.infer<typeof phaseSchemaV1>;
export type PhaseInput = PhaseInputV1;
export type PeriodizationInputV1 = z.infer<typeof periodizationInputSchemaV1>;

/**
 * Limites técnicos da estrutura v2 (não são regra de produto; cada um diz de onde vem).
 */
export const STRUCTURE_LIMITS = {
  /** `prescribed_exercises.phase_index` (0006) e `workout_sessions.phase_index` (0012) têm CHECK 1..12; refazer não é aditivo (Q4). */
  MAX_PHASES: 12,
  /** Duas sessões por dia em todos os dias da semana. */
  MAX_SESSIONS_PER_WEEK: 14,
  /** `workout_label` tem CHECK de 1 a 20 caracteres (0006, 0012). */
  MAX_LABEL: 20,
  /**
   * Total de sessões (Σ semanas × sessões por semana). Provisório: é o maior total que a v1 já permitia
   * (12 fases × 6 semanas × 7 sessões), o que o sistema já grava hoje. A S6 mede a aplicação no pior caso
   * e pode subir este número; baixar nunca, porque estruturas salvas deixariam de ser lidas.
   */
  MAX_OCCURRENCES: 504,
  /** Textos curtos exibidos (nome da fase, nome e foco do treino). */
  MAX_PHASE_NAME: 60,
  MAX_WORKOUT_NAME: 60,
  MAX_FOCUS_NOTE: 160,
  /** Minutos de um treino: até 10 horas, para caber qualquer sessão real sem aceitar um número absurdo digitado. */
  MAX_WORKOUT_MINUTES: 600,
} as const;

/**
 * Rótulo livre de um treino. Sem `|` (o editor de prescrição separa "fase|rótulo"), sem `/` nem `\` (o rótulo
 * vai num segmento do endereço de registro do aluno) e sem caracteres de controle.
 */
export const workoutLabelSchema = z
  .string()
  .trim()
  .min(1, "Dê um rótulo a cada treino.")
  .max(STRUCTURE_LIMITS.MAX_LABEL, `O rótulo do treino tem até ${STRUCTURE_LIMITS.MAX_LABEL} caracteres.`)
  .regex(/^[^|/\\\u0000-\u001f\u007f]+$/, "O rótulo do treino não pode ter |, / ou \\.");

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => (value ? value : null));

/** O que o profissional diz sobre o treino. Só o que é estruturado chega ao motor; a nota é exibida, nunca interpretada. */
export const workoutFocusSchema = z
  .object({
    note: optionalText(STRUCTURE_LIMITS.MAX_FOCUS_NOTE, `O foco do treino tem até ${STRUCTURE_LIMITS.MAX_FOCUS_NOTE} caracteres.`),
    minutes: z
      .number()
      .int()
      .min(1, "Informe os minutos do treino a partir de 1.")
      .max(STRUCTURE_LIMITS.MAX_WORKOUT_MINUTES, `Informe até ${STRUCTURE_LIMITS.MAX_WORKOUT_MINUTES} minutos por treino.`)
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict();

export const workoutSchemaV2 = z
  .object({
    label: workoutLabelSchema,
    name: optionalText(STRUCTURE_LIMITS.MAX_WORKOUT_NAME, `O nome do treino tem até ${STRUCTURE_LIMITS.MAX_WORKOUT_NAME} caracteres.`),
    /** Alvo de exercícios do treino, como na 0.93 (até 20); vazio = sem alvo. 1 porque uma sessão de outra modalidade pode ter um só exercício. */
    exerciseTarget: z
      .number()
      .int()
      .min(1, "O alvo de exercícios começa em 1 (ou fica sem alvo).")
      .max(EXERCISES_PER_SESSION_MAX, `O alvo vai até ${EXERCISES_PER_SESSION_MAX} exercícios por treino.`)
      .nullish()
      .transform((value) => value ?? null),
    focus: workoutFocusSchema.nullish().transform((value) => value ?? null),
  })
  .strict();

export const phaseSchemaV2 = z
  .object({
    name: optionalText(STRUCTURE_LIMITS.MAX_PHASE_NAME, `O nome da fase tem até ${STRUCTURE_LIMITS.MAX_PHASE_NAME} caracteres.`),
    weeks: z.number().int().min(1, "Cada fase tem pelo menos 1 semana."),
    sessionsPerWeek: z
      .number()
      .int()
      .min(1, "Cada semana tem pelo menos 1 sessão.")
      .max(STRUCTURE_LIMITS.MAX_SESSIONS_PER_WEEK, `Até ${STRUCTURE_LIMITS.MAX_SESSIONS_PER_WEEK} sessões por semana (duas por dia).`),
    workouts: z.array(workoutSchemaV2).min(1, "Cada fase tem pelo menos um treino."),
    /** Ordem em que os treinos se repetem ao longo da fase; vazio = a ordem da lista de treinos. */
    rotation: z
      .array(workoutLabelSchema)
      .min(1, "A rotação tem pelo menos uma posição.")
      // Positions past the sessions of the phase are never used; the cap only bounds what is stored.
      .max(STRUCTURE_LIMITS.MAX_OCCURRENCES, `A rotação tem até ${STRUCTURE_LIMITS.MAX_OCCURRENCES} posições.`)
      .nullish().transform((value) => value ?? null),
    /**
     * Dia de cada sessão, contado a partir do primeiro dia de cada semana da fase (0 a 6), em ordem e um por
     * sessão. Vazio = datas não previstas (nunca inventadas).
     */
    trainingDays: z
      .array(z.number().int().min(0).max(6))
      .nullish()
      .transform((value) => value ?? null),
  })
  .strict()
  .superRefine((phase, context) => {
    const labels = phase.workouts.map((workout) => workout.label);
    labels.forEach((label, index) => {
      if (labels.indexOf(label) !== index)
        context.addIssue({ code: "custom", path: ["workouts", index, "label"], message: `O rótulo "${label}" aparece duas vezes nesta fase.` });
    });
    phase.rotation?.forEach((label, index) => {
      if (!labels.includes(label))
        context.addIssue({ code: "custom", path: ["rotation", index], message: `A rotação cita "${label}", que não é um treino desta fase.` });
    });
    if (phase.trainingDays) {
      if (phase.trainingDays.length !== phase.sessionsPerWeek)
        context.addIssue({ code: "custom", path: ["trainingDays"], message: "Escolha um dia para cada sessão da semana." });
      if (phase.trainingDays.some((day, i) => i > 0 && day < phase.trainingDays![i - 1]))
        context.addIssue({ code: "custom", path: ["trainingDays"], message: "Os dias de treino seguem a ordem das sessões da semana." });
    }
  });

/** Último dia aceito pelo calendário (o mesmo da data inicial). */
const LAST_DAY = "2100-12-31";
function endOf(startDate: string, weeks: number): string | null {
  const end = new Date(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(end.getTime())) return null;
  end.setUTCDate(end.getUTCDate() + weeks * 7 - 1);
  return end.toISOString().slice(0, 10);
}

export const periodizationInputSchemaV2 = z
  .object({
    schemaVersion: z.literal(2),
    startDate: calendarDate,
    phases: z
      .array(phaseSchemaV2)
      .min(1, "O ciclo tem pelo menos uma fase.")
      .max(STRUCTURE_LIMITS.MAX_PHASES, `Até ${STRUCTURE_LIMITS.MAX_PHASES} fases (limite técnico do banco).`),
  })
  .strict()
  .superRefine((input, context) => {
    const total = input.phases.reduce((sum, phase) => sum + phase.weeks * phase.sessionsPerWeek, 0);
    if (total > STRUCTURE_LIMITS.MAX_OCCURRENCES)
      context.addIssue({
        code: "custom",
        path: ["phases"],
        message: `O ciclo tem ${total} sessões; o limite técnico atual é ${STRUCTURE_LIMITS.MAX_OCCURRENCES}.`,
      });
    const weeks = input.phases.reduce((sum, phase) => sum + phase.weeks, 0);
    // Weeks are bounded by the total above; this only guards dates past the calendar's range.
    if (weeks > 0 && weeks <= STRUCTURE_LIMITS.MAX_OCCURRENCES && (endOf(input.startDate, weeks) ?? "") > LAST_DAY)
      context.addIssue({ code: "custom", path: ["phases"], message: "O ciclo termina depois de 2100." });
  });

export type WorkoutInputV2 = z.infer<typeof workoutSchemaV2>;
export type PhaseInputV2 = z.infer<typeof phaseSchemaV2>;
export type PeriodizationInputV2 = z.infer<typeof periodizationInputSchemaV2>;
export type PeriodizationInput = PeriodizationInputV1 | PeriodizationInputV2;

/**
 * Lê uma estrutura salva ou enviada: v2 quando `schemaVersion` é 2, v1 caso contrário (as revisões antigas
 * não têm o campo). Lança `ZodError` como antes.
 */
export const periodizationInputSchema = z.union([periodizationInputSchemaV2, periodizationInputSchemaV1]);

export function parsePeriodizationInput(raw: unknown): PeriodizationInput {
  const version =
    raw && typeof raw === "object" && "schemaVersion" in raw ? (raw as { schemaVersion: unknown }).schemaVersion : undefined;
  return version === undefined ? periodizationInputSchemaV1.parse(raw) : periodizationInputSchemaV2.parse(raw);
}

export const isV2Input = (input: PeriodizationInput): input is PeriodizationInputV2 =>
  "schemaVersion" in input && input.schemaVersion === 2;

interface ScheduleDates {
  startDate: string;
  endDate: string;
  totalWeeks: number;
  totalSessions: number;
}
export interface Microcycle {
  index: number;
  startDate: string;
  endDate: string;
  /** Rótulo de cada sessão da semana, em ordem (lido pela execução: `workout-sessions.ts`). */
  sessions: string[];
}
export interface MicrocycleV2 extends Microcycle {
  /** Uma posição por sessão: `slot` começa em 1; a data prevista só existe quando a fase tem dias de treino. */
  slots: Array<{ slot: number; label: string; plannedDate: string | null }>;
}
export type SchedulePhaseV1 = PhaseInputV1 & {
  index: number;
  startDate: string;
  endDate: string;
  microcycles: Microcycle[];
};
export type SchedulePhaseV2 = PhaseInputV2 & {
  index: number;
  startDate: string;
  endDate: string;
  /** A rotação efetiva (a informada ou a ordem dos treinos). */
  rotation: string[];
  microcycles: MicrocycleV2[];
};
export type SchedulePhase = SchedulePhaseV1 | SchedulePhaseV2;

export type PeriodizationScheduleV1 = ScheduleDates & {
  schemaVersion: 1;
  engineVersion: "0.1.0";
  status: "DRAFT";
  phases: SchedulePhaseV1[];
};
export type PeriodizationScheduleV2 = ScheduleDates & {
  schemaVersion: 2;
  engineVersion: "0.2.0";
  status: "DRAFT";
  phases: SchedulePhaseV2[];
};
export type PeriodizationSchedule = PeriodizationScheduleV1 | PeriodizationScheduleV2;

export const isV2Phase = (phase: SchedulePhase): phase is SchedulePhaseV2 => "workouts" in phase;
