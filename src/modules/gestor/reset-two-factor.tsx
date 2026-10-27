"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Turning off the second step of someone else. Two clicks, and the screen says what the manager is
 * vouching for: the tool cannot tell that it is that person asking, the manager has to.
 */
export function ResetTwoFactor({
  name,
  reset,
}: {
  name: string;
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

  return (
    <span className="inline-form">
      {asking ? (
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
