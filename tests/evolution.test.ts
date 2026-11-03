import { describe, expect, it } from "vitest";
import type { AssessmentSnapshot } from "@/db/assessments";
import { SAME_DAY_GAP, buildSeries, changesBetween, chartGeometry, dateLabels, niceStep, seriesTitle } from "@/modules/avaliacoes/evolution";

const noFlags = {
  exertionPain: false, dizzinessFainting: false, chestPain: false,
  injuryInTreatment: false, recentSurgery: false, medicalRestriction: false,
};
const metric = (metricType: string, name: string, valueText: string, extra: Record<string, unknown> = {}) => ({
  metricType, name, valueText, valueNumber: /^-?\d+([.,]\d+)?$/.test(valueText) ? Number(valueText.replace(",", ".")) : null,
  unit: null, side: null as "LEFT" | "RIGHT" | "BOTH" | null, notes: null, ...extra,
});
const snapshot = (id: string, assessedOn: string, extra: Partial<AssessmentSnapshot> = {}): AssessmentSnapshot => ({
  id, assessedOn, recordedAt: null, kind: "REASSESSMENT", formatVersion: null, riskStatus: "CLEAR", reviewed: false, flags: { ...noFlags },
  posture: { findings: [], notes: null }, movement: [], metrics: [], photos: [], results: [], ...extra,
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
    // Slice 0.84: every value of one day, spread over the width in the order given, never on top of each other.
    expect(sameDay.points.map((p) => p.x)).toEqual([40, 340]);
    const zero = chartGeometry([{ assessedOn: "2026-01-01", value: 0 }, { assessedOn: "2026-02-01", value: 0 }], area);
    expect(zero.points.every((p) => Number.isFinite(p.y))).toBe(true);
  });
});

describe("two values of the same day (slice 0.84)", () => {
  const area = { left: 40, top: 10, width: 300, height: 100 };
  it("draws them side by side around their day, in the order given, inside the frame, never going back", () => {
    const g = chartGeometry(
      [{ assessedOn: "2026-01-01", value: 70 }, { assessedOn: "2026-03-01", value: 68 }, { assessedOn: "2026-03-01", value: 66 }, { assessedOn: "2026-03-02", value: 65 }],
      area,
    );
    const xs = g.points.map((p) => p.x);
    expect(xs[0]).toBe(40);
    expect(xs[2] - xs[1]).toBeCloseTo(SAME_DAY_GAP, 5);
    // Around the day of 01/03 (59 of 60 days), pushed back inside the frame.
    expect(xs[2]).toBeLessThanOrEqual(340);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    expect(new Set(xs.slice(0, 3)).size).toBe(3);
    // The y still follows the values: the second of the day is drawn at its own value.
    expect(g.points[2].y).toBeGreaterThan(g.points[1].y);
    // At the start of the frame too.
    const early = chartGeometry([{ assessedOn: "2026-01-01", value: 1 }, { assessedOn: "2026-01-01", value: 2 }, { assessedOn: "2026-06-01", value: 3 }], area);
    expect(early.points.map((p) => p.x).slice(0, 2)).toEqual([40, 40 + SAME_DAY_GAP]);
    // Three of one day in the middle: centred on the day.
    const middle = chartGeometry(
      [{ assessedOn: "2026-01-01", value: 1 }, ...[2, 3, 4].map((value) => ({ assessedOn: "2026-01-11", value })), { assessedOn: "2026-01-21", value: 5 }],
      area,
    );
    expect(middle.points.slice(1, 4).map((p) => p.x)).toEqual([190 - SAME_DAY_GAP, 190, 190 + SAME_DAY_GAP]);
  });

  it("keeps a run of one day clear of a value of the day before or after, also when a year makes a day less than one unit", () => {
    const chart = { left: 46, top: 14, width: 296, height: 88 };
    const xsOf = (dates: string[]) => chartGeometry(dates.map((assessedOn, value) => ({ assessedOn, value })), chart).points.map((p) => p.x);
    const apart = (xs: number[]) => {
      for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(SAME_DAY_GAP - 1e-9);
      expect(xs[0]).toBeGreaterThanOrEqual(46);
      expect(xs[xs.length - 1]).toBeLessThanOrEqual(342 + 1e-9);
    };
    // One the day before a pair (before the fix: 46, 46, 60, 342).
    const a = xsOf(["2025-11-03", "2025-11-04", "2025-11-04", "2026-11-03"]);
    apart(a);
    expect(a[0]).toBe(46);
    expect(a[3]).toBe(342);
    // Two pairs on following days (before the fix the second of 01/06 and the first of 02/06 shared x).
    const b = xsOf(["2025-11-03", "2026-06-01", "2026-06-01", "2026-06-02", "2026-06-02", "2026-11-03"]);
    apart(b);
    // A pair the day before the last value, against the right edge.
    apart(xsOf(["2025-11-03", "2026-11-02", "2026-11-02", "2026-11-03"]));
    // Values of different days, none shared, still follow the days (unchanged from 0.82).
    expect(xsOf(["2026-01-01", "2026-01-02", "2026-12-31"]).slice(0, 2)).toEqual([46, 46 + 296 / 364]);
    // More than fit: the gaps shrink together, never below zero, inside the frame.
    const many = xsOf(Array.from({ length: 30 }, () => "2026-03-01").concat("2026-03-02"));
    for (let i = 1; i < many.length; i += 1) expect(many[i]).toBeGreaterThan(many[i - 1]);
    expect(many[0]).toBeGreaterThanOrEqual(46);
    expect(many[many.length - 1]).toBeLessThanOrEqual(342 + 1e-9);
  });

  it("dates a value with the time it was recorded only when another shares its date", () => {
    expect(
      dateLabels([
        { assessedOn: "2026-11-02", recordedAt: "2026-11-02T13:00:00.000Z" },
        { assessedOn: "2026-11-03", recordedAt: "2026-11-03T13:05:00.000Z" },
        { assessedOn: "2026-11-03", recordedAt: "2026-11-03T20:40:00.000Z" },
      ]),
    ).toEqual(["02/11/2026", "03/11/2026 10:05", "03/11/2026 17:40"]);
    // Recorded on another day than the date of the assessment (an amendment, a draft finished later): that day is written too.
    expect(
      dateLabels([
        { assessedOn: "2026-11-03", recordedAt: "2026-11-03T13:05:00.000Z" },
        { assessedOn: "2026-11-03", recordedAt: "2026-11-04T12:10:00.000Z" },
      ]),
    ).toEqual(["03/11/2026 10:05", "03/11/2026, registrada 04/11/2026 09:10"]);
    // On the axis, numbered instead; without a recorded time, numbered in the order given.
    expect(
      dateLabels(
        [
          { assessedOn: "2026-11-03", recordedAt: "2026-11-03T13:05:00.000Z" },
          { assessedOn: "2026-11-03", recordedAt: "2026-11-04T12:10:00.000Z" },
        ],
        true,
      ),
    ).toEqual(["03/11/2026 10:05", "03/11/2026 (2ª)"]);
    expect(dateLabels([{ assessedOn: "2026-11-03" }, { assessedOn: "2026-11-03", recordedAt: null }])).toEqual(["03/11/2026 (1ª de 2 no dia)", "03/11/2026 (2ª de 2 no dia)"]);
    expect(dateLabels([{ assessedOn: "2026-11-03", recordedAt: "2026-11-03T13:05:00.000Z" }])).toEqual(["03/11/2026"]);
    // Two recorded in the same minute are numbered, never two equal labels.
    expect(
      dateLabels([
        { assessedOn: "2026-11-03", recordedAt: "2026-11-03T13:05:10.000Z" },
        { assessedOn: "2026-11-03", recordedAt: "2026-11-03T13:05:50.000Z" },
        { assessedOn: "2026-11-03", recordedAt: "2026-11-03T15:00:00.000Z" },
      ]),
    ).toEqual(["03/11/2026 10:05 (1ª de 3 no dia)", "03/11/2026 10:05 (2ª de 3 no dia)", "03/11/2026 12:00"]);
    // On the axis the number is short, so both ends fit.
    expect(
      dateLabels(
        [
          { assessedOn: "2026-11-03", recordedAt: "2026-11-03T13:05:10.000Z" },
          { assessedOn: "2026-11-03", recordedAt: "2026-11-03T13:05:50.000Z" },
        ],
        true,
      ),
    ).toEqual(["03/11/2026 10:05 (1ª)", "03/11/2026 10:05 (2ª)"]);
  });
});
