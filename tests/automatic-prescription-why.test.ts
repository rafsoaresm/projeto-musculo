/**
 * Motor V4, PR 4.2: a revisão por foco e doses (RX-01, M-02) como modelos de visão puros: o foco do treino, o chip "Foco respeitado" lido da
 * auditoria gravada, o título da linha por padrão de movimento, os três cartões de "Por que foi selecionado?" com as pílulas de origem, a seção
 * "Estratégia" da auditoria, os estados da geração e a confirmação antes de refazer a estratégia. Sem banco, sem rede, sem IA.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RULESET, getRuleSet, type BlueprintRole, type BlueprintSource, type CoverageTargets, type EngineResult, type ItemOut } from "@/modules/prescricao/motor";
import { expandFocus } from "@/modules/prescricao/planejador/focus";
import { roleFocusTableOf } from "@/modules/prescricao/automatica/build-input";
import { itemWhy } from "@/modules/prescricao/automatica/view";
import { footerFor } from "@/modules/prescricao/automatica/flow-view";
import {
  generationStages,
  hasStrategy,
  parseReplanScope,
  phoneReviewCards,
  replanConfirmText,
  replanHref,
  replanScopeKey,
  reviewFooter,
  reviewHeading,
  reviewStage,
  rowPatternLabel,
  rowTitle,
  sessionFocusChip,
  sessionTitle,
  strategyAuditView,
  weeklyAuditLines,
  whyCards,
  workoutFocus,
  type WhyContext,
} from "@/modules/prescricao/automatica/review-view";
import { baseInput, structure, type PhaseSeed } from "./helpers/motor-fixtures";
import { XINTUS_CATALOG, repsDose, resultFrom } from "./helpers/xintus";

const RULES = getRuleSet(DEFAULT_RULESET)!;
const TABLE = roleFocusTableOf(RULES.rules.BLUEPRINT_ROLE_FOCUS!.value);
const ADHERENCE_MIN = RULES.rules.AUDIT_STRATEGY!.value.adherenceMin;

function coverage(role: BlueprintRole, source: BlueprintSource = "RULES_HEURISTIC", candidates: string[] = []): CoverageTargets {
  const f = expandFocus(role, null, TABLE);
  return {
    muscles: f.dominantMuscles, patterns: f.targetPatterns, basis: source === "PROFESSIONAL" ? "PROFESSIONAL" : "HEURISTIC_ACCEPTED", ruleId: "MICROCYCLE_BLUEPRINT",
    origin: "BLUEPRINT_FOCUS", blueprint: { role, source, strategyId: "S1", supporting: f.supportingMuscles, spillover: f.allowedSpilloverPatterns, candidates },
  };
}
const phase = (over: Partial<PhaseSeed> = {}): PhaseSeed => ({ weeks: 2, sessionsPerWeek: 2, stimulus: "HYPERTROPHY", workouts: [{ label: "A" }, { label: "B" }], rotation: ["A", "B"], ...over });

/** A: superior (supino e rosca no foco, afundo e goblet fora); B: inferior (tudo no foco). */
function plan(source: BlueprintSource = "RULES_HEURISTIC", aItems = ["ex-bench", "ex-curl", "ex-plank", "ex-lunge", "ex-goblet"]) {
  const input = baseInput({ catalog: XINTUS_CATALOG, structure: structure("2026-11-09", [phase()]) });
  const lists: Record<string, string[]> = { A: aItems, B: ["ex-squat", "ex-rdl", "ex-legcurl", "ex-legpress"] };
  const result = resultFrom(
    input,
    (o) => (lists[o.label] ?? []).map((id) => ({ exerciseId: id, dose: id === "ex-plank" ? null : repsDose(3) })),
    (_p, label) => (label === "A" ? coverage("UPPER", source) : label === "B" ? coverage("LOWER", source) : null),
  );
  return { input, result };
}
const sessionOf = (r: EngineResult, label: string, week = 1) => r.occurrences.find((o) => o.label === label && o.week === week)!;
const workoutOfLabel = (r: EngineResult, label: string) => r.workouts.find((w) => w.label === label) ?? null;

describe("o foco do treino na revisão", () => {
  const { result } = plan();
  it("proposta com estratégia: papel, origem e músculos vêm do resumo gravado", () => {
    expect(hasStrategy(result.workouts)).toBe(true);
    const a = workoutFocus(workoutOfLabel(result, "A"))!;
    expect(a).toMatchObject({ role: "UPPER", roleLabel: "Superior", originLabel: "Padrão por regras (editável)", strategyId: "S1" });
    expect(a.dominant).toContain("Peitoral");
    expect(workoutFocus(workoutOfLabel(result, "B"))!.roleLabel).toBe("Inferior");
    expect(sessionTitle("A", workoutOfLabel(result, "A"))).toBe("Treino A · Superior");
  });
  it("proposta sem estratégia: nenhum foco inventado; o título mantém só a letra (ou o nome do treino)", () => {
    const legacy = resultFrom(baseInput({ catalog: XINTUS_CATALOG, structure: structure("2026-11-09", [phase()]) }), () => [{ exerciseId: "ex-bench", dose: repsDose(3) }]);
    expect(hasStrategy(legacy.workouts)).toBe(false);
    expect(workoutFocus(workoutOfLabel(legacy, "A"))).toBeNull();
    expect(sessionTitle("A", { coverage: null, name: null })).toBe("Treino A");
    expect(sessionTitle("A", { coverage: null, name: "Peito" })).toBe("Treino A · Peito");
  });
});

describe("chip 'Foco respeitado' / 'Fora do foco: N' (lido da auditoria gravada)", () => {
  const { result } = plan();
  const strategy = result.audit!.strategy!;
  it("treino B (tudo no foco) é respeitado; treino A tem itens fora do foco e cai abaixo do mínimo", () => {
    const b = sessionFocusChip(strategy, 1, "B", 1, ADHERENCE_MIN)!;
    expect(b).toMatchObject({ kind: "RESPECTED", text: "Foco respeitado", offFocus: 0 });
    const a = sessionFocusChip(strategy, 1, "A", 1, ADHERENCE_MIN)!;
    expect(a.kind).toBe("OFF_FOCUS");
    expect(a.text).toBe(`Fora do foco: ${a.offFocus}`);
    expect(a.offFocus).toBeGreaterThan(0);
  });
  it("sem linha de auditoria para a semana (ou sem estratégia) não há chip: nada é deduzido dos itens", () => {
    expect(sessionFocusChip(strategy, 1, "A", 9, ADHERENCE_MIN)).toBeNull();
    expect(sessionFocusChip(strategy, 2, "A", 1, ADHERENCE_MIN)).toBeNull();
    expect(sessionFocusChip(undefined, 1, "A", 1, ADHERENCE_MIN)).toBeNull();
  });
  it("sem mínimo conhecido, só 'nada fora do foco' conta como respeitado", () => {
    expect(sessionFocusChip(strategy, 1, "B", 1, null)!.kind).toBe("RESPECTED");
    expect(sessionFocusChip(strategy, 1, "A", 1, null)!.kind).toBe("OFF_FOCUS");
  });
});

describe("título da linha: padrão de movimento • exercício", () => {
  it("prefere o padrão que o foco do treino mira; sem padrões na biblioteca, só o nome", () => {
    expect(rowPatternLabel(["ELBOW_FLEXION", "HORIZONTAL_PUSH"], ["HORIZONTAL_PUSH"])).toBe("Empurrar horizontal");
    expect(rowPatternLabel(["SQUAT"], ["HORIZONTAL_PUSH"])).toBe("Agachar");
    expect(rowPatternLabel([], ["HORIZONTAL_PUSH"])).toBeNull();
    expect(rowPatternLabel(undefined, [])).toBeNull();
    expect(rowTitle(1, "Supino reto", "Empurrar horizontal")).toBe("1. Empurrar horizontal • Supino reto");
    expect(rowTitle(2, "Remada", null)).toBe("2. Remada");
  });
});

describe("'Por que foi selecionado?': três cartões e as pílulas de origem", () => {
  const { result } = plan();
  const ctxFor = (item: ItemOut, label = "A", week = 1, over: Partial<WhyContext> = {}): WhyContext => {
    const workout = workoutOfLabel(result, label);
    return {
      why: itemWhy(item, workout, result.audit ?? null, { rulesUsed: result.rulesUsed, phaseIndex: 1 }),
      workout,
      session: { phaseIndex: 1, week, slot: sessionOf(result, label, week).slot, label },
      weekSlots: result.occurrences.filter((o) => o.label === label && o.week === week).map((o) => o.slot),
      sessionsPerWeek: 2,
      volume: result.volume,
      strategy: result.audit?.strategy,
      adherenceMin: ADHERENCE_MIN,
      ...over,
    };
  };
  const bench = sessionOf(result, "A").items.find((i) => i.exerciseId === "ex-bench")!;

  it("os cartões vêm na ordem do Figma: foco dominante (destacado), parâmetros da dose, auditoria semanal", () => {
    const cards = whyCards(ctxFor(bench));
    expect(cards.map((c) => c.id)).toEqual(["focus", "dose", "audit"]);
    expect(cards.map((c) => c.title)).toEqual(["Foco dominante", "Parâmetros da dose", "Auditoria semanal"]);
    expect(cards.map((c) => c.highlighted)).toEqual([true, false, false]);
    expect(cards[0].lead).toContain("Treino A: superior");
    expect(cards[0].meta).toBe("Blueprint aceito");
    expect(cards[0].lines.map((l) => l.text).join(" ")).toContain("Músculos dominantes");
    expect(cards[1].lead).toBe("Doses específicas e progressão por semana; não aplicar um padrão único.");
    expect(cards[2].meta).toBe("Avisos não substituem revisão");
  });

  it("pílulas: foco por regras e ranking por regras; 'Sugestão da IA' só no foco e só no exercício que a IA nomeou", () => {
    const rules = whyCards(ctxFor(bench));
    expect(rules[0].pills.map((p) => [p.facet, p.label, p.tone])).toEqual([["decidedBy", "Padrão por regras (editável)", "neutral"], ["focus", "Padrão por regras (editável)", "neutral"]]);
    const ai = plan("AI_SUGGESTED").result;
    const aiBench = sessionOf(ai, "A").items.find((i) => i.exerciseId === "ex-bench")!;
    const aiCtx = ctxFor(aiBench, "A", 1, { workout: workoutOfLabel(ai, "A"), why: itemWhy(aiBench, workoutOfLabel(ai, "A"), ai.audit ?? null, { phaseIndex: 1 }) });
    const aiCards = whyCards(aiCtx);
    expect(aiCards[0].pills.find((p) => p.facet === "focus")).toMatchObject({ label: "Sugestão da IA", tone: "brand" });
    // o motor escolheu o exercício (a IA não o nomeou): quem decidiu é a regra
    expect(aiCards[0].pills.find((p) => p.facet === "decidedBy")!.label).toBe("Padrão por regras (editável)");
  });

  it("exercício trocado pelo profissional: 'Decisão do profissional' (sucesso), sem atribuir à IA", () => {
    const swapped: ItemOut = { ...bench, origin: "SUBSTITUTED" };
    const cards = whyCards(ctxFor(swapped));
    expect(cards[0].pills.find((p) => p.facet === "decidedBy")).toMatchObject({ label: "Decisão do profissional", tone: "success" });
  });

  it("proposta anterior à política de doses: o cartão diz isso e não inventa justificativa", () => {
    const dose = whyCards(ctxFor(bench))[1];
    expect(dose.meta).toBe("Sem política de doses");
    expect(dose.lines.map((l) => l.text)).toEqual(["Esta proposta foi gerada antes da política de doses: não há justificativa por parâmetro para exibir."]);
    expect(dose.lines.every((l) => l.param === undefined)).toBe(true);
  });

  it("dose com perfil: uma linha por parâmetro (séries, repetições, RIR, pausa), com regra, perfil e 'Muda se'", async () => {
    const { generate } = await import("@/modules/prescricao/motor");
    const { xintusInput } = await import("./helpers/xintus");
    const v6 = generate(xintusInput({ id: "gymgital-base", version: "2026.11.6" }));
    const item = v6.occurrences[0].items.find((i) => i.trace.params.some((p) => p.profileId))!;
    const cards = whyCards({
      why: itemWhy(item, null, v6.audit ?? null, { rulesUsed: v6.rulesUsed, phaseIndex: 1 }), workout: null,
      session: { phaseIndex: 1, week: 1, slot: 1, label: "A" }, weekSlots: [1], sessionsPerWeek: 4, volume: v6.volume, strategy: undefined, adherenceMin: null,
    });
    const dose = cards[1];
    expect(dose.meta).toBe("Política versionada");
    expect(dose.lines.map((l) => l.param)).toEqual(["sets", "reps", "rir", "rest"]);
    expect(dose.lines.find((l) => l.param === "rest")!.text).toMatch(/Regra: Perfis de dose · perfil HYP_.*Motivos: .*Muda se/);
    // sem estratégia: o cartão de foco diz que não há blueprint
    expect(cards[0]).toMatchObject({ meta: "Sem blueprint" });
    expect(cards[0].lead).toBe("Treino A: sem estratégia aceita; o foco vem das regras da fase.");
  });

  it("auditoria semanal: calendário, aderência ao foco e volume só dos músculos do foco, sem meta", () => {
    const lines = weeklyAuditLines(ctxFor(bench));
    expect(lines[0]).toBe("Calendário: o treino A acontece 1 vez na semana 1 (sessão 1) entre 2 sessões por semana.");
    expect(lines.find((l) => l.startsWith("Foco:"))).toMatch(/^Foco: \d+ de 5 exercícios estão no foco, no apoio ou no transbordo \(\d+%; mínimo 70%, heurística operacional\)\.$/);
    const volume = lines.find((l) => l.startsWith("Volume da semana 1"))!;
    expect(volume).toContain("Peitoral");
    expect(volume).not.toContain("Quadríceps");
    expect(volume).toMatch(/não meta\.$/);
  });

  it("o calendário lista as sessões do treino: 'sessão 1' ou 'sessões 1 e 3'", () => {
    const four = weeklyAuditLines(ctxFor(bench, "A", 1, { weekSlots: [3, 1], sessionsPerWeek: 4 }))[0];
    expect(four).toBe("Calendário: o treino A acontece 2 vezes na semana 1 (sessões 1 e 3) entre 4 sessões por semana.");
    expect(weeklyAuditLines(ctxFor(bench, "A", 1, { weekSlots: [1, 3, 4], sessionsPerWeek: 4 }))[0]).toContain("(sessões 1, 3 e 4)");
  });

  it("sem estratégia na auditoria não há linha de aderência (nenhuma leitura inventada)", () => {
    const lines = weeklyAuditLines(ctxFor(bench, "A", 1, { strategy: undefined }));
    expect(lines.some((l) => l.startsWith("Foco:"))).toBe(false);
  });
});

describe("seção 'Estratégia' da auditoria", () => {
  const { result } = plan();
  it("uma linha por semana de cada treino da fase, com 'Foco respeitado' ou '! Fora do foco' como dado", () => {
    const view = strategyAuditView(result.audit!, 1, ADHERENCE_MIN)!;
    expect(view.workouts.map((w) => [w.label, w.roleLabel])).toEqual([["A", "Superior"], ["B", "Inferior"]]);
    const b = view.workouts[1];
    expect(b.weeks.map((w) => [w.week, w.items, w.offFocus, w.share, w.respected])).toEqual([[1, 4, 0, "100%", true], [2, 4, 0, "100%", true]]);
    expect(view.workouts[0].weeks[0].respected).toBe(false);
    expect(view.summary).toBe("Estratégia aceita · origem do foco: Padrão por regras (editável)");
    expect(view.note).toBe("Diagnóstico, não objetivo: a sobreposição entre treinos descreve a proposta e não é meta.");
  });
  it("fase sem treinos de estratégia fica vazia e proposta sem a seção devolve null", () => {
    expect(strategyAuditView(result.audit!, 7, ADHERENCE_MIN)!.workouts).toEqual([]);
    expect(strategyAuditView({}, 1, ADHERENCE_MIN)).toBeNull();
    expect(strategyAuditView(null, 1, ADHERENCE_MIN)).toBeNull();
  });
  it("exposições e sobreposição são texto de diagnóstico", () => {
    const view = strategyAuditView(result.audit!, 1, ADHERENCE_MIN)!;
    for (const t of view.exposures) expect(t).toMatch(/sessão|sessões/);
    for (const t of view.overlaps) expect(t).toMatch(/compartilham \d+% dos músculos principais/);
  });
});

describe("títulos, estados e rodapé", () => {
  it("o título e o subtítulo mudam só quando há estratégia; no celular é 'Revisar estratégia e treino'", () => {
    const ctx = { student: "Aluno Xintus", strategyName: "Superior / Inferior", weeks: 12 };
    expect(reviewHeading(true, ctx)).toMatchObject({
      title: "Revisar prescrição e justificativas", sub: "Proposta por foco e doses; valores exigem revisão técnica.",
      phoneTitle: "Revisar estratégia e treino", phoneSub: "Aluno Xintus · Superior / Inferior · 12 semanas",
    });
    expect(reviewHeading(false, ctx)).toMatchObject({ title: "Prescrição automática", sub: "Proposta gerada para revisão profissional. Nenhuma alteração foi aplicada ao aluno." });
    expect(reviewHeading(true, { ...ctx, strategyName: null }).phoneSub).toBe("Aluno Xintus · 12 semanas");
  });
  it("os quatro estados: gerando estratégia, montando prescrição, auditoria, pronta para revisão", () => {
    expect(generationStages(null).map((s) => s.state)).toEqual(["todo", "todo", "todo", "todo"]);
    expect(generationStages("BUILDING").map((s) => `${s.label}:${s.state}`)).toEqual(["Gerando estratégia:done", "Montando prescrição:current", "Auditoria:todo", "Pronta para revisão:todo"]);
    expect(generationStages("READY").map((s) => s.state)).toEqual(["done", "done", "done", "current"]);
    expect(reviewStage({ complete: false, audited: true })).toMatchObject({ id: "BUILDING", label: "Montando prescrição", tone: "warning" });
    expect(reviewStage({ complete: true, audited: false })).toMatchObject({ id: "AUDIT", label: "Auditoria" });
    expect(reviewStage({ complete: true, audited: true })).toMatchObject({ id: "READY", label: "Pronta para revisão", tone: "brand", note: null });
  });
  it("rodapé: o guia é o do Figma, o primário é um só e 'Rever estratégia' só existe com estratégia", () => {
    expect(reviewFooter({ strategy: true, phone: false })).toEqual({ guide: "Proposta editável; não aprova nem altera treinos entregues.", primary: "Aplicar ao rascunho", secondary: "Rever estratégia" });
    expect(reviewFooter({ strategy: true, phone: true }).guide).toBe("Não aplica, não aprova e não entrega sozinho.");
    expect(reviewFooter({ strategy: false, phone: false }).secondary).toBeNull();
  });
  it("cartões do celular (M-02): foco respeitado e doses; 'individualizadas' só com perfil no traço", () => {
    const { result } = plan();
    const chip = sessionFocusChip(result.audit!.strategy, 1, "B", 1, ADHERENCE_MIN);
    const cards = phoneReviewCards({ workout: workoutOfLabel(result, "B"), chip, sessionsInWeek: 2, profileDoses: false, audited: false, durationText: null });
    expect(cards.map((c) => c.title)).toEqual(["Foco respeitado", "Doses a revisar"]);
    expect(cards[0]).toMatchObject({ meta: "Origem: estratégia aceita", highlighted: true });
    expect(cards[0].line).toMatch(/· 2 vezes na semana$/);
    expect(cards[1]).toMatchObject({ line: "Doses do padrão do estímulo; sem perfil individual", meta: "Auditoria de duração pendente" });
    expect(phoneReviewCards({ workout: workoutOfLabel(result, "B"), chip, sessionsInWeek: 1, profileDoses: true, audited: true, durationText: "52 min" })[1]).toMatchObject({
      line: "Repetições, RIR e pausas individualizadas", meta: "Duração estimada: 52 min",
    });
    expect(phoneReviewCards({ workout: null, chip: null, sessionsInWeek: 1, profileDoses: false, audited: true, durationText: null })).toEqual([]);
  });
});

describe("'Rever estratégia': escopo, confirmação destrutiva e endereço", () => {
  it("o escopo do endereço só aceita valores conhecidos (um texto qualquer nunca chega ao servidor)", () => {
    expect(parseReplanScope("FULL")).toEqual({ kind: "FULL" });
    expect(parseReplanScope("PHASE:2")).toEqual({ kind: "PHASE", phaseIndex: 2 });
    expect(parseReplanScope("FROM:3")).toEqual({ kind: "FROM_PHASE", phaseIndex: 3 });
    for (const bad of ["", "PHASE:0", "PHASE:13", "FROM:x", "full", "PHASE:2;DROP", undefined]) expect(parseReplanScope(bad)).toBeNull();
    for (const key of ["FULL", "PHASE:2", "FROM:3"]) expect(replanScopeKey(parseReplanScope(key)!)).toBe(key);
  });
  it("a confirmação diz o que é substituído e o que é mantido, com singular e plural", () => {
    const a = replanConfirmText({ kind: "FROM_PHASE", phaseIndex: 2 }, { replaced: 18, locked: 2, substituted: 1, preserved: 0, phases: [2, 3] });
    expect(a.body).toBe("Refazer a partir da fase 2 substitui 18 exercícios propostos pela ferramenta. Serão mantidos: 2 travados, 1 trocado por você, 0 que já estavam no rascunho.");
    const b = replanConfirmText({ kind: "PHASE", phaseIndex: 1 }, { replaced: 1, locked: 1, substituted: 2, preserved: 1, phases: [1] });
    expect(b.body).toBe("Refazer a fase 1 substitui 1 exercício proposto pela ferramenta. Serão mantidos: 1 travado, 2 trocados por você, 1 que já estava no rascunho.");
    const c = replanConfirmText({ kind: "FULL" }, { replaced: 0, locked: 0, substituted: 0, preserved: 0, phases: [1] });
    expect(c.body).toMatch(/^Refazer todas as fases geradas não substitui nenhum exercício proposto pela ferramenta\./);
  });
  it("o endereço do passo de estratégia mantém o escopo e a etapa", () => {
    expect(replanHref("/profissional/alunos/a/planos/p/r/automatica", { kind: "PHASE", phaseIndex: 2 })).toBe("/profissional/alunos/a/planos/p/r/automatica?rever=PHASE%3A2&etapa=estrategia");
  });
});

describe("rodapé do fluxo em 'Rever estratégia'", () => {
  const base = { step: "previa" as const, openAnswers: 3, running: false, mode: "RULES" as const, choice: "S1" as const, choiceName: "Superior / Inferior", choiceAcceptable: true, problems: 0, generating: false, phone: false };
  it("o último passo refaz o escopo (sem exigir as respostas da geração) e diz o que é mantido", () => {
    const f = footerFor({ ...base, replan: { scopeText: "a partir da fase 2", noDivision: false } });
    expect(f).toMatchObject({ primary: "Refazer com a estratégia", disabled: false, reason: null });
    expect(f.guide).toBe("Refazer a partir da fase 2 com a estratégia aceita. Travados, trocados por você e linhas do rascunho são mantidos.");
    expect(footerFor({ ...base, generating: true, replan: { scopeText: "a fase 1", noDivision: false } })).toMatchObject({ primary: "Refazendo…", disabled: true });
  });
  it("'Sem divisão' não refaz nada: o botão fica desligado com o motivo", () => {
    expect(footerFor({ ...base, step: "estrategia", choice: "NONE", choiceAcceptable: false, replan: { scopeText: "a fase 1", noDivision: true } })).toMatchObject({ primary: "Escolha uma estratégia", disabled: true });
    expect(footerFor({ ...base, replan: { scopeText: "a fase 1", noDivision: true } })).toMatchObject({ disabled: true, reason: "Sem divisão não refaz a proposta" });
  });
  it("sem o modo, o rodapé é o de sempre (gerar proposta)", () => {
    expect(footerFor({ ...base, openAnswers: 0 })).toMatchObject({ primary: "Gerar proposta", disabled: false });
  });
});
