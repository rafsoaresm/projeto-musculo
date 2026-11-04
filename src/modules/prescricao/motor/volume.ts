/** Volume semanal por músculo: séries diretas (principal), indiretas (secundário) e ponderadas. */
import { codeOf, cmp } from "./vocabulary";
import type { RuleLog } from "./trace";
import type { CatalogExercise, OccurrenceOut, VolumeRow } from "./types";

function setsOf(dose: OccurrenceOut["items"][number]["dose"]): number | null {
  if (!dose) return null;
  if (dose.metric === "REPS" || dose.metric === "TIME" || dose.metric === "DISTANCE") return dose.sets;
  return null;
}

export function volumeFor(log: RuleLog, occurrences: OccurrenceOut[], byId: Map<string, CatalogExercise>): VolumeRow[] {
  const modalities = new Set(log.get("VOLUME_MODALITIES"));
  const factor = log.get("INDIRECT_VOLUME_FACTOR");
  const rows = new Map<string, VolumeRow & { seen: Set<string> }>();
  for (const o of occurrences) {
    for (const item of o.items) {
      const e = item.exerciseId ? byId.get(item.exerciseId) : undefined;
      const sets = setsOf(item.dose);
      if (!e || sets === null || !e.modality || !modalities.has(codeOf(e.modality))) continue;
      const direct = new Set(e.primaryMuscles.map(codeOf));
      const indirect = new Set(e.secondaryMuscles.map(codeOf).filter((m) => !direct.has(m)));
      for (const muscle of [...direct, ...indirect]) {
        const key = `${o.phaseIndex}|${o.week}|${muscle}`;
        let row = rows.get(key);
        if (!row) {
          row = { phaseIndex: o.phaseIndex, week: o.week, muscle, directSets: 0, indirectSets: 0, weightedSets: 0, occurrences: 0, seen: new Set() };
          rows.set(key, row);
        }
        if (direct.has(muscle)) row.directSets += sets;
        else row.indirectSets += sets;
        row.seen.add(`${o.slot}`);
      }
    }
  }
  return [...rows.values()]
    .map(({ seen, ...r }) => ({ ...r, weightedSets: Math.round((r.directSets + r.indirectSets * factor) * 100) / 100, occurrences: seen.size }))
    .sort((a, b) => a.phaseIndex - b.phaseIndex || a.week - b.week || cmp(a.muscle, b.muscle));
}
