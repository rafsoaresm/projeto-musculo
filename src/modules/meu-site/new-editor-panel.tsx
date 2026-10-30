"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMountPath } from "@/components/use-mount-path";
import { Pill } from "@/components/ui";
import { deleteSite, setSiteEngine, setSiteInquiries } from "./actions";
import { PublicAddress } from "./public-address";
import type { PanelForm } from "./new-editor-forms";

export interface NewEditorState {
  slug: string;
  engine: "native" | "frappe";
  /** The pages of the new editor that are published, by route and title, and how many pages it holds in all. */
  published: Array<{ route: string; title: string }>;
  pages: number;
  /** Messages waiting in the inbox of the form (they stop the deletion). */
  waiting: number;
  /** The forms of the pages on the air, each with what it lacks to receive messages. */
  forms: { forms: PanelForm[]; skipped: number };
  /** The site's own switch, the environment's, and whether this login works the leads (and so may open the inbox). */
  inquiries: { open: boolean; platformOpen: boolean; canWork: boolean };
  canEdit: boolean;
}

/**
 * The new editor (Frappe Builder) in Meu Site: where to open it, which of its pages are on the air and at what address, which editor makes the
 * main address of the site, and the way out: deleting the whole site to start again from nothing.
 */
export function NewEditorPanel({ slug, engine, published, pages, waiting, forms, inquiries, canEdit }: NewEditorState) {
  const router = useRouter();
  const mountPath = useMountPath();
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const switchInquiries = (open: boolean) =>
    startTransition(async () => {
      const result = await setSiteInquiries(open);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
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
        <h3>Formulários e mensagens</h3>
        <p className="small muted">
          Desenhe o formulário no editor com os blocos do próprio editor: um <strong>Form</strong> com campos (o tipo de cada campo se escolhe no painel “Input”), uma área de texto e um botão. O campo
          de texto chamado <code>nome</code> (ou o primeiro campo de texto) é o <strong>nome</strong>; o campo do tipo <strong>Email</strong> e o do tipo <strong>Tel</strong> são o contato (um dos dois
          basta); a primeira área de texto é a <strong>mensagem</strong>; os outros campos vão para a mensagem como “rótulo: valor”. A caixa do aviso de privacidade é posta pelo site, antes do primeiro
          botão. A mensagem não vira lead sozinha: ela espera em Leads até você decidir.
        </p>
        <p className="small">
          {inquiries.platformOpen ? <Pill tone="success">Formulários abertos pela plataforma</Pill> : <Pill tone="neutral">Formulários fechados pela plataforma</Pill>}{" "}
          {inquiries.open ? <Pill tone="success">Recebimento ligado</Pill> : <Pill tone="neutral">Recebimento desligado</Pill>}
        </p>
        {!inquiries.platformOpen && (
          <p className="small muted">
            Os formulários públicos só abrem depois que o aviso de privacidade público e o parecer jurídico sobre leads existirem. Enquanto isso, o formulário não aparece para quem visita, mesmo com o
            recebimento ligado.
          </p>
        )}
        {forms.forms.length === 0 ? (
          <p className="muted">Nenhum formulário nas páginas que estão no ar.</p>
        ) : (
          <ul className="small" aria-label="Formulários das páginas no ar">
            {forms.forms.map((form, index) => (
              <li key={`${form.route}-${index}`}>
                {form.title} ({form.route ? `/${form.route}` : "página sem endereço"}):{" "}
                {form.problems.length === 0 ? (
                  <>
                    <strong>pronto</strong> — {form.summary}.
                  </>
                ) : (
                  <>
                    <strong>incompleto</strong> e não aparece para quem visita: {form.problems.join(" ")}
                  </>
                )}
                {form.ignored.length > 0 && <span className="muted"> {form.ignored.join(" ")}</span>}
              </li>
            ))}
          </ul>
        )}
        {forms.skipped > 0 && <p className="small muted">Só as primeiras 20 páginas no ar foram lidas aqui; há mais {forms.skipped}.</p>}
        {canEdit && (
          <div className="persist-actions">
            {inquiries.open ? (
              <button type="button" className="button secondary" disabled={pending} onClick={() => switchInquiries(false)}>
                Desligar o recebimento de mensagens
              </button>
            ) : (
              <button type="button" className="button secondary" disabled={pending} onClick={() => switchInquiries(true)}>
                Ligar o recebimento de mensagens
              </button>
            )}
          </div>
        )}
        {inquiries.canWork && (
          <div className="persist-actions">
            <Link className="button small secondary" href="/profissional/leads/mensagens">
              {waiting === 0 ? "Ver as mensagens do site" : `Ver as mensagens do site (${waiting} esperando)`}
            </Link>
          </div>
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
