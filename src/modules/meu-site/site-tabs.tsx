"use client";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { SITE_TABS, SITE_TAB_LABEL, type SiteTab } from "./site-tab-names";

/**
 * The tabs of the management of the site (handoff V4, Figma `10:76` and `10:119`). Every panel stays mounted, so nothing typed in one tab is lost
 * when another is opened; the open tab is written to the address (`?aba=`), so a reload or a link keeps it. Arrow keys, Home and End move
 * between the tabs, as the ARIA pattern asks.
 */
export function SiteTabs({ initial, panels }: { initial: SiteTab; panels: Record<SiteTab, ReactNode> }) {
  const [active, setActive] = useState<SiteTab>(initial);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const open = (tab: SiteTab, focus = false) => {
    setActive(tab);
    if (focus) buttons.current[tab]?.focus();
    const url = new URL(window.location.href);
    url.searchParams.set("aba", tab);
    url.searchParams.delete("editar");
    window.history.replaceState(window.history.state, "", url);
  };
  const onKey = (event: KeyboardEvent) => {
    const index = SITE_TABS.indexOf(active);
    const next =
      event.key === "ArrowRight" ? (index + 1) % SITE_TABS.length : event.key === "ArrowLeft" ? (index - 1 + SITE_TABS.length) % SITE_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? SITE_TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    open(SITE_TABS[next]!, true);
  };
  return (
    <div className="site-tabs">
      <div role="tablist" aria-label="Gestão do site" className="tab-pills" onKeyDown={onKey}>
        {SITE_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`aba-${tab}`}
            aria-selected={active === tab}
            aria-controls={`painel-${tab}`}
            tabIndex={active === tab ? 0 : -1}
            ref={(node) => {
              buttons.current[tab] = node;
            }}
            onClick={() => open(tab)}
          >
            {SITE_TAB_LABEL[tab]}
          </button>
        ))}
      </div>
      {SITE_TABS.map((tab) => (
        <div key={tab} role="tabpanel" id={`painel-${tab}`} aria-labelledby={`aba-${tab}`} hidden={active !== tab} tabIndex={0}>
          {panels[tab]}
        </div>
      ))}
    </div>
  );
}
