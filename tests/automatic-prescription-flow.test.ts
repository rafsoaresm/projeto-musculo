import { describe, expect, it } from "vitest";
import type { PlanningAvailability } from "@/modules/prescricao/planejador/actions";
import { produceRulesBlueprint } from "@/modules/prescricao/planejador/rules-mode/producer";
import { toStrategyListView, type StrategyListView } from "@/modules/prescricao/planejador/strategy-view";
import type { AcceptanceView } from "@/modules/prescricao/planejador/accept";
import type { GenerationScreen, GenerationSummary } from "@/modules/prescricao/automatica/service";
import {
  acceptanceInput, applyToOtherPhases, assumptionLines, beforeGenerating, contextCards, crumbText, defaultChoice, draftFrom, draftFromAcceptance, draftProblems, footerFor, headingFor,
  isEdited, modePanel, NO_DOSING, parseStep, pillOf, planningBanner, plainAcceptanceInput, proposalResultOf, restoreWorkout, rotationText, setRole, strategyCards, strategyMeta,
  suggestedIntents, toggleItem, usageLine, weekPreview, whyCards, workoutCards, type FooterState,
} from "@/modules/prescricao/automatica/flow-view";
import { xintusBundle } from "./helpers/planning-fixtures";

// The generation flow's view models (design V4 §7, §8.4, sub-stage 4.1): every rule of the screens GEN-01..04 and M-01, with no React, database or network.

const summary: GenerationSummary = {
  phases: 3, weeks: 12, catalogTotal: 40, catalogInferred: 2, catalogPending: 1, assessedOn: "2026-11-04", parq: "CLEAR", findings: 1, preserved: 0,
  level: "Intermediário", goal: "Hipertrofia", daysPerWeek: 4, sessionMinutes: 60,
};
const slots = (labels: string[]) => labels.map((label, n) => ({ label, weekday: [1, 2, 4, 5][n] ?? null }));
const structure: GenerationScreen["structure"] = [1, 2, 3].map((index) => ({
  index, name: null, weeks: 4, sessionsPerWeek: 4, weekSlots: slots(["A", "B", "A", "B"]),
  workouts: [{ label: "A", name: null, target: 5, focusSaved: false }, { label: "B", name: null, target: 5, focusSaved: false }],
}));
const considered: GenerationScreen["considered"] = [{ label: "Histórico de execução", value: "Nenhuma sessão em 90 dias", source: "Histórico" }];
const ready: PlanningAvailability = { state: "READY", message: "", usage: { month: "2026-11", allowance: { mode: "TOTAL", total: 100000 }, used: { input: 1200, output: 800 }, remaining: { total: 98000 } as never } };

async function ruleList(): Promise<StrategyListView> {
  return toStrategyListView(produceRulesBlueprint(await xintusBundle()), "run-1", 3);
}

describe("the step of the flow", () => {
  it("reads ?etapa= and falls back to the first step for anything else", () => {
    expect(parseStep("estrategia")).toBe("estrategia");
    expect(parseStep("focos")).toBe("focos");
    expect(parseStep("previa")).toBe("previa");
    for (const bad of [undefined, null, "", "x", "ESTRATEGIA", "../previa"]) expect(parseStep(bad)).toBe("contexto");
  });
  it("always has three pills: GEN-02 and GEN-03 are step 2 and GEN-04 is step 3 (the wireframe's stepper is corrected)", () => {
    expect(pillOf("contexto")).toBe(0);
    expect(pillOf("estrategia")).toBe(1);
    expect(pillOf("focos")).toBe(1);
    expect(pillOf("previa")).toBe(2);
  });
  it("headings and breadcrumb come from the step and the mode", () => {
    expect(headingFor("contexto", "AI").title).toBe("Montar prescrição");
    expect(headingFor("estrategia", "AI").title).toBe("Escolher estratégia de treino");
    expect(headingFor("focos", "AI").title).toBe("Definir focos por fase");
    const last = headingFor("previa", "AI");
    expect(last).toMatchObject({ title: "Revisar e gerar", crumbTail: "Blueprint" });
    expect(last.sub).toBe("Estrutura proposta pela IA; os cálculos e exercícios ainda serão validados pelo motor.");
    expect(headingFor("previa", "RULES").sub).toMatch(/proposta por regras/);
    expect(crumbText("Xintus", "Hipertrofia", "Rascunho")).toBe("XINTUS / HIPERTROFIA / RASCUNHO");
    expect(crumbText("Xintus", null, "Rascunho")).toBe("XINTUS / RASCUNHO");
  });
});

describe("GEN-01: the four context cards", () => {
  it("say what the records say, as in the frame", () => {
    const [routine, assessment, periodization, history] = contextCards(summary, structure, considered);
    expect(routine).toMatchObject({ title: "Objetivo e rotina", line: "Hipertrofia • experiência Intermediário", meta: "4 treinos/semana · 60 min por sessão" });
    expect(assessment).toMatchObject({ title: "Avaliação física", line: "PAR-Q sem alertas · avaliação registrada em 04/11" });
    expect(assessment.meta).toBe("1 achado da avaliação: contexto, não contraindicação");
    expect(periodization).toMatchObject({ title: "Periodização existente", line: "12 semanas · 3 fases de 4 semanas", meta: "Estrutura A / B · alternância ABAB" });
    expect(history).toMatchObject({ title: "Histórico e limitações", line: "Nenhuma sessão em 90 dias", meta: "Sem dado de execução, não inferir cargas" });
  });
  it("shows 'não informado' for what is missing and never guesses", () => {
    const empty: GenerationSummary = { ...summary, level: null, goal: null, daysPerWeek: null, sessionMinutes: null, assessedOn: null, parq: "NOT_DONE", findings: 0 };
    const [routine, assessment] = contextCards(empty, [], []);
    expect(routine.line).toBe("objetivo não informado • experiência não informado");
    expect(routine.meta).toBe("treinos não informado/semana · duração não informado por sessão");
    expect(assessment.line).toBe("PAR-Q não realizado · nenhuma avaliação registrada");
    expect(assessment.meta).toBe("Nenhum achado registrado na avaliação");
    expect(contextCards(empty, [], [])[2].meta).toBe("Estrutura sem treinos definidos");
  });
  it("a history with sessions does not say 'sem dado de execução'", () => {
    const withHistory = contextCards(summary, structure, [{ label: "Histórico de execução", value: "6 sessões em 90 dias", source: "Histórico" }]);
    expect(withHistory[3].meta).toBe("Cargas só a partir do que foi registrado");
  });
  it("the rotation is the first phase's week as saved (letters joined, else the labels)", () => {
    expect(rotationText(structure)).toBe("ABAB");
    const named = structure.map((p) => ({ ...p, weekSlots: [{ label: "Superior", weekday: 1 }, { label: "Inferior", weekday: 3 }] }));
    expect(rotationText(named)).toBe("Superior · Inferior");
    expect(rotationText([])).toBe("");
  });
});

describe("GEN-01: the mode picker for every state of the AI gate", () => {
  it("ready: AI is the default, both cards are available, the usage line has tokens only", () => {
    const panel = modePanel(ready);
    expect(panel.defaultMode).toBe("AI");
    expect(panel.options.map((o) => [o.id, o.title, o.disabled, o.reason])).toEqual([["AI", "Assistida por IA", false, null], ["RULES", "Por regras", false, null]]);
    expect(panel.options[0]).toMatchObject({ description: "A IA sugere estratégia, divisão e focos; o motor valida.", meta: "1 planejamento por versão" });
    expect(panel.options[1]).toMatchObject({ description: "Mantém o gerador atual e permite definir focos manualmente.", meta: "Sem chamada de IA" });
    expect(panel.usageLine).toBe("Uso de IA neste mês: 2.000 de 100.000 tokens");
    expect(panel.notice).toMatch(/resumo codificado e anonimizado/);
    expect(JSON.stringify(panel)).not.toMatch(/custo|cost|R\$|US\$|provedor:|modelo/i);
  });
  it.each([
    ["IA não configurada."], ["A IA está desligada pela plataforma."], ["IA não habilitada para a sua organização."], ["IA não incluída no plano."], ["Limite do plano atingido neste mês."],
  ])("not available (%s): the AI card stays readable and disabled with the reason, rules is the selection", (message) => {
    const panel = modePanel({ state: "not_configured", message, usage: ready.usage } as unknown as PlanningAvailability);
    expect(panel.defaultMode).toBe("RULES");
    expect(panel.options[0]).toMatchObject({ disabled: true, reason: message, title: "Assistida por IA" });
    expect(panel.options[1].disabled).toBe(false);
    expect(panel.usageLine).toBeNull();
  });
  it("without an answer from the server it is 'IA não configurada.' and rules", () => {
    const panel = modePanel(null);
    expect(panel.defaultMode).toBe("RULES");
    expect(panel.options[0].reason).toBe("IA não configurada.");
  });
  it("the usage line of a split allowance adds both parts, and a plan without allowance has none", () => {
    expect(usageLine({ month: "m", allowance: { mode: "SPLIT", input: 1000, output: 500 }, used: { input: 10, output: 5 }, remaining: null })).toBe("Uso de IA neste mês: 15 de 1.500 tokens");
    expect(usageLine({ month: "m", allowance: null, used: { input: 0, output: 0 }, remaining: null })).toBeNull();
    expect(usageLine(null)).toBeNull();
  });
});

describe("planning failures: the honest banners with the way out", () => {
  const fail = (reason: Parameters<typeof planningBanner>[0]["reason"], message = "msg", canContinueByRules = true) => ({ reason, message, canContinueByRules });
  it("limit: continue by rules", () => {
    expect(planningBanner(fail("limit_reached"), "AI")).toMatchObject({ text: "Limite do plano atingido neste mês. Você pode continuar por regras.", actions: ["rules"], role: "alert" });
  });
  it.each([["timeout", "tempo esgotado"], ["invalid_response", "resposta inválida"], ["provider_failed", "serviço instável"], ["circuit_open", "serviço instável"]] as const)(
    "%s: the failure banner offers retry and rules, says nothing was lost",
    (reason, detail) => {
      const banner = planningBanner(fail(reason), "AI");
      expect(banner.text).toBe("Falha da IA — continuar por regras. Nada foi perdido e nada foi alterado no plano.");
      expect(banner.detail).toBe(detail);
      expect(banner.actions).toEqual(["retry", "rules"]);
    },
  );
  it("a minor student, a privacy block, a planning in progress and a stale revision", () => {
    expect(planningBanner(fail("minor_blocked"), "AI")).toMatchObject({ text: "Para alunos menores de idade a montagem é por regras.", actions: ["rules"] });
    expect(planningBanner(fail("privacy_blocked", "Não foi possível enviar com segurança: o resumo continha um dado de identificação. Nada foi enviado."), "AI")).toMatchObject({
      text: "Não foi possível enviar com segurança: o resumo continha um dado de identificação. Nada foi enviado.", actions: ["rules"],
    });
    expect(planningBanner(fail("in_progress"), "AI")).toMatchObject({ text: "Já existe um planejamento em andamento para este plano.", actions: [], role: "status" });
    for (const r of ["revision_changed", "stale"] as const) expect(planningBanner(fail(r), "AI")).toMatchObject({ text: "A periodização mudou. Planeje de novo para atualizar as estratégias.", actions: ["replan"] });
  });
  it("a gate state keeps the server's message and offers rules only in the AI mode", () => {
    expect(planningBanner(fail("no_plan", "IA não incluída no plano."), "AI")).toMatchObject({ text: "IA não incluída no plano.", actions: ["rules"] });
    expect(planningBanner(fail("no_plan", "IA não incluída no plano."), "RULES").actions).toEqual([]);
    expect(planningBanner(fail("questions", "Faltam respostas obrigatórias para planejar.", false), "RULES").actions).toEqual([]);
  });
});

describe("GEN-02: the strategy cards (rules suggestion for the Xintus structure)", () => {
  it("up to three strategies plus Personalizar and 'Sem divisão (geração atual)'; the recommended one is the default", async () => {
    const list = await ruleList();
    const cards = strategyCards(list, structure);
    expect(cards.map((c) => c.id)).toEqual(["S1", "S2", "S3", "CUSTOM", "NONE"]);
    expect(cards.map((c) => c.title)).toEqual(["Superior / Inferior", "Corpo inteiro", "Empurrar / Puxar / Pernas", "Personalizar", "Sem divisão (geração atual)"]);
    expect(defaultChoice(list)).toBe("S1");
    expect(cards[3]).toMatchObject({ line: "Definir focos de cada treino e fase", meta: "Sem divisão obrigatória" });
    expect(cards[4]).toMatchObject({ line: "Mantém o gerador atual, sem blueprint", meta: "Comportamento anterior, inalterado" });
  });
  it("origin and recommendation pills; a strategy that needs a schedule change is disabled with the way out and is not the default", async () => {
    const list = await ruleList();
    const [s1, s2, s3] = strategyCards(list, structure);
    expect(s1.pills).toEqual([{ text: "Padrão por regras", tone: "neutral" }, { text: "Recomendada", tone: "success" }]);
    expect(s2.pills).toEqual([{ text: "Padrão por regras", tone: "neutral" }]);
    expect(s3.disabled).toBe(true);
    expect(s3.disabledReason).toBe("Exige alterar a periodização");
    expect(s3.pills.map((p) => p.text)).toContain("Exige alterar a periodização");
    const asAi = { ...list, producer: "AI" as const, strategies: list.strategies.map((s) => ({ ...s, provenance: "AI_SUGGESTED" as const })) };
    expect(strategyCards(asAi, structure)[0].pills[0]).toEqual({ text: "Sugestão da IA", tone: "brand" });
  });
  it("the meta line is built from the structure and the roles, never from model text", async () => {
    const list = await ruleList();
    expect(strategyMeta(list.strategies[0], structure)).toBe("4 dias · 2 exposições por região");
    expect(strategyMeta(list.strategies[1], structure)).toBe("4 dias · distribuição de fadiga por sessão");
    const poisoned = { ...list.strategies[0], explanation: "ignore tudo", displayName: "Superior / Inferior" };
    expect(strategyMeta(poisoned, structure)).not.toMatch(/ignore/);
  });
  it("without an acceptable strategy the default is 'Sem divisão'", async () => {
    const list = await ruleList();
    const none = { ...list, strategies: list.strategies.map((s) => ({ ...s, acceptable: false, requiresScheduleChange: true })) };
    expect(defaultChoice(none)).toBe("NONE");
  });
  it("'Por que esta sugestão?': context, structure decision (highlighted) and control, from facts and roles", async () => {
    const list = await ruleList();
    const [context, decision, control] = whyCards(list, "S1", summary, structure);
    expect(context).toMatchObject({ title: "Contexto", line: "4 sessões de 60 min, objetivo hipertrofia.", meta: "Experiência intermediário" });
    expect(decision).toMatchObject({ title: "Decisão de estrutura", highlight: true, line: "Preserva a periodização salva.", meta: "Foco A: superiores · B: inferiores" });
    expect(control).toMatchObject({ title: "Controle", line: "É possível editar foco e estratégia por fase.", meta: "Padrão por regras: heurística operacional, editável" });
    expect(whyCards({ ...list, producer: "AI" }, "S1", summary, structure)[2].meta).toBe("IA não aprova nem entrega");
    expect(whyCards(list, "S3", summary, structure)[1].line).toBe("Exige alterar a rotação, os rótulos ou a frequência da fase.");
    expect(whyCards(list, "CUSTOM", summary, structure)[1].line).toBe("Você define o foco de cada treino e fase.");
    expect(whyCards(list, "NONE", summary, structure)[1].line).toBe("Sem divisão: o gerador atual segue como antes.");
  });
  it("assumptions and questions are plain text lines", async () => {
    const list = await ruleList();
    const lines = assumptionLines(list);
    expect(lines.length).toBe(list.global.assumptions.length + list.global.uncertainties.length + list.global.questionsForProfessional.length);
    for (const l of lines) expect(typeof l).toBe("string");
  });
});

describe("GEN-03: the editable draft of the acceptance", () => {
  it("starts from the strategy: A is upper and B is lower in every phase, nothing is edited, the pills say who decided", async () => {
    const list = await ruleList();
    const draft = draftFrom(list, "S1", structure)!;
    expect(draft.displayName).toBe("Superior / Inferior");
    expect(draft.workouts).toHaveLength(6);
    for (const p of [1, 2, 3]) {
      const cards = workoutCards(draft, p);
      expect(cards.map((c) => c.title)).toEqual(["Treino A · Superiores", "Treino B · Inferiores"]);
      expect(cards.map((c) => c.pill)).toEqual([{ text: "Padrão por regras", tone: "neutral" }, { text: "Padrão por regras", tone: "neutral" }]);
      expect(cards[0].line).toMatch(/Peitoral|Peito/i);
      expect(cards[1].line).toMatch(/Quadríceps/);
    }
    expect(draft.workouts.some(isEdited)).toBe(false);
    expect(draftProblems(draft)).toEqual([]);
  });
  it("editing flips the source to 'Decisão do profissional', lists the edited fields and restoring brings the suggestion back", async () => {
    const list = await ruleList();
    let draft = draftFrom(list, "S1", structure)!;
    draft = toggleItem(draft, 1, "A", "dominantMuscles", "CALVES", true);
    const [a] = workoutCards(draft, 1);
    expect(a.pill).toEqual({ text: "Decisão do profissional", tone: "success" });
    expect(a.edited).toEqual(["músculos dominantes"]);
    expect(workoutCards(draft, 2)[0].pill.text).toBe("Padrão por regras");
    draft = restoreWorkout(draft, 1, "A");
    expect(workoutCards(draft, 1)[0].edited).toEqual([]);
    expect(workoutCards(draft, 1)[0].pill.text).toBe("Padrão por regras");
  });
  it("a new role resets the lists to that role's defaults and counts as edited", async () => {
    const list = await ruleList();
    const draft = setRole(draftFrom(list, "S1", structure)!, 1, "A", "LOWER");
    expect(workoutCards(draft, 1)[0].title).toBe("Treino A · Inferiores");
    expect(draft.workouts.find((w) => w.phaseIndex === 1 && w.label === "A")!.focus.dominantMuscles).toContain("QUADRICEPS");
    expect(workoutCards(draft, 1)[0].edited).toContain("papel");
  });
  it("'Aplicar às outras fases' copies the edit to the same label elsewhere and leaves the rest alone", async () => {
    const list = await ruleList();
    let draft = toggleItem(draftFrom(list, "S1", structure)!, 1, "B", "supportingMuscles", "ABS", false);
    draft = toggleItem(draft, 1, "B", "dominantMuscles", "CALVES", false);
    const next = applyToOtherPhases(draft, 1, "B");
    for (const p of [2, 3]) expect(next.workouts.find((w) => w.phaseIndex === p && w.label === "B")!.focus).toEqual(next.workouts.find((w) => w.phaseIndex === 1 && w.label === "B")!.focus);
    expect(next.workouts.find((w) => w.phaseIndex === 2 && w.label === "A")!.focus).toEqual(draft.workouts.find((w) => w.phaseIndex === 2 && w.label === "A")!.focus);
  });
  it("validation: a volume workout needs a dominant muscle or a target pattern", async () => {
    const list = await ruleList();
    let draft = draftFrom(list, "S1", structure)!;
    const w = draft.workouts.find((x) => x.phaseIndex === 1 && x.label === "A")!;
    for (const m of w.focus.dominantMuscles) draft = toggleItem(draft, 1, "A", "dominantMuscles", m, false);
    for (const m of w.focus.targetPatterns) draft = toggleItem(draft, 1, "A", "targetPatterns", m, false);
    expect(draftProblems(draft)).toEqual(["Fase 1, treino A: escolha ao menos um músculo dominante ou um padrão-alvo."]);
    // a cardio workout is not a volume workout: no muscle is asked for
    expect(draftProblems(setRole(draft, 1, "A", "CARDIO"))).toEqual([]);
  });
  it("a workout whose focus the saved periodization holds is read-only: no edit, pill 'Foco salvo na periodização'", async () => {
    const list = await ruleList();
    const saved = structure.map((p, i) => (i === 0 ? { ...p, workouts: p.workouts.map((w) => (w.label === "A" ? { ...w, focusSaved: true } : w)) } : p));
    let draft = draftFrom(list, "S1", saved)!;
    expect(workoutCards(draft, 1)[0]).toMatchObject({ locked: true, pill: { text: "Foco salvo na periodização", tone: "neutral" } });
    expect(workoutCards(draft, 1)[1].locked).toBe(false);
    const before = JSON.stringify(draft);
    draft = toggleItem(draft, 1, "A", "dominantMuscles", "CALVES", true);
    draft = setRole(draft, 1, "A", "LOWER");
    expect(JSON.stringify(draft)).toBe(before);
    // and it is never sent
    const input = acceptanceInput(toggleItem(draft, 1, "B", "dominantMuscles", "FOREARMS", true), { idempotencyKey: "k".repeat(16), runId: "run-1", baseContentVersion: 3 });
    expect(input.phases!.flatMap((p) => p.workouts.map((w) => `${p.phaseIndex}${w.label}`))).toEqual(["1B"]);
    // 'Aplicar às outras fases' does not overwrite a locked workout either
    const applied = applyToOtherPhases(setRole(draft, 2, "A", "LOWER"), 2, "A");
    expect(applied.workouts.find((w) => w.phaseIndex === 1 && w.label === "A")!.role).toBe("UPPER");
  });
  it("a strategy's workout that comes from the structure (source STRUCTURE) is locked even if the screen does not say so", async () => {
    const list = await ruleList();
    const fromStructure = { ...list, strategies: list.strategies.map((s) => ({ ...s, phases: s.phases.map((p) => ({ ...p, workouts: p.workouts.map((w) => (w.label === "B" ? { ...w, source: "STRUCTURE" as never } : w)) })) })) };
    const draft = draftFrom(fromStructure, "S1", structure)!;
    expect(draft.workouts.filter((w) => w.locked).map((w) => w.label)).toEqual(["B", "B", "B"]);
  });
  it("'Personalizar' starts from the recommended strategy and every workout is the professional's", async () => {
    const list = await ruleList();
    const draft = draftFrom(list, "CUSTOM", structure)!;
    expect(draft).toMatchObject({ custom: true, family: "CUSTOM", displayName: "Personalizada" });
    expect(workoutCards(draft, 1).map((c) => c.pill.text)).toEqual(["Decisão do profissional", "Decisão do profissional"]);
    const input = acceptanceInput(draft, { idempotencyKey: "k".repeat(16), runId: "run-1", baseContentVersion: 3 });
    expect(input.strategyId).toBe("CUSTOM");
    expect(input.phases).toHaveLength(3);
    expect(input.phases![0].workouts.every((w) => w.candidateExerciseIds.length === 0)).toBe(true);
  });
  it("without the role table the draft cannot be built (never guessed)", async () => {
    const list = await ruleList();
    expect(draftFrom({ ...list, roleFocus: null }, "S1", structure)).toBeNull();
  });
});

describe("the acceptance payload", () => {
  const meta = { idempotencyKey: "a".repeat(16), runId: "run-1", baseContentVersion: 3 };
  it("an unedited strategy sends no workout at all and an empty dosing (nothing pre-ticked)", async () => {
    const list = await ruleList();
    const input = acceptanceInput(draftFrom(list, "S1", structure)!, meta);
    expect(input).toEqual({ ...meta, strategyId: "S1", phases: [], dosing: NO_DOSING });
    expect(plainAcceptanceInput("S2", meta)).toEqual({ ...meta, strategyId: "S2", phases: [], dosing: NO_DOSING, baseContentVersion: 3 });
  });
  it("only the edited workouts go, as role + delta against the role table", async () => {
    const list = await ruleList();
    const draft = toggleItem(draftFrom(list, "S1", structure)!, 2, "A", "dominantMuscles", "CALVES", true);
    const input = acceptanceInput(draft, meta);
    expect(input.phases).toHaveLength(1);
    expect(input.phases![0]).toMatchObject({ phaseIndex: 2, workouts: [{ label: "A", role: "UPPER" }] });
    expect(input.phases![0].workouts[0].focusDelta).toEqual(expect.objectContaining({ addDominant: ["CALVES"], removeDominant: [] }));
  });
  it("the dosing is exactly what was ticked", async () => {
    const list = await ruleList();
    const dosing = { byClass: [], progression: [{ phaseIndex: 1, intent: "VOLUME_RAMP" }] };
    expect(acceptanceInput(draftFrom(list, "S1", structure)!, { ...meta, dosing }).dosing).toEqual(dosing);
  });
  it("a refresh at GEN-04 rebuilds the draft from the stored acceptance", async () => {
    const list = await ruleList();
    let draft = toggleItem(draftFrom(list, "S1", structure)!, 1, "A", "dominantMuscles", "CALVES", true);
    const sent = acceptanceInput(draft, meta);
    const acceptance: AcceptanceView = {
      acceptanceId: "acc-1", runId: "run-1", strategyId: "S1", splitFamily: "UPPER_LOWER", familyLabel: "Superior / Inferior", baseContentVersion: 3, acceptedAt: "2026-11-05T10:00:00Z",
      workouts: list.strategies[0].phases.flatMap((p) => p.workouts.map((w) => {
        const edited = sent.phases!.find((x) => x.phaseIndex === p.phaseIndex)?.workouts.find((x) => x.label === w.label);
        return { phaseIndex: p.phaseIndex, label: w.label, role: edited?.role ?? w.role, source: edited ? ("PROFESSIONAL" as const) : w.source as "RULES_HEURISTIC", focusDelta: edited ? edited.focusDelta : w.focusDelta };
      })),
      edits: [], dosing: { byClass: [], progression: [] },
    };
    const restored = draftFromAcceptance(list, acceptance, structure)!;
    expect(restored.workouts.find((w) => w.phaseIndex === 1 && w.label === "A")!.focus).toEqual(draft.workouts.find((w) => w.phaseIndex === 1 && w.label === "A")!.focus);
    expect(workoutCards(restored, 1)[0].pill.text).toBe("Decisão do profissional");
    draft = restored;
    expect(draftProblems(draft)).toEqual([]);
  });
});

describe("GEN-04: the week-type preview", () => {
  it("one card per session of the first week, with weekday, workout and role; repeats say 'Repetição do foco'", async () => {
    const list = await ruleList();
    const draft = draftFrom(list, "S1", structure)!;
    const cards = weekPreview(draft, structure, 1);
    expect(cards.map((c) => c.title)).toEqual(["Segunda · Treino A · Superiores", "Terça · Treino B · Inferiores", "Quinta · Treino A · Superiores", "Sexta · Treino B · Inferiores"]);
    expect(cards[0]).toMatchObject({ highlight: true, meta: "Foco principal: superiores" });
    expect(cards[0].line).toMatch(/empurrar horizontal/i);
    expect(cards[0].line).toMatch(/puxar horizontal/i);
    expect(cards[1].meta).toBe("Foco principal: inferiores");
    expect(cards[2]).toMatchObject({ line: "Repetição do foco A com progressão planejada", meta: "Escolha e dose ainda serão validadas" });
    expect(cards[3]).toMatchObject({ line: "Repetição do foco B com progressão planejada", meta: "Cargas não são inferidas" });
    expect(JSON.stringify(cards)).not.toMatch(/\d+ ?kg|\d+ ?séries|\d+ ?reps/i);
  });
  it("without training days the title reads 'Sessão n'", async () => {
    const list = await ruleList();
    const draft = draftFrom(list, "S1", structure)!;
    const noDays = structure.map((p) => ({ ...p, weekSlots: p.weekSlots.map((s) => ({ ...s, weekday: null })) }));
    expect(weekPreview(draft, noDays, 1).map((c) => c.title.split(" · ")[0])).toEqual(["Sessão 1", "Sessão 2", "Sessão 3", "Sessão 4"]);
    expect(weekPreview(draft, structure, 99)).toEqual([]);
  });
  it("a non-volume role has no strength patterns; a saved-focus workout says the engine follows it", async () => {
    const list = await ruleList();
    const cardio = setRole(draftFrom(list, "S1", structure)!, 1, "A", "CARDIO");
    expect(weekPreview(cardio, structure, 1)[0].line).toBe("Sem padrões de força para este papel");
    const saved = draftFrom(list, "S1", structure.map((p, i) => (i === 0 ? { ...p, workouts: p.workouts.map((w) => ({ ...w, focusSaved: true })) } : p)))!;
    expect(weekPreview(saved, structure, 1)[0].meta).toMatch(/Foco principal|O motor segue/);
  });
  it("'Antes de gerar': data available, points to review as observation (never diagnosis), mandatory validation", () => {
    const [available, review, validation] = beforeGenerating(summary, "academia completa");
    expect(available).toMatchObject({ title: "Dados disponíveis", highlight: true, line: "4 sessões/semana · 60 minutos · academia completa", meta: "Com origem e data" });
    expect(review).toMatchObject({ title: "Pontos a revisar", meta: "Observação, não diagnóstico" });
    expect(review.line).toMatch(/sem excluir exercícios/);
    expect(validation).toMatchObject({ title: "Validação obrigatória", meta: "O motor audita após gerar" });
    expect(beforeGenerating({ ...summary, findings: 0 }, "x")[1].meta).toBe("Sem dado, nada é inferido");
  });
  it("the planner's dose and progression suggestions are offered, none of them is ticked by default", async () => {
    const list = await ruleList();
    const withIntents = { ...list, strategies: list.strategies.map((s) => (s.strategyId === "S1" ? { ...s, progressionIntent: [{ phaseIndex: 1, intent: "VOLUME_RAMP" }], dosingIntent: [{ exerciseClass: "COMPOUND_LOWER", profileCode: "COMPOUND_HEAVY" }] } : s)) };
    expect(suggestedIntents(withIntents, "S1")).toEqual({ byClass: [{ exerciseClass: "COMPOUND_LOWER", profileCode: "COMPOUND_HEAVY" }], progression: [{ phaseIndex: 1, intent: "VOLUME_RAMP" }] });
    expect(suggestedIntents(withIntents, "NONE")).toEqual(NO_DOSING);
    // the draft/acceptance carries nothing until the professional ticks
    expect(acceptanceInput(draftFrom(withIntents, "S1", structure)!, { idempotencyKey: "a".repeat(16), runId: "r", baseContentVersion: 3 }).dosing).toEqual(NO_DOSING);
  });
});

describe("the footer of every step", () => {
  const base: FooterState = { step: "contexto", openAnswers: 0, running: false, mode: "AI", choice: "S1", choiceName: "Superior / Inferior", choiceAcceptable: true, problems: 0, generating: false };
  it("GEN-01: the guide of the frame; the button waits for the required answers and says how many are missing", () => {
    expect(footerFor(base)).toEqual({ guide: "Próximo: escolher estratégia. Nada será aplicado ou entregue sem revisão.", primary: "Continuar para estratégia", disabled: false, reason: null });
    expect(footerFor({ ...base, openAnswers: 4 })).toMatchObject({ disabled: true, reason: "Faltam 4 respostas" });
    expect(footerFor({ ...base, openAnswers: 1 }).reason).toBe("Faltam 1 resposta");
    expect(footerFor({ ...base, running: true })).toMatchObject({ primary: "Gerando estratégia…", disabled: true });
  });
  it("GEN-02: the label follows the choice", () => {
    const f = (over: Partial<FooterState>) => footerFor({ ...base, step: "estrategia", ...over });
    expect(f({}).primary).toBe("Usar superior / inferior");
    expect(f({}).guide).toBe("Escolha uma opção ou personalize. A divisão escolhida é uma decisão do profissional.");
    expect(f({ choice: "CUSTOM" }).primary).toBe("Personalizar focos");
    expect(f({ choice: "NONE" }).primary).toBe("Gerar sem divisão");
    expect(f({ choice: "S3", choiceName: "Empurrar / Puxar / Pernas", choiceAcceptable: false })).toMatchObject({ disabled: true, reason: "Esta opção exige alterar a periodização" });
  });
  it("M-01 (phone): the frame's guide and button", () => {
    const phone = footerFor({ ...base, step: "estrategia", phone: true });
    expect(phone).toMatchObject({ guide: "Nenhuma divisão será aplicada sem aceite.", primary: "Conferir divisão por fase" });
    expect(footerFor({ ...base, step: "estrategia", choice: "NONE", phone: true }).primary).toBe("Gerar sem divisão");
  });
  it("GEN-03 and GEN-04", () => {
    expect(footerFor({ ...base, step: "focos" })).toEqual({ guide: "A IA sugere. A geração só começa depois de aceitar esta organização.", primary: "Conferir blueprint", disabled: false, reason: null });
    expect(footerFor({ ...base, step: "focos", mode: "RULES" }).guide).toBe("O padrão por regras é editável. A geração só começa depois de aceitar esta organização.");
    expect(footerFor({ ...base, step: "focos", problems: 2 })).toMatchObject({ disabled: true, reason: "2 ajustes a corrigir" });
    expect(footerFor({ ...base, step: "previa" })).toEqual({ guide: "Aceitar estratégia → gerar proposta → revisar → aplicar ao rascunho.", primary: "Gerar proposta", disabled: false, reason: null });
    expect(footerFor({ ...base, step: "previa", generating: true })).toMatchObject({ primary: "Gerando…", disabled: true });
    expect(footerFor({ ...base, step: "previa", openAnswers: 2 }).disabled).toBe(true);
  });
  it("no footer ever says approve or deliver", () => {
    for (const step of ["contexto", "estrategia", "focos", "previa"] as const) expect(JSON.stringify(footerFor({ ...base, step }))).not.toMatch(/aprovar|entregar ao aluno/i);
  });
});

describe("the generation outcome of the strategy path, in the shape the screen reads", () => {
  it("success and failure carry the same fields as the plain generation", () => {
    expect(proposalResultOf({ ok: true, proposalId: "p1", version: 2, complete: false, replayed: false, progress: { generated: 1, total: 3 } })).toEqual({
      data: { proposalId: "p1", version: 2, complete: false, replayed: false, progress: { generated: 1, total: 3 } },
    });
    expect(proposalResultOf({ ok: false, reason: "blueprint_invalid", message: "x", contentVersion: 4 })).toEqual({ error: "x", data: { reason: "blueprint_invalid", contentVersion: 4 } });
  });
});
