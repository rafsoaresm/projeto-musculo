/**
 * The Content-Security-Policy of a public page that has tagging on (Meu Site 0.71): the strict policy of the pages, plus the site's own script
 * (`'self'`, the loader at `/s/<slug>/m/rastreio`) and only the hosts of the tools that site configured. A site without tagging keeps the
 * policy it had, character for character (the caller passes null and gets PUBLIC_CSP back). Hosts from the tools' own CSP guides (report §8).
 */
import { PUBLIC_CSP } from "@/modules/frappe-site/document";

export interface TrackingTools {
  ga4: boolean;
  ads: boolean;
  meta: boolean;
}

export const toolsOf = (settings: { ga4Id: string | null; adsId: string | null; metaPixelId: string | null }): TrackingTools => ({
  ga4: Boolean(settings.ga4Id),
  ads: Boolean(settings.adsId),
  meta: Boolean(settings.metaPixelId),
});

const GTAG = "https://www.googletagmanager.com";
const HOSTS = {
  ga4: {
    script: [GTAG],
    connect: [GTAG, "https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.g.doubleclick.net"],
    img: [GTAG, "https://*.google-analytics.com", "https://*.g.doubleclick.net"],
    frame: [] as string[],
  },
  ads: {
    script: [GTAG, "https://www.googleadservices.com", "https://www.google.com", "https://googleads.g.doubleclick.net"],
    connect: [GTAG, "https://www.google.com", "https://google.com", "https://googleads.g.doubleclick.net", "https://www.googleadservices.com", "https://pagead2.googlesyndication.com", "https://*.g.doubleclick.net"],
    img: [GTAG, "https://googleads.g.doubleclick.net", "https://www.googleadservices.com", "https://www.google.com", "https://www.google.com.br"],
    frame: ["https://bid.g.doubleclick.net", "https://td.doubleclick.net"],
  },
  meta: {
    script: ["https://connect.facebook.net"],
    connect: ["https://www.facebook.com", "https://connect.facebook.net"],
    img: ["https://www.facebook.com"],
    frame: [] as string[],
  },
};

/** The hosts each directive gains for the tools that are on, without repetition, in a fixed order. */
export function trackingHosts(tools: TrackingTools): { script: string[]; connect: string[]; img: string[]; frame: string[] } {
  const on = (["ga4", "ads", "meta"] as const).filter((tool) => tools[tool]);
  const merge = (key: "script" | "connect" | "img" | "frame") => [...new Set(on.flatMap((tool) => HOSTS[tool][key]))];
  return { script: merge("script"), connect: merge("connect"), img: merge("img"), frame: merge("frame") };
}

const any = (tools: TrackingTools | null): tools is TrackingTools => Boolean(tools && (tools.ga4 || tools.ads || tools.meta));

/**
 * The policy of a published page of the advanced editor. No tool on (or null): exactly PUBLIC_CSP. Otherwise PUBLIC_CSP with `script-src 'self'`
 * and `connect-src` added and the hosts of the tools appended to `img-src` and `frame-src`; everything else (no inline script, forms to the site
 * only, no `<base>`, never framed) stays as it was.
 */
export function publicPageCsp(tools: TrackingTools | null, base: string = PUBLIC_CSP): string {
  if (!any(tools)) return base;
  const hosts = trackingHosts(tools);
  const directives = base.split("; ").map((directive) => {
    const [name] = directive.split(" ");
    if (name === "img-src") return [directive, ...hosts.img].join(" ");
    if (name === "frame-src" && hosts.frame.length) return [directive, ...hosts.frame].join(" ");
    return directive;
  });
  const at = directives.findIndex((directive) => directive.startsWith("style-src"));
  directives.splice(at, 0, ["script-src 'self'", ...hosts.script].join(" "), ["connect-src", ...hosts.connect].join(" "));
  return directives.join("; ");
}

/**
 * The policy of the small pages the forms answer with, when the site has tagging (without it they keep having none, as before): their own
 * inline style, the site's script and the tools' hosts; nothing else.
 */
export function inquiryPageCsp(tools: TrackingTools): string {
  const hosts = trackingHosts(tools);
  return [
    "default-src 'none'",
    ["script-src 'self'", ...hosts.script].join(" "),
    ["connect-src", ...hosts.connect].join(" "),
    ["img-src 'self' data:", ...hosts.img].join(" "),
    "style-src 'unsafe-inline'",
    ...(hosts.frame.length ? [["frame-src", ...hosts.frame].join(" ")] : []),
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
