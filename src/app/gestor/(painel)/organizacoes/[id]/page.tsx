import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { platformFor } from "@/db/platform";
import { Kpi, Notice, PageHeading, Pill, formatDate } from "@/components/ui";
import { MemberAccess } from "@/modules/gestor/member-access";
import { ResetTwoFactor } from "@/modules/gestor/reset-two-factor";
import { resetMemberTwoFactor } from "@/modules/gestor/actions";
import { MEMBERSHIP_ROLE_LABEL } from "@/modules/platform/areas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Organização · Gestor" };

export default async function OrganizationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db, context } = await requirePlatformAdmin();
  const found = await platformFor(db, context).findOrganization(id);
  if (!found) notFound();
  const { organization, members } = found;
  return (
    <>
      <PageHeading
        eyebrow="ORGANIZAÇÃO"
        title={organization.name}
        description={`Criada em ${formatDate(organization.createdAt)}.`}
      />
      <div className="kpi-grid">
        <Kpi label="Profissionais" value={organization.members} />
        <Kpi
          label="Alunos cadastrados"
          value={organization.students}
          hint="Só a contagem"
        />
        <Kpi label="Acessos de aluno ativos" value={organization.portalAccesses} />
        <Kpi
          label="Pedidos de titulares em aberto"
          value={organization.requestsOpen}
          hint={
            organization.requestsOverdue > 0
              ? `${organization.requestsOverdue} passou do prazo de 15 dias`
              : "Só a contagem; quem responde é o profissional"
          }
        />
      </div>
      <Notice>
        <p>
          O bloqueio vale para a pessoa em toda a plataforma e fica registrado
          na auditoria. Alunos, avaliações e treinos não são lidos nem alterados
          por esta tela.
        </p>
      </Notice>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">EQUIPE</p>
            <h2>Pessoas com acesso à organização</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table stack">
            <caption className="sr-only">
              Pessoas vinculadas a {organization.name}
            </caption>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">E-mail</th>
                <th scope="col">Papel</th>
                <th scope="col">Situação</th>
                <th scope="col">
                  <span className="sr-only">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <th scope="row" data-label="Nome">{member.displayName ?? "—"}</th>
                  <td data-label="E-mail">{member.email}</td>
                  <td data-label="Papel">
                    {MEMBERSHIP_ROLE_LABEL[member.role] ?? member.role}
                  </td>
                  <td data-label="Situação">
                    {member.twoFactor && <small className="cell-sub">Duas etapas ativas</small>}
                    {member.revoked ? (
                      <Pill>Vínculo encerrado</Pill>
                    ) : member.blocked ? (
                      <Pill tone="danger">Bloqueado</Pill>
                    ) : (
                      <Pill tone="success">Ativo</Pill>
                    )}
                  </td>
                  <td>
                    {!member.revoked && member.userId !== context.userId && (
                      <MemberAccess
                        organizationId={organization.id}
                        userId={member.userId}
                        blocked={member.blocked}
                        name={member.displayName ?? member.email}
                      />
                    )}
                    {!member.revoked && member.userId !== context.userId && (
                      <ResetTwoFactor
                        name={member.displayName ?? member.email}
                        enabled={member.twoFactor}
                        reset={resetMemberTwoFactor.bind(null, organization.id, member.userId)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Link className="button secondary" href="/gestor/organizacoes">
        <ArrowLeft size={17} /> Voltar às organizações
      </Link>
    </>
  );
}
