"use client";
import { useState, useTransition } from "react";
import { acceptManagerInviteAction } from "./manager-actions";

/** The signed-in person accepts. The link's token is the only thing sent. */
export function AcceptManagerInvite({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function accept() {
    startTransition(async () => {
      // On success the action redirects; a message only comes back when the link did not work.
      setMessage((await acceptManagerInviteAction(token)) ?? "");
    });
  }
  return (
    <>
      <button type="button" className="button primary" disabled={pending} onClick={accept}>
        {pending ? "Aguarde…" : "Aceitar e tornar-me gestor"}
      </button>
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
    </>
  );
}
