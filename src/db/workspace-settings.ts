import type { D1Database } from "@cloudflare/workers-types";
import { parseName } from "@/modules/configuracoes/contracts";
import { activeUser, assertContext, type AuthenticatedContext } from "./students";

/**
 * "Configurações" of the professional's workspace: the name of the workspace (only its owner changes
 * it), the display name of each professional (only they change their own) and, read-only, who has
 * access. The workspace and the person come from the verified session, never from the request. Each
 * change is applied only if the membership is active and the login is not blocked, in the very
 * statement that writes it, and leaves a row in the audit trail (who and when, never the names).
 *
 * Both names are read live wherever they are shown, so a change also changes how deliveries already
 * made name who delivered them. The content of a delivered revision does not change.
 */
export const WORKSPACE_RENAMED = "WORKSPACE_RENAMED";
export const PROFESSIONAL_RENAMED = "PROFESSIONAL_RENAMED";

export interface WorkspaceMember {
  name: string;
  role: string;
  isYou: boolean;
}
export interface SettingsView {
  workspaceName: string;
  role: string;
  canRenameWorkspace: boolean;
  /** The acting person's display name; null when they have no professional record (a commercial member). */
  displayName: string | null;
  createdAt: string;
  members: WorkspaceMember[];
}
export type RenameOutcome = { status: "renamed" } | { status: "unchanged" } | { status: "forbidden" };

export function workspaceSettingsFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting login.
  const activeMember = `EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
    AND m.revoked_at IS NULL) AND ${activeUser("?2")}`;
  const audit = (action: string, subjectSql: string, stamp: string) =>
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?3, ?1, ?2, ?4, ${subjectSql}, ?5 WHERE (SELECT changes()) > 0`,
      )
      .bind(organizationId, userId, crypto.randomUUID(), action, stamp);

  async function read(): Promise<SettingsView | null> {
    const me = await db
      .prepare(
        `SELECT o.name AS workspaceName, m.role, o.created_at AS createdAt,
           (SELECT p.display_name FROM professionals p
             WHERE p.organization_id = o.id AND p.user_id = m.user_id) AS displayName
         FROM organizations o
         JOIN memberships m ON m.organization_id = o.id
         WHERE o.id = ?1 AND m.user_id = ?2 AND m.revoked_at IS NULL AND ${activeUser("?2")}`,
      )
      .bind(organizationId, userId)
      .first<{ workspaceName: string; role: string; createdAt: string; displayName: string | null }>();
    if (!me) return null;
    const members = await db
      .prepare(
        `SELECT COALESCE(p.display_name, a.name) AS name, m.role, (m.user_id = ?2) AS isYou
         FROM memberships m
         JOIN users u ON u.id = m.user_id AND u.disabled_at IS NULL
         LEFT JOIN professionals p ON p.organization_id = m.organization_id AND p.user_id = m.user_id
         LEFT JOIN auth_user a ON a.id = m.user_id
         WHERE m.organization_id = ?1 AND m.revoked_at IS NULL
         ORDER BY m.created_at, m.rowid`,
      )
      .bind(organizationId, userId)
      .all<{ name: string | null; role: string; isYou: number }>();
    return {
      ...me,
      canRenameWorkspace: me.role === "OWNER",
      members: members.results.map((row) => ({ name: row.name ?? "Sem nome", role: row.role, isYou: Boolean(row.isYou) })),
    };
  }

  return {
    read,

    /** The owner renames the workspace. Throws a ZodError for a name that is not plain text of 2 to 160 characters. */
    async renameWorkspace(raw: unknown, now = new Date()): Promise<RenameOutcome> {
      const name = parseName(raw);
      const current = await read();
      if (!current?.canRenameWorkspace) return { status: "forbidden" };
      if (current.workspaceName === name) return { status: "unchanged" };
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE organizations SET name = ?3
             WHERE id = ?1 AND name <> ?3 AND ${activeMember}
               AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ?1 AND m.user_id = ?2
                 AND m.role = 'OWNER' AND m.revoked_at IS NULL)`,
          )
          .bind(organizationId, userId, name),
        audit(WORKSPACE_RENAMED, "?1", stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "renamed" } : { status: "forbidden" };
    },

    /** A professional corrects their own display name. Nobody else's. */
    async renameSelf(raw: unknown, now = new Date()): Promise<RenameOutcome> {
      const name = parseName(raw);
      const current = await read();
      if (!current || current.displayName === null) return { status: "forbidden" };
      if (current.displayName === name) return { status: "unchanged" };
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE professionals SET display_name = ?3
             WHERE organization_id = ?1 AND user_id = ?2 AND display_name <> ?3 AND ${activeMember}`,
          )
          .bind(organizationId, userId, name),
        audit(
          PROFESSIONAL_RENAMED,
          "(SELECT p.id FROM professionals p WHERE p.organization_id = ?1 AND p.user_id = ?2)",
          stamp,
        ),
      ]);
      return results[0].meta.changes > 0 ? { status: "renamed" } : { status: "forbidden" };
    },
  };
}
