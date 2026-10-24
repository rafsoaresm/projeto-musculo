"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMountPath } from "@/components/use-mount-path";

type Audience = "profissional" | "aluno";

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
}: {
  signup?: boolean;
  audience?: Audience;
  /** An internal path chosen by the page, never by a query string. */
  redirectTo?: string;
  switchTo?: { href: string; label: string };
}) {
  const router = useRouter();
  const mountPath = useMountPath();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
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
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setPending(false);
    }
  }
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
      <Link className="account-link" href={alternate.href}>
        {alternate.label}
      </Link>
    </section>
  );
}
