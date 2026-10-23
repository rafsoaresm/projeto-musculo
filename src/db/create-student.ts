import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import type { AuthenticatedContext } from "./students";

export const studentInput = z.object({
  displayName: z.string().trim().min(2).max(160),
});
export async function createStudent(
  db: D1Database,
  context: AuthenticatedContext,
  input: unknown,
) {
  const { displayName } = studentInput.parse(input);
  const { userId, organizationId } = context;
  const id = crypto.randomUUID();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO students(id,organization_id,display_name)
      SELECT ?,p.organization_id,? FROM professionals p
      JOIN memberships m ON m.user_id = p.user_id AND m.organization_id = p.organization_id
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ? AND p.organization_id = ? AND u.disabled_at IS NULL
      AND m.revoked_at IS NULL AND m.role IN ('OWNER','MANAGER','TECHNICAL')`,
      )
      .bind(id, displayName, userId, organizationId),
    db
      .prepare(
        `INSERT INTO care_assignments(organization_id,student_id,professional_id)
      SELECT s.organization_id,s.id,p.id FROM students s
      JOIN professionals p ON p.organization_id = s.organization_id
      WHERE s.id = ? AND p.user_id = ?`,
      )
      .bind(id, userId),
    db
      .prepare(
        `INSERT INTO audit_events(id,organization_id,actor_user_id,action,subject_id)
      SELECT ?,organization_id,?,'STUDENT_CREATED',id FROM students WHERE id = ?`,
      )
      .bind(crypto.randomUUID(), userId, id),
  ]);
  if (result[0].meta.changes !== 1)
    throw new Error("STUDENT_CREATION_FORBIDDEN");
  return id;
}
