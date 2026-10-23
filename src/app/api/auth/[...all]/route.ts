import { getAuth } from "@/modules/auth/server";
import { handleAuthRequest } from "@/modules/auth/http";

const allowed = new Set([
  "sign-up/email",
  "sign-in/email",
  "sign-out",
  "get-session",
]);
async function handler(
  request: Request,
  { params }: { params: Promise<{ all: string[] }> },
) {
  const { all } = await params;
  if (!allowed.has(all.join("/"))) return new Response(null, { status: 404 });
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
