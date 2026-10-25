"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMountPath } from "@/components/use-mount-path";

const MIN = 12;
const MAX = 128;

/**
 * Password and sessions of the person who is signed in. The server checks the current password and
 * the new one; the screen only keeps what was typed when the server refuses, and clears it when it
 * accepts. Nothing here reveals whether an e-mail exists or shows another person's data.
 */
export function SecurityPanel() {
  const router = useRouter();
  const mountPath = useMountPath();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [others, setOthers] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function post(path: string, body: object) {
    return fetch(`${mountPath()}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  function fail(text: string) {
    setFailed(true);
    setMessage(text);
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (next.length < MIN || next.length > MAX) return fail(`A nova senha precisa ter de ${MIN} a ${MAX} caracteres.`);
    if (next !== again) return fail("A confirmação não é igual à nova senha.");
    if (next === current) return fail("Use uma senha diferente da atual.");
    setPending(true);
    try {
      const response = await post("change-password", {
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: others,
      });
      if (response.status === 401) {
        router.push("/entrar");
        router.refresh();
        return;
      }
      if (response.status === 429) return fail("Muitas tentativas. Aguarde um minuto e tente novamente.");
      if (!response.ok)
        return fail(
          [400, 422].includes(response.status)
            ? "Não foi possível alterar a senha. Confira a senha atual e a nova senha."
            : "O serviço de acesso não respondeu como esperado. Tente novamente em instantes.",
        );
      setCurrent("");
      setNext("");
      setAgain("");
      setFailed(false);
      setMessage(others ? "Senha alterada. Os outros aparelhos foram desconectados." : "Senha alterada.");
    } catch {
      fail("Não foi possível conectar. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  async function signOutOthers() {
    setMessage("");
    setPending(true);
    try {
      const response = await post("revoke-other-sessions", {});
      if (response.status === 401) {
        router.push("/entrar");
        router.refresh();
        return;
      }
      if (!response.ok) return fail("Não foi possível desconectar os outros aparelhos. Tente novamente.");
      setFailed(false);
      setMessage("Os outros aparelhos foram desconectados.");
    } catch {
      fail("Não foi possível conectar. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="stack-form" onSubmit={changePassword}>
      <label>
        Senha atual
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          maxLength={MAX}
          required
          onChange={(event) => setCurrent(event.target.value)}
        />
      </label>
      <label>
        Nova senha
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          maxLength={MAX}
          required
          onChange={(event) => setNext(event.target.value)}
        />
      </label>
      <label>
        Repita a nova senha
        <input
          type="password"
          autoComplete="new-password"
          value={again}
          maxLength={MAX}
          required
          onChange={(event) => setAgain(event.target.value)}
        />
      </label>
      <p className="small muted">De {MIN} a {MAX} caracteres. Uma frase longa é melhor que uma senha curta com símbolos.</p>
      <label className="check-row">
        <input type="checkbox" checked={others} onChange={(event) => setOthers(event.target.checked)} />
        Desconectar os outros aparelhos ao trocar a senha
      </label>
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      <div className="persist-actions">
        <button className="button primary" disabled={pending}>
          {pending ? "Salvando…" : "Alterar senha"}
        </button>
        <button type="button" className="button secondary" disabled={pending} onClick={signOutOthers}>
          Desconectar os outros aparelhos
        </button>
      </div>
    </form>
  );
}
