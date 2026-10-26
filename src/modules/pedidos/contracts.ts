import { z } from "zod";

/**
 * Requests from the data subject: what a student can ask about their own data, and how the
 * professional answers. The tool records the request, shows the deadline and carries out only what
 * it can (erasing the stored photos). It does not decide a request, does not guess what the law
 * requires and does not answer in the professional's name.
 */

/** Days the professional has to answer (legal pack, question 7: 15 days, by the professional). */
export const ANSWER_DAYS = 15;

export const REQUEST_KINDS = [
  "ACCESS",
  "CORRECTION",
  "PHOTOS_DELETION",
  "DATA_DELETION",
  "ACCEPTANCE_WITHDRAWAL",
  "OTHER",
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_KIND_LABEL: Record<RequestKind, string> = {
  ACCESS: "Receber uma cópia dos meus dados",
  CORRECTION: "Corrigir um dado meu",
  PHOTOS_DELETION: "Apagar as minhas fotos",
  DATA_DELETION: "Excluir ou anonimizar os meus dados",
  ACCEPTANCE_WITHDRAWAL: "Retirar o meu aceite dos termos",
  OTHER: "Outro pedido sobre os meus dados",
};

/** What the screen says about what happens, in plain words, next to each kind. */
export const REQUEST_KIND_HELP: Record<RequestKind, string> = {
  ACCESS: "O seu profissional responde com o que a ferramenta guarda sobre você.",
  CORRECTION: "Diga qual dado está errado e como deveria ser.",
  PHOTOS_DELETION:
    "Quando o seu profissional atender, as fotos guardadas são apagadas do armazenamento e deixam de aparecer. Fica o registro de que existiram e de que foram apagadas a seu pedido. Isso não retira a sua autorização para fotos novas: faça isso acima, em “Fotos de postura”.",
  DATA_DELETION:
    "Alguns registros ficam congelados de propósito (treino entregue, avaliação registrada). O seu profissional responde o que pode ser apagado e o que a lei manda manter.",
  ACCEPTANCE_WITHDRAWAL: "O seu profissional responde o que muda no seu atendimento e nos seus dados.",
  OTHER: "Conte o que você precisa.",
};

export const REQUEST_OUTCOMES = ["FULFILLED", "PARTIALLY_FULFILLED", "DECLINED", "CANCELLED"] as const;
export type RequestOutcome = (typeof REQUEST_OUTCOMES)[number];

export const OUTCOME_LABEL: Record<RequestOutcome, string> = {
  FULFILLED: "Atendido",
  PARTIALLY_FULFILLED: "Atendido em parte",
  DECLINED: "Não atendido",
  CANCELLED: "Cancelado",
};

/** A cancellation is the student's own act, so each side names who did it. */
export const outcomeLabel = (outcome: RequestOutcome, audience: "student" | "professional") =>
  outcome === "CANCELLED"
    ? audience === "student"
      ? "Cancelado por você"
      : "Cancelado pelo aluno"
    : OUTCOME_LABEL[outcome];

export const REQUEST_NOTICE =
  "O seu profissional vê o pedido quando abrir a ferramenta: ela não envia e-mail nem aviso. O prazo de resposta é de 15 dias; se passar sem resposta, fale com ele por outro canal.";

const MESSAGE_MAX = 1000;
const NOTE_MAX = 2000;

/** The date the answer is due: 15 calendar days after the request, at the same time of day. */
export function dueAtFor(createdAt: string): string {
  const due = new Date(createdAt);
  due.setUTCDate(due.getUTCDate() + ANSWER_DAYS);
  return due.toISOString();
}

export const isOverdue = (dueAt: string, now: Date = new Date()) => now.toISOString() > dueAt;

const requestSchema = z
  .object({
    kind: z.enum(REQUEST_KINDS),
    message: z
      .string()
      .trim()
      .max(MESSAGE_MAX)
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .strict();

export interface RequestInput {
  kind: RequestKind;
  message: string | null;
}

/**
 * A request has a kind and, for a correction or an open request, words: without them the professional
 * would not know what is being asked. Throws a ZodError for anything else.
 */
export function parseRequest(raw: unknown): RequestInput {
  const parsed = requestSchema.parse(raw);
  if ((parsed.kind === "CORRECTION" || parsed.kind === "OTHER") && !parsed.message)
    throw new z.ZodError([{ code: "custom", path: ["message"], message: "REQUEST_MESSAGE_REQUIRED" }]);
  return parsed;
}

/** What the professional can answer through the form. Erasing photos has its own action. */
export const ANSWER_OUTCOMES = ["FULFILLED", "PARTIALLY_FULFILLED", "DECLINED"] as const;
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];

const answerSchema = z
  .object({
    outcome: z.enum(ANSWER_OUTCOMES),
    note: z
      .string()
      .trim()
      .max(NOTE_MAX)
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .strict();

export interface AnswerInput {
  outcome: AnswerOutcome;
  note: string | null;
}

/** A refusal or a partial answer says why or what was left out; the student reads it. */
export function parseAnswer(raw: unknown): AnswerInput {
  const parsed = answerSchema.parse(raw);
  if (parsed.outcome !== "FULFILLED" && !parsed.note)
    throw new z.ZodError([{ code: "custom", path: ["note"], message: "ANSWER_NOTE_REQUIRED" }]);
  return parsed;
}
