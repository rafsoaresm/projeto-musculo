"use client";
import { useActionState, useTransition } from "react";
import { ConsentFields } from "@/modules/consentimento/consent-fields";
import { setupWorkspace, addStudent } from "./actions";

/**
 * Sends the form from onSubmit instead of the `action` prop. React 19 resets a
 * form after its action runs, which erased the typed text whenever the server
 * refused it.
 */
function useKeepingSubmit(action: (data: FormData) => void) {
  const [, startTransition] = useTransition();
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
}

export function WorkspaceForm({ name }: { name: string }) {
  const [error, action, pending] = useActionState(setupWorkspace, "");
  const submit = useKeepingSubmit(action);
  return (
    <form onSubmit={submit} className="stack-form">
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
      <ConsentFields audience="PROFESSIONAL" />
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
  const submit = useKeepingSubmit(action);
  return (
    <form onSubmit={submit} className="stack-form">
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
