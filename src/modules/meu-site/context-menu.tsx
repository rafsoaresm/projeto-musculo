"use client";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface MenuItem {
  label: string;
  /** What the keyboard does the same, shown at the right. */
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
}
/** `null` is a line between groups. */
export type MenuEntry = MenuItem | null;

/**
 * The menu of a block, opened with the right button over the page or the layers. It is drawn inside the editor's dialog (anything outside a modal
 * dialog cannot be reached), at the point of the click kept inside the window. Arrow keys, Home and End move through it, Enter or Space
 * does the item, Escape or a click anywhere else closes it, and the focus goes back to where it was.
 */
export function ContextMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: MenuEntry[]; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y });
  const enabled = items.flatMap((entry, index) => (entry && !entry.disabled ? [index] : []));
  const [current, setCurrent] = useState<number>(enabled[0] ?? -1);

  // Kept inside the window: moved left or up when it would go past the right or bottom edge.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    setPlace({ left: Math.max(4, Math.min(x, window.innerWidth - box.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - box.height - 4)) });
  }, [x, y, items.length]);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    list.current?.focus();
    const away = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      before?.focus?.();
    };
  }, [onClose]);

  const move = (direction: 1 | -1) => {
    if (enabled.length === 0) return;
    const at = enabled.indexOf(current);
    setCurrent(enabled[(at + direction + enabled.length) % enabled.length]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Home") setCurrent(enabled[0] ?? -1);
    else if (event.key === "End") setCurrent(enabled[enabled.length - 1] ?? -1);
    else if (event.key === "Escape") onClose();
    else if (event.key === "Tab") onClose();
    else if (event.key === "Enter" || event.key === " ") {
      const entry = items[current];
      if (entry && !entry.disabled) {
        onClose();
        entry.run();
      }
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={list}
      className="ve-menu"
      role="menu"
      aria-label={`Ações de ${label}`}
      tabIndex={-1}
      style={{ left: place.left, top: place.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((entry, index) =>
        entry === null ? (
          <hr key={index} role="separator" />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            className={entry.danger ? "ve-danger" : undefined}
            data-current={current === index || undefined}
            disabled={entry.disabled}
            tabIndex={-1}
            onMouseEnter={() => !entry.disabled && setCurrent(index)}
            onClick={() => {
              onClose();
              entry.run();
            }}
          >
            <span>{entry.label}</span>
            {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
