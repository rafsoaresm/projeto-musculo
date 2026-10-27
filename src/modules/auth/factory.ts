import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import type { PasswordResetSender } from "@/modules/email/service";
import * as schema from "./schema";

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
