import type { createAuth } from "./factory";

/**
 * The only endpoints of the authentication library that are reachable from the browser. The route
 * and the handler read this one list, so a new endpoint is opened in one place and on purpose.
 */
export const AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  "sign-up/email",
  "sign-in/email",
  "sign-out",
  "get-session",
  // For a person already signed in: both need the session cookie, and the first also the current password.
  "change-password",
  "revoke-other-sessions",
  // The second step (an authenticator app). Setting it up, turning it off and the new recovery codes
  // need the session and the password; the two verifications finish a sign-in that asked for it. The
  // library's other routes (a code by e-mail or phone, the app's secret again) stay closed.
  "two-factor/enable",
  "two-factor/verify-totp",
  "two-factor/verify-backup-code",
  "two-factor/generate-backup-codes",
  "two-factor/disable",
]);

/**
 * The recovery of a forgotten password. Reachable only when the e-mail is configured: the same
 * route answers 404 for these two otherwise, as if they did not exist. The library's own GET
 * callback (`reset-password/<token>`) is not in any list: the link goes to our page.
 */
export const RESET_ENDPOINTS: ReadonlySet<string> = new Set(["request-password-reset", "reset-password"]);

/** Public boundary: strict browser origin, endpoint allowlist and rate-limit fallback. */
export async function handleAuthRequest(
  auth: ReturnType<typeof createAuth>,
  request: Request,
  routeEndpoint?: string,
) {
  const path =
    routeEndpoint ??
    new URL(request.url).pathname.slice(auth.options.basePath!.length + 1);
  const responseHeaders = { "Cache-Control": "private, no-store" };
  const recoveryOpen = Boolean(auth.options.emailAndPassword?.sendResetPassword);
  if (!AUTH_ENDPOINTS.has(path) && !(recoveryOpen && RESET_ENDPOINTS.has(path)))
    return new Response(null, { status: 404, headers: responseHeaders });
  if (request.method !== (path === "get-session" ? "GET" : "POST"))
    return new Response(null, { status: 405, headers: responseHeaders });
  // Require Origin even for initial login without a cookie (login CSRF).
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== auth.options.baseURL
  ) {
    return Response.json(
      { message: "Origem não autorizada." },
      { status: 403, headers: responseHeaders },
    );
  }
  const headers = new Headers(request.headers);
  // Webflow's edge must overwrite CF-Connecting-IP. If absent, use one shared
  // bucket rather than silently disabling production rate limiting.
  if (!headers.has("cf-connecting-ip"))
    headers.set("cf-connecting-ip", "127.0.0.1");
  // Next/OpenNext and workerd may use different Request constructors. Passing
  // the foreign object as input can stringify it to "[object Request]".
  // Reconstruct using primitive URL + bounded body, preserving cookies/Origin.
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (request.method === "POST") {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 16384) {
          await reader.cancel();
          return new Response(null, { status: 413, headers: responseHeaders });
        }
        chunks.push(value);
      }
    }
    body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  // Next strips basePath from the Request URL in some runtimes. Route params
  // identify the allowlisted endpoint; reconstruct the library's mounted URL.
  const url = new URL(auth.options.baseURL as string);
  url.pathname = `${auth.options.basePath}/${path}`;
  url.search = new URL(request.url).search;
  const response = await auth.handler(
    new Request(url.toString(), {
      method: request.method,
      headers,
      body,
    }),
  );
  const outputHeaders = new Headers(response.headers);
  outputHeaders.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: outputHeaders,
  });
}
