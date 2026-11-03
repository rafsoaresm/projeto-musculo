import { describe, expect, it } from "vitest";
import { attentionQueue, type AttentionInput } from "@/modules/atendimento/attention";

const empty: AttentionInput = { requests: [], alerts: [], pain: [], checkins: [], drafts: [], invited: [] };

describe("the work queue of the overview (handoff V4 T02)", () => {
  it("is empty when nothing asks for an action: a zero never becomes an item", () => {
    expect(attentionQueue(empty)).toEqual([]);
  });

  it("puts first what has a deadline or a safety reason, then the work in progress, each with where to act", () => {
    const queue = attentionQueue({
      invited: [{ studentId: "s6", studentName: "Fernanda" }],
      drafts: [{ studentId: "s5", studentName: "Marina", planId: "p1", revisionId: "r2", title: "Ciclo 1", revisionNumber: 2 }],
      checkins: [
        { checkinId: "c1", studentId: "s4", studentName: "Pedro", checkedOn: "01/11/2026", discomfort: false },
        { checkinId: "c2", studentId: "s4", studentName: "Pedro", checkedOn: "31/10/2026", discomfort: true },
      ],
      pain: [{ sessionId: "w1", studentId: "s3", studentName: "Lucas", workoutLabel: "A", performedOn: "30/10/2026" }],
      alerts: [{ studentId: "s2", studentName: "Daniela", assessmentId: "a1", assessedOn: "29/10/2026", title: "Avaliação (formato anterior)" }],
      requests: [
        { id: "q1", studentId: "s1", studentName: "Ana", kindLabel: "Cópia dos dados", overdue: false, dueOn: "10/11/2026" },
        { id: "q2", studentId: "s1", studentName: "Ana", kindLabel: "Correção", overdue: true, dueOn: "28/10/2026" },
      ],
    });
    expect(queue.map((item) => `${item.student}: ${item.reason}`)).toEqual([
      "Ana: pedido sobre os dados passou do prazo",
      "Daniela: triagem pede a sua revisão",
      "Lucas: relato de dor ou desconforto no treino",
      "Pedro: check-in com relato de desconforto",
      "Ana: pedido sobre os dados",
      "Pedro: check-in sem leitura",
      "Marina: plano em rascunho",
      "Fernanda: convite aguardando aceite",
    ]);
    expect(queue.find((item) => item.key === "draft-r2")).toMatchObject({ cta: "Continuar plano", href: "/profissional/alunos/s5/planos/p1/r2" });
    expect(queue.find((item) => item.key === "alert-a1")).toMatchObject({ cta: "Registrar revisão", href: "/profissional/alunos/s2/avaliacoes/a1", detail: "Avaliação (formato anterior) de 29/10/2026: a aprovação de um plano espera a revisão registrada" });
    expect(queue.find((item) => item.key === "pain-w1")?.href).toBe("/profissional/alunos/s3/execucao/w1");
    expect(queue.find((item) => item.key === "invite-s6")).toMatchObject({ reason: "convite aguardando aceite", cta: "Ver situação do acesso" });
    expect(new Set(queue.map((item) => item.key)).size).toBe(queue.length);
  });

  it("keeps the order each source already had within the same rank", () => {
    const queue = attentionQueue({ ...empty, drafts: [1, 2, 3].map((n) => ({ studentId: `s${n}`, studentName: `A${n}`, planId: `p${n}`, revisionId: `r${n}`, title: "Plano", revisionNumber: 1 })) });
    expect(queue.map((item) => item.student)).toEqual(["A1", "A2", "A3"]);
  });
});
