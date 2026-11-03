import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssessmentSnapshot, ResultRow } from "@/db/assessments";
import { EvolutionView } from "@/modules/avaliacoes/evolution-view";

// Slice 0.82: migration 0033 copied the body fat typed in each earlier-format assessment into the results, as "método desconhecido". That copy
// alone must not change the page of a student with only the earlier format; with an Avaliação Física too, the value shows once.
const noFlags = { exertionPain: false, dizzinessFainting: false, chestPain: false, injuryInTreatment: false, recentSurgery: false, medicalRestriction: false };
const bodyFat = (value: number) => ({ metricType: "BODY_FAT", name: "Percentual de gordura", valueText: String(value).replace(".", ","), valueNumber: value, unit: "%", side: null, notes: null });
const copied = (value: number): ResultRow => ({ code: "body_fat_percent", value, unit: "%", method: "legacy_formula_unknown", formulaVersion: null, inputs: null, flags: ["legacy_formula_unknown"] });
const snapshot = (id: string, assessedOn: string, extra: Partial<AssessmentSnapshot> = {}): AssessmentSnapshot => ({
  id, assessedOn, kind: "REASSESSMENT", formatVersion: null, riskStatus: "CLEAR", reviewed: false, flags: { ...noFlags },
  posture: { findings: [], notes: null }, movement: [], metrics: [], photos: [], results: [], ...extra,
});
const html = (history: AssessmentSnapshot[]) => renderToStaticMarkup(createElement(EvolutionView, { studentId: "s", history }));
const count = (text: string, part: string) => text.split(part).length - 1;

describe("the evolution page and the body fat copied by migration 0033", () => {
  it("with only the earlier format, the page is as before: no results panel, one listing of the body fat, the one-assessment note", () => {
    const page = html([snapshot("old", "2026-01-10", { kind: "INITIAL", metrics: [bodyFat(21.5)], results: [copied(21.5)] })]);
    expect(page).not.toContain("Resultados ao longo do tempo");
    expect(page).toContain("Medidas ao longo do tempo");
    expect(page).not.toContain("Medidas do formato anterior");
    expect(page).toContain("Há uma avaliação só.");
    expect(page).toContain("Nenhum sinal marcado");
    expect(count(page, "21,5")).toBe(1);
  });
  it("with an Avaliação Física too, the copied value is listed once, apart as método desconhecido; the new one reads the PAR-Q", () => {
    const fresh: ResultRow = { code: "body_fat_percent", value: 17.27, unit: "%", method: "jackson_pollock_7_1978_male", formulaVersion: "av2-2026-11", inputs: { conversion: "siri_1961" }, flags: [] };
    const page = html([
      snapshot("old", "2026-01-10", { kind: "INITIAL", metrics: [bodyFat(21.5), { ...bodyFat(80), metricType: "WAIST", name: "Cintura", unit: "cm" }], results: [copied(21.5)] }),
      snapshot("new", "2026-03-01", { formatVersion: 2, results: [fresh] }),
    ]);
    expect(page).toContain("Resultados ao longo do tempo");
    expect(page).toContain("Formato anterior · método desconhecido");
    expect(count(page, "21,5")).toBe(1);
    // The other earlier measures keep their section.
    expect(page).toContain("Medidas do formato anterior");
    expect(page).toContain("Cintura");
    expect(page).not.toContain("Percentual de gordura");
    expect(page).toContain("PAR-Q sem “Sim”");
  });
});
