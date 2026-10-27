import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { leadsFor } from "@/db/leads";
import { servicesFor } from "@/db/services";
import { Pill, PageHeading, formatDateTime } from "@/components/ui";
import { canManageLeads, canWorkLeads } from "@/modules/leads/access";
import { LeadForm } from "@/modules/leads/lead-form";
import { ConvertLead, DeleteLead, MoveLead, NoteLead } from "@/modules/leads/lead-actions-panel";
import { LEAD_SOURCE_LABEL, LEAD_STAGE_LABEL, LOST_REASON_LABEL } from "@/modules/leads/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lead" };

const TONE = { NEW: "brand", CONTACT: "neutral", ASSESSMENT: "neutral", PROPOSAL: "warning", WON: "success", LOST: "danger" } as const;

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  if (!canWorkLeads(workspace.role)) notFound();
  const repo = leadsFor(db, context);
  const lead = await repo.find(id);
  if (!lead) notFound();
  const converted = Boolean(lead.studentId);
  const [timeline, services, matches] = await Promise.all([
    repo.timeline(id),
    servicesFor(db, context).list(false),
    lead.stage === "WON" && !converted && canManageLeads(workspace.role) ? repo.studentMatches(id) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeading
        eyebrow="Leads"
        title={lead.name}
        aside={
          <Link className="button secondary" href="/profissional/leads">
            <ArrowLeft size={20} />
            Voltar aos leads
          </Link>
        }
      />
      <section className="panel" aria-labelledby="resumo-lead">
        <h2 id="resumo-lead">Resumo</h2>
        <dl className="detail-list">
          <div>
            <dt>Etapa</dt>
            <dd>
              <Pill tone={TONE[lead.stage]}>{LEAD_STAGE_LABEL[lead.stage]}</Pill>
              {lead.lostReason && <> {LOST_REASON_LABEL[lead.lostReason]}</>}
            </dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{lead.email ?? "—"}</dd>
          </div>
          <div>
            <dt>Telefone</dt>
            <dd>{lead.phone ?? "—"}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>{LEAD_SOURCE_LABEL[lead.source]}</dd>
          </div>
          <div>
            <dt>Serviço de interesse</dt>
            <dd>{lead.serviceName ?? "—"}</dd>
          </div>
          <div>
            <dt>Registrado em</dt>
            <dd>{formatDateTime(lead.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="etapa-lead">
        <h2 id="etapa-lead">Etapa do funil</h2>
        <MoveLead leadId={lead.id} stage={lead.stage} converted={converted} />
      </section>

      <section className="panel" aria-labelledby="converter-lead">
        <h2 id="converter-lead">Converter em aluno</h2>
        <ConvertLead
          leadId={lead.id}
          stage={lead.stage}
          studentId={lead.studentId}
          matches={matches}
          canConvert={canManageLeads(workspace.role)}
        />
      </section>

      <section className="panel" aria-labelledby="historico-lead">
        <h2 id="historico-lead">Histórico</h2>
        <NoteLead leadId={lead.id} />
        <ul className="timeline" aria-label="Histórico do lead">
          {timeline.map((event) => (
            <li key={event.id}>
              <p className="small muted">
                {formatDateTime(event.createdAt)}
                {event.actorName ? ` · ${event.actorName}` : ""}
              </p>
              <p>
                {event.kind === "CREATED" && "Lead registrado."}
                {event.kind === "EDITED" && "Dados corrigidos."}
                {event.kind === "CONVERTED" && "Virou aluno."}
                {event.kind === "NOTE" && "Anotação."}
                {event.kind === "STAGE" && event.toStage && event.fromStage && (
                  <>
                    Etapa: {LEAD_STAGE_LABEL[event.fromStage]} → {LEAD_STAGE_LABEL[event.toStage]}
                    {event.lostReason ? ` (${LOST_REASON_LABEL[event.lostReason]})` : ""}.
                  </>
                )}
              </p>
              {event.note && <p className="note-text">{event.note}</p>}
            </li>
          ))}
        </ul>
      </section>

      {!converted && (
        <section className="panel" aria-labelledby="dados-lead">
          <h2 id="dados-lead">Corrigir os dados</h2>
          <LeadForm
            leadId={lead.id}
            services={services.map((s) => ({ id: s.id, name: s.name }))}
            currentService={lead.serviceId && lead.serviceName ? { id: lead.serviceId, name: lead.serviceName } : null}
            initial={{
              name: lead.name,
              email: lead.email ?? "",
              phone: lead.phone ?? "",
              source: lead.source,
              serviceId: lead.serviceId ?? "",
            }}
          />
        </section>
      )}

      {!converted && canManageLeads(workspace.role) && (
        <section className="panel" aria-labelledby="apagar-lead">
          <h2 id="apagar-lead">Apagar</h2>
          <p className="small muted">
            Para quem pediu para sair da lista. Apaga o lead e o histórico dele; um lead que virou aluno não é apagado.
          </p>
          <DeleteLead leadId={lead.id} name={lead.name} />
        </section>
      )}
    </>
  );
}
