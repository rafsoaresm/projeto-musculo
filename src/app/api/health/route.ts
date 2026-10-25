import { getDatabase } from "@/db/binding";
import { getAuth } from "@/modules/auth/server";

export async function GET() {
  let persistence: "available" | "unavailable" = "unavailable";
  let authentication: "configured" | "not_configured" = "not_configured";
  try {
    const db = await getDatabase();
    const schema = await db
      .prepare("SELECT version FROM app_schema_versions WHERE version = ?")
      .bind("0012_workout_sessions")
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
      version: "0.16.0",
      capabilities: {
        periodization: "available",
        areas: ["gestor", "profissional", "aluno"],
        authentication,
        persistence,
        storage: "webflow_sqlite",
      },
    },
    {
      status: persistence === "available" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
