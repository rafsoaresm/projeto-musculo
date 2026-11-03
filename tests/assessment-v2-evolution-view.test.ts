import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssessmentSnapshot, ResultRow } from "@/db/assessments";
import { EvolutionView } from "@/modules/avaliacoes/evolution-view";
import { ResultsEvolution } from "@/modules/avaliacoes/v2/results-evolution";

// Slice 0.82: migration 0033 copied the body fat typed in each earlier-format assessment into the results, as "método desconhecido". That copy
// alone must not change the page of a student with only the earlier format; with an Avaliação Física too, the value shows once.
const noFlags = { exertionPain: false, dizzinessFainting: false, chestPain: false, injuryInTreatment: false, recentSurgery: false, medicalRestriction: false };
const bodyFat = (value: number) => ({ metricType: "BODY_FAT", name: "Percentual de gordura", valueText: String(value).replace(".", ","), valueNumber: value, unit: "%", side: null, notes: null });
const copied = (value: number): ResultRow => ({ code: "body_fat_percent", value, unit: "%", method: "legacy_formula_unknown", formulaVersion: null, inputs: null, flags: ["legacy_formula_unknown"] });
const snapshot = (id: string, assessedOn: string, extra: Partial<AssessmentSnapshot> = {}): AssessmentSnapshot => ({
  id, assessedOn, recordedAt: null, kind: "REASSESSMENT", formatVersion: null, riskStatus: "CLEAR", reviewed: false, flags: { ...noFlags },
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

describe("the results panel with two assessments of the same date (slice 0.84)", () => {
  const bmi = (value: number): ResultRow => ({ code: "bmi", value, unit: "kg/m²", method: "weight_over_height_squared", formulaVersion: "av2-2026-11", inputs: {}, flags: [] });
  const history = [
    { id: "a", assessedOn: "2026-11-01", recordedAt: "2026-11-01T13:00:00.000Z", formatVersion: 2, results: [bmi(23.6)] },
    { id: "b", assessedOn: "2026-11-03", recordedAt: "2026-11-03T13:05:00.000Z", formatVersion: 2, results: [bmi(23.9)] },
    { id: "c", assessedOn: "2026-11-03", recordedAt: "2026-11-03T20:40:00.000Z", formatVersion: 2, results: [bmi(24.1)] },
  ];
  it("dates the values of the shared date with the time recorded, and the student's panel has its own heading", () => {
    const page = renderToStaticMarkup(createElement(ResultsEvolution, { history, headingId: "resultados-st-1", heading: "Resultados ao longo do tempo · One" }));
    expect(page).toContain('id="resultados-st-1"');
    expect(page).toContain("Resultados ao longo do tempo · One");
    expect(page).toContain("Primeiro: 23,60 kg/m² em 01/11/2026. Último: 24,10 kg/m² em 03/11/2026 17:40.");
    expect(page).toContain("03/11/2026 10:05");
    // The axis of the chart ends at the last value, with its time.
    expect(count(page, "03/11/2026 17:40")).toBeGreaterThanOrEqual(3);
    expect(page).not.toMatch(/\bnormal\b|\bbom\b|\bruim\b|excelente|sobrepeso|obesidade/i);
  });
});
