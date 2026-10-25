"use client";
import { useActionState, useTransition } from "react";
import { acceptTerms } from "./actions";
import { ConsentFields } from "./consent-fields";
import type { ShownTerms } from "./terms";

/**
 * The acceptance page's form. It sends from onSubmit rather than the `action` prop because React 19
 * resets a form after its action, which would clear the ticks whenever the server refused it.
 */
export function ConsentForm({ area, terms }: { area: "aluno" | "profissional"; terms: ShownTerms }) {
  const [error, action, pending] = useActionState(acceptTerms.bind(null, area), "");
  const [, startTransition] = useTransition();
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <ConsentFields terms={terms} />
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Registrando…" : "Aceitar e continuar"}
      </button>
    </form>
  );
}
