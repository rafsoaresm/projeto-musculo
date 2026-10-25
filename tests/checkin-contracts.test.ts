import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { RECOVERY_LABELS, parseCheckin } from "@/modules/checkin/contracts";

describe("what a check-in may say", () => {
  it("keeps what the student chose and types, trimmed, and nothing else", () => {
    expect(parseCheckin({ effort: 7, recovery: 4, discomfort: false, notes: "  dormi mal  " })).toEqual({
      effort: 7,
      recovery: 4,
      discomfort: false,
      discomfortNotes: null,
      notes: "dormi mal",
    });
    // The ends of both scales are valid, and zero effort is an answer, not an absence.
    expect(parseCheckin({ effort: 0, recovery: 1 })).toMatchObject({ effort: 0, recovery: 1 });
    expect(parseCheckin({ effort: 10, recovery: 5 })).toMatchObject({ effort: 10, recovery: 5 });
  });

  it("needs at least one answer: an effort, a recovery, a report of discomfort or a note", () => {
    for (const empty of [{}, { effort: null, recovery: null }, { notes: "   " }, { discomfort: false, discomfortNotes: "x" }])
      expect(() => parseCheckin(empty), JSON.stringify(empty)).toThrow(ZodError);
    expect(parseCheckin({ discomfort: true })).toMatchObject({ discomfort: true, discomfortNotes: null });
    expect(parseCheckin({ notes: "só uma observação" })).toMatchObject({ notes: "só uma observação" });
  });

  it("keeps notes about a discomfort only together with the report of one", () => {
    expect(parseCheckin({ discomfort: true, discomfortNotes: " joelho direito " })).toMatchObject({ discomfortNotes: "joelho direito" });
    expect(parseCheckin({ effort: 3, discomfort: false, discomfortNotes: "joelho" })).toMatchObject({ discomfort: false, discomfortNotes: null });
  });

  it("refuses anything outside the scales or the sizes, and any field it does not know", () => {
    const bad: unknown[] = [
      { effort: 11 },
      { effort: -1 },
      { effort: 5.5 },
      { recovery: 0 },
      { recovery: 6 },
      { effort: "7" },
      { notes: "x".repeat(501) },
      { discomfort: true, discomfortNotes: "x".repeat(501) },
      { effort: 5, loggedBy: "someone-else" },
      { effort: 5, studentId: "st-2" },
      null,
      "effort",
    ];
    for (const value of bad) expect(() => parseCheckin(value), JSON.stringify(value)).toThrow();
  });

  it("describes every step of the recovery scale in words, and only those", () => {
    expect(Object.keys(RECOVERY_LABELS).map(Number)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(Object.values(RECOVERY_LABELS)).size).toBe(5);
  });
});
