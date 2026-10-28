import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface WranglerConfig {
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  d1_databases?: Array<{ binding: string; database_name: string }>;
  vars?: Record<string, string>;
}
const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as WranglerConfig;

/**
 * Webflow Cloud names the real resource `<environment id>-<name>`: the log of a successful deploy
 * shows the database as `f26f7686-f290-4ed2-a487-fefb0d58aa2c-trainer-prescription`. An R2 bucket
 * name has at most 63 characters, so the name written here has to leave room for that prefix.
 * `trainer-prescription-photos` (27 characters) made 36 + 1 + 27 = 64, and the deploy stopped right
 * after "Processing 1 R2 bucket(s)..." with no message, twice.
 */
const ENVIRONMENT_PREFIX = 36 + 1;
const R2_LIMIT = 63;

describe("wrangler.json", () => {
  const config = read("wrangler.json");

  it("declares bucket names that still fit after the platform prefix", () => {
    for (const bucket of config.r2_buckets ?? []) {
      expect(bucket.bucket_name, bucket.binding).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
      expect(ENVIRONMENT_PREFIX + bucket.bucket_name.length, `${bucket.binding} with the prefix`).toBeLessThanOrEqual(R2_LIMIT);
    }
  });

  it("declares database names that fit too", () => {
    for (const database of config.d1_databases ?? [])
      expect(ENVIRONMENT_PREFIX + database.database_name.length).toBeLessThanOrEqual(R2_LIMIT);
  });
});

describe("the photos are open in the configuration the platform deploys", () => {
  it("provisions the bucket and opens the photos, in the file the platform reads", () => {
    const production = read("wrangler.json");
    expect(production.r2_buckets).toEqual([
      { binding: "PHOTOS", bucket_name: "photos" },
      // The images of the public page: a second bucket, so a photo of a student and a picture on a public page never share one.
      { binding: "SITE_MEDIA", bucket_name: "site-media" },
    ]);
    // The student's own authorization is still checked photo by photo, in the database.
    expect(production.vars?.PHOTOS_ENABLED).toBe("true");
  });

  it("has no second configuration that could drift from the one deployed", () => {
    // The preview, the local server and the CI used a copy with the photos open while production kept
    // them closed; once production opened them the copy had nothing left to say.
    expect(existsSync("wrangler.photos.json")).toBe(false);
  });
});
