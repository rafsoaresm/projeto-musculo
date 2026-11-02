"use client";
import { useEffect } from "react";

/**
 * What the form before WhatsApp does with the keyboard, when the page can run a script (handoff V1.1, 12.4). The form works without it: it opens
 * when the address points at it and closes by its "×" link. With it, while the form is open the rest of the page is out of reach (`inert`),
 * so the focus stays in the form; the focus goes to the first field; Escape closes it; and the focus goes back to the button that opened it.
 * Only then is the form a modal dialog for a screen reader (`aria-modal`): without the script that would not be true.
 */
export function WhatsAppFormKeys({ id, closed }: { id: string; closed: string }) {
  useEffect(() => {
    const dialog = document.getElementById(id);
    if (!dialog) return;
    const site = dialog.closest(".site");
    const others = () => (site ? Array.from(site.children).filter((element): element is HTMLElement => element !== dialog && element instanceof HTMLElement) : []);
    let opener: HTMLElement | null = null;
    let wasOpen = false;
    const sync = () => {
      const open = window.location.hash === `#${id}`;
      for (const element of others()) element.inert = open;
      if (open) {
        dialog.setAttribute("aria-modal", "true");
        if (!wasOpen) dialog.querySelector<HTMLElement>("input:not([type='hidden']):not([tabindex='-1'])")?.focus();
      } else {
        dialog.removeAttribute("aria-modal");
        if (wasOpen) opener?.focus();
        opener = null;
      }
      wasOpen = open;
    };
    const remember = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLElement>(`a[href="#${id}"]`) : null;
      if (link && !dialog.contains(link)) opener = link;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && window.location.hash === `#${id}`) window.location.hash = closed;
    };
    window.addEventListener("hashchange", sync);
    document.addEventListener("click", remember, true);
    document.addEventListener("keydown", escape);
    sync();
    return () => {
      window.removeEventListener("hashchange", sync);
      document.removeEventListener("click", remember, true);
      document.removeEventListener("keydown", escape);
      for (const element of others()) element.inert = false;
    };
  }, [id, closed]);
  return null;
}
