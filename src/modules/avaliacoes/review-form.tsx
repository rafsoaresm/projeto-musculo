"use client";
import { useState, useTransition } from "react";
import { reviewAssessment } from "./actions";

/** Appends one review. Reviews are never edited or removed; another one can be added later. */
export function ReviewForm({
  assessmentId,
  hasReview,
}: {
  assessmentId: string;
  hasReview: boolean;
}) {
  const [basis, setBasis] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await reviewAssessment(assessmentId, basis);
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "Revisão registrada.");
      if (!result.error) setBasis("");
    });
  }

  return (
    <form className="stack-form" onSubmit={submit}>
      <label>
        {hasReview ? "Acrescentar outra revisão" : "Base da sua revisão"}
        <textarea
          rows={3}
          value={basis}
          maxLength={1000}
          required
          onChange={(event) => {
            setBasis(event.target.value);
            setMessage("");
          }}
        />
      </label>
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      <button className="button primary" disabled={pending || basis.trim() === ""}>
        {pending ? "Registrando…" : "Registrar revisão"}
      </button>
    </form>
  );
}
