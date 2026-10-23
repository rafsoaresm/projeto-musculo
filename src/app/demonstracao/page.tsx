import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Dumbbell, UserRound } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { Notice } from "@/components/ui";
import { requireDemo } from "@/modules/demo/guard";
import { demoSurfaces } from "@/modules/demo/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demonstração" };

const icons = [Building2, Dumbbell, UserRound];

export default async function DemoIndex() {
  await requireDemo();
  return (
    <PublicShell
      actions={
        <Link className="button secondary small" href="/">
          Sair da demonstração
        </Link>
      }
    >
      <section className="chooser">
        <p className="eyebrow">DEMONSTRAÇÃO</p>
        <h1>Veja a ferramenta pelos três papéis.</h1>
        <p className="muted">
          Navegue como gestor da ferramenta, como profissional de educação
          física e como cliente (aluno).
        </p>
        <Notice tone="warning">
          <p>
            Tudo aqui é fictício: nomes, números e planos. Nada é salvo, nenhuma
            conta é usada e esta área não representa o que já está pronto. As
            telas marcadas como <strong>Prévia</strong> ilustram módulos que
            ainda não existem; as demais usam as mesmas telas da área real.
          </p>
        </Notice>
        <div className="access-grid">
          {demoSurfaces.map((surface, index) => {
            const Icon = icons[index];
            return (
              <article className="access-card" key={surface.id}>
                <span className="icon-tile">
                  <Icon size={24} />
                </span>
                <h3>{surface.label}</h3>
                <p>{surface.description}</p>
                <Link className="button primary" href={surface.href}>
                  Ver como {surface.id === "aluno" ? "cliente" : surface.id}
                </Link>
              </article>
            );
          })}
        </div>
      </section>
    </PublicShell>
  );
}
