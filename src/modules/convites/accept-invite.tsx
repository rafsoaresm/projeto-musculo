"use client";
import { useActionState } from "react";
import { acceptInvite } from "./actions";

export function AcceptInvite({ token }: { token: string }) {
  const [error, action, pending] = useActionState(
    acceptInvite.bind(null, token),
    "",
  );
  return (
    <form action={action} className="stack-form">
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
