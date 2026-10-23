import Link from "next/link";
import { ArrowRight, Building2, Dumbbell, UserRound } from "lucide-react";
import { getOperatorSettings, getOptionalIdentity } from "@/modules/auth/server";
import { SURFACES, SURFACE_ORDER, type SurfaceId } from "@/modules/platform/surfaces";

export const dynamic = "force-dynamic";

const iconFor = {
  gestor: Building2,
  profissional: Dumbbell,
  aluno: UserRound,
} as const;
const entryText: Record<
  SurfaceId,
  { action: string; hint: { href: string; label: string } | string }
> = {
  gestor: {
    action: "Acessar como gestor",
    hint: { href: "/gestor/ativar", label: "Primeiro acesso do gestor" },
  },
  profissional: {
    action: "Acessar como profissional",
    hint: { href: "/cadastro", label: "Criar conta profissional" },
  },
  aluno: {
    action: "Acessar como aluno",
    hint: "O acesso começa por um convite do seu profissional.",
  },
};

export default async function Entry() {
  const identity = await getOptionalIdentity();
  const demoEnabled = await getOperatorSettings()
    .then((settings) => settings.demoEnabled)
    .catch(() => false);
  return (
    <>
      <section className="entry-hero">
        <p className="eyebrow">TRAINER PRESCRIPTION</p>
        <h1>Um método. Todo o percurso.</h1>
        <p>
          Uma plataforma para quem planeja e prescreve treinos e para quem
          treina. Cada pessoa entra pela sua área e vê só o que é dela.
        </p>
        <div className="entry-actions">
          {identity ? (
            <Link className="button inverse" href="/acesso">
              Continuar para minha área <ArrowRight size={18} />
            </Link>
          ) : (
            <>
              <Link className="button inverse" href="/entrar">
                Entrar
              </Link>
              <Link className="button outline-inverse" href="/cadastro">
                Criar conta profissional
              </Link>
            </>
          )}
        </div>
      </section>
      <section aria-labelledby="areas-titulo" className="entry-areas">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TRÊS ÁREAS</p>
            <h2 id="areas-titulo">Escolha como você usa a ferramenta</h2>
          </div>
        </div>
        <div className="access-grid">
          {SURFACE_ORDER.map((id) => {
            const surface = SURFACES[id];
            const Icon = iconFor[id];
            const text = entryText[id];
            return (
              <article className="access-card" key={id}>
                <span className="icon-tile">
                  <Icon size={24} />
                </span>
                <p className="eyebrow">{surface.audience.toUpperCase()}</p>
                <h3>{surface.label}</h3>
                <p>{surface.description}</p>
                <Link className="button primary" href={surface.home}>
                  {text.action}
                </Link>
                {typeof text.hint === "string" ? (
                  <p className="small muted">{text.hint}</p>
                ) : (
                  <Link className="account-link small" href={text.hint.href}>
                    {text.hint.label}
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {demoEnabled && (
        <section className="demo-callout">
          <div>
            <p className="eyebrow">DEMONSTRAÇÃO</p>
            <h2>Quer ver a ferramenta funcionando?</h2>
            <p>
              Navegue pelas três áreas com dados fictícios, sem criar conta. Nada
              é salvo.
            </p>
          </div>
          <Link className="button primary" href="/demonstracao">
            Abrir a demonstração
          </Link>
        </section>
      )}
    </>
  );
}
