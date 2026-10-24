"use client";
import { useState, useTransition } from "react";
import { Notice } from "@/components/ui";
import type { StudentProfile } from "@/db/student-profile";
import { saveProfile } from "./actions";
import { GENDERS, GOALS, LEVELS, SESSION_MINUTES, ageOn } from "./contracts";

const str = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);
const num = (value: string) => {
  const text = value.trim().replace(",", ".");
  return text === "" ? null : Number(text);
};
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The student's file, with the fields of the master document. Fields are controlled and the
 * form is sent from a handler, not from `action`: React 19 resets a form after its action,
 * which would erase the text whenever the server refuses it.
 */
export function ProfileForm({
  studentId,
  profile,
}: {
  studentId: string;
  profile: StudentProfile | null;
}) {
  const [v, setV] = useState({
    birthDate: str(profile?.birthDate),
    gender: str(profile?.gender),
    email: str(profile?.email),
    phone: str(profile?.phone),
    heightCm: str(profile?.heightCm),
    weightKg: str(profile?.weightKg),
    bodyMeasuredOn: str(profile?.bodyMeasuredOn),
    goal: str(profile?.goal),
    level: str(profile?.level),
    daysPerWeek: str(profile?.daysPerWeek),
    sessionMinutes: str(profile?.sessionMinutes),
    location: str(profile?.location),
    equipment: str(profile?.equipment),
    experience: str(profile?.experience),
    injuries: str(profile?.injuries),
    surgeries: str(profile?.surgeries),
    pains: str(profile?.pains),
    limitations: str(profile?.limitations),
    medicationsConditions: str(profile?.medicationsConditions),
    relevantNotes: str(profile?.relevantNotes),
    preferredExercises: str(profile?.preferredExercises),
    dislikedExercises: str(profile?.dislikedExercises),
    excludedExercises: str(profile?.excludedExercises),
    professionalNotes: str(profile?.professionalNotes),
  });
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof v) => (event: { target: { value: string } }) => {
    setV({ ...v, [key]: event.target.value });
    setMessage("");
  };
  const age = /^\d{4}-\d{2}-\d{2}$/.test(v.birthDate) ? ageOn(v.birthDate, today()) : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = (value: string) => (value.trim() === "" ? null : value);
    startTransition(async () => {
      const result = await saveProfile(studentId, {
        birthDate: text(v.birthDate),
        gender: text(v.gender),
        email: text(v.email),
        phone: text(v.phone),
        heightCm: num(v.heightCm),
        weightKg: num(v.weightKg),
        bodyMeasuredOn: text(v.bodyMeasuredOn),
        goal: text(v.goal),
        level: text(v.level),
        daysPerWeek: num(v.daysPerWeek),
        sessionMinutes: num(v.sessionMinutes),
        location: text(v.location),
        equipment: text(v.equipment),
        experience: text(v.experience),
        injuries: text(v.injuries),
        surgeries: text(v.surgeries),
        pains: text(v.pains),
        limitations: text(v.limitations),
        medicationsConditions: text(v.medicationsConditions),
        relevantNotes: text(v.relevantNotes),
        preferredExercises: text(v.preferredExercises),
        dislikedExercises: text(v.dislikedExercises),
        excludedExercises: text(v.excludedExercises),
        professionalNotes: text(v.professionalNotes),
      });
      setFailed(Boolean(result.error));
      setMessage(result.error ?? "Ficha salva.");
    });
  }

  return (
    <form className="stack-form profile-form" onSubmit={submit}>
      <Notice>
        <p>
          Estas informações são pessoais e de saúde. Só você, com vínculo técnico
          com o aluno, as vê; o aluno e a plataforma não. Anote o que o aluno
          relatou, sem interpretar como diagnóstico. A base legal e o texto de
          consentimento para guardar esses dados ainda não estão definidos na
          ferramenta.
        </p>
      </Notice>

      <fieldset>
        <legend>Identificação</legend>
        <div className="field-grid">
          <label>
            Data de nascimento
            <input type="date" value={v.birthDate} onChange={set("birthDate")} max={today()} />
          </label>
          <label>
            Gênero
            <select value={v.gender} onChange={set("gender")}>
              <option value="">Não informado</option>
              {GENDERS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            E-mail
            <input type="email" value={v.email} onChange={set("email")} maxLength={254} autoComplete="off" />
          </label>
          <label>
            Telefone
            <input type="tel" value={v.phone} onChange={set("phone")} maxLength={30} autoComplete="off" />
          </label>
          <label>
            Altura (cm)
            <input inputMode="numeric" value={v.heightCm} onChange={set("heightCm")} />
          </label>
          <label>
            Peso (kg)
            <input inputMode="decimal" value={v.weightKg} onChange={set("weightKg")} />
          </label>
          <label>
            Medidas tiradas em
            <input type="date" value={v.bodyMeasuredOn} onChange={set("bodyMeasuredOn")} max={today()} />
          </label>
        </div>
        {age !== null && (
          <p className="small muted" role="status">
            Idade: {age} {age === 1 ? "ano" : "anos"}, calculada pela data de nascimento.
          </p>
        )}
        {age !== null && age < 18 && (
          <Notice tone="warning">
            <p>
              <strong>Menor de idade.</strong> O atendimento a menores exige
              responsável, permissões e consentimentos próprios, que esta
              ferramenta ainda não suporta. Guardar a data aqui não torna esse
              atendimento suportado.
            </p>
          </Notice>
        )}
      </fieldset>

      <fieldset>
        <legend>Contexto de treino</legend>
        <div className="field-grid">
          <label>
            Objetivo principal
            <select value={v.goal} onChange={set("goal")}>
              <option value="">Não informado</option>
              {GOALS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Nível
            <select value={v.level} onChange={set("level")}>
              <option value="">Não informado</option>
              {LEVELS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Dias por semana
            <select value={v.daysPerWeek} onChange={set("daysPerWeek")}>
              <option value="">Não informado</option>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "dia" : "dias"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tempo por sessão (minutos)
            <input
              inputMode="numeric"
              list="session-minutes"
              value={v.sessionMinutes}
              onChange={set("sessionMinutes")}
              placeholder="Ex.: 60"
            />
            <datalist id="session-minutes">
              {SESSION_MINUTES.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label>
            Local de treino
            <input value={v.location} onChange={set("location")} maxLength={120} />
          </label>
        </div>
        <label>
          Equipamentos disponíveis
          <textarea rows={3} value={v.equipment} onChange={set("equipment")} maxLength={500} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Histórico</legend>
        <label>
          Experiência prévia
          <textarea rows={2} value={v.experience} onChange={set("experience")} maxLength={1000} />
        </label>
        <label>
          Lesões relatadas
          <textarea rows={2} value={v.injuries} onChange={set("injuries")} maxLength={1000} />
        </label>
        <label>
          Cirurgias
          <textarea rows={2} value={v.surgeries} onChange={set("surgeries")} maxLength={1000} />
        </label>
        <label>
          Dores
          <textarea rows={2} value={v.pains} onChange={set("pains")} maxLength={1000} />
        </label>
        <label>
          Limitações
          <textarea rows={2} value={v.limitations} onChange={set("limitations")} maxLength={1000} />
        </label>
        <label>
          Medicamentos ou condições informadas
          <textarea
            rows={2}
            value={v.medicationsConditions}
            onChange={set("medicationsConditions")}
            maxLength={1000}
          />
        </label>
        <label>
          Observações relevantes
          <textarea rows={2} value={v.relevantNotes} onChange={set("relevantNotes")} maxLength={1000} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Preferências e aderência</legend>
        <label>
          Exercícios preferidos
          <textarea rows={2} value={v.preferredExercises} onChange={set("preferredExercises")} maxLength={500} />
        </label>
        <label>
          Exercícios de que não gosta
          <textarea rows={2} value={v.dislikedExercises} onChange={set("dislikedExercises")} maxLength={500} />
        </label>
        <label>
          Exercícios que não deseja realizar
          <textarea rows={2} value={v.excludedExercises} onChange={set("excludedExercises")} maxLength={500} />
        </label>
        <label>
          Observações do profissional
          <textarea rows={3} value={v.professionalNotes} onChange={set("professionalNotes")} maxLength={1000} />
        </label>
      </fieldset>

      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "form-error" : "small muted"}>
          {message}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Salvando…" : "Salvar ficha"}
      </button>
    </form>
  );
}
