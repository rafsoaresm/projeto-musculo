"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  CalendarRange,
  Layers3,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";

const navigation = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/planejamento", label: "Planejamento", icon: CalendarRange },
  { href: "/projeto", label: "Mapa do produto", icon: Layers3 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo">
        Pular para conteúdo
      </a>
      <aside className="sidebar">
        <Link
          className="brand"
          href="/"
          aria-label="Trainer Prescription, início"
        >
          <span className="brand-symbol">
            <Activity size={25} strokeWidth={2.6} />
          </span>
          <span>
            trainer<span className="brand-subtitle">PRESCRIPTION</span>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-avatar">TP</span>
          <div>
            <strong>Espaço de construção</strong>
            <small>Fundação do produto</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Navegação principal">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={pathname === href ? "nav-link active" : "nav-link"}
            >
              <Icon size={19} />
              {label}
              {pathname === href && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={21} />
          <strong>Cuidado começa na estrutura.</strong>
          <p>
            Revisão profissional, histórico preservado e privacidade em cada
            etapa.
          </p>
          <Link href="/projeto">
            Conhecer as etapas <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" /> Base inicial <span>v0.1</span>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span>Seu método. Uma experiência completa.</span>
          <span className="topbar-badge">
            Trainer Prescription <span className="status-dot" />
          </span>
        </header>
        <main id="conteudo">{children}</main>
        <footer className="page-footer">
          <span>TRAINER PRESCRIPTION</span>
          <span>Do planejamento ao acompanhamento.</span>
        </footer>
      </div>
    </div>
  );
}
