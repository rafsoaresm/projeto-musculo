"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Notice, formatDateTime } from "@/components/ui";
import { TermsBlock } from "@/modules/consentimento/terms-block";
import { changedParts, parseTermsContent, type Audience, type TermsContent } from "@/modules/consentimento/terms";
import { discardTermsDraft, publishTerms, saveTermsDraft } from "./terms-actions";
import { termsErrorMessage } from "./terms-errors";

interface SectionDraft {
  key: number;
  heading: string;
  text: string;
}

const EMPTY_PHOTOS = { heading: "", text: "", label: "" };
/** What the editor holds, as one string, to tell whether it differs from what is saved. */
const snapshotOf = (content: {
  title: string;
  intro: string;
  sections: Array<{ heading: string; text: string }>;
  confirmation: string;
  photos: { heading: string; text: string; label: string } | null;
}) =>
  JSON.stringify({
    ...content,
    sections: content.sections.map(({ heading, text }) => ({ heading, text })),
  });
const snapshotOfTerms = (content: TermsContent, withPhotos: boolean) =>
  snapshotOf({ ...content, photos: withPhotos ? (content.photos ?? EMPTY_PHOTOS) : null });

/** Who saved the draft that is open, and when; given by the page, not remembered by the editor. */
export interface DraftInfo {
  /** The revision the page loaded; null when there is no saved draft. */
  revision: number | null;
  savedAt: string | null;
  savedBy: string | null;
}

/**
 * Where the platform manager changes the words of the terms: edit, read what changed, publish. Nothing
 * is published until the last step, and a published version never changes: the next edit is a new
 * version. The words can be kept as a draft on the server meanwhile (it publishes nothing and changes
 * nobody's acceptance). The preview shows the very block people will read. Fields are controlled and
 * sent from a handler.
 */
export function TermsEditor({
  audience,
  current,
  initial,
  acceptedBy,
  inForceId,
  draft,
}: {
  audience: Audience;
  /** The words in force: what the changes are measured against. */
  current: TermsContent;
  /** The words the editor starts from: the ones in force, or an older version chosen from the history. */
  initial: TermsContent;
  acceptedBy: number;
  /** The row id of the version in force (null for the initial text): what this editor was loaded against. */
  inForceId: string | null;
  draft: DraftInfo;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [intro, setIntro] = useState(initial.intro);
  const [sections, setSections] = useState<SectionDraft[]>(
    initial.sections.map((section, index) => ({ key: index, ...section })),
  );
  const [nextKey, setNextKey] = useState(initial.sections.length);
  const [confirmation, setConfirmation] = useState(initial.confirmation);
  const [photos, setPhotos] = useState(initial.photos ?? { heading: "", text: "", label: "" });
  const hasPhotos = audience === "STUDENT";
  const [draftRevision, setDraftRevision] = useState(draft.revision);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotOfTerms(initial, hasPhotos));
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [note, setNote] = useState("");
  const [review, setReview] = useState<{ content: TermsContent; changes: string[] } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const touch = () => setMessage("");
  const dirty =
    snapshotOf({ title, intro, sections, confirmation, photos: hasPhotos ? photos : null }) !== savedSnapshot;

  // Leaving with words that are not saved would lose them. Closing or reloading is asked by the browser;
  // the links of this page (the tabs, the history) change the screen without leaving it, so they ask here.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const askBeforeLinks = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!window.confirm("Há alterações que ainda não foram salvas e vão se perder. Sair mesmo assim?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", askBeforeLinks, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", askBeforeLinks, true);
    };
  }, [dirty]);

  const update = (key: number, patch: Partial<SectionDraft>) => {
    setSections((all) => all.map((section) => (section.key === key ? { ...section, ...patch } : section)));
    touch();
  };
  const move = (index: number, by: -1 | 1) => {
    setSections((all) => {
      const target = index + by;
      if (target < 0 || target >= all.length) return all;
      const copy = [...all];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
    touch();
  };

  function build(): TermsContent | null {
    try {
      return parseTermsContent(audience, {
        title,
        intro,
        sections: sections.map(({ heading, text }) => ({ heading, text })),
        confirmation,
        ...(hasPhotos ? { photos } : {}),
      });
    } catch (error) {
      setFailed(true);
      setMessage(termsErrorMessage(error));
      return null;
    }
  }

  function saveDraft() {
    startTransition(async () => {
      const result = await saveTermsDraft(
        audience,
        { title, intro, sections: sections.map(({ heading, text }) => ({ heading, text })), confirmation, ...(hasPhotos ? { photos } : {}) },
        { inForceId, draftRevision },
      );
      if (!result.ok) {
        setFailed(true);
        setMessage(result.error);
        return;
      }
      setFailed(false);
      setDraftRevision(result.revision);
      setSavedSnapshot(snapshotOf({ title, intro, sections, confirmation, photos: hasPhotos ? photos : null }));
      setMessage("Rascunho salvo. Ele não publica nada nem muda o que ninguém aceitou.");
      router.refresh();
    });
  }

  function discardDraft() {
    if (draftRevision === null) return;
    startTransition(async () => {
      const result = await discardTermsDraft(audience, draftRevision);
      setConfirmingDiscard(false);
      if (!result.ok) {
        setFailed(true);
        setMessage(result.error);
        return;
      }
      // Back to the words in force, which is where a fresh edit starts.
      setTitle(current.title);
      setIntro(current.intro);
      setSections(current.sections.map((section, index) => ({ key: nextKey + index, ...section })));
      setNextKey((key) => key + current.sections.length);
      setConfirmation(current.confirmation);
      setPhotos(current.photos ?? EMPTY_PHOTOS);
      setSavedSnapshot(snapshotOfTerms(current, hasPhotos));
      setDraftRevision(null);
      setFailed(false);
      setMessage("Rascunho descartado. O editor voltou ao texto em vigor.");
      router.refresh();
    });
  }

  function toReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = build();
    if (!content) return;
    const changes = changedParts(current, content);
    if (changes.length === 0) {
      setFailed(true);
      setMessage("Nada mudou em relação ao texto em vigor.");
      return;
    }
    setFailed(false);
    setMessage("");
    setAgreed(false);
    setReview({ content, changes });
  }

  function publish() {
    if (!review) return;
    startTransition(async () => {
      const result = await publishTerms(audience, review.content, note, { inForceId, draftRevision });
      if (!result.ok) {
        setFailed(true);
        setMessage(result.error);
        return;
      }
      setFailed(false);
      setReview(null);
      setNote("");
      // The draft went away with the publication, and what is on the screen is now the text in force.
      setDraftRevision(null);
      setSavedSnapshot(snapshotOf({ title, intro, sections, confirmation, photos: hasPhotos ? photos : null }));
      setMessage(`Versão ${result.version} publicada. Todos aceitam de novo no próximo acesso.`);
      router.refresh();
    });
  }

  if (review) {
    return (
      <div className="terms-editor">
        <Notice tone="warning">
          <p>
            <strong>Antes de publicar.</strong> Esta alteração vira uma nova versão e{" "}
            {acceptedBy > 0 ? `as ${acceptedBy} pessoas que aceitaram o texto em vigor` : "quem entrar a partir de agora"}{" "}
            {acceptedBy > 0 ? "terão" : "terá"} de aceitar de novo no próximo acesso. A versão publicada não pode ser editada nem apagada.
          </p>
        </Notice>
        <section className="panel" aria-labelledby="mudancas">
          <h3 id="mudancas">O que mudou</h3>
          <ul>
            {review.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="previa">
          <h3 id="previa">Como a pessoa vai ler</h3>
          <TermsBlock terms={{ audience, version: "(prévia)", content: review.content }} />
        </section>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            publish();
          }}
        >
          <label>
            Motivo da alteração (opcional, fica no histórico)
            <textarea rows={2} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
            Este texto foi revisado e aprovado por quem responde juridicamente pelo produto.
          </label>
          {message && (
            <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
              {message}
            </p>
          )}
          <div className="persist-actions">
            <button className="button primary" disabled={!agreed || pending}>
              {pending ? "Publicando…" : "Publicar nova versão"}
            </button>
            <button type="button" className="button secondary" disabled={pending} onClick={() => setReview(null)}>
              Voltar e editar
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <form className="stack-form terms-editor" onSubmit={toReview}>
      <label>
        Título
        <input value={title} maxLength={120} onChange={(event) => (setTitle(event.target.value), touch())} />
      </label>
      <label>
        Introdução
        <textarea rows={4} value={intro} maxLength={3000} onChange={(event) => (setIntro(event.target.value), touch())} />
      </label>
      <fieldset>
        <legend>Seções</legend>
        {sections.map((section, index) => (
          <div key={section.key} className="terms-section" role="group" aria-label={`Seção ${index + 1}`}>
            <label>
              Título da seção {index + 1}
              <input value={section.heading} maxLength={120} onChange={(event) => update(section.key, { heading: event.target.value })} />
            </label>
            <label>
              Texto da seção {index + 1}
              <textarea rows={4} value={section.text} maxLength={4000} onChange={(event) => update(section.key, { text: event.target.value })} />
            </label>
            <div className="terms-section-actions">
              <button type="button" className="button secondary small" disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp size={16} /> Subir <span className="sr-only">a seção {index + 1}</span>
              </button>
              <button type="button" className="button secondary small" disabled={index === sections.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown size={16} /> Descer <span className="sr-only">a seção {index + 1}</span>
              </button>
              <button
                type="button"
                className="button danger-outline small"
                disabled={sections.length === 1}
                onClick={() => {
                  setSections((all) => all.filter((item) => item.key !== section.key));
                  touch();
                }}
              >
                <Trash2 size={16} /> Remover <span className="sr-only">a seção {index + 1}</span>
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="button secondary small"
          disabled={sections.length >= 20}
          onClick={() => {
            setSections((all) => [...all, { key: nextKey, heading: "", text: "" }]);
            setNextKey((key) => key + 1);
            touch();
          }}
        >
          <Plus size={16} /> Adicionar seção
        </button>
      </fieldset>
      <label>
        Frase de confirmação (a caixa que a pessoa marca)
        <input value={confirmation} maxLength={300} onChange={(event) => (setConfirmation(event.target.value), touch())} />
      </label>
      {hasPhotos && (
        <fieldset>
          <legend>Bloco das fotos (a escolha opcional do aluno)</legend>
          <label>
            Título do bloco
            <input value={photos.heading} maxLength={120} onChange={(event) => (setPhotos({ ...photos, heading: event.target.value }), touch())} />
          </label>
          <label>
            Texto do bloco
            <textarea rows={5} value={photos.text} maxLength={4000} onChange={(event) => (setPhotos({ ...photos, text: event.target.value }), touch())} />
          </label>
          <label>
            Frase da caixa opcional
            <input value={photos.label} maxLength={300} onChange={(event) => (setPhotos({ ...photos, label: event.target.value }), touch())} />
          </label>
        </fieldset>
      )}
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      <div className="persist-actions">
        <button className="button primary" disabled={pending}>
          Revisar as alterações
        </button>
        <button type="button" className="button secondary" disabled={pending || !dirty} onClick={saveDraft}>
          {pending ? "Salvando…" : "Salvar rascunho"}
        </button>
        {draftRevision !== null && !confirmingDiscard && (
          <button type="button" className="button danger-outline" disabled={pending} onClick={() => setConfirmingDiscard(true)}>
            Descartar rascunho
          </button>
        )}
      </div>
      {confirmingDiscard && (
        <div className="persist-actions" role="group" aria-label="Confirmar o descarte do rascunho">
          <span className="small">Descartar o rascunho salvo? Ele some para todos os gestores.</span>
          <button type="button" className="button danger-outline" disabled={pending} onClick={discardDraft}>
            Sim, descartar
          </button>
          <button type="button" className="button secondary" disabled={pending} onClick={() => setConfirmingDiscard(false)}>
            Cancelar
          </button>
        </div>
      )}
      <p className="small muted" role="status">
        {dirty
          ? "Há alterações ainda não salvas."
          : draftRevision !== null && draft.savedBy
            ? `Rascunho salvo por ${draft.savedBy} em ${formatDateTime(draft.savedAt ?? "")}.`
            : "Nenhuma alteração pendente."}
      </p>
      <p className="small muted">
        Nada é publicado agora: o próximo passo mostra o que mudou e como a pessoa vai ler. O rascunho guarda as
        palavras no servidor para você continuar depois, sem pedir novo aceite a ninguém.
      </p>
    </form>
  );
}
