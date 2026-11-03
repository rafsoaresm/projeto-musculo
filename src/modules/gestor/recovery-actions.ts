"use server";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuth, getOperatorSettings } from "@/modules/auth/server";
import { recoverLastManagerTwoFactor, type ManagerRecoveryResult } from "@/db/manager-recovery";

export interface ManagerRecoveryState {
  done?: boolean;
  error?: string;
  /** What was typed, so a refused attempt does not empty the field. Never the password nor the secret. */
  email?: string;
}

const messages: Record<Exclude<ManagerRecoveryResult, "reset">, string> = {
  unavailable:
    "A recuperação não está configurada neste ambiente. Defina PLATFORM_SETUP_TOKEN (32 caracteres ou mais) no ambiente privado.",
  rate_limited: "Muitas tentativas. Aguarde 15 minutos e tente novamente.",
  invalid_token: "Código do ambiente inválido. Confira o valor configurado no ambiente privado.",
  invalid_credentials: "E-mail ou senha não conferem.",
  not_applicable:
    "Esta conta não é de um gestor ativo com a verificação em duas etapas ligada. Nada foi alterado.",
  other_manager:
    "Há outro gestor ativo. Peça a ele para redefinir a sua verificação em Gestor > Gestores. Nada foi alterado.",
};

/**
 * The last manager, without the phone and without the recovery codes. Nobody is signed in here: the person is
 * identified by their own e-mail and password, and the operator's environment secret authorizes turning off the
 * second step of that one account. The address for the limit comes only from the edge header.
 */
export async function recoverManagerTwoFactor(
  _previous: ManagerRecoveryState,
  form: FormData,
): Promise<ManagerRecoveryState> {
  const { env } = await getCloudflareContext({ async: true });
  const { setupToken } = await getOperatorSettings();
  const auth = await getAuth();
  const { password } = await auth.$context;
  const result = await recoverLastManagerTwoFactor(env.DB, {
    email: form.get("email"),
    password: form.get("password"),
    supplied: form.get("token"),
    configured: setupToken,
    address: (await headers()).get("cf-connecting-ip"),
    verifyPassword: (data) => password.verify(data),
  });
  const typed = form.get("email");
  return result === "reset"
    ? { done: true }
    : { error: messages[result], email: typeof typed === "string" ? typed.slice(0, 254) : "" };
}
