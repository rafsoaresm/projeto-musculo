import "server-only";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAuth } from "./factory";
import { workspaceFor } from "@/db/workspaces";
import { isPlatformAdmin } from "@/db/platform";
import { portalLinksFor } from "@/db/student-access";
import { surfacesFor } from "@/db/surfaces";

/**
 * Server-side access control. Layouts only draw the interface: they do not
 * re-run on client navigation, so every page and action calls one of the
 * require* functions itself. Identity, tenant and role always come from the
 * verified session, never from a form field, header or URL.
 */
/**
 * The platform chooses the mount path when it builds and Next inlines it, so
 * this is the value the running app really uses. NEXT_PUBLIC_BASE_PATH comes
 * from this repository's own build and can be empty on the platform. It only
 * scopes the session cookie; browser addresses use useMountPath().
 */
function mountPath() {
  return (
    process.env.__NEXT_ROUTER_BASEPATH ??
    process.env.NEXT_PUBLIC_BASE_PATH ??
    ""
  );
}

export async function getAuthSettings() {
  const { env } = await getCloudflareContext({ async: true });
  const secret = env.AUTH_SECRET || process.env.AUTH_SECRET;
  const origin =
    process.env.NODE_ENV === "development"
      ? process.env.AUTH_ORIGIN || env.AUTH_ORIGIN
      : env.AUTH_ORIGIN || process.env.AUTH_ORIGIN;
  if (!secret || !origin) throw new Error("AUTH_CONFIGURATION_REQUIRED");
  return {
    secret,
    origin,
    basePath: mountPath(),
  };
}
export async function getAuth() {
  const { env } = await getCloudflareContext({ async: true });
  return createAuth(env.DB, await getAuthSettings());
}

/** Server-only operator settings. Absent values mean "feature unavailable". */
export async function getOperatorSettings() {
  const { env } = await getCloudflareContext({ async: true });
  return {
    setupToken: env.PLATFORM_SETUP_TOKEN || process.env.PLATFORM_SETUP_TOKEN,
    demoEnabled: (env.DEMO_MODE || process.env.DEMO_MODE) === "true",
  };
}

// One session lookup per request, shared by layouts, pages and actions.
const loadIdentity = cache(async () => {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { env } = await getCloudflareContext({ async: true });
  const identity = await env.DB.prepare(
    "SELECT disabled_at FROM users WHERE id = ?",
  )
    .bind(session.user.id)
    .first<{ disabled_at: string | null }>();
  return {
    db: env.DB,
    user: session.user,
    blocked: Boolean(identity?.disabled_at),
  };
});

/** For public pages that adapt when someone is signed in. Never redirects. */
export async function getOptionalIdentity() {
  try {
    const identity = await loadIdentity();
    return identity && !identity.blocked
      ? { db: identity.db, user: identity.user }
      : null;
  } catch {
    return null;
  }
}
export async function requireIdentity() {
  const identity = await loadIdentity();
  if (!identity) redirect("/entrar");
  if (identity.blocked) redirect("/entrar?bloqueado=1");
  return { db: identity.db, user: identity.user };
}

/** Professional area: an active membership resolved on the server. */
export async function requireWorkspace() {
  const identity = await requireIdentity();
  const workspace = await workspaceFor(identity.db, identity.user.id);
  if (!workspace) redirect("/acesso");
  return {
    ...identity,
    workspace,
    context: { userId: identity.user.id, organizationId: workspace.id },
  };
}

/** Platform manager area. No membership, so no access to student records. */
export async function requirePlatformAdmin() {
  const identity = await requireIdentity();
  if (!(await isPlatformAdmin(identity.db, identity.user.id)))
    redirect("/acesso");
  return { ...identity, context: { userId: identity.user.id } };
}

/** Client area: at least one active, invitation-created link. */
export async function requireStudent() {
  const identity = await requireIdentity();
  const links = await portalLinksFor(identity.db, identity.user.id);
  if (links.length === 0) redirect("/acesso");
  return { ...identity, links };
}

export async function resolveSurfaces() {
  const identity = await requireIdentity();
  return {
    ...identity,
    surfaces: await surfacesFor(identity.db, identity.user.id),
  };
}
