/**
 * Where the app is mounted under its origin ("/app" on Webflow Cloud, "" at the
 * root). The platform sets Next's basePath when it builds, so a value computed
 * by this repository's own build can disagree with it. The address bar cannot:
 * Next's usePathname() leaves the mount path out and the browser keeps it.
 *
 * Only call this from the browser, for example inside an event handler.
 */
export function mountPathOf(
  address: string,
  route: string,
  fallback = "",
): string {
  const trim = (path: string) =>
    path.length > 1 ? path.replace(/\/+$/, "") : path;
  const here = trim(address);
  const inside = trim(route);
  if (inside === "/") return here === "/" ? "" : here;
  return here.endsWith(inside)
    ? here.slice(0, here.length - inside.length)
    : fallback;
}
