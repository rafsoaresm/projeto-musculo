"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/modules/auth/server";
import { termsFor, type EditorState } from "@/db/terms";
import type { Audience } from "@/modules/consentimento/terms";
import { draftErrorMessage, termsErrorMessage } from "./terms-errors";

export type PublishTermsResult = { ok: true; version: string } | { ok: false; error: string };
export type DraftResult = { ok: true; revision: number | null } | { ok: false; error: string };

/** What the editor loaded; the client only says it, the repository checks it against the database. */
export interface EditorStateInput {
  inForceId: string | null;
  draftRevision: number | null;
}

const CHANGED_UNDER_YOU =
  "Outro gestor salvou ou descartou o rascunho depois que você abriu esta página. Se quiser guardar o que você escreveu, copie os campos antes; depois atualize a página, veja o que foi feito e tente de novo.";
const BASE_CHANGED =
  "Outro texto foi publicado depois que você abriu esta página, então o que você está vendo já não é o texto em vigor. Se quiser guardar o que você escreveu, copie os campos antes; depois atualize a página, leia o texto novo e refaça a alteração sobre ele.";
const knownAudience = (audience: Audience) => audience === "STUDENT" || audience === "PROFESSIONAL";
const stateOf = (input: EditorStateInput): EditorState => ({
  inForceId: typeof input?.inForceId === "string" ? input.inForceId : null,
  draftRevision: typeof input?.draftRevision === "number" && Number.isInteger(input.draftRevision) ? input.draftRevision : null,
});

/**
 * Publishes the words typed by the platform manager as the next version of one audience's terms. The
 * manager comes from the verified session; the repository checks it again and the database refuses
 * anyone else. Everyone who accepted another version is asked again at their next access. If another
 * manager published, or saved or discarded the draft, after the editor loaded, nothing is published.
 */
export async function publishTerms(
  audience: Audience,
  content: unknown,
  note: string,
  loaded: EditorStateInput,
): Promise<PublishTermsResult> {
  const { db, context } = await requirePlatformAdmin();
  if (!knownAudience(audience)) return { ok: false, error: "Texto não encontrado." };
  try {
    const outcome = await termsFor(db, context).publish(audience, content, note, new Date(), stateOf(loaded));
    if (outcome.status === "unchanged")
      return { ok: false, error: "Nada mudou em relação ao texto em vigor. Publicar assim pediria um novo aceite sem motivo." };
    if (outcome.status === "conflict") return { ok: false, error: "Outra publicação aconteceu agora mesmo. Atualize a página e tente de novo." };
    if (outcome.status === "draft_changed") return { ok: false, error: CHANGED_UNDER_YOU };
    if (outcome.status === "base_changed") return { ok: false, error: BASE_CHANGED };
    revalidatePath("/gestor/termos");
    return { ok: true, version: outcome.version };
  } catch (error) {
    return { ok: false, error: termsErrorMessage(error) };
  }
}

/**
 * Saves the words as the draft of one audience. It changes nobody's acceptance and publishes nothing.
 * `loaded` is what the editor loaded: the draft revision (null when it loaded none) and the version in force.
 */
export async function saveTermsDraft(audience: Audience, content: unknown, loaded: EditorStateInput): Promise<DraftResult> {
  const { db, context } = await requirePlatformAdmin();
  if (!knownAudience(audience)) return { ok: false, error: "Texto não encontrado." };
  try {
    const outcome = await termsFor(db, context).saveDraft(audience, content, stateOf(loaded));
    if (outcome.status === "conflict") return { ok: false, error: CHANGED_UNDER_YOU };
    if (outcome.status === "base_changed") return { ok: false, error: BASE_CHANGED };
    revalidatePath("/gestor/termos");
    return { ok: true, revision: outcome.revision };
  } catch (error) {
    return { ok: false, error: draftErrorMessage(error) };
  }
}

/** Throws the draft away. Only the revision the editor loaded can be discarded. */
export async function discardTermsDraft(audience: Audience, draftRevision: number): Promise<DraftResult> {
  const { db, context } = await requirePlatformAdmin();
  if (!knownAudience(audience)) return { ok: false, error: "Texto não encontrado." };
  try {
    const outcome = await termsFor(db, context).discardDraft(audience, draftRevision);
    if (outcome.status === "conflict") return { ok: false, error: CHANGED_UNDER_YOU };
    revalidatePath("/gestor/termos");
    return { ok: true, revision: null };
  } catch (error) {
    return { ok: false, error: draftErrorMessage(error) };
  }
}
