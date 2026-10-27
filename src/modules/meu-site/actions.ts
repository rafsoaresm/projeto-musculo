"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { sitesFor } from "@/db/sites";
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
  | { status: "conflict" | "error"; message: string };
export type RestoreResult = { status: "restored"; revision: number; content: SiteContent } | { status: "conflict" | "error"; message: string };

const FAILED = "Não foi possível concluir. Tente novamente.";
const CONFLICT = "Outra pessoa salvou o site depois de você abri-lo. Copie o que escreveu, atualize a página e refaça a mudança.";
const FORBIDDEN = "Só o proprietário ou a gestão editam e publicam o site.";
const refresh = () => revalidatePath("/profissional", "layout");

export async function createSite(slug: string, title: string): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await sitesFor(db, context).create({ slug, title });
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
      message: error instanceof ZodError ? "O endereço precisa ter de 3 a 40 letras minúsculas, números ou hífens (não pode ser um nome reservado), e o título de 2 a 80 caracteres." : FAILED,
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

export async function publishSite(revision: number): Promise<PublishResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await sitesFor(db, context).publish(Number(revision));
    if (outcome.status === "published") {
      refresh();
      return outcome;
    }
    if (outcome.status === "invalid") return outcome;
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
