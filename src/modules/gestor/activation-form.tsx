"use client";
import { useActionState } from "react";
import { activateManager } from "./actions";

export function ActivationForm() {
  const [error, action, pending] = useActionState(activateManager, "");
  return (
    <form action={action} className="stack-form">
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
        />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Verificando…" : "Ativar como gestor"}
      </button>
    </form>
  );
}
