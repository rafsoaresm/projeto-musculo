import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";

export const workspaceInput = z.object({
  name: z.string().trim().min(2).max(160),
  professionalName: z.string().trim().min(2).max(160),
});
export interface Workspace {
  id: string;
  name: string;
  role: string;
}
export async function workspaceFor(db: D1Database, userId: string) {
  // This slice has one active workspace. A future selector must validate membership.
  return db
    .prepare(
      `SELECT o.id, o.name, m.role FROM organizations o
    JOIN memberships m ON m.organization_id = o.id
    JOIN users u ON u.id = m.user_id
    WHERE m.user_id = ? AND m.revoked_at IS NULL AND u.disabled_at IS NULL
    ORDER BY m.created_at, o.id LIMIT 1`,
    )
    .bind(userId)
    .first<Workspace>();
}
/** userId MUST be obtained from the verified auth session. */
export async function provisionWorkspace(
  db: D1Database,
  userId: string,
  input: unknown,
) {
  const data = workspaceInput.parse(input);
  const existing = await workspaceFor(db, userId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const professionalId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO users(id) SELECT id FROM auth_user WHERE id = ?",
      )
      .bind(userId),
    db
      .prepare(
        "INSERT INTO organizations(id,name) SELECT ?,? FROM users WHERE id = ? AND disabled_at IS NULL",
      )
      .bind(id, data.name, userId),
    // Unique user key makes concurrent/replayed provisioning roll back as a unit.
    db
      .prepare(
        "INSERT INTO organization_provisioning(user_id,organization_id) SELECT ?,id FROM organizations WHERE id = ?",
      )
      .bind(userId, id),
    db
      .prepare(
        "INSERT INTO memberships(organization_id,user_id,role) SELECT id,?,'OWNER' FROM organizations WHERE id = ?",
      )
      .bind(userId, id),
    db
      .prepare(
        "INSERT INTO professionals(id,organization_id,user_id,display_name) SELECT ?,id,?,? FROM organizations WHERE id = ?",
      )
      .bind(professionalId, userId, data.professionalName, id),
    db
      .prepare(
        "INSERT INTO audit_events(id,organization_id,actor_user_id,action,subject_id) SELECT ?,id,?,'ORGANIZATION_CREATED',id FROM organizations WHERE id = ?",
      )
      .bind(crypto.randomUUID(), userId, id),
  ]);
  const workspace = await workspaceFor(db, userId);
  if (!workspace) throw new Error("PROVISIONING_FORBIDDEN");
  return workspace;
}
