"use client";
import Link from "next/link";
import { useState } from "react";
import { useMountPath } from "@/components/use-mount-path";

/**
 * Asks for the link that sets a new password. The answer is the same for an address with an account,
 * one without and one that was limited, so the form cannot be used to find out who is registered.
 */
export function ForgotPasswordForm() {
  const mountPath = useMountPath();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(`${mountPath()}/api/auth/request-password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (response.ok) {
        setSent(true);
        return;
      }
      setError(
        response.status === 429
          ? "Muitas tentativas. Aguarde um minuto e tente novamente."
          : response.status === 400 || response.status === 422
            ? "Confira o e-mail digitado."
            : "Não foi possível enviar agora. Tente novamente em instantes.",
      );
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  if (sent)
    return (
      <>
        <p role="status">
          Se este e-mail tiver uma conta, enviamos um link para escolher uma nova senha. O link vale por 1 hora e só
          pode ser usado uma vez. Confira também a caixa de spam.
        </p>
        <Link className="account-link" href="/entrar">
          Voltar para entrar
        </Link>
      </>
    );
  return (
    <>
      <form className="stack-form" onSubmit={submit}>
        <label>
          E-mail da sua conta
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={pending}>
          {pending ? "Enviando…" : "Enviar o link"}
        </button>
      </form>
      <Link className="account-link" href="/entrar">
        Voltar para entrar
      </Link>
    </>
  );
}
