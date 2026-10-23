"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AccountForm({ signup = false }: { signup?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/auth/${signup ? "sign-up" : "sign-in"}/email`,
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
        setError(
          response.status === 429
            ? "Muitas tentativas. Aguarde um minuto e tente novamente."
            : response.status === 503
              ? "Acesso temporariamente indisponível. Tente novamente mais tarde."
              : signup
                ? "Não foi possível criar a conta. Confira os dados ou tente entrar."
                : "Não foi possível entrar. Confira seu e-mail e sua senha.",
        );
        return;
      }
      router.push("/alunos");
      router.refresh();
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="account-card">
      <p className="eyebrow">SEU ESPAÇO DE ATENDIMENTO</p>
      <h1>{signup ? "Comece pelo seu cuidado." : "Bom ter você de volta."}</h1>
      <p>
        {signup
          ? "Crie sua conta profissional para organizar seus alunos."
          : "Entre para continuar o acompanhamento dos seus alunos."}
      </p>
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
          {pending ? "Aguarde…" : signup ? "Criar minha conta" : "Entrar"}
        </button>
      </form>
      <Link className="account-link" href={signup ? "/entrar" : "/cadastro"}>
        {signup ? "Já tenho uma conta" : "Criar uma conta profissional"}
      </Link>
    </section>
  );
}
