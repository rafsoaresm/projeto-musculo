"use client";
import { useRef } from "react";

/**
 * Idempotency key and write id of one user intent (design §4.8): made with `crypto.randomUUID()` on the first click, reused when
 * the same intent (same `what`, e.g. "regenerate session 2|1") is sent again after a network failure, and renewed after a
 * definitive answer or when another intent is sent. Never used for authorization.
 */
export function useIntent() {
  const current = useRef<{ what: string; key: string; write: string } | null>(null);
  return {
    take(what: string) {
      if (!current.current || current.current.what !== what)
        current.current = { what, key: crypto.randomUUID(), write: crypto.randomUUID() };
      return current.current;
    },
    done() {
      current.current = null;
    },
  };
}

export const NETWORK_ERROR = "Não foi possível falar com o servidor. Tente de novo: o mesmo pedido será reenviado, sem duplicar nada.";
