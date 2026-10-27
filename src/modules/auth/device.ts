/**
 * A short name for a browser, from the User-Agent header the session was opened with: "Chrome em Windows".
 * Only these labels reach the page, never the header itself (it is written by the client). Order matters:
 * Edge, Opera and the iOS browsers also say "Chrome" or "Safari", Android also says "Linux", and the
 * iPhone also says "Mac OS X".
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "macOS"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  if (browser && system) return `${browser} em ${system}`;
  return browser ?? system ?? "Aparelho não identificado";
}
