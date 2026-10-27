import type { D1Database } from "@cloudflare/workers-types";
import { isTokenShape, newToken, secretsMatch, sha256Hex } from "./crypto";

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
  "TERMS_DRAFT_DISCARDED_STUDENT",
  "TERMS_DRAFT_DISCARDED_PROFESSIONAL",
  "PLATFORM_TWO_FACTOR_RESET",
  "PLATFORM_ADMIN_INVITED",
  "PLATFORM_ADMIN_INVITE_REVOKED",
  "PLATFORM_ADMIN_GRANTED",
  "PLATFORM_ADMIN_REVOKED",
] as const;

/** How long an invitation to be a manager lives. The link is shown once and works once. */
export const MANAGER_INVITE_HOURS = 48;
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
  /** Requests from students about their own data that nobody answered yet, and the ones past the deadline. */
  requestsOpen: number;
  requestsOverdue: number;
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
  /** Counts only, never who asked or what: requests of students about their data, open and past the deadline. */
  requestsOpen: number;
  requestsOverdue: number;
}
export interface MemberRow {
  userId: string;
  role: string;
  displayName: string | null;
  email: string;
  revoked: boolean;
  blocked: boolean;
  /** The second step of the sign-in is on for this person. A fact, never the secret. */
  twoFactor: boolean;
}
export interface PlatformAuditRow {
  id: string;
  action: string;
  createdAt: string;
  actorEmail: string;
  organizationName: string | null;
  subjectEmail: string | null;
}

export interface ManagerRow {
  userId: string;
  name: string;
  email: string;
  since: string;
  /** Who issued the invitation they came through; null for the one activated with the setup token. */
  invitedByEmail: string | null;
  revoked: boolean;
  self: boolean;
  twoFactor: boolean;
}
export type ManagerInviteStatus = "OPEN" | "USED" | "EXPIRED" | "REVOKED" | "LAPSED";
export interface ManagerInviteRow {
  id: string;
  label: string | null;
  createdByEmail: string;
  createdAt: string;
  expiresAt: string;
  status: ManagerInviteStatus;
  acceptedByEmail: string | null;
}
export interface ManagerInvitePreview {
  issuerName: string;
  expiresAt: string;
}
export type AcceptManagerInviteResult = "accepted" | "unavailable";

/** The label is a reminder for whoever issues the link; one line, no markup. */
export const normalizeInviteLabel = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const label = value.replace(/\s+/g, " ").trim();
  if (label.length === 0) return null;
  if (label.length > 80) throw new Error("INVITE_LABEL_TOO_LONG");
  return label;
};

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

/**
 * What the person with the link sees before accepting: who invited them. The same answer, null, for a
 * link that is used, expired, cancelled, from someone who is no longer a manager, or unknown.
 */
export async function previewManagerInvite(
  db: D1Database,
  token: unknown,
  now = new Date(),
): Promise<ManagerInvitePreview | null> {
  if (!isTokenShape(token)) return null;
  const row = await db
    .prepare(
      `SELECT au.name AS issuerName, i.expires_at AS expiresAt
       FROM platform_admin_invites i
       JOIN auth_user au ON au.id = i.created_by_user_id
       WHERE i.token_hash = ?1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?2
         AND ${adminGuard("i.created_by_user_id")}`,
    )
    .bind(await sha256Hex(token), now.toISOString())
    .first<ManagerInvitePreview>();
  return row ?? null;
}

/**
 * Makes the signed-in person a manager through an invitation link. The role comes from the link and
 * from nothing else: not from the e-mail of the account, not from a form field. All in one batch, so
 * the link is used up exactly when the role is granted, and the database refuses to accept a link that
 * is expired, already ended, or from someone who stopped being a manager.
 */
export async function acceptManagerInvite(
  db: D1Database,
  input: { userId: string; token: unknown; now?: Date },
): Promise<AcceptManagerInviteResult> {
  const { userId, token } = input;
  const now = input.now ?? new Date();
  if (!userId?.trim() || !isTokenShape(token)) return "unavailable";
  const hash = await sha256Hex(token);
  const stamp = now.toISOString();
  try {
    const results = await db.batch([
      db
        .prepare("INSERT OR IGNORE INTO users(id) SELECT id FROM auth_user WHERE id = ?1")
        .bind(userId),
      db
        .prepare(
          `UPDATE platform_admin_invites SET accepted_at = ?3, accepted_by_user_id = ?1
           WHERE token_hash = ?2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?3
             AND EXISTS (SELECT 1 FROM users u WHERE u.id = ?1 AND u.disabled_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = ?1 AND pa.revoked_at IS NULL)`,
        )
        .bind(userId, hash, stamp),
      db
        .prepare(
          `INSERT INTO platform_admins(user_id, created_at)
           SELECT ?1, ?2 WHERE (SELECT changes()) = 1
           ON CONFLICT(user_id) DO UPDATE SET revoked_at = NULL, created_at = ?2`,
        )
        .bind(userId, stamp),
      db
        .prepare(
          `INSERT INTO access_audit_events(id, organization_id, actor_user_id, action, subject_id, created_at)
           SELECT ?1, NULL, ?2, 'PLATFORM_ADMIN_GRANTED', ?2, ?3
           WHERE EXISTS (SELECT 1 FROM platform_admin_invites WHERE token_hash = ?4 AND accepted_by_user_id = ?2 AND accepted_at = ?3)`,
        )
        .bind(crypto.randomUUID(), userId, stamp, hash),
    ]);
    return results[1].meta.changes === 1 ? "accepted" : "unavailable";
  } catch (error) {
    // The database refused: expired between the check and the write, or the issuer is no longer a manager.
    if (String(error).includes("PLATFORM_INVITE_NOT_OPEN")) return "unavailable";
    throw error;
  }
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
     WHERE m.organization_id = o.id AND m.revoked_at IS NULL AND u.disabled_at IS NOT NULL) AS blockedMembers,
  (SELECT COUNT(*) FROM data_subject_requests r
     WHERE r.organization_id = o.id
       AND NOT EXISTS (SELECT 1 FROM data_subject_request_outcomes x WHERE x.request_id = r.id)) AS requestsOpen,
  (SELECT COUNT(*) FROM data_subject_requests r
     WHERE r.organization_id = o.id AND r.due_at < ?3
       AND NOT EXISTS (SELECT 1 FROM data_subject_request_outcomes x WHERE x.request_id = r.id)) AS requestsOverdue`;

export function platformFor(db: D1Database, context: PlatformContext | null) {
  if (!context?.userId?.trim()) throw new Error("AUTHENTICATION_REQUIRED");
  const { userId } = context;
  return {
    async summary(now = new Date()): Promise<PlatformSummary> {
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
                WHERE m.revoked_at IS NULL AND u.disabled_at IS NOT NULL) AS blockedProfessionals,
             (SELECT COUNT(*) FROM data_subject_requests r
                WHERE NOT EXISTS (SELECT 1 FROM data_subject_request_outcomes x WHERE x.request_id = r.id)) AS requestsOpen,
             (SELECT COUNT(*) FROM data_subject_requests r WHERE r.due_at < ?2
                AND NOT EXISTS (SELECT 1 FROM data_subject_request_outcomes x WHERE x.request_id = r.id)) AS requestsOverdue
           WHERE ${adminGuard("?1")}`,
        )
        .bind(userId, now.toISOString())
        .first<PlatformSummary>();
      if (!row) throw new Error("PLATFORM_ACCESS_REQUIRED");
      return row;
    },
    async listOrganizations(limit = 100, now = new Date()): Promise<OrganizationRow[]> {
      const result = await db
        .prepare(
          `SELECT ${organizationColumns} FROM organizations o
           WHERE ${adminGuard("?1")}
           ORDER BY o.created_at DESC, o.id LIMIT ?2`,
        )
        .bind(userId, Math.min(Math.max(limit, 1), 200), now.toISOString())
        .all<OrganizationRow>();
      return result.results;
    },
    async findOrganization(organizationId: string, now = new Date()): Promise<{
      organization: OrganizationRow;
      members: MemberRow[];
    } | null> {
      const organization = await db
        .prepare(
          `SELECT ${organizationColumns} FROM organizations o
           WHERE o.id = ?2 AND ${adminGuard("?1")}`,
        )
        .bind(userId, organizationId, now.toISOString())
        .first<OrganizationRow>();
      if (!organization) return null;
      const members = await db
        .prepare(
          `SELECT m.user_id AS userId, m.role, p.display_name AS displayName, au.email,
                  m.revoked_at IS NOT NULL AS revoked, u.disabled_at IS NOT NULL AS blocked,
                  au.two_factor_enabled AS twoFactor
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
          twoFactor: number;
        }>();
      return {
        organization,
        members: members.results.map((member) => ({
          ...member,
          revoked: Boolean(member.revoked),
          blocked: Boolean(member.blocked),
          twoFactor: Boolean(member.twoFactor),
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
    /** The managers, current and former. Only managers read this. */
    async listManagers(): Promise<ManagerRow[]> {
      const result = await db
        .prepare(
          `SELECT pa.user_id AS userId, au.name, au.email, pa.created_at AS since,
                  (SELECT ci.email FROM platform_admin_invites i JOIN auth_user ci ON ci.id = i.created_by_user_id
                   WHERE i.accepted_by_user_id = pa.user_id ORDER BY i.accepted_at DESC LIMIT 1) AS invitedByEmail,
                  pa.revoked_at IS NOT NULL AS revoked, pa.user_id = ?1 AS self,
                  au.two_factor_enabled AS twoFactor
           FROM platform_admins pa JOIN auth_user au ON au.id = pa.user_id
           WHERE ${adminGuard("?1")}
           ORDER BY pa.revoked_at IS NOT NULL, pa.created_at, pa.user_id`,
        )
        .bind(userId)
        .all<Omit<ManagerRow, "revoked" | "self" | "twoFactor"> & { revoked: number; self: number; twoFactor: number }>();
      return result.results.map((row) => ({
        ...row,
        revoked: Boolean(row.revoked),
        self: Boolean(row.self),
        twoFactor: Boolean(row.twoFactor),
      }));
    },

    /** The invitations, newest first. The link itself is never here: only its hash exists. */
    async listManagerInvites(limit = 20, now = new Date()): Promise<ManagerInviteRow[]> {
      const stamp = now.toISOString();
      const result = await db
        .prepare(
          `SELECT i.id, i.label, cb.email AS createdByEmail, i.created_at AS createdAt, i.expires_at AS expiresAt,
                  ab.email AS acceptedByEmail,
                  CASE WHEN i.accepted_at IS NOT NULL THEN 'USED'
                       WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'
                       WHEN i.expires_at <= ?3 THEN 'EXPIRED'
                       WHEN NOT ${adminGuard("i.created_by_user_id")} THEN 'LAPSED'
                       ELSE 'OPEN' END AS status
           FROM platform_admin_invites i
           JOIN auth_user cb ON cb.id = i.created_by_user_id
           LEFT JOIN auth_user ab ON ab.id = i.accepted_by_user_id
           WHERE ${adminGuard("?1")}
           ORDER BY i.created_at DESC, i.id LIMIT ?2`,
        )
        .bind(userId, Math.min(Math.max(limit, 1), 100), stamp)
        .all<ManagerInviteRow>();
      return result.results;
    },

    /**
     * Issues an invitation and returns the raw link token ONCE: only its hash is stored. The invitee
     * becomes a manager only by opening the link signed in to their own account.
     */
    async inviteManager(label: unknown, now = new Date()): Promise<{ token: string; expiresAt: string }> {
      const reminder = normalizeInviteLabel(label);
      const token = newToken();
      const expiresAt = new Date(now.getTime() + MANAGER_INVITE_HOURS * 60 * 60 * 1000).toISOString();
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO platform_admin_invites (id, token_hash, created_by_user_id, label, created_at, expires_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ${adminGuard("?3")}`,
          )
          .bind(id, await sha256Hex(token), userId, reminder, stamp, expiresAt),
        db
          .prepare(
            `INSERT INTO access_audit_events(id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, NULL, ?2, 'PLATFORM_ADMIN_INVITED', ?3, ?4 WHERE (SELECT changes()) = 1`,
          )
          .bind(crypto.randomUUID(), userId, id, stamp),
      ]);
      if (results[0].meta.changes !== 1) throw new Error("PLATFORM_ACCESS_REQUIRED");
      return { token, expiresAt };
    },

    /** Cancels an invitation that is still open. */
    async revokeManagerInvite(inviteId: string, now = new Date()): Promise<boolean> {
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE platform_admin_invites SET revoked_at = ?3, revoked_by_user_id = ?1
             WHERE id = ?2 AND accepted_at IS NULL AND revoked_at IS NULL AND ${adminGuard("?1")}`,
          )
          .bind(userId, inviteId, stamp),
        db
          .prepare(
            `INSERT INTO access_audit_events(id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, NULL, ?2, 'PLATFORM_ADMIN_INVITE_REVOKED', ?3, ?4 WHERE (SELECT changes()) = 1`,
          )
          .bind(crypto.randomUUID(), userId, inviteId, stamp),
      ]);
      return results[0].meta.changes === 1;
    },

    /**
     * Ends another manager's access, at once: every check reads `platform_admins` on each request.
     * A manager cannot end their own, so there is always at least the one acting. If the last manager
     * is lost, the setup token of the environment works again (it only works while there is none).
     */
    async revokeManager(targetUserId: string, now = new Date()): Promise<boolean> {
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE platform_admins SET revoked_at = ?3
             WHERE user_id = ?2 AND user_id <> ?1 AND revoked_at IS NULL AND ${adminGuard("?1")}`,
          )
          .bind(userId, targetUserId, stamp),
        db
          .prepare(
            `INSERT INTO access_audit_events(id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, NULL, ?2, 'PLATFORM_ADMIN_REVOKED', ?3, ?4 WHERE (SELECT changes()) = 1`,
          )
          .bind(crypto.randomUUID(), userId, targetUserId, stamp),
      ]);
      return results[0].meta.changes === 1;
    },

    /**
     * Turns the second step of the sign-in off for someone who can no longer use it (the phone and the
     * recovery codes are lost). Only for another manager or for someone who belongs to an organization:
     * never oneself (a manager turns their own off with their password), and never a student. Everything
     * happens in one batch or nothing does: the flag goes down (the database writes its own line for
     * that), a line names who did it, the secrets are deleted and every session of that person ends, so
     * they come back with the password alone and may start the second step again. The manager must have
     * checked, by another way, that it is that person asking: the tool cannot.
     */
    async resetTwoFactor(targetUserId: string, now = new Date()): Promise<boolean> {
      const event = crypto.randomUUID();
      const stamp = now.toISOString();
      const done = `EXISTS (SELECT 1 FROM access_audit_events WHERE id = ?3)`;
      const results = await db.batch([
        db
          .prepare(
            `UPDATE auth_user SET two_factor_enabled = 0, updated_at = ?4
             WHERE id = ?2 AND id <> ?1 AND two_factor_enabled = 1 AND ${adminGuard("?1")}
               AND (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = auth_user.id)
                 OR EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = auth_user.id AND pa.revoked_at IS NULL))`,
          )
          .bind(userId, targetUserId, event, now.getTime()),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?3, NULL, ?1, 'PLATFORM_TWO_FACTOR_RESET', ?2, ?4 WHERE (SELECT changes()) > 0`,
          )
          .bind(userId, targetUserId, event, stamp),
        db.prepare(`DELETE FROM auth_two_factor WHERE user_id = ?2 AND ${done}`).bind(userId, targetUserId, event),
        db.prepare(`DELETE FROM auth_session WHERE user_id = ?2 AND ${done}`).bind(userId, targetUserId, event),
      ]);
      return results[1].meta.changes > 0;
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
