import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireStudent } from "@/modules/auth/server";
import { studentTrainingFor } from "@/db/student-plan";
import { studentSessionsFor } from "@/db/workout-sessions";
import { Notice, PageHeading, Pill } from "@/components/ui";
import { describeDose } from "@/modules/prescricao/describe";
import { formatCalendarDate } from "@/modules/training/format";
import { MAX_DAYS_BACK, PAIN_ADVICE, todayInBrazil } from "@/modules/execucao/contracts";
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
  if (!plan || !phase || !workout || workout.exercises.length === 0) notFound();

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

  return (
    <>
      <PageHeading
        eyebrow="ÁREA DO ALUNO"
        title={`Registrar treino ${label}`}
        description={`${plan.title} · fase ${String(phase.index).padStart(2, "0")}`}
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
          exercises={workout.exercises.map((exercise) => ({
            id: exercise.id,
            name: exercise.name,
            dose: describeDose(exercise),
            notes: exercise.notes,
            last: lastText(exercise.name),
          }))}
          prescribedSets={Object.fromEntries(workout.exercises.map((exercise) => [exercise.id, exercise.sets]))}
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
                  {item.effort !== null && <> · esforço {item.effort} de 10</>}{" "}
                  {item.painReported && <Pill tone="warning">Relato de dor registrado</Pill>}{" "}
                  {item.acknowledged && <Pill tone="success">Lido pelo profissional</Pill>}
                </p>
                {item.editable && (
                  <p>
                    <Link className="text-link" href={`${here}?editar=${item.id}`}>
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
