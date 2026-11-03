import type { AssessmentSnapshot, MetricRow } from "@/db/assessments";
import {
  METRIC_TYPES,
  MOVEMENT_GRADES,
  MOVEMENT_TESTS,
  POSTURE_VIEWS,
  SCREENING_ITEMS,
  SIDE_LABEL,
} from "./contracts";
import { formatCalendarDate } from "@/modules/training/format";

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

/** The least horizontal distance between two values of the same day (slice 0.84), in units of the drawing (360 wide). */
export const SAME_DAY_GAP = 14;

/**
 * Where each point goes inside a plot area. X follows the real distance in days between the
 * assessments, so two close dates are close on the chart. The y axis is padded and snapped to
 * round guides, so the line never touches the frame and the ticks are numbers a person would
 * write. A flat series is not stretched.
 *
 * Two values of the same day (two assessments recorded on one date; slice 0.84) are never drawn on top of each other: the caller gives them in
 * the order they were recorded, and they are spread side by side around their day, SAME_DAY_GAP apart, inside the frame. The same gap keeps
 * them clear of the value just before and just after the run, even when that value is of a neighbouring day. When every value is of one day,
 * they are spread over the whole width. X never goes back: a value is never left of the one recorded before it. When the gaps do not fit in the
 * width, they shrink together.
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
  const right = area.left + area.width;
  const xs = points.map((point) => (span === 0 ? area.left + area.width / 2 : area.left + ((dayOf(point.assessedOn) - first) / span) * area.width));
  if (span === 0 && points.length > 1) {
    points.forEach((_, index) => (xs[index] = area.left + (index / (points.length - 1)) * area.width));
  } else if (points.length > 1) {
    // A value shares its day with another: it and its neighbours on either side keep SAME_DAY_GAP. Other neighbours keep the distance in days.
    const shared = points.map(
      (point, index) => points[index - 1]?.assessedOn === point.assessedOn || points[index + 1]?.assessedOn === point.assessedOn,
    );
    const need = points.map((_, index): number => (index > 0 && (shared[index] || shared[index - 1]) ? SAME_DAY_GAP : 0));
    const total = need.reduce((sum, gap) => sum + gap, 0);
    const scale = total > area.width ? area.width / total : 1;
    // Each run of one day starts centred on its day.
    for (let start = 0; start < points.length; ) {
      let end = start;
      while (end + 1 < points.length && points[end + 1].assessedOn === points[start].assessedOn) end += 1;
      const width = need.slice(start + 1, end + 1).reduce((sum, gap) => sum + gap * scale, 0);
      for (let index = start; index <= end; index += 1) xs[index] -= width / 2;
      start = end + 1;
    }
    // Pushed right to keep the gaps, then pulled back inside the frame; the gaps fit, so both bounds hold.
    xs[0] = Math.max(xs[0], area.left);
    for (let index = 1; index < xs.length; index += 1) xs[index] = Math.max(xs[index], xs[index - 1] + need[index] * scale);
    xs[xs.length - 1] = Math.min(xs[xs.length - 1], right);
    for (let index = xs.length - 2; index >= 0; index -= 1) xs[index] = Math.min(xs[index], xs[index + 1] - need[index + 1] * scale);
    // Only rounding can leave one a hair outside the frame.
    for (let index = 0; index < xs.length; index += 1) xs[index] = Math.min(Math.max(xs[index], area.left), right);
  }
  return {
    min,
    max,
    points: points.map((point, index) => ({ index, x: xs[index], y: yOf(point.value) })),
    ticks,
  };
}

const clock = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" });
const calendarDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const shortDay = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

/** The place of a value among the assessments of its day. */
const nth = (order: number, total: number, compact = false) => (compact ? `(${order}ª)` : `(${order}ª de ${total} no dia)`);

/**
 * How each value's date is written (slice 0.84). A date alone ("03/11/2026") when no other value shares it; when two or more share it, the time
 * each was recorded, in the app's clock (America/Sao_Paulo): "03/11/2026 14:05". If it was recorded on another day than the date of the
 * assessment, that day is written too ("03/11/2026, registrada 04/11/2026 09:10"), so a time is never read as of the wrong day. Without a
 * recorded time, the values of one date are numbered in the order given ("03/11/2026 (1ª de 2 no dia)": the place among the assessments of that day,
 * so a series with one value does not read as "value 1 of 2"). `compact` (the ends of the chart's axis)
 * numbers them instead of writing the other day, in short ("03/11/2026 (2ª)"), so the two ends of the axis fit side by side. Two recorded in the same minute get their number too ("03/11/2026 11:09 (2ª de 2 no dia)"), so no two
 * labels of a date are equal.
 */
export function dateLabels(points: ReadonlyArray<{ assessedOn: string; recordedAt?: string | null }>, compact = false): string[] {
  const counts = new Map<string, number>();
  for (const point of points) counts.set(point.assessedOn, (counts.get(point.assessedOn) ?? 0) + 1);
  const seen = new Map<string, number>();
  const positions: number[] = [];
  const labels = points.map((point) => {
    const date = formatCalendarDate(point.assessedOn);
    const total = counts.get(point.assessedOn) ?? 1;
    const order = (seen.get(point.assessedOn) ?? 0) + 1;
    seen.set(point.assessedOn, order);
    positions.push(order);
    if (total === 1) return date;
    const at = point.recordedAt ? new Date(point.recordedAt) : null;
    const sameDay = at !== null && !Number.isNaN(at.getTime()) && calendarDay.format(at) === point.assessedOn;
    if (at === null || Number.isNaN(at.getTime()) || (compact && !sameDay)) return `${date} ${nth(order, total, compact)}`;
    return sameDay ? `${date} ${clock.format(at)}` : `${date}, registrada ${shortDay.format(at)} ${clock.format(at)}`;
  });
  const repeated = new Map<string, number>();
  for (const label of labels) repeated.set(label, (repeated.get(label) ?? 0) + 1);
  return labels.map((label, index) =>
    (repeated.get(label) ?? 1) === 1 || label.endsWith(")") ? label : `${label} ${nth(positions[index], counts.get(points[index].assessedOn) ?? 1, compact)}`,
  );
}
