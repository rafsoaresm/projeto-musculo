import { AccountForm } from "@/modules/auth/components/account-form";

export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ area?: string }>;
}) {
  const { area } = await searchParams;
  // The manager signs up like anyone, then activates with the operator token.
  return area === "gestor" ? (
    <AccountForm
      signup
      redirectTo="/gestor/ativar"
      switchTo={{ href: "/entrar?area=gestor", label: "Já tenho uma conta" }}
    />
  ) : (
    <AccountForm signup />
  );
}
