import type { Metadata } from "next";
import { requireStudent } from "@/modules/auth/server";
import { studentCheckinsFor } from "@/db/student-checkins";
import { PageHeading } from "@/components/ui";
import { CheckinForm } from "@/modules/checkin/checkin-form";
import { CheckinHistory } from "@/modules/checkin/checkin-history";
import { todayInBrazil } from "@/modules/execucao/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Check-in · Área do aluno" };

export default async function StudentCheckin() {
  const { db, user, links } = await requireStudent();
  const checkins = studentCheckinsFor(db, user.id);
  const today = todayInBrazil();
  // The students come from the verified links of this login, never from the address.
  const perStudent = await Promise.all(
    links.map(async (link) => ({ link, rows: await checkins.recent(link.studentId, 14) })),
  );
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title="Check-in"
        description="Como você está: esforço, recuperação e desconforto. Um por dia, quando quiser."
      />
      {perStudent.map(({ link, rows }) => (
        <div key={link.studentId}>
          {links.length > 1 && (
            <p className="eyebrow">
              {link.organizationName} · {link.studentName}
            </p>
          )}
          <section className="panel" aria-labelledby={`checkin-hoje-${link.studentId}`}>
            <h2 id={`checkin-hoje-${link.studentId}`}>Check-in de hoje</h2>
            <CheckinForm
              key={link.studentId}
              studentId={link.studentId}
              today={rows.find((row) => row.checkedOn === today) ?? null}
            />
          </section>
          <section className="panel" aria-labelledby={`checkin-historico-${link.studentId}`}>
            <h2 id={`checkin-historico-${link.studentId}`}>Os seus últimos check-ins</h2>
            <CheckinHistory rows={rows} audience="student" />
          </section>
        </div>
      ))}
    </>
  );
}
