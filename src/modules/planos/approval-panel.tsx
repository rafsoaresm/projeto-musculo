"use client";
import Link from "next/link";
import { Download, EllipsisVertical, FilePlus2, Send } from "lucide-react";
import { useId, useState, useTransition, type ReactNode } from "react";
import { Notice, Pill, formatDateTime } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { NOT_CLEARANCE_TEXT, REVIEW_REQUIRED_TEXT } from "@/modules/avaliacoes/contracts";
import { formatCalendarDate } from "@/modules/training/format";
import { deliveredByText } from "@/modules/configuracoes/delivered-by";
import type { PlanActionResult } from "./actions";
import { approveAndDeliverRevision, approveRevisionOnly, deliverRevision } from "./actions";

/**
 * What the newest recorded assessment of the student says. Serializable: the page builds it on
 * the server from the repository. CLEAR is "no item marked", never a clinical clearance.
 */
export type ScreeningInfo =
  | { kind: "NONE" }
  /** `parq`: the newest assessment is an Avaliação Física, whose screening is the PAR-Q and whose answer to a "Sim" is the professional's decision. */
  | { kind: "CLEAR"; assessedOn: string; href: string; parq?: boolean }
  | { kind: "REVIEWED"; assessedOn: string; href: string; parq?: boolean }
  | { kind: "BLOCKED"; assessedOn: string; href: string; parq?: boolean };

type Dialog = null | "deliver" | "approve-only" | "menu";
const REGION_NAME = {
  DRAFT: "Aprovar e entregar",
  READY: "Estrutura pronta",
  APPROVED: "Aprovada, não entregue",
  DELIVERED: "Entregue ao aluno",
} as const;

/**
 * Approval and delivery in one compact strip (0.96, Figma AP-01..10). The main way is ONE button, "Aprovar e entregar", and ONE
 * confirmation: the same revision is approved and delivered in one write. "Aprovar sem entregar" is the exception, kept under
 * "Mais ações". Both are acts of a person; nothing here is automatic. Delivery does not create the student's login and does not
 * notify the student: the strip says so and says what the student can see.
 */
export type ApprovalPanelProps = React.ComponentProps<typeof ApprovalPanel>;
export function ApprovalPanel({
  planId,
  revisionId,
  revisionNumber,
  state,
  below,
  workouts,
  approvedAt,
  deliveredAt,
  deliveredByName = null,
  deliveredOrganizationName = null,
  portal,
  studentHref,
  screening,
  pdfHref,
  automatic = null,
  historyHref = null,
  openProposal = false,
  holdReason = null,
  createRevision,
}: {
  planId: string;
  revisionId: string;
  revisionNumber: number;
  /** DRAFT is accepted: the confirmation then closes the draft first, as one step of the same operation. */
  state: "DRAFT" | "READY" | "APPROVED" | "DELIVERED";
  below: number;
  workouts: number;
  approvedAt: string | null;
  deliveredAt: string | null;
  /** Who delivered it and the workspace, as named at the moment of the delivery (slice 0.90). */
  deliveredByName?: string | null;
  deliveredOrganizationName?: string | null;
  portal: "ACTIVE" | "INVITED" | "NONE";
  studentHref: string;
  screening: ScreeningInfo;
  /** The PDF of the delivered revision. Only offered once it was delivered. */
  pdfHref: string;
  /** Rows written by an automatic proposal (motor S9): how many, and how many the professional edited since. */
  automatic?: { total: number; edited: number } | null;
  /** Where the premises of the applied proposal are read, when there is one. */
  historyHref?: string | null;
  /** An automatic proposal still open on the draft: closing the draft supersedes it (nothing of it is applied). */
  openProposal?: boolean;
  /** Why the button waits (e.g. unsaved changes of the structure). Null when nothing holds it. */
  holdReason?: string | null;
  /** For a closed revision (ready, approved or delivered): copies it into a new draft. */
  createRevision?: () => Promise<PlanActionResult>;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const blocked = screening.kind === "BLOCKED";
  const needsAck = screening.kind === "NONE" && state !== "APPROVED";
  const cannot = blocked || holdReason !== null;
  const close = () => {
    if (pending) return;
    setDialog(null);
    setError("");
  };
  const run = (task: () => Promise<PlanActionResult>, after?: () => void) =>
    startTransition(async () => {
      try {
        const result = await task();
        setError(result?.error ?? "");
        if (!result?.error) {
          setDialog(null);
          after?.();
        }
      } catch {
        // The action may have gone through: the page shows the stored state after a reload, nothing is repeated blindly.
        setError("Não foi possível falar com o servidor. Recarregue a página para ver o estado atual da revisão.");
      }
    });
  const deliverTitle = state === "APPROVED" ? "Entregar ao aluno" : "Aprovar e entregar";
  const status =
    state === "DRAFT" ? (
      <Pill tone="neutral">Rascunho</Pill>
    ) : state === "READY" ? (
      <Pill tone="brand">Estrutura pronta</Pill>
    ) : state === "APPROVED" ? (
      <Pill tone="brand">Aprovada, não entregue</Pill>
    ) : (
      <Pill tone="success">Entregue</Pill>
    );
  const line =
    state === "DELIVERED"
      ? `${deliveredAt ? `Entregue em ${formatDateTime(deliveredAt)}${deliveredByText(deliveredByName, deliveredOrganizationName)}. ` : ""}Somente leitura: para mudar o treino, crie uma nova revisão.`
      : state === "APPROVED"
        ? `${approvedAt ? `Aprovada em ${formatDateTime(approvedAt)}. ` : ""}O aluno ainda não vê este plano e a revisão está fechada para edição.`
        : "Ao entregar, esta revisão passa a ser a que o aluno vê e deixa de aceitar edição.";
  const hasMenu = state !== "DELIVERED";

  return (
    <section className={`approval-bar approval-${state.toLowerCase()}`} aria-label={REGION_NAME[state]}>
      <div className="approval-main">
        <div className="approval-text">
          <h2 className="approval-title">
            {status} <span>Revisão {revisionNumber}</span>
          </h2>
          <p className="small muted">{line}</p>
        </div>
        <div className="approval-actions">
          {state === "DELIVERED" ? (
            <>
              {createRevision && (
                <button
                  type="button"
                  className="button primary"
                  disabled={pending}
                  onClick={() => run(createRevision)}
                >
                  <FilePlus2 size={18} aria-hidden="true" /> {pending ? "Criando…" : "Criar nova revisão"}
                </button>
              )}
              <Link className="button secondary" href={pdfHref} download prefetch={false}>
                <Download size={18} aria-hidden="true" /> Baixar PDF
              </Link>
            </>
          ) : (
            <>
              {hasMenu && (
                <button
                  type="button"
                  className="button secondary approval-more"
                  aria-haspopup="dialog"
                  aria-expanded={dialog === "menu"}
                  onClick={() => setDialog("menu")}
                >
                  <EllipsisVertical size={18} aria-hidden="true" /> Mais ações
                </button>
              )}
              <button
                type="button"
                className="button primary"
                disabled={cannot}
                aria-describedby={cannot ? `${ids}-motivo` : undefined}
                onClick={() => setDialog("deliver")}
              >
                <Send size={18} aria-hidden="true" /> {deliverTitle}
              </button>
            </>
          )}
        </div>
      </div>
      {error && dialog === null && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {cannot && (
        <p id={`${ids}-motivo`} className="small muted" role="status">
          {blocked ? "O botão espera a revisão da triagem, descrita no aviso abaixo." : holdReason}
        </p>
      )}
      <Facts
        state={state}
        below={below}
        workouts={workouts}
        automatic={automatic}
        screening={screening}
        studentHref={studentHref}
        portal={portal}
        historyHref={historyHref}
      />

      {/* Mais ações (AP-09 / AP-10): the exception and the secondary things, with what each one does. */}
      <Sheet open={dialog === "menu"} onClose={() => (dialog === "menu" ? close() : undefined)} titleId={`${ids}-menu`} variant="menu">
        <h2 id={`${ids}-menu`} className="sheet-title">
          Mais ações
        </h2>
        <ul className="sheet-actions">
          {(state === "DRAFT" || state === "READY") && (
            <li>
              <button type="button" className="sheet-action" onClick={() => setDialog("approve-only")}>
                <strong>Aprovar sem entregar</strong>
                <span className="small muted">
                  Fecha a revisão para edição e a deixa aprovada. O aluno não a vê até você entregar.
                </span>
              </button>
            </li>
          )}
          {createRevision && (state === "READY" || state === "APPROVED") && (
            <li>
              <button
                type="button"
                className="sheet-action"
                disabled={pending}
                onClick={() => run(createRevision)}
              >
                <strong>Criar nova revisão</strong>
                <span className="small muted">
                  Copia esta revisão para um novo rascunho editável. Esta continua como está.
                </span>
              </button>
            </li>
          )}
          {historyHref && (
            <li>
              <Link className="sheet-action" href={historyHref}>
                <strong>Ver premissas da proposta</strong>
                <span className="small muted">Histórico e regras da prescrição automática desta revisão.</span>
              </Link>
            </li>
          )}
        </ul>
        <button type="button" className="button secondary sheet-close" onClick={close}>
          Fechar
        </button>
      </Sheet>

      {/* The one confirmation (AP-02 / AP-06). */}
      <Sheet
        open={dialog === "deliver"}
        onClose={() => (dialog === "deliver" ? close() : undefined)}
        titleId={`${ids}-entregar`}
        busy={pending}
      >
        <h2 id={`${ids}-entregar`} className="sheet-title">
          {deliverTitle}
        </h2>
        <p className="muted">
          Revisão {revisionNumber} · {workouts} {workouts === 1 ? "treino" : "treinos"} na estrutura.
        </p>
        <Consequences
          state={state}
          below={below}
          workouts={workouts}
          automatic={automatic}
          openProposal={openProposal}
          portal={portal}
          mode="deliver"
        />
        <ScreeningNote screening={screening} assessmentsHref={`${studentHref}/avaliacoes`} />
        {needsAck && (
          <label className="check-row check-row-tap">
            <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
            Confirmo que não há triagem registrada e que verifiquei o histórico e as limitações deste aluno por conta
            própria antes de aprovar.
          </label>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-footer">
          <button type="button" className="button secondary" disabled={pending} onClick={close}>
            Cancelar
          </button>
          <button
            type="button"
            className="button primary"
            disabled={pending || blocked || (needsAck && !ack)}
            onClick={() =>
              run(() =>
                state === "APPROVED"
                  ? deliverRevision(planId, revisionId)
                  : approveAndDeliverRevision(planId, revisionId, screening.kind === "NONE" && ack),
              )
            }
          >
            {pending ? "Entregando…" : state === "APPROVED" ? "Confirmar entrega" : "Confirmar e entregar"}
          </button>
        </div>
      </Sheet>

      {/* The exception, confirmed on its own. */}
      <Sheet
        open={dialog === "approve-only"}
        onClose={() => (dialog === "approve-only" ? close() : undefined)}
        titleId={`${ids}-aprovar`}
        busy={pending}
      >
        <h2 id={`${ids}-aprovar`} className="sheet-title">
          Aprovar sem entregar
        </h2>
        <p className="muted">
          Use quando a revisão está certa, mas ainda não deve chegar ao aluno. Depois, o botão “Entregar ao aluno”
          publica esta mesma revisão, sem nova aprovação.
        </p>
        <Consequences
          state={state}
          below={below}
          workouts={workouts}
          automatic={automatic}
          openProposal={openProposal}
          portal={portal}
          mode="approve-only"
        />
        <ScreeningNote screening={screening} assessmentsHref={`${studentHref}/avaliacoes`} />
        {needsAck && (
          <label className="check-row check-row-tap">
            <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
            Confirmo que não há triagem registrada e que verifiquei o histórico e as limitações deste aluno por conta
            própria antes de aprovar.
          </label>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-footer">
          <button type="button" className="button secondary" disabled={pending} onClick={close}>
            Cancelar
          </button>
          <button
            type="button"
            className="button primary"
            disabled={pending || blocked || (needsAck && !ack)}
            onClick={() => run(() => approveRevisionOnly(planId, revisionId, screening.kind === "NONE" && ack))}
          >
            {pending ? "Aprovando…" : "Aprovar sem entregar"}
          </button>
        </div>
      </Sheet>
    </section>
  );
}

/** The quality and context facts under the strip: secondary, after the decision, never a block of their own. */
function Facts({
  state,
  below,
  workouts,
  automatic,
  screening,
  studentHref,
  portal,
  historyHref,
}: {
  state: "DRAFT" | "READY" | "APPROVED" | "DELIVERED";
  below: number;
  workouts: number;
  automatic: { total: number; edited: number } | null;
  screening: ScreeningInfo;
  studentHref: string;
  portal: "ACTIVE" | "INVITED" | "NONE";
  historyHref: string | null;
}) {
  const items: ReactNode[] = [];
  // A draft already shows the target of each workout in the editor, above this strip.
  if (state !== "DELIVERED" && state !== "DRAFT" && workouts > 0)
    items.push(
      below > 0 ? (
        <Pill key="alvo" tone="warning">
          {below} de {workouts} treinos abaixo do alvo
        </Pill>
      ) : (
        <Pill key="alvo" tone="success">
          Alvo atendido em todos os treinos
        </Pill>
      ),
    );
  if (automatic && automatic.total > 0)
    items.push(
      <Pill key="auto" tone="neutral">
        Prescrição automática: {automatic.total} {automatic.total === 1 ? "exercício" : "exercícios"} ({automatic.edited}{" "}
        {automatic.edited === 1 ? "editado" : "editados"})
      </Pill>,
    );
  if (screening.kind === "CLEAR" || screening.kind === "REVIEWED")
    items.push(
      <Pill key="triagem" tone={screening.kind === "CLEAR" ? "neutral" : "brand"}>
        {screening.kind === "CLEAR"
          ? screening.parq
            ? "Nenhum “Sim” no PAR-Q"
            : "Nenhum sinal marcado na triagem"
          : screening.parq
            ? "PAR-Q com “Sim” e decisão profissional registrada"
            : "Alerta da triagem com revisão registrada"}
      </Pill>,
    );
  return (
    <>
      {items.length > 0 && <div className="approval-facts">{items}</div>}
      {state !== "DELIVERED" && screening.kind === "BLOCKED" && (
        <ScreeningNote screening={screening} assessmentsHref={`${studentHref}/avaliacoes`} />
      )}
      {state === "DELIVERED" && screening.kind === "BLOCKED" && (
        <Notice tone="warning">
          <p>
            <strong>{REVIEW_REQUIRED_TEXT}</strong> A avaliação de {formatCalendarDate(screening.assessedOn)} foi registrada
            com alerta e este treino já foi entregue. Registre a sua revisão{" "}
            <Link className="account-link" href={screening.href}>
              na avaliação
            </Link>{" "}
            e decida se o plano precisa de uma nova revisão.
          </p>
        </Notice>
      )}
      {state === "DELIVERED" && portal !== "ACTIVE" && (
        <p className="small muted">
          {portal === "INVITED"
            ? "O convite do aluno ainda está pendente."
            : "O aluno ainda não tem acesso à área do aluno."}{" "}
          A entrega está registrada; ele verá o treino quando entrar.{" "}
          <Link className="account-link" href={studentHref}>
            Gerenciar acesso
          </Link>
        </p>
      )}
      {historyHref && state === "DELIVERED" && (
        <p className="small">
          <Link className="account-link" href={historyHref}>
            Ver premissas da proposta
          </Link>
        </p>
      )}
    </>
  );
}

/** What the confirmation will do and will NOT do, from the real state of this revision. */
function Consequences({
  state,
  below,
  workouts,
  automatic,
  openProposal,
  portal,
  mode,
}: {
  state: "DRAFT" | "READY" | "APPROVED" | "DELIVERED";
  below: number;
  workouts: number;
  automatic: { total: number; edited: number } | null;
  openProposal: boolean;
  portal: "ACTIVE" | "INVITED" | "NONE";
  mode: "deliver" | "approve-only";
}) {
  return (
    <ul className="sheet-list">
      {state === "DRAFT" && (
        <li>
          A estrutura é marcada como pronta e a revisão deixa de aceitar edição.
          {openProposal && " A proposta automática ainda aberta é encerrada sem ser aplicada."}
        </li>
      )}
      {mode === "deliver" ? (
        <>
          <li>
            {portal === "ACTIVE"
              ? "O aluno passa a ver esta revisão na área do aluno."
              : "A entrega fica registrada. O aluno só verá o treino quando tiver acesso à área do aluno; esta ação não cria nem ativa o acesso."}
          </li>
          <li>Esta ação não envia aviso ao aluno.</li>
          <li>Depois de entregue, a revisão não pode ser editada: mudanças entram em uma nova revisão.</li>
        </>
      ) : (
        <>
          <li>A revisão fica fechada para edição.</li>
          <li>O aluno não vê esta revisão até você entregá-la.</li>
        </>
      )}
      {below > 0 && (
        <li>
          Aviso: {below} de {workouts} treinos abaixo do alvo. É uma referência de quantidade e não impede a aprovação.
        </li>
      )}
      {automatic && automatic.total > 0 && (
        <li>
          Inclui {automatic.total} {automatic.total === 1 ? "exercício proposto" : "exercícios propostos"} automaticamente (
          {automatic.edited} {automatic.edited === 1 ? "editado" : "editados"} por você). A aprovação é sua.
        </li>
      )}
    </ul>
  );
}

/** The screening line of the approval step, in the words the product commits to. */
function ScreeningNote({
  screening,
  assessmentsHref,
}: {
  screening: ScreeningInfo;
  assessmentsHref: string;
}) {
  if (screening.kind === "NONE")
    return (
      <Notice tone="warning">
        <p>
          <strong>Triagem não registrada.</strong> Ainda não existe avaliação com triagem para este aluno nesta
          ferramenta. Isso não significa ausência de riscos.{" "}
          <Link className="account-link" href={assessmentsHref}>
            Iniciar a avaliação física
          </Link>
        </p>
      </Notice>
    );
  if (screening.kind === "BLOCKED")
    return (
      <Notice tone="warning">
        <p>
          <strong>{REVIEW_REQUIRED_TEXT}</strong> A avaliação de {formatCalendarDate(screening.assessedOn)}{" "}
          {screening.parq
            ? "tem resposta “Sim” no PAR-Q sem a decisão profissional registrada. Uma avaliação registrada não muda: a decisão entra por uma retificação, na etapa Triagem."
            : "tem triagem com alerta e ainda não tem revisão sua registrada."}{" "}
          <Link className="account-link" href={screening.parq ? `${screening.href}#av2-r-retificar` : screening.href}>
            {screening.parq ? "Retificar a avaliação" : "Registrar a revisão"}
          </Link>
        </p>
      </Notice>
    );
  return (
    <p className="small muted" role="status">
      Avaliação de {formatCalendarDate(screening.assessedOn)}.
      {screening.kind === "CLEAR" ? ` ${NOT_CLEARANCE_TEXT}` : ""}{" "}
      <Link className="account-link" href={screening.href}>
        Abrir a avaliação
      </Link>
    </p>
  );
}
