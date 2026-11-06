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
     * Private object storage for the images of the public page (Meu Site), a bucket of its own so the photos of
     * students and the pictures of a public page never share one. Read only through this app's routes: the
     * login-protected one for the editor, and the public one that serves an image only if a published version
     * uses it. Absent where the Object Storage is not provisioned: the editor then offers no image upload.
     */
    SITE_MEDIA?: R2Bucket;
    /**
     * "true" opens the photo upload and the photo route. The bucket can be provisioned and still be
     * closed: photos only open on purpose, once the student's consent exists. Absent means closed.
     */
    PHOTOS_ENABLED?: string;
    /**
     * "true" opens the contact form of the public pages (Meu Site) to whoever visits. Absent means closed everywhere, whatever a site
     * chose: it opens on purpose, once the public privacy notice (PRIVACY_NOTICE_URL) and the legal opinion on leads exist.
     */
    PUBLIC_FORMS_ENABLED?: string;
    /**
     * "true" opens the new format of the physical assessment (handoff V2) while it is being built: the start of a draft of the new format and
     * its guided steps. Absent means closed: the professional sees only the current assessment.
     */
    ASSESSMENT_V2_ENABLED?: string;
    /** The address of the public privacy notice the form points to ("https://..."). Without it the form stays closed even when opened. */
    PRIVACY_NOTICE_URL?: string;
    /**
     * Recovery of a forgotten password by e-mail (Amazon SES). All four of these and EMAIL_FROM must
     * be set; anything less and the recovery does not exist. The secret is a secret variable.
     */
    AWS_REGION?: string;
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    /** The verified sender: "address" or "Name <address>". */
    EMAIL_FROM?: string;
    /** "capture" keeps the text of the message in the database; honoured only on localhost, for the browser tests. */
    EMAIL_TRANSPORT?: string;
    /**
     * AI planner (motor V4). None of these is NEXT_PUBLIC_*; the two secrets are secret variables. Nothing here turns AI ON: the gates are in the
     * database (gestor panel). See docs/WEBFLOW-CLOUD.md, section "IA do planejador".
     */
    /** Exactly "true" stops EVERY provider call (planning, adjustments and the panel's own tests). Wins over everything. */
    AI_PLANNER_DISABLED?: string;
    /** SECRET. base64url of 32 random bytes (AES-256-GCM master key for provider keys at rest). Absent: the panel cannot save keys. */
    AI_SECRETS_KEY?: string;
    /** Label stored with each ciphertext (default "k1"). */
    AI_SECRETS_KEY_ID?: string;
    /** SECRET. Previous master key, decrypt-only, during a rotation. */
    AI_SECRETS_KEY_PREVIOUS?: string;
    AI_SECRETS_KEY_PREVIOUS_ID?: string;
    /** "true" allows the deterministic `mock` provider (tests, e2e, dev). Never in production. */
    AI_MOCK_ENABLED?: string;
    /** Ceilings over what the panel may set: timeout in ms (default 25000), output tokens (default 8192), cache TTL in days (default 14, max 60). */
    AI_HARD_TIMEOUT_MS?: string;
    AI_HARD_MAX_OUTPUT_TOKENS?: string;
    AI_CACHE_TTL_DAYS?: string;
  }
}

export {};
