"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMountPath } from "@/components/use-mount-path";

const MIN = 12;
const MAX = 128;

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Sets the new password with the token of the e-mail link. The token is in the fragment of the address
 * (after the #), which a browser never sends to a server, so it is read here, in the browser, and taken
 * off the address at once so it is not left in the history. It is sent in the body of a POST. Every
 * session of the account is ended when it works.
 */
export function ResetPasswordForm() {
  // undefined: not read yet. null: there is no valid token in the address.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const mountPath = useMountPath();
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // The address only exists in the browser, so it is read here. It can also change without the page
    // reloading (a link pasted into the same tab only changes the fragment), so it is read again then.
    function read(initial: boolean) {
      if (!initial && !window.location.hash) return;
      const found = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      setToken(TOKEN.test(found) ? found : null);
      setError("");
      setDone(false);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    const onChange = () => read(false);
    const first = window.setTimeout(() => read(true), 0);
    window.addEventListener("hashchange", onChange);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("hashchange", onChange);
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (next.length < MIN || next.length > MAX) return setError(`A senha precisa ter de ${MIN} a ${MAX} caracteres.`);
    if (next !== again) return setError("A confirmação não é igual à nova senha.");
    setPending(true);
    try {
      const response = await fetch(`${mountPath()}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: next, token }),
      });
      if (response.ok) {
        setDone(true);
        return;
      }
      setError(
        response.status === 429
          ? "Muitas tentativas. Aguarde um minuto e tente novamente."
          : response.status === 400 || response.status === 422
            ? "Este link venceu ou já foi usado. Peça um novo em “Esqueci minha senha”."
            : "Não foi possível alterar a senha agora. Tente novamente em instantes.",
      );
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  if (token === undefined) return <p className="muted">Um instante…</p>;
  if (token === null)
    return (
      <>
        <p>Este link não é válido. Peça um novo link em “Esqueci minha senha”.</p>
        <Link className="account-link" href="/esqueci-a-senha">
          Pedir um novo link
        </Link>
      </>
    );
  if (done)
    return (
      <>
        <p role="status">Senha alterada. Você foi desconectado de todos os aparelhos: entre com a nova senha.</p>
        <Link className="button primary" href="/entrar">
          Entrar
        </Link>
      </>
    );
  return (
    <>
      <form className="stack-form" onSubmit={submit}>
        <label>
          Nova senha
          <input
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN}
            maxLength={MAX}
            value={next}
            onChange={(event) => setNext(event.target.value)}
            aria-describedby="reset-help"
          />
        </label>
        <label>
          Repita a nova senha
          <input
            name="again"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN}
            maxLength={MAX}
            value={again}
            onChange={(event) => setAgain(event.target.value)}
          />
        </label>
        <span className="small" id="reset-help">
          Use pelo menos 12 caracteres.
        </span>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={pending}>
          {pending ? "Aguarde…" : "Salvar a nova senha"}
        </button>
      </form>
      <Link className="account-link" href="/esqueci-a-senha">
        Pedir um novo link
      </Link>
    </>
  );
}
