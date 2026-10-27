"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { disconnectDevice } from "../device-actions";

/** One click: the other device only has to sign in again, so there is nothing to confirm. */
export function DisconnectDevice({ sessionId, label, enteredAt }: { sessionId: string; label: string; enteredAt: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function disconnect() {
    setPending(true);
    try {
      const result = await disconnectDevice(sessionId);
      setMessage(result.message);
    } catch {
      setMessage("Não foi possível desconectar. Tente novamente.");
    } finally {
      setPending(false);
      router.refresh();
    }
  }

  return (
    <span className="inline-form">
      <button
        type="button"
        className="button small secondary"
        disabled={pending}
        onClick={disconnect}
        aria-label={`Desconectar ${label}, que entrou em ${enteredAt}`}
      >
        {pending ? "Aguarde…" : "Desconectar"}
      </button>
      {message && (
        <span role="status" className="small muted">
          {message}
        </span>
      )}
    </span>
  );
}
