import type { D1Database } from "@cloudflare/workers-types";

/** Provided ONLY by verified server session + resolved organization, never request JSON. */
export interface AuthenticatedContext {
  userId: string;
  organizationId: string;
}

export interface StudentSummary {
  id: string;
  organizationId: string;
  displayName: string;
}

/**
 * SQL building blocks shared by repositories. They interpolate only constant
 * aliases and numbered placeholders chosen by code, never request input.
 */
export const activeUser = (user: string) =>
  `EXISTS (SELECT 1 FROM users u WHERE u.id = ${user} AND u.disabled_at IS NULL)`;

/** Active care assignment + non-revoked technical membership over student alias. */
export const technicalAccessExists = (student: string, user: string) =>
  `EXISTS (SELECT 1 FROM care_assignments ca
    JOIN professionals p ON p.organization_id = ca.organization_id AND p.id = ca.professional_id
    JOIN memberships m ON m.organization_id = p.organization_id AND m.user_id = p.user_id
    WHERE ca.organization_id = ${student}.organization_id AND ca.student_id = ${student}.id
      AND p.user_id = ${user} AND ca.revoked_at IS NULL AND m.revoked_at IS NULL
      AND m.role IN ('OWNER','MANAGER','TECHNICAL'))`;

// D1 has no row-level security. Every query includes organization AND current
// authorization. Membership alone does not grant technical access.
export const authorizedStudents = `
  SELECT s.id, s.organization_id AS organizationId, s.display_name AS displayName
  FROM students s
  WHERE s.organization_id = ?1
    AND ${activeUser("?2")}
    AND (
      EXISTS (SELECT 1 FROM student_access a
        WHERE a.organization_id = s.organization_id AND a.student_id = s.id
          AND a.user_id = ?2 AND a.revoked_at IS NULL)
      OR ${technicalAccessExists("s", "?2")}
    )`;

export function assertContext(context: AuthenticatedContext | null) {
  if (!context?.userId?.trim() || !context?.organizationId?.trim()) {
    throw new Error("AUTHENTICATION_REQUIRED");
  }
  // Copy the scope so a caller cannot mutate it between awaited operations.
  const { userId, organizationId } = context;
  return { userId, organizationId };
}

export function studentsFor(
  db: D1Database,
  context: AuthenticatedContext | null,
) {
  const { userId, organizationId } = assertContext(context);
  return {
    async list(): Promise<StudentSummary[]> {
      const result = await db
        .prepare(`${authorizedStudents} ORDER BY s.id`)
        .bind(organizationId, userId)
        .all<StudentSummary>();
      return result.results;
    },
    async findById(studentId: string): Promise<StudentSummary | null> {
      return db
        .prepare(`${authorizedStudents} AND s.id = ?3`)
        .bind(organizationId, userId, studentId)
        .first<StudentSummary>();
    },
  };
}
