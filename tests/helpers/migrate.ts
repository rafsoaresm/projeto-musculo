import type { D1Database } from "@cloudflare/workers-types";
import { readFile } from "node:fs/promises";

/**
 * Splits a migration into statements. A trigger body contains semicolons, so a statement that
 * starts with CREATE TRIGGER only ends at the `END;` that closes it.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  for (const line of sql.split("\n")) {
    if (/^\s*--/.test(line)) continue;
    buffer += `${line}\n`;
    const inTrigger = /^\s*CREATE\s+TRIGGER/i.test(buffer);
    const complete = inTrigger
      ? /\bEND;\s*$/i.test(buffer)
      : /;\s*$/.test(buffer);
    if (complete) {
      statements.push(buffer.trim().replace(/;\s*$/, ""));
      buffer = "";
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements.filter(Boolean);
}

export async function migrate(database: D1Database, files: string[]) {
  for (const file of files) {
    const sql = await readFile(
      new URL(`../../migrations/${file}`, import.meta.url),
      "utf8",
    );
    for (const statement of splitStatements(sql)) {
      await database.prepare(statement).run();
    }
  }
}

export const ALL_MIGRATIONS = [
  "0001_foundation.sql",
  "0002_identity_and_onboarding.sql",
  "0003_roles_and_access.sql",
  "0004_training_plans.sql",
  "0005_exercise_library.sql",
  "0006_prescribed_exercises.sql",
  "0007_approval_and_delivery.sql",
  "0008_student_profiles.sql",
  "0009_assessments.sql",
  "0010_posture_and_movement.sql",
  "0011_assessment_photos.sql",
  "0012_workout_sessions.sql",
  "0013_consent.sql",
  "0014_photo_consent_link.sql",
  "0015_student_checkins.sql",
  "0016_terms_versions.sql",
  "0017_data_subject_requests.sql",
];
