import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  customNameSchema,
  itemFieldsSchema,
  MAX_PER_WORKOUT,
} from "@/modules/prescricao/contracts";
import { workoutSlots } from "@/modules/prescricao/summary";
import { parseVideoUrl, videoStatusFor, type VideoStatus } from "@/modules/biblioteca/contracts";
import type { PeriodizationSchedule } from "@/modules/training/contracts";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * Exercises prescribed inside a plan revision, by hand. Every operation needs an
 * open DRAFT revision of a plan whose student the user reaches through an active
 * technical care assignment. A revision past DRAFT is never touched, and a copy
 * of a revision gets its own rows. Name and video are a snapshot of the library
 * at the time, so editing the library never rewrites a prescription.
 *
 * Nothing here proposes a dose: every value is typed by the professional.
 */
export interface PrescribedItem {
  id: string;
  phaseIndex: number;
  workoutLabel: string;
  position: number;
  exerciseId: string | null;
  name: string;
  videoUrl: string | null;
  videoStatus: VideoStatus;
  sets: string | null;
  reps: string | null;
  loadInstruction: string | null;
  cadence: string | null;
  restSeconds: number | null;
  restText: string | null;
  rirMin: number | null;
  rirMax: number | null;
  notes: string | null;
  origin: string;
}
export type Target = { phaseIndex: number; workoutLabel: string };
export type ItemOutcome =
  | { status: "saved"; id: string }
  | { status: "not_found" }
  | { status: "invalid_target" }
  | { status: "full" }
  | { status: "conflict" };

const columns = `pe.id, pe.phase_index AS phaseIndex, pe.workout_label AS workoutLabel,
  pe.position, pe.exercise_id AS exerciseId, pe.name, pe.video_url AS videoUrl,
  pe.video_status AS videoStatus, pe.sets, pe.reps, pe.load_instruction AS loadInstruction,
  pe.cadence, pe.rest_seconds AS restSeconds, pe.rest_text AS restText, pe.rir_min AS rirMin,
  pe.rir_max AS rirMax, pe.notes, pe.origin`;

export function prescriptionFor(
  db: D1Database,
  context: AuthenticatedContext | null,
) {
  const { userId, organizationId } = assertContext(context);
  // Every statement binds ?1 organization, ?2 user, ?3 plan, ?4 revision, in that order.
  const reach = (state: string) => `EXISTS (SELECT 1 FROM plan_revisions r
    JOIN training_plans tp ON tp.organization_id = r.organization_id AND tp.id = r.plan_id
    JOIN students s ON s.organization_id = tp.organization_id AND s.id = tp.student_id
    WHERE r.organization_id = ?1 AND r.id = ?4 AND r.plan_id = ?3 ${state}
      AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;
  const seen = reach("");
  const open = reach("AND r.state = 'DRAFT'");
  const inWorkout = (alias: string, phase: string, label: string) =>
    `${alias}.revision_id = ?4 AND ${alias}.phase_index = ${phase} AND ${alias}.workout_label = ${label}`;
  const eventAfterChange = (
    planId: string,
    revisionId: string,
    stamp: string,
  ): D1PreparedStatement =>
    db
      .prepare(
        `INSERT INTO training_plan_events
           (id, organization_id, plan_id, revision_id, actor_user_id, action, created_at)
         SELECT ?5, r.organization_id, r.plan_id, r.id, ?2, 'PRESCRIPTION_EDITED', ?6
         FROM plan_revisions r
         WHERE r.organization_id = ?1 AND r.id = ?4 AND r.plan_id = ?3
           AND (SELECT changes()) > 0`,
      )
      .bind(organizationId, userId, planId, revisionId, crypto.randomUUID(), stamp);
  const isUnique = (error: unknown) => String(error).includes("UNIQUE");

  const api = {
    async list(planId: string, revisionId: string): Promise<PrescribedItem[]> {
      const result = await db
        .prepare(
          `SELECT ${columns} FROM prescribed_exercises pe
           WHERE pe.organization_id = ?1 AND pe.revision_id = ?4 AND ${seen}
           ORDER BY pe.phase_index, pe.workout_label, pe.position`,
        )
        .bind(organizationId, userId, planId, revisionId)
        .all<PrescribedItem>();
      return result.results;
    },

    /** The saved structure of an open draft, or null when the draft is not reachable. */
    async openDraft(
      planId: string,
      revisionId: string,
    ): Promise<PeriodizationSchedule | null> {
      const row = await db
        .prepare(
          `SELECT r.schedule_json AS scheduleJson FROM plan_revisions r
           WHERE r.organization_id = ?1 AND r.id = ?4 AND ${open}`,
        )
        .bind(organizationId, userId, planId, revisionId)
        .first<{ scheduleJson: string }>();
      return row ? (JSON.parse(row.scheduleJson) as PeriodizationSchedule) : null;
    },

    /** Add an exercise from the library (snapshot) or with a name of the professional's own. */
    async add(
      planId: string,
      revisionId: string,
      target: Target,
      source: { exerciseId: string } | { customName: string },
      rawFields: unknown = {},
      now = new Date(),
    ): Promise<ItemOutcome> {
      const fields = itemFieldsSchema.parse(rawFields);
      const customName =
        "customName" in source ? customNameSchema.parse(source.customName) : null;
      const schedule = await api.openDraft(planId, revisionId);
      if (!schedule) return { status: "not_found" };
      if (!hasSlot(schedule, target)) return { status: "invalid_target" };
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      const link =
        customName && fields.videoUrl ? (parseVideoUrl(fields.videoUrl)?.url ?? null) : null;
      const common = [
        fields.sets,
        fields.reps,
        fields.loadInstruction,
        fields.cadence,
        fields.restSeconds,
        fields.restText,
        fields.rirMin,
        fields.rirMax,
        fields.notes,
      ];
      const guard = `AND ${open}
        AND (SELECT COUNT(*) FROM prescribed_exercises c WHERE ${inWorkout("c", "?7", "?8")}) < ?19`;
      const nextPosition = `(SELECT COALESCE(MAX(x.position), 0) + 1 FROM prescribed_exercises x
          WHERE ${inWorkout("x", "?7", "?8")})`;
      const head = `INSERT INTO prescribed_exercises
          (id, organization_id, revision_id, phase_index, workout_label, position, exercise_id,
           name, video_url, video_status, sets, reps, load_instruction, cadence, rest_seconds,
           rest_text, rir_min, rir_max, notes, origin, created_by_user_id, created_at, updated_at)`;
      // ?5 id, ?6 stamp, ?7 phase, ?8 label, ?9..?17 the nine fields, ?18 reserved, ?19 cap.
      const statement = customName
        ? db
            .prepare(
              `${head} SELECT ?5, ?1, ?4, ?7, ?8, ${nextPosition}, NULL, ?20, ?21, ?22,
                 ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'PROFESSIONAL', ?2, ?6, ?6
               WHERE ${seen} ${guard}`,
            )
            .bind(
              organizationId, userId, planId, revisionId, id, stamp,
              target.phaseIndex, target.workoutLabel, ...common, null,
              MAX_PER_WORKOUT, customName, link, videoStatusFor(link, false, false),
            )
        : db
            .prepare(
              `${head} SELECT ?5, ?1, ?4, ?7, ?8, ${nextPosition}, e.id, e.name, e.video_url,
                 e.video_status, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'PROFESSIONAL',
                 ?2, ?6, ?6
               FROM exercises e
               WHERE e.id = ?20 AND e.archived_at IS NULL
                 AND (e.organization_id IS NULL OR e.organization_id = ?1)
                 ${guard}`,
            )
            .bind(
              organizationId, userId, planId, revisionId, id, stamp,
              target.phaseIndex, target.workoutLabel, ...common, null,
              MAX_PER_WORKOUT, (source as { exerciseId: string }).exerciseId,
            );
      try {
        const results = await db.batch([statement, eventAfterChange(planId, revisionId, stamp)]);
        if (results[0].meta.changes > 0) return { status: "saved", id };
      } catch (error) {
        if (isUnique(error)) return { status: "conflict" };
        throw error;
      }
      // Nothing was inserted: either the workout is full or the exercise is not usable.
      const count = (await api.list(planId, revisionId)).filter(
        (item) =>
          item.phaseIndex === target.phaseIndex &&
          item.workoutLabel === target.workoutLabel,
      ).length;
      return count >= MAX_PER_WORKOUT ? { status: "full" } : { status: "not_found" };
    },

    /**
     * Changes only the fields that were sent; an explicit null clears one. The name
     * can change only for an exercise that is not from the library.
     */
    async update(
      planId: string,
      revisionId: string,
      itemId: string,
      rawFields: unknown,
      customName?: string,
      now = new Date(),
    ): Promise<boolean> {
      const name = customName === undefined ? undefined : customNameSchema.parse(customName);
      const current = (await api.list(planId, revisionId)).find((item) => item.id === itemId);
      if (!current) return false;
      const fields = itemFieldsSchema.parse({
        sets: current.sets,
        reps: current.reps,
        loadInstruction: current.loadInstruction,
        cadence: current.cadence,
        restSeconds: current.restSeconds,
        restText: current.restText,
        rirMin: current.rirMin,
        rirMax: current.rirMax,
        videoUrl: current.videoUrl,
        notes: current.notes,
        ...(rawFields as object),
      });
      const link = fields.videoUrl ? (parseVideoUrl(fields.videoUrl)?.url ?? null) : null;
      const status: VideoStatus =
        link === current.videoUrl ? current.videoStatus : videoStatusFor(link, false, false);
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE prescribed_exercises
             SET sets = ?7, reps = ?8, load_instruction = ?9, cadence = ?10, rest_seconds = ?11,
               rest_text = ?12, rir_min = ?13, rir_max = ?14, notes = ?15, video_url = ?16,
               video_status = ?17, updated_at = ?6,
               name = CASE WHEN exercise_id IS NULL THEN ?18 ELSE name END
             WHERE id = ?19 AND organization_id = ?1 AND revision_id = ?4 AND ${open}`,
          )
          .bind(
            organizationId, userId, planId, revisionId, crypto.randomUUID(), stamp,
            fields.sets, fields.reps, fields.loadInstruction, fields.cadence,
            fields.restSeconds, fields.restText, fields.rirMin, fields.rirMax, fields.notes,
            link, status, name ?? current.name, itemId,
          ),
        eventAfterChange(planId, revisionId, stamp),
      ]);
      return results[0].meta.changes > 0;
    },

    async remove(planId: string, revisionId: string, itemId: string, now = new Date()): Promise<boolean> {
      const results = await db.batch([
        db
          .prepare(
            `DELETE FROM prescribed_exercises
             WHERE id = ?7 AND organization_id = ?1 AND revision_id = ?4 AND ${open}`,
          )
          .bind(organizationId, userId, planId, revisionId, crypto.randomUUID(), now.toISOString(), itemId),
        eventAfterChange(planId, revisionId, now.toISOString()),
      ]);
      return results[0].meta.changes > 0;
    },

    /** Gives the workout exactly this order. The ids must be the workout's current ones. */
    async reorder(
      planId: string,
      revisionId: string,
      target: Target,
      orderedIds: string[],
      now = new Date(),
    ): Promise<boolean> {
      const schedule = await api.openDraft(planId, revisionId);
      if (!schedule || !hasSlot(schedule, target)) return false;
      const current = (await api.list(planId, revisionId)).filter(
        (item) =>
          item.phaseIndex === target.phaseIndex &&
          item.workoutLabel === target.workoutLabel,
      );
      const same =
        current.length === orderedIds.length &&
        new Set(orderedIds).size === orderedIds.length &&
        current.every((item) => orderedIds.includes(item.id));
      if (!same || current.length === 0) return false;
      const stamp = now.toISOString();
      // Positions are unique, so move everything out of the way first, then settle.
      const statements = [
        db
          .prepare(
            `UPDATE prescribed_exercises SET position = position + 100000
             WHERE ${inWorkout("prescribed_exercises", "?7", "?8")} AND organization_id = ?1 AND ${open}`,
          )
          .bind(organizationId, userId, planId, revisionId, "", stamp, target.phaseIndex, target.workoutLabel),
        ...orderedIds.map((id, index) =>
          db
            .prepare(
              `UPDATE prescribed_exercises SET position = ?9, updated_at = ?6
               WHERE id = ?10 AND ${inWorkout("prescribed_exercises", "?7", "?8")}
                 AND organization_id = ?1 AND ${open}`,
            )
            .bind(
              organizationId, userId, planId, revisionId, "", stamp,
              target.phaseIndex, target.workoutLabel, index + 1, id,
            ),
        ),
      ];
      try {
        const results = await db.batch(statements);
        return results.slice(1).every((result) => result.meta.changes === 1);
      } catch (error) {
        if (isUnique(error)) return false;
        throw error;
      }
    },

    /** A copy of one exercise at the end of its workout. */
    async duplicate(
      planId: string,
      revisionId: string,
      itemId: string,
      now = new Date(),
    ): Promise<ItemOutcome> {
      const source = (await api.list(planId, revisionId)).find((item) => item.id === itemId);
      if (!source) return { status: "not_found" };
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO prescribed_exercises
                 (id, organization_id, revision_id, phase_index, workout_label, position,
                  exercise_id, name, video_url, video_status, sets, reps, load_instruction,
                  cadence, rest_seconds, rest_text, rir_min, rir_max, notes, origin,
                  created_by_user_id, created_at, updated_at)
               SELECT ?5, src.organization_id, src.revision_id, src.phase_index, src.workout_label,
                 (SELECT COALESCE(MAX(x.position), 0) + 1 FROM prescribed_exercises x
                    WHERE ${inWorkout("x", "src.phase_index", "src.workout_label")}),
                 src.exercise_id, src.name, src.video_url, src.video_status, src.sets, src.reps,
                 src.load_instruction, src.cadence, src.rest_seconds, src.rest_text, src.rir_min,
                 src.rir_max, src.notes, 'PROFESSIONAL', ?2, ?6, ?6
               FROM prescribed_exercises src
               WHERE src.id = ?7 AND src.organization_id = ?1 AND src.revision_id = ?4
                 AND (SELECT COUNT(*) FROM prescribed_exercises c
                        WHERE ${inWorkout("c", "src.phase_index", "src.workout_label")}) < ?8
                 AND ${open}`,
            )
            .bind(organizationId, userId, planId, revisionId, id, stamp, itemId, MAX_PER_WORKOUT),
          eventAfterChange(planId, revisionId, stamp),
        ]);
        if (results[0].meta.changes > 0) return { status: "saved", id };
      } catch (error) {
        if (isUnique(error)) return { status: "conflict" };
        throw error;
      }
      const count = (await api.list(planId, revisionId)).filter(
        (item) =>
          item.phaseIndex === source.phaseIndex && item.workoutLabel === source.workoutLabel,
      ).length;
      return count >= MAX_PER_WORKOUT ? { status: "full" } : { status: "not_found" };
    },

    /** Swaps the library exercise, keeping the dose the professional typed. */
    async replaceExercise(
      planId: string,
      revisionId: string,
      itemId: string,
      exerciseId: string,
      now = new Date(),
    ): Promise<boolean> {
      const stamp = now.toISOString();
      const usable = `EXISTS (SELECT 1 FROM exercises e WHERE e.id = ?8 AND e.archived_at IS NULL
          AND (e.organization_id IS NULL OR e.organization_id = ?1))`;
      const pick = (column: string) =>
        `(SELECT e.${column} FROM exercises e WHERE e.id = ?8)`;
      const results = await db.batch([
        db
          .prepare(
            `UPDATE prescribed_exercises
             SET exercise_id = ?8, name = ${pick("name")}, video_url = ${pick("video_url")},
               video_status = ${pick("video_status")}, updated_at = ?6
             WHERE id = ?7 AND organization_id = ?1 AND revision_id = ?4 AND ${usable} AND ${open}`,
          )
          .bind(organizationId, userId, planId, revisionId, "", stamp, itemId, exerciseId),
        eventAfterChange(planId, revisionId, stamp),
      ]);
      return results[0].meta.changes > 0;
    },

    /**
     * Copies the exercises of a whole mesocycle into another mesocycle that has NO exercises
     * yet, workout by workout under the same letter. Letters the destination does not have
     * are reported, not forced into another workout.
     */
    async copyPhase(
      planId: string,
      revisionId: string,
      fromPhase: number,
      toPhase: number,
      now = new Date(),
    ): Promise<
      | { status: "saved"; copied: number; skipped: string[] }
      | {
          status:
            | "not_found"
            | "invalid_target"
            | "empty_source"
            | "no_common_workouts"
            | "destination_not_empty";
        }
    > {
      const schedule = await api.openDraft(planId, revisionId);
      if (!schedule) return { status: "not_found" };
      const slots = workoutSlots(schedule);
      const labelsOf = (phase: number) =>
        slots.filter((slot) => slot.phaseIndex === phase).map((slot) => slot.label);
      if (fromPhase === toPhase || !labelsOf(fromPhase).length || !labelsOf(toPhase).length)
        return { status: "invalid_target" };
      const items = await api.list(planId, revisionId);
      const fromItems = items.filter((item) => item.phaseIndex === fromPhase);
      if (fromItems.length === 0) return { status: "empty_source" };
      if (items.some((item) => item.phaseIndex === toPhase))
        return { status: "destination_not_empty" };
      const usedLabels = [...new Set(fromItems.map((item) => item.workoutLabel))];
      const destinationLabels = labelsOf(toPhase);
      const common = usedLabels.filter((label) => destinationLabels.includes(label));
      if (common.length === 0) return { status: "no_common_workouts" };
      const stamp = now.toISOString();
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO prescribed_exercises
                 (id, organization_id, revision_id, phase_index, workout_label, position,
                  exercise_id, name, video_url, video_status, sets, reps, load_instruction,
                  cadence, rest_seconds, rest_text, rir_min, rir_max, notes, origin,
                  created_by_user_id, created_at, updated_at)
               SELECT lower(hex(randomblob(16))), src.organization_id, src.revision_id, ?6,
                 src.workout_label, src.position, src.exercise_id, src.name, src.video_url,
                 src.video_status, src.sets, src.reps, src.load_instruction, src.cadence,
                 src.rest_seconds, src.rest_text, src.rir_min, src.rir_max, src.notes,
                 'PROFESSIONAL', ?2, ?7, ?7
               FROM prescribed_exercises src
               WHERE src.organization_id = ?1 AND src.revision_id = ?4 AND src.phase_index = ?5
                 AND src.workout_label IN (SELECT value FROM json_each(?8))
                 AND NOT EXISTS (SELECT 1 FROM prescribed_exercises d
                                   WHERE d.revision_id = ?4 AND d.phase_index = ?6)
                 AND ${open}`,
            )
            .bind(
              organizationId, userId, planId, revisionId, fromPhase, toPhase, stamp,
              JSON.stringify(common),
            ),
          eventAfterChange(planId, revisionId, stamp),
        ]);
        return results[0].meta.changes > 0
          ? {
              status: "saved",
              copied: results[0].meta.changes,
              skipped: usedLabels.filter((label) => !destinationLabels.includes(label)),
            }
          : { status: "not_found" };
      } catch (error) {
        if (isUnique(error)) return { status: "destination_not_empty" };
        throw error;
      }
    },

    /** Copies a whole workout into an EMPTY one, so nothing the professional wrote is overwritten. */
    async copyWorkout(
      planId: string,
      revisionId: string,
      from: Target,
      to: Target,
      now = new Date(),
    ): Promise<
      | { status: "saved"; count: number }
      | { status: "not_found" | "invalid_target" | "empty_source" | "destination_not_empty" }
    > {
      const schedule = await api.openDraft(planId, revisionId);
      if (!schedule) return { status: "not_found" };
      if (
        !hasSlot(schedule, from) ||
        !hasSlot(schedule, to) ||
        (from.phaseIndex === to.phaseIndex && from.workoutLabel === to.workoutLabel)
      )
        return { status: "invalid_target" };
      const items = await api.list(planId, revisionId);
      const inSlot = (slot: Target) =>
        items.filter((i) => i.phaseIndex === slot.phaseIndex && i.workoutLabel === slot.workoutLabel);
      if (inSlot(from).length === 0) return { status: "empty_source" };
      if (inSlot(to).length > 0) return { status: "destination_not_empty" };
      const stamp = now.toISOString();
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO prescribed_exercises
                 (id, organization_id, revision_id, phase_index, workout_label, position,
                  exercise_id, name, video_url, video_status, sets, reps, load_instruction,
                  cadence, rest_seconds, rest_text, rir_min, rir_max, notes, origin,
                  created_by_user_id, created_at, updated_at)
               SELECT lower(hex(randomblob(16))), src.organization_id, src.revision_id, ?9, ?10,
                 src.position, src.exercise_id, src.name, src.video_url, src.video_status,
                 src.sets, src.reps, src.load_instruction, src.cadence, src.rest_seconds,
                 src.rest_text, src.rir_min, src.rir_max, src.notes, 'PROFESSIONAL', ?2, ?6, ?6
               FROM prescribed_exercises src
               WHERE src.organization_id = ?1 AND ${inWorkout("src", "?7", "?8")}
                 AND NOT EXISTS (SELECT 1 FROM prescribed_exercises d
                                   WHERE ${inWorkout("d", "?9", "?10")})
                 AND ${open}`,
            )
            .bind(
              organizationId, userId, planId, revisionId, "", stamp,
              from.phaseIndex, from.workoutLabel, to.phaseIndex, to.workoutLabel,
            ),
          eventAfterChange(planId, revisionId, stamp),
        ]);
        return results[0].meta.changes > 0
          ? { status: "saved", count: results[0].meta.changes }
          : { status: "not_found" };
      } catch (error) {
        if (isUnique(error)) return { status: "destination_not_empty" };
        throw error;
      }
    },
  };
  return api;
}

function hasSlot(schedule: PeriodizationSchedule, target: Target) {
  return workoutSlots(schedule).some(
    (slot) => slot.phaseIndex === target.phaseIndex && slot.label === target.workoutLabel,
  );
}

