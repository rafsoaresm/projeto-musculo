import { execFileSync } from "node:child_process";

/**
 * The first platform manager can be activated only once (by design). Local runs
 * start from a clean slate by revoking managers left by earlier runs in the
 * LOCAL database. Never touches a remote environment.
 */
export default function globalSetup() {
  const origin = process.env.E2E_ORIGIN || "http://127.0.0.1:8787";
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) return;
  try {
    execFileSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--local",
        "--command",
        "UPDATE platform_admins SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE revoked_at IS NULL",
      ],
      {
        stdio: "ignore",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
  } catch {
    // Migrations not applied yet: the tests themselves will report it.
  }
}
