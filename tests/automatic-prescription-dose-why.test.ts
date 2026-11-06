/**
 * Motor V4, PR 3.3: o "Por quê?" da dose (`itemWhy`) e os rótulos de origem, lidos só do traço do item.
 * Proposta de antes da política de dose (2026.11.5) não ganha linhas nem motivos inventados.
 */
import { describe, expect, it } from "vitest";
import { generate, type EngineResult, type ItemOut } from "@/modules/prescricao/motor";
import { DOSE_REASON_LABELS, PROVENANCE_LABELS, doseReasonText, itemWhy } from "@/modules/prescricao/automatica/view";
import { parameters } from "./helpers/motor-fixtures";
import { xintusInput } from "./helpers/xintus";

const V6 = { id: "gymgital-base", version: "2026.11.6" } as const;
const V5 = { id: "gymgital-base", version: "2026.11.5" } as const;
const first = (r: EngineResult) => r.occurrences.find((o) => o.phaseIndex === 1 && o.week === 1 && o.slot === 1)!;
const byProfile = (r: EngineResult, profile: string): ItemOut => first(r).items.find((i) => i.trace.params.some((p) => p.profileId === profile))!;
const isolation = (r: EngineResult): ItemOut => r.occurrences.flatMap((o) => o.items).find((i) => i.trace.params.some((p) => p.profileId?.startsWith("HYP_ISOLATION")))!;
const workoutOf = (r: EngineResult) => r.workouts.find((w) => w.phaseIndex === 1 && w.label === "A") ?? null;

describe("itemWhy: dose com perfil (2026.11.6)", () => {
  const r = generate(xintusInput(V6));
  const heavyId = first(r).items.map((i) => i.trace.params.find((p) => p.profileId)?.profileId).find((id) => id === "HYP_COMPOUND_HEAVY");

  it("responde às quatro perguntas com regra, perfil, motivos e 'o que mudaria'", () => {
    expect(heavyId).toBe("HYP_COMPOUND_HEAVY");
    const why = itemWhy(byProfile(r, "HYP_COMPOUND_HEAVY"), workoutOf(r), r.audit ?? null, { rulesUsed: r.rulesUsed, phaseIndex: 1 });
    expect(why.dose.map((l) => l.param)).toEqual(["sets", "reps", "rir", "rest"]);
    const rest = why.dose.find((l) => l.param === "rest")!;
    expect(rest).toMatchObject({ text: "150 s de pausa", profile: "HYP_COMPOUND_HEAVY", basis: "HEURISTIC" });
    expect(rest.question).toBe("Por que 150 s de pausa?");
    expect(rest.reasons).toEqual(expect.arrayContaining(["exercício composto"]));
    expect(rest.changeIf).toMatch(/Muda se|muda|mude|mudar/i);
    expect(rest.rule).toMatch(/dose/i);
    const reps = why.dose.find((l) => l.param === "reps")!;
    expect(reps.text).toBe("6–10 repetições");
    expect(reps.profile).toBe("HYP_COMPOUND_HEAVY");
    const sets = why.dose.find((l) => l.param === "sets")!;
    expect(sets.profile).toBeNull();
    expect(sets.changeIf).toMatch(/progressão|editar/);
  });

  it("um composto e um isolamento da mesma sessão têm linhas diferentes (e mesma classe, mesmas linhas)", () => {
    const heavy = itemWhy(byProfile(r, "HYP_COMPOUND_HEAVY"), null, null);
    const iso = itemWhy(isolation(r), null, null);
    const text = (w: ReturnType<typeof itemWhy>) => w.dose.filter((l) => l.param !== "sets").map((l) => l.text).join("|");
    expect(text(heavy)).not.toBe(text(iso));
    expect(["75 s de pausa", "60 s de pausa"]).toContain(iso.dose.find((l) => l.param === "rest")!.text);
    expect(iso.dose.find((l) => l.param === "rest")!.reasons).toContain("exercício de isolamento");
  });

  it("dose do profissional aparece como decisão dele e sem perfil", () => {
    const inp = xintusInput(V6);
    const edited = generate({ ...inp, parameters: { ...inp.parameters, doseOverrides: [{ stimulus: "HYPERTROPHY", patch: { values: { restSeconds: 100 } } }] } });
    const item = first(edited).items.find((i) => i.dose?.metric === "REPS")!;
    const rest = itemWhy(item, null, null).dose.find((l) => l.param === "rest")!;
    expect(rest).toMatchObject({ text: "100 s de pausa", rule: "Decisão do profissional", basis: "PROFESSIONAL" });
    expect(rest.reasons).toEqual(["ajuste do profissional"]);
  });

  it("metadado ausente: motivo legível, sem número inventado", () => {
    expect(doseReasonText("METADATA_MISSING:compound")).toBe("falta composto ou isolado na biblioteca");
    expect(doseReasonText("PROGRESSION_INTENT:VOLUME_RAMP")).toMatch(/VOLUME_RAMP/);
    expect(doseReasonText("OUTRO_CODIGO")).toBe("OUTRO_CODIGO");
    for (const label of Object.values(DOSE_REASON_LABELS)) expect(label).not.toMatch(/\d+\s*kg/);
  });

  it("achados da auditoria que citam o item entram como linhas; só os dele", () => {
    const item = first(r).items[0];
    const other = first(r).items[1];
    const finding = { code: "AUDIT_DOSE_UNIFORM", sourceRefs: [`item:1:${item.slotKey}`], rationale: "Texto do achado." } as never;
    const why = itemWhy(item, null, { findings: [finding] });
    expect(why.auditLines).toEqual(["Texto do achado."]);
    expect(itemWhy(other, null, { findings: [finding] }).auditLines).toEqual([]);
  });
});

describe("itemWhy: sem a política de dose e a origem", () => {
  it("proposta da 2026.11.5 não ganha linhas de dose nem motivos", () => {
    const old = generate(xintusInput(V5));
    for (const item of first(old).items) expect(itemWhy(item, null, null).dose).toEqual([]);
  });

  it("as etiquetas de origem vêm do item (profissional, regras, dado do aluno) e o foco do treino da estratégia", () => {
    const r = generate(xintusInput(V6, { parameters: parameters({ availableMinutes: 60 }) }));
    const item = first(r).items[0];
    const why = itemWhy(item, null, null);
    expect(why.selectionPills.map((p) => p.facet)).toEqual(expect.arrayContaining(["decidedBy", "selection", "dose"]));
    expect(why.selectionPills.find((p) => p.facet === "selection")!.label).toBe(PROVENANCE_LABELS.RULES_HEURISTIC);
    expect(why.focusLine).toBeNull();
    const locked = itemWhy({ ...item, origin: "LOCKED" }, null, null);
    expect(locked.selectionPills.find((p) => p.facet === "decidedBy")!.label).toBe(PROVENANCE_LABELS.PROFESSIONAL);
    const withFocus = itemWhy(item, { coverage: { origin: "BLUEPRINT_FOCUS", blueprint: { role: "UPPER", source: "AI_SUGGESTED", strategyId: "s", supporting: [], spillover: [], candidates: [] } } as never }, null);
    expect(withFocus.focusLine).toBe("Foco do treino: Superior (Sugestão da IA).");
  });
});

describe("adesão aos perfis de dose na tela de geração", () => {
  it("a caixa vem desmarcada e a versão que ela fixa é a única publicada como adesão", async () => {
    const { EMPTY_FORM, DOSE_PROFILES_RULES_VERSION } = await import("@/modules/prescricao/automatica/view");
    const { OPT_IN_RULESETS, DEFAULT_RULESET } = await import("@/modules/prescricao/motor/rules");
    expect(EMPTY_FORM.doseProfiles).toBe(false);
    expect(OPT_IN_RULESETS.map((r) => r.version)).toEqual([DOSE_PROFILES_RULES_VERSION]);
    expect(DEFAULT_RULESET.version).toBe("2026.11.5");
  });
});
