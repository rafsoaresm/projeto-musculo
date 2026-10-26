import { REQUEST_KIND_LABEL, outcomeLabel, type RequestKind, type RequestOutcome } from "./contracts";

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
  "Os aceites dos termos, com a versão e a escolha sobre fotos.",
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
  exercises: Array<{
    name: string;
    done: boolean;
    rir: number | null;
    pain: boolean;
    notes: string | null;
    sets: Array<{ setNumber: number; reps: number | null; loadKg: number | null }>;
  }>;
}
export interface ExportPlan {
  title: string;
  revisionNumber: number;
  deliveredAt: string;
  deliveredBy: string | null;
  startDate: string;
  endDate: string;
  phases: Array<{
    index: number;
    startDate: string;
    endDate: string;
    weeks: number;
    sessionsPerWeek: number;
    split: string;
    workouts: Array<{
      label: string;
      exercises: Array<{
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
            })),
          })),
        })),
      },
      treinoEntregue: link.plans.map((plan) => ({
        plano: plan.title,
        revisao: plan.revisionNumber,
        entregueEm: plan.deliveredAt,
        entreguePor: plan.deliveredBy,
        inicio: plan.startDate,
        fim: plan.endDate,
        fases: plan.phases.map((phase) => ({
          fase: phase.index,
          inicio: phase.startDate,
          fim: phase.endDate,
          semanas: phase.weeks,
          sessoesPorSemana: phase.sessionsPerWeek,
          divisao: phase.split,
          treinos: phase.workouts.map((workout) => ({
            treino: workout.label,
            exercicios: workout.exercises.map((exercise) => ({
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
            })),
          })),
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
