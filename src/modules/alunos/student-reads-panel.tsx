import { formatDateTime } from "@/components/ui";
import { STUDENT_READ_LABEL, READ_DEDUP_MINUTES, type StudentRead } from "@/db/student-reads";

/**
 * "Acessos aos dados do aluno": who of the team opened this student's data, what and when. Shown only to the organization's OWNER and
 * MANAGER; the list itself is read by a statement that checks the role and the reach again.
 */
export function StudentReadsPanel({ reads }: { reads: StudentRead[] }) {
  return (
    <section className="panel" aria-labelledby="acessos-aluno">
      <p className="eyebrow">TRILHA DE LEITURA</p>
      <h2 id="acessos-aluno">Acessos aos dados do aluno</h2>
      <p className="muted">
        Quem da equipe abriu a ficha, uma avaliação, um plano, as fotos ou um PDF deste aluno, e quando. O conteúdo não fica
        registrado. Abrir o mesmo item de novo em menos de {READ_DEDUP_MINUTES} minutos não gera outra linha.
      </p>
      {reads.length === 0 ? (
        <p className="small muted">Nenhum acesso registrado. A lista começa nos acessos feitos depois desta atualização.</p>
      ) : (
        <ul className="read-list" aria-label="Acessos aos dados do aluno">
          {reads.map((read, index) => (
            <li key={`${read.at}-${read.kind}-${index}`}>
              <strong>{STUDENT_READ_LABEL[read.kind]}</strong>
              <span className="small muted">
                {read.professionalName ?? "Profissional sem nome de exibição"} · {formatDateTime(read.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
