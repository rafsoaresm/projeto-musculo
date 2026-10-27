import type { D1Database } from "@cloudflare/workers-types";
import { activeUser } from "./students";
import { deviceLabel } from "@/modules/auth/device";

/**
 * "Minha conta": where this login is open and when it was entered. Everything is about the person of the
 * verified session; nothing is read from a request. A session is a row of the authentication library, so
 * its token is never selected (it is the key to the account), nor the address it came from. The label of
 * the browser is derived here and the raw header goes no further.
 *
 * Disconnecting one device deletes that session in a statement that repeats whose it is, that it is not the
 * session making the request (that one has its own "Sair") and that the login is not blocked, and leaves a
 * line in the trail only if a row went away.
 */
export const DEVICE_DISCONNECTED = "DEVICE_DISCONNECTED";
export const SIGN_IN = "SIGN_IN";

export interface Device {
  id: string;
  label: string;
  isCurrent: boolean;
  /** ISO timestamps. The library renews a session once a day, so there is no honest "last activity". */
  enteredAt: string;
  expiresAt: string;
}

export function accountAccessFor(db: D1Database, userId: string, currentSessionId: string) {
  if (!userId || !currentSessionId) throw new Error("A verified session is required.");
  return {
    async devices(now = new Date()): Promise<Device[]> {
      const result = await db
        .prepare(
          `SELECT id, user_agent AS userAgent, created_at AS createdAt, expires_at AS expiresAt
           FROM auth_session WHERE user_id = ?1 AND expires_at > ?2
           ORDER BY created_at DESC, id LIMIT 25`,
        )
        .bind(userId, now.getTime())
        .all<{ id: string; userAgent: string | null; createdAt: number; expiresAt: number }>();
      return result.results.map((row) => ({
        id: row.id,
        label: deviceLabel(row.userAgent),
        isCurrent: row.id === currentSessionId,
        enteredAt: new Date(row.createdAt).toISOString(),
        expiresAt: new Date(row.expiresAt).toISOString(),
      }));
    },

    /** The latest sign-ins of this person, newest first. */
    async recentSignIns(limit = 10): Promise<string[]> {
      const result = await db
        .prepare(
          `SELECT created_at AS createdAt FROM access_audit_events
           WHERE actor_user_id = ?1 AND action = '${SIGN_IN}'
           ORDER BY created_at DESC, id LIMIT ?2`,
        )
        .bind(userId, Math.min(Math.max(limit, 1), 50))
        .all<{ createdAt: string }>();
      return result.results.map((row) => row.createdAt);
    },

    async disconnect(sessionId: string, now = new Date()): Promise<boolean> {
      const event = crypto.randomUUID();
      const results = await db.batch([
        db
          .prepare(
            `DELETE FROM auth_session WHERE id = ?1 AND user_id = ?2 AND id <> ?3 AND ${activeUser("?2")}`,
          )
          .bind(sessionId, userId, currentSessionId),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, NULL, ?2, '${DEVICE_DISCONNECTED}', ?2, ?3 WHERE (SELECT changes()) > 0`,
          )
          .bind(event, userId, now.toISOString()),
      ]);
      return results[1].meta.changes > 0;
    },
  };
}
