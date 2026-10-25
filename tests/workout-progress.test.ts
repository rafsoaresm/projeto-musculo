import { describe, expect, it } from "vitest";
import { addDays, closedSummary, loadSeries, percentCovered, weeklyRecords, type PlannedWeek } from "@/modules/execucao/progress";

// Four weeks of three Full Body workouts, from Monday 2 Nov 2026.
const plan: PlannedWeek[] = [0, 1, 2, 3].map((week) => ({
  phaseIndex: 1,
  startDate: addDays("2026-11-02", week * 7),
  endDate: addDays("2026-11-02", week * 7 + 6),
  workouts: ["A", "B", "C"],
}));
const log = (performedOn: string, workoutLabel = "A") => ({ performedOn, workoutLabel });

describe("the weekly records", () => {
  it("counts the logs of each week against the workouts foreseen, with both ends of the week inside", () => {
    const result = weeklyRecords(
      plan,
      [log("2026-11-02", "A"), log("2026-11-08", "C"), log("2026-11-09", "A"), log("2026-11-10", "B")],
      { since: "2026-11-01", until: "2026-11-30", today: "2026-11-30" },
    );
    expect(result.weeks.map((week) => [week.startDate, week.planned, week.recorded])).toEqual([
      ["2026-11-02", 3, 2],
      ["2026-11-09", 3, 2],
      ["2026-11-16", 3, 0],
      ["2026-11-23", 3, 0],
    ]);
    expect(result.weeks[0].recordedWorkouts).toEqual(["A", "C"]);
    expect(result.weeks[1].recordedWorkouts).toEqual(["A", "B"]);
    expect(result.outside).toBe(0);
  });

  it("never counts the week in progress as missing", () => {
    const result = weeklyRecords(plan, [log("2026-11-02")], { since: "2026-11-01", until: "2026-11-11", today: "2026-11-11" });
    expect(result.weeks.map((week) => [week.startDate, week.inProgress])).toEqual([
      ["2026-11-02", false],
      ["2026-11-09", true],
    ]);
    expect(result.closed).toEqual({ weeks: 1, planned: 3, recorded: 1, covered: 1 });
  });

  it("does not show weeks before the student had the plan or after a newer one replaced it", () => {
    const delivered = weeklyRecords(plan, [], { since: "2026-11-10", until: "2026-11-30", today: "2026-11-30" });
    // The week of 2 Nov ended before the delivery: it was never the student's to miss.
    expect(delivered.weeks.map((week) => week.startDate)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"]);
    const replaced = weeklyRecords(plan, [log("2026-11-10")], { since: "2026-11-01", until: "2026-11-12", today: "2026-11-20" });
    expect(replaced.weeks.map((week) => week.startDate)).toEqual(["2026-11-02", "2026-11-09"]);
    // Nothing of a replaced cycle is in progress, and the week it was cut in is not a closed one.
    expect(replaced.weeks.every((week) => !week.inProgress)).toBe(true);
    expect(replaced.closed).toEqual({ weeks: 1, planned: 3, recorded: 0, covered: 0 });
  });

  it("keeps logs that fall outside the weeks shown apart instead of hiding them", () => {
    const result = weeklyRecords(plan, [log("2026-10-31"), log("2026-11-10"), log("2026-12-05")], {
      since: "2026-11-01", until: "2026-11-30", today: "2026-11-30",
    });
    expect(result.outside).toBe(2);
    expect(result.weeks.reduce((sum, week) => sum + week.recorded, 0)).toBe(1);
  });

  it("shows more logs than foreseen as they are", () => {
    const result = weeklyRecords(plan.slice(0, 1), ["A", "B", "C", "A"].map((label, i) => log(addDays("2026-11-02", i), label)), {
      since: "2026-11-01", until: "2026-11-30", today: "2026-11-30",
    });
    expect(result.weeks[0]).toMatchObject({ planned: 3, recorded: 4 });
    expect(result.closed).toEqual({ weeks: 1, planned: 3, recorded: 4, covered: 3 });
  });
});

describe("the load series", () => {
  const set = (reps: number | null, loadKg: number | null) => ({ reps, loadKg });

  it("keeps the heaviest set of each day, the most repetitions on a tie, and merges the same day", () => {
    const [squat] = loadSeries([
      { performedOn: "2026-11-02", name: "Agachamento", sets: [set(10, 20), set(8, 22.5), set(9, 22.5)] },
      { performedOn: "2026-11-09", name: "Agachamento", sets: [set(10, 25)] },
      { performedOn: "2026-11-09", name: "Agachamento", sets: [set(5, 30)] },
    ]);
    expect(squat.points).toEqual([
      { performedOn: "2026-11-02", maxLoadKg: 22.5, repsAtMax: 9, sets: 3 },
      { performedOn: "2026-11-09", maxLoadKg: 30, repsAtMax: 5, sets: 2 },
    ]);
    expect(squat.numeric).toHaveLength(2);
  });

  it("is one series for the same name whatever the case and accents, and orders the most recent first", () => {
    const series = loadSeries([
      { performedOn: "2026-11-02", name: "Remada Curvada", sets: [set(10, 30)] },
      { performedOn: "2026-11-09", name: "remada  curvada", sets: [set(10, 32)] },
      { performedOn: "2026-11-05", name: "Prancha", sets: [set(1, null)] },
      { performedOn: "2026-11-12", name: "Rosca Direta", sets: [set(12, 10)] },
      { performedOn: "2026-11-12", name: "Elevação", sets: [set(12, 8)] },
    ]);
    expect(series.map((item) => item.name)).toEqual(["Elevação", "Rosca Direta", "remada  curvada", "Prancha"]);
    expect(series.find((item) => item.key === "remada curvada")!.points.map((point) => point.maxLoadKg)).toEqual([30, 32]);
  });

  it("does not invent a load: repetitions only is a point with no weight and is not drawn", () => {
    const [plank] = loadSeries([{ performedOn: "2026-11-05", name: "Prancha", sets: [set(60, null), set(45, null)] }]);
    expect(plank.points).toEqual([{ performedOn: "2026-11-05", maxLoadKg: null, repsAtMax: null, sets: 2 }]);
    expect(plank.numeric).toEqual([]);
  });

  it("is empty without logs", () => {
    expect(loadSeries([])).toEqual([]);
  });
});

describe("the percentage of the cycle", () => {
  it("counts each week at most what it foresaw, so a fourth log does not hide an empty week", () => {
    const week = (index: number, count: number) =>
      Array.from({ length: count }, (_, i) => log(addDays("2026-11-02", index * 7 + i), "A"));
    const result = weeklyRecords(plan.slice(0, 2), [...week(0, 4), ...week(1, 0)], {
      since: "2026-11-01", until: "2026-11-30", today: "2026-11-30",
    });
    // 4 logs in the first week, none in the second: 4 of 6 by count, but 3 of 6 are covered.
    expect(result.closed).toEqual({ weeks: 2, planned: 6, recorded: 4, covered: 3 });
    expect(percentCovered(result.closed)).toBe(50);
  });

  it("rounds to a whole percent and is null when nothing was foreseen", () => {
    expect(percentCovered({ planned: 3, covered: 2 })).toBe(67);
    expect(percentCovered({ planned: 3, covered: 1 })).toBe(33);
    expect(percentCovered({ planned: 3, covered: 3 })).toBe(100);
    expect(percentCovered({ planned: 3, covered: 0 })).toBe(0);
    expect(percentCovered({ planned: 0, covered: 0 })).toBeNull();
  });

  it("is said in plain words, without a grade, and never for the week that is still going", () => {
    expect(closedSummary({ weeks: 0, planned: 0, recorded: 0, covered: 0 }, 0)).toBe("Nenhuma semana encerrada ainda.");
    const text = closedSummary({ weeks: 2, planned: 6, recorded: 4, covered: 3 }, 1);
    expect(text).toBe(
      "Nas 2 semanas já encerradas: 4 treinos registrados para 6 previstos. Isso é 50% dos treinos previstos com registro (cada semana conta, no máximo, o que estava previsto). 1 registro fora das semanas mostradas.",
    );
    expect(closedSummary({ weeks: 1, planned: 3, recorded: 1, covered: 1 }, 0)).toContain("1 semana já encerrada: 1 treino registrado para 3 previstos. Isso é 33%");
    // No judgement: no goal, grade or word that rates it.
    expect(text).not.toMatch(/meta|baixa|alta|bom|ruim|falt|abaixo|acima|ótim|péssim|aderência/i);
  });
});
