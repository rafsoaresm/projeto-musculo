import type { Exercise, GenerationResult, Periodization, Template } from "./types";

/** Contract of Gymgital's existing src/modules/training/contracts.ts (0.91). */
export interface ExistingSchedule {
  startDate: string;
  phases: Array<{
    index: number; weeks: number; sessionsPerWeek: number;
    split: string; exercisesPerSession: number;
  }>;
}
export type FocusByPhase = Record<number, Record<string, Partial<Pick<Template,
  "targetMuscles" | "targetPatterns" | "modalities" | "minutes" | "lockedExerciseIds" | "stimulus" | "doseOverrides">>>>;

/** Bridge for EXISTING schedules. Do not use the existing Zod contract to validate NEW free-form schedules. */
export function fromGymgitalSchedule(schedule: ExistingSchedule, focus: FocusByPhase): Periodization {
  return {
    startDate: schedule.startDate,
    phases: schedule.phases.map(phase => {
      const labels = phase.split === "Full Body" ? ["Full Body"] : [...phase.split];
      const focusOfPhase = focus[phase.index] ?? {};
      return {
        id: `phase-${phase.index}`,
        weeks: phase.weeks,
        sessionsPerWeek: phase.sessionsPerWeek,
        strategy: "steady" as const,
        rotation: labels,
        templates: labels.map(label => ({
          id: label, label, exerciseCount: phase.exercisesPerSession,
          ...(focusOfPhase[label] ?? {}),
        })),
      };
    }),
  };
}
export interface GymgitalExerciseRecord {
  id: string; name: string; category: string; level: string | null;
  videoUrl: string | null; videoStatus: string; archivedAt: string | null;
}
export type CuratedMeta = Omit<Exercise, "id" | "name" | "video" | "manualOnly">;
export interface CatalogAdaptation { catalog: Exercise[]; missingMetadata: string[]; }
/** No biomechanical classification from category text: extensora in "Agachar" proves why. */
export function adaptGymgitalCatalog(rows: GymgitalExerciseRecord[], metadataById: Record<string, CuratedMeta>): CatalogAdaptation {
  const missingMetadata: string[] = [];
  const catalog = rows.filter(row => !row.archivedAt).map(row => {
    const meta = metadataById[row.id];
    if (!meta) missingMetadata.push(row.id);
    return {
      ...(meta ?? { modality: "unknown", metric: "reps", movementPatterns: [], primaryMuscles: [], equipment: [] }),
      id: row.id, name: row.name, manualOnly: !meta,
      video: row.videoUrl ? { url: row.videoUrl, status: row.videoStatus === "VERIFIED" ? "REVIEWED" as const : row.videoStatus === "SEARCH_LINK" ? "SEARCH_LINK" as const : "UNREVIEWED" as const } : undefined,
    } satisfies Exercise;
  });
  return { catalog, missingMetadata };
}
export interface LegacyDraftItem {
  target: { phaseIndex: number; workoutLabel: string };
  exerciseId: string;
  fields: {
    sets: string; reps: string | null; loadInstruction: string; cadence: string | null;
    restSeconds: number | null; restText: string | null; rirMin: number | null;
    rirMax: number | null; videoUrl: string | null; notes: string | null;
  };
}
/** Can be applied by the existing prescriptionFor.add() ONLY in a DRAFT after authorization and UI revision check. */
export function toGymgitalDraft(result: GenerationResult, phaseById: Record<string, number>): LegacyDraftItem[] {
  const seen = new Set<string>();
  const output: LegacyDraftItem[] = [];
  for (const session of result.sessions) {
    // Current DB stores templates by phase+workoutLabel, not every occurrence.
    const key = `${session.phaseId}|${session.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const item of session.items) {
      output.push({
        target: { phaseIndex: phaseById[session.phaseId] ?? session.phaseIndex, workoutLabel: session.label },
        exerciseId: item.exerciseId,
        fields: {
          sets: `${item.dose.sets}`,
          reps: item.dose.repsMax !== undefined ? `${item.dose.repsMin ?? item.dose.repsMax}-${item.dose.repsMax}` : item.dose.durationSeconds !== undefined ? `${item.dose.durationSeconds}s` : item.dose.distanceMeters !== undefined ? `${item.dose.distanceMeters}m` : null,
          loadInstruction: item.dose.loadInstruction.slice(0, 120),
          cadence: null, restSeconds: Math.min(3600, Math.round(item.dose.restSeconds)), restText: null,
          rirMin: item.dose.rirMin ?? null, rirMax: item.dose.rirMax ?? null,
          videoUrl: null,
          notes: `${item.dose.progression} ${item.dose.notes ?? ""}`.slice(0, 500),
        },
      });
    }
  }
  return output;
}