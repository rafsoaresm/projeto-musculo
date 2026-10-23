"use client";
import { useActionState } from "react";
import { setMemberAccess } from "./actions";

export function MemberAccess({
  organizationId,
  userId,
  blocked,
  name,
}: {
  organizationId: string;
  userId: string;
  blocked: boolean;
  name: string;
}) {
  const [message, action, pending] = useActionState(
    setMemberAccess.bind(null, organizationId, userId, !blocked),
    "",
  );
  return (
    <form action={action} className="inline-form">
      <button
        className={`button small ${blocked ? "secondary" : "danger-outline"}`}
        disabled={pending}
        aria-label={`${blocked ? "Restabelecer o acesso de" : "Bloquear o acesso de"} ${name}`}
      >
        {pending
          ? "Aguarde…"
          : blocked
            ? "Restabelecer acesso"
            : "Bloquear acesso"}
      </button>
      {message && (
        <span role="status" className="small muted">
          {message}
        </span>
      )}
    </form>
  );
}
