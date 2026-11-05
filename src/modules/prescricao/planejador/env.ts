import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AI_ENV_NAMES, resolveAiEnv, type AiEnv } from "./config";

/** Worker env first, then `process.env` (the same dual path as AUTH_SECRET and the photos switch). Never logged, never returned to a client. */
export async function readServerEnv(name: string): Promise<string | undefined> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const value = (env as unknown as Record<string, unknown>)[name];
    if (typeof value === "string" && value !== "") return value;
  } catch {
    /* outside a Worker request (tests, scripts): process.env only */
  }
  const fromProcess = process.env[name];
  return fromProcess === "" ? undefined : fromProcess;
}

/** All AI variables of this request, resolved once. */
export async function loadAiEnv(): Promise<AiEnv> {
  const values = new Map<string, string | undefined>();
  for (const name of AI_ENV_NAMES) values.set(name, await readServerEnv(name));
  return resolveAiEnv((name) => values.get(name));
}
