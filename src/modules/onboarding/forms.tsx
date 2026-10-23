"use client";
import { useActionState } from "react";
import { setupWorkspace, addStudent } from "./actions";

export function WorkspaceForm({ name }: { name: string }) {
  const [error, action, pending] = useActionState(setupWorkspace, "");
  return (
    <form action={action} className="stack-form">
      <label>
        Nome do espaço
        <input
          name="name"
          required
          minLength={2}
          maxLength={160}
          placeholder="Seu estúdio ou nome profissional"
        />
      </label>
      <label>
        Profissional responsável
        <input
          name="professionalName"
          autoComplete="name"
          defaultValue={name}
          required
          minLength={2}
          maxLength={160}
        />
      </label>
      <p className="small">
        Você será responsável pelos alunos cadastrados neste espaço. Fuso
        inicial: Brasília.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Criando…" : "Criar meu espaço"}
      </button>
    </form>
  );
}
export function StudentForm() {
  const [error, action, pending] = useActionState(addStudent, "");
  return (
    <form action={action} className="stack-form">
      <label>
        Nome do aluno
        <input
          name="displayName"
          required
          minLength={2}
          maxLength={160}
          autoComplete="off"
        />
      </label>
      <p className="small">
        O cadastro ficará vinculado a você como profissional responsável. O
        acesso do aluno ao portal será disponibilizado em uma próxima etapa.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Salvando…" : "Cadastrar aluno"}
      </button>
    </form>
  );
}
