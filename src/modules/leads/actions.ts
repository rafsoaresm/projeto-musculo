"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireWorkspace } from "@/modules/auth/server";
import { leadsFor, type ConvertHow, type LeadMatch } from "@/db/leads";
import { servicesFor } from "@/db/services";
import type { LeadStage } from "./contracts";

/**
 * Every action takes the workspace and the person from the verified session. What the browser sends is
 * only the content of the form (and the id of the lead it is looking at); the repositories repeat the
 * membership, the role and the active login in each statement.
 */
export type SimpleResult = { ok: boolean; message: string };
export type CreateLeadResult =
  | { status: "created"; id: string }
  | { status: "duplicates"; matches: LeadMatch[] }
  | { status: "error"; message: string };
export type ConvertResult = { status: "converted" | "already"; studentId: string; message: string } | { status: "error"; message: string };

const INVALID_LEAD =
  "Confira os dados: o nome precisa ter de 2 a 160 caracteres e é preciso informar um e-mail ou um telefone válidos.";
const FORBIDDEN = "O seu papel neste espaço não trabalha os leads.";
const UNAVAILABLE = "Esse serviço não está mais na oferta. Escolha outro ou deixe em branco.";
const FAILED = "Não foi possível concluir. Tente novamente.";
const refresh = () => revalidatePath("/profissional", "layout");

export async function createLead(input: unknown, confirmDuplicates: boolean): Promise<CreateLeadResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await leadsFor(db, context).create(input, { confirmDuplicates: confirmDuplicates === true });
    if (outcome.status === "created") {
      refresh();
      return { status: "created", id: outcome.id };
    }
    if (outcome.status === "duplicates") return outcome;
    return { status: "error", message: outcome.status === "invalid_service" ? UNAVAILABLE : FORBIDDEN };
  } catch (error) {
    return { status: "error", message: error instanceof ZodError ? INVALID_LEAD : FAILED };
  }
}

export async function updateLead(leadId: string, input: unknown): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await leadsFor(db, context).update(leadId, input);
    if (outcome.status === "saved") {
      refresh();
      return { ok: true, message: "Dados salvos." };
    }
    if (outcome.status === "invalid_service") return { ok: false, message: UNAVAILABLE };
    if (outcome.status === "converted") return { ok: false, message: "Este lead já virou aluno e não muda mais." };
    return { ok: false, message: "Não encontramos este lead." };
  } catch (error) {
    return { ok: false, message: error instanceof ZodError ? INVALID_LEAD : FAILED };
  }
}

export async function moveLead(leadId: string, from: LeadStage, input: unknown): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await leadsFor(db, context).moveTo(leadId, from, input);
    if (outcome.status === "moved") {
      refresh();
      return { ok: true, message: "Etapa atualizada." };
    }
    if (outcome.status === "conflict") return { ok: false, message: "Outra pessoa mudou a etapa deste lead. Atualize a página e tente de novo." };
    if (outcome.status === "converted") return { ok: false, message: "Este lead já virou aluno e não muda mais." };
    if (outcome.status === "unchanged") return { ok: false, message: "O lead já está nessa etapa." };
    return { ok: false, message: "Não encontramos este lead." };
  } catch (error) {
    return { ok: false, message: error instanceof ZodError ? "Para marcar como perdido, escolha o motivo." : FAILED };
  }
}

export async function addLeadNote(leadId: string, note: string): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const done = await leadsFor(db, context).addNote(leadId, { note });
    if (done) refresh();
    return done ? { ok: true, message: "Anotação salva." } : { ok: false, message: "Não encontramos este lead." };
  } catch (error) {
    return { ok: false, message: error instanceof ZodError ? "Escreva a anotação (até 1.000 caracteres, sem caracteres especiais)." : FAILED };
  }
}

export async function deleteLead(leadId: string): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const done = await leadsFor(db, context).remove(leadId);
    if (done) refresh();
    return done
      ? { ok: true, message: "Lead apagado." }
      : { ok: false, message: "Não foi possível apagar: só o proprietário ou a gestão apagam, e um lead que virou aluno não é apagado." };
  } catch {
    return { ok: false, message: FAILED };
  }
}

export async function convertLead(leadId: string, how: ConvertHow): Promise<ConvertResult> {
  const { db, context } = await requireWorkspace();
  const safe: ConvertHow = how?.mode === "link" ? { mode: "link", studentId: String(how.studentId ?? "") } : { mode: "create" };
  try {
    const outcome = await leadsFor(db, context).convert(leadId, safe);
    if (outcome.status === "converted" || outcome.status === "already") {
      refresh();
      return {
        status: outcome.status,
        studentId: outcome.studentId,
        message: outcome.status === "converted" ? "Lead convertido em aluno." : "Este lead já tinha virado aluno.",
      };
    }
    const message: Record<string, string> = {
      not_won: "Só um lead marcado como Contratado vira aluno.",
      forbidden: "Só o proprietário ou a gestão convertem em aluno, e só com um aluno que você atende.",
      student_taken: "Esse aluno já está ligado a outro lead.",
      not_found: "Não encontramos este lead.",
    };
    return { status: "error", message: message[outcome.status] ?? FAILED };
  } catch {
    return { status: "error", message: FAILED };
  }
}

export async function saveService(serviceId: string | null, input: unknown): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const repo = servicesFor(db, context);
    const outcome = serviceId ? await repo.update(serviceId, input) : await repo.create(input);
    if (outcome.status === "saved") {
      refresh();
      return { ok: true, message: serviceId ? "Serviço salvo." : "Serviço criado." };
    }
    const message = {
      duplicate_name: "Já existe um serviço com esse nome.",
      forbidden: "Só o proprietário ou a gestão mudam os serviços.",
      not_found: "Não encontramos este serviço.",
    }[outcome.status];
    return { ok: false, message };
  } catch (error) {
    return { ok: false, message: error instanceof ZodError ? "Informe o nome (2 a 160 caracteres) e como o serviço é entregue." : FAILED };
  }
}

export async function setServiceActive(serviceId: string, active: boolean): Promise<SimpleResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await servicesFor(db, context).setActive(serviceId, active === true);
    if (outcome.status === "saved") {
      refresh();
      return { ok: true, message: active ? "Serviço de volta à oferta." : "Serviço fora da oferta." };
    }
    return { ok: false, message: outcome.status === "forbidden" ? "Só o proprietário ou a gestão mudam os serviços." : "Não encontramos este serviço." };
  } catch {
    return { ok: false, message: FAILED };
  }
}
