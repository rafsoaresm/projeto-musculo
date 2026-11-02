/**
 * The header of a one-page site (the site models): links of the menu to parts of the home page, and the WhatsApp button at its end. Pure:
 * each function gives the document with one thing changed, the same object when nothing changes. A link goes only to a section of the home
 * page that exists; the list keeps at most MAX_MENU_LINKS.
 */
import { BUTTON_MAX, MAX_MENU_LINKS, type SiteContent } from "./contracts";

type MenuLink = NonNullable<SiteContent["menu"]>[number];

const withMenu = (content: SiteContent, menu: MenuLink[]): SiteContent => {
  if (menu.length > 0) return { ...content, menu };
  const { menu: _dropped, ...rest } = content;
  void _dropped;
  return rest;
};
const sectionIds = (content: SiteContent) => new Set(content.blocks.map((entry) => entry.id));

/** A new link to a section of the home page (the first one not yet in the menu), named after it; the same document when full. */
export function addMenuLink(content: SiteContent, anchor: string, label: string): SiteContent {
  const menu = content.menu ?? [];
  const name = label.trim().slice(0, BUTTON_MAX);
  if (menu.length >= MAX_MENU_LINKS || !sectionIds(content).has(anchor) || !name) return content;
  return withMenu(content, [...menu, { label: name, anchor }]);
}

export function withMenuLabel(content: SiteContent, index: number, raw: string): SiteContent {
  const menu = content.menu ?? [];
  const label = raw.slice(0, BUTTON_MAX);
  // A link with no name is kept (the field is being typed) and left out of the page until it has one.
  if (!menu[index] || menu[index]!.label === label) return content;
  return withMenu(content, menu.map((entry, at) => (at === index ? { ...entry, label } : entry)));
}

export function withMenuAnchor(content: SiteContent, index: number, anchor: string): SiteContent {
  const menu = content.menu ?? [];
  if (!menu[index] || menu[index]!.anchor === anchor || !sectionIds(content).has(anchor)) return content;
  return withMenu(content, menu.map((entry, at) => (at === index ? { ...entry, anchor } : entry)));
}

export function removeMenuLink(content: SiteContent, index: number): SiteContent {
  const menu = content.menu ?? [];
  return menu[index] ? withMenu(content, menu.filter((_, at) => at !== index)) : content;
}

export function moveMenuLink(content: SiteContent, index: number, by: -1 | 1): SiteContent {
  const menu = [...(content.menu ?? [])];
  const to = index + by;
  if (!menu[index] || to < 0 || to >= menu.length) return content;
  [menu[index], menu[to]] = [menu[to]!, menu[index]!];
  return withMenu(content, menu);
}

/** The links whose section is gone from the home page are taken out (after a section is deleted). */
export function pruneMenu(content: SiteContent): SiteContent {
  const menu = content.menu ?? [];
  const ids = sectionIds(content);
  const kept = menu.filter((entry) => ids.has(entry.anchor));
  return kept.length === menu.length ? content : withMenu(content, kept);
}

/** The WhatsApp button of the header: its label, or `null` to take it away. */
export function withHeaderCta(content: SiteContent, label: string | null): SiteContent {
  if (label === null) {
    if (!content.headerCta) return content;
    const { headerCta: _dropped, ...rest } = content;
    void _dropped;
    return rest;
  }
  // An empty label keeps the button chosen (the field is being typed); the page leaves it out until it has one.
  const text = label.slice(0, BUTTON_MAX);
  if (content.headerCta?.label === text) return content;
  return { ...content, headerCta: { label: text } };
}
