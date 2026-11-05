import { describe, expect, it } from "vitest";
import { DEFAULT_RULESET, getRuleSet } from "@/modules/prescricao/motor/rules";
import type { GenerationQuestion } from "@/modules/prescricao/automatica/contracts";
import type { GenerationSummary } from "@/modules/prescricao/automatica/service";
import {
  EMPTY_FORM,
  answersFromForm,
  openRequired,
  policyOverrides,
  policyRows,
} from "@/modules/prescricao/automatica/view";
import {
  baseCells,
  commitDraft,
  doseSummary,
  draftDirty,
  draftFor,
  equipmentStatus,
  equipmentSummary,
  formFieldErrors,
  missingFactsText,
  paramField,
  pendingItems,
  pendingSummary,
  pendingSummaryShort,
  phaseSpans,
  policySubtitle,
  policyTabs,
  policyTitle,
  restoreRow,
  rowEdited,
  studentCard,
  toggleEquipment,
  validateDraft,
  weeksText,
  workoutsShort,
  workoutsText,
} from "@/modules/prescricao/automatica/generation-view";

// Figma GEN-01..08: what the compact screens show is computed from the screen's data and the rule set's own policy, never typed in.
const rows = policyRows(getRuleSet(DEFAULT_RULESET)!);
const row = (stimulus: string, modality: string, metric: string) => rows.find((r) => r.stimulus === stimulus && r.modality === modality && r.metric === metric)!;
const summary: GenerationSummary = {
  phases: 3,
  weeks: 12,
  catalogTotal: 64,
  catalogInferred: 52,
  catalogPending: 0,
  assessedOn: "2026-10-25",
  parq: "NOT_DONE",
  findings: 4,
  preserved: 4,
  level: null,
  goal: "Hipertrofia",
  daysPerWeek: null,
  sessionMinutes: null,
};
const q = (code: GenerationQuestion["code"], extra: Partial<GenerationQuestion> = {}): GenerationQuestion => ({ code, required: true, where: "FORM" as never, message: `${code}`, ...extra });

describe("the compact summary", () => {
  it("states the five cells from the screen's own numbers, and what is unknown as unknown", () => {
    expect(baseCells(summary)).toEqual([
      { value: "3 fases · 12 semanas", label: "Periodização" },
      { value: "64 exercícios", label: "Biblioteca (52 inferidos)" },
      { value: "25/10/2026", label: "Última avaliação" },
      { value: "Triagem não feita", tone: "warning", label: "PAR-Q" },
      { value: "4 preservados", label: "Rascunho atual" },
    ]);
    const other = baseCells({ ...summary, phases: 1, weeks: 4, catalogTotal: 1, catalogInferred: 0, assessedOn: null, parq: "CLEAR", preserved: 0 });
    expect(other.map((c) => c.value)).toEqual(["1 fase · 4 semanas", "1 exercício", "Nenhuma", "Triagem sem “Sim”", "Nenhum preservado"]);
    expect(other[1].label).toBe("Biblioteca");
  });

  it("says which of the four facts the records lack, without filling any", () => {
    const card = studentCard(summary);
    expect(card.status).toBe("PARCIAL");
    expect(card.missing).toEqual(["Nível", "Dias/semana", "Tempo/sessão"]);
    expect(card.parq).toEqual({ text: "Triagem PAR-Q: não realizada", warning: true });
    expect(card.findings).toBe("4 achados da avaliação: contexto, não contraindicação.");
    expect(missingFactsText(summary)).toBe("Nível, dias por semana e tempo de sessão. Não serão preenchidos automaticamente.");
    expect(studentCard({ ...summary, level: "Iniciante", daysPerWeek: 3, sessionMinutes: 60 }).status).toBe("COMPLETO");
    expect(missingFactsText({ ...summary, level: "Iniciante", daysPerWeek: 3, sessionMinutes: 60 })).toBeNull();
    expect(studentCard({ ...summary, goal: null, level: null, daysPerWeek: null, sessionMinutes: null }).status).toBe("SEM DADOS");
  });
});

describe("phases", () => {
  it("counts the weeks of each phase from the first week and names the workouts as the structure has them", () => {
    const spans = phaseSpans([{ index: 1, weeks: 4 }, { index: 2, weeks: 4 }, { index: 3, weeks: 1 }]);
    expect(spans.map(weeksText)).toEqual(["Semanas 1–4", "Semanas 5–8", "Semana 9"]);
    expect(workoutsText(["A", "B", "C"])).toBe("A, B, C");
    expect(workoutsShort(["A", "B", "C"])).toBe("A/B/C");
    expect(workoutsText(["A", "B", "C", "D", "E", "F"])).toBe("A a F");
    expect(workoutsShort(["A", "B", "C", "D", "E", "F"])).toBe("A–F");
    expect(workoutsText(["Full Body"])).toBe("Full Body");
    expect(workoutsText(["A", "C", "D", "E"])).toBe("A, C, D, E");
  });
});

describe("equipment", () => {
  it("keeps 'Sem equipamento' exclusive and never turns an unanswered choice into 'sem equipamento'", () => {
    expect(toggleEquipment([], "NONE", true)).toBe("NONE");
    expect(toggleEquipment("NONE", "BARBELL", true)).toEqual(["BARBELL"]);
    expect(toggleEquipment(["BARBELL", "BENCH"], "NONE", true)).toBe("NONE");
    expect(toggleEquipment("NONE", "NONE", false)).toEqual([]);
    expect(toggleEquipment(["BARBELL"], "BARBELL", false)).toEqual([]);
    expect(equipmentSummary([])).toBe("Nenhum selecionado");
    expect(equipmentStatus([])).toBe("Nenhuma opção selecionada");
    expect(equipmentSummary(["BARBELL", "DUMBBELL"])).toBe("Barra, Halteres");
    expect(equipmentSummary(["BARBELL", "DUMBBELL", "BENCH", "RACK"])).toBe("4 selecionados");
    expect(equipmentStatus("NONE")).toBe("Sem equipamento");
    // The unanswered state still counts as an open question.
    expect(openRequired([q("EQUIPMENT")], { ...EMPTY_FORM, equipment: [] })).toHaveLength(1);
    expect(openRequired([q("EQUIPMENT")], { ...EMPTY_FORM, equipment: "NONE" })).toHaveLength(0);
  });
});

describe("the dose policy catalogue", () => {
  it("groups the rule set's own rows by modality, one line per policy, none lost", () => {
    const tabs = policyTabs(rows);
    expect(tabs.map((t) => t.id)).toEqual(["RESISTANCE", "CARDIO", "OTHER"]);
    expect(tabs.flatMap((t) => t.rows)).toHaveLength(rows.length);
    expect(tabs.find((t) => t.id === "OTHER")!.rows.every((r) => !["RESISTANCE", "CARDIO"].includes(r.modality))).toBe(true);
  });

  it("names a policy by its stimulus, and by its measure where the stimulus alone is ambiguous", () => {
    expect(policyTitle(row("HYPERTROPHY", "RESISTANCE", "REPS"), rows)).toBe("Hipertrofia");
    expect(policyTitle(row("*", "RESISTANCE", "TIME"), rows)).toBe("Qualquer estímulo · Tempo");
    expect(policySubtitle(row("HYPERTROPHY", "RESISTANCE", "REPS"))).toBe("Treino resistido · repetições");
  });

  it("summarises the base dose in one line as the rule set has it", () => {
    expect(doseSummary(row("HYPERTROPHY", "RESISTANCE", "REPS"))).toBe("3 × 8–12 • RIR 1–3 • 90 s");
    expect(doseSummary(row("STRENGTH", "RESISTANCE", "REPS"))).toBe("4 × 3–6 • RIR 2–3 • 180 s");
    expect(doseSummary(row("*", "RESISTANCE", "TIME"))).toBe("3 × 20–40 s • descanso 60 s");
    expect(doseSummary(row("AEROBIC_ENDURANCE", "CARDIO", "CONTINUOUS"))).toBe("20–30 min");
    expect(doseSummary(row("INTERVALS", "CARDIO", "INTERVALS"))).toContain("esforço 30–60 s");
  });

  it("shows an edit in the line and marks it, but an edit equal to the default is no edit", () => {
    const h = row("HYPERTROPHY", "RESISTANCE", "REPS");
    expect(doseSummary(h, { [`${h.key}:sets`]: "5" })).toBe("5 × 8–12 • RIR 1–3 • 90 s");
    expect(rowEdited(h, { [`${h.key}:sets`]: "5" })).toBe(true);
    expect(rowEdited(h, { [`${h.key}:sets`]: "3" })).toBe(false);
    expect(rowEdited(h, {})).toBe(false);
  });
});

describe("the editor of one policy", () => {
  const h = row("HYPERTROPHY", "RESISTANCE", "REPS");
  it("opens with the rule set's values (not as edits) and records only what differs", () => {
    const draft = draftFor(h, {});
    expect(draft).toEqual({ sets: "3", repsMin: "8", repsMax: "12", rirMin: "1", rirMax: "3", restSeconds: "90" });
    expect(draftDirty(h, {}, draft)).toBe(false);
    // Saving the untouched draft records nothing: the engine version's own values apply.
    expect(commitDraft(h, {}, draft)).toEqual({});
    const edited = commitDraft(h, {}, { ...draft, sets: "4", repsMax: "10" });
    expect(edited).toEqual({ [`${h.key}:sets`]: "4", [`${h.key}:repsMax`]: "10" });
    expect(draftDirty(h, {}, { ...draft, sets: "4" })).toBe(true);
    // The cells of other policies stay; writing a value back to the default removes the edit.
    const other = row("STRENGTH", "RESISTANCE", "REPS");
    const both = commitDraft(h, { [`${other.key}:sets`]: "6" }, { ...draft, sets: "4" });
    expect(both).toEqual({ [`${other.key}:sets`]: "6", [`${h.key}:sets`]: "4" });
    expect(commitDraft(h, both, draft)).toEqual({ [`${other.key}:sets`]: "6" });
    expect(restoreRow(h, both)).toEqual({ [`${other.key}:sets`]: "6" });
  });

  it("refuses by field: a number from 0 on, and a minimum above its maximum", () => {
    const draft = draftFor(h, {});
    expect(validateDraft(h, draft)).toEqual({});
    expect(validateDraft(h, { ...draft, sets: "", restSeconds: "abc" })).toEqual({ sets: "Informe um número de 0 em diante.", restSeconds: "Informe um número de 0 em diante." });
    expect(validateDraft(h, { ...draft, repsMin: "15" })).toEqual({ repsMin: "O mínimo não pode passar do máximo." });
    expect(validateDraft(h, { ...draft, rirMin: "4", rirMax: "3" })).toEqual({ rirMin: "O mínimo não pode passar do máximo." });
  });

  it("feeds the same overrides as before: only the saved edits reach the engine, with their rule row", () => {
    const edits = commitDraft(h, {}, { ...draftFor(h, {}), sets: "4" });
    const out = policyOverrides(rows, edits);
    expect(out).toEqual({ ok: true, overrides: [{ stimulus: "HYPERTROPHY", modality: "RESISTANCE", metric: "REPS", patch: { values: { sets: 4 } } }] });
    const built = answersFromForm({ ...EMPTY_FORM, policy: edits }, rows);
    expect(built.ok && built.answers.policyOverrides).toHaveLength(1);
    const untouched = answersFromForm(EMPTY_FORM, rows);
    expect(untouched.ok && untouched.answers.policyOverrides).toBeUndefined();
  });

  it("labels each field with its short name and unit", () => {
    expect(paramField("restSeconds")).toEqual({ short: "Descanso", unit: "s", name: "Descanso (segundos)" });
    expect(paramField("repsMin")).toEqual({ short: "Reps mín.", unit: null, name: "Reps mín." });
    expect(paramField("sets")).toEqual({ short: "Séries", unit: null, name: "Séries" });
    expect(paramField("distanceMin").unit).toBe("m");
  });
});

describe("the pending answers", () => {
  const open = [q("EQUIPMENT"), q("STIMULUS", { phaseIndex: 2 }), q("STIMULUS", { phaseIndex: 1 }), q("STIMULUS", { phaseIndex: 3 })];
  it("lists exactly what is open, in the order the screen asks, each with its field", () => {
    const items = pendingItems(open);
    expect(items.map((i) => i.label)).toEqual(["Estímulo da fase 01", "Estímulo da fase 02", "Estímulo da fase 03", "Equipamentos disponíveis"]);
    expect(items.map((i) => i.fieldId)).toEqual(["fig-gen-stimulus-1", "fig-gen-stimulus-2", "fig-gen-stimulus-3", "fig-gen-equipment"]);
    expect(pendingSummary(items)).toBe("4 respostas faltam: 3 estímulos e equipamentos");
    expect(pendingSummaryShort(items, 3)).toBe("Faltam estímulos das 3 fases e equipamentos.");
  });

  it("follows the real questions: fewer phases, counts and modalities of workouts, nothing hardcoded", () => {
    const one = pendingItems([q("STIMULUS", { phaseIndex: 1 })]);
    expect(pendingSummary(one)).toBe("1 resposta falta: 1 estímulo");
    const many = pendingItems([q("STIMULUS", { phaseIndex: 1 }), q("EXERCISE_COUNT", { phaseIndex: 1, label: "B" }), q("MODALITIES", { phaseIndex: 2, label: "A" })]);
    expect(many.map((i) => i.label)).toEqual(["Estímulo da fase 01", "Exercícios do treino B · Fase 01", "Modalidades do treino A · Fase 02"]);
    expect(pendingSummary(many)).toBe("3 respostas faltam: 1 estímulo, 1 quantidade de exercícios e 1 treino sem modalidade");
    expect(pendingItems([])).toEqual([]);
    expect(pendingSummary([])).toBe("");
  });
});

describe("validation by field", () => {
  it("points each message at its own field and leaves the optional ones alone", () => {
    expect(formFieldErrors(EMPTY_FORM)).toEqual({});
    const errors = formFieldErrors({
      ...EMPTY_FORM,
      availableMinutes: "0",
      counts: [{ phaseIndex: 1, label: "B", count: "99" }],
      progression: [{ ...{ model: "LINEAR" as const, param: "sets" as const, from: "", to: "", delta: "", everyWeeks: "1", limit: "", deloadWeeks: "", deloadMultiplier: "" }, phaseIndex: 2 }],
    });
    expect(Object.keys(errors).sort()).toEqual(["fig-gen-count-1-B", "fig-gen-minutes", "fig-gen-progression-2"]);
    expect(errors["fig-gen-progression-2"]).toMatch(/progressão linear/);
  });
});
