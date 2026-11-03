import { describe, expect, it } from "vitest";
import type { ResultRow } from "@/db/assessments";
import { LEGACY_METHOD, resultEvolution, type EvolutionSource } from "@/modules/avaliacoes/v2/evolution";

// Slice 0.82: the evolution compares a result only with values obtained the same way (handoff 4.3: a change of protocol is marked, never
// joined; 9: method and limits of comparability visible). The earlier format, method unknown, stays apart. Empty never becomes 0.
const JP7 = "jackson_pollock_7_1978_male";
const FAULKNER = "faulkner_4_1968";
const row = (code: string, value: number | null, method: string, extra: Partial<ResultRow> = {}): ResultRow => ({
  code,
  value,
  unit: code === "body_fat_percent" ? "%" : code === "bmi" ? null : "mm",
  method,
  formulaVersion: method === LEGACY_METHOD ? null : "av2-2026-11",
  inputs: method === LEGACY_METHOD ? null : method === FAULKNER || method === "weight_over_height_squared" ? {} : { conversion: "siri_1961" },
  flags: [],
  ...extra,
});
const at = (id: string, assessedOn: string, results: ResultRow[], formatVersion: number | null = 2): EvolutionSource => ({ id, assessedOn, formatVersion, results });

describe("comparable series of results", () => {
  const history = [
    at("old", "2026-01-10", [row("body_fat_percent", 21.5, LEGACY_METHOD, { flags: [LEGACY_METHOD] })], null),
    at("a1", "2026-03-01", [row("body_fat_percent", 17.27, JP7), row("bmi", 23.63, "weight_over_height_squared")]),
    at("a2", "2026-05-01", [row("body_fat_percent", 15.88, FAULKNER), row("bmi", 23.9, "weight_over_height_squared")]),
    at("a3", "2026-07-01", [row("body_fat_percent", 16.4, JP7), row("bmi", 24.1, "weight_over_height_squared")]),
  ];
  const groups = resultEvolution(history);
  const fat = groups.find((group) => group.code === "body_fat_percent")!;
  const bmi = groups.find((group) => group.code === "bmi")!;

  it("keeps the order of the assessment's results", () => {
    expect(groups.map((group) => group.code)).toEqual(["body_fat_percent", "bmi"]);
  });
  it("never joins two protocols: one series per method, the newest marked", () => {
    expect(fat.mixed).toBe(true);
    expect(fat.series.map((series) => [series.method, series.points.map((point) => point.value), series.latest])).toEqual([
      [JP7, [17.27, 16.4], true],
      [FAULKNER, [15.88], false],
    ]);
  });
  it("marks in time where the method changes, and where it changes back", () => {
    expect(fat.timeline.map((point) => [point.assessmentId, point.break])).toEqual([
      ["a1", null],
      ["a2", "method"],
      ["a3", "method"],
    ]);
  });
  it("keeps the earlier format and the unknown method out of every series", () => {
    expect(fat.legacy.map((point) => [point.assessmentId, point.value, point.method])).toEqual([["old", 21.5, LEGACY_METHOD]]);
    expect(fat.timeline.some((point) => point.assessmentId === "old")).toBe(false);
    // A result of the new format whose method is unknown is apart too.
    const unknown = resultEvolution([at("x", "2026-01-01", [row("body_fat_percent", 20, LEGACY_METHOD)])])[0];
    expect([unknown.series.length, unknown.legacy.length]).toEqual([0, 1]);
  });
  it("one method throughout is one series with no break", () => {
    expect(bmi.mixed).toBe(false);
    expect(bmi.series).toHaveLength(1);
    expect(bmi.timeline.map((point) => point.break)).toEqual([null, null, null]);
  });
  it("a different formula version, conversion or unit is not comparable either, and is not called a different methodology", () => {
    const changed = resultEvolution([
      at("v1", "2026-01-01", [row("body_fat_percent", 17.2, JP7)]),
      at("v2", "2026-02-01", [row("body_fat_percent", 17.0, JP7, { formulaVersion: "av2-2027-01" })]),
      at("v3", "2026-03-01", [row("body_fat_percent", 16.8, JP7, { formulaVersion: "av2-2027-01", inputs: { conversion: "brozek_1963" } })]),
      at("v4", "2026-04-01", [row("body_fat_percent", 0.167, JP7, { formulaVersion: "av2-2027-01", inputs: { conversion: "brozek_1963" }, unit: "fração" })]),
    ])[0];
    expect(changed.series).toHaveLength(4);
    expect(changed.timeline.map((point) => point.break)).toEqual([null, "formula", "conversion", "unit"]);
    expect([changed.mixed, changed.methodsDiffer]).toEqual([true, false]);
    expect(fat.methodsDiffer).toBe(true);
  });
  it("the conversion (Siri) belongs only to the % fat and the masses from it, never to the sum of skinfolds or the density (handoff 4.2)", () => {
    const shared = { conversion: "siri_1961" };
    const [sum, density, percent, fatMass, lean] = resultEvolution([
      at("c1", "2026-01-01", [
        row("sum_skinfolds", 122, JP7, { inputs: shared }),
        row("body_density", 1.0634, JP7, { unit: "g/cm³", inputs: shared }),
        row("body_fat_percent", 17.27, JP7, { inputs: shared }),
        row("fat_mass_kg", 11.9, JP7, { unit: "kg", inputs: shared }),
        row("lean_mass_kg", 57.2, JP7, { unit: "kg", inputs: shared }),
      ]),
      // A conversion written in the inputs of the sum does not split its series.
      at("c2", "2026-02-01", [row("sum_skinfolds", 120, JP7, { inputs: { conversion: "brozek_1963" } })]),
    ]);
    expect([sum.code, density.code, percent.code, fatMass.code, lean.code]).toEqual(["sum_skinfolds", "body_density", "body_fat_percent", "fat_mass_kg", "lean_mass_kg"]);
    expect([sum.series[0].conversion, density.series[0].conversion]).toEqual([null, null]);
    expect([percent.series[0].conversion, fatMass.series[0].conversion, lean.series[0].conversion]).toEqual(["siri_1961", "siri_1961", "siri_1961"]);
    expect(sum.series).toHaveLength(1);
    expect(sum.timeline.map((point) => point.break)).toEqual([null, null]);
  });
  it("an empty value stays empty: never 0, never drawn", () => {
    const empty = resultEvolution([
      at("e1", "2026-01-01", [row("bmi", 23, "weight_over_height_squared")]),
      at("e2", "2026-02-01", [row("bmi", null, "weight_over_height_squared")]),
      at("e3", "2026-03-01", [row("bmi", Number.NaN, "weight_over_height_squared")]),
    ])[0];
    expect(empty.series[0].points.map((point) => point.value)).toEqual([23, null, null]);
    expect(empty.series[0].numeric.map((point) => point.assessmentId)).toEqual(["e1"]);
  });
  it("orders by assessment date, keeping the given order on the same day; nothing recorded is nothing to show", () => {
    const sameDay = resultEvolution([
      at("s2", "2026-02-01", [row("bmi", 24, "weight_over_height_squared")]),
      at("s1", "2026-01-01", [row("bmi", 23, "weight_over_height_squared")]),
      at("s3", "2026-02-01", [row("bmi", 25, "weight_over_height_squared")]),
    ])[0];
    expect(sameDay.timeline.map((point) => point.assessmentId)).toEqual(["s1", "s2", "s3"]);
    expect(resultEvolution([at("n", "2026-01-01", [])])).toEqual([]);
    expect(resultEvolution([])).toEqual([]);
  });
});
