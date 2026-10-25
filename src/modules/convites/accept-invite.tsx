"use client";
import { useActionState, useTransition } from "react";
import { ConsentFields } from "@/modules/consentimento/consent-fields";
import { acceptInvite } from "./actions";

/**
 * The student reads the terms and accepts them here, once, in the same step that accepts the
 * invitation. It sends from onSubmit because React 19 resets a form after its action, which would
 * clear the ticks whenever the server refused it.
 */
export function AcceptInvite({ token }: { token: string }) {
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
      <ConsentFields audience="STUDENT" />
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
