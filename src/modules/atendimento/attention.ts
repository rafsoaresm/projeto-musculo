/**
 * The work queue of the professional's overview ("Demandam atenção", handoff V4 T02 and the Figma frame 1:2): one list of things that ask
 * for an action, each with the student, the reason and where to act. Pure: it orders what the repositories already found, it never decides
 * anything clinical, and nothing at zero becomes an item (AC02.4). The order puts first what has a deadline or a safety reason.
 */
export interface AttentionInput {
  requests: Array<{ id: string; studentId: string; studentName: string; kindLabel: string; overdue: boolean; dueOn: string }>;
  alerts: Array<{ studentId: string; studentName: string; assessmentId: string; assessedOn: string }>;
  pain: Array<{ sessionId: string; studentId: string; studentName: string; workoutLabel: string; performedOn: string }>;
  checkins: Array<{ checkinId: string; studentId: string; studentName: string; checkedOn: string; discomfort: boolean }>;
  drafts: Array<{ studentId: string; studentName: string; planId: string; revisionId: string; title: string; revisionNumber: number }>;
  invited: Array<{ studentId: string; studentName: string }>;
}

export interface AttentionItem {
  key: string;
  student: string;
  reason: string;
  detail: string;
  cta: string;
  href: string;
  /** Lower comes first. */
  rank: number;
}

const student = (id: string) => `/profissional/alunos/${id}`;

export function attentionQueue(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const row of input.requests)
    items.push({
      key: `request-${row.id}`,
      student: row.studentName,
      reason: row.overdue ? "pedido sobre os dados passou do prazo" : "pedido sobre os dados",
      detail: `${row.kindLabel} · ${row.overdue ? "venceu em" : "prazo"} ${row.dueOn}`,
      cta: "Responder pedido",
      href: `${student(row.studentId)}?aba=acesso#pedidos`,
      rank: row.overdue ? 0 : 4,
    });
  for (const row of input.alerts)
    items.push({
      key: `alert-${row.assessmentId}`,
      student: row.studentName,
      reason: "triagem pede a sua revisão",
      detail: `Avaliação de ${row.assessedOn}: a aprovação de um plano espera a revisão registrada`,
      cta: "Registrar revisão",
      href: `${student(row.studentId)}/avaliacoes/${row.assessmentId}`,
      rank: 1,
    });
  for (const row of input.pain)
    items.push({
      key: `pain-${row.sessionId}`,
      student: row.studentName,
      reason: "relato de dor ou desconforto no treino",
      detail: `Treino ${row.workoutLabel} de ${row.performedOn}`,
      cta: "Ler registro",
      href: `${student(row.studentId)}/execucao/${row.sessionId}`,
      rank: 2,
    });
  for (const row of input.checkins)
    items.push({
      key: `checkin-${row.checkinId}`,
      student: row.studentName,
      reason: row.discomfort ? "check-in com relato de desconforto" : "check-in sem leitura",
      detail: `Check-in de ${row.checkedOn}`,
      cta: "Ler check-in",
      href: `${student(row.studentId)}?aba=evolucao#checkins`,
      rank: row.discomfort ? 3 : 5,
    });
  for (const row of input.drafts)
    items.push({
      key: `draft-${row.revisionId}`,
      student: row.studentName,
      reason: "plano em rascunho",
      detail: `${row.title}, revisão ${row.revisionNumber}: o aluno ainda não vê nada`,
      cta: "Continuar plano",
      href: `${student(row.studentId)}/planos/${row.planId}/${row.revisionId}`,
      rank: 6,
    });
  for (const row of input.invited)
    items.push({
      key: `invite-${row.studentId}`,
      student: row.studentName,
      reason: "convite aguardando aceite",
      detail: "O link foi gerado; o aluno ainda não entrou no portal",
      cta: "Ver situação do acesso",
      href: `${student(row.studentId)}?aba=acesso`,
      rank: 7,
    });
  // Stable within a rank: the repositories already ordered each source (newest, nearest deadline first).
  return items.map((item, index) => ({ item, index })).sort((a, b) => a.item.rank - b.item.rank || a.index - b.index).map(({ item }) => item);
}
