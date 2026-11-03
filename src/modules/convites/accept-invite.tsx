"use client";
import { useActionState, useTransition } from "react";
import { TermsReading } from "@/modules/consentimento/terms-reading";
import type { ShownTerms } from "@/modules/consentimento/terms";
import { acceptInvite } from "./actions";

/**
 * The student accepts the invitation here; the terms in force can be read, folded, and nothing has to be
 * ticked. It sends from onSubmit because React 19 resets a form after its action.
 */
export function AcceptInvite({ token, terms }: { token: string; terms: ShownTerms }) {
  const [error, action, pending] = useActionState(acceptInvite.bind(null, token), "");
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
      <TermsReading terms={terms} />
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Aceitando…" : "Aceitar convite"}
      </button>
    </form>
  );
}
