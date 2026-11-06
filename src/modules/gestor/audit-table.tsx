import { Pill, formatDateTime } from "@/components/ui";
import type { PlatformAuditRow } from "@/db/platform";

const actionLabel: Record<string, string> = {
  PLATFORM_ADMIN_ACTIVATED: "Gestor ativado",
  USER_BLOCKED: "Acesso bloqueado",
  USER_UNBLOCKED: "Acesso restabelecido",
  TERMS_PUBLISHED_STUDENT: "Termos do aluno publicados",
  TERMS_PUBLISHED_PROFESSIONAL: "Termos do profissional publicados",
  PLATFORM_TWO_FACTOR_RESET: "Verificação em duas etapas redefinida",
  PLATFORM_TWO_FACTOR_RECOVERED: "Verificação em duas etapas redefinida com o código de ativação",
  TERMS_DRAFT_DISCARDED_STUDENT: "Rascunho dos termos do aluno descartado",
  TERMS_DRAFT_DISCARDED_PROFESSIONAL: "Rascunho dos termos do profissional descartado",
  PLATFORM_ADMIN_INVITED: "Convite de gestor criado",
  PLATFORM_ADMIN_INVITE_REVOKED: "Convite de gestor cancelado",
  PLATFORM_ADMIN_GRANTED: "Gestor acrescentado",
  PLATFORM_ADMIN_REVOKED: "Acesso de gestor encerrado",
  AI_PROVIDER_CONNECTED: "Provedor de IA conectado",
  AI_PROVIDER_ROTATED: "Chave de provedor de IA trocada",
  AI_PROVIDER_REMOVED: "Provedor de IA removido",
  AI_PROVIDER_TESTED: "Conexão com provedor de IA testada",
  AI_MODEL_TESTED: "Modelo de IA testado",
  AI_TASK_CONFIGURED: "Tarefa de IA configurada",
  AI_KILL_SWITCH_ON: "IA interrompida em toda a plataforma",
  AI_KILL_SWITCH_OFF: "IA liberada em toda a plataforma",
  AI_PLAN_SAVED: "Plano de IA salvo",
  AI_PLAN_ARCHIVED: "Plano de IA arquivado",
  AI_ORG_ENABLED: "IA habilitada para uma organização",
  AI_ORG_DISABLED: "IA desligada para uma organização",
  AI_ORG_PLAN_ASSIGNED: "Plano de IA atribuído a uma organização",
};

/** Shared by the real manager area and the demonstration. */
export function AuditTable({ events }: { events: PlatformAuditRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table stack">
        <caption className="sr-only">Ações do gestor</caption>
        <thead>
          <tr>
            <th scope="col">Quando</th>
            <th scope="col">Ação</th>
            <th scope="col">Feita por</th>
            <th scope="col">Organização</th>
            <th scope="col">Pessoa afetada</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <th scope="row" data-label="Quando">
                {formatDateTime(event.createdAt)}
              </th>
              <td data-label="Ação">
                <Pill tone={event.action === "USER_BLOCKED" ? "danger" : "brand"}>
                  {actionLabel[event.action] ?? event.action}
                </Pill>
              </td>
              <td data-label="Feita por">{event.actorEmail}</td>
              <td data-label="Organização">{event.organizationName ?? "—"}</td>
              <td data-label="Pessoa afetada">{event.subjectEmail ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
