import { Pill, formatDateTime } from "@/components/ui";
import type { PlatformAuditRow } from "@/db/platform";

const actionLabel: Record<string, string> = {
  PLATFORM_ADMIN_ACTIVATED: "Gestor ativado",
  USER_BLOCKED: "Acesso bloqueado",
  USER_UNBLOCKED: "Acesso restabelecido",
  TERMS_PUBLISHED_STUDENT: "Termos do aluno publicados",
  TERMS_PUBLISHED_PROFESSIONAL: "Termos do profissional publicados",
  PLATFORM_ADMIN_INVITED: "Convite de gestor criado",
  PLATFORM_ADMIN_INVITE_REVOKED: "Convite de gestor cancelado",
  PLATFORM_ADMIN_GRANTED: "Gestor acrescentado",
  PLATFORM_ADMIN_REVOKED: "Acesso de gestor encerrado",
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
