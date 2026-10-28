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
  }
}

export {};
