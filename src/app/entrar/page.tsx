import { AccountForm } from "@/modules/auth/components/account-form";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ bloqueado?: string }>;
}) {
  const { bloqueado } = await searchParams;
  return (
    <>
      {bloqueado && (
        <p role="alert" className="form-error">
          Esta conta está bloqueada. Entre em contato com o responsável pelo
          atendimento.
        </p>
      )}
      <AccountForm />
    </>
  );
}
