import { formatDateTime } from "@/components/ui";
import { OWN_STUDENT_READ_LABEL, READ_DEDUP_MINUTES, type OwnStudentRead } from "@/db/student-reads";

/** "Quem acessou os meus dados", in the student's "Minha conta": the organization, the professional, what and when. */
export function OwnReadsPanel({ reads, showStudent }: { reads: (OwnStudentRead & { studentName?: string })[]; showStudent: boolean }) {
  return (
    <section className="panel" aria-labelledby="acessos-meus-dados">
      <p className="eyebrow">SEUS DADOS</p>
      <h2 id="acessos-meus-dados">Quem acessou os meus dados</h2>
      <p className="muted">
        Quando um profissional abre a sua ficha, uma avaliação, um plano, as suas fotos ou um PDF, fica uma linha aqui. O conteúdo
        não fica registrado, só quem, o quê e quando. Abrir o mesmo item de novo em menos de {READ_DEDUP_MINUTES} minutos não gera
        outra linha. Por enquanto nenhuma linha é apagada.
      </p>
      {reads.length === 0 ? (
        <p className="small muted">Nenhum acesso registrado. A lista começa nos acessos feitos depois desta atualização.</p>
      ) : (
        <ul className="read-list" aria-label="Quem acessou os meus dados">
          {reads.map((read, index) => (
            <li key={`${read.at}-${read.kind}-${index}`}>
              <strong>{OWN_STUDENT_READ_LABEL[read.kind]}</strong>
              <span className="small muted">
                {read.professionalName ?? "Profissional sem nome de exibição"} · {read.organizationName}
                {showStudent && read.studentName ? ` · ${read.studentName}` : ""} · {formatDateTime(read.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
