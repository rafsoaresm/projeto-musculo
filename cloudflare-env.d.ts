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
    /**
     * Private object storage for the postural photos, read only through authorized routes. Absent
     * where the Object Storage is not provisioned: the app then offers no photo upload.
     */
    PHOTOS?: R2Bucket;
    /**
     * "true" opens the photo upload and the photo route. The bucket can be provisioned and still be
     * closed: photos only open on purpose, once the student's consent exists. Absent means closed.
     */
    PHOTOS_ENABLED?: string;
  }
}

export {};
