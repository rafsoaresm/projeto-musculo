import { getDatabase, photoStorageAvailable } from "@/db/binding";
import { getAuth, recoveryAvailable } from "@/modules/auth/server";

export async function GET() {
  let persistence: "available" | "unavailable" = "unavailable";
  let authentication: "configured" | "not_configured" = "not_configured";
  try {
    const db = await getDatabase();
    const schema = await db
      .prepare("SELECT version FROM app_schema_versions WHERE version = ?")
      .bind("0022_sign_in_trail")
      .first();
    if (schema) persistence = "available";
  } catch {
    // No database internals, SQL errors or identifiers in a public health response.
  }
  try {
    await getAuth();
    authentication = "configured";
  } catch {
    /* No secrets in health. */
  }
  return Response.json(
    {
      status: persistence === "available" ? "ok" : "degraded",
      service: "trainer-prescription",
      version: "0.32.0",
      capabilities: {
        periodization: "available",
        areas: ["gestor", "profissional", "aluno"],
        authentication,
        persistence,
        storage: "webflow_sqlite",
        // Whether the environment lets postural photos in: the bucket exists and the switch is on.
        photos: (await photoStorageAvailable()) ? "open" : "closed",
        // Whether a forgotten password can be recovered by e-mail: the sender is completely configured.
        // Nothing about the provider or its keys is shown here.
        passwordRecovery: (await recoveryAvailable()) ? "available" : "not_configured",
      },
    },
    {
      status: persistence === "available" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
