import type { PeriodizationSchedule } from "@/modules/training/contracts";
import { workoutLabels } from "@/modules/training/periodization";

export interface WorkoutSlot {
  phaseIndex: number;
  label: string;
  /** exercisesPerSession of the phase: a target, not a license to break a restriction. */
  target: number;
}
export interface WorkoutProgress extends WorkoutSlot {
  count: number;
  status: "BELOW" | "MET" | "ABOVE";
}

/** Every workout the saved structure has, phase by phase. */
export function workoutSlots(schedule: PeriodizationSchedule): WorkoutSlot[] {
  return schedule.phases.flatMap((phase) =>
    workoutLabels(phase.split).map((label) => ({
      phaseIndex: phase.index,
      label,
      target: phase.exercisesPerSession,
    })),
  );
}

/** Counts against the target. A missing exercise is a pending item, never filled in. */
export function progressOf(
  schedule: PeriodizationSchedule,
  items: Array<{ phaseIndex: number; workoutLabel: string }>,
): WorkoutProgress[] {
  return workoutSlots(schedule).map((slot) => {
    const count = items.filter(
      (item) =>
        item.phaseIndex === slot.phaseIndex && item.workoutLabel === slot.label,
    ).length;
    return {
      ...slot,
      count,
      status: count < slot.target ? "BELOW" : count === slot.target ? "MET" : "ABOVE",
    };
  });
}
