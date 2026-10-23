import Link from "next/link";
import { PublicShell } from "@/components/public-shell";

export default function NotFound() {
  return (
    <PublicShell>
      <section className="empty-state">
        <p className="eyebrow">404</p>
        <h1>Página não encontrada.</h1>
        <p>Este endereço não faz parte da aplicação.</p>
        <Link className="button primary" href="/">
          Voltar ao início
        </Link>
      </section>
    </PublicShell>
  );
}
