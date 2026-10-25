import { readFileSync } from "node:fs";
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

describe.each(["wrangler.json", "wrangler.photos.json"])("%s", (file) => {
  const config = read(file);

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

describe("the photos stay closed until they are opened on purpose", () => {
  it("provisions the bucket in production without opening the photos", () => {
    const production = read("wrangler.json");
    expect(production.r2_buckets).toEqual([{ binding: "PHOTOS", bucket_name: "photos" }]);
    // Opening the photos is a deliberate change, made together with the student's consent.
    expect(production.vars?.PHOTOS_ENABLED).toBeUndefined();
  });

  it("opens them only in the local and CI preview, where the browser tests need them", () => {
    const preview = read("wrangler.photos.json");
    expect(preview.vars?.PHOTOS_ENABLED).toBe("true");
    expect(preview.r2_buckets).toEqual(read("wrangler.json").r2_buckets);
  });
});
