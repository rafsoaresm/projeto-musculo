"use client";
import { useActionState, useTransition } from "react";
import { setPhotosChoice, type PhotosChoiceResult } from "./actions";
import type { ShownTerms } from "./terms";

/**
 * The student's photos choice, after joining. Shows the same words they saw when they accepted, the
 * current state, and one box. It sends from onSubmit rather than the `action` prop because React 19
 * resets a form after its action; the box is remounted by `key` when the saved state changes.
 */
export function PhotosChoice({ authorized, terms }: { authorized: boolean; terms: ShownTerms }) {
  const photos = terms.content.photos;
  const [result, action, pending] = useActionState(setPhotosChoice, null as PhotosChoiceResult);
  const [, startTransition] = useTransition();
  if (!photos) return null;
  return (
    <form
      key={String(authorized)}
      className="stack-form"
      aria-labelledby="fotos-escolha"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="termsVersion" value={terms.version} />
      <h3 id="fotos-escolha">{photos.heading}</h3>
      <p className="muted">{photos.text}</p>
      <p>
        Hoje: <strong>{authorized ? "você autorizou as fotos" : "você não autorizou as fotos"}</strong>.
      </p>
      <label className="check-row">
        <input type="checkbox" name="photos" defaultChecked={authorized} />
        {photos.label}
      </label>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "small muted" : "form-error"}>
          {result.message}
        </p>
      )}
      <button className="button secondary" disabled={pending}>
        {pending ? "Registrando…" : "Salvar minha escolha"}
      </button>
    </form>
  );
}
