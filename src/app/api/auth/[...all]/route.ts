import { getAuth } from "@/modules/auth/server";
import { AUTH_ENDPOINTS, RESET_ENDPOINTS, handleAuthRequest } from "@/modules/auth/http";

async function handler(
  request: Request,
  { params }: { params: Promise<{ all: string[] }> },
) {
  const { all } = await params;
  const endpoint = all.join("/");
  // Whether the recovery exists is decided by the handler, which knows if the e-mail is configured.
  if (!AUTH_ENDPOINTS.has(endpoint) && !RESET_ENDPOINTS.has(endpoint)) return new Response(null, { status: 404 });
  try {
    const auth = await getAuth();
    return await handleAuthRequest(auth, request, all.join("/"));
  } catch (error) {
    console.error(
      "AUTH_REQUEST_FAILED",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      { message: "Acesso temporariamente indisponível." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export { handler as GET, handler as POST };
