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
      testIgnore: /gestor\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testIgnore: /gestor\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    // The first manager activates once per database, so this runs a single time.
    {
      name: "gestor",
      testMatch: /gestor\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
