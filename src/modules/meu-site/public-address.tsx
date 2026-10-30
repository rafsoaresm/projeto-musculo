"use client";
import { useSyncExternalStore } from "react";
import { useMountPath } from "@/components/use-mount-path";

const noSubscription = () => () => undefined;

/** The public address as the browser sees it (with the origin and the mount); on the server, the path only. */
export function PublicAddress({
  slug,
  path = "",
  className = "site-address",
  base = "s",
}: {
  slug: string;
  /** What follows the site's address: "/sobre" for a page of the site. */
  path?: string;
  className?: string;
  /** `s`: the pages of the first editor; `site`: the pages published from the new one. */
  base?: "s" | "site";
}) {
  const mountPath = useMountPath();
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");
  return <code className={className}>{origin ? `${origin}${mountPath()}/${base}/${slug}${path}` : `/${base}/${slug}${path}`}</code>;
}
