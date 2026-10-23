import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Dumbbell, UserRound } from "lucide-react";
import { resolveSurfaces } from "@/modules/auth/server";
import { hadStudentAccess } from "@/db/surfaces";
import { SignOut } from "@/modules/auth/components/sign-out";
import { SURFACES, SURFACE_ORDER } from "@/modules/platform/surfaces";

export const dynamic = "force-dynamic";

const icons = {
  gestor: Building2,
  profissional: Dumbbell,
  aluno: UserRound,
} as const;

/** Sends each login to the area it holds; the destination is never user input. */
export default async function Access() {
  const { db, user, surfaces } = await resolveSurfaces();
  if (surfaces.length === 1) redirect(SURFACES[surfaces[0]].home);
  if (surfaces.length === 0) {
    if (!(await hadStudentAccess(db, user.id))) redirect("/organizacao");
    return (
      <section className="account-card">
        <p className="eyebrow">ACESSO</p>
        <h1>Seu acesso não está ativo.</h1>
        <p>
          O acesso à área do aluno foi encerrado. Peça um novo convite ao seu
          profissional para voltar.
        </p>
        <div className="account-toolbar">
          <SignOut />
        </div>
      </section>
    );
  }
  return (
    <section className="chooser">
      <p className="eyebrow">SUAS ÁREAS</p>
      <h1>Por onde você quer começar?</h1>
      <p className="muted">
        Esta conta tem mais de um acesso. Você pode trocar de área a qualquer
        momento.
      </p>
      <div className="access-grid">
        {SURFACE_ORDER.filter((id) => surfaces.includes(id)).map((id) => {
          const Icon = icons[id];
          return (
            <article className="access-card" key={id}>
              <span className="icon-tile">
                <Icon size={24} />
              </span>
              <h3>{SURFACES[id].label}</h3>
              <p>{SURFACES[id].description}</p>
              <Link className="button primary" href={SURFACES[id].home}>
                Abrir
              </Link>
            </article>
          );
        })}
      </div>
      <div className="account-toolbar">
        <SignOut />
      </div>
    </section>
  );
}
