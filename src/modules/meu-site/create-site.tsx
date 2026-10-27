"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSite } from "./actions";
import { SLUG_MAX, TITLE_MAX } from "./contracts";

/** The first step: an address and a title. Everything else is edited afterwards, in the draft. */
export function CreateSite({ suggestedSlug, suggestedTitle }: { suggestedSlug: string; suggestedTitle: string }) {
  const router = useRouter();
  const [slug, setSlug] = useState(suggestedSlug);
  const [title, setTitle] = useState(suggestedTitle);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="stack-form"
      aria-label="Criar o meu site"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createSite(slug, title);
          setMessage(result.ok ? "" : result.message);
          if (result.ok) router.refresh();
        });
      }}
    >
      <label>
        Título do site
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TITLE_MAX} autoComplete="off" required />
      </label>
      <label>
        Endereço (letras minúsculas, números e hífens)
        <input value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={SLUG_MAX} autoComplete="off" required />
      </label>
      <p className="small muted">
        O site fica em <code>/s/{slug || "seu-endereco"}</code> e só aparece para as pessoas depois que você publicar. Dá para mudar o endereço
        enquanto ele estiver fora do ar.
      </p>
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
      <div className="persist-actions">
        <button className="button primary" disabled={pending}>
          {pending ? "Criando…" : "Criar meu site"}
        </button>
      </div>
    </form>
  );
}
