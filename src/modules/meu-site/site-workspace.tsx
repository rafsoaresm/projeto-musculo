"use client";
import { useReducer, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { Pill, formatDateTime } from "@/components/ui";
import { useMountPath } from "@/components/use-mount-path";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import type { AssetRow } from "@/db/site-assets";
import type { ReleaseRow, ServiceChoice } from "@/db/sites";
import { PUBLIC_WARNING, type PublishIssue, type SiteContent } from "./contracts";
import { historyReducer, startHistory } from "./editor-history";
import { PREPARE_MESSAGE, prepareImage } from "./image-upload";
import type { RemoveResult, UploadResult } from "./image-picker";
import { PublicAddress } from "./public-address";
import { VisualEditor } from "./visual-editor";
import { changeSiteAddress, publishSite, restoreSiteRelease, saveSiteDraft, unpublishSite } from "./actions";

interface Props {
  slug: string;
  initial: { content: SiteContent; revision: number; updatedAt: string };
  live: { number: number; publishedAt: string; draftRevision: number } | null;
  releases: ReleaseRow[];
  services: ServiceChoice[];
  images: { available: boolean; library: AssetRow[] };
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
type Note = ReturnType<typeof useNote>;

/**
 * The site of the professional: the state (public or not), the address, the versions and the visual editor.
 * The whole document is held here, with its undo history, and sent on save together with the revision that
 * was loaded, so a save made from a stale screen is refused instead of overwriting. Publishing needs the
 * draft saved, and what is public changes only on "Publicar". The editor is a window over this state: the
 * answers to what is pressed inside it are shown inside it, and the ones of this screen stay here.
 */
export function SiteWorkspace({ slug, initial, live, releases, services, images, canEdit }: Props) {
  const router = useRouter();
  const mountPath = useMountPath();
  const [library, setLibrary] = useState<AssetRow[]>(images.library);
  const [history, dispatch] = useReducer(historyReducer, initial.content, startHistory);
  const content = history.present;
  const [saved, setSaved] = useState(() => JSON.stringify(initial.content));
  const [revision, setRevision] = useState(initial.revision);
  const [editorOpen, setEditorOpen] = useState(false);
  const stateNote = useNote();
  const saveNote = useNote();
  const editorNote = useNote();
  const addressNote = useNote();
  const versionsNote = useNote();
  const [issues, setIssues] = useState<PublishIssue[]>([]);
  const [newSlug, setNewSlug] = useState(slug);
  const [confirmingRestore, setConfirmingRestore] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(content) !== saved;
  useUnsavedGuard(dirty);
  const unpublished = live !== null && revision > live.draftRevision;

  const afterChange = () => {
    saveNote.clear();
    editorNote.clear();
    setIssues([]);
  };
  const edit = (next: SiteContent, key?: string) => {
    dispatch({ type: "edit", content: next, at: Date.now(), key });
    afterChange();
  };

  /** Sending an image is immediate (the library is the site's, not the draft's): re-drawn here, checked again there. */
  async function uploadImage(file: File): Promise<UploadResult> {
    try {
      const blob = await prepareImage(file);
      const response = await fetch(`${mountPath()}/profissional/meu-site/imagens`, {
        method: "POST",
        headers: { "x-site-request": "1", "Content-Type": blob.type },
        body: blob,
      });
      const body = (await response.json().catch(() => null)) as { asset?: AssetRow; error?: string } | null;
      if (!response.ok || !body?.asset) return { ok: false, message: body?.error ?? "Não foi possível enviar a imagem." };
      const asset = body.asset;
      setLibrary((current) => [asset, ...current]);
      return { ok: true, asset };
    } catch (error) {
      return { ok: false, message: PREPARE_MESSAGE[(error as Error).message] ?? "Não foi possível ler este arquivo como imagem. Tente um JPEG ou um PNG." };
    }
  }
  async function removeImage(assetId: string): Promise<RemoveResult> {
    const response = await fetch(`${mountPath()}/profissional/meu-site/imagens/${assetId}`, { method: "DELETE", headers: { "x-site-request": "1" } });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (response.ok) {
      setLibrary((current) => current.filter((asset) => asset.id !== assetId));
      return { ok: true, message: "Imagem removida." };
    }
    return { ok: false, message: body?.error ?? "Não foi possível remover a imagem." };
  }

  /** `note` is where the answer is shown: the editor's own, or the one of this screen. */
  function save(note: Note) {
    startTransition(async () => {
      const result = await saveSiteDraft(content, revision);
      if (result.status === "saved") {
        setRevision(result.revision);
        setSaved(JSON.stringify(content));
        note.say("Rascunho salvo.");
        router.refresh();
      } else {
        note.say(result.message, true);
      }
    });
  }
  function publish(note: Note) {
    startTransition(async () => {
      setIssues([]);
      const result = await publishSite(revision);
      if (result.status === "published") {
        note.say(`Publicado: o site está no ar na versão ${result.number}.`);
        router.refresh();
      } else if (result.status === "invalid") {
        setIssues(result.issues);
        note.say("Falta completar o site antes de publicar.", true);
      } else {
        note.say(result.message, true);
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
        dispatch({ type: "replace", content: result.content });
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
        {!editorOpen && issues.length > 0 && (
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
          {canEdit && (
            <button type="button" className="button primary" onClick={() => setEditorOpen(true)}>
              <LayoutTemplate size={20} /> Abrir o editor visual
            </button>
          )}
          <Link className="button secondary" href="/profissional/meu-site/previa">
            Ver a prévia do rascunho salvo
          </Link>
          {canEdit && (
            <button type="button" className="button primary" disabled={pending || dirty} onClick={() => publish(stateNote)}>
              {pending ? "Aguarde…" : live ? "Publicar uma nova versão" : "Publicar"}
            </button>
          )}
          {canEdit && live && (
            <button type="button" className="button danger-outline" disabled={pending} onClick={unpublish}>
              Tirar do ar
            </button>
          )}
        </div>
        {canEdit && dirty && (
          <div className="stack-form">
            <p className="small">Há alterações no editor que ainda não foram salvas.</p>
            <div className="persist-actions">
              <button type="button" className="button secondary" disabled={pending} onClick={() => save(saveNote)}>
                {pending ? "Aguarde…" : "Salvar rascunho"}
              </button>
            </div>
          </div>
        )}
        {!canEdit && <p className="small muted">Só o proprietário ou a gestão editam e publicam o site. Você pode ver a prévia do rascunho.</p>}
        {stateNote.element}
        {!editorOpen && saveNote.element}
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

      {canEdit && editorOpen && (
        <VisualEditor
          content={content}
          onEdit={edit}
          undo={() => {
            dispatch({ type: "undo" });
            afterChange();
          }}
          redo={() => {
            dispatch({ type: "redo" });
            afterChange();
          }}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          services={services}
          images={{ available: images.available, library, upload: uploadImage, remove: removeImage }}
          slug={slug}
          dirty={dirty}
          revision={revision}
          pending={pending}
          live={live !== null}
          onSave={() => save(editorNote)}
          onPublish={() => publish(editorNote)}
          note={editorNote.element}
          issues={issues}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </>
  );
}
