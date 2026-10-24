import type { Metadata } from "next";
import { requireStudent } from "@/modules/auth/server";
import { studentTrainingFor } from "@/db/student-plan";
import { formatDate } from "@/components/ui";
import { formatCalendarDate } from "@/modules/training/format";
import { PortalHome } from "@/modules/portal/portal-home";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Início · Área do aluno" };

export default async function StudentHome() {
  const { db, user, links } = await requireStudent();
  // Only delivered revisions of the students this login is linked to.
  const plans = (
    await Promise.all(
      links.map((link) => studentTrainingFor(db, user.id, link.studentId)),
    )
  ).flat();
  const latest = plans[0];
  return (
    <PortalHome
      links={links}
      trainingHref="/aluno/treino"
      trainingLinkLabel={
        latest ? "Abrir o treino" : "Ver o treino atual"
      }
      currentPlan={
        latest
          ? {
              title: latest.title,
              detail: `Ciclo de ${formatCalendarDate(latest.startDate)} a ${formatCalendarDate(latest.endDate)}, com ${latest.phases.length} fases.`,
              delivered: `Revisão ${latest.revisionNumber}, entregue em ${formatDate(latest.deliveredAt)}.`,
            }
          : undefined
      }
    />
  );
}
