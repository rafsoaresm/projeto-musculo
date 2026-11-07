"use client";
import Link from "next/link";
import { useActionState } from "react";
import {
  recoverManagerPassword,
  recoverManagerTwoFactor,
  type ManagerPasswordState,
  type ManagerRecoveryState,
} from "./recovery-actions";

/** E-mail and password of the manager, and the environment secret. Nothing is kept in the browser. */
export function ManagerRecoveryForm() {
  const [state, action, pending] = useActionState<
    ManagerRecoveryState,
    FormData
  >(recoverManagerTwoFactor, {});
  if (state.done)
    return (
      <>
        <p role="status">
          Verificação em duas etapas redefinida. Todos os aparelhos foram
          desconectados. Entre só com a senha e, em Minha conta, ative a
          verificação de novo com o aplicativo autenticador.
        </p>
        <Link className="account-link" href="/entrar?area=gestor">
          Entrar
        </Link>
      </>
    );
  return (
    <>
      <form
        action={action}
        className="stack-form"
        aria-label="Recuperar o acesso do gestor"
      >
        <label>
          E-mail da conta de gestor
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            defaultValue={state.email}
          />
        </label>
        <label>
          Senha da conta
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label>
          Código de ativação
          <input
            name="token"
            type="password"
            autoComplete="off"
            required
            minLength={32}
            maxLength={256}
            spellCheck={false}
            aria-describedby="recovery-token-help"
          />
        </label>
        <span className="small" id="recovery-token-help">
          O valor de PLATFORM_SETUP_TOKEN no ambiente privado, o mesmo código
          usado para ativar o primeiro gestor.
        </span>
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
        <button className="button primary" disabled={pending}>
          {pending ? "Verificando…" : "Redefinir a verificação em duas etapas"}
        </button>
      </form>
      <Link className="account-link" href="/entrar?area=gestor">
        Voltar para entrar
      </Link>
    </>
  );
}

/** E-mail of the manager, a new password twice, and the environment secret. Nothing is kept in the browser. */
export function ManagerPasswordForm() {
  const [state, action, pending] = useActionState<
    ManagerPasswordState,
    FormData
  >(recoverManagerPassword, {});
  if (state.done)
    return (
      <>
        <p role="status">
          Senha redefinida. Todos os aparelhos foram desconectados. Entre com a
          senha nova.
        </p>
        <Link className="account-link" href="/entrar?area=gestor">
          Entrar
        </Link>
      </>
    );
  return (
    <>
      <form
        action={action}
        className="stack-form"
        aria-label="Redefinir a senha do gestor"
      >
        <label>
          E-mail da conta de gestor
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            defaultValue={state.email}
          />
        </label>
        <label>
          Senha nova (12 a 128 caracteres)
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <label>
          Repita a senha nova
          <input
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <label>
          Código de ativação
          <input
            name="token"
            type="password"
            autoComplete="off"
            required
            minLength={32}
            maxLength={256}
            spellCheck={false}
            aria-describedby="password-token-help"
          />
        </label>
        <span className="small" id="password-token-help">
          O valor de PLATFORM_SETUP_TOKEN no ambiente privado, o mesmo código
          usado para ativar o primeiro gestor.
        </span>
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
        <button className="button primary" disabled={pending}>
          {pending ? "Verificando…" : "Redefinir a senha"}
        </button>
      </form>
      <Link className="account-link" href="/entrar?area=gestor">
        Voltar para entrar
      </Link>
    </>
  );
}
