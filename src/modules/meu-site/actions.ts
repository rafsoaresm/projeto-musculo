"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { getSiteMediaBucket } from "@/db/binding";
import { sitesFor, type SiteEngine } from "@/db/sites";
import type { PublishIssue, SiteContent } from "./contracts";

/**
 * The workspace and the person come from the verified session; the browser sends only the content of the
 * editor and the revision it was looking at. The repository repeats the membership, the role and the
 * revision in the statement that writes.
 */
export type SimpleResult = { ok: boolean; message: string };
export type SaveResult = { status: "saved"; revision: number } | { status: "conflict" | "error"; message: string };
export type PublishResult =
  | { status: "published"; number: number }
  | { status: "invalid"; issues: PublishIssue[] }
  | { status: "warnings"; issues: PublishIssue[] }
  | { status: "conflict" | "error"; message: string };
export type RestoreResult = { status: "restored"; revision: number; content: SiteContent } | { status: "conflict" | "error"; message: string };

const FAILED = "Não foi possível concluir. Tente novamente.";
const CONFLICT = "Outra pessoa salvou o site depois de você abri-lo. Copie o que escreveu, atualize a página e refaça a mudança.";
const FORBIDDEN = "Só o proprietário ou a gestão editam e publicam o site.";
const refresh = () => revalidatePath("/profissional", "layout");

export async function createSite(slug: string, title: string, model: string = "single", engine: string = "native"): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await sitesFor(db, context).create({ slug, title, model, engine });
    if (outcome.status === "created") {
      refresh();
      return { ok: true, message: "Site criado." };
    }
    const message = {
      exists: "Este espaço já tem um site.",
      slug_taken: "Esse endereço já está em uso. Escolha outro.",
      forbidden: FORBIDDEN,
    }[outcome.status];
    return { ok: false, message };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ZodError ? "O endereço precisa ter de 3 a 40 letras minúsculas, números ou hífens (não pode ser um nome reservado), o título de 2 a 80 caracteres, e o modelo um dos que a tela oferece." : FAILED,
    };
  }
}

export async function saveSiteDraft(content: unknown, revision: number): Promise<SaveResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await sitesFor(db, context).saveDraft(content, Number(revision));
    if (outcome.status === "saved") {
      refresh();
      return outcome;
    }
    return outcome.status === "conflict" ? { status: "conflict", message: CONFLICT } : { status: "error", message: FORBIDDEN };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof ZodError ? "O conteúdo não é válido: confira o tamanho dos textos, o limite de blocos e que nenhum texto tenha caracteres invisíveis (alguns emojis compostos têm)." : FAILED,
    };
  }
}

/** `withWarnings` is the person's "publish anyway": the warnings do not stop it (what stops it still does). */
export async function publishSite(revision: number, withWarnings = false): Promise<PublishResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await sitesFor(db, context).publish(Number(revision), new Date(), { withWarnings: withWarnings === true });
    if (outcome.status === "published") {
      refresh();
      return outcome;
    }
    if (outcome.status === "invalid" || outcome.status === "warnings") return outcome;
    return outcome.status === "conflict"
      ? { status: "conflict", message: "O rascunho mudou depois de você abri-lo. Atualize a página e publique de novo." }
      : { status: "error", message: FORBIDDEN };
  } catch {
    return { status: "error", message: FAILED };
  }
}

export async function unpublishSite(): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const done = await sitesFor(db, context).unpublish();
    if (done) refresh();
    return done ? { ok: true, message: "O site saiu do ar." } : { ok: false, message: "O site não está no ar, ou você não tem permissão para tirá-lo." };
  } catch {
    return { ok: false, message: FAILED };
  }
}

export async function restoreSiteRelease(releaseId: string, revision: number): Promise<RestoreResult> {
  const { db, context } = await requireWorkspace();
  try {
    const repo = sitesFor(db, context);
    const outcome = await repo.restore(String(releaseId), Number(revision));
    if (outcome.status === "restored") {
      const overview = await repo.overview();
      refresh();
      return overview
        ? { status: "restored", revision: outcome.revision, content: overview.draft.content }
        : { status: "error", message: FAILED };
    }
    return outcome.status === "conflict"
      ? { status: "conflict", message: CONFLICT }
      : { status: "error", message: "Não encontramos essa versão." };
  } catch {
    return { status: "error", message: FAILED };
  }
}

/** The site's own switch for the messages of the contact form. Opening it does nothing alone while the environment keeps the public forms closed. */
export async function setSiteInquiries(open: boolean): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await sitesFor(db, context).setInquiriesOpen(open === true);
    if (outcome.status === "saved") {
      refresh();
      return { ok: true, message: outcome.open ? "O site passou a receber as mensagens do formulário." : "O site parou de receber as mensagens do formulário." };
    }
    return { ok: false, message: FORBIDDEN };
  } catch {
    return { ok: false, message: FAILED };
  }
}

/** The site's own switch for what the free code of its pages may reach outside the site (it sends the visitor's address to those sites). */
export async function setSiteCodeNetwork(open: boolean): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await sitesFor(db, context).setCodeExternalOpen(open === true);
    if (outcome.status === "saved") {
      refresh();
      return { ok: true, message: outcome.open ? "O código livre das páginas passou a poder carregar coisas de outros sites (https)." : "O código livre das páginas deixou de poder carregar coisas de outros sites." };
    }
    return { ok: false, message: FORBIDDEN };
  } catch {
    return { ok: false, message: FAILED };
  }
}

export async function changeSiteAddress(slug: string): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await sitesFor(db, context).changeSlug(slug);
    if (outcome.status === "changed") {
      refresh();
      return { ok: true, message: "Endereço mudado." };
    }
    const message = {
      slug_taken: "Esse endereço já está em uso. Escolha outro.",
      public: "O endereço não muda com o site no ar: os links já compartilhados deixariam de funcionar. Tire o site do ar primeiro.",
      not_found: "Não foi possível mudar o endereço.",
    }[outcome.status];
    return { ok: false, message };
  } catch (error) {
    return { ok: false, message: error instanceof ZodError ? "O endereço precisa ter de 3 a 40 letras minúsculas, números ou hífens (não pode ser um nome reservado)." : FAILED };
  }
}

/** Which editor makes the page at the main address. The new one only takes it once one of its pages is published. */
export async function setSiteEngine(engine: SiteEngine): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  if (engine !== "native" && engine !== "frappe") return { ok: false, message: FAILED };
  try {
    const outcome = await sitesFor(db, context).setEngine(engine);
    if (outcome.status === "changed") {
      refresh();
      return { ok: true, message: engine === "frappe" ? "O endereço principal agora mostra o site do editor novo." : "O endereço principal voltou a mostrar o site do editor anterior." };
    }
    return {
      ok: false,
      message: outcome.status === "nothing_published" ? "Publique antes ao menos uma página no editor novo: sem isso o endereço não mostraria nada." : FORBIDDEN,
    };
  } catch {
    return { ok: false, message: FAILED };
  }
}

/**
 * Deletes the whole site, so the person can start from nothing. The address is typed again to confirm, and the deletion is refused while
 * messages from the contact form wait in the inbox (they are people's data and are dealt with first).
 */
export async function deleteSite(confirmation: string): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await sitesFor(db, context).deleteSite(String(confirmation ?? ""));
    if (outcome.status === "deleted") {
      // The files go after the rows; one that stays behind belongs to no row and is reachable by nobody.
      const bucket = await getSiteMediaBucket();
      if (bucket) await Promise.all(outcome.objectKeys.map((key) => bucket.delete(key).catch(() => undefined)));
      refresh();
      return { ok: true, message: "O site foi excluído. Você pode criar outro do zero." };
    }
    const message = {
      confirmation_differs: "O endereço digitado não é o do site. Nada foi excluído.",
      inquiries_waiting: `Há ${outcome.status === "inquiries_waiting" ? outcome.count : 0} mensagem(ns) esperando na caixa de entrada de Leads. Transforme em lead ou descarte antes de excluir o site.`,
      not_found: FORBIDDEN,
    }[outcome.status];
    return { ok: false, message };
  } catch {
    return { ok: false, message: FAILED };
  }
}
