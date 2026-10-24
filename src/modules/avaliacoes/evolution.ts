import type { AssessmentSnapshot, MetricRow } from "@/db/assessments";
import {
  METRIC_TYPES,
  MOVEMENT_GRADES,
  MOVEMENT_TESTS,
  POSTURE_VIEWS,
  SCREENING_ITEMS,
  SIDE_LABEL,
} from "./contracts";

/**
 * Reading the history of a student's assessments: the same measure over time, and what differs
 * between two assessments. It describes and never judges: a value going up or down is not
 * called better or worse, and a finding that is no longer marked is not called resolved.
 */
export interface SeriesPoint {
  assessmentId: string;
  assessedOn: string;
  valueText: string;
  valueNumber: number | null;
}
export interface MetricSeries {
  key: string;
  name: string;
  unit: string | null;
  side: MetricRow["side"];
  points: SeriesPoint[];
  /** The points that can be drawn: those typed as a plain number. */
  numeric: SeriesPoint[];
}

const norm = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * One series per measure: the same type, name (ignoring case and accents), side and unit.
 * Standard measures come first, in the order of the master document, then the professional's own.
 */
export function buildSeries(history: AssessmentSnapshot[]): MetricSeries[] {
  const order = Object.keys(METRIC_TYPES);
  const series = new Map<string, MetricSeries & { rank: number; seen: number }>();
  for (const assessment of history) {
    for (const metric of assessment.metrics) {
      const key = [metric.metricType, norm(metric.name), metric.side ?? "", norm(metric.unit ?? "")].join("|");
      let entry = series.get(key);
      if (!entry) {
        const rank = order.indexOf(metric.metricType);
        entry = {
          key,
          name: metric.name,
          unit: metric.unit,
          side: metric.side,
          points: [],
          numeric: [],
          rank: rank === -1 ? order.length : rank,
          seen: series.size,
        };
        series.set(key, entry);
      }
      const point = {
        assessmentId: assessment.id,
        assessedOn: assessment.assessedOn,
        valueText: metric.valueText,
        valueNumber: metric.valueNumber,
      };
      entry.points.push(point);
      if (metric.valueNumber !== null) entry.numeric.push(point);
    }
  }
  return [...series.values()]
    .sort((a, b) => a.rank - b.rank || a.seen - b.seen)
    .map((entry) => ({
      key: entry.key,
      name: entry.name,
      unit: entry.unit,
      side: entry.side,
      points: entry.points,
      numeric: entry.numeric,
    }));
}

export interface Change {
  area: "SCREENING" | "POSTURE" | "MOVEMENT";
  /** What differs, in the words of the master document. */
  label: string;
  /** "Marcado agora", "Não marcado agora" or a change of result. */
  text: string;
}

const gradeLabel = (grade: string) =>
  MOVEMENT_GRADES.find((item) => item.key === grade)?.label ?? grade;

/** What differs between two assessments of the same student, nothing else. */
export function changesBetween(before: AssessmentSnapshot, after: AssessmentSnapshot): Change[] {
  const changes: Change[] = [];
  for (const item of SCREENING_ITEMS) {
    if (before.flags[item.key] !== after.flags[item.key])
      changes.push({
        area: "SCREENING",
        label: item.label,
        text: after.flags[item.key] ? "Marcado agora" : "Não marcado agora",
      });
  }
  for (const view of POSTURE_VIEWS) {
    for (const item of view.items) {
      const was = before.posture.findings.includes(item.key);
      const is = after.posture.findings.includes(item.key);
      if (was !== is)
        changes.push({
          area: "POSTURE",
          label: `${view.label}: ${item.label}`,
          text: is ? "Marcado agora" : "Não marcado agora",
        });
    }
  }
  for (const test of MOVEMENT_TESTS) {
    // No row means the test was not assessed.
    const was = before.movement.find((row) => row.test === test.key)?.grade ?? "NOT_ASSESSED";
    const is = after.movement.find((row) => row.test === test.key)?.grade ?? "NOT_ASSESSED";
    if (was !== is)
      changes.push({
        area: "MOVEMENT",
        label: test.label,
        text: `De ${gradeLabel(was).toLowerCase()} para ${gradeLabel(is).toLowerCase()}`,
      });
  }
  return changes;
}

/** Label of a series, with the side when it has one. */
export const seriesTitle = (series: Pick<MetricSeries, "name" | "side">) =>
  series.side ? `${series.name} (${SIDE_LABEL[series.side].toLowerCase()})` : series.name;

export interface ChartPoint {
  index: number;
  x: number;
  y: number;
}
export interface ChartGeometry {
  points: ChartPoint[];
  /** Y positions and values of the horizontal guides, at round numbers. */
  ticks: Array<{ y: number; value: number }>;
  min: number;
  max: number;
}

const DAY = 86_400_000;
const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

/** A step of 1, 2 or 5 times a power of ten, so the guides read as round numbers. */
export function niceStep(raw: number): number {
  const exponent = Math.floor(Math.log10(raw));
  const fraction = raw / 10 ** exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

/**
 * Where each point goes inside a plot area. X follows the real distance in days between the
 * assessments, so two close dates are close on the chart. The y axis is padded and snapped to
 * round guides, so the line never touches the frame and the ticks are numbers a person would
 * write. A flat series is not stretched.
 */
export function chartGeometry(
  points: Array<{ assessedOn: string; value: number }>,
  area: { left: number; top: number; width: number; height: number },
): ChartGeometry {
  const values = points.map((point) => point.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = lo === hi ? Math.max(Math.abs(lo) * 0.1, 1) : (hi - lo) * 0.15;
  const step = niceStep((hi + pad - (lo - pad)) / 3);
  const min = Math.floor((lo - pad) / step) * step;
  const max = Math.ceil((hi + pad) / step) * step;
  const first = dayOf(points[0].assessedOn);
  const span = dayOf(points[points.length - 1].assessedOn) - first;
  const yOf = (value: number) => area.top + area.height - ((value - min) / (max - min)) * area.height;
  const ticks: ChartGeometry["ticks"] = [];
  for (let value = max, guard = 0; value >= min - step / 2 && guard < 12; value -= step, guard += 1) {
    const rounded = Math.round(value * 1e6) / 1e6;
    ticks.push({ y: yOf(rounded), value: rounded });
  }
  return {
    min,
    max,
    points: points.map((point, index) => ({
      index,
      x: area.left + (span === 0 ? area.width / 2 : ((dayOf(point.assessedOn) - first) / span) * area.width),
      y: yOf(point.value),
    })),
    ticks,
  };
}
