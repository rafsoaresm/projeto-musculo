import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Pill, formatDateTime } from "@/components/ui";
import type { ProposalHeader, ProposalSummary } from "@/db/prescription-proposals";
import { BASIS_LABELS, BASIS_TONES, SEVERITY_LABELS, SEVERITY_TONES } from "./view";

/**
 * The automatic prescription on the revision page of a DRAFT (design §6.1, UI item 1): the way in ("Gerar prescrição automática")
 * once the structure is saved, or the open proposal waiting for review. Server component: links only.
 */
export function AutoPrescriptionCard({ href, open, applied = false }: { href: string; open: ProposalHeader | null; applied?: boolean }) {
  return (
    <section className="panel auto-card" aria-labelledby="auto-card-titulo">
      <div className="auto-card-body">
        <Sparkles size={22} aria-hidden="true" />
        <div>
          <h2 id="auto-card-titulo">Prescrição automática</h2>
          {open ? (
            <p className="small muted">
              Há uma proposta aberta (versão {open.version}, atualizada em {formatDateTime(open.updatedAt)}).{" "}
              {open.contentVersion !== open.baseContentVersion
                ? "O rascunho mudou desde a geração: atualize a proposta antes de aplicar."
                : "Revise, ajuste e aplique ao rascunho."}
            </p>
          ) : applied ? (
            <p className="small muted">
              Este rascunho já recebeu uma proposta automática. Você pode gerar outra: os exercícios que já estão aqui são mantidos, e
              nada muda até você aplicar.
            </p>
          ) : (
            <p className="small muted">
              Gere todos os treinos desta periodização a partir dos dados do aluno e da biblioteca. É uma proposta para você revisar: nada
              entra no rascunho sem a sua aplicação, e a aprovação continua sendo sua.
            </p>
          )}
        </div>
      </div>
      <Link className="button primary" href={href}>
        {open ? "Revisar a proposta aberta" : applied ? "Gerar uma nova proposta" : "Gerar prescrição automática"}
      </Link>
    </section>
  );
}

/**
 * What stays on the draft after the apply (design §5.1: "issues/flags stay on the APPLIED proposal; revision page shows them"):
 * the alerts, the warnings and the assumptions of the proposal that wrote this revision.
 */
export function AppliedProposalNotes({ header, summary, historyHref }: { header: ProposalHeader; summary: ProposalSummary; historyHref: string }) {
  const warnings = summary.issues.filter((i) => i.severity !== "INFO");
  return (
    <details className="panel auto-details applied-notes">
      <summary>
        Alertas, avisos e premissas da proposta aplicada ({summary.flags.length + warnings.length + summary.assumptions.length})
      </summary>
      <p className="small muted">
        Proposta aplicada em {formatDateTime(header.closedAt ?? header.updatedAt)} · motor {header.engineVersion} · regras {header.rulesId}{" "}
        {header.rulesVersion}. <Link href={historyHref}>Ver o histórico</Link>
      </p>
      {summary.flags.length > 0 && (
        <>
          <h3 className="small-heading">Alertas</h3>
          <ul className="auto-list">
            {summary.flags.map((f) => (
              <li key={f.code} className="small">
                <Pill tone={SEVERITY_TONES[f.severity]}>{SEVERITY_LABELS[f.severity]}</Pill> {f.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {warnings.length > 0 && (
        <>
          <h3 className="small-heading">Avisos</h3>
          <ul className="auto-list">
            {warnings.map((i, n) => (
              <li key={`${i.code}-${n}`} className="small">
                <Pill tone={SEVERITY_TONES[i.severity]}>{SEVERITY_LABELS[i.severity]}</Pill> {i.message}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="small-heading">Premissas</h3>
      <ul className="auto-list">
        {summary.assumptions.map((a) => (
          <li key={a.code} className="small">
            <Pill tone={BASIS_TONES[a.basis]}>{BASIS_LABELS[a.basis]}</Pill> {a.text}
          </li>
        ))}
      </ul>
    </details>
  );
}
