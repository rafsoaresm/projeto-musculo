"use client";
import { useSyncExternalStore } from "react";
import { useMountPath } from "@/components/use-mount-path";

const noSubscription = () => () => undefined;

/** The public address as the browser sees it (with the origin and the mount); on the server, the path only. */
export function PublicAddress({ slug, className = "site-address" }: { slug: string; className?: string }) {
  const mountPath = useMountPath();
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");
  return <code className={className}>{origin ? `${origin}${mountPath()}/s/${slug}` : `/s/${slug}`}</code>;
}
