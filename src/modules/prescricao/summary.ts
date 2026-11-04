import type { PeriodizationSchedule } from "@/modules/training/contracts";
import { phaseWorkouts } from "@/modules/training/periodization";

export interface WorkoutSlot {
  phaseIndex: number;
  label: string;
  /** Free name of a v2 workout ("Superior"); null for v1. */
  name: string | null;
  /** Target of the workout (v1: exercisesPerSession of the phase): a target, not a license to break a restriction. Null = no target. */
  target: number | null;
}
export interface WorkoutProgress extends WorkoutSlot {
  count: number;
  /** NO_TARGET: the professional left this workout without a target, so nothing is pending against one. */
  status: "BELOW" | "MET" | "ABOVE" | "NO_TARGET";
}

/** Every workout the saved structure has, phase by phase (v1 and v2). */
export function workoutSlots(schedule: PeriodizationSchedule): WorkoutSlot[] {
  return schedule.phases.flatMap((phase) =>
    phaseWorkouts(phase).map((workout) => ({
      phaseIndex: phase.index,
      label: workout.label,
      name: workout.name,
      target: workout.target,
    })),
  );
}

/** True when a workout is below its target. A workout without a target is never below. */
export const isBelowTarget = (slot: { target: number | null }, count: number) =>
  slot.target !== null && count < slot.target;

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
      status:
        slot.target === null
          ? "NO_TARGET"
          : count < slot.target
            ? "BELOW"
            : count === slot.target
              ? "MET"
              : "ABOVE",
    };
  });
}
