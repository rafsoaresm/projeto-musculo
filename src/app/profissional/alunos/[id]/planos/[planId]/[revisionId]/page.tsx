import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { plansFor } from "@/db/plans";
import { PageHeading, Pill } from "@/components/ui";
import { Planner } from "@/modules/training/components/planner";
import {
  createRevision,
  markReady,
  saveDraft,
} from "@/modules/planos/actions";
import { PlanReadOnly } from "@/modules/planos/plan-readonly";
import { stateLabel } from "@/modules/planos/labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plano" };

export default async function PlanRevision({
  params,
}: {
  params: Promise<{ id: string; planId: string; revisionId: string }>;
}) {
  const { db, context } = await requireWorkspace();
  const { id, planId, revisionId } = await params;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  const detail = await plansFor(db, context).findRevision(planId, revisionId);
  // The plan must belong to the student in the address, not just to this professional.
  if (!detail || detail.plan.studentId !== student.id) notFound();
  const { revision } = detail;
  const label = stateLabel(revision.state);
  return (
    <>
      <PageHeading
        eyebrow={`${student.displayName} · Revisão ${revision.revisionNumber}`}
        title={detail.plan.title}
        description={
          revision.state === "DRAFT"
            ? "Rascunho em edição. Salve as alterações e marque a estrutura como pronta quando o calendário estiver certo."
            : "Revisão fechada para edição."
        }
        aside={<Pill tone={label.tone}>{label.text}</Pill>}
      />
      {revision.state === "DRAFT" ? (
        <Planner
          initial={revision.input}
          persist={{
            saveLabel: "Salvar alterações",
            save: saveDraft.bind(null, planId, revisionId),
            ready: {
              label: "Marcar estrutura como pronta",
              action: markReady.bind(null, planId, revisionId),
            },
          }}
        />
      ) : (
        <PlanReadOnly
          schedule={revision.schedule}
          createRevision={createRevision.bind(null, planId, revisionId)}
        />
      )}
      <Link href={`/profissional/alunos/${student.id}`} className="button secondary">
        <ArrowLeft size={17} /> Voltar ao aluno
      </Link>
    </>
  );
}
