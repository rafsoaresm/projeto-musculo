import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export interface AuthSettings {
  secret: string;
  origin: string;
  basePath: string;
}
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
    },
    logger: { disabled: true },
  });
}
