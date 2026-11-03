import type { D1Database } from "@cloudflare/workers-types";

/**
 * Failed sign-ins (PENDENCIAS B9, slice 0.88). A row says who, when and a coarse reason; never the password, the code, the address of the
 * network or the browser. When the address typed belongs to someone with a profile in the tool, the row names that person, who then sees
 * it in "Minha conta"; otherwise only an HMAC of the address is kept (keyed with the server's secret, so a list of addresses cannot be
 * hashed again to find who was tried without that secret). Nothing is ever deleted: retention (J3, J9, B12) is not decided.
 */
export const SIGN_IN_FAILURE_REASONS = ["PASSWORD", "SECOND_STEP_CODE", "SECOND_STEP_LOCKED"] as const;
export type SignInFailureReason = (typeof SIGN_IN_FAILURE_REASONS)[number];

export const SIGN_IN_FAILURE_LABEL: Record<SignInFailureReason, string> = {
  PASSWORD: "E-mail ou senha errados",
  SECOND_STEP_CODE: "Código da verificação em duas etapas errado",
  SECOND_STEP_LOCKED: "Código tentado com a verificação em duas etapas bloqueada",
};

export interface SignInFailure {
  reason: SignInFailureReason;
  /** ISO timestamp. */
  at: string;
}

/** The address as the library compares it. */
export const normalizeIdentifier = (email: string) => email.trim().toLowerCase();

/** HMAC-SHA-256 of the normalized address, in hex (64 characters). */
export async function identifierHash(secret: string, email: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`sign-in-failure:${normalizeIdentifier(email)}`));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A failed password. The person is found by the address; someone without a profile in the tool (or no account at all) is kept only as
 * the hash. The same statements run either way, so the answer does not take longer for an address that exists.
 */
export async function recordPasswordFailure(db: D1Database, secret: string, email: string, now = new Date()) {
  const address = normalizeIdentifier(email);
  if (!address || address.length > 320) return;
  const hash = await identifierHash(secret, address);
  await db
    .prepare(
      `INSERT INTO sign_in_failures (id, user_id, identifier_hash, reason, created_at)
       SELECT ?1, u.id, CASE WHEN u.id IS NULL THEN ?3 ELSE NULL END, 'PASSWORD', ?4
       FROM (SELECT 1) LEFT JOIN auth_user a ON a.email = ?2 LEFT JOIN users u ON u.id = a.id`,
    )
    .bind(crypto.randomUUID(), address, hash, now.toISOString())
    .run();
}

/** A wrong code of the second step, for the person the library had already identified by the password. */
export async function recordSecondStepFailure(db: D1Database, userId: string, reason: Exclude<SignInFailureReason, "PASSWORD">, now = new Date()) {
  if (!userId) return;
  await db
    .prepare(
      `INSERT INTO sign_in_failures (id, user_id, identifier_hash, reason, created_at)
       SELECT ?1, u.id, NULL, ?3, ?4 FROM users u WHERE u.id = ?2`,
    )
    .bind(crypto.randomUUID(), userId, reason, now.toISOString())
    .run();
}

/** The latest failed sign-ins of the person of the verified session, newest first. */
export async function recentSignInFailures(db: D1Database, userId: string, limit = 10): Promise<SignInFailure[]> {
  if (!userId) throw new Error("A verified session is required.");
  const result = await db
    .prepare(
      `SELECT reason, created_at AS at FROM sign_in_failures WHERE user_id = ?1
       ORDER BY created_at DESC, id LIMIT ?2`,
    )
    .bind(userId, Math.min(Math.max(limit, 1), 50))
    .all<SignInFailure>();
  return result.results;
}
