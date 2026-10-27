import type { Metadata } from "next";
import Link from "next/link";
import { UserRoundPlus } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { leadsFor } from "@/db/leads";
import { Notice, PageHeading, Pill, formatDate } from "@/components/ui";
import { canWorkLeads } from "@/modules/leads/access";
import { LEAD_SOURCE_LABEL, LEAD_STAGES, LEAD_STAGE_LABEL, type LeadStage } from "@/modules/leads/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leads" };

const TONE = { NEW: "brand", CONTACT: "neutral", ASSESSMENT: "neutral", PROPOSAL: "warning", WON: "success", LOST: "danger" } as const;

export default async function Leads({ searchParams }: { searchParams: Promise<{ etapa?: string }> }) {
  const { db, context, workspace } = await requireWorkspace();
  if (!canWorkLeads(workspace.role))
    return (
      <>
        <PageHeading eyebrow={workspace.name} title="Leads" />
        <Notice>
          <p>O seu papel neste espaço não trabalha os leads. Eles ficam com o proprietário, a gestão e o comercial.</p>
        </Notice>
      </>
    );
  const { etapa } = await searchParams;
  const stage = (LEAD_STAGES as readonly string[]).includes(etapa ?? "") ? (etapa as LeadStage) : null;
  const repo = leadsFor(db, context);
  const [leads, counts] = await Promise.all([repo.list(stage), repo.counts()]);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return (
    <>
      <PageHeading
        eyebrow={workspace.name}
        title="Leads"
        description="Quem se interessou pelo seu trabalho e ainda não é aluno. Aqui só o que é preciso para responder: nada de saúde."
        aside={
          <Link className="button primary" href="/profissional/leads/novo">
            <UserRoundPlus size={20} />
            Novo lead
          </Link>
        }
      />
      <nav aria-label="Etapas do funil">
        <ul className="lead-stages">
          <li>
            <Link href="/profissional/leads" aria-current={stage === null ? "page" : undefined}>
              Todos ({total})
            </Link>
          </li>
          {LEAD_STAGES.map((s) => (
            <li key={s}>
              <Link href={`/profissional/leads?etapa=${s}`} aria-current={stage === s ? "page" : undefined}>
                {LEAD_STAGE_LABEL[s]} ({counts[s]})
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {leads.length === 0 ? (
        <section className="panel">
          <h2>{total === 0 ? "Seu primeiro lead começa aqui." : "Nenhum lead nesta etapa."}</h2>
          <p>
            {total === 0
              ? "Registre quem te procurou pelo Instagram, pelo WhatsApp ou pessoalmente, e acompanhe até virar aluno."
              : "Escolha outra etapa ou volte para todos."}
          </p>
        </section>
      ) : (
        <div className="table-wrap">
          <table className="data-table stack">
            <caption className="sr-only">Leads do espaço {workspace.name}</caption>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Contato</th>
                <th scope="col">Origem</th>
                <th scope="col">Serviço</th>
                <th scope="col">Etapa</th>
                <th scope="col">Atualizado em</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <th scope="row" data-label="Nome">
                    <Link href={`/profissional/leads/${lead.id}`}>{lead.name}</Link>
                  </th>
                  <td data-label="Contato">{lead.email ?? lead.phone}</td>
                  <td data-label="Origem">{LEAD_SOURCE_LABEL[lead.source]}</td>
                  <td data-label="Serviço">{lead.serviceName ?? "—"}</td>
                  <td data-label="Etapa">
                    <Pill tone={TONE[lead.stage]}>{LEAD_STAGE_LABEL[lead.stage]}</Pill>
                    {lead.studentId && <small className="cell-sub">Virou aluno</small>}
                  </td>
                  <td data-label="Atualizado em">{formatDate(lead.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
