import { describe, expect, it } from "vitest";
import type { Flag, Issue } from "../src/modules/prescricao/motor/types";
import {
  ALERTS_PAGE,
  alertPhases,
  alertRows,
  filterAlerts,
  filterByText,
  pickItemKey,
  pickSlot,
  pickTab,
  searchKey,
  sessionPillLabel,
  sessionPillShort,
  sessionsPerPhase,
  totalWeeks,
} from "../src/modules/prescricao/automatica/workbench";

const flag = (over: Partial<Flag>): Flag => ({ code: "F", severity: "WARNING", source: "ASSESSMENT", message: "Soma das dobras: 76 mm", ...over });
const issue = (over: Partial<Issue>): Issue => ({ severity: "WARNING", code: "NO_TARGETS", path: "phases.3", message: "Fase sem alvos", stage: "SELECTION", ...over });

describe("the workbench's selection (Figma RX-01, RX-04)", () => {
  it("reads the tab from the address and falls back to the sessions", () => {
    expect(pickTab("alertas")).toBe("alertas");
    expect(pickTab("regras")).toBe("regras");
    expect(pickTab("outra")).toBe("sessoes");
    expect(pickTab(undefined)).toBe("sessoes");
  });

  it("keeps the session in the week and restores the item, or takes the first", () => {
    const occ = [
      { week: 1, slot: 2 },
      { week: 1, slot: 1 },
      { week: 2, slot: 5 },
    ];
    expect(pickSlot(occ, 1, "2")).toBe(2);
    expect(pickSlot(occ, 1, "5")).toBe(1);
    expect(pickSlot(occ, 1, undefined)).toBe(1);
    expect(pickSlot(occ, 3, "1")).toBeNull();
    const items = [{ slotKey: "a" }, { slotKey: "b" }];
    expect(pickItemKey(items, "b")).toBe("b");
    expect(pickItemKey(items, "zzz")).toBe("a");
    expect(pickItemKey([], "a")).toBeNull();
  });

  it("names the sessions and counts the plan from the phases, never from a sample", () => {
    expect(sessionPillLabel({ slot: 1, label: "A" })).toBe("Sessão 1 · Treino A");
    expect(sessionPillShort({ slot: 3, label: "B" })).toBe("S3 · B");
    expect(totalWeeks([{ weeks: 4 }, { weeks: 4 }, { weeks: 4 }])).toBe(12);
    expect(sessionsPerPhase([{ weeks: 4, sessionsPerWeek: 4 }, { weeks: 4, sessionsPerWeek: 4 }])).toBe(16);
    // Phases that disagree have no single number to show.
    expect(sessionsPerPhase([{ weeks: 4, sessionsPerWeek: 4 }, { weeks: 3, sessionsPerWeek: 3 }])).toBeNull();
    expect(sessionsPerPhase([])).toBeNull();
  });
});

describe("the alerts table (Figma RX-02, RX-07)", () => {
  const rows = alertRows(
    [flag({ code: "I", severity: "INFO", message: "IMC: 25,88" }), flag({ code: "W", message: "Soma das dobras" }), flag({ code: "D", message: "Dor no ombro", decided: { kind: "ACKNOWLEDGE" } })],
    [issue({ severity: "INFO", code: "X", path: "p.1", message: "Informação do motor", phaseIndex: 1 }), issue({ message: "Fase sem alvos", phaseIndex: 3 })],
  );

  it("orders what needs a look first, then the decided ones, then the information", () => {
    expect(rows.map((r) => r.message)).toEqual(["Soma das dobras", "Fase sem alvos", "Dor no ombro", "IMC: 25,88", "Informação do motor"]);
    expect(rows.map((r) => r.statusText)).toEqual(["Validar", "Atenção", "Decidido", "Informação", "Informação"]);
    expect(rows.filter((r) => r.needsReview)).toHaveLength(2);
  });

  it("says where each record comes from, with real labels", () => {
    expect(rows.find((r) => r.message === "Soma das dobras")?.origin).toBe("Avaliação");
    expect(rows.find((r) => r.message === "Fase sem alvos")?.origin).toBe("Motor · fase 3");
  });

  it("filters by what needs review, by information, by phase and by text without accents", () => {
    expect(filterAlerts(rows, { kind: "ALL" }, "")).toHaveLength(5);
    expect(filterAlerts(rows, { kind: "REVIEW" }, "").map((r) => r.message)).toEqual(["Soma das dobras", "Fase sem alvos"]);
    expect(filterAlerts(rows, { kind: "INFO" }, "")).toHaveLength(2);
    expect(filterAlerts(rows, { kind: "PHASE", phaseIndex: 3 }, "").map((r) => r.message)).toEqual(["Fase sem alvos"]);
    expect(filterAlerts(rows, { kind: "ALL" }, "AVALIACAO").map((r) => r.message)).toEqual(["Soma das dobras", "Dor no ombro", "IMC: 25,88"]);
    expect(alertPhases(rows)).toEqual([1, 3]);
    expect(ALERTS_PAGE).toBeGreaterThan(0);
  });

  it("gives an empty list for a proposal with no alerts (no placeholder row)", () => {
    expect(alertRows([], [])).toEqual([]);
  });

  it("searches any list by text", () => {
    expect(searchKey("  Avaliação ")).toBe("avaliacao");
    expect(filterByText(["Premissa um", "Outra"], "PREMISSA", (t) => t)).toEqual(["Premissa um"]);
    expect(filterByText(["a", "b"], "", (t) => t)).toEqual(["a", "b"]);
  });
});
