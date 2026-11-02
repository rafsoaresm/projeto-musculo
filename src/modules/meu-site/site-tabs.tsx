"use client";
import type { ReactNode } from "react";
import { Tabs } from "@/components/tabs";
import { SITE_TABS, SITE_TAB_LABEL, type SiteTab } from "./site-tab-names";

const TABS = SITE_TABS.map((id) => ({ id, label: SITE_TAB_LABEL[id] }));

/**
 * The tabs of the management of the site (handoff V4, Figma `10:76` and `10:119`), on the shared tabs: every panel mounted, the open tab in
 * the address (`?aba=`); opening a tab drops `?editar=1`, so a reload does not open the editor again.
 */
export function SiteTabs({ initial, panels }: { initial: SiteTab; panels: Record<SiteTab, ReactNode> }) {
  return <Tabs label="Gestão do site" tabs={TABS} initial={initial} panels={panels} clearParams={["editar"]} className="site-tabs" />;
}
