import type { AssessmentSummary } from "@/db/assessments";
import type { PlanState, PlanSummary } from "@/db/plans";
import type { SessionSummary } from "@/db/workout-sessions";
import { stateLabel } from "@/modules/planos/labels";
import { formatCalendarDate } from "@/modules/training/format";
import { formatDate } from "@/components/ui";
import { studentTabHref } from "./student-tab-names";

/**
 * The "Resumo" of the student's record (handoff V4 T05, Figma `1:111`): the timeline and the next action. Pure: it reads only what the
 * repositories already returned. A step without data is said as missing, never drawn as done; no date is shown that is not in the data;
 * nothing here approves, releases or classifies anything (an assessment is "registrada", never "aprovada").
 */
export type MilestoneState = "done" | "current" | "missing";
export interface Milestone {
  key: "cadastro" | "avaliacao" | "plano" | "entrega" | "acompanhamento";
  text: string;
  state: MilestoneState;
}

export interface SummaryInput {
  studentId: string;
  hasProfile: boolean;
  /** Newest first, as `assessmentsFor().listForStudent` returns them. */
  assessments: AssessmentSummary[];
  /** Newest plan first and, in each plan, newest revision first, as `plansFor().listForStudent` returns them. */
  plans: PlanSummary[];
  /** Newest first. */
  sessions: Pick<SessionSummary, "performedOn">[];
  openRequests: number;
}

const newestRevision = (plans: PlanSummary[]) => {
  const plan = plans[0];
  const revision = plan?.revisions[0];
  return plan && revision ? { plan, revision } : null;
};
const OPEN_PLAN: readonly PlanState[] = ["DRAFT", "REVIEW_REQUIRED", "READY"];

export function timeline(input: SummaryInput): Milestone[] {
  const recorded = input.assessments.find((row) => row.state === "RECORDED");
  const draft = input.assessments.find((row) => row.state === "DRAFT");
  const newest = newestRevision(input.plans);
  const delivered = input.plans
    .flatMap((plan) => plan.revisions)
    .map((revision) => revision.deliveredAt)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1);
  const lastSession = input.sessions[0];
  const steps: Milestone[] = [{ key: "cadastro", text: "Cadastro salvo", state: "done" }];
  steps.push(
    draft
      ? { key: "avaliacao", text: "Avaliação física em rascunho", state: "current" }
      : recorded
        ? {
            key: "avaliacao",
            text: `Avaliação física registrada em ${formatCalendarDate(recorded.assessedOn)}${recorded.riskStatus === "REVIEW_REQUIRED" && !recorded.reviewed ? ", triagem pede a sua revisão" : ""}`,
            state: recorded.riskStatus === "REVIEW_REQUIRED" && !recorded.reviewed ? "current" : "done",
          }
        : { key: "avaliacao", text: "Nenhuma avaliação física registrada", state: "missing" },
  );
  steps.push(
    newest
      ? {
          key: "plano",
          text: `${newest.plan.title}, revisão ${newest.revision.revisionNumber}: ${stateLabel(newest.revision.state).text.toLowerCase()}`,
          state: newest.revision.state === "DELIVERED" ? "done" : "current",
        }
      : { key: "plano", text: "Nenhum plano salvo", state: "missing" },
  );
  steps.push(
    delivered
      ? { key: "entrega", text: `Plano entregue em ${formatDate(delivered)}`, state: "done" }
      : { key: "entrega", text: "Nenhum plano entregue", state: "missing" },
  );
  steps.push(
    lastSession
      ? { key: "acompanhamento", text: `Último treino registrado em ${formatCalendarDate(lastSession.performedOn)}`, state: "done" }
      : { key: "acompanhamento", text: "Nenhum treino registrado pelo aluno", state: "missing" },
  );
  return steps;
}

export interface NextAction {
  text: string;
  href: string;
}

/**
 * The one next action of the header, from real states only, in this order: a request about the data (it has a legal deadline); a screening
 * that asks for the professional's review (a plan cannot be approved before it); a plan revision still being made; an approved plan not yet
 * delivered; an assessment draft; a record without the file. Nothing pending: no action. An assessment is never required before anything
 * else (V4 T05).
 */
export function nextAction(input: SummaryInput): NextAction | null {
  const student = `/profissional/alunos/${input.studentId}`;
  if (input.openRequests > 0)
    return { text: input.openRequests === 1 ? "responder o pedido sobre os dados" : "responder os pedidos sobre os dados", href: studentTabHref(input.studentId, "acesso", "pedidos") };
  const toReview = input.assessments.find((row) => row.state === "RECORDED" && row.riskStatus === "REVIEW_REQUIRED" && !row.reviewed);
  if (toReview) return { text: "registrar a revisão da triagem", href: `${student}/avaliacoes/${toReview.id}` };
  const newest = newestRevision(input.plans);
  if (newest && OPEN_PLAN.includes(newest.revision.state))
    return { text: "revisar plano", href: `${student}/planos/${newest.plan.id}/${newest.revision.id}` };
  if (newest && newest.revision.state === "APPROVED")
    return { text: "entregar o plano aprovado", href: `${student}/planos/${newest.plan.id}/${newest.revision.id}` };
  const draft = input.assessments.find((row) => row.state === "DRAFT");
  if (draft) return { text: "continuar a avaliação física", href: `${student}/avaliacoes/${draft.id}` };
  if (!input.hasProfile) return { text: "preencher a ficha", href: `${student}/ficha` };
  return null;
}

/** The portal, as the access says it (an invitation is not an active portal). */
export const portalLabel = (access: "ACTIVE" | "INVITED" | "NONE") =>
  access === "ACTIVE" ? "Portal ativo" : access === "INVITED" ? "Convite gerado, aguardando aceite" : "Sem acesso ao portal";
