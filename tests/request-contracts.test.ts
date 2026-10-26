import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  ANSWER_DAYS,
  ANSWER_OUTCOMES,
  OUTCOME_LABEL,
  REQUEST_KINDS,
  REQUEST_KIND_HELP,
  REQUEST_KIND_LABEL,
  dueAtFor,
  isOverdue,
  outcomeLabel,
  parseAnswer,
  parseRequest,
} from "@/modules/pedidos/contracts";

const issues = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ZodError) return error.issues.map((issue) => issue.message);
    throw error;
  }
  return [];
};

describe("the deadline", () => {
  it("is fifteen calendar days after the request, at the same time of day", () => {
    expect(ANSWER_DAYS).toBe(15);
    expect(dueAtFor("2026-11-10T13:45:00.000Z")).toBe("2026-11-25T13:45:00.000Z");
    // Across the end of a month and of a year.
    expect(dueAtFor("2026-11-20T00:00:00.000Z")).toBe("2026-12-05T00:00:00.000Z");
    expect(dueAtFor("2026-12-25T10:00:00.000Z")).toBe("2027-01-09T10:00:00.000Z");
  });
  it("is overdue only after the instant, never on it", () => {
    const due = "2026-11-25T13:45:00.000Z";
    expect(isOverdue(due, new Date("2026-11-25T13:44:59.999Z"))).toBe(false);
    expect(isOverdue(due, new Date("2026-11-25T13:45:00.000Z"))).toBe(false);
    expect(isOverdue(due, new Date("2026-11-25T13:45:00.001Z"))).toBe(true);
  });
});

describe("what a student can ask", () => {
  it("knows every kind by name, in words, with what happens next", () => {
    for (const kind of REQUEST_KINDS) {
      expect(REQUEST_KIND_LABEL[kind].length).toBeGreaterThan(5);
      expect(REQUEST_KIND_HELP[kind].length).toBeGreaterThan(5);
    }
    expect(REQUEST_KINDS).toHaveLength(6);
  });
  it("needs words only for a correction or an open request", () => {
    expect(parseRequest({ kind: "ACCESS" })).toEqual({ kind: "ACCESS", message: null });
    expect(parseRequest({ kind: "PHOTOS_DELETION", message: "   " })).toEqual({ kind: "PHOTOS_DELETION", message: null });
    expect(parseRequest({ kind: "CORRECTION", message: "  Meu nome está errado  " })).toEqual({ kind: "CORRECTION", message: "Meu nome está errado" });
    expect(issues(() => parseRequest({ kind: "CORRECTION" }))).toContain("REQUEST_MESSAGE_REQUIRED");
    expect(issues(() => parseRequest({ kind: "OTHER", message: "  " }))).toContain("REQUEST_MESSAGE_REQUIRED");
  });
  it("refuses a kind that does not exist, a long text and fields it does not know", () => {
    expect(() => parseRequest({ kind: "SELL_MY_DATA" })).toThrow(ZodError);
    expect(() => parseRequest({ kind: "ACCESS", message: "a".repeat(1001) })).toThrow(ZodError);
    expect(parseRequest({ kind: "ACCESS", message: "a".repeat(1000) }).message).toHaveLength(1000);
    // The student, the organization and the deadline come from the server, never from the payload.
    expect(() => parseRequest({ kind: "ACCESS", studentId: "st-2" })).toThrow(ZodError);
    expect(() => parseRequest({ kind: "ACCESS", dueAt: "2030-01-01" })).toThrow(ZodError);
  });
});

describe("what the professional answers", () => {
  it("accepts a plain fulfilment and asks for the reason of anything else", () => {
    expect(parseAnswer({ outcome: "FULFILLED" })).toEqual({ outcome: "FULFILLED", note: null });
    expect(parseAnswer({ outcome: "FULFILLED", note: " Enviei por e-mail " })).toEqual({ outcome: "FULFILLED", note: "Enviei por e-mail" });
    expect(issues(() => parseAnswer({ outcome: "DECLINED" }))).toContain("ANSWER_NOTE_REQUIRED");
    expect(issues(() => parseAnswer({ outcome: "PARTIALLY_FULFILLED", note: "  " }))).toContain("ANSWER_NOTE_REQUIRED");
    expect(parseAnswer({ outcome: "DECLINED", note: "A lei manda manter o registro por 5 anos." }).note).toMatch(/5 anos/);
  });
  it("cannot answer in the student's name or with an outcome the form does not offer", () => {
    expect(ANSWER_OUTCOMES).toEqual(["FULFILLED", "PARTIALLY_FULFILLED", "DECLINED"]);
    expect(() => parseAnswer({ outcome: "CANCELLED", note: "x" })).toThrow(ZodError);
    expect(() => parseAnswer({ outcome: "FULFILLED", note: "a".repeat(2001) })).toThrow(ZodError);
    expect(() => parseAnswer({ outcome: "FULFILLED", decidedBy: "someone" })).toThrow(ZodError);
  });
  it("names who cancelled from each side", () => {
    expect(outcomeLabel("CANCELLED", "student")).toBe("Cancelado por você");
    expect(outcomeLabel("CANCELLED", "professional")).toBe("Cancelado pelo aluno");
    expect(outcomeLabel("DECLINED", "student")).toBe(OUTCOME_LABEL.DECLINED);
    expect(outcomeLabel("FULFILLED", "professional")).toBe("Atendido");
  });
});
