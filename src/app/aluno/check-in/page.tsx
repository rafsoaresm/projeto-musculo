import type { Metadata } from "next";
import { requireStudent } from "@/modules/auth/server";
import { studentCheckinsFor } from "@/db/student-checkins";
import { PageHeading } from "@/components/ui";
import { CheckinForm } from "@/modules/checkin/checkin-form";
import { CheckinHistory } from "@/modules/checkin/checkin-history";
import { RepliesSeen } from "@/modules/checkin/replies-seen";
import { daysBefore } from "@/modules/checkin/contracts";
import { MAX_DAYS_BACK, todayInBrazil } from "@/modules/execucao/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Check-in · Área do aluno" };

export default async function StudentCheckin() {
  const { db, user, links } = await requireStudent();
  const checkins = studentCheckinsFor(db, user.id);
  const today = todayInBrazil();
  const oldest = daysBefore(today, MAX_DAYS_BACK);
  // The students come from the verified links of this login, never from the address.
  const perStudent = await Promise.all(
    links.map(async (link) => ({
      link,
      // The window plus room for the history: every day of the window is in it, so a day that has a check-in opens it.
      rows: await checkins.recent(link.studentId, 30),
      form: await checkins.currentForm(link.studentId),
    })),
  );
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title="Check-in"
        description="Como você está, com as perguntas do seu profissional. Um por dia, hoje ou de dias anteriores."
      />
      {perStudent.map(({ link, rows, form }) => {
        const fresh = new Set(rows.filter((row) => row.newReply).map((row) => row.id));
        return (
          <div key={link.studentId}>
            {links.length > 1 && (
              <p className="eyebrow">
                {link.organizationName} · {link.studentName}
              </p>
            )}
            <section className="panel" aria-labelledby={`checkin-hoje-${link.studentId}`}>
              <h2 id={`checkin-hoje-${link.studentId}`}>Registrar check-in</h2>
              <CheckinForm
                key={link.studentId}
                studentId={link.studentId}
                today={today}
                oldest={oldest}
                rows={rows}
                currentForm={form.form}
              />
            </section>
            <section className="panel" aria-labelledby={`checkin-historico-${link.studentId}`}>
              <h2 id={`checkin-historico-${link.studentId}`}>Os seus últimos check-ins</h2>
              <CheckinHistory rows={rows} audience="student" newReplies={fresh} />
              <RepliesSeen studentId={link.studentId} pending={fresh.size > 0} />
            </section>
          </div>
        );
      })}
    </>
  );
}
