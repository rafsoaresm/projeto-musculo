"use client";
import { useEffect } from "react";

export const LEAVE_WARNING = "Há alterações que ainda não foram salvas e vão se perder. Sair mesmo assim?";

/**
 * Leaving a page with text that is not saved would lose it. Closing or reloading is asked by the browser;
 * the links of the page (tabs, the history) change the screen without leaving it, so they ask here. A link that only goes to a place in the
 * same page does not.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const askBeforeLinks = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      // A link to a place in the same page ("#...") does not leave it: nothing is lost (the editor's preview has some, and so do its menus of pages).
      if (link.getAttribute("href")?.startsWith("#")) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!window.confirm(LEAVE_WARNING)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", askBeforeLinks, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", askBeforeLinks, true);
    };
  }, [dirty]);
}
