"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface Outcome {
  ok: boolean;
  message: string;
}

/**
 * Runs a server action from a panel control: a pending flag, the last answer (shown in a polite live region) and a refresh of the page's
 * data afterwards. Answers are plain sentences from the server; nothing in them is a key or a provider's own text.
 */
export function useRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  function run<T extends Outcome>(action: () => Promise<T>, after?: (result: T) => void) {
    startTransition(async () => {
      try {
        const result = await action();
        setOutcome({ ok: result.ok, message: result.message });
        after?.(result);
      } catch {
        setOutcome({ ok: false, message: "Não foi possível concluir. Tente novamente." });
      }
      router.refresh();
    });
  }
  return { pending, outcome, run, clear: () => setOutcome(null) };
}

/** A live region that is always in the document, so assistive technology announces what is put into it. */
export function Answer({ outcome, id }: { outcome: Outcome | null; id?: string }) {
  return (
    <p id={id} role="status" aria-live="polite" className={outcome ? (outcome.ok ? "ai-answer ok" : "ai-answer fail") : "ai-answer"}>
      {outcome?.message ?? ""}
    </p>
  );
}
