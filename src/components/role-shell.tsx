"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
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
import type {
  IconName,
  NavGroup,
  NavItem,
  SurfaceId,
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
  children,
}: RoleShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const hrefOf = (item: NavItem) =>
    item.slug ? `${prefix}/${item.slug}` : prefix;
  const isActive = (item: NavItem) => {
    const href = hrefOf(item);
    return item.slug === ""
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
  };
  const primary = groups
    .flatMap((group) => group.items)
    .filter((item) => item.primary)
    .slice(0, 4);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
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
        <Icon size={19} />
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
        <Brand href={prefix} label={`Trainer Prescription, início de ${roleLabel}`} />
        <div className="context-card">
          <span className="role-badge">{roleLabel}</span>
          <strong>{contextTitle}</strong>
          <small>{contextText}</small>
        </div>
        <nav aria-label={`Navegação de ${roleLabel}`}>
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => renderLink(item))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Link className="nav-link subtle" href="/projeto">
            <Layers3 size={17} />
            <span>Mapa do produto</span>
          </Link>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span className="topbar-role">{roleLabel}</span>
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
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
          <span>{menuOpen ? "Fechar" : "Menu"}</span>
        </button>
      </nav>
      {menuOpen && (
        <div
          className="mobile-menu"
          id="mobile-menu"
          role="dialog"
          aria-label={`Menu de ${roleLabel}`}
        >
          <div className="context-card">
            <span className="role-badge">{roleLabel}</span>
            <strong>{contextTitle}</strong>
            <small>{contextText}</small>
          </div>
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
            <Link
              className="nav-link subtle"
              href="/projeto"
              onClick={() => setMenuOpen(false)}
            >
              <Layers3 size={17} />
              <span>Mapa do produto</span>
            </Link>
            {canSignOut && <SignOut variant="nav" />}
          </div>
        </div>
      )}
    </div>
  );
}
