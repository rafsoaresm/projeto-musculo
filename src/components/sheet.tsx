"use client";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/** Same breakpoint as the sidebar of the professional area: above it the menu hangs from its button, below it it is a bottom sheet. */
const WIDE = "(min-width: 861px)";

/**
 * A modal on a wide screen and a bottom sheet on a phone (Figma AP-02/AP-06/AP-09/AP-10), on the native <dialog>: focus stays inside,
 * Esc closes it and the focus goes back to the button that opened it. Presentational: what it holds is decided by the caller.
 * `busy` keeps it open while a request runs (Esc and the backdrop do not close it).
 * `anchorRef` (menu variant only): on a wide screen the menu is drawn at the right edge of that element, a little below its top
 * (the "Menu / outras ações" of AP-09 hangs from the status bar); on a phone it is the bottom sheet of AP-10 and the anchor is ignored.
 */
export function Sheet({
  open,
  onClose,
  titleId,
  children,
  variant = "dialog",
  busy = false,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  children: ReactNode;
  /** `menu` is a small list of actions: a dropdown under its button on a wide screen. */
  variant?: "dialog" | "menu";
  busy?: boolean;
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open && variant === "menu") {
      const anchor = anchorRef?.current;
      if (anchor && window.matchMedia(WIDE).matches) {
        const rect = anchor.getBoundingClientRect();
        const height = element.getBoundingClientRect().height;
        const top = Math.max(8, Math.min(rect.top + 64, window.innerHeight - height - 8));
        element.style.inset = "auto";
        element.style.margin = "0";
        element.style.top = `${top}px`;
        element.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      } else {
        element.style.inset = "";
        element.style.margin = "";
        element.style.top = "";
        element.style.right = "";
      }
    }
  }, [open, variant, anchorRef]);
  return (
    <dialog
      ref={ref}
      className={variant === "menu" ? "sheet sheet-menu" : "sheet"}
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      {open && <div className="sheet-body">{children}</div>}
    </dialog>
  );
}
