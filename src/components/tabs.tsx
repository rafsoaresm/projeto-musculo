"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  /** A short count shown on the tab (requests with a deadline), so it stays visible from the other tabs. */
  badge?: number;
}

/**
 * Tabs inside one page (ARIA tab pattern). Every panel stays mounted, so nothing typed in one tab is lost when another is opened; the open
 * tab is written to the address (`?aba=`), so a reload, a link or going back keeps it. Arrow keys, Home and End move between the tabs.
 * An anchor of a section inside a panel (`#pedidos`) opens its tab: `hashTabs` says which tab holds which anchor.
 * Only plain data crosses from the server page: no functions.
 */
export function Tabs({
  label,
  tabs,
  initial,
  panels,
  hashTabs = {},
  clearParams = [],
  className,
}: {
  label: string;
  tabs: readonly TabItem[];
  initial: string;
  panels: Record<string, ReactNode>;
  hashTabs?: Record<string, string>;
  clearParams?: readonly string[];
  className?: string;
}) {
  const [active, setActive] = useState(initial);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const open = (tab: string, focus = false) => {
    setActive(tab);
    if (focus) buttons.current[tab]?.focus();
    const url = new URL(window.location.href);
    url.searchParams.set("aba", tab);
    for (const name of clearParams) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", url);
  };
  // An anchor of a hidden panel cannot be scrolled to: open its tab first, then bring the section into view.
  useEffect(() => {
    const follow = () => {
      const anchor = window.location.hash.slice(1);
      const tab = hashTabs[anchor];
      if (!tab) return;
      setActive(tab);
      requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView());
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
    // The map is plain data from the server and does not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ids = tabs.map((tab) => tab.id);
  const onKey = (event: KeyboardEvent) => {
    const index = ids.indexOf(active);
    const next =
      event.key === "ArrowRight" ? (index + 1) % ids.length : event.key === "ArrowLeft" ? (index - 1 + ids.length) % ids.length : event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    open(ids[next]!, true);
  };
  return (
    <div className={["tabs", className].filter(Boolean).join(" ")}>
      <div role="tablist" aria-label={label} className="tab-pills" onKeyDown={onKey}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`aba-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`painel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            ref={(node) => {
              buttons.current[tab.id] = node;
            }}
            onClick={() => open(tab.id)}
          >
            {tab.label}
            {tab.badge ? (
              <span className="tab-badge" aria-label={`, ${tab.badge} em aberto`}>
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" id={`painel-${tab.id}`} aria-labelledby={`aba-${tab.id}`} hidden={active !== tab.id} tabIndex={0}>
          {panels[tab.id]}
        </div>
      ))}
    </div>
  );
}
