import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireStudent } from "@/modules/auth/server";
import { studentTrainingFor } from "@/db/student-plan";
import { studentSessionsFor } from "@/db/workout-sessions";
import { Notice, PageHeading, Pill } from "@/components/ui";
import { storedDoseText } from "@/modules/prescricao/describe";
import { formatCalendarDate } from "@/modules/training/format";
import { MAX_DAYS_BACK, PAIN_ADVICE, extraSetFields, todayInBrazil } from "@/modules/execucao/contracts";
import { findSession, sessionName } from "@/modules/portal/weeks";
import { seriesKey } from "@/modules/execucao/progress";
import { SessionForm } from "@/modules/execucao/session-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Registrar treino · Área do aluno" };

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const kg = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

export default async function RegisterWorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string; planId: string; phase: string; workout: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { db, user, links } = await requireStudent();
  const route = await params;
  const query = await searchParams;
  // The student comes from the verified links of this login, never from the address alone.
  const link = links.find((item) => item.studentId === route.studentId);
  if (!link) notFound();
  const plan = (await studentTrainingFor(db, user.id, link.studentId)).find(
    (item) => item.planId === route.planId,
  );
  const phaseIndex = Number(route.phase);
  const label = decode(route.workout);
  const phase = plan?.phases.find((item) => item.index === phaseIndex);
  const workout = phase?.workouts.find((item) => item.label === label);
  if (!plan || !phase || !workout) notFound();
  const perSession = plan.prescriptionModel === "OCCURRENCE";
  if (!perSession && workout.exercises.length === 0) notFound();

  const sessions = studentSessionsFor(db, user.id);
  const recent = await sessions.forWorkout(link.studentId, plan.planId, phaseIndex, label);
  const editId = typeof query.editar === "string" ? query.editar : null;
  const candidate = editId ? await sessions.get(editId) : null;
  const initial =
    candidate &&
    candidate.editable &&
    candidate.planId === plan.planId &&
    candidate.revisionId === plan.revisionId &&
    candidate.phaseIndex === phaseIndex &&
    candidate.workoutLabel === label
      ? candidate
      : null;
  // A plan written session by session logs one session of one week (`?ocorrencia=`); a correction keeps its own session.
  const asked = initial?.occurrenceId ?? (typeof query.ocorrencia === "string" ? query.ocorrencia : null);
  const found = perSession ? findSession(plan, asked) : null;
  const occurrence = found && found.phase.index === phaseIndex && found.session.label === label ? found.session : null;
  const choices = perSession
    ? (phase.weeksDetail ?? []).flatMap((week) => week.sessions.filter((item) => item.label === label && item.exercises.length > 0))
    : [];
  if (perSession && choices.length === 0) notFound();
  const exercises = perSession ? (occurrence?.exercises ?? []) : workout.exercises;
  const sessionOf = new Map(choices.map((item) => [item.id, item]));
  const today = todayInBrazil();
  // A reference to what the student typed last time. It is shown, never filled in.
  const progress = await sessions.progress(link.studentId);
  const lastOf = new Map(progress.series.map((item) => [item.key, item.points[item.points.length - 1]]));
  const lastText = (name: string) => {
    const point = lastOf.get(seriesKey(name));
    if (!point) return null;
    const when = formatCalendarDate(point.performedOn);
    return point.maxLoadKg === null
      ? `Seu último registro: ${when}.`
      : `Seu último registro: ${kg.format(point.maxLoadKg)} kg${point.repsAtMax === null ? "" : ` × ${point.repsAtMax} rep.`} em ${when}.`;
  };
  const here = `/aluno/treino/registrar/${link.studentId}/${plan.planId}/${phaseIndex}/${encodeURIComponent(label)}`;

  if (perSession && !occurrence)
    return (
      <>
        <PageHeading
          eyebrow="ÁREA DO ALUNO"
          title={`Registrar treino ${label}`}
          description={`${plan.title} · fase ${String(phase.index).padStart(2, "0")}`}
        />
        <section className="panel" aria-labelledby="sessao-titulo">
          <h2 id="sessao-titulo">Qual sessão você fez?</h2>
          <p className="muted">Cada semana tem a sua dose. Escolha a sessão para registrar o que você fez nela.</p>
          <ul className="review-list">
            {choices.map((item) => (
              <li key={item.id}>
                <Link className="text-link" href={`${here}?ocorrencia=${encodeURIComponent(item.id)}`}>
                  {sessionName(item)}
                </Link>
                {item.plannedDate && <span className="small muted"> · previsto para {formatCalendarDate(item.plannedDate)}</span>}
              </li>
            ))}
          </ul>
        </section>
        <Link href="/aluno/treino" className="button secondary">
          <ArrowLeft size={17} /> Voltar ao treino
        </Link>
      </>
    );

  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title={occurrence ? `Registrar treino ${label} · ${sessionName(occurrence).toLowerCase()}` : `Registrar treino ${label}`}
        description={`${plan.title} · fase ${String(phase.index).padStart(2, "0")}${
          occurrence?.plannedDate ? ` · previsto para ${formatCalendarDate(occurrence.plannedDate)}` : ""
        }`}
      />
      <Notice tone="warning">
        <p>
          <strong>{PAIN_ADVICE}</strong>
        </p>
      </Notice>
      <section className="panel" aria-labelledby="registro-titulo">
        <h2 id="registro-titulo">{initial ? "Corrigir registro" : "Novo registro"}</h2>
        <SessionForm
          key={initial?.id ?? "novo"}
          studentId={link.studentId}
          planId={plan.planId}
          phaseIndex={phaseIndex}
          workoutLabel={label}
          occurrenceId={occurrence?.id ?? null}
          exercises={exercises.map((exercise) => ({
            id: exercise.id,
            name: exercise.name,
            dose: storedDoseText(exercise),
            notes: exercise.notes,
            last: lastText(exercise.name),
            extraFields: extraSetFields(perSession, exercise.metric),
          }))}
          prescribedSets={Object.fromEntries(exercises.map((exercise) => [exercise.id, exercise.sets]))}
          initial={initial}
          today={today}
          oldest={daysBefore(today, MAX_DAYS_BACK)}
        />
      </section>
      <section className="panel" aria-labelledby="historico-titulo">
        <h2 id="historico-titulo">Seus últimos registros deste treino</h2>
        {recent.length === 0 ? (
          <p className="muted">Você ainda não registrou este treino.</p>
        ) : (
          <ul className="review-list">
            {recent.map((item) => (
              <li key={item.id}>
                <p>
                  <strong>{formatCalendarDate(item.performedOn)}</strong>
                  {item.occurrenceId && sessionOf.has(item.occurrenceId) && <> · {sessionName(sessionOf.get(item.occurrenceId)!)}</>}
                  {item.effort !== null && <> · esforço {item.effort} de 10</>}{" "}
                  {item.painReported && <Pill tone="warning">Relato de dor registrado</Pill>}{" "}
                  {item.acknowledged && <Pill tone="success">Lido pelo profissional</Pill>}
                </p>
                {item.editable && (
                  <p>
                    <Link
                      className="text-link"
                      href={`${here}?editar=${item.id}${item.occurrenceId ? `&ocorrencia=${encodeURIComponent(item.occurrenceId)}` : ""}`}
                    >
                      Corrigir este registro
                    </Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/aluno/treino" className="button secondary">
        <ArrowLeft size={17} /> Voltar ao treino
      </Link>
    </>
  );
}
