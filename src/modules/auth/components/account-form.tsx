"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMountPath } from "@/components/use-mount-path";

type Audience = "profissional" | "aluno" | "gestor";

const copy = {
  login: {
    eyebrow: "ACESSO",
    heading: "Bom ter você de volta.",
    text: "Entre para continuar. Você será levado à sua área.",
    submit: "Entrar",
  },
  profissional: {
    eyebrow: "PROFISSIONAL",
    heading: "Comece pelo seu cuidado.",
    text: "Crie sua conta profissional para organizar seus alunos.",
    submit: "Criar minha conta",
  },
  gestor: {
    eyebrow: "GESTOR",
    heading: "Crie a sua conta de gestor.",
    text: "Use um e-mail e uma senha. O convite vale para a conta com a qual você o aceitar.",
    submit: "Criar minha conta",
  },
  aluno: {
    eyebrow: "CONVITE",
    heading: "Crie seu acesso.",
    text: "Use um e-mail e uma senha para entrar na sua área do aluno.",
    submit: "Criar meu acesso",
  },
} as const;

export function AccountForm({
  signup = false,
  audience = "profissional",
  redirectTo = "/acesso",
  switchTo,
  forgotHref,
}: {
  signup?: boolean;
  audience?: Audience;
  /** An internal path chosen by the page, never by a query string. */
  redirectTo?: string;
  switchTo?: { href: string; label: string };
  /** Only passed when the recovery of the password by e-mail exists in this environment. */
  forgotHref?: string;
}) {
  const router = useRouter();
  const mountPath = useMountPath();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // After the password, an account with the second step on gets no session until a code is accepted.
  const [challenge, setChallenge] = useState<"app" | "recovery" | null>(null);
  const text = signup ? copy[audience] : copy.login;
  const alternate = switchTo ?? {
    href: signup ? "/entrar" : "/cadastro",
    label: signup ? "Já tenho uma conta" : "Criar uma conta profissional",
  };
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `${mountPath()}/api/auth/${signup ? "sign-up" : "sign-in"}/email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: data.get("email"),
            password: data.get("password"),
            ...(signup ? { name: data.get("name") } : {}),
          }),
        },
      );
      if (!response.ok) {
        // 400/401/422 are about what was typed. Anything else means the access
        // service itself did not answer as expected, which is not the user's fault.
        const typed = [400, 401, 422].includes(response.status);
        setError(
          response.status === 429
            ? "Muitas tentativas. Aguarde um minuto e tente novamente."
            : !typed
              ? "O serviço de acesso não respondeu como esperado. Tente novamente em instantes."
              : signup
                ? "Não foi possível criar a conta. Confira os dados ou tente entrar."
                : "Não foi possível entrar. Confira seu e-mail e sua senha.",
        );
        return;
      }
      const answer = (await response.json().catch(() => ({}))) as { twoFactorRedirect?: boolean };
      if (!signup && answer.twoFactorRedirect) {
        setChallenge("app");
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setPending(false);
    }
  }
  async function verify(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const typed = String(data.get("code") ?? "").replace(/\s/g, "");
    try {
      const response = await fetch(
        `${mountPath()}/api/auth/two-factor/${challenge === "app" ? "verify-totp" : "verify-backup-code"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: typed }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { code?: string };
        // The challenge is gone (too many wrong codes, or it expired): back to the password.
        if (
          body.code === "INVALID_TWO_FACTOR_COOKIE" ||
          body.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
        ) {
          setChallenge(null);
          setError("A verificação expirou ou teve tentativas demais. Entre de novo com a senha.");
        } else if (response.status === 429) {
          setError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
        } else if (response.status === 401 || response.status === 400) {
          setError(
            challenge === "app"
              ? "Esse código não confere. Confira o aplicativo e digite o código atual, com 6 dígitos."
              : "Esse código de recuperação não confere ou já foi usado.",
          );
        } else {
          setError("O serviço de acesso não respondeu como esperado. Tente novamente em instantes.");
        }
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setPending(false);
    }
  }
  if (challenge)
    return (
      <section className="account-card">
        <p className="eyebrow">VERIFICAÇÃO EM DUAS ETAPAS</p>
        <h1>Digite o código.</h1>
        <p>
          {challenge === "app"
            ? "Abra o aplicativo autenticador e digite o código de 6 dígitos de Trainer Prescription."
            : "Digite um dos códigos de recuperação que você guardou. Cada um vale uma vez."}
        </p>
        <form className="stack-form" onSubmit={verify} aria-label="Verificação em duas etapas">
          <label>
            {challenge === "app" ? "Código do aplicativo" : "Código de recuperação"}
            <input
              key={challenge}
              name="code"
              autoComplete="one-time-code"
              inputMode={challenge === "app" ? "numeric" : "text"}
              autoFocus
              required
              maxLength={challenge === "app" ? 7 : 24}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={pending}>
            {pending ? "Aguarde…" : "Confirmar"}
          </button>
        </form>
        <button
          type="button"
          className="account-link"
          onClick={() => {
            setError("");
            setChallenge(challenge === "app" ? "recovery" : "app");
          }}
        >
          {challenge === "app" ? "Perdi o celular: usar um código de recuperação" : "Voltar ao código do aplicativo"}
        </button>
      </section>
    );
  return (
    <section className="account-card">
      <p className="eyebrow">{text.eyebrow}</p>
      <h1>{text.heading}</h1>
      <p>{text.text}</p>
      <form className="stack-form" onSubmit={submit}>
        {signup && (
          <label>
            Seu nome
            <input
              name="name"
              autoComplete="name"
              required
              minLength={2}
              maxLength={160}
            />
          </label>
        )}
        <label>
          E-mail
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <label>
          Senha
          <input
            name="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
            minLength={signup ? 12 : 1}
            maxLength={128}
            aria-describedby={signup ? "password-help" : undefined}
          />
        </label>
        {signup && (
          <span className="small" id="password-help">
            Use pelo menos 12 caracteres.
          </span>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={pending}>
          {pending ? "Aguarde…" : text.submit}
        </button>
      </form>
      {!signup && forgotHref && (
        <Link className="account-link" href={forgotHref}>
          Esqueci minha senha
        </Link>
      )}
      <Link className="account-link" href={alternate.href}>
        {alternate.label}
      </Link>
    </section>
  );
}
