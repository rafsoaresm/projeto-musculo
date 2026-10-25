import type { Metadata } from "next";
import { requireStudent } from "@/modules/auth/server";
import { studentTrainingFor } from "@/db/student-plan";
import { PageHeading } from "@/components/ui";
import { StudentTraining } from "@/modules/portal/student-training";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Treino atual · Área do aluno" };

export default async function StudentTrainingPage() {
  const { db, user, links } = await requireStudent();
  // The students come from the verified links of this login, never from the address.
  const perStudent = await Promise.all(
    links.map(async (link) => ({
      link,
      plans: await studentTrainingFor(db, user.id, link.studentId),
    })),
  );
  const any = perStudent.some((entry) => entry.plans.length > 0);
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title="Treino atual"
        description="O que o seu profissional aprovou e entregou para você."
      />
      {!any && (
        <section className="panel">
          <h2>Nenhum treino liberado ainda.</h2>
          <p>
            Quando o seu profissional revisar, aprovar e entregar o seu plano,
            ele aparece aqui. Rascunhos nunca chegam até você.
          </p>
        </section>
      )}
      {perStudent.map(({ link, plans }) =>
        plans.length === 0 ? null : (
          <div key={link.studentId}>
            {links.length > 1 && (
              <p className="eyebrow">
                {link.organizationName} · {link.studentName}
              </p>
            )}
            {plans.map((plan) => (
              <StudentTraining
                key={plan.planId}
                plan={plan}
                pdfHref={`/aluno/treino/pdf/${link.studentId}/${plan.planId}`}
                logBase={`/aluno/treino/registrar/${link.studentId}/${plan.planId}`}
              />
            ))}
          </div>
        ),
      )}
    </>
  );
}
