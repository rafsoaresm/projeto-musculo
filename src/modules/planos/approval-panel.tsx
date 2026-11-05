"use client";
import Link from "next/link";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Notice, formatDateTime } from "@/components/ui";
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
type State = "DRAFT" | "READY" | "APPROVED" | "DELIVERED";
const REGION_NAME = {
  DRAFT: "Aprovar e entregar",
  READY: "Estrutura pronta",
  APPROVED: "Aprovada, não entregue",
  DELIVERED: "Entregue ao aluno",
} as const;

/** Two wordings of the same thing, as the Figma draws them: the desktop frames and the phone frames do not use the same copy. CSS shows one. */
function Resp({ wide, narrow }: { wide: ReactNode; narrow: ReactNode }) {
  return (
    <>
      <span className="fa-w">{wide}</span>
      <span className="fa-n">{narrow}</span>
    </>
  );
}

/** "04/11/2026 às 20:20", the way the Figma writes the moment of the delivery. */
const dateAt = (iso: string) => formatDateTime(iso).replace(/,?\s+(\d{2}:\d{2})$/, " às $1");

/**
 * Approval and delivery (Figma AP-01..10). The main way is ONE button, "Aprovar e entregar", and ONE confirmation: the same revision
 * is approved and delivered in one write. "Aprovar sem entregar" is the exception, kept under "Mais ações". Both are acts of a
 * person; nothing here is automatic. Delivery does not create the student's login and does not notify the student: the
 * confirmation says so (the "Notificar" line of the Figma is drawn, switched off, because there is no notice to the student yet).
 */
export type ApprovalPanelProps = React.ComponentProps<typeof ApprovalPanel>;
export function ApprovalPanel({
  planId,
  revisionId,
  revisionNumber,
  state,
  below,
  workouts,
  exercises,
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
  records = 0,
  openProposal = false,
  holdReason = null,
  createRevision,
}: {
  planId: string;
  revisionId: string;
  revisionNumber: number;
  /** DRAFT is accepted: the confirmation then closes the draft first, as one step of the same operation. */
  state: State;
  below: number;
  workouts: number;
  /** How many exercises the revision holds (shown in the confirmation when there are no recorded notes to count). */
  exercises: number;
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
  /** How many alerts, warnings and assumptions the applied proposal recorded (0 when there is none). */
  records?: number;
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
  const barRef = useRef<HTMLDivElement>(null);
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
  const reasonId = `${ids}-motivo`;
  const hasAccess = portal === "ACTIVE";

  const status = {
    DRAFT: { tone: "neutral", wide: "Rascunho", narrow: "Rascunho" },
    READY: { tone: "brand", wide: "Pronta para aprovação", narrow: "Pronta para aprovação" },
    APPROVED: { tone: "brand", wide: "Aprovada · não entregue", narrow: "Aprovada · não entregue" },
    DELIVERED: { tone: "success", wide: "Entregue ao aluno", narrow: "Entregue" },
  }[state];
  const belowChip =
    state !== "DELIVERED" && state !== "APPROVED" && workouts > 0 ? (
      below > 0 ? (
        <span className="fa-chip fa-chip-warning fa-chip-row2">
          {below} de {workouts} abaixo do alvo
        </span>
      ) : (
        <span className="fa-chip fa-chip-success fa-chip-row2">Nenhum treino abaixo do alvo</span>
      )
    ) : null;
  const accessChip =
    state === "DELIVERED" && !hasAccess ? (
      <span className="fa-chip fa-chip-warning fa-chip-row2 fa-n">
        {portal === "INVITED" ? "Convite do aluno pendente" : "Acesso do aluno inativo"}
      </span>
    ) : null;

  const menu = (
    <button
      type="button"
      className="fa-btn fa-btn-secondary fa-btn-more"
      aria-haspopup="dialog"
      aria-expanded={dialog === "menu"}
      onClick={() => setDialog("menu")}
    >
      Mais ações <span aria-hidden="true">⋯</span>
    </button>
  );
  const actions = (
    <>
      {state === "DELIVERED" ? (
        <>
          <Link className="fa-btn fa-btn-secondary" href={pdfHref} download prefetch={false}>
            Baixar PDF
          </Link>
          {createRevision && (
            <button type="button" className="fa-btn fa-btn-primary" disabled={pending} onClick={() => run(createRevision)}>
              {pending ? "Criando…" : "Criar nova revisão"}
            </button>
          )}
        </>
      ) : (
        <>
          {menu}
          <button
            type="button"
            className="fa-btn fa-btn-primary"
            disabled={cannot}
            aria-describedby={cannot ? reasonId : undefined}
            onClick={() => setDialog("deliver")}
          >
            {deliverTitle}
          </button>
        </>
      )}
    </>
  );
  // The line above the buttons of the phone footer (AP-05/07/08).
  const footerNote = {
    DRAFT: "A entrega exige confirmação no próximo passo.",
    READY: "A entrega exige confirmação no próximo passo.",
    APPROVED: "Esta revisão está aprovada, mas não entregue.",
    DELIVERED: "Revisão entregue · alterações exigem nova revisão.",
  }[state];

  return (
    <section className={`fa-bar-wrap fa-state-${state.toLowerCase()}`} aria-label={REGION_NAME[state]}>
      <div className="fa-bar" ref={barRef}>
        <div className="fa-bar-text">
          <div className="fa-bar-row">
            <span className={`fa-chip fa-chip-${status.tone} fa-chip-upper`}>
              <Resp wide={status.wide} narrow={status.narrow} />
            </span>
            <p className="fa-bar-line">
              {state === "DELIVERED" ? (
                <>
                  <span className="fa-n">Entregue em </span>
                  {deliveredAt ? dateAt(deliveredAt) : "Entrega registrada"}
                  {deliveredByText(deliveredByName, deliveredOrganizationName)}
                  <span className="fa-w"> · revisão fechada para edição</span>
                </>
              ) : state === "APPROVED" ? (
                <Resp
                  wide="O aluno ainda não vê esta revisão. A entrega pode ser feita quando quiser."
                  narrow={<strong>O aluno ainda não vê esta revisão.</strong>}
                />
              ) : state === "READY" ? (
                <Resp
                  wide="A estrutura foi marcada como pronta. Você pode aprovar e entregar em uma única ação."
                  narrow={<strong>Revisão pronta para entrega ao aluno.</strong>}
                />
              ) : (
                <Resp
                  wide="Ao entregar, esta revisão passa a ser a que o aluno vê e deixa de aceitar edição."
                  narrow={<strong>Revisão em rascunho.</strong>}
                />
              )}
            </p>
          </div>
          <div className="fa-bar-row fa-bar-row2">
            <p className={state === "DELIVERED" || state === "APPROVED" ? "fa-bar-sub" : "fa-bar-sub fa-n"}>
              {state === "DELIVERED" ? (
                <Resp
                  wide={
                    hasAccess
                      ? "O aluno tem acesso à área do aluno e vê esta revisão."
                      : `${portal === "INVITED" ? "O convite do aluno ainda está pendente." : "Aluno ainda sem acesso à área do aluno."} A entrega foi registrada.`
                  }
                  narrow="Revisão fechada, somente leitura."
                />
              ) : state === "APPROVED" ? (
                <>Revisão fechada para edição{approvedAt ? `. Aprovada em ${formatDateTime(approvedAt)}.` : "."}</>
              ) : (
                "Aprovar e entregar é uma ação única."
              )}
            </p>
            {belowChip}
            {accessChip}
            {belowChip && below > 0 && <p className="fa-bar-hint fa-w">Reveja a distribuição antes de entregar.</p>}
          </div>
        </div>
        <div className="fa-bar-actions">{actions}</div>
      </div>

      {error && dialog === null && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {cannot && (
        <p id={reasonId} className="fa-note" role="status">
          {blocked ? "O botão espera a revisão da triagem, descrita no aviso abaixo." : holdReason}
        </p>
      )}
      <Context
        state={state}
        automatic={automatic}
        screening={screening}
        studentHref={studentHref}
      />

      {/* The footer of a phone (AP-05/07/08): the same actions, always in reach. */}
      <div className="fa-sticky">
        <p>{footerNote}</p>
        <div className="fa-sticky-actions">{actions}</div>
      </div>

      {/* Mais ações (AP-09 / AP-10): the exception and the secondary things, with what each one does. */}
      <Sheet
        open={dialog === "menu"}
        onClose={() => (dialog === "menu" ? close() : undefined)}
        titleId={`${ids}-menu`}
        variant="menu"
        anchorRef={barRef}
      >
        <div className="fa-menu">
          <h2 id={`${ids}-menu`} className="fa-menu-title">
            Outras ações
          </h2>
          <ul className="fa-menu-list">
            {(state === "DRAFT" || state === "READY") && (
              <li>
                <button type="button" className="fa-menu-item" onClick={() => setDialog("approve-only")}>
                  <strong>Aprovar sem entregar</strong>
                  <span>
                    <Resp
                      wide="Mantém plano indisponível ao aluno"
                      narrow="Exceção: aprova sem disponibilizar ao aluno"
                    />
                  </span>
                </button>
              </li>
            )}
            {createRevision && (state === "READY" || state === "APPROVED") && (
              <li>
                <button type="button" className="fa-menu-item" disabled={pending} onClick={() => run(createRevision)}>
                  <strong>Criar nova revisão</strong>
                  <span>Copia esta revisão para um novo rascunho editável. Esta continua como está.</span>
                </button>
              </li>
            )}
            {historyHref && (
              <li>
                <Link className="fa-menu-item" href={historyHref}>
                  <strong>Consultar premissas</strong>
                  <span>
                    {records > 0 ? (
                      <Resp wide={`${records} justificativas e avisos`} narrow={`Ver ${records} registros da revisão`} />
                    ) : (
                      "Histórico e regras da prescrição automática"
                    )}
                  </span>
                </Link>
              </li>
            )}
            <li>
              <button
                type="button"
                className="fa-menu-item"
                disabled
                aria-disabled="true"
                title="O PDF só existe para a revisão entregue."
              >
                <strong>Baixar prévia em PDF</strong>
                <span>Indisponível: o PDF só existe depois da entrega</span>
              </button>
            </li>
          </ul>
        </div>
      </Sheet>

      {/* The one confirmation (AP-02 / AP-06) and, on its own, the exception. */}
      {(["deliver", "approve-only"] as const).map((mode) => (
        <Sheet
          key={mode}
          open={dialog === mode}
          onClose={() => (dialog === mode ? close() : undefined)}
          titleId={`${ids}-${mode}`}
          busy={pending}
        >
          <Confirmation
            titleId={`${ids}-${mode}`}
            mode={mode}
            state={state}
            deliverTitle={deliverTitle}
            below={below}
            workouts={workouts}
            exercises={exercises}
            records={records}
            automatic={automatic}
            openProposal={openProposal}
            portal={portal}
            screening={screening}
            assessmentsHref={`${studentHref}/avaliacoes`}
            needsAck={needsAck}
            ack={ack}
            setAck={setAck}
            error={error}
            pending={pending}
            blocked={blocked}
            onCancel={close}
            onConfirm={() =>
              run(() =>
                mode === "approve-only"
                  ? approveRevisionOnly(planId, revisionId, screening.kind === "NONE" && ack)
                  : state === "APPROVED"
                    ? deliverRevision(planId, revisionId)
                    : approveAndDeliverRevision(planId, revisionId, screening.kind === "NONE" && ack),
              )
            }
            revisionNumber={revisionNumber}
          />
        </Sheet>
      ))}
    </section>
  );
}

/** Context under the bar that the Figma does not draw but the rules need: the screening, the automatic proposal, a blocked delivered revision. */
function Context({
  state,
  automatic,
  screening,
  studentHref,
}: {
  state: State;
  automatic: { total: number; edited: number } | null;
  screening: ScreeningInfo;
  studentHref: string;
}) {
  const chips: ReactNode[] = [];
  if (automatic && automatic.total > 0)
    chips.push(
      <span key="auto" className="fa-chip fa-chip-neutral fa-chip-sm">
        Prescrição automática: {automatic.total} {automatic.total === 1 ? "exercício" : "exercícios"} ({automatic.edited}{" "}
        {automatic.edited === 1 ? "editado" : "editados"})
      </span>,
    );
  if (screening.kind === "CLEAR" || screening.kind === "REVIEWED")
    chips.push(
      <span key="triagem" className={`fa-chip fa-chip-sm ${screening.kind === "CLEAR" ? "fa-chip-neutral" : "fa-chip-brand"}`}>
        {screening.kind === "CLEAR"
          ? screening.parq
            ? "Nenhum “Sim” no PAR-Q"
            : "Nenhum sinal marcado na triagem"
          : screening.parq
            ? "PAR-Q com “Sim” e decisão profissional registrada"
            : "Alerta da triagem com revisão registrada"}
      </span>,
    );
  return (
    <>
      {chips.length > 0 && <div className="fa-context">{chips}</div>}
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
    </>
  );
}

/** The confirmation of AP-02 (a modal) and AP-06 (a bottom sheet): the numbers of the revision, the warning, the choices and the two buttons. */
function Confirmation({
  titleId,
  mode,
  state,
  deliverTitle,
  below,
  workouts,
  exercises,
  records,
  automatic,
  openProposal,
  portal,
  screening,
  assessmentsHref,
  needsAck,
  ack,
  setAck,
  error,
  pending,
  blocked,
  onCancel,
  onConfirm,
  revisionNumber,
}: {
  titleId: string;
  mode: "deliver" | "approve-only";
  state: State;
  deliverTitle: string;
  below: number;
  workouts: number;
  exercises: number;
  records: number;
  automatic: { total: number; edited: number } | null;
  openProposal: boolean;
  portal: "ACTIVE" | "INVITED" | "NONE";
  screening: ScreeningInfo;
  assessmentsHref: string;
  needsAck: boolean;
  ack: boolean;
  setAck: (value: boolean) => void;
  error: string;
  pending: boolean;
  blocked: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  revisionNumber: number;
}) {
  const deliver = mode === "deliver";
  const approves = state !== "APPROVED";
  const results = approves && deliver ? 2 : 1;
  const title = deliver ? deliverTitle : "Aprovar sem entregar";
  const ackText =
    "Confirmo que não há triagem registrada e que verifiquei o histórico e as limitações deste aluno por conta própria antes de aprovar.";
  const notes: ReactNode[] = [];
  if (state === "DRAFT") {
    notes.push(
      <li key="draft">
        A estrutura é marcada como pronta e a revisão deixa de aceitar edição.
        {openProposal && " A proposta automática ainda aberta é encerrada sem ser aplicada."}
      </li>,
    );
  }
  if (deliver) {
    notes.push(
      <li key="edit">
        Depois de entregue, a revisão não pode ser editada: mudanças entram em uma nova revisão.
      </li>,
    );
  } else {
    notes.push(<li key="closed">A revisão fica fechada para edição. O aluno não vê esta revisão até você entregá-la.</li>);
  }
  if (automatic && automatic.total > 0)
    notes.push(
      <li key="auto">
        Inclui {automatic.total} {automatic.total === 1 ? "exercício proposto" : "exercícios propostos"} automaticamente (
        {automatic.edited} {automatic.edited === 1 ? "editado" : "editados"} por você). A aprovação é sua.
      </li>,
    );
  return (
    <div className="fa-confirm">
      <span className="fa-chip fa-chip-brand fa-chip-upper fa-confirm-chip">
        {results === 2 ? "1 ação · 2 resultados" : "1 ação · 1 resultado"}
      </span>
      <h2 id={titleId} className="fa-confirm-title">
        {deliver && approves ? <Resp wide="Aprovar e entregar revisão" narrow="Aprovar e entregar" /> : title}
      </h2>
      <p className="fa-confirm-sub">
        {deliver ? (
          <Resp
            wide={`Confirme os pontos abaixo antes de disponibilizar a revisão ${revisionNumber}.`}
            narrow={
              approves
                ? "A revisão será aprovada e disponibilizada em uma única ação."
                : "A revisão já está aprovada e será disponibilizada ao aluno."
            }
          />
        ) : (
          "Use quando a revisão está certa, mas ainda não deve chegar ao aluno. Depois, o botão “Entregar ao aluno” publica esta mesma revisão, sem nova aprovação."
        )}
      </p>
      <hr className="fa-rule" />
      <div className="fa-metrics">
        <div className="fa-metric">
          <strong>{workouts}</strong>
          <span>{workouts === 1 ? "treino" : "treinos"}</span>
        </div>
        <div className="fa-metric">
          <strong>{below}</strong>
          <span>abaixo do alvo</span>
        </div>
        <div className="fa-metric">
          <strong>{records > 0 ? records : exercises}</strong>
          <span>{records > 0 ? "avisos e premissas" : exercises === 1 ? "exercício" : "exercícios"}</span>
        </div>
      </div>
      {below > 0 && (
        <div className="fa-warnbox">
          <strong>
            <Resp
              wide={`${below} de ${workouts} ${workouts === 1 ? "treino está" : "treinos estão"} abaixo do alvo de exercícios`}
              narrow={`${below} ${below === 1 ? "treino está" : "treinos estão"} abaixo do alvo`}
            />
          </strong>
          <p>
            <Resp
              wide="Confirme que a distribuição é adequada ao aluno antes de continuar. É uma referência de quantidade e não impede a aprovação."
              narrow="Confirme que a distribuição é adequada antes de entregar."
            />
          </p>
        </div>
      )}
      <ScreeningNote screening={screening} assessmentsHref={assessmentsHref} />
      {needsAck && (
        <label className="fa-ack">
          <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
          <span>{ackText}</span>
        </label>
      )}
      {deliver && (
        <div className="fa-notify">
          <label className="fa-notify-row">
            <input type="checkbox" disabled checked={false} readOnly aria-describedby={`${titleId}-notify`} />
            <span>
              <Resp wide="Notificar o aluno quando o acesso estiver disponível" narrow="Notificar quando houver acesso" />
            </span>
          </label>
          <hr className="fa-rule fa-n" />
          <p id={`${titleId}-notify`} className="fa-notify-text">
            {portal === "ACTIVE"
              ? "Aviso ao aluno ainda não disponível: o aluno passa a ver esta revisão na área do aluno assim que ela for entregue."
              : "Aviso ao aluno ainda não disponível: a entrega fica registrada e o aluno verá o treino quando tiver acesso. Esta ação não cria nem ativa o acesso."}
          </p>
        </div>
      )}
      <ul className="fa-notes">{notes}</ul>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <hr className="fa-rule fa-rule-foot" />
      <div className="fa-confirm-footer">
        <button type="button" className="fa-btn fa-btn-secondary" disabled={pending} onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className="fa-btn fa-btn-primary"
          disabled={pending || blocked || (needsAck && !ack)}
          onClick={onConfirm}
        >
          {deliver
            ? pending
              ? "Entregando…"
              : state === "APPROVED"
                ? "Confirmar entrega"
                : "Confirmar e entregar"
            : pending
              ? "Aprovando…"
              : "Aprovar sem entregar"}
        </button>
      </div>
    </div>
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
    <p className="fa-note" role="status">
      Avaliação de {formatCalendarDate(screening.assessedOn)}.
      {screening.kind === "CLEAR" ? ` ${NOT_CLEARANCE_TEXT}` : ""}{" "}
      <Link className="account-link" href={screening.href}>
        Abrir a avaliação
      </Link>
    </p>
  );
}
