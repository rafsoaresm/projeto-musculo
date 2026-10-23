import { requireIdentity } from "@/modules/auth/server";
import { workspaceFor } from "@/db/workspaces";
import { WorkspaceForm } from "@/modules/onboarding/forms";
import { SignOut } from "@/modules/auth/components/sign-out";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Organization() {
  const { db, user } = await requireIdentity();
  if (await workspaceFor(db, user.id)) redirect("/alunos");
  const previous = await db
    .prepare("SELECT user_id FROM organization_provisioning WHERE user_id = ?")
    .bind(user.id)
    .first();
  return (
    <section className="account-card">
      <p className="eyebrow">PRIMEIROS PASSOS</p>
      <h1>Um espaço para seu método.</h1>
      {previous ? (
        <p role="alert">
          Seu vínculo com o espaço está indisponível. Entre em contato com o
          responsável antes de continuar.
        </p>
      ) : (
        <WorkspaceForm name={user.name} />
      )}
      <div className="account-toolbar">
        <SignOut />
      </div>
    </section>
  );
}
