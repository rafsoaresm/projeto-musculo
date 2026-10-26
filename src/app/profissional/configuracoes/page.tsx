import type { Metadata } from "next";
import { requireWorkspace } from "@/modules/auth/server";
import { workspaceSettingsFor } from "@/db/workspace-settings";
import { formatDate, PageHeading } from "@/components/ui";
import { MEMBERSHIP_ROLE_LABEL } from "@/modules/platform/areas";
import { renameSelf, renameWorkspace } from "@/modules/configuracoes/actions";
import { NameForm } from "@/modules/configuracoes/name-form";
import { ROLE_PERMISSION_NOTICE } from "@/modules/configuracoes/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Configurações" };

export default async function Settings() {
  const { db, context } = await requireWorkspace();
  const view = await workspaceSettingsFor(db, context).read();
  if (!view) return null;
  return (
    <>
      <PageHeading
        eyebrow={view.workspaceName}
        title="Configurações"
        description="Os nomes que os seus alunos veem e quem tem acesso ao espaço."
      />
      <section className="panel" aria-labelledby="espaco">
        <p className="eyebrow">ESPAÇO</p>
        <h2 id="espaco">Nome do espaço</h2>
        <p className="muted">
          Aparece para os seus alunos no convite e na área deles, e no PDF do plano. Espaço criado em{" "}
          {formatDate(view.createdAt)}.
        </p>
        {view.canRenameWorkspace ? (
          <NameForm
            label="Nome do espaço"
            formLabel="Alterar o nome do espaço"
            initial={view.workspaceName}
            save={renameWorkspace}
            savedText="Nome do espaço salvo."
          />
        ) : (
          <dl className="detail-list">
            <div>
              <dt>Nome do espaço</dt>
              <dd>{view.workspaceName}</dd>
            </div>
            <div>
              <dt>Quem pode mudar</dt>
              <dd>Só o proprietário do espaço</dd>
            </div>
          </dl>
        )}
      </section>
      {view.displayName !== null && (
        <section className="panel" aria-labelledby="exibicao">
          <p className="eyebrow">VOCÊ</p>
          <h2 id="exibicao">Seu nome de exibição</h2>
          <p className="muted">
            É o nome que o aluno vê como o seu profissional, no convite e na área dele, e que aparece como quem entregou
            o treino. Mudá-lo muda também como os treinos já entregues dizem quem os entregou; o conteúdo deles não muda.
          </p>
          <NameForm
            label="Nome de exibição"
            formLabel="Alterar o nome de exibição"
            initial={view.displayName}
            save={renameSelf}
            savedText="Nome de exibição salvo."
          />
        </section>
      )}
      <section className="panel" aria-labelledby="acesso">
        <p className="eyebrow">EQUIPE</p>
        <h2 id="acesso">Quem tem acesso a este espaço</h2>
        <div className="table-wrap">
          <table className="data-table stack">
            <caption className="sr-only">Pessoas com acesso ao espaço</caption>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Papel</th>
              </tr>
            </thead>
            <tbody>
              {view.members.map((member, index) => (
                <tr key={`${index}-${member.name}`}>
                  <th scope="row" data-label="Nome">
                    {member.name}
                    {member.isYou && <small className="cell-sub">Você</small>}
                  </th>
                  <td data-label="Papel">{MEMBERSHIP_ROLE_LABEL[member.role] ?? member.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{ROLE_PERMISSION_NOTICE}</p>
      </section>
    </>
  );
}
