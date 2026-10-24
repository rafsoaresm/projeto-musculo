import Link from "next/link";
import { Pill } from "@/components/ui";
import type { StudentProfile } from "@/db/student-profile";
import { ageOn } from "./contracts";

/** The key facts of the file, and the way to open it. Health details stay on the file page. */
export function ProfileSummary({
  studentId,
  profile,
}: {
  studentId: string;
  profile: StudentProfile | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const age = profile?.birthDate ? ageOn(profile.birthDate, today) : null;
  const facts = [
    age !== null ? `${age} anos` : null,
    profile?.goal,
    profile?.level,
    profile?.daysPerWeek ? `${profile.daysPerWeek} dias por semana` : null,
    profile?.sessionMinutes ? `${profile.sessionMinutes} min por sessão` : null,
  ].filter(Boolean);
  const hasHealthNotes = Boolean(
    profile &&
      (profile.injuries ||
        profile.surgeries ||
        profile.pains ||
        profile.limitations ||
        profile.medicationsConditions),
  );
  return (
    <section className="panel" aria-labelledby="ficha-aluno">
      <p className="eyebrow">FICHA</p>
      <h2 id="ficha-aluno">Ficha do aluno</h2>
      {profile ? (
        <>
          <p>{facts.length > 0 ? facts.join(" · ") : "Ficha salva, sem dados de contexto."}</p>
          {hasHealthNotes && (
            <p>
              <Pill tone="warning">Há lesões, dores ou limitações relatadas</Pill>{" "}
              <span className="small muted">Leia a ficha antes de prescrever.</span>
            </p>
          )}
          {age !== null && age < 18 && (
            <p>
              <Pill tone="danger">Menor de idade</Pill>{" "}
              <span className="small muted">
                O atendimento a menores ainda não é suportado pela ferramenta.
              </span>
            </p>
          )}
        </>
      ) : (
        <p className="muted">
          A ficha ainda não foi preenchida: identificação, contexto de treino,
          histórico e preferências.
        </p>
      )}
      <Link className="button primary small" href={`/profissional/alunos/${studentId}/ficha`}>
        {profile ? "Abrir a ficha" : "Preencher a ficha"}
      </Link>
    </section>
  );
}
