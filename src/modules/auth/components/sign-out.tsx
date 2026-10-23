"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function SignOut({
  redirectTo = "/entrar",
  variant = "button",
}: {
  /** An internal path chosen by the page. */
  redirectTo?: string;
  /** "nav" is a menu row, "topbar" a small button, "button" the default. */
  variant?: "button" | "nav" | "topbar";
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        className={
          variant === "nav"
            ? "nav-link subtle sign-out"
            : variant === "topbar"
              ? "button secondary small"
              : "button secondary"
        }
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
            router.push(redirectTo);
            router.refresh();
          } catch {
            setError(true);
          } finally {
            setPending(false);
          }
        }}
      >
        {variant === "nav" && <LogOut size={17} />}
        <span>{pending ? "Saindo…" : "Sair"}</span>
      </button>
      {error && (
        <span role="alert" className="small form-error-inline">
          Não foi possível sair. Tente novamente.
        </span>
      )}
    </>
  );
}
