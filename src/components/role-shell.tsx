"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Building2,
  CalendarRange,
  ChartLine,
  CircleCheck,
  ClipboardCheck,
  CreditCard,
  Dumbbell,
  FileText,
  Globe,
  Handshake,
  House,
  Inbox,
  Layers3,
  LayoutDashboard,
  LayoutTemplate,
  Library,
  Menu,
  MessageSquare,
  Plug,
  ScrollText,
  Settings,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Brand } from "./brand";
import { SignOut } from "@/modules/auth/components/sign-out";
import {
  activeSlug,
  type IconName,
  type NavGroup,
  type NavItem,
  type SurfaceId,
} from "@/modules/platform/surfaces";

const icons: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  building: Building2,
  audit: ScrollText,
  card: CreditCard,
  handshake: Handshake,
  template: LayoutTemplate,
  library: Library,
  plug: Plug,
  users: Users,
  clipboard: ClipboardCheck,
  calendar: CalendarRange,
  dumbbell: Dumbbell,
  book: BookOpen,
  globe: Globe,
  inbox: Inbox,
  settings: Settings,
  home: House,
  chart: ChartLine,
  check: CircleCheck,
  file: FileText,
  message: MessageSquare,
  user: UserRound,
};

export interface AreaLink {
  label: string;
  href: string;
  current?: boolean;
}

export interface RoleShellProps {
  surface: SurfaceId;
  /** Route prefix of the area, e.g. "/gestor" or "/demonstracao/gestor". */
  prefix: string;
  roleLabel: string;
  contextTitle: string;
  contextText: string;
  groups: NavGroup[];
  /** Other areas this person may enter. */
  areas?: AreaLink[];
  /** Fictional-data demonstration: shows a permanent banner. */
  demo?: boolean;
  userLabel?: string;
  /** Real areas have a session to end; the demonstration does not. */
  canSignOut?: boolean;
  /**
   * The professional's workspace (handoff V4, section 5): the menu is the whole sidebar (no context card, no product map), the space's name sits
   * in the top bar, and on a phone the menu opens from a button in the top bar instead of a bottom bar of shortcuts.
   */
  workspace?: boolean;
  children: ReactNode;
}

export function RoleShell({
  surface,
  prefix,
  roleLabel,
  contextTitle,
  contextText,
  groups,
  areas = [],
  demo = false,
  userLabel,
  canSignOut = false,
  workspace = false,
  children,
}: RoleShellProps) {
  const pathname = usePathname();
  // The menu is open for the address it was opened on: a navigation (a link, Back) closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const menuOpen = openAt === pathname;
  const setMenuOpen = (open: boolean | ((was: boolean) => boolean)) =>
    setOpenAt((typeof open === "function" ? open(menuOpen) : open) ? pathname : null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const hrefOf = (item: NavItem) =>
    item.slug ? `${prefix}/${item.slug}` : prefix;
  // One item, from the address (and not from the last click), so a reload, a shared link or Back light the same one.
  const relative =
    pathname === prefix
      ? ""
      : pathname.startsWith(`${prefix}/`)
        ? pathname.slice(prefix.length + 1)
        : null;
  const current = relative === null ? null : activeSlug(groups, relative);
  const isActive = (item: NavItem) => current === item.slug;
  const primary = groups
    .flatMap((group) => group.items)
    .filter((item) => item.primary)
    .slice(0, 4);

  // The open menu holds the focus: it starts on "Fechar", Tab goes round inside it, Escape or a tap outside closes it, and the focus goes back
  // to the button that opened it.
  useEffect(() => {
    if (!menuOpen) return;
    const opener = trigger.current;
    const focusable = () => [
      ...(sheet.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenAt(null);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [menuOpen]);

  const renderLink = (item: NavItem, onNavigate?: () => void) => {
    const Icon = icons[item.icon];
    const active = isActive(item);
    return (
      <Link
        key={item.slug || "home"}
        href={hrefOf(item)}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`nav-link${active ? " active" : ""}`}
      >
        {/* The professional's menu is text only, as in the Figma component (28:342). */}
        {!workspace && <Icon size={19} />}
        <span>{item.label}</span>
        {item.status === "planned" && (
          <span className="nav-tag">{item.tag ?? "Em breve"}</span>
        )}
      </Link>
    );
  };

  return (
    <div
      className="shell"
      data-surface={surface}
      data-demo={demo ? "true" : undefined}
      data-workspace={workspace ? "true" : undefined}
    >
      <a className="skip-link" href="#conteudo">
        Pular para conteúdo
      </a>
      {demo && (
        <div className="demo-banner" role="note">
          <strong>DEMONSTRAÇÃO</strong>
          <span>Dados fictícios. Nada é salvo e nenhuma conta é usada.</span>
          <Link href="/demonstracao">Trocar de visão</Link>
        </div>
      )}
      <aside className="sidebar">
        {workspace ? (
          <Link
            className="workspace-brand"
            href={prefix}
            aria-label={`Trainer Prescription, início de ${roleLabel}`}
          >
            <strong>TRAINER / RX</strong>
            <small>ÁREA PROFISSIONAL</small>
          </Link>
        ) : (
          <>
            <Brand
              href={prefix}
              label={`Trainer Prescription, início de ${roleLabel}`}
            />
            <div className="context-card">
              <span className="role-badge">{roleLabel}</span>
              <strong>{contextTitle}</strong>
              <small>{contextText}</small>
            </div>
          </>
        )}
        <nav aria-label={`Navegação de ${roleLabel}`}>
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => renderLink(item))}
            </div>
          ))}
        </nav>
        {workspace ? (
          <div className="sidebar-footer workspace-footer">
            <strong>TRAINER PRESCRIPTION</strong>
            <small>Área profissional</small>
          </div>
        ) : (
          <div className="sidebar-footer">
            <Link className="nav-link subtle" href="/projeto">
              <Layers3 size={17} />
              <span>Mapa do produto</span>
            </Link>
          </div>
        )}
      </aside>
      <div className="main-column">
        <header className="topbar">
          {workspace && (
            <button
              ref={trigger}
              type="button"
              className="topbar-menu"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Menu size={20} />
              <span>Menu</span>
            </button>
          )}
          {workspace ? (
            <span className="topbar-role">
              {contextTitle}
              <small>{contextText}</small>
            </span>
          ) : (
            <span className="topbar-role">{roleLabel}</span>
          )}
          {areas.length > 0 && (
            <nav className="area-switch" aria-label="Trocar de área">
              {areas.map((area) => (
                <Link
                  key={area.href}
                  href={area.href}
                  aria-current={area.current ? "page" : undefined}
                  className={area.current ? "selected" : undefined}
                >
                  {area.label}
                </Link>
              ))}
            </nav>
          )}
          {userLabel && <span className="topbar-user">{userLabel}</span>}
          {canSignOut && (
            <div className="topbar-signout">
              <SignOut variant="topbar" />
            </div>
          )}
        </header>
        <main id="conteudo">{children}</main>
        <footer className="page-footer">
          <span>TRAINER PRESCRIPTION</span>
          <span>Do planejamento ao acompanhamento.</span>
        </footer>
      </div>
      {!workspace && (
        <nav className="mobile-nav" aria-label={`Atalhos de ${roleLabel}`}>
          {primary.map((item) => {
            const Icon = icons[item.icon];
            const active = isActive(item);
            return (
              <Link
                key={item.slug || "home"}
                href={hrefOf(item)}
                aria-current={active ? "page" : undefined}
                className={active ? "active" : undefined}
              >
                <Icon size={22} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            ref={trigger}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
            <span>{menuOpen ? "Fechar" : "Menu"}</span>
          </button>
        </nav>
      )}
      {menuOpen && (
        <div
          className="mobile-overlay"
          data-workspace={workspace ? "true" : undefined}
        >
          {/* A tap outside the menu closes it; the button is out of the tab order (the menu has its own Fechar). */}
          <button
            type="button"
            className="mobile-backdrop"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={sheet}
            className="mobile-menu"
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label={`Menu de ${roleLabel}`}
          >
            <div className="mobile-menu-head">
              {workspace ? (
                <span className="workspace-brand">
                  <strong>TRAINER / RX</strong>
                  <small>ÁREA PROFISSIONAL</small>
                </span>
              ) : (
                <span className="role-badge">{roleLabel}</span>
              )}
              <button
                type="button"
                className="mobile-menu-close"
                onClick={() => setMenuOpen(false)}
              >
                <X size={20} />
                <span>Fechar</span>
              </button>
            </div>
            {!workspace && (
              <div className="context-card">
                <strong>{contextTitle}</strong>
                <small>{contextText}</small>
              </div>
            )}
            {groups.map((group) => (
              <div className="nav-group" key={group.label}>
                <p className="nav-label">{group.label}</p>
                {group.items.map((item) =>
                  renderLink(item, () => setMenuOpen(false)),
                )}
              </div>
            ))}
            {areas.length > 0 && (
              <div className="nav-group">
                <p className="nav-label">TROCAR DE ÁREA</p>
                {areas.map((area) => (
                  <Link
                    key={area.href}
                    className="nav-link"
                    href={area.href}
                    onClick={() => setMenuOpen(false)}
                  >
                    {area.label}
                  </Link>
                ))}
              </div>
            )}
            <div className="nav-group">
              {!workspace && (
                <Link
                  className="nav-link subtle"
                  href="/projeto"
                  onClick={() => setMenuOpen(false)}
                >
                  <Layers3 size={17} />
                  <span>Mapa do produto</span>
                </Link>
              )}
              {canSignOut && <SignOut variant="nav" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
