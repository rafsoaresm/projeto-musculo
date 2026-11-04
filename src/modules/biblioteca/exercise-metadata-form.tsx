"use client";
import Link from "next/link";
import { useActionState, useTransition } from "react";
import { Pill, type Tone } from "@/components/ui";
import {
  addExerciseAlternative,
  enrichLibrary,
  markExerciseAttributePending,
  removeExerciseAlternative,
  saveExerciseAttribute,
} from "./actions";
import type { FieldValue } from "./metadata/fields";
import type { MetadataField } from "./metadata/vocabulary";
import type { FieldControl } from "./metadata/view";

/** Everything one field row shows; computed on the server (see the exercise page). */
export interface MetadataFieldView {
  field: MetadataField;
  label: string;
  valueText: string;
  value: FieldValue | null;
  pill: { text: string; tone: Tone };
  ruleText: string | null;
  /** "Valor da biblioteca do sistema: …" when the organization's adjustment hides it. */
  systemText: string | null;
  /** Version of the organization's row, or null when the organization has none yet. */
  version: number | null;
  control: FieldControl;
  required: boolean;
}

const ok = (message: string) =>
  message.startsWith("Salvo") || message.startsWith("Campo marcado") || message.startsWith("Alternativa adicionada") || message.startsWith("Alternativa removida");

function Message({ text }: { text: string }) {
  if (!text) return null;
  const good = ok(text);
  return (
    <p role={good ? "status" : "alert"} className={good ? "small muted" : "form-error"}>
      {text}
    </p>
  );
}

/**
 * "None" is its own explicit choice: saving with nothing checked is refused ("no value"), so an
 * empty list is never stored by accident (for example "Sem equipamento" on a field nobody filled).
 */
function NoneChoice({ label, value }: { label: string | null; value: FieldValue | null }) {
  if (!label) return null;
  return (
    <label className="check-row">
      <input type="checkbox" name="none" value="true" defaultChecked={Array.isArray(value) && value.length === 0} />
      {label}
    </label>
  );
}

function Control({ view }: { view: MetadataFieldView }) {
  const { control, value, label } = view;
  if (control.kind === "select")
    return (
      <label>
        {label}
        <select name="value" defaultValue={value === null ? "" : String(value)}>
          <option value="">Escolha</option>
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  if (control.kind === "number")
    return (
      <label>
        {label}
        <input
          name="value"
          type="number"
          inputMode="decimal"
          min={control.min}
          max={control.max}
          step={control.step}
          defaultValue={value === null ? "" : String(value)}
        />
      </label>
    );
  if (control.kind === "checks") {
    const chosen = new Set(Array.isArray(value) ? (value as string[]) : []);
    return (
      <fieldset className="metadata-checks">
        <legend>{label}</legend>
        {control.options.map((option) => (
          <label key={option.value} className="check-row">
            <input type="checkbox" name="value" value={option.value} defaultChecked={chosen.has(option.value)} />
            {option.label}
          </label>
        ))}
        <NoneChoice label={control.noneLabel} value={value} />
      </fieldset>
    );
  }
  const sets = Array.isArray(value) ? (value as string[][]) : [];
  return (
    <>
      {control.noneLabel && (
        <fieldset className="metadata-checks">
          <legend>{label}</legend>
          <NoneChoice label={control.noneLabel} value={value} />
        </fieldset>
      )}
      {Array.from({ length: control.sets }, (_, index) => {
        const chosen = new Set(sets[index] ?? []);
        return (
          <fieldset key={index} className="metadata-checks">
            <legend>{`Alternativa ${index + 1} (todos os itens marcados juntos)`}</legend>
            {control.options.map((option) => (
              <label key={option.value} className="check-row">
                <input type="checkbox" name={`set${index}`} value={option.value} defaultChecked={chosen.has(option.value)} />
                {option.label}
              </label>
            ))}
          </fieldset>
        );
      })}
    </>
  );
}

/**
 * One field: the value in use, its provenance, and (when editable) the review form. Sent from
 * onSubmit, not the `action` prop, for the same reason as `ExerciseForm`: React resets a form after
 * its action, which would erase the choice the server refused.
 */
function FieldEditor({
  exerciseId,
  view,
  editable,
  systemExercise,
}: {
  exerciseId: string;
  view: MetadataFieldView;
  editable: boolean;
  systemExercise: boolean;
}) {
  const [saved, save, saving] = useActionState(
    saveExerciseAttribute.bind(null, exerciseId, view.field),
    "",
  );
  const [marked, mark, marking] = useActionState(markExerciseAttributePending.bind(null, exerciseId, view.field), "");
  const version = <input type="hidden" name="version" value={view.version === null ? "" : String(view.version)} />;
  const [, startTransition] = useTransition();
  const busy = saving || marking;
  const firstAdjustment = systemExercise && view.version === null;
  return (
    <details className="metadata-field" data-field={view.field}>
      <summary>
        <span className="metadata-field-name">
          {view.label}
          {view.required && <span className="sr-only"> (necessário para a seleção automática)</span>}
        </span>
        <span className="metadata-field-value">{view.valueText}</span>
        <Pill tone={view.pill.tone}>{view.pill.text}</Pill>
      </summary>
      <div className="metadata-field-body">
        {view.ruleText && <p className="small muted">{view.ruleText}. Não é biomecânica validada: revise antes de confiar.</p>}
        {view.systemText && <p className="small muted">{view.systemText}</p>}
        {view.required && (
          <p className="small muted">Necessário para a seleção automática: sem ele (ou pendente), o exercício não é escolhido pela ferramenta.</p>
        )}
        {editable ? (
          <>
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                startTransition(() => save(data));
              }}
            >
              {version}
              <Control view={view} />
              <Message text={saved} />
              <button className="button primary small" disabled={busy}>
                {saving
                  ? "Salvando…"
                  : firstAdjustment
                    ? "Criar ajuste da minha organização (revisado por mim)"
                    : "Salvar como revisado por mim"}
              </button>
            </form>
            <form action={mark} className="inline-form">
              {version}
              <button className="button secondary small" disabled={busy}>
                {marking ? "Aguarde…" : "Marcar como pendente"}
              </button>
              <Message text={marked} />
            </form>
          </>
        ) : (
          <p className="small muted">Exercício arquivado: os metadados ficam só para consulta.</p>
        )}
      </div>
    </details>
  );
}

export function ExerciseMetadataFields({
  exerciseId,
  fields,
  editable,
  systemExercise,
}: {
  exerciseId: string;
  fields: MetadataFieldView[];
  editable: boolean;
  systemExercise: boolean;
}) {
  return (
    <div className="metadata-fields">
      {fields.map((view) => (
        <FieldEditor
          key={view.field}
          exerciseId={exerciseId}
          view={view}
          editable={editable}
          systemExercise={systemExercise}
        />
      ))}
    </div>
  );
}

function RemoveAlternative({ relationId, name }: { relationId: string; name: string }) {
  const [message, action, pending] = useActionState(
    removeExerciseAlternative.bind(null, relationId) as () => Promise<string>,
    "",
  );
  return (
    <form action={action} className="inline-form">
      <button className="button small danger-outline" disabled={pending} aria-label={`Remover a alternativa ${name}`}>
        {pending ? "Aguarde…" : "Remover"}
      </button>
      <Message text={message} />
    </form>
  );
}

export function ExerciseAlternatives({
  exerciseId,
  alternatives,
  candidates,
  editable,
}: {
  exerciseId: string;
  alternatives: Array<{ relationId: string; exerciseId: string; name: string; pill: { text: string; tone: Tone }; removable: boolean }>;
  candidates: Array<{ id: string; name: string }>;
  editable: boolean;
}) {
  const [message, add, adding] = useActionState(addExerciseAlternative.bind(null, exerciseId), "");
  const [, startTransition] = useTransition();
  return (
    <>
      {alternatives.length === 0 ? (
        <p className="muted">Nenhuma alternativa curada. A ferramenta ainda sugere trocas pelo músculo e pelo padrão de movimento.</p>
      ) : (
        <ul className="metadata-alternatives">
          {alternatives.map((alternative) => (
            <li key={alternative.relationId}>
              <Link className="account-link" href={`/profissional/biblioteca/${alternative.exerciseId}`}>
                {alternative.name}
              </Link>{" "}
              <Pill tone={alternative.pill.tone}>{alternative.pill.text}</Pill>
              {editable && alternative.removable && <RemoveAlternative relationId={alternative.relationId} name={alternative.name} />}
            </li>
          ))}
        </ul>
      )}
      {editable && candidates.length > 0 && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => add(data));
          }}
        >
          <label>
            Adicionar alternativa
            <select name="alternativeId" defaultValue="">
              <option value="">Escolha um exercício</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary small" disabled={adding}>
            {adding ? "Aguarde…" : "Adicionar alternativa"}
          </button>
        </form>
      )}
      <Message text={message} />
    </>
  );
}

/** "Inferir metadados das minhas fichas" on the library page. */
export function EnrichLibraryButton() {
  const [message, action, pending] = useActionState(enrichLibrary as () => Promise<string>, "");
  return (
    <form action={action} className="stack-form">
      <button className="button secondary" disabled={pending}>
        {pending ? "Inferindo…" : "Inferir metadados das minhas fichas"}
      </button>
      {message && (
        <p role={message.startsWith("Inferência") || message.startsWith("Sua biblioteca") ? "status" : "alert"} className="small muted">
          {message}
        </p>
      )}
    </form>
  );
}
