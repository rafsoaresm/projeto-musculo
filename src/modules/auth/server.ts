import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAuth } from "./factory";
import { workspaceFor } from "@/db/workspaces";

export async function getAuth() {
  const { env } = await getCloudflareContext({ async: true });
  const secret = env.AUTH_SECRET || process.env.AUTH_SECRET;
  const origin =
    process.env.NODE_ENV === "development"
      ? process.env.AUTH_ORIGIN || env.AUTH_ORIGIN
      : env.AUTH_ORIGIN || process.env.AUTH_ORIGIN;
  if (!secret || !origin) throw new Error("AUTH_CONFIGURATION_REQUIRED");
  return createAuth(env.DB, {
    secret,
    origin,
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  });
}
export async function requireIdentity() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/entrar");
  const { env } = await getCloudflareContext({ async: true });
  const identity = await env.DB.prepare(
    "SELECT disabled_at FROM users WHERE id = ?",
  )
    .bind(session.user.id)
    .first<{ disabled_at: string | null }>();
  if (identity?.disabled_at) redirect("/entrar?bloqueado=1");
  return { db: env.DB, user: session.user };
}
export async function requireWorkspace() {
  const identity = await requireIdentity();
  const workspace = await workspaceFor(identity.db, identity.user.id);
  if (!workspace) redirect("/organizacao");
  return {
    ...identity,
    workspace,
    context: { userId: identity.user.id, organizationId: workspace.id },
  };
}
