"use client";
import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Pill, formatDateTime } from "@/components/ui";
import { useMountPath } from "@/components/use-mount-path";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import type { ReleaseRow, ServiceChoice } from "@/db/sites";
import { BlockEditor } from "./block-editor";
import {
  BLOCK_LABEL,
  BLOCK_TYPES,
  DESCRIPTION_MAX,
  MAX_BLOCKS,
  PUBLIC_WARNING,
  TITLE_MAX,
  emptyBlock,
  newBlockId,
  type Block,
  type BlockType,
  type PublishIssue,
  type SiteContent,
} from "./contracts";
import { changeSiteAddress, publishSite, restoreSiteRelease, saveSiteDraft, unpublishSite } from "./actions";

interface Props {
  slug: string;
  initial: { content: SiteContent; revision: number; updatedAt: string };
  live: { number: number; publishedAt: string; draftRevision: number } | null;
  releases: ReleaseRow[];
  services: ServiceChoice[];
  canEdit: boolean;
}

/** One answer per place: next to the button that was pressed, so two buttons never share (or repeat) a message. */
function useNote() {
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  return {
    say: (text: string, failed = false) => setNote(text ? { text, failed } : null),
    clear: () => setNote(null),
    element: note && (
      <p role={note.failed ? "alert" : "status"} className={note.failed ? "form-error" : "small muted"}>
        {note.text}
      </p>
    ),
  };
}

const noSubscription = () => () => undefined;
/** The public address as the browser sees it (with the origin and the mount); on the server, the path only. */
function PublicAddress({ slug }: { slug: string }) {
  const mountPath = useMountPath();
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");
  return <code className="site-address">{origin ? `${origin}${mountPath()}/s/${slug}` : `/s/${slug}`}</code>;
}

/**
 * The editor of the page: the data of the site, the blocks, the draft, the publication and the versions.
 * The whole document is held here and sent on save together with the revision that was loaded, so a save
 * made from a stale screen is refused instead of overwriting. Publishing needs the draft saved, and what
 * is public changes only on "Publicar".
 */
export function SiteWorkspace({ slug, initial, live, releases, services, canEdit }: Props) {
  const router = useRouter();
  const [content, setContent] = useState<SiteContent>(initial.content);
  const [saved, setSaved] = useState(() => JSON.stringify(initial.content));
  const [revision, setRevision] = useState(initial.revision);
  const stateNote = useNote();
  const saveNote = useNote();
  const addressNote = useNote();
  const versionsNote = useNote();
  const [issues, setIssues] = useState<PublishIssue[]>([]);
  const [newType, setNewType] = useState<BlockType>("text");
  const [newSlug, setNewSlug] = useState(slug);
  const [confirmingRestore, setConfirmingRestore] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(content) !== saved;
  useUnsavedGuard(dirty);
  const unpublished = live !== null && revision > live.draftRevision;

  const edit = (next: SiteContent) => {
    setContent(next);
    saveNote.clear();
    setIssues([]);
  };
  const setBlocks = (blocks: Block[]) => edit({ ...content, blocks });
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= content.blocks.length) return;
    const copy = [...content.blocks];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    setBlocks(copy);
  };

  function save() {
    startTransition(async () => {
      const result = await saveSiteDraft(content, revision);
      if (result.status === "saved") {
        setRevision(result.revision);
        setSaved(JSON.stringify(content));
        saveNote.say("Rascunho salvo.");
        router.refresh();
      } else {
        saveNote.say(result.message, true);
      }
    });
  }
  function publish() {
    startTransition(async () => {
      setIssues([]);
      const result = await publishSite(revision);
      if (result.status === "published") {
        stateNote.say(`Publicado: o site está no ar na versão ${result.number}.`);
        router.refresh();
      } else if (result.status === "invalid") {
        setIssues(result.issues);
        stateNote.say("Falta completar o site antes de publicar.", true);
      } else {
        stateNote.say(result.message, true);
      }
    });
  }
  function unpublish() {
    startTransition(async () => {
      const result = await unpublishSite();
      stateNote.say(result.message, !result.ok);
      router.refresh();
    });
  }
  function restore(releaseId: string) {
    startTransition(async () => {
      const result = await restoreSiteRelease(releaseId, revision);
      setConfirmingRestore(null);
      if (result.status === "restored") {
        setContent(result.content);
        setSaved(JSON.stringify(result.content));
        setRevision(result.revision);
        setIssues([]);
        versionsNote.say("A versão voltou para o rascunho. O que está no ar não mudou: publique para trocar.");
        router.refresh();
      } else {
        versionsNote.say(result.message, true);
      }
    });
  }
  function changeAddress() {
    startTransition(async () => {
      const result = await changeSiteAddress(newSlug);
      addressNote.say(result.message, !result.ok);
      router.refresh();
    });
  }

  return (
    <>
      <section className="panel" aria-labelledby="estado-site">
        <h2 id="estado-site">Estado do site</h2>
        <p>
          {live ? <Pill tone="success">No ar</Pill> : <Pill tone="neutral">Fora do ar</Pill>}{" "}
          {live
            ? `Versão ${live.number}, publicada em ${formatDateTime(live.publishedAt)}.`
            : "Ninguém vê o site até você publicar."}
        </p>
        <p className="small">
          Endereço: <PublicAddress slug={slug} />
        </p>
        {live && (
          <p className="small">
            <Link href={`/s/${slug}`} target="_blank" rel="noopener noreferrer">
              Abrir a página pública
            </Link>
          </p>
        )}
        {unpublished && <p className="small">Há alterações salvas que ainda não foram publicadas.</p>}
        <p className="small muted">{PUBLIC_WARNING}</p>
        {issues.length > 0 && (
          <div className="notice warning" role="alert">
            <div>
              <p>
                <strong>Antes de publicar:</strong>
              </p>
              <ul aria-label="O que falta para publicar">
                {issues.map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <div className="persist-actions">
          <Link className="button secondary" href="/profissional/meu-site/previa">
            Ver a prévia
          </Link>
          {canEdit && (
            <button type="button" className="button primary" disabled={pending || dirty} onClick={publish}>
              {pending ? "Aguarde…" : live ? "Publicar uma nova versão" : "Publicar"}
            </button>
          )}
          {canEdit && live && (
            <button type="button" className="button danger-outline" disabled={pending} onClick={unpublish}>
              Tirar do ar
            </button>
          )}
        </div>
        {canEdit && dirty && <p className="small muted">Salve o rascunho antes de publicar.</p>}
        {!canEdit && <p className="small muted">Só o proprietário ou a gestão editam e publicam o site. Você pode ver o rascunho.</p>}
        {stateNote.element}
      </section>

      {canEdit && !live && (
        <section className="panel" aria-labelledby="endereco-site">
          <h2 id="endereco-site">Endereço do site</h2>
          <p className="small muted">
            Pode mudar enquanto o site está fora do ar. Depois de publicado, o endereço fica fixo para os links já compartilhados continuarem
            funcionando.
          </p>
          <form
            className="stack-form"
            aria-label="Mudar o endereço do site"
            onSubmit={(event) => {
              event.preventDefault();
              changeAddress();
            }}
          >
            <label>
              Endereço (letras minúsculas, números e hífens)
              <input value={newSlug} onChange={(event) => setNewSlug(event.target.value)} maxLength={40} autoComplete="off" />
            </label>
            <div className="persist-actions">
              <button className="button secondary" disabled={pending || newSlug === slug}>
                Mudar o endereço
              </button>
            </div>
            {addressNote.element}
          </form>
        </section>
      )}

      <section className="panel" aria-labelledby="dados-site">
        <h2 id="dados-site">Dados do site</h2>
        <fieldset className="plain-fieldset stack-form" disabled={!canEdit}>
          <label>
            Título do site
            <input value={content.title} maxLength={TITLE_MAX} autoComplete="off" onChange={(event) => edit({ ...content, title: event.target.value })} />
          </label>
          <label>
            Descrição para buscadores (opcional)
            <textarea value={content.description} maxLength={DESCRIPTION_MAX} rows={2} onChange={(event) => edit({ ...content, description: event.target.value })} />
          </label>
          <label>
            WhatsApp
            <input
              type="tel"
              value={content.contact.whatsapp}
              maxLength={30}
              autoComplete="off"
              onChange={(event) => edit({ ...content, contact: { ...content.contact, whatsapp: event.target.value } })}
            />
          </label>
          <label>
            E-mail de contato
            <input
              type="email"
              value={content.contact.email}
              maxLength={254}
              autoComplete="off"
              onChange={(event) => edit({ ...content, contact: { ...content.contact, email: event.target.value } })}
            />
          </label>
          <label>
            Instagram (o nome de usuário)
            <input
              value={content.contact.instagram}
              maxLength={31}
              autoComplete="off"
              onChange={(event) => edit({ ...content, contact: { ...content.contact, instagram: event.target.value } })}
            />
          </label>
          <p className="small muted">Os botões e o rodapé do site levam a estes contatos. Só aparecem os que estiverem preenchidos.</p>
        </fieldset>
      </section>

      <section aria-labelledby="blocos-site">
        <h2 id="blocos-site" className="section-title">
          Blocos da página
        </h2>
        {content.blocks.length === 0 && (
          <div className="panel">
            <p>A página ainda não tem blocos. Acrescente o primeiro abaixo.</p>
          </div>
        )}
        {content.blocks.map((block, index) => (
          <div className="panel" key={block.id}>
            <fieldset disabled={!canEdit} className="plain-fieldset">
              <BlockEditor
                block={block}
                index={index}
                total={content.blocks.length}
                services={services}
                onChange={(next) => setBlocks(content.blocks.map((b) => (b.id === block.id ? next : b)))}
                onMove={(by) => move(index, by)}
                onDuplicate={() =>
                  content.blocks.length < MAX_BLOCKS &&
                  setBlocks([...content.blocks.slice(0, index + 1), { ...structuredClone(block), id: newBlockId() }, ...content.blocks.slice(index + 1)])
                }
                onRemove={() => setBlocks(content.blocks.filter((b) => b.id !== block.id))}
              />
            </fieldset>
          </div>
        ))}
        {canEdit && (
          <div className="panel">
            <div className="stack-form">
              <label>
                Novo bloco
                <select value={newType} onChange={(event) => setNewType(event.target.value as BlockType)}>
                  {BLOCK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {BLOCK_LABEL[type]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="persist-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={content.blocks.length >= MAX_BLOCKS}
                  onClick={() => setBlocks([...content.blocks, emptyBlock(newType)])}
                >
                  <Plus size={16} /> Acrescentar bloco
                </button>
              </div>
              {content.blocks.length >= MAX_BLOCKS && <p className="small muted">Limite de {MAX_BLOCKS} blocos.</p>}
            </div>
          </div>
        )}
      </section>

      {canEdit && (
        <section className="panel save-bar" aria-label="Salvar o rascunho">
          <p className="small">{dirty ? "Há alterações ainda não salvas." : `Rascunho salvo (revisão ${revision}).`}</p>
          <div className="persist-actions">
            <button type="button" className="button primary" disabled={pending || !dirty} onClick={save}>
              {pending ? "Aguarde…" : "Salvar rascunho"}
            </button>
          </div>
          {saveNote.element}
        </section>
      )}

      <section className="panel" aria-labelledby="versoes-site">
        <h2 id="versoes-site">Versões publicadas</h2>
        {releases.length === 0 ? (
          <p className="small muted">Nenhuma versão foi publicada ainda.</p>
        ) : (
          <ul className="device-list" aria-label="Versões publicadas">
            {releases.map((release) => (
              <li key={release.id}>
                <span className="device-name">
                  <strong>Versão {release.number}</strong>
                  {release.live && <Pill tone="success">No ar</Pill>}
                  <span className="small muted">
                    Publicada em {formatDateTime(release.createdAt)}
                    {release.createdByName ? ` por ${release.createdByName}` : ""}.
                  </span>
                </span>
                {canEdit &&
                  (confirmingRestore === release.id ? (
                    <span className="inline-form">
                      <span className="small">Isto substitui o rascunho salvo. O que está no ar não muda.</span>
                      <button type="button" className="button small primary" disabled={pending} onClick={() => restore(release.id)}>
                        Confirmar: usar a versão {release.number} como rascunho
                      </button>
                      <button type="button" className="button small secondary" onClick={() => setConfirmingRestore(null)}>
                        Voltar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="button small secondary"
                      disabled={pending || dirty}
                      aria-label={`Usar a versão ${release.number} como rascunho`}
                      onClick={() => setConfirmingRestore(release.id)}
                    >
                      Usar como rascunho
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        )}
        {canEdit && dirty && releases.length > 0 && <p className="small muted">Salve as alterações para poder voltar a uma versão.</p>}
        {versionsNote.element}
      </section>
    </>
  );
}
