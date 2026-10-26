import { AccountForm } from "@/modules/auth/components/account-form";
import { recoveryAvailable } from "@/modules/auth/server";

// Only a fixed allow-list of intents maps to a destination: never a free URL.
const intents = {
  gestor: {
    redirectTo: "/gestor/ativar",
    signup: "/cadastro?area=gestor",
  },
} as const;

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ bloqueado?: string; area?: string }>;
}) {
  const { bloqueado, area } = await searchParams;
  const intent = area === "gestor" ? intents.gestor : null;
  const recovery = await recoveryAvailable();
  return (
    <>
      {bloqueado && (
        <p role="alert" className="form-error account-alert">
          Esta conta está bloqueada. Entre em contato com o responsável pelo
          atendimento.
        </p>
      )}
      <AccountForm
        forgotHref={recovery ? "/esqueci-a-senha" : undefined}
        redirectTo={intent?.redirectTo}
        switchTo={
          intent
            ? { href: intent.signup, label: "Criar uma conta para o gestor" }
            : undefined
        }
      />
    </>
  );
}
