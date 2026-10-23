import { AccountForm } from "@/modules/auth/components/account-form";

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
  return (
    <>
      {bloqueado && (
        <p role="alert" className="form-error account-alert">
          Esta conta está bloqueada. Entre em contato com o responsável pelo
          atendimento.
        </p>
      )}
      <AccountForm
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
