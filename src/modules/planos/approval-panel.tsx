"use client";
import Link from "next/link";
import { Download } from "lucide-react";
import { useState, useTransition } from "react";
import { Notice, Pill, formatDateTime } from "@/components/ui";
import { NOT_CLEARANCE_TEXT, REVIEW_REQUIRED_TEXT } from "@/modules/avaliacoes/contracts";
import { formatCalendarDate } from "@/modules/training/format";
import type { PlanActionResult } from "./actions";
import { approveRevision, deliverRevision } from "./actions";

/**
 * What the newest recorded assessment of the student says. Serializable: the page builds it on
 * the server from the repository. CLEAR is "no item marked", never a clinical clearance.
 */
export type ScreeningInfo =
  | { kind: "NONE" }
  | { kind: "CLEAR"; assessedOn: string; href: string }
  | { kind: "REVIEWED"; assessedOn: string; href: string }
  | { kind: "BLOCKED"; assessedOn: string; href: string };

/**
 * The professional's decision on a closed revision: approve, then deliver. Both are acts of a
 * person; nothing here is automatic. Delivery is the only step that makes it visible to the
 * student, and the screening warning is stated as it is: nothing is registered.
 */
export function ApprovalPanel({
  planId,
  revisionId,
  state,
  below,
  workouts,
  approvedAt,
  deliveredAt,
  portal,
  studentHref,
  screening,
  pdfHref,
}: {
  planId: string;
  revisionId: string;
  state: "READY" | "APPROVED" | "DELIVERED";
  below: number;
  workouts: number;
  approvedAt: string | null;
  deliveredAt: string | null;
  portal: "ACTIVE" | "INVITED" | "NONE";
  studentHref: string;
  screening: ScreeningInfo;
  /** The PDF of the delivered revision. Only offered once it was delivered. */
  pdfHref: string;
}) {
  const [ack, setAck] = useState(false);
  const blocked = screening.kind === "BLOCKED";
  const needsAck = screening.kind === "NONE";
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const run = (task: () => Promise<PlanActionResult>) =>
    startTransition(async () => {
      const result = await task();
      setError(result?.error ?? "");
    });
  return (
    <section className="panel" aria-labelledby="aprovacao-titulo">
      <p className="eyebrow">APROVAÇÃO E ENTREGA</p>
      <h2 id="aprovacao-titulo">
        {state === "READY"
          ? "Aprovar esta revisão"
          : state === "APPROVED"
            ? "Entregar ao aluno"
            : "Entregue ao aluno"}
      </h2>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {state === "READY" && (
        <>
          <p className="muted">
            Aprovar é um ato seu: você confirma que revisou este plano. O aluno
            só recebe depois da entrega, que é um passo separado.
          </p>
          {below > 0 ? (
            <p role="status">
              <Pill tone="warning">
                {below} de {workouts} treinos abaixo do alvo
              </Pill>{" "}
              Para aprovar, todos os treinos precisam chegar ao alvo. Crie uma
              nova revisão e complete os exercícios ou ajuste o alvo.
            </p>
          ) : (
            <>
              <p role="status">
                <Pill tone="success">Alvo atendido em todos os treinos</Pill>
              </p>
              <ScreeningNote screening={screening} assessmentsHref={`${studentHref}/avaliacoes`} />
              {needsAck && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(event) => setAck(event.target.checked)}
                  />
                  Confirmo que não há triagem registrada e que verifiquei o
                  histórico e as limitações deste aluno por conta própria antes
                  de aprovar.
                </label>
              )}
            </>
          )}
          <button
            type="button"
            className="button primary"
            disabled={pending || below > 0 || blocked || (needsAck && !ack)}
            onClick={() => run(() => approveRevision(planId, revisionId, needsAck && ack))}
          >
            {pending ? "Aprovando…" : "Aprovar revisão"}
          </button>
        </>
      )}
      {state === "APPROVED" && (
        <>
          <p>
            <Pill tone="brand">Aprovada</Pill>
            {approvedAt && <> em {formatDateTime(approvedAt)}.</>} O aluno ainda
            não vê este plano.
          </p>
          {blocked && (
            <ScreeningNote screening={screening} assessmentsHref={`${studentHref}/avaliacoes`} />
          )}
          <button
            type="button"
            className="button primary"
            disabled={pending || blocked}
            onClick={() => run(() => deliverRevision(planId, revisionId))}
          >
            {pending ? "Entregando…" : "Entregar ao aluno"}
          </button>
        </>
      )}
      {state === "DELIVERED" && (
        <>
          <p>
            <Pill tone="success">Entregue</Pill>
            {deliveredAt && <> em {formatDateTime(deliveredAt)}.</>} Esta
            revisão não muda mais. Para alterar o treino, crie uma nova
            revisão: o aluno continua vendo esta até você entregar a nova.
          </p>
          <Link className="button secondary small" href={pdfHref} download prefetch={false}>
            <Download size={16} /> Baixar PDF desta revisão
          </Link>
          {blocked && (
            <Notice tone="warning">
              <p>
                <strong>{REVIEW_REQUIRED_TEXT}</strong> A avaliação de{" "}
                {formatCalendarDate(screening.assessedOn)} foi registrada com
                alerta e este treino já foi entregue. Registre a sua revisão
                {" "}
                <Link className="account-link" href={screening.href}>
                  na avaliação
                </Link>{" "}
                e decida se o plano precisa de uma nova revisão.
              </p>
            </Notice>
          )}
          {portal !== "ACTIVE" && (
            <p className="small muted">
              {portal === "INVITED"
                ? "O convite do aluno ainda está pendente."
                : "O aluno ainda não tem acesso à área do aluno."}{" "}
              Ele verá o treino quando entrar.{" "}
              <Link className="account-link" href={studentHref}>
                Abrir o acesso do aluno
              </Link>
            </p>
          )}
        </>
      )}
    </section>
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
          <strong>Triagem não registrada.</strong> Ainda não existe avaliação
          com triagem para este aluno nesta ferramenta. Isso não significa
          ausência de riscos.{" "}
          <Link className="account-link" href={assessmentsHref}>
            Registrar uma avaliação
          </Link>
        </p>
      </Notice>
    );
  if (screening.kind === "BLOCKED")
    return (
      <Notice tone="warning">
        <p>
          <strong>{REVIEW_REQUIRED_TEXT}</strong> A avaliação de{" "}
          {formatCalendarDate(screening.assessedOn)} tem triagem com alerta e
          ainda não tem revisão sua registrada.{" "}
          <Link className="account-link" href={screening.href}>
            Registrar a revisão
          </Link>
        </p>
      </Notice>
    );
  return (
    <p role="status">
      <Pill tone={screening.kind === "CLEAR" ? "neutral" : "brand"}>
        {screening.kind === "CLEAR"
          ? "Nenhum sinal marcado na triagem"
          : "Alerta da triagem com revisão registrada"}
      </Pill>{" "}
      <span className="small muted">
        Avaliação de {formatCalendarDate(screening.assessedOn)}.
        {screening.kind === "CLEAR" ? ` ${NOT_CLEARANCE_TEXT}` : ""}{" "}
        <Link className="account-link" href={screening.href}>
          Abrir a avaliação
        </Link>
      </span>
    </p>
  );
}
