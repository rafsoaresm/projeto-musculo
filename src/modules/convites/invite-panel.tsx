"use client";
import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Pill, formatDate } from "@/components/ui";
import {
  createInviteLink,
  revokeStudentAccess,
  type InviteState,
} from "./actions";

export function InvitePanel({
  studentId,
  access,
  activeSince,
  inviteExpiresAt,
}: {
  studentId: string;
  access: "ACTIVE" | "INVITED" | "NONE";
  activeSince: string | null;
  inviteExpiresAt: string | null;
}) {
  const [invite, createAction, creating] = useActionState<InviteState>(
    createInviteLink.bind(null, studentId),
    {},
  );
  const [revokeMessage, revokeAction, revoking] = useActionState(
    revokeStudentAccess.bind(null, studentId),
    "",
  );
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="invite-panel">
      {access === "ACTIVE" && (
        <p>
          <Pill tone="success">Acesso ativo</Pill>{" "}
          {activeSince && <>desde {formatDate(activeSince)}. </>}
          O aluno entra pela área do aluno e vê somente o que for liberado para
          ele.
        </p>
      )}
      {access === "INVITED" && !invite.link && (
        <p>
          <Pill tone="warning">
            Convite pendente
            {inviteExpiresAt ? ` até ${formatDate(inviteExpiresAt)}` : ""}
          </Pill>{" "}
          O link só é mostrado no momento em que é criado. Gere um novo link
          para substituir o anterior.
        </p>
      )}
      {access === "NONE" && !invite.link && (
        <p>
          <Pill>Sem acesso ao portal</Pill> Este aluno ainda não tem acesso à
          área do aluno.
        </p>
      )}

      {invite.link && (
        <div className="copy-box" role="group" aria-label="Link de convite">
          <label>
            Link de convite (uso único)
            <input readOnly value={invite.link} onFocus={(e) => e.target.select()} />
          </label>
          <button
            type="button"
            className="button secondary small"
            onClick={() => copy(invite.link as string)}
          >
            {copied === "yes" ? <Check size={16} /> : <Copy size={16} />}
            {copied === "yes" ? "Copiado" : "Copiar link"}
          </button>
          <p className="small muted">
            Envie por um canal seguro. Vale por 7 dias e só pode ser usado uma
            vez. A ferramenta ainda não envia e-mails.
            {copied === "failed" &&
              " Não foi possível copiar sozinho: selecione o texto acima."}
          </p>
        </div>
      )}
      {invite.error && (
        <p role="alert" className="form-error">
          {invite.error}
        </p>
      )}

      <div className="invite-actions">
        {access !== "ACTIVE" && (
          <form action={createAction}>
            <button className="button primary small" disabled={creating}>
              {creating
                ? "Gerando…"
                : access === "INVITED" || invite.link
                  ? "Gerar novo link"
                  : "Gerar link de convite"}
            </button>
          </form>
        )}
        {access === "ACTIVE" && !confirming && (
          // A plain button outside any form, with its own key: it must never
          // turn into the submit button during the same click.
          <button
            key="ask-revoke"
            type="button"
            className="button danger-outline small"
            onClick={() => setConfirming(true)}
          >
            Revogar acesso
          </button>
        )}
        {(access === "INVITED" || (access === "ACTIVE" && confirming)) && (
          <form
            key="confirm-revoke"
            action={() => {
              setConfirming(false);
              revokeAction();
            }}
            className="inline-form"
          >
            <button
              className="button danger-outline small"
              disabled={revoking}
            >
              {access === "ACTIVE" ? "Confirmar revogação" : "Cancelar convite"}
            </button>
            {confirming && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => setConfirming(false)}
              >
                Manter acesso
              </button>
            )}
          </form>
        )}
      </div>
      {revokeMessage && (
        <p role="status" className="small muted">
          {revokeMessage}
        </p>
      )}
    </div>
  );
}
