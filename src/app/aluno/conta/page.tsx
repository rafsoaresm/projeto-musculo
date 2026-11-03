import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { requireStudent, recoveryAvailable } from "@/modules/auth/server";
import { latestAcceptance } from "@/db/consent";
import { studentRequestsFor } from "@/db/data-requests";
import { readsOfOwnData } from "@/db/student-reads";
import { OwnReadsPanel } from "@/modules/alunos/own-reads-panel";
import { formatCalendarDate } from "@/modules/training/format";
import { PageHeading } from "@/components/ui";
import { SecurityPanel } from "@/modules/auth/components/security-panel";
import { AccountAccess } from "@/modules/auth/components/account-access";
import { StudentRequests } from "@/modules/pedidos/student-requests";
import { EXPORTS_PER_HOUR, EXPORT_INCLUDED, EXPORT_NOT_INCLUDED } from "@/modules/pedidos/export";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minha conta · Área do aluno" };

export default async function StudentAccount() {
  const { user, db, links } = await requireStudent();
  const recovery = await recoveryAvailable();
  // An acceptance recorded earlier stays readable; nothing depends on it.
  const accepted = await latestAcceptance(db, user.id, "STUDENT");
  // The students come from the verified links of this login, never from the address.
  const requests = studentRequestsFor(db, user.id);
  const [perStudent, reads] = await Promise.all([
    Promise.all(links.map(async (link) => ({ link, rows: await requests.list(link.studentId) }))),
    readsOfOwnData(db, user.id),
  ]);
  const studentName = new Map(links.map((link) => [link.studentId, link.studentName]));
  return (
    <>
      <PageHeading eyebrow="ÁREA DO ALUNO" title="Minha conta" description="Seus dados de acesso e a segurança da conta." />
      <section className="panel" aria-labelledby="dados-conta">
        <h2 id="dados-conta">Seus dados de acesso</h2>
        <dl className="detail-list">
          <div>
            <dt>Nome</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>E-mail de acesso</dt>
            <dd>{user.email}</dd>
          </div>
        </dl>
      </section>
      <section className="panel" aria-labelledby="seguranca-conta">
        <p className="eyebrow">SEGURANÇA</p>
        <h2 id="seguranca-conta">Alterar a senha</h2>
        <p className="muted">
          {recovery
            ? "Você precisa da senha atual. Se um dia esquecer a senha, use “Esqueci minha senha” na tela de entrada: enviamos um link para o seu e-mail."
            : "Você precisa da senha atual. A recuperação de senha por e-mail ainda não está disponível: guarde a nova senha em um lugar seguro."}
        </p>
        <SecurityPanel />
      </section>
      <AccountAccess />
      <OwnReadsPanel
        reads={reads.map((read) => ({ ...read, studentName: studentName.get(read.studentId) }))}
        showStudent={links.length > 1}
      />
      <section className="panel" aria-labelledby="solicitacoes-conta">
        <p className="eyebrow">SEUS DADOS</p>
        <h2 id="solicitacoes-conta">Termos</h2>
        {accepted && <p>Você aceitou os termos em {formatCalendarDate(accepted.termsAcceptedAt.slice(0, 10))}.</p>}
        <Link href="/aceite?area=aluno">Ler os termos</Link>
      </section>
      <section className="panel" id="baixar" aria-labelledby="baixar-conta">
        <p className="eyebrow">SEUS DADOS</p>
        <h2 id="baixar-conta">Baixar uma cópia dos meus dados</h2>
        <p className="muted">
          Gera na hora uma cópia do que a ferramenta mostra a você. Você pode ler na tela, baixar em PDF ou baixar em
          JSON, um formato que outros programas leem e que também abre em um editor de texto. As três trazem o mesmo
          conteúdo.
        </p>
        <p>A cópia traz:</p>
        <ul>
          {EXPORT_INCLUDED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>Ela não traz:</p>
        <ul>
          {EXPORT_NOT_INCLUDED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="muted">
          Para receber também o que o seu profissional guarda, faça o pedido “Receber uma cópia dos meus dados” logo
          abaixo. Cada cópia gerada (na tela, em PDF ou em JSON) fica registrada (quando, nunca o conteúdo) e há um
          limite de {EXPORTS_PER_HOUR} por hora, somando as três. A cópia tem dados de saúde: guarde-a em um lugar
          seguro.
        </p>
        <div className="student-assessment-actions copy-actions">
          <Link className="button primary" href="/aluno/conta/meus-dados/ver" prefetch={false}>
            <FileText size={18} /> Ver na tela
          </Link>
          <Link className="button secondary" href="/aluno/conta/meus-dados/pdf" download prefetch={false}>
            <Download size={18} /> Baixar em PDF
          </Link>
          <Link className="button secondary" href="/aluno/conta/meus-dados" download prefetch={false}>
            <Download size={18} /> Baixar em JSON
          </Link>
        </div>
      </section>
      <section className="panel" id="pedidos" aria-labelledby="pedidos-conta">
        <p className="eyebrow">SEUS DIREITOS</p>
        <h2 id="pedidos-conta">Pedidos sobre os seus dados</h2>
        <p className="muted">
          Você pode pedir uma cópia dos seus dados, a correção de um dado, que as suas fotos sejam apagadas, a
          exclusão dos seus dados ou retirar o aceite dos termos. Quem responde é o seu profissional, em até 15 dias.
        </p>
        {perStudent.map(({ link, rows }) => (
          <div key={link.studentId}>
            {links.length > 1 && (
              <p className="eyebrow">
                {link.organizationName} · {link.studentName}
              </p>
            )}
            <StudentRequests studentId={link.studentId} rows={rows} />
          </div>
        ))}
      </section>
    </>
  );
}
