"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMountPath } from "@/components/use-mount-path";
import { deleteSite, setSiteEngine } from "./actions";
import { PublicAddress } from "./public-address";

export interface NewEditorState {
  slug: string;
  engine: "native" | "frappe";
  /** The pages of the new editor that are published, by route and title, and how many pages it holds in all. */
  published: Array<{ route: string; title: string }>;
  pages: number;
  /** Messages waiting in the inbox of the form (they stop the deletion). */
  waiting: number;
  canEdit: boolean;
}

/**
 * The new editor (Frappe Builder) in Meu Site: where to open it, which of its pages are on the air and at what address, which editor makes the
 * main address of the site, and the way out: deleting the whole site to start again from nothing.
 */
export function NewEditorPanel({ slug, engine, published, pages, waiting, canEdit }: NewEditorState) {
  const router = useRouter();
  const mountPath = useMountPath();
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const change = (next: "native" | "frappe") =>
    startTransition(async () => {
      const result = await setSiteEngine(next);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  return (
    <>
      <section className="panel" aria-labelledby="editor-novo">
        <h2 id="editor-novo">Editor novo (Frappe Builder)</h2>
        <p className="muted">
          Blocos livres, cores com roda e hexadecimal, fontes, imagens, o cabeçalho, o logotipo e o rodapé como blocos que você edita. Você publica pelo botão{" "}
          <strong>Publish</strong> do editor, e cada página no ar aparece em <code>/site/{slug}/…</code>.
        </p>
        {canEdit && (
          <p>
            <Link className="button primary" href="/profissional/meu-site/editor" prefetch={false}>
              Abrir o editor novo
            </Link>
          </p>
        )}
        <h3>Páginas no ar no editor novo</h3>
        {published.length === 0 ? (
          <p className="muted">
            Nenhuma ainda{pages > 0 ? ` (${pages} em rascunho)` : ""}. No editor, clique em <strong>Publish</strong> para colocar uma página no ar.
          </p>
        ) : (
          <ul className="small" aria-label="Páginas no ar no editor novo">
            {published.map((page) => (
              <li key={page.route}>
                {page.title} — <PublicAddress slug={slug} base="site" path={page.route ? `/${page.route}` : ""} />{" "}
                <a href={`${mountPath()}/site/${slug}${page.route ? `/${page.route}` : ""}`} target="_blank" rel="noopener noreferrer">
                  ver
                </a>
              </li>
            ))}
          </ul>
        )}
        <h3>Endereço principal</h3>
        {engine === "frappe" ? (
          <p>
            O endereço <PublicAddress slug={slug} /> leva ao site do <strong>editor novo</strong>. O site do editor anterior continua guardado.
          </p>
        ) : (
          <p>
            O endereço <PublicAddress slug={slug} /> mostra o site do <strong>editor anterior</strong>. Quando o do editor novo estiver pronto, coloque-o no lugar dele; dá para voltar quando
            quiser, nada é apagado.
          </p>
        )}
        {canEdit && (
          <div className="persist-actions">
            {engine === "frappe" ? (
              <button className="button secondary" disabled={pending} onClick={() => change("native")}>
                Voltar ao editor anterior
              </button>
            ) : (
              <button className="button primary" disabled={pending || published.length === 0} onClick={() => change("frappe")}>
                Colocar o site novo no endereço principal
              </button>
            )}
          </div>
        )}
        {message && (
          <p role="status" className="small">
            {message}
          </p>
        )}
      </section>

      {canEdit && (
        <section className="panel" aria-labelledby="excluir-site">
          <h2 id="excluir-site">Excluir o site e recomeçar</h2>
          <p className="muted">
            Apaga tudo: o endereço, o rascunho, as versões e as imagens do editor anterior, e as páginas, os componentes, as configurações e as imagens do editor novo. Não dá para desfazer. Depois você
            cria um site do zero, com o editor que quiser.
          </p>
          {waiting > 0 ? (
            <p role="alert" className="form-error">
              Há {waiting} mensagem(ns) esperando na caixa de entrada de Leads. Transforme em lead ou descarte antes de excluir o site.
            </p>
          ) : !deleting ? (
            <div className="persist-actions">
              <button className="button danger" onClick={() => setDeleting(true)}>
                Excluir o site…
              </button>
            </div>
          ) : (
            <form
              className="stack-form"
              aria-label="Excluir o site"
              onSubmit={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const result = await deleteSite(confirmation);
                  setMessage(result.message);
                  if (result.ok) router.refresh();
                });
              }}
            >
              <label>
                Para confirmar, digite o endereço do site (<code>{slug}</code>)
                <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required />
              </label>
              <div className="persist-actions">
                <button className="button danger" disabled={pending || confirmation.trim().toLowerCase() !== slug}>
                  {pending ? "Excluindo…" : "Excluir o site para sempre"}
                </button>
                <button type="button" className="button secondary" onClick={() => setDeleting(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </>
  );
}
