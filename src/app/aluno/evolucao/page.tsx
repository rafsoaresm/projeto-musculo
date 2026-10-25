import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/modules/auth/server";
import { studentSessionsFor } from "@/db/workout-sessions";
import { PageHeading, Pill } from "@/components/ui";
import { formatCalendarDate } from "@/modules/training/format";
import { ProgressView } from "@/modules/execucao/progress-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Evolução · Área do aluno" };

export default async function StudentProgressPage() {
  const { db, user, links } = await requireStudent();
  const sessions = studentSessionsFor(db, user.id);
  // The students come from the verified links of this login, never from the address.
  const perStudent = await Promise.all(
    links.map(async (link) => ({
      link,
      progress: await sessions.progress(link.studentId),
      recent: await sessions.recent(link.studentId, 10),
    })),
  );
  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title="Evolução"
        description="O que você registrou nos seus treinos."
      />
      {perStudent.map(({ link, progress, recent }) => (
        <div key={link.studentId}>
          {links.length > 1 && (
            <p className="eyebrow">
              {link.organizationName} · {link.studentName}
            </p>
          )}
          {recent.length === 0 && (
            <section className="panel">
              <h2>Você ainda não registrou nenhum treino.</h2>
              <p>
                Depois de treinar, abra o seu treino e use &ldquo;Registrar este treino&rdquo;. Aqui aparecem os
                seus registros por semana e a carga de cada exercício.
              </p>
              <Link className="button primary" href="/aluno/treino">
                Abrir o treino
              </Link>
            </section>
          )}
          <ProgressView progress={progress} audience="student" />
          {recent.length > 0 && (
            <section className="panel" aria-labelledby={`recentes-${link.studentId}`}>
              <h2 id={`recentes-${link.studentId}`}>Seus últimos registros</h2>
              <ul className="review-list">
                {recent.map((item) => (
                  <li key={item.id}>
                    <p>
                      <strong>{formatCalendarDate(item.performedOn)}</strong> · treino {item.workoutLabel}, fase{" "}
                      {item.phaseIndex}
                      {item.effort !== null && <> · esforço {item.effort} de 10</>}{" "}
                      {item.painReported && <Pill tone="warning">Relato de dor registrado</Pill>}{" "}
                      {item.acknowledged && <Pill tone="success">Lido pelo profissional</Pill>}
                    </p>
                  </li>
                ))}
              </ul>
              <p>
                <Link className="account-link" href="/aluno/treino">
                  Voltar ao treino
                </Link>
              </p>
            </section>
          )}
        </div>
      ))}
    </>
  );
}
