"use client";
import { usePathname } from "next/navigation";
import { mountPathOf } from "@/modules/platform/mount-path";

/**
 * Returns a function that gives the mount path of the running app. Use it for
 * addresses the browser builds itself (fetch, copied links); next/link and the
 * router already add it. Call the function from handlers, not while rendering
 * on the server.
 */
export function useMountPath() {
  const route = usePathname();
  return () =>
    mountPathOf(
      window.location.pathname,
      route,
      process.env.NEXT_PUBLIC_BASE_PATH || "",
    );
}
