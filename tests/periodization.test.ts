import { describe, expect, it } from "vitest";
import { buildPeriodization } from "@/modules/training/periodization";
import type { PhaseInput } from "@/modules/training/contracts";

const phase = (updates: Partial<PhaseInput> = {}): PhaseInput => ({
  weeks: 3,
  sessionsPerWeek: 2,
  split: "ABC",
  exercisesPerSession: 5,
  ...updates,
});
const input = (count = 3) => ({
  startDate: "2026-10-26",
  phases: Array.from({ length: count }, () => phase()),
});

describe("periodization calendar and rotation", () => {
  it.each([3, 6, 12])("creates %i independent phases", (count) => {
    const result = buildPeriodization(input(count));
    expect(result.phases).toHaveLength(count);
    expect(result.totalWeeks).toBe(count * 3);
    expect(result.totalSessions).toBe(count * 6);
    expect(result.status).toBe("DRAFT");
  });
  it("continues ABC across two-session weeks", () => {
    expect(
      buildPeriodization(input()).phases[0].microcycles.map((w) => w.sessions),
    ).toEqual([
      ["A", "B"],
      ["C", "A"],
      ["B", "C"],
    ]);
  });
  it("handles leap days and continuous, non-overlapping phase dates", () => {
    const result = buildPeriodization({ ...input(), startDate: "2028-02-28" });
    expect(result.phases[0].microcycles[0].endDate).toBe("2028-03-05");
    expect(result.phases[0].endDate).toBe("2028-03-19");
    expect(result.phases[1].startDate).toBe("2028-03-20");
    expect(result.endDate).toBe("2028-04-30");
  });
  it("uses each phase's own weeks, frequency and split", () => {
    const result = buildPeriodization({
      ...input(),
      phases: [
        phase(),
        phase({ weeks: 6, sessionsPerWeek: 7, split: "ABCDEFG" }),
        phase({ weeks: 4, sessionsPerWeek: 1, split: "Full Body" }),
      ],
    });
    expect(result.totalWeeks).toBe(13);
    expect(result.totalSessions).toBe(52);
    expect(result.phases[1].microcycles[0].sessions).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
    ]);
    expect(result.phases[2].microcycles[0].sessions).toEqual(["Full Body"]);
  });
  it("does not mutate or share phase objects", () => {
    const data = input();
    const before = structuredClone(data);
    const result = buildPeriodization(data);
    result.phases[0].microcycles[0].sessions[0] = "Changed";
    expect(data).toEqual(before);
    expect(result.phases[1].microcycles[0].sessions[0]).toBe("A");
  });
  it.each([0, 1, 2, 4, 13])("rejects invalid phase count %i", (count) => {
    expect(() => buildPeriodization(input(count))).toThrow();
  });
  it.each([
    "2026-02-29",
    "2026-13-01",
    "2026-04-31",
    "2026-1-01",
    "",
    "1999-12-31",
  ])("rejects invalid date %s", (startDate) => {
    expect(() => buildPeriodization({ ...input(), startDate })).toThrow();
  });
  it.each([
    { weeks: 2 },
    { weeks: 7 },
    { weeks: 3.5 },
    { sessionsPerWeek: 0 },
    { sessionsPerWeek: 8 },
    { exercisesPerSession: 2 },
    { exercisesPerSession: 9 },
    { split: "XX" },
  ])("rejects unsupported parameters %j", (update) => {
    const data = input();
    expect(() =>
      buildPeriodization({
        ...data,
        phases: [{ ...data.phases[0], ...update }, ...data.phases.slice(1)],
      }),
    ).toThrow();
  });
});
