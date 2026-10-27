"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { Notice, Pill, formatDate } from "@/components/ui";
import { useMountPath } from "@/components/use-mount-path";
import type { ManagerInviteRow, ManagerRow } from "@/db/platform";
import { ResetTwoFactor } from "./reset-two-factor";
import {
  inviteManager,
  resetManagerTwoFactor,
  revokeManager,
  revokeManagerInvite,
  type ManagerInviteState,
} from "./manager-actions";

const STATUS: Record<ManagerInviteRow["status"], { label: string; tone: "brand" | "success" | "neutral" | "warning" }> = {
  OPEN: { label: "Aberto", tone: "brand" },
  USED: { label: "Usado", tone: "success" },
  EXPIRED: { label: "Venceu", tone: "neutral" },
  REVOKED: { label: "Cancelado", tone: "neutral" },
  LAPSED: { label: "Sem efeito: quem convidou deixou de ser gestor", tone: "warning" },
};

/**
 * The people who manage the platform and the single-use links that add another. The link is shown
 * once, here, to whoever issued it. Nothing here shows a student, an assessment or a plan.
 */
export function ManagersPanel({ managers, invites }: { managers: ManagerRow[]; invites: ManagerInviteRow[] }) {
  const router = useRouter();
  const mountPath = useMountPath();
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<ManagerInviteState>({});
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const link = created.invite ? `${created.invite.origin}${mountPath()}${created.invite.path}` : undefined;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setCopied(null);
    startTransition(async () => {
      const result = await inviteManager(label);
      setCreated(result);
      if (result.error) setMessage(result.error);
      else setLabel("");
      router.refresh();
    });
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }
  function cancel(id: string) {
    startTransition(async () => {
      setMessage(await revokeManagerInvite(id));
      router.refresh();
    });
  }
  function end(userId: string) {
    startTransition(async () => {
      setMessage(await revokeManager(userId));
      setConfirming(null);
      router.refresh();
    });
  }

  return (
    <>
      <section className="panel" aria-labelledby="gestores-lista">
        <p className="eyebrow">QUEM GERE A PLATAFORMA</p>
        <h2 id="gestores-lista">Gestores</h2>
        <div className="table-wrap">
          <table className="data-table stack">
            <caption className="sr-only">Gestores da plataforma</caption>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">E-mail</th>
                <th scope="col">Desde</th>
                <th scope="col">Entrou por</th>
                <th scope="col">Situação</th>
                <th scope="col">
                  <span className="sr-only">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {managers.map((manager) => (
                <tr key={manager.userId}>
                  <th scope="row" data-label="Nome">
                    {manager.name} {manager.self && <Pill tone="brand">Você</Pill>}
                  </th>
                  <td data-label="E-mail">{manager.email}</td>
                  <td data-label="Desde">{formatDate(manager.since)}</td>
                  <td data-label="Entrou por">
                    {manager.invitedByEmail ? `convite de ${manager.invitedByEmail}` : "código de ativação"}
                  </td>
                  <td data-label="Situação">
                    {manager.revoked ? <Pill>Acesso encerrado</Pill> : <Pill tone="success">Ativo</Pill>}
                    {manager.twoFactor && <small className="cell-sub">Duas etapas ativas</small>}
                  </td>
                  <td>
                    {!manager.revoked && !manager.self && manager.twoFactor && (
                      <ResetTwoFactor name={manager.name} reset={resetManagerTwoFactor.bind(null, manager.userId)} />
                    )}
                    {!manager.revoked && !manager.self && (
                      confirming === manager.userId ? (
                        <span className="inline-form">
                          <button
                            type="button"
                            className="button small danger-outline"
                            disabled={pending}
                            onClick={() => end(manager.userId)}
                          >
                            Confirmar: encerrar o acesso de {manager.name}
                          </button>
                          <button type="button" className="button small secondary" onClick={() => setConfirming(null)}>
                            Voltar
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="button small danger-outline"
                          disabled={pending}
                          onClick={() => setConfirming(manager.userId)}
                          aria-label={`Encerrar o acesso de gestor de ${manager.name}`}
                        >
                          Encerrar acesso
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Você não encerra o próprio acesso, então há sempre ao menos um gestor. Se o último gestor perder o acesso, o
          código de ativação do ambiente volta a funcionar.
        </p>
      </section>

      <section className="panel" aria-labelledby="gestores-convite">
        <p className="eyebrow">ACRESCENTAR UM GESTOR</p>
        <h2 id="gestores-convite">Convidar por link de uso único</h2>
        <Notice tone="warning">
          <p>
            Quem aceitar passa a ver todas as organizações e profissionais, a bloquear acessos e a publicar os termos.
            Continua sem ver alunos, avaliações e treinos. O acesso vem do link e da conta de quem o abrir, nunca do
            e-mail: entregue o link só à pessoa certa, por um canal seguro. Ele vale por 48 horas, uma vez.
          </p>
        </Notice>
        <form className="stack-form" onSubmit={submit} aria-label="Convidar um gestor">
          <label>
            Lembrete de para quem é (opcional)
            <input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <div className="persist-actions">
            <button className="button" disabled={pending}>
              {pending ? "Aguarde…" : "Gerar link de convite"}
            </button>
          </div>
        </form>
        {link && (
          <div className="copy-box" role="group" aria-label="Link de convite de gestor">
            <label>
              Link de convite de gestor (uso único)
              <input readOnly value={link} onFocus={(event) => event.target.select()} />
            </label>
            <button type="button" className="button secondary small" onClick={() => copy(link)}>
              {copied === "yes" ? <Check size={16} /> : <Copy size={16} />}
              {copied === "yes" ? "Copiado" : "Copiar link"}
            </button>
            <p className="small muted">
              Válido até {created.expiresAt ? formatDate(created.expiresAt) : ""}. O link só é mostrado agora: se perder,
              cancele este convite e gere outro.
            </p>
            {copied === "failed" && <p className="form-error">Não foi possível copiar. Selecione o link e copie à mão.</p>}
          </div>
        )}
        {message && (
          <p role="status" className="small muted">
            {message}
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="gestores-convites">
        <p className="eyebrow">CONVITES</p>
        <h2 id="gestores-convites">Convites emitidos</h2>
        {invites.length === 0 ? (
          <p className="muted">Nenhum convite emitido ainda.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table stack">
              <caption className="sr-only">Convites de gestor</caption>
              <thead>
                <tr>
                  <th scope="col">Lembrete</th>
                  <th scope="col">Emitido por</th>
                  <th scope="col">Em</th>
                  <th scope="col">Vale até</th>
                  <th scope="col">Situação</th>
                  <th scope="col">
                    <span className="sr-only">Ação</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <th scope="row" data-label="Lembrete">{invite.label ?? "—"}</th>
                    <td data-label="Emitido por">{invite.createdByEmail}</td>
                    <td data-label="Em">{formatDate(invite.createdAt)}</td>
                    <td data-label="Vale até">{formatDate(invite.expiresAt)}</td>
                    <td data-label="Situação">
                      <Pill tone={STATUS[invite.status].tone}>{STATUS[invite.status].label}</Pill>
                      {invite.acceptedByEmail && <small className="cell-sub">{invite.acceptedByEmail}</small>}
                    </td>
                    <td>
                      {invite.status === "OPEN" && (
                        <button
                          type="button"
                          className="button small secondary"
                          disabled={pending}
                          onClick={() => cancel(invite.id)}
                          aria-label={`Cancelar o convite ${invite.label ?? formatDate(invite.createdAt)}`}
                        >
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
