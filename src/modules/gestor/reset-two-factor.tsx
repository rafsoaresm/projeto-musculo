"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Turning off the second step of someone else. Two clicks, and the screen says what the manager is
 * vouching for: the tool cannot tell that it is that person asking, the manager has to. The component
 * stays on the page after the reset (without the buttons) so that the answer does not vanish with them.
 */
export function ResetTwoFactor({
  name,
  enabled,
  reset,
}: {
  name: string;
  /** Whether the person has the second step on right now; false hides the buttons, not the answer. */
  enabled: boolean;
  reset: () => Promise<string>;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function confirm() {
    setPending(true);
    try {
      setMessage(await reset());
    } catch {
      setMessage("Não foi possível redefinir. Tente novamente.");
    } finally {
      setPending(false);
      setAsking(false);
      router.refresh();
    }
  }

  if (!enabled && !message) return null;
  return (
    <span className="inline-form">
      {!enabled ? null : asking ? (
        <>
          <span className="small">
            Confirme, por outro canal, que é {name} quem pede. A sessão dessa pessoa será encerrada.
          </span>
          <button type="button" className="button small danger-outline" disabled={pending} onClick={confirm}>
            {pending ? "Aguarde…" : `Confirmar: redefinir as duas etapas de ${name}`}
          </button>
          <button type="button" className="button small secondary" disabled={pending} onClick={() => setAsking(false)}>
            Voltar
          </button>
        </>
      ) : (
        <button
          type="button"
          className="button small secondary"
          onClick={() => (setMessage(""), setAsking(true))}
          aria-label={`Redefinir a verificação em duas etapas de ${name}`}
        >
          Redefinir duas etapas
        </button>
      )}
      {message && (
        <span role="status" className="small muted">
          {message}
        </span>
      )}
    </span>
  );
}
