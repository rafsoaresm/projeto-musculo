"use server";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/modules/auth/server";
import { siteInquiriesFor } from "@/db/site-inquiries";

/**
 * What the professional does with a message left in the contact form of the public page: turn it into a lead or discard it. The workspace and the
 * person come from the verified session; the browser sends only the id of the message it is looking at, and the repository repeats the membership
 * and the role in the statement that writes. Both are final (the message is deleted either way), and both are safe to repeat: a second attempt finds
 * nothing and creates nothing.
 */
export type InquiryResult = { ok: boolean; message: string; leadId?: string };

const GONE = "Esta mensagem não está mais aqui: ela já foi tratada ou apagada.";
const FAILED = "Não foi possível concluir. Tente novamente.";
const refresh = () => revalidatePath("/profissional", "layout");

export async function convertInquiry(inquiryId: string): Promise<InquiryResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await siteInquiriesFor(db, context).convert(String(inquiryId));
    if (outcome.status === "converted") {
      refresh();
      return { ok: true, message: "A mensagem virou um lead, com origem Site.", leadId: outcome.leadId };
    }
    return { ok: false, message: GONE };
  } catch {
    return { ok: false, message: FAILED };
  }
}

export async function discardInquiry(inquiryId: string): Promise<InquiryResult> {
  const { db, context } = await requireWorkspace();
  try {
    const outcome = await siteInquiriesFor(db, context).discard(String(inquiryId));
    if (outcome.status === "discarded") {
      refresh();
      return { ok: true, message: "A mensagem foi apagada." };
    }
    return { ok: false, message: GONE };
  } catch {
    return { ok: false, message: FAILED };
  }
}
