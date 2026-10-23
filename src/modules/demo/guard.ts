import "server-only";
import { notFound } from "next/navigation";
import { getOperatorSettings } from "@/modules/auth/server";

/**
 * The demonstration area exists only when the operator sets DEMO_MODE=true in
 * the private environment. Otherwise every demonstration route is a 404.
 */
export async function requireDemo() {
  const enabled = await getOperatorSettings()
    .then((settings) => settings.demoEnabled)
    .catch(() => false);
  if (!enabled) notFound();
}
