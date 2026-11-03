import Link from "next/link";
import { Pill } from "@/components/ui";
import type { StudentProfile } from "@/db/student-profile";
import { ageOn } from "./contracts";

/** The key facts of the file, and the way to open it. Health details stay on the file page. */
export function ProfileSummary({
  studentId,
  profile,
  heading = "Ficha do aluno",
  eyebrow = "FICHA",
  note,
}: {
  studentId: string;
  profile: StudentProfile | null;
  /** On the "Resumo" of the record the card is "Informações relevantes" (Figma `1:111`). */
  heading?: string;
  eyebrow?: string;
  /** A line under the heading. */
  note?: string;
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
      <p className="eyebrow">{eyebrow}</p>
      <h2 id="ficha-aluno">{heading}</h2>
      {note && <p className="small muted">{note}</p>}
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
              <Pill tone="warning">Menor de idade</Pill>
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
