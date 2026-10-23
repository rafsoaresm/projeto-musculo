"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function SignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        className="button secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(false);
          try {
            const response = await fetch(
              `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/auth/sign-out`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              },
            );
            if (!response.ok) throw new Error();
            router.push("/entrar");
            router.refresh();
          } catch {
            setError(true);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Saindo…" : "Sair"}
      </button>
      {error && (
        <span role="alert">Não foi possível sair. Tente novamente.</span>
      )}
    </>
  );
}
