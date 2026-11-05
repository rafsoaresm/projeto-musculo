"use client";
import { useSyncExternalStore } from "react";

/** The width at which the app shell turns into its phone layout (the sidebar goes); the generation screens follow it. */
export const PHONE_QUERY = "(max-width: 860px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the page is in its phone layout. The server and the first client render say "no" (the markup is the same for both layouts,
 * CSS picks what shows), then the browser says what it is; nothing is stored.
 */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
