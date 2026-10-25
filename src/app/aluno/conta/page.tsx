import type { Metadata } from "next";
import { requireStudent } from "@/modules/auth/server";
import { latestAcceptance } from "@/db/consent";
import { shownTerms } from "@/db/terms";
import { formatCalendarDate } from "@/modules/training/format";
import { PageHeading } from "@/components/ui";
import { SecurityPanel } from "@/modules/auth/components/security-panel";
import { PhotosChoice } from "@/modules/consentimento/photos-choice";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minha conta · Área do aluno" };

export default async function StudentAccount() {
  const { user, db } = await requireStudent();
  // What this person accepted, in their own words: the date and the photos choice they made.
  const accepted = await latestAcceptance(db, user.id, "STUDENT");
  const terms = await shownTerms(db, "STUDENT");
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
          Você precisa da senha atual. A recuperação de senha por e-mail ainda não está disponível: guarde a nova
          senha em um lugar seguro.
        </p>
        <SecurityPanel />
      </section>
      <section className="panel" aria-labelledby="solicitacoes-conta">
        <p className="eyebrow">SEUS DADOS</p>
        <h2 id="solicitacoes-conta">Consentimentos e solicitações</h2>
        {accepted && (
          <>
            <p>Você aceitou os termos em {formatCalendarDate(accepted.termsAcceptedAt.slice(0, 10))}.</p>
            <PhotosChoice
              authorized={accepted.photosAuthorized}
              terms={terms}
            />
          </>
        )}
        <p className="muted">
          Ainda não existe uma tela para pedir a exportação ou a exclusão dos seus dados, nem para retirar o
          aceite dos termos. Enquanto isso, fale com o seu profissional.
        </p>
      </section>
    </>
  );
}
