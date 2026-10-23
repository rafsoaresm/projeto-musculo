import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Pill, formatDate } from "@/components/ui";

export type PortalState = "ACTIVE" | "INVITED" | "NONE";

export interface StudentListItem {
  id: string;
  displayName: string;
  portal: PortalState;
  /** Extra line under the name. Real records only say "Cadastro de atendimento". */
  note?: string;
  badge?: { tone: "neutral" | "brand" | "success" | "warning"; label: string };
}

export function PortalPill({
  state,
  until,
}: {
  state: PortalState;
  until?: string | null;
}) {
  if (state === "ACTIVE") return <Pill tone="success">Portal ativo</Pill>;
  if (state === "INVITED")
    return (
      <Pill tone="warning">
        Convite pendente{until ? ` até ${formatDate(until)}` : ""}
      </Pill>
    );
  return <Pill>Sem acesso ao portal</Pill>;
}

/** Shared by the real professional area and the demonstration. */
export function StudentList({
  students,
  hrefFor,
}: {
  students: StudentListItem[];
  hrefFor: (student: StudentListItem) => string;
}) {
  return (
    <ul className="student-list">
      {students.map((student) => (
        <li key={student.id}>
          <Link className="student-row" href={hrefFor(student)}>
            <div>
              <h2>{student.displayName}</h2>
              <p className="small">
                {student.note ?? "Cadastro de atendimento"}
              </p>
            </div>
            <div className="student-row-end">
              {student.badge && (
                <Pill tone={student.badge.tone}>{student.badge.label}</Pill>
              )}
              <PortalPill state={student.portal} />
              <ArrowRight size={20} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
