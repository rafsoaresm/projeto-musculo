import Link from "next/link";
import { ArrowRight, Dumbbell, ShieldCheck } from "lucide-react";
import { PageHeading, Pill, formatDate } from "@/components/ui";

export interface PortalHomeLink {
  studentId: string;
  studentName: string;
  organizationName: string;
  professionalName: string | null;
  since: string;
}

/** Client home. Real data only says what exists: a link and no released plan yet. */
export interface PortalCurrentPlan {
  title: string;
  detail: string;
  delivered: string;
}

export function PortalHome({
  links,
  trainingHref,
  trainingLinkLabel,
  currentPlan,
}: {
  links: PortalHomeLink[];
  trainingHref: string;
  trainingLinkLabel: string;
  /** Only passed when a delivered revision exists (demonstration for now). */
  currentPlan?: PortalCurrentPlan;
}) {
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title="Seu acompanhamento."
        description="Aqui fica o que o seu profissional liberar para você."
      />
      {links.map((link) => (
        <section className="panel" key={link.studentId}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {link.professionalName
                  ? `COM ${link.professionalName.toUpperCase()}`
                  : "SEU PROFISSIONAL"}
              </p>
              <h2>{link.studentName}</h2>
            </div>
            <Pill tone="success">Acesso ativo</Pill>
          </div>
          <p className="muted">
            {link.organizationName} · acompanhamento desde{" "}
            {formatDate(link.since)}
          </p>
        </section>
      ))}
      <section className="panel planned-panel">
        <span className="icon-tile">
          <Dumbbell size={24} />
        </span>
        <div>
          <p className="eyebrow">TREINO ATUAL</p>
          {currentPlan ? (
            <>
              <h2>{currentPlan.title}</h2>
              <p>{currentPlan.detail}</p>
              <p className="small muted">{currentPlan.delivered}</p>
            </>
          ) : (
            <>
              <h2>Nenhum treino liberado ainda.</h2>
              <p>
                Quando o seu profissional revisar, aprovar e entregar o seu
                plano, ele aparece aqui. Rascunhos nunca chegam até você.
              </p>
            </>
          )}
          <Link className="text-link" href={trainingHref}>
            {trainingLinkLabel} <ArrowRight size={15} />
          </Link>
        </div>
      </section>
      <section className="panel planned-panel">
        <span className="icon-tile">
          <ShieldCheck size={24} />
        </span>
        <div>
          <p className="eyebrow">PRIVACIDADE</p>
          <h2>Seus dados ficam com quem cuida de você.</h2>
          <p>
            Somente o profissional responsável pelo seu atendimento acessa o seu
            cadastro. Quem administra a plataforma não vê os dados dos alunos.
          </p>
        </div>
      </section>
    </>
  );
}
