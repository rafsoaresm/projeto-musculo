import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Resolve the managed Webflow Cloud binding inside the current request. */
export async function getDatabase() {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.DB) throw new Error("DATABASE_BINDING_UNAVAILABLE");
  return env.DB;
}
