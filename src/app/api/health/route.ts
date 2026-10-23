import { getDatabase } from "@/db/binding";

export async function GET() {
  let persistence: "available" | "unavailable" = "unavailable";
  try {
    const db = await getDatabase();
    const schema = await db
      .prepare("SELECT version FROM app_schema_versions WHERE version = ?")
      .bind("0001_foundation")
      .first();
    if (schema) persistence = "available";
  } catch {
    // No database internals, SQL errors or identifiers in a public health response.
  }
  return Response.json(
    {
      status: persistence === "available" ? "ok" : "degraded",
      service: "trainer-prescription",
      version: "0.1.0",
      capabilities: {
        periodization: "available",
        authentication: "not_connected",
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
