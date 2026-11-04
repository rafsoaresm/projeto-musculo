import { REQUEST_KIND_LABEL, outcomeLabel, type RequestKind, type RequestOutcome } from "./contracts";
import { storedDoseText } from "@/modules/prescricao/describe";
import type { LoadBasis } from "@/modules/execucao/contracts";

/**
 * "Baixar meus dados": a copy of what the tool already shows the student, generated for the login
 * that asks. It is a convenience, not the answer to a request: the professional's own record
 * (assessments, the intake sheet, photos and the professional's notes on each entry) is not part of
 * it, and the file says so in words. Nothing here is guessed or filled in; a count that hit its limit
 * is said to have hit it.
 */

/** Increase when the shape of the file changes in a way a reader of it would notice. */
export const EXPORT_FORMAT = "meus-dados/1";

/** A copy is generated this many times an hour per login; the rest wait. */
export const EXPORTS_PER_HOUR = 6;
/** Most entries of each list that go into one student's copy; the file says when it was cut. */
export const EXPORT_CHECKIN_LIMIT = 2000;
export const EXPORT_SESSION_LIMIT = 2000;
export const EXPORT_REQUEST_LIMIT = 500;

export const EXPORT_NOTICE =
  "Esta é uma cópia do que a ferramenta mostra a você. Ela não inclui o registro técnico que o seu profissional guarda (ficha, avaliações, fotos e as anotações dele sobre cada registro): para receber também isso, faça o pedido “Receber uma cópia dos meus dados” em Minha conta.";

export const EXPORT_INCLUDED = [
  "Seus dados de acesso (nome e e-mail).",
  "Os aceites dos termos que você registrou, com a versão.",
  "Os seus check-ins.",
  "Os treinos que você registrou, com séries, repetições e cargas.",
  "O treino entregue pelo seu profissional (a versão mais recente de cada plano).",
  "Os pedidos que você fez sobre os seus dados, com as respostas.",
];

export const EXPORT_NOT_INCLUDED = [
  "A ficha e as avaliações feitas pelo seu profissional.",
  "As fotos de postura.",
  "As anotações do profissional sobre os seus check-ins e treinos.",
  "Registros técnicos da ferramenta (sessões de acesso, endereços de rede, auditoria).",
];

/** What the database hands over, already restricted to the links of the asking login. */
export interface ExportSource {
  generatedAt: Date;
  account: { name: string; email: string };
  acceptances: Array<{ termsVersion: string; termsSha256: string; photosAuthorized: boolean; acceptedAt: string }>;
  links: ExportLinkSource[];
}
export interface ExportLinkSource {
  organizationName: string;
  studentName: string;
  professionalName: string | null;
  since: string;
  checkins: ExportCheckin[];
  checkinsCut: boolean;
  sessions: ExportSession[];
  sessionsCut: boolean;
  plans: ExportPlan[];
  requests: ExportRequest[];
  requestsCut: boolean;
}
export interface ExportCheckin {
  checkedOn: string;
  effort: number | null;
  recovery: number | null;
  discomfort: boolean;
  discomfortNotes: string | null;
  notes: string | null;
  createdAt: string;
  read: boolean;
  /** The professional's own questions of the version the check-in was answered with; an unanswered one is null, never "0". */
  questions: Array<{ question: string; answer: string | null }>;
  /** The professional's replies, oldest first. */
  replies: Array<{ author: string | null; body: string; createdAt: string }>;
}
export interface ExportSession {
  performedOn: string;
  planTitle: string;
  phaseIndex: number;
  workoutLabel: string;
  effort: number | null;
  painReported: boolean;
  notes: string | null;
  createdAt: string;
  read: boolean;
  /** The session of the week logged (plans written session by session, 0043); absent or null otherwise. */
  week?: number | null;
  slot?: number | null;
  exercises: Array<{
    name: string;
    done: boolean;
    rir: number | null;
    pain: boolean;
    notes: string | null;
    sets: ExportSet[];
  }>;
}
export interface ExportSet {
  setNumber: number;
  reps: number | null;
  loadKg: number | null;
  /** Optional fields the student may type (0043); null is "not informed". */
  rir?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  loadBasis?: LoadBasis | null;
}
export interface ExportPlanExercise {
  name: string;
  videoUrl: string | null;
  sets: string | null;
  reps: string | null;
  loadInstruction: string | null;
  cadence: string | null;
  restSeconds: number | null;
  restText: string | null;
  rirMin: number | null;
  rirMax: number | null;
  notes: string | null;
  /** Plans written session by session: the dose text stored for it; absent otherwise. */
  doseText?: string | null;
}
export interface ExportPlan {
  title: string;
  revisionNumber: number;
  deliveredAt: string;
  /** As named at the moment of the delivery (slice 0.90). */
  deliveredBy: string | null;
  deliveredOrganizationName: string | null;
  startDate: string;
  endDate: string;
  phases: Array<{
    index: number;
    startDate: string;
    endDate: string;
    weeks: number;
    sessionsPerWeek: number;
    /** The division as written for people: the v1 split ("ABC") or the v2 labels. */
    split: string;
    /** Free name of a v2 phase; absent or null for v1. */
    name?: string | null;
    workouts: Array<{
      label: string;
      /** Free name of a v2 workout; absent or null for v1. */
      name?: string | null;
      exercises: ExportPlanExercise[];
    }>;
    /** Plans written session by session (motor S8): every week with its sessions and stored doses. Absent otherwise. */
    weeksDetail?: Array<{
      index: number;
      startDate: string;
      endDate: string;
      sessions: Array<{
        week: number;
        slot: number;
        label: string;
        name: string | null;
        plannedDate: string | null;
        exercises: ExportPlanExercise[];
      }>;
    }>;
  }>;
}
export interface ExportRequest {
  kind: RequestKind;
  message: string | null;
  createdAt: string;
  dueAt: string;
  outcome: RequestOutcome | null;
  outcomeNote: string | null;
  decidedAt: string | null;
}

/** The optional per-set fields, only those the student typed, so a set without them keeps the keys it always had. */
function setExtras(set: ExportSet) {
  return {
    ...(set.rir !== null && set.rir !== undefined ? { repeticoesEmReserva: set.rir } : {}),
    ...(set.durationSeconds !== null && set.durationSeconds !== undefined ? { duracaoSegundos: set.durationSeconds } : {}),
    ...(set.distanceMeters !== null && set.distanceMeters !== undefined ? { distanciaMetros: set.distanceMeters } : {}),
    ...(set.loadBasis ? { cargaContadaComo: set.loadBasis } : {}),
  };
}

/** One delivered exercise. Plans written session by session also carry the stored dose text, as the student reads it. */
function planExercise(exercise: ExportPlanExercise) {
  return {
    nome: exercise.name,
    video: exercise.videoUrl,
    series: exercise.sets,
    repeticoes: exercise.reps,
    carga: exercise.loadInstruction,
    cadencia: exercise.cadence,
    descansoSegundos: exercise.restSeconds,
    descansoTexto: exercise.restText,
    repeticoesEmReservaMinimo: exercise.rirMin,
    repeticoesEmReservaMaximo: exercise.rirMax,
    observacoes: exercise.notes,
    ...(exercise.doseText !== undefined ? { dose: storedDoseText(exercise) || null } : {}),
  };
}

/**
 * The file, with readable (Portuguese) names and no internal identifiers: it carries what the person
 * can read and nothing that points at other rows of the database.
 */
export function buildExport(source: ExportSource) {
  return {
    formato: EXPORT_FORMAT,
    geradoEm: source.generatedAt.toISOString(),
    sobreEsteArquivo: {
      aviso: EXPORT_NOTICE,
      incluido: EXPORT_INCLUDED,
      naoIncluido: EXPORT_NOT_INCLUDED,
    },
    conta: { nome: source.account.name, email: source.account.email },
    aceites: source.acceptances.map((item) => ({
      versaoDosTermos: item.termsVersion,
      sha256DoTexto: item.termsSha256,
      fotosAutorizadas: item.photosAuthorized,
      aceitoEm: item.acceptedAt,
    })),
    vinculos: source.links.map((link) => ({
      organizacao: link.organizationName,
      aluno: link.studentName,
      profissional: link.professionalName,
      desde: link.since,
      checkIns: {
        cortado: link.checkinsCut,
        registros: link.checkins.map((item) => ({
          dia: item.checkedOn,
          esforco: item.effort,
          recuperacao: item.recovery,
          desconforto: item.discomfort,
          anotacoesDoDesconforto: item.discomfortNotes,
          observacoes: item.notes,
          registradoEm: item.createdAt,
          lidoPeloProfissional: item.read,
          perguntasDoProfissional: item.questions.map((entry) => ({ pergunta: entry.question, resposta: entry.answer })),
          respostasDoProfissional: item.replies.map((entry) => ({ autor: entry.author, texto: entry.body, em: entry.createdAt })),
        })),
      },
      treinosRegistrados: {
        cortado: link.sessionsCut,
        registros: link.sessions.map((item) => ({
          dia: item.performedOn,
          plano: item.planTitle,
          fase: item.phaseIndex,
          treino: item.workoutLabel,
          esforco: item.effort,
          dorRegistrada: item.painReported,
          observacoes: item.notes,
          registradoEm: item.createdAt,
          lidoPeloProfissional: item.read,
          // Only for a session of the week (0043), so the file of a plan with one dose per phase keeps its keys.
          ...(item.week ? { semana: item.week, sessao: item.slot ?? null } : {}),
          exercicios: item.exercises.map((exercise) => ({
            nome: exercise.name,
            feito: exercise.done,
            repeticoesEmReserva: exercise.rir,
            dor: exercise.pain,
            observacoes: exercise.notes,
            series: exercise.sets.map((set) => ({
              numero: set.setNumber,
              repeticoes: set.reps,
              cargaKg: set.loadKg,
              ...setExtras(set),
            })),
          })),
        })),
      },
      treinoEntregue: link.plans.map((plan) => ({
        plano: plan.title,
        revisao: plan.revisionNumber,
        entregueEm: plan.deliveredAt,
        entreguePor: plan.deliveredBy,
        espacoNaEntrega: plan.deliveredOrganizationName,
        inicio: plan.startDate,
        fim: plan.endDate,
        fases: plan.phases.map((phase) => ({
          fase: phase.index,
          inicio: phase.startDate,
          fim: phase.endDate,
          semanas: phase.weeks,
          sessoesPorSemana: phase.sessionsPerWeek,
          divisao: phase.split,
          // v2 names only when there is one, so the file of a v1 plan keeps its keys.
          ...(phase.name ? { nome: phase.name } : {}),
          treinos: phase.workouts.map((workout) => ({
            treino: workout.label,
            ...(workout.name ? { nome: workout.name } : {}),
            exercicios: workout.exercises.map(planExercise),
          })),
          ...(phase.weeksDetail
            ? {
                // "semanas" is the count of weeks (kept as it was); the weeks themselves go here.
                semanasDoTreino: phase.weeksDetail.map((week) => ({
                  semana: week.index,
                  inicio: week.startDate,
                  fim: week.endDate,
                  sessoes: week.sessions.map((session) => ({
                    sessao: session.slot,
                    treino: session.label,
                    ...(session.name ? { nome: session.name } : {}),
                    dataPrevista: session.plannedDate,
                    exercicios: session.exercises.map(planExercise),
                  })),
                })),
              }
            : {}),
        })),
      })),
      pedidosSobreMeusDados: {
        cortado: link.requestsCut,
        registros: link.requests.map((item) => ({
          tipo: REQUEST_KIND_LABEL[item.kind],
          mensagem: item.message,
          pedidoEm: item.createdAt,
          prazoDeResposta: item.dueAt,
          situacao: item.outcome ? outcomeLabel(item.outcome, "student") : "Em andamento",
          respostaDoProfissional: item.outcomeNote,
          respondidoEm: item.decidedAt,
        })),
      },
    })),
  };
}

export type StudentDataExport = ReturnType<typeof buildExport>;

export const serializeExport = (document: StudentDataExport) => `${JSON.stringify(document, null, 2)}\n`;

/** `meus-dados-2026-10-26.json`, with the day in Brazil. */
export function exportFileName(now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `meus-dados-${day}.json`;
}
