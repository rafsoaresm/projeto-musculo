import { getCloudflareContext } from "@opennextjs/cloudflare";
import { assessmentV2Open } from "../v2";

/** Whether the new format of the assessment is open in this environment. Server only: it reads the Worker's environment. */
export async function assessmentV2Here(): Promise<boolean> {
  const { env } = await getCloudflareContext({ async: true });
  return assessmentV2Open(env, process.env);
}
