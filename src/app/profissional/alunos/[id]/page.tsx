import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/modules/auth/server";
import { studentsFor } from "@/db/students";
import { studentAccessFor } from "@/db/student-access";
import { plansFor } from "@/db/plans";
import { profilesFor } from "@/db/student-profile";
import { assessmentsFor } from "@/db/assessments";
import { assessmentTemplatesFor } from "@/db/assessment-templates";
import { executionFor } from "@/db/workout-sessions";
import { studentConsentFor } from "@/db/consent";
import { dataRequestsFor } from "@/db/data-requests";
import { readsOfStudent, recordStudentRead, seesStudentReads } from "@/db/student-reads";
import { PageHeading } from "@/components/ui";
import { Tabs } from "@/components/tabs";
import { InvitePanel } from "@/modules/convites/invite-panel";
import { PlansPanel } from "@/modules/planos/plans-panel";
import { ProfileSummary } from "@/modules/ficha/profile-summary";
import { AssessmentsPanel } from "@/modules/avaliacoes/assessments-panel";
import { ExecutionPanel } from "@/modules/execucao/execution-panel";
import { ConsentLine } from "@/modules/consentimento/consent-line";
import { CheckinPanel } from "@/modules/checkin/checkin-panel";
import { RequestsPanel } from "@/modules/pedidos/requests-panel";
import { StudentReadsPanel } from "@/modules/alunos/student-reads-panel";
import { STUDENT_HASH_TABS, STUDENT_TABS, STUDENT_TAB_LABEL, studentTabFrom } from "@/modules/alunos/student-tab-names";
import { nextAction, portalLabel, timeline } from "@/modules/alunos/student-summary";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aluno" };

/**
 * The student's record (handoff V4 T05, Figma `1:111`): a header with the student, the portal and the next action, and tabs. Every panel is
 * drawn by the server from repositories filtered by the organization and the professional's care assignment; the tabs only show and hide.
 */
export default async function Student({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string }>;
}) {
  const { db, context, workspace } = await requireWorkspace();
  const { id } = await params;
  const { aba } = await searchParams;
  const student = await studentsFor(db, context).findById(id);
  if (!student) notFound();
  // Opening the record leaves a line in the trail of reads (one per interval); the OWNER and the MANAGER see that trail here.
  await recordStudentRead(db, context, student.id, "STUDENT_RECORD");
  const showReads = seesStudentReads(workspace.role);
  const [access, plans, profile, assessments, executions, consent, requests, templates] = await Promise.all([
    studentAccessFor(db, context).statusOf(student.id),
    plansFor(db, context).listForStudent(student.id),
    profilesFor(db, context).get(student.id),
    assessmentsFor(db, context).listForStudent(student.id),
    executionFor(db, context).list(student.id, 5),
    studentConsentFor(db, context, student.id),
    dataRequestsFor(db, context).forStudent(student.id),
    assessmentTemplatesFor(db, context).list(),
  ]);
  const reads = showReads ? await readsOfStudent(db, context, student.id) : null;
  const openRequests = requests.filter((row) => row.outcome === null).length;
  const summary = { studentId: student.id, hasProfile: profile !== null, assessments, plans, sessions: executions, openRequests };
  const action = nextAction(summary);
  const steps = timeline(summary);
  const tabs = STUDENT_TABS.map((tab) => ({ id: tab, label: STUDENT_TAB_LABEL[tab], badge: tab === "acesso" && openRequests > 0 ? openRequests : undefined }));
  return (
    <>
      <PageHeading
        eyebrow="Ficha do aluno"
        title={student.displayName}
        description="Visão única de histórico, avaliação, plano e evolução"
        aside={
          action && (
            <Link className="button primary" href={action.href}>
              Próxima ação: {action.text}
            </Link>
          )
        }
      />
      <p className="student-status">
        {student.displayName} · {portalLabel(access?.access ?? "NONE")}
      </p>
      <Tabs
        label="Ficha do aluno"
        tabs={tabs}
        initial={studentTabFrom(aba)}
        hashTabs={STUDENT_HASH_TABS}
        panels={{
          resumo: (
            <div className="tab-grid">
              <section className="panel" aria-labelledby="linha-do-tempo">
                <h2 id="linha-do-tempo">Linha do tempo</h2>
                <p className="small muted">Cadastro → avaliação → plano → entrega → acompanhamento</p>
                <ol className="student-steps" aria-label="Etapas do aluno">
                  {steps.map((step) => (
                    <li key={step.key} className={`student-step ${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
                      {step.text}
                      {step.state === "missing" && <span className="sr-only"> (ainda não)</span>}
                    </li>
                  ))}
                </ol>
              </section>
              <ProfileSummary
                studentId={student.id}
                profile={profile}
                eyebrow="FICHA"
                heading="Informações relevantes"
                note="Restrições, objetivos e ciclo vigente"
              />
            </div>
          ),
          avaliacoes: <AssessmentsPanel studentId={student.id} assessments={assessments} templates={templates} />,
          periodizacao: (
            <>
              <PlansPanel studentId={student.id} plans={plans} />
              <section className="panel">
                <p className="eyebrow">PLANEJADOR</p>
                <h2>Explorar sem salvar</h2>
                <p className="muted">Teste um ciclo no planejador sem criar plano para este aluno.</p>
                <Link href="/profissional/periodizacao" className="account-link">
                  Abrir o planejador
                </Link>
              </section>
            </>
          ),
          treinos: <ExecutionPanel studentId={student.id} rows={executions} />,
          evolucao: (
            <>
              <CheckinPanel db={db} context={context} studentId={student.id} />
              <section className="panel" aria-labelledby="evolucao-avaliacoes">
                <h2 id="evolucao-avaliacoes">Evolução da avaliação física</h2>
                <p className="muted">As medidas das avaliações registradas, ao longo do tempo.</p>
                <Link className="account-link" href={`/profissional/alunos/${student.id}/evolucao`}>
                  Abrir a evolução da avaliação física
                </Link>
              </section>
            </>
          ),
          acesso: (
            <>
              <section className="panel" aria-labelledby="acesso-aluno">
                <p className="eyebrow">ÁREA DO ALUNO</p>
                <h2 id="acesso-aluno">Acesso do aluno</h2>
                <InvitePanel
                  studentId={student.id}
                  access={access?.access ?? "NONE"}
                  activeSince={access?.activeSince ?? null}
                  inviteExpiresAt={access?.inviteExpiresAt ?? null}
                />
                <ConsentLine consent={consent} />
              </section>
              <RequestsPanel db={db} context={context} studentId={student.id} />
              {reads && <StudentReadsPanel reads={reads} />}
            </>
          ),
        }}
      />
      <Link href="/profissional/alunos" className="button secondary">
        <ArrowLeft size={17} /> Voltar aos alunos
      </Link>
    </>
  );
}
