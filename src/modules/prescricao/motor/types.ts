/** Gymgital generic, deterministic prescription domain. Data are snapshots, never database identities. */
export type Modality = string;
export type Unit = "TOTAL" | "PER_HAND" | "PER_SIDE" | "MACHINE_STACK" | "BODYWEIGHT" | "ASSISTANCE" | "NONE";
export type Strategy = "linear" | "undulating_daily" | "undulating_weekly" | "block" | "steady";
export type Stimulus = "hypertrophy" | "strength" | "power" | "endurance" | "general" | "recovery" | string;

export interface StudentContext {
  id: string;
  age?: number;
  objective: string;
  experience?: string;
  minutesPerSession?: number;
  availableEquipment: string[];
  preferredExerciseIds?: string[];
  excludedExerciseIds?: string[];
  excludedPatterns?: string[];
  restrictions?: string[];
  screening: { state: "reviewed" | "pending" | "needs_review"; assessmentId?: string; reviewedBy?: string };
  assessment?: { id: string; assessedOn: string; method?: string; limitations?: string[] };
}
export interface Exercise {
  id: string;
  name: string;
  modality: Modality;
  movementPatterns: string[];
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  /** all entries are required; compatibleAny is optional sets of replacements for equipment variants */
  equipment: string[];
  compatibleAny?: string[][];
  difficulty?: number;
  tags?: string[];
  unilateral?: boolean;
  /** reps / time / distance; other modality-specific policies may use any of these. */
  metric: "reps" | "time" | "distance";
  secondsPerRep?: number;
  manualOnly?: boolean;
  video?: { url: string; status: "REVIEWED" | "UNREVIEWED" | "SEARCH_LINK" };
}
export interface Template {
  id: string;
  label: string;
  /** No artificial 3-8 or 30-exercise ceiling. 0 is a recovery/rest template. */
  exerciseCount: number;
  targetMuscles?: string[];
  targetPatterns?: string[];
  modalities?: Modality[];
  lockedExerciseIds?: string[];
  excludedExerciseIds?: string[];
  /** Controls duration, not total exercises. If infeasible, explain instead of changing the request. */
  minutes?: number;
  stimulus?: Stimulus;
  doseOverrides?: Record<string, Partial<DosePolicy>>;
}
export interface Phase {
  id: string;
  weeks: number;
  sessionsPerWeek: number;
  templates: Template[];
  /** Explicit rotation; defaults to template array order. */
  rotation?: string[];
  /** 0=startDate of that phase/week through 6=+6 calendar days; repeated days mean multiple sessions/day. */
  trainingDays?: number[];
  strategy?: Strategy;
  stimulus?: Stimulus;
  /** Custom block profile by week, aligned with weeks; can override goal for each week. */
  blocks?: Stimulus[];
  deloadWeeks?: number[];
  /** For linear strategy: interpolates selected values; does not predict kg. */
  linear?: { repsMin?: [number, number]; repsMax?: [number, number]; rirMin?: [number, number]; rirMax?: [number, number]; sets?: [number, number] };
  /** Direct per-week overrides, by modality; work alongside any strategy. */
  weeklyPolicies?: Record<number, Record<string, Partial<DosePolicy>>>;
  deloadMultiplier?: number;
  volumeTargets?: Record<string, number>;
}
export interface Periodization {
  startDate: string;
  phases: Phase[];
}
export interface DosePolicy {
  sets: number;
  repsMin?: number;
  repsMax?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  rirMin?: number;
  rirMax?: number;
  restSeconds: number;
  secondsPerRep?: number;
  notes?: string;
}
export interface PrescriptionPolicies {
  byStimulus?: Record<string, Partial<Record<string, Partial<DosePolicy>>>>;
  /** Per-modality overrides, useful for sport-specific, cardio, rehabilitation protocols. */
  byModality?: Record<string, Partial<DosePolicy>>;
  duration?: { warmupSeconds?: number; transitionSeconds?: number; setupSeconds?: number };
  /** Optional resource-oriented beam width; not a clinical restriction. */
  beamWidth?: number;
  alternativeCount?: number;
}
export interface GenerationInput {
  student: StudentContext;
  periodization: Periodization;
  catalog: Exercise[];
  policies?: PrescriptionPolicies;
  existing?: Array<{ phaseId: string; templateId: string; exerciseId: string; locked?: boolean }>;
  scope?: { phaseIds?: string[] };
  catalogVersion?: string;
  evidenceVersion?: string;
}
export interface Dose extends DosePolicy {
  loadKg: number | null;
  loadBasis: Unit;
  loadInstruction: string;
  progression: string;
}
export interface PrescriptionItem {
  exerciseId: string;
  exerciseName: string;
  modality: string;
  order: number;
  dose: Dose;
  alternativeIds: string[];
  videoStatus: "REVIEWED" | "UNREVIEWED" | "SEARCH_LINK" | "MISSING";
  origin: "LOCKED" | "PRESERVED" | "ENGINE";
  reasons: string[];
}
export interface Session {
  id: string;
  phaseId: string;
  phaseIndex: number;
  week: number;
  day: number;
  date: string;
  slotIndex: number;
  templateId: string;
  label: string;
  stimulus: string;
  items: PrescriptionItem[];
  estimatedMinutes: number;
  projected: boolean;
}
export interface Issue {
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  path: string;
  message: string;
  suggestedAction?: string;
}
export interface VolumeRow {
  phaseId: string;
  week: number;
  muscle: string;
  directSets: number;
  indirectSets: number;
  weightedSets: number;
  occurrences: number;
}
export interface GenerationResult {
  engineVersion: string;
  inputHash: string;
  policyVersion: string;
  status: "SUCCEEDED" | "INFEASIBLE";
  validation: "PASSED" | "WARNINGS" | "BLOCKED";
  requiresProfessionalReview: true;
  sessions: Session[];
  issues: Issue[];
  volume: VolumeRow[];
  evidence: Array<{ rule: string; source: string; type: "evidence" | "heuristic" }>;
  decisionTrace: Array<{ sessionId: string; rule: string; inputs: string[]; result: string }>;
}
export interface TrainingSetLog { reps?: number; durationSeconds?: number; loadKg?: number; loadBasis?: Unit; rir?: number; completed: boolean; pain?: boolean; }
export interface TrainingExposure { exerciseId: string; exerciseMetric: "reps" | "time" | "distance"; equipmentKey: string; date: string; sets: TrainingSetLog[]; notes?: string; }
export interface ProgressionProposal { action: "INCREASE" | "MAINTAIN" | "REVIEW" | "INSUFFICIENT_DATA"; newLoadKg: number | null; explanation: string; }