import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import type { PasswordResetSender } from "@/modules/email/service";
import * as schema from "./schema";
import { recordPasswordFailure, recordSecondStepFailure } from "@/db/sign-in-failures";

export interface AuthSettings {
  secret: string;
  origin: string;
  basePath: string;
  /**
   * Sends the link that sets a new password. Without it the recovery does not exist at all: the
   * endpoints are closed, not just empty.
   */
  email?: PasswordResetSender | null;
  /** Keeps work going after the response (the Worker's waitUntil). Without it the library awaits. */
  background?: (promise: Promise<unknown>) => void;
}

/** The two routes that finish a sign-in which asked for the code of the second step. */
const SECOND_STEP_ROUTES = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);
/**
 * TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE is left out on purpose: the library discards the pending sign-in before it throws it, so that last
 * attempt cannot be tied to anyone (PENDENCIAS).
 */
const WRONG_CODE = new Set(["INVALID_CODE", "INVALID_BACKUP_CODE"]);

/**
 * A line for each failed sign-in (PENDENCIAS B9, slice 0.88): a wrong address or password, a wrong code of the second step. It runs after
 * the library answered and never changes that answer; failing to write it is logged and nothing else. The verification of a code while the
 * person is already signed in (turning the second step on in "Minha conta") is not a sign-in and leaves nothing here: the library then checks
 * the code of the session's user and ignores any cookie of a pending sign-in, which may still be in the browser and point to someone else
 * (a sign-in left at the code screen on a shared browser), so a request with a session is never tied to that cookie. Too many requests,
 * refused before the library runs, leave nothing either.
 */
function signInFailureTrail(db: D1Database, secret: string) {
  return createAuthMiddleware(async (ctx) => {
    const returned = ctx.context.returned;
    if (!isAPIError(returned)) return;
    const code = (returned.body as { code?: unknown } | undefined)?.code;
    try {
      if (ctx.path === "/sign-in/email") {
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (code === "INVALID_EMAIL_OR_PASSWORD" && typeof email === "string") await recordPasswordFailure(db, secret, email);
        return;
      }
      if (!SECOND_STEP_ROUTES.has(ctx.path)) return;
      const reason = code === "ACCOUNT_TEMPORARILY_LOCKED" ? "SECOND_STEP_LOCKED" : WRONG_CODE.has(String(code)) ? "SECOND_STEP_CODE" : null;
      if (!reason) return;
      // Same order as the library: with a session, the code was the session user's, and that is not a sign-in.
      if (await getSessionFromCtx(ctx)) return;
      // The pending sign-in: the signed cookie the library set after the password, pointing to who it is. After too many wrong codes the
      // library has already discarded it, and that last attempt cannot be tied to anyone.
      const pending = await ctx.getSignedCookie(ctx.context.createAuthCookie("two_factor").name, ctx.context.secret);
      if (!pending) return;
      const verification = await ctx.context.internalAdapter.findVerificationValue(pending);
      if (verification?.value) await recordSecondStepFailure(db, verification.value, reason);
    } catch {
      console.error("SIGN_IN_FAILURE_AUDIT_FAILED");
    }
  });
}

/** How long the link of a reset e-mail lives, in seconds. It can be used once. */
export const RESET_LINK_SECONDS = 60 * 60;
export function createAuth(db: D1Database, settings: AuthSettings) {
  const origin = new URL(settings.origin);
  if (
    settings.secret.length < 32 ||
    origin.origin !== settings.origin ||
    (origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(origin.hostname))
  ) {
    throw new Error("AUTH_CONFIGURATION_INVALID");
  }
  return betterAuth({
    appName: "Trainer Prescription",
    secret: settings.secret,
    baseURL: settings.origin,
    basePath: `${settings.basePath}/api/auth`,
    trustedOrigins: [settings.origin],
    database: drizzleAdapter(drizzle(db, { schema }), {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      ...(settings.email
        ? {
            resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
            // Whoever had the old password, or a session made with it, is signed out.
            revokeSessionsOnPasswordReset: true,
            // The link is ours, not the library's callback: the token goes to our own page and is
            // sent back in a POST, so no GET endpoint of the library has to be reachable. It sits in the
            // fragment (after the #), which a browser never sends: not to our server, not in a log, not in
            // a Referer.
            sendResetPassword: async ({ user, token }: { user: { email: string }; token: string }) => {
              const link = `${settings.origin}${settings.basePath}/redefinir-senha#token=${encodeURIComponent(token)}`;
              await settings.email!.sendPasswordReset({ to: user.email, link });
            },
            // A trail line for the reset. Someone who signed up and has not finished joining has no row
            // in `users` yet, and the trail needs one: that case writes nothing. The password is already
            // changed when this runs, so it must never be the reason the answer fails.
            onPasswordReset: async ({ user }: { user: { id: string } }) => {
              try {
                await db
                  .prepare(
                    `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
                     SELECT ?1, NULL, u.id, 'PASSWORD_RESET_COMPLETED', u.id, ?3 FROM users u WHERE u.id = ?2`,
                  )
                  .bind(crypto.randomUUID(), user.id, new Date().toISOString())
                  .run();
              } catch {
                console.error("PASSWORD_RESET_AUDIT_FAILED");
              }
            },
          }
        : {}),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        // The current password is checked, so guessing it from a stolen session is limited too.
        "/change-password": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "trainer",
      useSecureCookies: origin.protocol === "https:",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        path: settings.basePath || "/",
      },
      // Only the edge-provided address is trusted; never arbitrary X-Forwarded-For.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      // The e-mail goes out after the answer, so asking for a link takes as long for an address
      // with an account as for one without.
      ...(settings.background ? { backgroundTasks: { handler: settings.background } } : {}),
    },
    hooks: { after: signInFailureTrail(db, settings.secret) },
    plugins: [
      // The second step of the sign-in: an authenticator app (TOTP) and single-use recovery codes.
      // Chosen by each person, never forced. No code is sent by e-mail or by phone (there is no
      // `sendOTP`), no device is remembered by the screens, and the library locks an account after ten
      // wrong codes in a row for fifteen minutes.
      twoFactor({
        issuer: "Trainer Prescription",
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 },
        twoFactorCookieMaxAge: 60 * 5,
      }),
    ],
    logger: { disabled: true },
  });
}
