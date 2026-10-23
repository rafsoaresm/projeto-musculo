import type { D1Database } from "@cloudflare/workers-types";
import { isTokenShape, newToken, sha256Hex } from "./crypto";
import {
  activeUser,
  assertContext,
  authorizedStudents,
  technicalAccessExists,
  type AuthenticatedContext,
} from "./students";

/**
 * Client ("aluno") access. A login reaches the portal only through a one-use
 * invitation created by a professional with technical access to that student.
 * E-mail addresses never link an identity to a student record.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StudentAccessStatus {
  studentId: string;
  access: "ACTIVE" | "INVITED" | "NONE";
  activeSince: string | null;
  inviteExpiresAt: string | null;
}

export function studentAccessFor(
  db: D1Database,
  context: AuthenticatedContext | null,
) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting user, ?3 student: the three always bind in this order.
  const technicalOverStudent = (clause: string) =>
    `${clause} AND EXISTS (SELECT 1 FROM students s WHERE s.organization_id = ?1 AND s.id = ?3
       AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;
  return {
    /** Access state for the students this professional may see. */
    async statuses(now = new Date()): Promise<StudentAccessStatus[]> {
      const result = await db
        .prepare(
          `SELECT s.id AS studentId,
             (SELECT MIN(sa.created_at) FROM student_access sa
                WHERE sa.organization_id = s.organizationId AND sa.student_id = s.id
                  AND sa.revoked_at IS NULL) AS activeSince,
             (SELECT MAX(i.expires_at) FROM student_invites i
                WHERE i.organization_id = s.organizationId AND i.student_id = s.id
                  AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                  AND i.expires_at > ?3) AS inviteExpiresAt
           FROM (${authorizedStudents}) s ORDER BY s.id`,
        )
        .bind(organizationId, userId, now.toISOString())
        .all<{
          studentId: string;
          activeSince: string | null;
          inviteExpiresAt: string | null;
        }>();
      return result.results.map((row) => ({
        ...row,
        access: row.activeSince
          ? "ACTIVE"
          : row.inviteExpiresAt
            ? "INVITED"
            : "NONE",
      }));
    },
    async statusOf(
      studentId: string,
      now = new Date(),
    ): Promise<StudentAccessStatus | null> {
      return (
        (await this.statuses(now)).find((s) => s.studentId === studentId) ??
        null
      );
    },
    /** Returns the raw token ONCE. Only its hash is stored. */
    async createInvite(
      studentId: string,
      now = new Date(),
    ): Promise<{ token: string; expiresAt: string }> {
      const token = newToken();
      const inviteId = crypto.randomUUID();
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO student_invites(id, organization_id, student_id, token_hash, created_by_user_id, expires_at)
             SELECT ?1, s.organization_id, s.id, ?2, ?3, ?4 FROM students s
             WHERE s.organization_id = ?5 AND s.id = ?6
               AND ${activeUser("?3")} AND ${technicalAccessExists("s", "?3")}
               AND NOT EXISTS (SELECT 1 FROM student_access sa
                 WHERE sa.organization_id = s.organization_id AND sa.student_id = s.id
                   AND sa.revoked_at IS NULL)`,
          )
          .bind(
            inviteId,
            await sha256Hex(token),
            userId,
            expiresAt,
            organizationId,
            studentId,
          ),
        // A new link replaces any pending one, but only if the new one exists.
        db
          .prepare(
            `UPDATE student_invites SET revoked_at = ?3
             WHERE organization_id = ?1 AND student_id = ?2 AND id <> ?4
               AND accepted_at IS NULL AND revoked_at IS NULL
               AND EXISTS (SELECT 1 FROM student_invites n WHERE n.id = ?4)`,
          )
          .bind(organizationId, studentId, createdAt, inviteId),
        db
          .prepare(
            `INSERT INTO access_audit_events(id, organization_id, actor_user_id, action, subject_id)
             SELECT ?1, ?2, ?3, 'STUDENT_INVITE_CREATED', ?4
             WHERE EXISTS (SELECT 1 FROM student_invites n WHERE n.id = ?4)`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, inviteId),
      ]);
      if (results[0].meta.changes !== 1)
        throw new Error("STUDENT_INVITE_FORBIDDEN");
      return { token, expiresAt };
    },
    /** Cancels a pending link and revokes an active login. Returns revoked logins. */
    async revoke(studentId: string, now = new Date()): Promise<number> {
      const at = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            technicalOverStudent(
              `UPDATE student_invites SET revoked_at = ?4
               WHERE organization_id = ?1 AND student_id = ?3
                 AND accepted_at IS NULL AND revoked_at IS NULL`,
            ),
          )
          .bind(organizationId, userId, studentId, at),
        db
          .prepare(
            technicalOverStudent(
              `UPDATE student_access SET revoked_at = ?4
               WHERE organization_id = ?1 AND student_id = ?3 AND revoked_at IS NULL`,
            ),
          )
          .bind(organizationId, userId, studentId, at),
        db
          .prepare(
            `INSERT INTO access_audit_events(id, organization_id, actor_user_id, action, subject_id)
             SELECT ?1, ?2, ?3, 'STUDENT_ACCESS_REVOKED', ?4 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, studentId),
      ]);
      return results[1].meta.changes;
    },
  };
}

export interface InvitePreview {
  organizationName: string;
  professionalName: string | null;
}

/** For the invitation page, before login. Reveals no student data. */
export async function previewStudentInvite(
  db: D1Database,
  token: unknown,
  now = new Date(),
): Promise<InvitePreview | null> {
  if (!isTokenShape(token)) return null;
  return db
    .prepare(
      `SELECT o.name AS organizationName,
         (SELECT p.display_name FROM care_assignments a
            JOIN professionals p ON p.organization_id = a.organization_id AND p.id = a.professional_id
            WHERE a.organization_id = i.organization_id AND a.student_id = i.student_id
              AND a.revoked_at IS NULL ORDER BY a.created_at LIMIT 1) AS professionalName
       FROM student_invites i JOIN organizations o ON o.id = i.organization_id
       WHERE i.token_hash = ?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at > ?2`,
    )
    .bind(await sha256Hex(token), now.toISOString())
    .first<InvitePreview>();
}

/**
 * Accepts an invitation for the verified session identity. Atomic and
 * single-use: a replay, an expired or revoked link, or a student that already
 * has another active login yields null and changes nothing.
 */
export async function acceptStudentInvite(
  db: D1Database,
  userId: string,
  token: unknown,
  now = new Date(),
): Promise<{ organizationId: string; studentId: string } | null> {
  if (!userId?.trim() || !isTokenShape(token)) return null;
  const hash = await sha256Hex(token);
  const at = now.toISOString();
  const results = await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO users(id) SELECT id FROM auth_user WHERE id = ?1",
      )
      .bind(userId),
    db
      .prepare(
        `INSERT INTO student_access(organization_id, student_id, user_id)
         SELECT i.organization_id, i.student_id, ?1 FROM student_invites i
         WHERE i.token_hash = ?2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
           AND i.expires_at > ?3 AND ${activeUser("?1")}
           AND NOT EXISTS (SELECT 1 FROM student_access sa
             WHERE sa.organization_id = i.organization_id AND sa.student_id = i.student_id
               AND sa.revoked_at IS NULL AND sa.user_id <> ?1)
         ON CONFLICT(organization_id, student_id, user_id) DO UPDATE SET revoked_at = NULL`,
      )
      .bind(userId, hash, at),
    db
      .prepare(
        `UPDATE student_invites SET accepted_at = ?3, accepted_by_user_id = ?1
         WHERE token_hash = ?2 AND accepted_at IS NULL AND revoked_at IS NULL
           AND expires_at > ?3 AND (SELECT changes()) = 1`,
      )
      .bind(userId, hash, at),
    db
      .prepare(
        `INSERT INTO access_audit_events(id, organization_id, actor_user_id, action, subject_id)
         SELECT ?1, i.organization_id, ?2, 'STUDENT_INVITE_ACCEPTED', i.id
         FROM student_invites i WHERE i.token_hash = ?3 AND (SELECT changes()) = 1`,
      )
      .bind(crypto.randomUUID(), userId, hash),
  ]);
  if (results[2].meta.changes !== 1) return null;
  return db
    .prepare(
      `SELECT organization_id AS organizationId, student_id AS studentId
       FROM student_invites WHERE token_hash = ?1 AND accepted_by_user_id = ?2`,
    )
    .bind(hash, userId)
    .first<{ organizationId: string; studentId: string }>();
}

export interface PortalLink {
  studentId: string;
  studentName: string;
  organizationId: string;
  organizationName: string;
  professionalName: string | null;
  since: string;
}

/** What a client login may open. Nothing else is reachable from the portal. */
export async function portalLinksFor(
  db: D1Database,
  userId: string,
): Promise<PortalLink[]> {
  if (!userId?.trim()) return [];
  const result = await db
    .prepare(
      `SELECT s.id AS studentId, s.display_name AS studentName,
         o.id AS organizationId, o.name AS organizationName, sa.created_at AS since,
         (SELECT p.display_name FROM care_assignments a
            JOIN professionals p ON p.organization_id = a.organization_id AND p.id = a.professional_id
            WHERE a.organization_id = s.organization_id AND a.student_id = s.id
              AND a.revoked_at IS NULL ORDER BY a.created_at LIMIT 1) AS professionalName
       FROM student_access sa
       JOIN students s ON s.organization_id = sa.organization_id AND s.id = sa.student_id
       JOIN organizations o ON o.id = s.organization_id
       WHERE sa.user_id = ?1 AND sa.revoked_at IS NULL AND ${activeUser("?1")}
       ORDER BY sa.created_at, s.id`,
    )
    .bind(userId)
    .all<PortalLink>();
  return result.results;
}
