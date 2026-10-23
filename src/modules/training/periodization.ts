import {
  periodizationInputSchema,
  type PeriodizationSchedule,
} from "./contracts";

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** Calendar dates, not instants. Rotation continues between weeks within a phase. */
export function buildPeriodization(input: unknown): PeriodizationSchedule {
  const parsed = periodizationInputSchema.parse(input);
  let cursor = parsed.startDate;
  let totalSessions = 0;
  let totalWeeks = 0;
  const phases = parsed.phases.map((phase, index) => {
    const startDate = cursor;
    const split =
      phase.split === "Full Body" ? ["Full Body"] : [...phase.split];
    const microcycles = Array.from({ length: phase.weeks }, (_, week) => {
      const weekStart = cursor;
      const sessions = Array.from(
        { length: phase.sessionsPerWeek },
        (_, session) =>
          split[(week * phase.sessionsPerWeek + session) % split.length],
      );
      cursor = addDays(cursor, 7);
      return {
        index: week + 1,
        startDate: weekStart,
        endDate: addDays(cursor, -1),
        sessions,
      };
    });
    totalSessions += phase.weeks * phase.sessionsPerWeek;
    totalWeeks += phase.weeks;
    return {
      ...phase,
      index: index + 1,
      startDate,
      endDate: addDays(cursor, -1),
      microcycles,
    };
  });
  return {
    schemaVersion: 1,
    engineVersion: "0.1.0",
    status: "DRAFT",
    startDate: parsed.startDate,
    endDate: addDays(cursor, -1),
    totalWeeks,
    totalSessions,
    phases,
  };
}
