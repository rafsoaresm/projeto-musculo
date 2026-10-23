import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./brand";

/** Frame for pages that do not belong to one role: entry, login, invitation. */
export function PublicShell({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="public-shell">
      <a className="skip-link" href="#conteudo">
        Pular para conteúdo
      </a>
      <header className="public-header">
        <Brand />
        <nav aria-label="Atalhos" className="public-actions">
          {actions}
        </nav>
      </header>
      <main id="conteudo" className="public-main">
        {children}
      </main>
      <footer className="public-footer">
        <span>TRAINER PRESCRIPTION</span>
        <Link href="/projeto">Mapa do produto</Link>
      </footer>
    </div>
  );
}
