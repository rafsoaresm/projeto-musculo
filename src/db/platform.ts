import type { D1Database } from "@cloudflare/workers-types";
import { secretsMatch } from "./crypto";

/**
 * Platform manager ("gestor da ferramenta"). This role manages the organizations
 * that hired the tool. It has NO membership and NO care assignment, so it never
 * reaches student records: every query here returns organization/professional
 * data and aggregate counts only. Student names, assessments and plans stay
 * behind studentsFor().
 */
export interface PlatformContext {
  /** From the verified session only. */
  userId: string;
}

export const PLATFORM_AUDIT_ACTIONS = [
  "PLATFORM_ADMIN_ACTIVATED",
  "USER_BLOCKED",
  "USER_UNBLOCKED",
  "TERMS_PUBLISHED_STUDENT",
  "TERMS_PUBLISHED_PROFESSIONAL",
] as const;
export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

export const adminGuard = (user: string) =>
  `EXISTS (SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id
    WHERE pa.user_id = ${user} AND pa.revoked_at IS NULL AND u.disabled_at IS NULL)`;

export interface PlatformSummary {
  organizations: number;
  professionals: number;
  students: number;
  portalAccesses: number;
  blockedProfessionals: number;
}
export interface OrganizationRow {
  id: string;
  name: string;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  members: number;
  students: number;
  portalAccesses: number;
  blockedMembers: number;
}
export interface MemberRow {
  userId: string;
  role: string;
  displayName: string | null;
  email: string;
  revoked: boolean;
  blocked: boolean;
}
export interface PlatformAuditRow {
  id: string;
  action: string;
  createdAt: string;
  actorEmail: string;
  organizationName: string | null;
  subjectEmail: string | null;
}

export async function isPlatformAdmin(db: D1Database, userId: string) {
  if (!userId?.trim()) return false;
  const row = await db
    .prepare(`SELECT 1 AS ok WHERE ${adminGuard("?1")}`)
    .bind(userId)
    .first();
  return row !== null;
}

export type ActivationResult =
  | "activated"
  | "invalid_token"
  | "already_configured"
  | "unavailable";

/**
 * One-time bootstrap. The operator configures PLATFORM_SETUP_TOKEN (>= 32 chars)
 * in the private environment. E-mail addresses never grant this role. It works
 * only while there is no active manager; afterwards the token is inert.
 */
export async function activatePlatformAdmin(
  db: D1Database,
  input: { userId: string; supplied: string; configured: string | undefined },
): Promise<ActivationResult> {
  const { userId, supplied, configured } = input;
  if (!configured || configured.length < 32) return "unavailable";
  if (!userId?.trim() || !(await secretsMatch(supplied ?? "", configured)))
    return "invalid_token";
  const results = await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO users(id) SELECT id FROM auth_user WHERE id = ?1",
      )
      .bind(userId),
    db
      .prepare(
        `INSERT INTO platform_admins(user_id)
         SELECT u.id FROM users u
         WHERE u.id = ?1 AND u.disabled_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM platform_admins WHERE revoked_at IS NULL)
         ON CONFLICT(user_id) DO UPDATE SET revoked_at = NULL`,
      )
      .bind(userId),
    db
      .prepare(
        `INSERT INTO access_audit_events(id, organization_id, actor_user_id, action, subject_id)
         SELECT ?1, NULL, ?2, 'PLATFORM_ADMIN_ACTIVATED', ?2 WHERE (SELECT changes()) = 1`,
      )
      .bind(crypto.randomUUID(), userId),
  ]);
  return results[1].meta.changes === 1 ? "activated" : "already_configured";
}

const organizationColumns = `
  o.id, o.name, o.created_at AS createdAt,
  (SELECT p.display_name FROM memberships m
     JOIN professionals p ON p.organization_id = m.organization_id AND p.user_id = m.user_id
     WHERE m.organization_id = o.id AND m.role = 'OWNER' AND m.revoked_at IS NULL
     ORDER BY m.created_at LIMIT 1) AS ownerName,
  (SELECT au.email FROM memberships m JOIN auth_user au ON au.id = m.user_id
     WHERE m.organization_id = o.id AND m.role = 'OWNER' AND m.revoked_at IS NULL
     ORDER BY m.created_at LIMIT 1) AS ownerEmail,
  (SELECT COUNT(*) FROM memberships m
     WHERE m.organization_id = o.id AND m.revoked_at IS NULL) AS members,
  (SELECT COUNT(*) FROM students s WHERE s.organization_id = o.id) AS students,
  (SELECT COUNT(*) FROM student_access sa
     WHERE sa.organization_id = o.id AND sa.revoked_at IS NULL) AS portalAccesses,
  (SELECT COUNT(*) FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = o.id AND m.revoked_at IS NULL AND u.disabled_at IS NOT NULL) AS blockedMembers`;

export function platformFor(db: D1Database, context: PlatformContext | null) {
  if (!context?.userId?.trim()) throw new Error("AUTHENTICATION_REQUIRED");
  const { userId } = context;
  return {
    async summary(): Promise<PlatformSummary> {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM organizations) AS organizations,
             (SELECT COUNT(*) FROM professionals p JOIN memberships m
                ON m.organization_id = p.organization_id AND m.user_id = p.user_id
                WHERE m.revoked_at IS NULL) AS professionals,
             (SELECT COUNT(*) FROM students) AS students,
             (SELECT COUNT(*) FROM student_access WHERE revoked_at IS NULL) AS portalAccesses,
             (SELECT COUNT(DISTINCT u.id) FROM users u JOIN memberships m ON m.user_id = u.id
                WHERE m.revoked_at IS NULL AND u.disabled_at IS NOT NULL) AS blockedProfessionals
           WHERE ${adminGuard("?1")}`,
        )
        .bind(userId)
        .first<PlatformSummary>();
      if (!row) throw new Error("PLATFORM_ACCESS_REQUIRED");
      return row;
    },
    async listOrganizations(limit = 100): Promise<OrganizationRow[]> {
      const result = await db
        .prepare(
          `SELECT ${organizationColumns} FROM organizations o
           WHERE ${adminGuard("?1")}
           ORDER BY o.created_at DESC, o.id LIMIT ?2`,
        )
        .bind(userId, Math.min(Math.max(limit, 1), 200))
        .all<OrganizationRow>();
      return result.results;
    },
    async findOrganization(organizationId: string): Promise<{
      organization: OrganizationRow;
      members: MemberRow[];
    } | null> {
      const organization = await db
        .prepare(
          `SELECT ${organizationColumns} FROM organizations o
           WHERE o.id = ?2 AND ${adminGuard("?1")}`,
        )
        .bind(userId, organizationId)
        .first<OrganizationRow>();
      if (!organization) return null;
      const members = await db
        .prepare(
          `SELECT m.user_id AS userId, m.role, p.display_name AS displayName, au.email,
                  m.revoked_at IS NOT NULL AS revoked, u.disabled_at IS NOT NULL AS blocked
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           JOIN auth_user au ON au.id = m.user_id
           LEFT JOIN professionals p ON p.organization_id = m.organization_id AND p.user_id = m.user_id
           WHERE m.organization_id = ?2 AND ${adminGuard("?1")}
           ORDER BY m.created_at, m.user_id`,
        )
        .bind(userId, organizationId)
        .all<{
          userId: string;
          role: string;
          displayName: string | null;
          email: string;
          revoked: number;
          blocked: number;
        }>();
      return {
        organization,
        members: members.results.map((member) => ({
          ...member,
          revoked: Boolean(member.revoked),
          blocked: Boolean(member.blocked),
        })),
      };
    },
    /**
     * Blocks or unblocks an identity that belongs to the organization. The
     * manager cannot block itself or another manager, so the platform cannot
     * lock itself out. Identity-level: a blocked person is blocked everywhere.
     */
    async setMemberBlocked(
      organizationId: string,
      targetUserId: string,
      blocked: boolean,
      now = new Date(),
    ) {
      const action: PlatformAuditAction = blocked
        ? "USER_BLOCKED"
        : "USER_UNBLOCKED";
      const results = await db.batch([
        db
          .prepare(
            `UPDATE users SET disabled_at = ?3
             WHERE id = ?2 AND id <> ?1 AND ${adminGuard("?1")}
               AND EXISTS (SELECT 1 FROM memberships m
                 WHERE m.organization_id = ?4 AND m.user_id = users.id)
               AND NOT EXISTS (SELECT 1 FROM platform_admins pa
                 WHERE pa.user_id = users.id AND pa.revoked_at IS NULL)
               AND disabled_at IS ${blocked ? "NULL" : "NOT NULL"}`,
          )
          .bind(
            userId,
            targetUserId,
            blocked ? now.toISOString() : null,
            organizationId,
          ),
        db
          .prepare(
            `INSERT INTO access_audit_events(id, organization_id, actor_user_id, action, subject_id)
             SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT changes()) = 1`,
          )
          .bind(
            crypto.randomUUID(),
            organizationId,
            userId,
            action,
            targetUserId,
          ),
      ]);
      if (results[0].meta.changes !== 1)
        throw new Error("PLATFORM_ACTION_FORBIDDEN");
    },
    async listAudit(limit = 50): Promise<PlatformAuditRow[]> {
      const actions = PLATFORM_AUDIT_ACTIONS.map((a) => `'${a}'`).join(",");
      const result = await db
        .prepare(
          `SELECT a.id, a.action, a.created_at AS createdAt, ao.email AS actorEmail,
                  o.name AS organizationName, su.email AS subjectEmail
           FROM access_audit_events a
           JOIN auth_user ao ON ao.id = a.actor_user_id
           LEFT JOIN organizations o ON o.id = a.organization_id
           LEFT JOIN auth_user su ON su.id = a.subject_id
           WHERE ${adminGuard("?1")} AND a.action IN (${actions})
           ORDER BY a.created_at DESC, a.id LIMIT ?2`,
        )
        .bind(userId, Math.min(Math.max(limit, 1), 200))
        .all<PlatformAuditRow>();
      return result.results;
    },
  };
}
