import { defineConfig, devices } from "@playwright/test";

const mount = (process.env.BASE_URL || "").replace(/\/$/, "");
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // The scenarios are whole flows (sign-up, invitation, plan, logs); a loaded machine needs the room.
  timeout: 90_000,
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: `${process.env.E2E_ORIGIN || "http://127.0.0.1:8787"}${mount}/`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /gestor\.spec\.ts|consent-stale\.spec\.ts|password-reset\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testIgnore: /gestor\.spec\.ts|consent-stale\.spec\.ts|password-reset\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    // The first manager activates once per database, so this runs a single time. It ends by publishing a
    // new text of the terms, which asks everyone to accept again: it runs alone, after every other scenario.
    {
      name: "gestor",
      testMatch: /gestor\.spec\.ts/,
      dependencies: ["desktop", "mobile", "consent-stale", "recovery"],
      use: { ...devices["Desktop Chrome"] },
    },
    // Writes to the local database from outside the worker, so it runs alone, once, after the others
    // (`--no-deps` runs just this one).
    {
      name: "consent-stale",
      testMatch: /consent-stale\.spec\.ts/,
      dependencies: ["desktop", "mobile"],
      use: { ...devices["Desktop Chrome"] },
    },
    // Reads the e-mail the local "capture" transport kept, from the local database and from outside the
    // worker, so it runs alone, after the writer above.
    {
      name: "recovery",
      testMatch: /password-reset\.spec\.ts/,
      dependencies: ["consent-stale"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
