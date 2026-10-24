import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    AUTH_SECRET?: string;
    AUTH_ORIGIN?: string;
    /** One-time activation of the first platform manager (>= 32 characters). */
    PLATFORM_SETUP_TOKEN?: string;
    /** "true" enables the fictional-data demonstration area. Off by default. */
    DEMO_MODE?: string;
    DB: D1Database;
    /** Private object storage for the postural photos. Read only through authorized routes. */
    PHOTOS: R2Bucket;
  }
}

export {};
