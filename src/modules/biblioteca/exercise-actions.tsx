"use client";
import { useActionState } from "react";
import {
  archiveExercise,
  copySystemExercise,
  restoreExercise,
} from "./actions";

/** One button with its own message: copy, archive or restore. */
export function ExerciseAction({
  kind,
  id,
  label,
}: {
  kind: "copy" | "archive" | "restore";
  id: string;
  label: string;
}) {
  const run =
    kind === "copy"
      ? copySystemExercise
      : kind === "archive"
        ? archiveExercise
        : restoreExercise;
  const [message, action, pending] = useActionState(
    run.bind(null, id) as () => Promise<string>,
    "",
  );
  return (
    <form action={action} className="inline-form">
      <button
        className={`button small ${kind === "archive" ? "danger-outline" : "secondary"}`}
        disabled={pending}
      >
        {pending ? "Aguarde…" : label}
      </button>
      {message && (
        <span role="status" className="small muted">
          {message}
        </span>
      )}
    </form>
  );
}
