import { describe, expect, it } from "vitest";
import type { AssessmentSummary } from "@/db/assessments";
import type { PlanRevisionSummary, PlanState, PlanSummary } from "@/db/plans";
import { STUDENT_HASH_TABS, STUDENT_TABS, STUDENT_TAB_LABEL, studentTabFrom, studentTabHref } from "@/modules/alunos/student-tab-names";
import { nextAction, portalLabel, timeline, type SummaryInput } from "@/modules/alunos/student-summary";

const assessment = (over: Partial<AssessmentSummary>): AssessmentSummary => ({
  id: "a1",
  studentId: "s1",
  assessedOn: "2026-10-20",
  kind: "INITIAL",
  state: "RECORDED",
  riskStatus: "CLEAR",
  recordedAt: "2026-10-20T12:00:00.000Z",
  reviewed: false,
  amendsAssessmentId: null,
  amendedById: null,
  results: [],
  formatVersion: 2,
  ...over,
});
const revision = (state: PlanState, over: Partial<PlanRevisionSummary> = {}): PlanRevisionSummary => ({
  id: "r1",
  revisionNumber: 1,
  state,
  startDate: "2026-11-02",
  endDate: "2026-12-27",
  totalWeeks: 8,
  totalSessions: 24,
  updatedAt: "2026-11-01T10:00:00.000Z",
  readyAt: null,
  approvedAt: null,
  deliveredAt: null,
  ...over,
});
const plan = (...revisions: PlanRevisionSummary[]): PlanSummary => ({ id: "p1", title: "Hipertrofia", createdAt: "2026-11-01T10:00:00.000Z", revisions });
const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  studentId: "s1",
  hasProfile: true,
  assessments: [],
  plans: [],
  sessions: [],
  openRequests: 0,
  ...over,
});

describe("the tabs of the student's record", () => {
  it("are the Figma's five, in its order, and Acesso e dados", () => {
    expect(STUDENT_TABS.map((tab) => STUDENT_TAB_LABEL[tab])).toEqual(["Resumo", "Avaliação Física", "Periodização", "Treinos", "Evolução", "Acesso e dados"]);
  });
  it("open the one named, and Resumo for anything else", () => {
    for (const tab of STUDENT_TABS) expect(studentTabFrom(tab)).toBe(tab);
    expect(studentTabFrom(undefined)).toBe("resumo");
    expect(studentTabFrom("ACESSO")).toBe("resumo");
    expect(studentTabFrom("pedidos")).toBe("resumo");
  });
  it("send an old anchor to the tab that holds it, and no tab is named like an anchor", () => {
    for (const [anchor, tab] of Object.entries(STUDENT_HASH_TABS)) {
      expect(STUDENT_TABS).toContain(tab);
      expect(STUDENT_TABS as readonly string[]).not.toContain(anchor);
    }
    expect(studentTabHref("s1", "acesso", "pedidos")).toBe("/profissional/alunos/s1?aba=acesso#pedidos");
  });
});

describe("the timeline of the record", () => {
  it("with nothing but the record, says each step is missing and shows no date", () => {
    const steps = timeline(input());
    expect(steps.map((step) => step.state)).toEqual(["done", "missing", "missing", "missing", "missing"]);
    expect(steps.map((step) => step.text).join(" ")).not.toMatch(/\d/);
  });
  it("never calls an assessment approved: a draft is a draft and a recorded one is registered on its date", () => {
    expect(timeline(input({ assessments: [assessment({ state: "DRAFT", recordedAt: null })] }))[1]).toEqual({ key: "avaliacao", text: "Avaliação física em rascunho", state: "current" });
    const recorded = timeline(input({ assessments: [assessment({})] }))[1]!;
    expect(recorded).toEqual({ key: "avaliacao", text: "Avaliação física registrada em 20/10/2026", state: "done" });
    expect(JSON.stringify(timeline(input({ assessments: [assessment({})] })))).not.toMatch(/aprovad/i);
  });
  it("keeps a screening that asks for review as the current step until it is reviewed", () => {
    expect(timeline(input({ assessments: [assessment({ riskStatus: "REVIEW_REQUIRED" })] }))[1]).toMatchObject({ state: "current", text: expect.stringContaining("triagem pede a sua revisão") });
    expect(timeline(input({ assessments: [assessment({ riskStatus: "REVIEW_REQUIRED", reviewed: true })] }))[1]?.state).toBe("done");
  });
  it("says the newest revision's own state, and the delivery only with its date", () => {
    const ready = timeline(input({ plans: [plan(revision("READY", { revisionNumber: 2 }))] }));
    expect(ready[2]).toEqual({ key: "plano", text: "Hipertrofia, revisão 2: estrutura pronta", state: "current" });
    expect(ready[3]?.state).toBe("missing");
    const delivered = timeline(input({ plans: [plan(revision("DELIVERED", { deliveredAt: "2026-11-01T15:00:00.000Z" }))] }));
    expect(delivered[2]?.state).toBe("done");
    expect(delivered[3]).toEqual({ key: "entrega", text: "Plano entregue em 01/11/2026", state: "done" });
  });
  it("keeps the last delivery when a newer revision is being made", () => {
    const steps = timeline(input({ plans: [plan(revision("DRAFT", { id: "r2", revisionNumber: 2 }), revision("DELIVERED", { deliveredAt: "2026-10-30T15:00:00.000Z" }))] }));
    expect(steps[2]?.state).toBe("current");
    expect(steps[3]?.text).toBe("Plano entregue em 30/10/2026");
  });
  it("dates the follow-up by the student's last recorded workout", () => {
    expect(timeline(input({ sessions: [{ performedOn: "2026-11-01" }, { performedOn: "2026-10-29" }] }))[4]).toEqual({ key: "acompanhamento", text: "Último treino registrado em 01/11/2026", state: "done" });
  });
});

describe("the next action of the record", () => {
  it("is none when nothing is pending, and never asks for an assessment first", () => {
    expect(nextAction(input())).toBeNull();
    expect(nextAction(input({ plans: [plan(revision("DELIVERED"))] }))).toBeNull();
  });
  it("puts a request about the data first, at the tab that answers it", () => {
    expect(nextAction(input({ openRequests: 2, plans: [plan(revision("DRAFT"))] }))).toEqual({ text: "responder os pedidos sobre os dados", href: "/profissional/alunos/s1?aba=acesso#pedidos" });
    expect(nextAction(input({ openRequests: 1 }))?.text).toBe("responder o pedido sobre os dados");
  });
  it("then a screening waiting for review, before any plan", () => {
    expect(nextAction(input({ assessments: [assessment({ riskStatus: "REVIEW_REQUIRED" })], plans: [plan(revision("DRAFT"))] }))).toEqual({ text: "registrar a revisão da triagem", href: "/profissional/alunos/s1/avaliacoes/a1" });
  });
  it("then a revision still being made, and an approved one is delivered (approving is not delivering)", () => {
    for (const state of ["DRAFT", "REVIEW_REQUIRED", "READY"] as const)
      expect(nextAction(input({ plans: [plan(revision(state))] }))).toEqual({ text: "revisar plano", href: "/profissional/alunos/s1/planos/p1/r1" });
    expect(nextAction(input({ plans: [plan(revision("APPROVED"))] }))?.text).toBe("entregar o plano aprovado");
  });
  it("then an assessment draft, then the file", () => {
    expect(nextAction(input({ assessments: [assessment({ id: "d1", state: "DRAFT" })] }))).toEqual({ text: "continuar a avaliação física", href: "/profissional/alunos/s1/avaliacoes/d1" });
    expect(nextAction(input({ hasProfile: false }))).toEqual({ text: "preencher a ficha", href: "/profissional/alunos/s1/ficha" });
  });
});

describe("the portal line", () => {
  it("does not take an invitation for an active portal", () => {
    expect(portalLabel("ACTIVE")).toBe("Portal ativo");
    expect(portalLabel("INVITED")).toBe("Convite gerado, aguardando aceite");
    expect(portalLabel("NONE")).toBe("Sem acesso ao portal");
  });
});
