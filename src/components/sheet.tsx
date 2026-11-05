"use client";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A modal on a wide screen and a bottom sheet on a phone (Figma AP-02/AP-06/AP-09/AP-10), on the native <dialog>: focus stays inside,
 * Esc closes it and the focus goes back to the button that opened it. Presentational: what it holds is decided by the caller.
 * `busy` keeps it open while a request runs (Esc and the backdrop do not close it).
 */
export function Sheet({
  open,
  onClose,
  titleId,
  children,
  variant = "dialog",
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  children: ReactNode;
  /** `menu` is a small list of actions: a dropdown under its button on a wide screen. */
  variant?: "dialog" | "menu";
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
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
