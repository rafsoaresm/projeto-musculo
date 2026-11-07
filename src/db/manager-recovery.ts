import type { D1Database } from "@cloudflare/workers-types";
import { secretsMatch } from "./crypto";

/**
 * The last platform manager lost the authenticator app and the recovery codes (PENDENCIAS B16, B2; slice 0.89).
 *
 * Nobody in the tool can reset that person's second step: a manager never resets their own, and there is no other
 * manager. E-mail is not configured yet (R1), so no link can be sent. What the operator does have is the
 * PLATFORM_SETUP_TOKEN of the private environment, the same secret that activated the first manager. On a page of its
 * own, that secret AND the manager's own e-mail and password turn off ONLY the second step of that one manager:
 *
 * - nothing else changes: not the password, not the e-mail, not the role; every session of the person ends;
 * - it works only while the person is an active manager (not blocked, not ended), has the second step on, and is the
 *   only active manager. With another active manager, that one resets it in Gestor > Gestores (and that is audited
 *   there), so the environment secret is not needed and is refused;
 * - each attempt counts in a bucket per address before anything is checked; the answer for a wrong secret says
 *   nothing about the account;
 * - a line in the managers' trail says it happened, with the person as both who and whom (there is nobody else).
 *
 * The reset and its trail line are one batch, guarded by the same conditions, so a concurrent change (another
 * manager accepted an invitation, the person was blocked) makes it write nothing.
 */

/** Attempts per address in a window. The tool's own choice for a rare, sensitive action (stricter than signing in). */
export const MANAGER_RECOVERY_ATTEMPTS = 5;
export const MANAGER_RECOVERY_WINDOW_SECONDS = 15 * 60;

export type ManagerRecoveryResult =
  /** The secret is not configured (or is shorter than 32 characters) in this environment. */
  | "unavailable"
  | "rate_limited"
  | "invalid_token"
  /** The e-mail and password do not match an account. */
  | "invalid_credentials"
  /** The account is not an active manager with the second step on (or is blocked). */
  | "not_applicable"
  /** Another active manager exists and can reset it in Gestor > Gestores. */
  | "other_manager"
  | "reset";

export interface ManagerRecoveryInput {
  email: unknown;
  password: unknown;
  supplied: unknown;
  configured: string | undefined;
  /** The edge-provided address; null shares one bucket rather than skipping the limit. */
  address: string | null;
  /** The authentication library's own check of a stored password hash. */
  verifyPassword: (data: { password: string; hash: string }) => Promise<boolean>;
  now?: Date;
}

const text = (value: unknown, max: number) => (typeof value === "string" && value.length <= max ? value : "");

/** Counts this attempt and says whether it is still within the limit. One statement, so two at once both count. */
async function withinLimit(
  db: D1Database,
  address: string | null,
  now: Date,
  bucket = "manager-two-factor-recovery",
): Promise<boolean> {
  const stamp = now.getTime();
  const row = await db
    .prepare(
      `INSERT INTO auth_rate_limit (id, key, count, last_request) VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN auth_rate_limit.last_request <= ?3 - ?4 THEN 1 ELSE auth_rate_limit.count + 1 END,
         last_request = CASE WHEN auth_rate_limit.last_request <= ?3 - ?4 THEN ?3 ELSE auth_rate_limit.last_request END
       RETURNING count`,
    )
    .bind(crypto.randomUUID(), `${bucket}|${address ?? "shared"}`, stamp, MANAGER_RECOVERY_WINDOW_SECONDS * 1000)
    .first<{ count: number }>();
  return (row?.count ?? Number.POSITIVE_INFINITY) <= MANAGER_RECOVERY_ATTEMPTS;
}

const activeManager = (user: string) =>
  `EXISTS (SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id
    WHERE pa.user_id = ${user} AND pa.revoked_at IS NULL AND u.disabled_at IS NULL)`;
const noOtherManager = (user: string) =>
  `NOT EXISTS (SELECT 1 FROM platform_admins pa JOIN users u ON u.id = pa.user_id
    WHERE pa.user_id <> ${user} AND pa.revoked_at IS NULL AND u.disabled_at IS NULL)`;

export async function recoverLastManagerTwoFactor(db: D1Database, input: ManagerRecoveryInput): Promise<ManagerRecoveryResult> {
  const now = input.now ?? new Date();
  const { configured } = input;
  if (!configured || configured.length < 32) return "unavailable";
  if (!(await withinLimit(db, input.address, now))) return "rate_limited";
  if (!(await secretsMatch(text(input.supplied, 256).trim(), configured))) return "invalid_token";

  const email = text(input.email, 254).trim().toLowerCase();
  const password = text(input.password, 128);
  if (!email || !password) return "invalid_credentials";
  const account = await db
    .prepare(
      `SELECT au.id, a.password AS hash FROM auth_user au
       JOIN auth_account a ON a.user_id = au.id AND a.provider_id = 'credential'
       WHERE au.email = ?1`,
    )
    .bind(email)
    .first<{ id: string; hash: string | null }>();
  if (!account?.hash || !(await input.verifyPassword({ password, hash: account.hash }).catch(() => false)))
    return "invalid_credentials";

  const state = await db
    .prepare(
      `SELECT ${activeManager("?1")} AS manager, ${noOtherManager("?1")} AS alone,
              (SELECT two_factor_enabled FROM auth_user WHERE id = ?1) AS secondStep`,
    )
    .bind(account.id)
    .first<{ manager: number; alone: number; secondStep: number }>();
  if (!state || Number(state.manager) !== 1 || Number(state.secondStep) !== 1) return "not_applicable";
  if (Number(state.alone) !== 1) return "other_manager";

  const event = crypto.randomUUID();
  const done = `EXISTS (SELECT 1 FROM access_audit_events WHERE id = ?2)`;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE auth_user SET two_factor_enabled = 0, updated_at = ?3
         WHERE id = ?1 AND two_factor_enabled = 1 AND ${activeManager("?1")} AND ${noOtherManager("?1")}`,
      )
      .bind(account.id, event, now.getTime()),
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?2, NULL, ?1, 'PLATFORM_TWO_FACTOR_RECOVERED', ?1, ?3 WHERE (SELECT changes()) > 0`,
      )
      .bind(account.id, event, now.toISOString()),
    db.prepare(`DELETE FROM auth_two_factor WHERE user_id = ?1 AND ${done}`).bind(account.id, event),
    db.prepare(`DELETE FROM auth_session WHERE user_id = ?1 AND ${done}`).bind(account.id, event),
  ]);
  return results[1].meta.changes > 0 ? "reset" : "not_applicable";
}

/**
 * The last manager forgot the PASSWORD (slice 0.101.1). E-mail is not configured (R1), so no link can be sent, and the
 * database console of the host does not always let the operator edit a row. The same environment secret that activates the
 * first manager and recovers the second step now also sets a new password, on the same terms:
 *
 * - the secret is required, and the person is named by e-mail (the old password is, by definition, unknown);
 * - it works only while the account is an active manager (not blocked, not ended) AND is the only active manager. With
 *   another active manager the page refuses, and the other one handles it; so the secret never reaches anyone else's account;
 * - a manager and no one else: any other account (professional, student, a manager who is not alone) is refused with the same
 *   answer, and a wrong secret says nothing about the account;
 * - the new password follows the library's rule (12 to 128 characters) and is hashed by the library's own function;
 * - nothing else changes: not the e-mail, not the role, not the second step (it stays on, if it was); every session of the
 *   person ends; a line in the managers' trail says it happened, with the person as both who and whom;
 * - its own counter per address (a separate bucket from the second-step recovery), counted before anything is checked.
 *
 * The password change, the trail line and the end of the sessions are one batch under the same conditions, so a concurrent
 * change (another manager accepted an invitation, the person was blocked) makes it write nothing.
 */
export const MANAGER_PASSWORD_MIN = 12;
export const MANAGER_PASSWORD_MAX = 128;

export type ManagerPasswordRecoveryResult =
  | "unavailable"
  | "rate_limited"
  | "invalid_token"
  /** The e-mail is empty, or the new password is outside 12 to 128 characters or the confirmation differs. */
  | "invalid_input"
  /** Not an active manager with a password sign-in. */
  | "not_applicable"
  /** Another active manager exists and can be asked instead. */
  | "other_manager"
  | "reset";

export interface ManagerPasswordRecoveryInput {
  email: unknown;
  newPassword: unknown;
  confirmation: unknown;
  supplied: unknown;
  configured: string | undefined;
  address: string | null;
  /** The authentication library's own password hash, so the new hash is checked by its own sign-in. */
  hashPassword: (password: string) => Promise<string>;
  now?: Date;
}

export async function recoverLastManagerPassword(
  db: D1Database,
  input: ManagerPasswordRecoveryInput,
): Promise<ManagerPasswordRecoveryResult> {
  const now = input.now ?? new Date();
  const { configured } = input;
  if (!configured || configured.length < 32) return "unavailable";
  if (!(await withinLimit(db, input.address, now, "manager-password-recovery"))) return "rate_limited";
  if (!(await secretsMatch(text(input.supplied, 256).trim(), configured))) return "invalid_token";

  const email = text(input.email, 254).trim().toLowerCase();
  const password = text(input.newPassword, MANAGER_PASSWORD_MAX);
  if (
    !email ||
    password.length < MANAGER_PASSWORD_MIN ||
    password.length > MANAGER_PASSWORD_MAX ||
    password !== text(input.confirmation, MANAGER_PASSWORD_MAX)
  )
    return "invalid_input";

  const account = await db
    .prepare(
      `SELECT au.id FROM auth_user au
       JOIN auth_account a ON a.user_id = au.id AND a.provider_id = 'credential'
       WHERE au.email = ?1`,
    )
    .bind(email)
    .first<{ id: string }>();
  if (!account) return "not_applicable";

  const state = await db
    .prepare(`SELECT ${activeManager("?1")} AS manager, ${noOtherManager("?1")} AS alone`)
    .bind(account.id)
    .first<{ manager: number; alone: number }>();
  if (!state || Number(state.manager) !== 1) return "not_applicable";
  if (Number(state.alone) !== 1) return "other_manager";

  const hash = await input.hashPassword(password);
  const event = crypto.randomUUID();
  const done = `EXISTS (SELECT 1 FROM access_audit_events WHERE id = ?2)`;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE auth_account SET password = ?4, updated_at = ?3
         WHERE user_id = ?1 AND provider_id = 'credential' AND ${activeManager("?1")} AND ${noOtherManager("?1")}`,
      )
      .bind(account.id, event, now.getTime(), hash),
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?2, NULL, ?1, 'PLATFORM_PASSWORD_RECOVERED', ?1, ?3 WHERE (SELECT changes()) > 0`,
      )
      .bind(account.id, event, now.toISOString()),
    db.prepare(`DELETE FROM auth_session WHERE user_id = ?1 AND ${done}`).bind(account.id, event),
  ]);
  return results[1].meta.changes > 0 ? "reset" : "not_applicable";
}
