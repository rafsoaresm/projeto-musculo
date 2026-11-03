import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  DEFAULT_CHECKIN_FORM,
  MAX_OWN_QUESTIONS,
  RECOVERY_LABELS,
  checkinDayAllowed,
  daysBefore,
  parseCheckin,
  parseCheckinForm,
  readAnswers,
  readQuestions,
  sameCheckinForm,
} from "@/modules/checkin/contracts";
import { MAX_DAYS_BACK } from "@/modules/execucao/contracts";

describe("what a check-in may say", () => {
  it("keeps what the student chose and types, trimmed, and nothing else", () => {
    expect(parseCheckin({ effort: 7, recovery: 4, discomfort: false, notes: "  dormi mal  " })).toEqual({
      effort: 7,
      recovery: 4,
      discomfort: false,
      discomfortNotes: null,
      notes: "dormi mal",
      answers: [],
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

describe("the questions the professional chooses (0.87)", () => {
  const form = {
    askEffort: false,
    askRecovery: true,
    askNotes: false,
    questions: [
      { id: "q-sono", text: "Como dormiu?" },
      { id: "q-ali", text: "Como foi a alimentação?" },
    ],
  };

  it("keeps only what the form asks, drops answers to questions it does not have, and leaves a blank answer out (never 0)", () => {
    const parsed = parseCheckin(
      {
        effort: 7,
        recovery: 3,
        notes: "não perguntado",
        answers: [
          { questionId: "q-sono", answer: "  mal  " },
          { questionId: "q-ali", answer: "   " },
          { questionId: "q-outra", answer: "de outra versão" },
        ],
      },
      form,
    );
    expect(parsed).toEqual({
      effort: null,
      recovery: 3,
      discomfort: false,
      discomfortNotes: null,
      notes: null,
      answers: [{ questionId: "q-sono", answer: "mal" }],
    });
  });

  it("counts an answer to an own question as an answer, and nothing else that the form does not ask", () => {
    expect(parseCheckin({ answers: [{ questionId: "q-ali", answer: "bem" }] }, form).answers).toHaveLength(1);
    // An effort the form does not ask is not kept, so it does not make the check-in non-empty.
    expect(() => parseCheckin({ effort: 5 }, form)).toThrow(ZodError);
    expect(() => parseCheckin({ answers: [{ questionId: "q-ali", answer: "" }] }, form)).toThrow(ZodError);
    // The report of discomfort is always asked.
    expect(parseCheckin({ discomfort: true }, { ...form, questions: [] })).toMatchObject({ discomfort: true });
    expect(() => parseCheckin({ answers: [{ questionId: "q-ali", answer: "x".repeat(501) }] }, form)).toThrow(ZodError);
  });

  it("reads the professional's choice, with fresh ids for new questions and the old ids kept", () => {
    let n = 0;
    const parsed = parseCheckinForm(
      { askEffort: true, askRecovery: false, askNotes: true, questions: [{ id: "q-sono", text: " Como dormiu? " }, { id: null, text: "Nova" }, { id: "q-sono", text: "Repetida" }] },
      () => `new-${++n}`,
    );
    expect(parsed.questions).toEqual([
      { id: "q-sono", text: "Como dormiu?" },
      { id: "new-1", text: "Nova" },
      { id: "new-2", text: "Repetida" },
    ]);
    for (const bad of [
      { askEffort: true, askRecovery: true, askNotes: true, questions: [{ text: "  " }] },
      { askEffort: true, askRecovery: true, askNotes: true, questions: [{ text: "x".repeat(201) }] },
      { askEffort: true, askRecovery: true, askNotes: true, questions: Array.from({ length: MAX_OWN_QUESTIONS + 1 }, () => ({ text: "a" })) },
      { askEffort: true, askRecovery: true, askNotes: true, questions: [], askDiscomfort: false },
      { askEffort: true, askRecovery: true, questions: [] },
      { askEffort: true, askRecovery: true, askNotes: true, questions: [{ id: "Bad Id!", text: "a" }] },
    ])
      expect(() => parseCheckinForm(bad), JSON.stringify(bad).slice(0, 80)).toThrow(ZodError);
  });

  it("compares forms by what they ask, and reads stored lists defensively", () => {
    expect(sameCheckinForm(DEFAULT_CHECKIN_FORM, { ...DEFAULT_CHECKIN_FORM })).toBe(true);
    expect(sameCheckinForm(form, { ...form, questions: form.questions.map((q) => ({ ...q, id: "other" })) })).toBe(true);
    expect(sameCheckinForm(form, { ...form, askNotes: true })).toBe(false);
    expect(sameCheckinForm(form, { ...form, questions: [...form.questions].reverse() })).toBe(false);
    expect(readQuestions(null)).toEqual([]);
    expect(readQuestions("not json")).toEqual([]);
    expect(readQuestions('[{"id":"a","text":"b"},{"id":1},"x"]')).toEqual([{ id: "a", text: "b" }]);
    expect(readAnswers('[{"questionId":"a","answer":"b"},{"questionId":"a"}]')).toEqual([{ questionId: "a", answer: "b" }]);
  });
});

describe("the day of a check-in", () => {
  it("is today or one of the last days of the window of the workout log, never the future nor a malformed day", () => {
    const today = "2026-11-20";
    expect(checkinDayAllowed(today, today)).toBe(true);
    expect(checkinDayAllowed(daysBefore(today, MAX_DAYS_BACK), today)).toBe(true);
    expect(checkinDayAllowed(daysBefore(today, MAX_DAYS_BACK + 1), today)).toBe(false);
    expect(checkinDayAllowed("2026-11-21", today)).toBe(false);
    for (const bad of ["2026-02-30", "20-11-2026", "2026-11-1", "", "2026-11-20T00:00"]) expect(checkinDayAllowed(bad, today), bad).toBe(false);
    expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28");
  });
});
