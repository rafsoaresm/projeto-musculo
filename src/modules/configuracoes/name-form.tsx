"use client";
import { useState, useTransition } from "react";
import { NAME_MAX } from "./contracts";
import type { SettingsResult } from "./actions";

/**
 * One name, saved on its own. The field is controlled and sent from a handler, not from `action`:
 * React 19 resets a form after its action, which would erase the text whenever the server refuses it.
 */
export function NameForm({
  label,
  formLabel,
  initial,
  save,
  savedText,
}: {
  label: string;
  formLabel: string;
  initial: string;
  save: (name: string) => Promise<SettingsResult>;
  savedText: string;
}) {
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await save(value);
      setFailed(Boolean(result.error));
      setMessage(result.error ?? (result.saved ? savedText : "Esse já é o nome atual."));
    });
  }

  return (
    <form className="stack-form" onSubmit={submit} aria-label={formLabel}>
      <label>
        {label}
        <input
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setMessage("");
          }}
          maxLength={NAME_MAX}
          autoComplete="off"
          required
        />
      </label>
      <div className="persist-actions">
        <button className="button" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
      </div>
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
    </form>
  );
}
