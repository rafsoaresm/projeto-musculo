import type { D1Database } from "@cloudflare/workers-types";
import { parseProfile, type ProfileInput } from "@/modules/ficha/contracts";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * The student's file. Personal and health-related, so only a professional with an active
 * technical care assignment reads or writes it: never the student's own login, a platform
 * manager, an owner without an assignment, or commercial and finance members. Saving records
 * who and when, never what.
 */
export interface StudentProfile extends ProfileInput {
  studentId: string;
  updatedAt: string;
}

// Column name in SQL, key in the code. Both are constants, never request input.
const FIELDS = [
  ["birth_date", "birthDate"], ["gender", "gender"], ["email", "email"], ["phone", "phone"],
  ["height_cm", "heightCm"], ["weight_kg", "weightKg"], ["body_measured_on", "bodyMeasuredOn"],
  ["goal", "goal"], ["level", "level"], ["days_per_week", "daysPerWeek"],
  ["session_minutes", "sessionMinutes"], ["location", "location"], ["equipment", "equipment"],
  ["experience", "experience"], ["injuries", "injuries"], ["surgeries", "surgeries"],
  ["pains", "pains"], ["limitations", "limitations"],
  ["medications_conditions", "medicationsConditions"], ["relevant_notes", "relevantNotes"],
  ["preferred_exercises", "preferredExercises"], ["disliked_exercises", "dislikedExercises"],
  ["excluded_exercises", "excludedExercises"], ["professional_notes", "professionalNotes"],
] as const;

export function profilesFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting user, ?3 student.
  const reach = `EXISTS (SELECT 1 FROM students s
    WHERE s.organization_id = ?1 AND s.id = ?3 AND ${activeUser("?2")}
      AND ${technicalAccessExists("s", "?2")})`;
  return {
    async get(studentId: string): Promise<StudentProfile | null> {
      const row = await db
        .prepare(
          `SELECT sp.student_id AS studentId, sp.updated_at AS updatedAt,
             ${FIELDS.map(([column, key]) => `sp.${column} AS ${key}`).join(", ")}
           FROM student_profiles sp
           WHERE sp.organization_id = ?1 AND sp.student_id = ?3 AND ${reach}`,
        )
        .bind(organizationId, userId, studentId)
        .first<StudentProfile>();
      return row ?? null;
    },

    /** Creates or replaces the file. False when this user does not reach the student. */
    async save(studentId: string, raw: unknown, now = new Date()): Promise<boolean> {
      const input = parseProfile(raw, now);
      const stamp = now.toISOString();
      const columns = FIELDS.map(([column]) => column);
      const marks = FIELDS.map((_, index) => `?${index + 5}`);
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO student_profiles
               (student_id, organization_id, ${columns.join(", ")}, updated_by_user_id,
                created_at, updated_at)
             SELECT s.id, s.organization_id, ${marks.join(", ")}, ?2, ?4, ?4
             FROM students s
             WHERE s.organization_id = ?1 AND s.id = ?3 AND ${activeUser("?2")}
               AND ${technicalAccessExists("s", "?2")}
             ON CONFLICT(student_id) DO UPDATE SET
               ${columns.map((column) => `${column} = excluded.${column}`).join(", ")},
               updated_by_user_id = excluded.updated_by_user_id,
               updated_at = excluded.updated_at`,
          )
          .bind(organizationId, userId, studentId, stamp, ...FIELDS.map(([, key]) => input[key])),
        db
          .prepare(
            `INSERT INTO access_audit_events
               (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, ?2, ?3, 'STUDENT_PROFILE_SAVED', ?4, ?5
             WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, studentId, stamp),
      ]);
      return results[0].meta.changes > 0;
    },
  };
}
