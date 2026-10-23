import type { D1Database } from "@cloudflare/workers-types";
import type { SurfaceId } from "@/modules/platform/surfaces";

/**
 * Which areas an identity may enter, recomputed on every request. Blocked or
 * unknown identities get none. Holding a surface never grants data access by
 * itself: each repository still checks organization, link and revocation.
 */
export async function surfacesFor(
  db: D1Database,
  userId: string,
): Promise<SurfaceId[]> {
  if (!userId?.trim()) return [];
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM platform_admins pa
           WHERE pa.user_id = ?1 AND pa.revoked_at IS NULL) AS gestor,
         EXISTS (SELECT 1 FROM memberships m
           WHERE m.user_id = ?1 AND m.revoked_at IS NULL) AS profissional,
         EXISTS (SELECT 1 FROM student_access sa
           WHERE sa.user_id = ?1 AND sa.revoked_at IS NULL) AS aluno
       WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = ?1 AND u.disabled_at IS NULL)`,
    )
    .bind(userId)
    .first<Record<SurfaceId, number>>();
  if (!row) return [];
  return (["gestor", "profissional", "aluno"] as const).filter((id) =>
    Boolean(row[id]),
  );
}

/**
 * A login whose client link was revoked must not be pushed into professional
 * onboarding: it is told its access is no longer active instead.
 */
export async function hadStudentAccess(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  if (!userId?.trim()) return false;
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM student_access WHERE user_id = ?1 AND revoked_at IS NOT NULL LIMIT 1",
    )
    .bind(userId)
    .first();
  return row !== null;
}
