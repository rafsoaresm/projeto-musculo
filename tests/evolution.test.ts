import { describe, expect, it } from "vitest";
import type { AssessmentSnapshot } from "@/db/assessments";
import { buildSeries, changesBetween, chartGeometry, niceStep, seriesTitle } from "@/modules/avaliacoes/evolution";

const noFlags = {
  exertionPain: false, dizzinessFainting: false, chestPain: false,
  injuryInTreatment: false, recentSurgery: false, medicalRestriction: false,
};
const metric = (metricType: string, name: string, valueText: string, extra: Record<string, unknown> = {}) => ({
  metricType, name, valueText, valueNumber: /^-?\d+([.,]\d+)?$/.test(valueText) ? Number(valueText.replace(",", ".")) : null,
  unit: null, side: null as "LEFT" | "RIGHT" | "BOTH" | null, notes: null, ...extra,
});
const snapshot = (id: string, assessedOn: string, extra: Partial<AssessmentSnapshot> = {}): AssessmentSnapshot => ({
  id, assessedOn, kind: "REASSESSMENT", riskStatus: "CLEAR", reviewed: false, flags: { ...noFlags },
  posture: { findings: [], notes: null }, movement: [], metrics: [], photos: [], ...extra,
});

describe("series of measures over time", () => {
  it("groups the same measure across assessments and keeps the document's order", () => {
    const history = [
      snapshot("a1", "2026-01-10", {
        metrics: [
          metric("CUSTOM", "Teste de sentar e levantar", "12 reps"),
          metric("WAIST", "Cintura", "90", { unit: "cm" }),
          metric("RESTING_HEART_RATE", "Frequência cardíaca de repouso", "70", { unit: "bpm" }),
        ],
      }),
      snapshot("a2", "2026-03-10", {
        metrics: [
          metric("RESTING_HEART_RATE", "Frequência cardíaca de repouso", "66", { unit: "bpm" }),
          metric("WAIST", "Cintura", "88,5", { unit: "cm" }),
          metric("CUSTOM", "teste de SENTAR e levantar", "14 reps"),
        ],
      }),
    ];
    const series = buildSeries(history);
    // Standard measures first, in the order of the document, then the professional's own.
    expect(series.map((item) => item.name)).toEqual(["Frequência cardíaca de repouso", "Cintura", "Teste de sentar e levantar"]);
    expect(series[0].points.map((p) => [p.assessedOn, p.valueText])).toEqual([["2026-01-10", "70"], ["2026-03-10", "66"]]);
    expect(series[1].numeric.map((p) => p.valueNumber)).toEqual([90, 88.5]);
    // Case and accents do not split a measure; a value that is not a plain number is not drawn.
    expect(series[2].points).toHaveLength(2);
    expect(series[2].numeric).toHaveLength(0);
  });

  it("does not mix sides or units of the same measure", () => {
    const history = [
      snapshot("a1", "2026-01-10", { metrics: [metric("CUSTOM", "Força de preensão", "30", { side: "LEFT", unit: "kg" }), metric("CUSTOM", "Força de preensão", "34", { side: "RIGHT", unit: "kg" })] }),
      snapshot("a2", "2026-02-10", { metrics: [metric("CUSTOM", "Força de preensão", "32", { side: "LEFT", unit: "kg" }), metric("CUSTOM", "Força de preensão", "70", { side: "LEFT", unit: "lb" })] }),
    ];
    const series = buildSeries(history);
    expect(series).toHaveLength(3);
    expect(series.map((item) => seriesTitle(item))).toEqual(["Força de preensão (esquerdo)", "Força de preensão (direito)", "Força de preensão (esquerdo)"]);
    expect(series.map((item) => item.unit)).toEqual(["kg", "kg", "lb"]);
    expect(series[0].points.map((p) => p.valueText)).toEqual(["30", "32"]);
  });

  it("is empty without metrics", () => {
    expect(buildSeries([])).toEqual([]);
    expect(buildSeries([snapshot("a1", "2026-01-10")])).toEqual([]);
  });
});

describe("what changed between two assessments", () => {
  it("describes screening, posture and movement differences in the words of the document, and nothing else", () => {
    const before = snapshot("a1", "2026-01-10", {
      flags: { ...noFlags, exertionPain: true, recentSurgery: true },
      posture: { findings: ["ANTERIOR.KNEE_VALGUS", "LATERAL.FORWARD_HEAD"], notes: "antes" },
      movement: [{ test: "SQUAT", grade: "MILD", notes: null }, { test: "PUSH", grade: "STOPPED_BY_PAIN", notes: "ombro" }],
      metrics: [metric("WAIST", "Cintura", "90")],
    });
    const after = snapshot("a2", "2026-03-10", {
      flags: { ...noFlags, exertionPain: true, chestPain: true },
      posture: { findings: ["LATERAL.FORWARD_HEAD", "POSTERIOR.OTHER_VISUAL"], notes: "depois" },
      movement: [{ test: "SQUAT", grade: "NO_LIMITATION", notes: null }, { test: "PULL", grade: "MODERATE", notes: null }],
      metrics: [metric("WAIST", "Cintura", "85")],
    });
    expect(changesBetween(before, after).map((c) => `${c.area} | ${c.label} | ${c.text}`)).toEqual([
      "SCREENING | Dor torácica relatada | Marcado agora",
      "SCREENING | Pós-operatório recente | Não marcado agora",
      "POSTURE | Vista anterior: Valgo aparente de joelhos | Não marcado agora",
      "POSTURE | Vista posterior: Outro achado visual | Marcado agora",
      "MOVEMENT | Agachamento | De limitação leve para sem limitação observada",
      "MOVEMENT | Empurrar | De interrompido por dor/desconforto para não avaliado",
      "MOVEMENT | Puxar | De não avaliado para limitação moderada",
    ]);
  });

  it("reports nothing when nothing differs, and never uses words that judge", () => {
    const same = snapshot("a1", "2026-01-10", { flags: { ...noFlags, chestPain: true }, posture: { findings: ["LATERAL.KYPHOSIS"], notes: null } });
    expect(changesBetween(same, snapshot("a2", "2026-02-10", { flags: { ...noFlags, chestPain: true }, posture: { findings: ["LATERAL.KYPHOSIS"], notes: "x" } }))).toEqual([]);
    const all = changesBetween(snapshot("a1", "2026-01-10", { flags: { ...noFlags, exertionPain: true } }), snapshot("a2", "2026-02-10", { movement: [{ test: "SQUAT", grade: "MODERATE", notes: null }] }));
    expect(JSON.stringify(all)).not.toMatch(/melhor|pior|resolvid|curad|agrav|piora|melhora/i);
  });
});

describe("chart geometry", () => {
  const area = { left: 40, top: 10, width: 300, height: 100 };
  it("places points by the real distance between dates and keeps them inside the frame", () => {
    const g = chartGeometry(
      [{ assessedOn: "2026-01-01", value: 70 }, { assessedOn: "2026-01-11", value: 68 }, { assessedOn: "2026-02-10", value: 64 }],
      area,
    );
    expect(g.points[0].x).toBe(40);
    expect(g.points[2].x).toBe(340);
    // 10 of 40 days: a quarter of the width, not a third.
    expect(g.points[1].x).toBeCloseTo(40 + 300 * (10 / 40), 5);
    for (const point of g.points) {
      expect(point.y).toBeGreaterThan(area.top);
      expect(point.y).toBeLessThan(area.top + area.height);
    }
    // Higher values are higher on the screen.
    expect(g.points[0].y).toBeLessThan(g.points[2].y);
    // Guides at round numbers (1, 2 or 5 times a power of ten), from the top down, framing the data.
    expect(g.ticks.length).toBeGreaterThanOrEqual(3);
    expect(g.ticks.length).toBeLessThanOrEqual(7);
    expect(g.ticks[0].value).toBeGreaterThanOrEqual(70);
    expect(g.ticks[g.ticks.length - 1].value).toBeLessThanOrEqual(64);
    const steps = g.ticks.slice(1).map((tick, i) => Math.round((g.ticks[i].value - tick.value) * 1e6) / 1e6);
    expect(new Set(steps).size).toBe(1);
    expect([1, 2, 5]).toContain(Number(String(steps[0]).replace(/[0.]/g, "").replace(/^0+/, "")[0] ?? 1));
    for (const tick of g.ticks) expect(Number.isInteger(tick.value * 10)).toBe(true);
  });

  it("picks round steps", () => {
    expect([niceStep(0.03), niceStep(0.7), niceStep(1.3), niceStep(4), niceStep(7), niceStep(23), niceStep(260)]).toEqual([0.05, 1, 2, 5, 10, 50, 500]);
  });

  it("does not stretch or divide by zero for a flat series or a single date", () => {
    const flat = chartGeometry([{ assessedOn: "2026-01-01", value: 5 }, { assessedOn: "2026-02-01", value: 5 }], area);
    expect(flat.points[0].y).toBe(flat.points[1].y);
    expect(flat.points[0].y).toBeGreaterThan(10);
    expect(flat.points[0].y).toBeLessThan(110);
    const sameDay = chartGeometry([{ assessedOn: "2026-01-01", value: 1 }, { assessedOn: "2026-01-01", value: 2 }], area);
    expect(sameDay.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    const zero = chartGeometry([{ assessedOn: "2026-01-01", value: 0 }, { assessedOn: "2026-02-01", value: 0 }], area);
    expect(zero.points.every((p) => Number.isFinite(p.y))).toBe(true);
  });
});
