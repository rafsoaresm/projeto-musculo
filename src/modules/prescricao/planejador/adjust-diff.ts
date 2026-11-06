/**
 * The before/after of an assisted adjustment (design V4 §6.5, sub-stage 4.3a). Pure: two `EngineResult`s in, a small serialisable
 * `AdjustmentDiff` out. Only what CHANGED is listed: the items (grouped, so "Puxada vertical -> Puxada articulada, semanas 1-4" is one
 * row), the weekly weighted volume per muscle, the estimated minutes per session, and the audit findings introduced or resolved.
 *
 * The diff carries exercise NAMES for the professional's screen; it is stored with the student's data (deletable with it) and it
 * never goes back to a provider.
 */
import { doseTextOf, type ConstraintCheck } from "@/modules/prescricao/motor/adjust";
import type { AuditFinding, EngineResult, ItemOut, OccurrenceOut } from "@/modules/prescricao/motor/types";
import { ADJUST_DIFF_MAX_VOLUME_ROWS } from "./adjust";

export interface ItemBrief {
  exerciseName: string;
  doseText: string;
  /** The item's origin in the proposal: ENGINE | SUBSTITUTED | PRESERVED | LOCKED. */
  provenance: ItemOut["origin"];
}
export interface AuditBrief {
  key: string;
  code: string;
  severity: AuditFinding["severity"];
  rationale: string;
  phaseIndex: number | null;
  week: number | null;
}
export interface AdjustmentDiff {
  items: Array<{ phaseIndex: number; label: string; slotKey: string; scopeText: string; sessions: number; before: ItemBrief; after: ItemBrief }>;
  volume: Array<{ phaseIndex: number; week: number; muscle: string; before: number; after: number; delta: number }>;
  /** Changed volume rows beyond the cap (the rows above are the largest changes first). */
  volumeTruncated: number;
  minutes: Array<{ phaseIndex: number; label: string; week: number; slot: number; before: number | null; after: number | null }>;
  audit: { introduced: AuditBrief[]; resolved: AuditBrief[] };
  constraints: ConstraintCheck[];
  counts: { itemsChanged: number; occurrencesTouched: number };
}

const briefOf = (item: ItemOut | undefined): ItemBrief =>
  item ? { exerciseName: item.exerciseName, doseText: doseTextOf(item.dose), provenance: item.origin } : { exerciseName: "(sem exercício)", doseText: "", provenance: "ENGINE" };
const occKey = (o: Pick<OccurrenceOut, "phaseIndex" | "week" | "slot">) => `${o.phaseIndex}|${o.week}|${o.slot}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function weeksText(weeks: number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  if (sorted.length === 1) return `semana ${sorted[0]}`;
  const contiguous = sorted.every((w, i) => i === 0 || w === sorted[i - 1] + 1);
  return contiguous ? `semanas ${sorted[0]}–${sorted[sorted.length - 1]}` : `semanas ${sorted.join(", ")}`;
}

const findingKey = (f: AuditFinding) => [f.code, f.phaseIndex ?? "", f.week ?? "", f.label ?? "", f.muscle ?? "", f.pattern ?? "", f.toPhaseIndex ?? "", f.toWeek ?? ""].join("|");
const auditBrief = (f: AuditFinding): AuditBrief => ({ key: findingKey(f), code: f.code, severity: f.severity, rationale: f.rationale, phaseIndex: f.phaseIndex ?? null, week: f.week ?? null });

export function diffResults(before: EngineResult, after: EngineResult, constraints: ConstraintCheck[] = []): AdjustmentDiff {
  const beforeOcc = new Map(before.occurrences.map((o) => [occKey(o), o] as const));
  const groups = new Map<string, { phaseIndex: number; label: string; slotKey: string; weeks: number[]; before: ItemBrief; after: ItemBrief; sessions: Set<string> }>();
  const touched = new Set<string>();
  const minutes: AdjustmentDiff["minutes"] = [];
  for (const o of after.occurrences) {
    const b = beforeOcc.get(occKey(o));
    if (!b) continue;
    const max = Math.max(b.items.length, o.items.length);
    for (let p = 0; p < max; p++) {
      const x = b.items[p];
      const y = o.items[p];
      if (x && y && x.exerciseId === y.exerciseId && JSON.stringify(x.dose) === JSON.stringify(y.dose)) continue;
      touched.add(occKey(o));
      const from = briefOf(x);
      const to = briefOf(y);
      const key = JSON.stringify([o.phaseIndex, o.label, x?.slotKey ?? null, from, to]);
      const group = groups.get(key) ?? { phaseIndex: o.phaseIndex, label: o.label, slotKey: x?.slotKey ?? y?.slotKey ?? "", weeks: [], before: from, after: to, sessions: new Set<string>() };
      group.weeks.push(o.week);
      group.sessions.add(occKey(o));
      groups.set(key, group);
    }
    if (b.estimatedMinutes !== o.estimatedMinutes) {
      touched.add(occKey(o));
      minutes.push({ phaseIndex: o.phaseIndex, label: o.label, week: o.week, slot: o.slot, before: b.estimatedMinutes, after: o.estimatedMinutes });
    }
  }
  const items = [...groups.values()]
    .sort((a, b) => a.phaseIndex - b.phaseIndex || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) || Math.min(...a.weeks) - Math.min(...b.weeks))
    .map((g) => ({ phaseIndex: g.phaseIndex, label: g.label, slotKey: g.slotKey, scopeText: weeksText(g.weeks), sessions: g.sessions.size, before: g.before, after: g.after }));

  const key = (v: { phaseIndex: number; week: number; muscle: string }) => `${v.phaseIndex}|${v.week}|${v.muscle}`;
  const was = new Map(before.volume.map((v) => [key(v), v.weightedSets] as const));
  const now = new Map(after.volume.map((v) => [key(v), v.weightedSets] as const));
  const volumeAll: AdjustmentDiff["volume"] = [];
  for (const k of new Set([...was.keys(), ...now.keys()])) {
    const [phaseIndex, week, muscle] = k.split("|");
    const b = was.get(k) ?? 0;
    const a = now.get(k) ?? 0;
    if (round2(a - b) !== 0) volumeAll.push({ phaseIndex: Number(phaseIndex), week: Number(week), muscle, before: b, after: a, delta: round2(a - b) });
  }
  volumeAll.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.phaseIndex - y.phaseIndex || x.week - y.week || (x.muscle < y.muscle ? -1 : 1));
  const volume = volumeAll.slice(0, ADJUST_DIFF_MAX_VOLUME_ROWS).sort((x, y) => x.phaseIndex - y.phaseIndex || x.week - y.week || (x.muscle < y.muscle ? -1 : x.muscle > y.muscle ? 1 : 0));

  const was2 = new Map((before.audit?.findings ?? []).map((f) => [findingKey(f), f] as const));
  const now2 = new Map((after.audit?.findings ?? []).map((f) => [findingKey(f), f] as const));
  return {
    items,
    volume,
    volumeTruncated: Math.max(0, volumeAll.length - volume.length),
    minutes,
    audit: {
      introduced: [...now2].filter(([k]) => !was2.has(k)).map(([, f]) => auditBrief(f)),
      resolved: [...was2].filter(([k]) => !now2.has(k)).map(([, f]) => auditBrief(f)),
    },
    constraints,
    counts: { itemsChanged: items.length, occurrencesTouched: touched.size },
  };
}
