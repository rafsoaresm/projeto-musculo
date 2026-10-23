import type { D1Database } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    AUTH_SECRET?: string;
    AUTH_ORIGIN?: string;
    DB: D1Database;
  }
}

export {};
